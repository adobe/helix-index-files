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

const { wrap } = require('@adobe/helix-status');
const algoliasearch = require('algoliasearch');
const request = require('request-promise-native');
const { StatusCodeError } = require('request-promise-native/errors');
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
async function loadConfig(owner, repo, ref) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/helix-index.yaml`;
  try {
    const response = await request(url);
    return YAML.parseDocument(response).toJSON() || {};
  } catch (e) {
    // config not usable return default one
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
 * Return the Adobe I/O Runtime URL to invoke.
 *
 * @param {string} namespace
 * @param {string} package
 * @param {string} type
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} path
 */
function getRuntimeURL(namespace, package, type, owner, repo, ref, path) {
  const nsp = package ? `${namespace}/${package}` : namespace;
  return `https://adobeioruntime.net/api/v1/web/${nsp}/${type}_json@latest?owner=${owner}&repo=${repo}&ref=${ref}&path=${path}`;
}

/**
 * Find an existing entry, given its path and branch.
 *
 * @param {object} index Algolia index
 * @param {string} path Associated path of HTML document
 * @param {string} branch Branch
 */
async function searchByPath(index, path, branch) {
  const filters = `path:${path} AND branch:${branch}`;
  const searchresult = await index.search({
    attributesToRetrieve: ['path', 'name', 'objectID', 'sourceHash'],
    filters,
  });
  return searchresult.nbHits !== 0 ? searchresult.hits[0] : null;
}

/**
 * Find an existing entry, given its source hash.
 *
 * @param {object} index Algolia index
 * @param {string} sourceHash source hash
 * @param {string} branch Branch
 */
async function searchByHash(index, sourceHash, branch) {
  const filters = `sourceHash:${sourceHash} AND branch:${branch}`;
  const searchresult = await index.search({
    attributesToRetrieve: ['path', 'name', 'objectID', 'sourceHash'],
    filters,
  });
  return searchresult.nbHits !== 0 ? searchresult.hits[0] : null;
}

/**
 * Fetch documents that will be added to our index.
 */
async function fetchDocuments(url, type, path, branch) {
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
    const response = await request({
      url,
      json: true,
    });

    const fragments = response.docs
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
    const { meta } = response;
    if (meta) {
      Object.assign(doc, meta);
      docs.push(doc);
    }
    return docs;
  } catch (e) {
    if (e instanceof StatusCodeError && e.statusCode === 404) {
      // item not found
      return null;
    }
    throw e;
  }
}

async function main({
  namespace, package, owner, repo, ref, branch, path, paths, ALGOLIA_APP_ID, ALGOLIA_API_KEY,
}) {
  if (!(owner && repo && ref && branch && (path || paths) && ALGOLIA_API_KEY && ALGOLIA_APP_ID)) {
    console.error('Missing parameters', owner, repo, ref, branch, path, paths, !!ALGOLIA_APP_ID, !!ALGOLIA_API_KEY);
    throw new Error('Missing required parameters');
  }

  // eslint-disable-next-line no-underscore-dangle
  const [, owNamespace, owPackage] = process.env.__OW_ACTION_NAME.split('/');

  const config = await loadConfig(owner, repo, ref);

  /* Use the first index definition to setup our index */
  const indexname = Object.keys(config.indices)[0];
  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
  const index = algolia.initIndex(`${owner}--${repo}--${indexname}`);

  if (!paths) {
    // eslint-disable-next-line no-param-reassign
    paths = [path];
  }

  // eslint-disable-next-line no-shadow
  const searchresults = await Promise.all(paths.map(async (path) => ({
    path,
    hit: await searchByPath(index, path, branch),
  })));

  // eslint-disable-next-line no-shadow
  const responses = await Promise.all(searchresults.map(async ({ path, hit }) => {
    const type = p.extname(path).replace(/\./g, '');
    const url = getRuntimeURL(namespace || owNamespace, package || owPackage,
      type, owner, repo, ref, path);
    let docs;

    try {
      docs = await fetchDocuments(url, type, path, branch);
      if (!docs || docs.length === 0) {
        // Indexed page no longer exists
        if (hit) {
          await index.deleteObject(hit.objectID);
        }
        return {
          statusCode: 404,
          body: {
            path,
            reason: `Item not found: ${url}`,
          },
        };
      }
      const { sourceHash } = docs[0];
      if (sourceHash && !hit) {
        // We did not find the item at the expected location, make sure
        // it does not appear elsewhere (could be a move)
        const result = await searchByHash(index, sourceHash, branch);
        if (result && result.objectID) {
          await index.deleteObject(result.objectID);
        }
      }
      const update = await index.saveObjects(docs);
      return {
        statusCode: 201,
        body: {
          path,
          index: indexname,
          update,
        },
      };
    } catch (e) {
      console.log(`Unable to load full metadata for ${url}: ${e.toString()}`);
      return {
        statusCode: 500,
        body: {
          path,
          reason: `Unable to load full metadata for ${url}`,
        },
      };
    }
  }));

  const results = responses.map((response) => ({
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

module.exports = { main: wrap(main) };
