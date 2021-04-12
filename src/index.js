/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

'use strict';

const flatten = require('lodash.flatten');
const { logger } = require('@adobe/openwhisk-action-logger');
const { wrap } = require('@adobe/openwhisk-action-utils');
const { IndexConfig } = require('@adobe/helix-shared');
const statusWrap = require('@adobe/helix-status').wrap;

const Change = require('./Change.js');
const contains = require('./contains.js');
const indexPipelines = require('./index-pipelines.js').run;

const algolia = require('./providers/algolia.js');
const azure = require('./providers/azure.js');
const excel = require('./providers/excel.js');
const mapResult = require('./providers/mapResult.js');

/**
 * List of known index providers.
 */
const providers = [
  algolia, azure, excel,
];

/**
 * Return a flag indicating whether a list of required parameters is
 * available in the list of actual parameters.
 *
 * @param {Array} required required parameters
 * @param {Array} actual provided paramaters
 */
function hasParams(required, actual) {
  const provided = required.filter((parameter) => actual[parameter] !== undefined);
  return provided.length === required.length;
}

/**
 * Create handlers along index definitions and return an array of objects
 * consisting of an index definition and its handler.
 *
 * @param {Array} configs index definitions
 * @param {object} params parameters available
 * @param {object} log logger
 *
 * @returns array of index definitions and their handlers
 */
function createHandlers(configs, params, log) {
  const configMap = configs
    .map((config) => providers
      // keep providers that have the required parameters and match the target
      .filter((provider) => hasParams(provider.required, params))
      .find((provider) => provider.match(config.target)))
    .reduce((map, provider, i) => {
      // create a map of providers with their configurations in helix-query.yaml
      const name = provider ? provider.name : '(none)';
      if (!map[name]) {
        // eslint-disable-next-line no-param-reassign
        map[name] = { provider, configs: [], indices: [] };
      }
      map[name].indices.push(i);
      map[name].configs.push(configs[i]);
      return map;
    }, {});

  const result = new Array(configs.length);
  Object.values(configMap).forEach(({ provider, configs: providerConfigs, indices }) => {
    let handlers = new Array(indices.length);
    try {
      if (provider) {
        handlers = provider.create(params, providerConfigs, log);
      }
    } catch (e) {
      log.error(`Unable to create handlers in ${provider.name}`, e);
    }
    // fill in all index definitions and their respective handler
    indices.forEach((index, i) => {
      result[index] = { config: configs[index], handler: handlers[i] };
    });
  });
  return result;
}

/**
 * Return a change object with path, uid and type
 *
 * @param {object} params Runtime parameters
 * @returns change object or null
 */
function getChange(params) {
  const addLeadingSlash = (path) => (!path.startsWith('/') ? `/${path}` : path);
  const { observation } = params;

  if (observation) {
    const { change, mountpoint } = observation;
    const opts = {
      uid: change.uid,
      path: change.path,
      time: change.time,
      type: change.type,
    };
    if (change['normalized-path']) {
      opts.path = addLeadingSlash(change['normalized-path']);
    } else if (mountpoint && opts.path) {
      const re = new RegExp(`^${mountpoint.root}/`);
      const repl = mountpoint.path.replace(/^\/+/, '');
      opts.path = addLeadingSlash(opts.path.replace(re, repl));
    }
    return new Change(opts);
  }
  if (params.path) {
    return new Change({
      path: addLeadingSlash(params.path),
      time: new Date().toISOString(),
    });
  }
  return null;
}

/**
 * Handle deletion of an item for all index handlers.
 *
 * @param {object} param0 parameters
 * @param {Change} change change containing deletion
 * @param {object} log logger
 */
async function handleDelete({ config, handler }, change, log) {
  if (!handler) {
    return {
      status: 400,
      reason: 'Handler not available, parameters missing or target unsuitable',
    };
  }
  try {
    return await handler.delete({ sourceHash: change.uid, eventTime: change.time });
  } catch (e) {
    log.error(`An error occurred deleting record ${change.uid} in ${config.name}`, e);
    return {
      status: 500,
      reason: e.message,
    };
  }
}

/**
 * Return a flag indicating whether a index record contains outdated data.
 *
 * @returns true if the record is outdated and shouldn't be used for indexing
 */
function isOutdated(record, headers, change) {
  if (!change.uid || record.sourceHash === change.uid) {
    // this is consistent
    return false;
  }
  const lastModified = headers.get('last-modified');
  if (!lastModified || !change.time) {
    // unable to determine whether there is a discrepancy without dates
    return false;
  }
  const lastModifiedMs = Date.parse(lastModified);
  if (Number.isNaN(lastModifiedMs)) {
    // last modified date is unusable
    return false;
  }
  const eventTimeMs = Date.parse(change.time);
  if (Number.isNaN(eventTimeMs)) {
    // event time is unusable
    return false;
  }
  return eventTimeMs > lastModifiedMs;
}

/**
 * Handle a single update for an index handler.
 *
 * @param {object} param0 parameters
 * @param {Change} change change
 * @param {object} log logger
 */
