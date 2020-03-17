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

const includes = require('./includes.js');
const indexFile = require('./index-file.js');

const notFound = (path, gone) => ({
  statusCode: gone ? 204 : 404,
  body: {
    path,
    reason: `Item not found: ${path}`,
  },
});

const created = (path, name, update) => ({
  statusCode: 201,
  body: {
    path,
    index: name,
    update,
  },
});

const moved = (path, oldLocation, name, update) => ({
  statusCode: 301,
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
 * @param {SearchIndex} index Algolia index
 * @param {object} attributes Attributes to search for
 */
async function search(index, attributes) {
  const filters = Object.getOwnPropertyNames(attributes)
    .filter(
      (name) => attributes[name],
    )
    .map(
      (name) => `${name}:${attributes[name]}`,
    );
  const searchresult = await index.search({
    attributesToRetrieve: ['path', 'name', 'objectID', 'sourceHash'],
    filters: filters.join(' AND '),
  });
  return searchresult.nbHits !== 0 ? searchresult.hits[0] : null;
}

/**
 * Prepare items to be re-indexed.
 *
 * @param {object} cfg index configuration
 * @param {SearchIndex} index algolia index
 * @param {object} coll collection of items
 * @param {string} branch GitHub branch
 *
 * @return {Array} of { path, hit } items
 */
async function prepareItems(cfg, index, coll, branch) {
  let searchresults = (await Promise.all(coll.items.map(
    // try to lookup path for items that only have a source hash
    async (item) => {
      const { path, sourceHash } = item;
      const hit = await search(index, { path, sourceHash, branch });
      return { path: path || (hit ? hit.path : null), hit };
    },
  ))).filter(
    // drop tems that still haven't a valid path
    ({ path }) => !!path,
  );
  const { mountpoint } = coll;
  if (mountpoint) {
    // if mountpoint is given, translate paths and remove leading slash
    const re = new RegExp(`^${mountpoint.root}/`);
    const repl = mountpoint.path.replace(/^\/+(.*)/, '$1');

    searchresults = searchresults.map(
      (item) => ({ path: item.path.replace(re, repl), hit: item.hit }),
    );
  }
  return searchresults.filter(
    // keep only items that are included in the index definition
    ({ path }) => includes(index, path),
  ).map(({ path, hit }) => {
    // replace requested extension with the one in source
    const noext = path.replace(/([^.]+)\.[^./]+$/, '$1');
    return { path: `${noext}.${cfg.source}`, hit };
  });
}

/**
 * Update all records in a index with the paths given.
 *
 * @param {object} params parameters
 * @param {object} cfg index configuration
 * @param {SearchIndex} index algolia index
 * @param {object} coll collection of items to index
 * @returns HTTP multi response
 */
module.exports = async (params, cfg, index, coll) => {
  const {
    branch, __ow_logger: log,
  } = params;

  const searchresults = await prepareItems(cfg, index, coll, branch);

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
      const result = await index.saveObjects(docs);
      return oldLocation
        ? moved(path, oldLocation, cfg.name, result)
        : created(path, cfg.name, result);
    } catch (e) {
      return error(path, e);
    }
  }));
};
