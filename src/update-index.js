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

const mapResult = {
  notFound: (id, gone, idName = 'path') => ({
    statusCode: gone ? 204 : 404,
    body: {
      [`${idName}`]: id,
      reason: `Item not found with ${idName}: ${id}`,
    },
  }),
  created: (path, name, update) => ({
    statusCode: 201,
    body: {
      path,
      index: name,
      update,
    },
  }),
  moved: (path, oldLocation, name, update) => ({
    statusCode: 301,
    body: {
      path,
      movedFrom: oldLocation,
      index: name,
      update,
    },
  }),
  error: (path, e) => ({
    statusCode: 500,
    body: {
      path,
      reason: `Unable to load full metadata for ${path}: ${e.message}`,
    },
  }),
};

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
  const searchresult = await index.search('', {
    attributesToRetrieve: ['path', 'name', 'objectID', 'sourceHash'],
    filters: filters.join(' AND '),
  });
  return searchresult.nbHits !== 0 ? searchresult.hits[0] : null;
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
 * Transform an item.
 *
 * @param {object} item item to transform
 * @param {object} mountpoint mountpoint definition
 * @param {object} cfg index definition
 * @param {SearchIndex} index algolia index
 * @param {string} branch branch name
 * @param {object} log logger
 */
async function prepareItem(item, mountpoint, cfg, index, branch, log) {
  const { path, sourceHash } = item;

  // try to lookup path for items that only have a source hash
  const hit = await search(index, { path, sourceHash, branch });
  if (!hit && !path) {
    // stop processing this item
    return { notFound: sourceHash };
  }
  let itempath = path || hit.path;

  // if mountpoint is given, translate path and remove leading slash(es)
  if (mountpoint) {
    const re = new RegExp(`^${mountpoint.root}/`);
    const repl = mountpoint.path.replace(/^\/+/, '');
    itempath = itempath.replace(re, repl);
  }

  // keep only items that are included in the index definition
  if (!includes(cfg, itempath)) {
    log.debug(`Item path not in index definition: ${itempath}`);
    return null;
  }

  // replace requested extension with the one in source
  return { path: `${replaceExt(itempath, cfg.source)}`, hit };
}

/**
 * Prepare items to be re-indexed.
 *
 * @param {string} branch GitHub branch
 * @param {string} cfg index configuration
 * @param {SearchIndex} index algolia index
 * @param {object} coll collection of items
 * @param {object} log logger
 *
 * @return {Array} of { path, hit, error } items
 */
async function prepareItems(branch, cfg, index, coll, log) {
  return (await Promise.all(coll.items.map(
    async (item) => prepareItem(item, coll.mountpoint, cfg, index, branch, log),
  )))
    // forget items that are filtered out by include section
    .filter((item) => item !== null);
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
async function updateIndex(params, cfg, index, coll) {
  const {
    branch, __ow_logger: log,
  } = params;

  const searchresults = await prepareItems(branch, cfg, index, coll, log);

  return Promise.all(searchresults.map(async ({ path, hit, notFound }) => {
    if (notFound) {
      return mapResult.notFound(notFound, false, 'sourceHash');
    }
    try {
      const docs = await indexFile(params, path);
      if (docs.length === 0) {
        if (hit) {
          log.debug(`Deleting index record for resource gone at: ${path}`);
          await index.deleteObject(hit.objectID);
        }
        return mapResult.notFound(path, !!hit);
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
        ? mapResult.moved(path, oldLocation, cfg.name, result)
        : mapResult.created(path, cfg.name, result);
    } catch (e) {
      return mapResult.error(path, e);
    }
  }));
}

module.exports = updateIndex;
