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

const { OneDrive } = require('@adobe/helix-onedrive-support');

const mapResult = require('./mapResult.js');
const acquireLock = require('./acquirelock.js');

/**
 * Encodes values to be transferred to Excel.
 *
 * @param {any} value value to encode
 * @returns encoded value
 */
function encode(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (/^[+=]/.test(value)) {
      return `'${value}`;
    }
  }
  return value;
}

/**
 * Excel index provider.
 */
class Excel {
  constructor(params, config, log) {
    const opts = {
      clientId: params.AZURE_WORD2MD_CLIENT_ID,
      username: params.AZURE_HELIX_USER,
      password: params.AZURE_HELIX_PASSWORD,

      log,
    };
    this._onedrive = new OneDrive(opts);
    this._shareLink = config.target;

    // TODO: these should be configurable
    this._sheetName = config.name;
    this._tableName = 'Table1';

    this._config = config;
    this._log = log;
  }

  async _init() {
    if (this._headerNames) {
      return;
    }

    this._driveItem = await this._onedrive.getDriveItemFromShareLink(this._shareLink);
    const workbook = this._onedrive.getWorkbook(this._driveItem);
    this._worksheet = workbook.worksheet(this._sheetName);
    this._table = workbook.table(this._tableName);
    this._headerNames = await this._table.getHeaderNames();
  }

  async _search(query) {
    const entries = Object.entries(query);
    if (entries.length !== 1) {
      throw new Error(`Expected one field in query, got: ${entries.length}`);
    }
    const [name, value] = entries[0];
    if (!value) {
      throw new Error(`No value specified for field: ${name}`);
    }
    await this._init();

    const result = await this._table.getColumn(name);
    const index = result.findIndex(([columnValue]) => columnValue === value);
    if (index === -1) {
      return null;
    }

    const row = await this._table.getRow(index - 1);
    const data = this._headerNames.reduce((prev, n, i) => {
      /* eslint-disable no-param-reassign */
      prev[n] = row[i];
      return prev;
    }, {});
    return { ...data, '.metadata': { rowIndex: index - 1 } };
  }

  async update(record) {
    const { path, sourceHash } = record;
    if (!sourceHash) {
      const message = `Unable to update ${path}: sourceHash is empty.`;
      this.log.warn(message);
      return mapResult.error(path, message);
    }

    await this._init();

    const lock = await acquireLock(this._worksheet, sourceHash);
    if (lock === null) {
      return mapResult.error(path, `Unable to update record with sourceHash '${sourceHash}': it is currently locked.`);
    }

    try {
      let oldLocation;
      let rowIndex = -1;

      const hit = await this._search({ sourceHash });
      if (hit) {
        rowIndex = hit['.metadata'].rowIndex;
        oldLocation = hit.path !== path ? hit.path : null;
      }

      const values = this._headerNames.reduce((arr, name) => {
        const value = record[name];
        arr.push(encode(value));
        return arr;
      }, []);

      const result = rowIndex !== -1
        ? await this._table.replaceRow(rowIndex, values)
        : await this._table.addRow(values);

      const change = rowIndex === -1 ? 'Added new row' : `Updated row ${rowIndex}`;
      this.log.info(`${change} in '${this._sheetName}' for resource at: ${path}`);

      return oldLocation
        ? mapResult.moved(path, oldLocation, result)
        : mapResult.created(path, result);
    } finally {
      await lock.release();
    }
  }

  async delete(attributes) {
    await this._init();

    const hit = await this._search(attributes);
    if (hit) {
      this.log.info(`Deleting index record for resource at: ${hit.path}`);
      await this._table.replaceRow(hit['.metadata'].rowIndex, this._headerNames.map(() => ''));
      return mapResult.notFound({ path: hit.path }, true);
    }
    return mapResult.notFound(attributes, false);
  }

  get log() {
    return this._log;
  }
}

module.exports = {
  name: 'Excel',
  required: ['AZURE_WORD2MD_CLIENT_ID', 'AZURE_HELIX_USER', 'AZURE_HELIX_PASSWORD'],
  match: (url) => url && /^https:\/\/[^/]+\.sharepoint\.com\//.test(url),
  create: (params, config, log) => new Excel(params, config, log),
};