async function handleUpdate({
  config, handler, url, body,
}, change, log) {
  if (!handler) {
    return {
      status: 400,
      reason: 'Handler not available, parameters missing or target unsuitable',
    };
  }
  if (!url) {
    if (change.uid) {
      // This could be a move from our input domain to some region outside, so verify
      // we do not keep a record in the index for an item we no longer track
      try {
        const result = await handler.delete({ sourceHash: change.uid, eventTime: change.time });
        if (result.status !== 404) {
          // yes, the item was present in our index, so return that result
          return result;
        }
      } catch (e) {
        log.error(`An error occurred deleting record ${change.uid} in ${config.name}`, e);
        return {
          status: 500,
          reason: e.message,
        };
      }
    }
    return {
      status: 404,
      reason: `Item path not in index definition: ${change.path}`,
    };
  }
  const { error } = body;
  if (error && error.status !== 404) {
    return error;
  }
  const path = url.pathname;

  try {
    const { record, headers } = body;
    if (record) {
      if (!record.sourceHash) {
        const message = `Unable to update ${path}: sourceHash in indexed document is empty.`;
        log.warn(message);
        return mapResult.error(path, message);
      }
      if (isOutdated(record, headers, change)) {
        const message = `Unable to update ${path}: indexed record is outdated.`;
        log.warn(message);
        return mapResult.error(path, message);
      }
    }
    return record
      ? await handler.update({ path, eventTime: change.time, ...record })
      : await handler.delete({ path, eventTime: change.time, sourceHash: change.uid });
  } catch (e) {
    log.error(`An error occurred updating record ${path} in ${config.name}`, e);
    return {
      status: 500,
      reason: e.message,
    };
  }
}

/**
 * Replace an extension in a path. If the path has no extension,
 * nothing is replaced.
 *
 * @param {string} path path
 * @param {string} ext extension
 */
function replaceExt(path, ext) {
  const dot = path.lastIndexOf('.');
  if (dot > path.lastIndexOf('/')) {
    return `${path.substr(0, dot)}.${ext}`;
  }
  return path;
}

/**
 * Run indexing for all indices configured.
 *
 * @param {object} indices index configurations
 * @param {object} change change to process
 * @param {object} params parameters
 * @param {object} log OW logger
 *
 * @returns array of operation results
 */
async function runPipeline(indices, change, params, log) {
  const { owner, repo, ref } = params;

  // Create our result where we'll store the HTML responses
  const indexMap = indices
    .reduce((obj, { config, handler }) => {
      // eslint-disable-next-line no-param-reassign
      obj[config.name] = {
        config,
        handler,
        url: handler && contains(config, change.path)
          ? new URL(config.fetch
            .replace(/\{owner\}/g, owner)
            .replace(/\{repo\}/g, repo)
            .replace(/\{ref\}/g, ref)
            .replace(/\{path\}/g, replaceExt(change.path, config.source))
            .replace(/(?<!:)\/\/+/g, '/')) // remove multiple slashes not preceded by colon
          : null,
      };
      return obj;
    }, {});

  await Promise.all(Object.values(indexMap)
    .filter((value) => value.url)
    .map(async (value) => {
      // eslint-disable-next-line no-param-reassign
      value.body = await indexPipelines(params, value, log);
    }));
  return Object.values(indexMap);
}

/**
 * Runtime action.
 *
 * @param {object} params parameters
 */
async function run(params) {
  const {
    owner, repo, ref, __ow_logger: log,
  } = params;

  if (!owner || !repo || !ref) {
    return { statusCode: 400, body: 'owner/repo/ref missing' };
  }

  const change = getChange(params);
  if (!change) {
    return { statusCode: 400, body: 'path parameter missing' };
  }

  log.info(`Received change event on ${owner}/${repo}/${ref}`, change);

  const config = (await new IndexConfig()
    .withRepo(owner, repo, ref)
    .init()).toJSON();

  const indices = createHandlers(Object.values(config.indices), params, log);

  let responses;
  if (change.deleted) {
    responses = await Promise.all(indices.map(async (index) => ({
      [index.config.name]: await handleDelete(index, change, log),
    })));
  } else {
    const records = await runPipeline(indices, change, params, log);
    responses = await Promise.all(records.map(async (record) => ({
      [record.config.name]: await handleUpdate(record, change, log),
    })));
  }
  const results = flatten(responses);
  return { statusCode: 207, body: { results } };
}

/**
 * Fill a missing branch in the parameters.
 *
 * @param {function} func function to wrap
 */
function fillBranch(func) {
  return (params) => {
    if (params && params.ref && !params.branch) {
      const { ref } = params;
      if (ref.length === 40 && /^[a-f0-9]+$/.test(ref)) {
        throw new Error(`branch parameter missing and ref looks like a commit id: ${ref}`);
      } else {
        // eslint-disable-next-line no-param-reassign
        params.branch = params.ref;
      }
    }
    return func(params);
  };
}

module.exports.main = wrap(run)
  .with(logger)
  .with(statusWrap)
  .with(fillBranch);
