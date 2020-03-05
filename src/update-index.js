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

const indexFile = require('./index-file.js');

const notFound = (path, gone) => ({
  statusCode: gone ? 204 : 404,
  body: {
    path,
    reason: `Item not found: ${path}`,
  },
});

const created = (path, oldLocation, name, update) => ({
  statusCode: oldLocation ? 301 : 201,
  body: {
    path,
    movedFrom: oldLocation,
    index: name,
    update,
  },
});

const error = (path, e) => ({
  statusCode: 500,
  body: {
    path,
    reason: `Unable to load full metadata for ${path}: ${e.message}`,
  },
});

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
 * Update all records in a index with the paths given.
 *
 * @param {object} params parameters
 * @param {object} name index name
 * @param {SearchIndex} index algolia index
 * @returns HTTP multi response
 */
module.exports = async (params, name, index, paths) => {
  const {
    branch, __ow_logger: log,
  } = params;
  const searchresults = await Promise.all(paths.map(async (path) => ({
    path,
    hit: await search(index, { path, branch }),
  })));

  return Promise.all(searchresults.map(async ({ path, hit }) => {
    try {
      const docs = await indexFile(params, path);
      if (docs.length === 0) {
        if (hit) {
          log.debug(`Deleting index record for resource gone at: ${path}`);
          await index.deleteObject(hit.objectID);
        }
        return notFound(path, !!hit);
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
      return created(path, oldLocation, name, await index.saveObjects(docs));
    } catch (e) {
      return error(path, e);
    }
  }));
};
