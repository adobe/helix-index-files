/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable no-param-reassign */

'use strict';

const rp = require('request-promise-native');

const mapResult = require('./mapResult.js');

/**
 * Azure search index provider.
 */
class Azure {
  constructor(params, config, log) {
    const {
      AZURE_SEARCH_API_KEY: apiKey,
      AZURE_SEARCH_SERVICE_NAME: serviceName,
    } = params;

    if (!apiKey) {
      throw new Error('AZURE_SEARCH_API_KEY parameter missing.');
    }
    if (!serviceName) {
      throw new Error('AZURE_SEARCH_SERVICE_NAME parameter missing.');
    }

    this._apiKey = apiKey;
    this._serviceName = serviceName;

    const {
      owner, repo,
    } = params;

    this._index = `${owner}--${repo}--${config.name}`;
    this._config = config;
    this._log = log;
  }

  async _getClient() {
    const opts = {
      baseUrl: `https://${this._serviceName}.search.windows.net/indexes/${this._index}`,
      json: true,
      qs: { 'api-version': '2019-05-06' },
      headers: { 'api-key': this._apiKey },
    };
    return rp.defaults(opts);
  }

  async update(record) {
    const { path, sourceHash } = record;
    if (!sourceHash) {
      const message = `Unable to update ${path}: sourceHash is empty.`;
      this.log.warn(message);
      return mapResult.error(path, message);
    }

    const base = {
      objectID: Buffer.from(`${path}`).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_'),
      modificationDate: Date.now(),
    };
    const object = { ...base, ...record };

    // Delete a stale copy at another location
    let oldLocation;
    const hit = await this._search({ branch: this._branch, sourceHash });
    if (hit && hit.path !== path) {
      this.log.info(`Deleting index record for resource moved from: ${hit.path}`);
      oldLocation = hit.path;
      await this._deleteObject(hit.objectID);
    }

    // Add record to index
    const result = await this._updateObject(object);
    this.log.info(`Merged record in '${this._index}' for resource at: ${path}`);

    return oldLocation
      ? mapResult.moved(path, oldLocation, result)
      : mapResult.created(path, result);
  }

  async delete(attributes) {
    const hit = await this._search({ branch: this._branch, ...attributes });
    if (hit) {
      this.log.info(`Deleting index record for resource at: ${hit.path}`);
      await this._deleteObject(hit.objectID);
      return mapResult.notFound({ path: hit.path }, true);
    }
    return mapResult.notFound(attributes, false);
  }

  async _search(attributes) {
    const $filter = Object.getOwnPropertyNames(attributes)
      .filter(
        (name) => attributes[name],
      )
      .map(
        (name) => `${name} eq '${attributes[name]}'`,
      )
      .join(' and ');
    const $select = ['path', 'objectID', 'sourceHash'].join(',');
    const client = await this._getClient();
    const result = await client.get('/docs', { qs: { search: '', $filter, $select } });
    if (result.value.length > 0) {
      return result.value[0];
    }
    return null;
  }

  async _updateObject(object) {
    const body = {
      value: [
        {
          '@search.action': 'mergeOrUpload',
          ...object,
        },
      ],
    };
    const client = await this._getClient();
    const result = await client.post('/docs/index', {
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return result;
  }

  async _deleteObject(objectID) {
    const body = {
      value: [
        {
          '@search.action': 'delete',
          objectID,
        },
      ],
    };
    const client = await this._getClient();
    const result = await client.post('/docs/index', {
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return result;
  }

  get log() {
    return this._log;
  }
}

module.exports = {
  name: 'Azure',
  required: ['AZURE_SEARCH_API_KEY', 'AZURE_SEARCH_SERVICE_NAME'],
  match: (url) => url === 'azure',
  create: (params, config, log) => new Azure(params, config, log),
};
