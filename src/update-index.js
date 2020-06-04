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
  notFound: (id, gone, name = 'path') => ({
    statusCode: gone ? 204 : 404,
    body: {
      [`${name}`]: id,
      reason: `Item ${gone ? 'gone' : 'not found'} with ${name}: ${id}`,
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
 * Update the Algolia index with the change given.
 *
 * @param {object} params parameters
 * @param {object} cfg index configuration
 * @param {SearchIndex} index algolia index
 * @param {Change} change change to process
 * @returns HTTP response
 */
async function updateIndex(params, cfg, index, change) {
  const {
    branch, __ow_logger: log,
  } = params;

  let { uid: sourceHash } = change;

  // Preprocess change, applying include and extension replacement
  let { path } = change;
  if (path) {
    if (!includes(cfg, path)) {
      return {
        statusCode: 204,
        body: { reason: `Item path not in index definition: ${path}` },
      };
    }
    path = replaceExt(path, cfg.source);
  }

  // Process a delete observation
  const hit = await search(index, { branch, path, sourceHash });
  if (change.deleted) {
    if (hit) {
      await index.deleteObject(hit.objectID);
    }
    return hit && hit.path
      ? mapResult.notFound(hit.path, true)
      : mapResult.notFound(sourceHash, !!hit, 'sourceHash');
  }

  try {
    let oldLocation;

    // Invoke our Runtime Action to get the index record for that path
    const docs = await indexFile(params, path);
    if (docs.length === 0) {
      return mapResult.notFound(path, !!hit);
    }

    // Delete a stale copy at another location
    sourceHash = docs[0].sourceHash;
    if (!hit && sourceHash) {
      const result = await search(index, { sourceHash, branch });
      if (result && result.objectID) {
        log.debug(`Deleting index record for resource moved from: ${result.path}`);
        oldLocation = result.path;
        await index.deleteObject(result.objectID);
      }
    }

    // Add record to index
    log.debug(`Adding index record for resource at: ${path}`);
    const result = await index.saveObjects(docs);

    return oldLocation
      ? mapResult.moved(path, oldLocation, cfg.name, result)
      : mapResult.created(path, cfg.name, result);
  } catch (e) {
    return mapResult.error(path, e);
  }
}

module.exports = updateIndex;
