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
 * @param {string} type
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} path
 */
function getRuntimeURL(type, owner, repo, ref, path) {
  const namespace = 'helix-pages';
  const package = 'github-com--trieloff--helix-index-pipelines--master-dirty';
  return `https://adobeioruntime.net/api/v1/web/${namespace}/${package}/${type}_json?owner=${owner}&repo=${repo}&ref=${ref}&path=${path}`;
}

/**
 * This is the main function
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main({
  owner, repo, ref, branch, path, paths, token, sha, ALGOLIA_APP_ID, ALGOLIA_API_KEY,
}) {
  if (!(owner && repo && ref && branch && (path || paths) && sha
    && ALGOLIA_API_KEY && ALGOLIA_APP_ID)) {
    console.error('Missing parameters', owner, repo, ref, branch, path, paths, token, sha, !!ALGOLIA_APP_ID, !!ALGOLIA_API_KEY);
    throw new Error('Missing required parameters');
  }

  const config = await loadConfig(owner, repo, ref);

  /* Use the first index definition to setup our index */
  const indexname = Object.keys(config.indices)[0];
  const indexconfig = config.indices[indexname];

  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
  const index = algolia.initIndex(`${owner}--${repo}--${indexname}`);

  if (!paths) {
    // eslint-disable-next-line no-param-reassign
    paths = [path];
  }

  // eslint-disable-next-line no-shadow
  const searchresults = await Promise.all(paths.map((path) => {
    if (sha === 'initial') {
      return {
        nbHits: 0,
      };
    }
    const filters = `sha:${sha} AND path:${path} AND branch:${branch}`;
    const searchresult = index.search({
      attributesToRetrieve: ['path', 'name'],
      filters,
    });
    return searchresult;
  }));

  const responses = await Promise.all(searchresults.map(async (searchresult) => {
    if (searchresult.nbHits) {
      // document already exists, do nothing
      return {
        statusCode: 304,
        body: {
          path,
          index: indexname,
          status: 'existing',
        },
      };
    }
    const type = p.extname(path).replace(/\./g, '');

    const docs = [];
    const doc = {
      objectID: `${branch}--${path}`,
      name: p.basename(path),
      parents: makeparents(`/${path}`),
      dir: p.dirname(path),
      path,
      sha,
      type,
      branch,
    };

    const url = getRuntimeURL(type, owner, repo, ref, path);

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
    } catch (e) {
      console.log(`Unable to load full metadata for ${url}`, e);
      return {
        statusCode: 500,
        body: {
          path,
          reason: `Unable to load full metadata for ${url}`,
        },
      };
    }

    const customAttributes = Object.keys(indexconfig.properties)
      .filter((name) => indexconfig.properties[name].faceted);
    await index.setSettings({
      attributesForFacetting: [
        'filterOnly(sha)', 'filterOnly(path)', 'type', 'parents', 'branch',
        ...customAttributes,
      ],
    });

    const update = await index.saveObjects(docs);

    return {
      statusCode: 201,
      body: {
        path,
        index: indexname,
        update,
      },
    };
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
