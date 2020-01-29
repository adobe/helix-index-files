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

/* eslint-disable no-param-reassign */
/* eslint-disable no-console */

'use strict';

const { logger } = require('@adobe/openwhisk-action-logger');
const { wrap } = require('@adobe/openwhisk-action-utils');
const statusWrap = require('@adobe/helix-status').wrap;
const algoliasearch = require('algoliasearch');
const openwhisk = require('openwhisk');
const OpenWhiskError = require('openwhisk/lib/openwhisk_error');
const request = require('request-promise-native');
const p = require('path');
const YAML = require('yaml');

function makeparents(filename = '') {
  const parent = p.dirname(filename[0] === '/' ? filename : `/${filename}`);
  if (parent === '/' || parent === '.' || !parent) {
    return ['/'];
  }
  return [...makeparents(parent), parent];
}

/**
 * Load an index configuration from a git repo.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 *
 * @returns configuration
 */
async function loadConfig(owner, repo, ref, log) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/helix-index.yaml`;
  try {
    const response = await request(url);
    return YAML.parseDocument(response).toJSON() || {};
  } catch (e) {
    log.warn(`Unable to load index configuration from ${url} (${e.message}), using default properties.`);
    return {
      indices: {
        default: {
          properties: {},
          attributesForFaceting: [
            'filterOnly(sha)', 'filterOnly(path)', 'type', 'parents', 'branch',
          ],
        },
      },
    };
  }
}

/**
 * Find an existing entry, given its path or sourceHash and branch.
 *
 * @param {object} index Algolia index
 * @param {object} attributes Attributes to search for
 * @param {string} branch Branch
 */
async function search(index, attributes) {
  const filters = Object.getOwnPropertyNames(attributes).map(
    (name) => `${name}:${attributes[name]}`,
  );
  const searchresult = await index.search({
    attributesToRetrieve: ['path', 'name', 'objectID', 'sourceHash'],
    filters: filters.join(' AND '),
  });
  return searchresult.nbHits !== 0 ? searchresult.hits[0] : null;
}

/**
 * Fetch documents that will be added to our index.
 *
 * @param {Object} ow openwhisk client
 * @param {Object} params parameters
 */
async function fetchDocuments(ow, params) {
  const {
    pkg, owner, repo, ref, branch, path, log,
  } = params;
  const type = p.extname(path).replace(/\./g, '');

  const docs = [];
  const doc = {
    objectID: `${branch}--${path}`,
    name: p.basename(path),
    parents: makeparents(`/${path}`),
    dir: p.dirname(path),
    path,
    type,
    branch,
  };

  try {
    log.debug(`Invoking ${pkg}/${type}_json@latest for path: ${path}`);
    const {
      activationId,
      response: {
        result,
      },
    } = await ow.actions.invoke({
      name: `${pkg}/${type}_json@latest`,
      blocking: true,
      params: {
        owner, repo, ref, path,
      },
    });
    if (!result.body.docs) {
      const message = `${pkg}/${type}_json@latest (activation id: ${activationId}) returned no documents`;
      throw new OpenWhiskError(message, null, result.statusCode);
    }
    const fragments = result.body.docs
      .map((fragment) => ({ ...doc, ...fragment }))
      .map((fragment) => {
        // do not add an empty # if fragmentID is not defined
        fragment.objectID = fragment.fragmentID
          ? `${fragment.objectID}#${fragment.fragmentID}`
          : fragment.objectID;
        delete fragment.fragmentID;
        return fragment;
      });
    // index all fragments
    docs.push(...fragments);

    // index the base document, too
    const { meta } = result.body;
    if (meta) {
      Object.assign(doc, meta);
      docs.push(doc);
    }
  } catch (e) {
    if (!(e instanceof OpenWhiskError && e.statusCode === 404)) {
      throw e;
    }
    log.debug(`Action ${pkg}/${type}_json@latest returned a 404 for path: ${path}`);
  }
  return docs;
}

/**
 * Runtime action.
 *
 * @param {Object} params parameters
 */
async function run(params) {
  const {
    pkg = 'index-pipelines',
    owner,
    repo,
    ref,
    branch,
    path: singlePath,
    paths: multiplePaths,
    ALGOLIA_API_KEY,
    ALGOLIA_APP_ID,
    __ow_logger: log,
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
  if (!branch) {
    throw new Error('branch parameter missing.');
  }
  if (!(singlePath || multiplePaths)) {
    throw new Error('path/paths parameter missing.');
  }
  if (!ALGOLIA_API_KEY) {
    throw new Error('ALGOLIA_API_KEY parameter missing.');
  }
  if (!ALGOLIA_APP_ID) {
    throw new Error('ALGOLIA_APP_ID parameter missing.');
  }

  const config = await loadConfig(owner, repo, ref, log);
  const ow = openwhisk();
  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);

  const paths = multiplePaths || [singlePath];

  const responses = await Promise.all(Object.keys(config.indices).map(async (name) => {
    const index = algolia.initIndex(`${owner}--${repo}--${name}`);

    const searchresults = await Promise.all(paths.map(async (path) => ({
      path,
      hit: await search(index, { path, branch }),
    })));

    return Promise.all(searchresults.map(async ({ path, hit }) => {
      try {
        const docs = await fetchDocuments(ow, {
          pkg, owner, repo, ref, branch, path, log,
        });
        if (docs.length === 0) {
          if (hit) {
            log.debug(`Deleting index record for resource gone at: ${path}`);
            await index.deleteObject(hit.objectID);
          }
          return {
            statusCode: hit ? 204 : 404,
            body: {
              path,
              reason: `Item not found: ${path}`,
            },
          };
        }
        const { sourceHash } = docs[0];
        let oldLocation;
        if (sourceHash && !hit) {
          // We did not find the item at the expected location, make sure
          // it does not appear elsewhere (could be a move)
          const result = await search(index, { sourceHash, branch });
          if (result && result.objectID) {
            log.debug(`Deleting index record for resource moved from: ${result.path}`);
            oldLocation = result.path;
            await index.deleteObject(result.objectID);
          }
        }
        log.debug(`Adding index record for resource at: ${path}`);
        return {
          statusCode: oldLocation ? 301 : 201,
          body: {
            path,
            movedFrom: oldLocation,
            index: name,
            update: await index.saveObjects(docs),
          },
        };
      } catch (e) {
        return {
          statusCode: 500,
          body: {
            path,
            reason: `Unable to load full metadata for ${path}: ${e.message}`,
          },
        };
      }
    }));
  }));

  const results = responses.reduce((acc, current) => {
    acc.push(...current);
    return acc;
  }, []).map((response) => ({
    status: response.statusCode,
    ...response.body,
  }));

  return {
    statusCode: 207,
    body: {
      results,
    },
  };
}

module.exports.main = wrap(run)
  .with(logger)
  .with(statusWrap);
