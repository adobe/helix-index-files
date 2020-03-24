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

const { logger } = require('@adobe/openwhisk-action-logger');
const { wrap } = require('@adobe/openwhisk-action-utils');
const statusWrap = require('@adobe/helix-status').wrap;
const algoliasearch = require('algoliasearch');

const fetchQuery = require('./fetch-query.js');
const updateIndex = require('./update-index.js');

function getAlgoliaSearch(params) {
  const {
    ALGOLIA_APP_ID: appID,
    ALGOLIA_API_KEY: apiKey,
  } = params;
  if (!appID) {
    throw new Error('ALGOLIA_APP_ID parameter missing.');
  }
  if (!apiKey) {
    throw new Error('ALGOLIA_API_KEY parameter missing.');
  }
  return algoliasearch(appID, apiKey);
}

/**
 * Return items to be indexed in a common format for paths given as
 * a string or string array or payloads in common format sent by
 * external listeners.
 *
 * @param {object} params parameters to action
 */
function getItemsCollection(params) {
  if (params.changes) {
    return {
      mountpoint: params.mountpoint,
      items: params.changes.map((c) => (
        { path: c.path, sourceHash: c.uid }
      )),
    };
  }
  const paths = params.paths || (params.path ? [params.path] : []);
  return {
    items: paths.map((p) => ({ path: p })),
  };
}

/**
 * Runtime action.
 *
 * @param {Object} params parameters
 */
async function run(params) {
  const {
    owner, repo, ref,
  } = params;

  if (!owner) {
    throw new Error('owner parameter missing.');
  }
  if (!repo) {
    throw new Error('repo parameter missing.');
  }
  if (!ref) {
    throw new Error('ref parameter missing.');
  }

  const algolia = getAlgoliaSearch(params);
  const config = await fetchQuery({ owner, repo, ref }, { timeout: 1000 });
  const coll = getItemsCollection(params);

  const responses = await Promise.all(config.indices
    .map(async (index) => {
      const algoliaIndex = algolia.initIndex(`${owner}--${repo}--${index.name}`);
      return updateIndex(params, index, algoliaIndex, coll);
    }));

  const results = responses.reduce((acc, current) => {
    // flatten array of arrays to simple array
    acc.push(...current);
    return acc;
  }, []).map((response) => ({
    status: response.statusCode,
    ...response.body,
  }));
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
      if (params.ref === 'master' || params.ref === 'preview') {
        // eslint-disable-next-line no-param-reassign
        params.branch = params.ref;
      } else {
        throw new Error(`branch parameter missing and ref not usable: ${params.ref}`);
      }
    }
    return func(params);
  };
}

module.exports.main = wrap(run)
  .with(logger)
  .with(statusWrap)
  .with(fillBranch);
