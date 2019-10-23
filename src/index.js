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

function makeparents(filename = '') {
  const parent = p.dirname(filename[0] === '/' ? filename : `/${filename}`);
  if (parent === '/' || parent === '.' || !parent) {
    return ['/'];
  }
  return [...makeparents(parent), parent];
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
  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
  const indexname = `${owner}--${repo}`;
  const index = algolia.initIndex(indexname);

  if (!paths) {
    // eslint-disable-next-line no-param-reassign
    paths = [path];
  }

  // eslint-disable-next-line no-shadow
  const searchresults = await Promise.all(paths.map((path) => {
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

    const url = `https://adobeioruntime.net/api/v1/web/trieloff/github-com--trieloff--helix-index-pipelines--azure-images-dirty/${type}_json?owner=${owner}&repo=${repo}&ref=${ref}&path=${path}`;

    try {
      const response = await request({
        url,
        json: true,
      });

      const fragments = response.docs
        .map((fragment) => ({ ...doc, ...fragment }))
        .map((fragment) => {
          fragment.objectID = `${fragment.objectID}#${fragment.fragmentID}`;
          delete fragment.fragmentID;
          return fragment;
        });
      // index all fragments
      docs.push(...fragments);

      // index the base document, too
      const { meta } = response;
      Object.assign(doc, meta);
      docs.push(doc);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`Unable to load full metadata for ${url}`, e);
      return {
        statusCode: 500,
        body: {
          path,
          reason: `Unable to load full metadata for ${url}`,
        },
      };
    }

    await index.setSettings({
      attributesForFaceting: ['filterOnly(sha)', 'filterOnly(path)', 'type', 'parents', 'branch'],
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
