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

const { logger } = require('@adobe/helix-universal-logger');
const { requiredConfig } = require('@adobe/helix-shared-config');
const bodyData = require('@adobe/helix-shared-body-data');
const wrap = require('@adobe/helix-shared-wrap');
const { wrap: helixStatus } = require('@adobe/helix-status');
const { Response } = require('@adobe/helix-fetch');

const Change = require('./Change.js');
const indexPipelines = require('./index-pipelines.js').run;

const excel = require('./excel.js');
const mapResult = require('./mapResult.js');
const recordsWrap = require('./records-wrapper.js');
const { getFetchURL, isOutdated } = require('./utils.js');

/**
 * List of known index providers.
 */
const providers = [
  excel,
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
 * Handle status of an item for an index handlers.
 *
 * @param {object} param0 parameters
 * @param {Change} change change containing deletion
 * @param {object} log logger
 */
async function handleStatus({ config, handler }, change, log) {
  if (!handler) {
    return {
      status: 400,
      message: 'Handler not available, parameters missing or target unsuitable',
    };
  }
  try {
    return await handler.status({ path: change.path });
  } catch (e) {
    log.error(`An error obtaining status for ${change.path} in ${config.name}`, e);
    return {
      status: 500,
      message: e.message,
    };
  }
}

/**
 * Handle deletion of an item for an index handlers.
 *
 * @param {object} param0 parameters
 * @param {Change} change change containing deletion
 * @param {object} log logger
 */
async function handleDelete({ config, handler }, change, log) {
  if (!handler) {
    return {
      status: 400,
      message: 'Handler not available, parameters missing or target unsuitable',
    };
  }
  try {
    return await handler.delete({ sourceHash: change.uid, eventTime: change.time });
  } catch (e) {
    log.error(`An error occurred deleting record ${change.uid} in ${config.name}`, e);
    return {
      status: 500,
      message: e.message,
    };
  }
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
      message: 'Handler not available, parameters missing or target unsuitable',
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
          message: e.message,
        };
      }
    }
    return {
      status: 404,
      message: `Item path not in index definition: ${change.path}`,
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
        return mapResult.error(400, path, message);
      }
      if (isOutdated(record, headers, change)) {
        const message = `Unable to update ${path}: indexed record is outdated.`;
        log.warn(message);
        return mapResult.error(409, path, message);
      }
    }
    return record
      ? await handler.update({ path, eventTime: change.time, ...record })
      : await handler.delete({ path, eventTime: change.time, sourceHash: change.uid });
  } catch (e) {
    log.error(`An error occurred updating record ${path} in ${config.name}`, e);
    return {
      status: 500,
      message: e.message,
    };
  }
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
  const values = indices
    .map(({ config, handler }) => ({
      config,
      handler,
      url: handler && getFetchURL({
        config, owner, repo, ref, path: change.path,
      }),
    }));
  await Promise.all(values
    .filter((value) => value.url)
    .map(async (value) => {
      // eslint-disable-next-line no-param-reassign
      value.body = await indexPipelines(params, value, log);
    }));
  return values;
}

/**
 * Indexes a resource and stores the index record in a provider.
 *
 * @param {Request} req request object
 * @param {Context} context request context
 * @returns {Response} the response
 */
async function main(req, context) {
  const { env, log } = context;

  const {
    runtime: {
      region,
      accountId,
    },
  } = context;

  const {
    owner, repo, ref, '.deliveryCount': deliveryCount = 0,
  } = context.data;

  const change = getChange(context.data);
  if (!change) {
    return new Response('no change provided (neither path nor observation)', {
      status: 400,
    });
  }

  log.info(`Received change event on ${owner}/${repo}/${ref}`, change, `(delivery count: ${deliveryCount})`);

  const config = context.config.index.toJSON();
  const indices = createHandlers(Object.values(config.indices), {
    AWS_REGION: region, AWS_ACCOUNT_ID: accountId, ...env, owner, repo, ref,
  }, log);

  const method = req.method.toUpperCase();
  let responses;

  if (method === 'GET') {
    responses = await Promise.all(indices.map(
      async (index) => (
        { name: index.config.name, ...await handleStatus(index, change, log) }
      ),
    ));
  } else if (method === 'POST') {
    if (change.deleted) {
      responses = await Promise.all(indices.map(
        async (index) => (
          { name: index.config.name, ...await handleDelete(index, change, log) }
        ),
      ));
    } else {
      const records = await runPipeline(indices, change, context.data, log);
      responses = await Promise.all(records.map(
        async (record) => (
          { name: record.config.name, ...await handleUpdate(record, change, log) }
        ),
      ));
    }
  } else {
    return new Response('Method not allowed', { status: 405 });
  }
  const results = flatten(responses);
  const failure = results.find((r) => r.status >= 500);
  if (failure) {
    const e = new Error(failure.message);
    e.status = failure.status;
    e.path = failure.path;
    throw e;
  }
  return new Response(JSON.stringify(results, null, 2), {
    status: 207,
  });
}

module.exports.main = wrap(main)
  .with(requiredConfig, 'index')
  .with(bodyData)
  .with(recordsWrap)
  .with(helixStatus)
  .with(logger);
