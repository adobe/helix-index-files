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

'use strict';

const p = require('path');
const openwhisk = require('openwhisk');
const OpenWhiskError = require('openwhisk/lib/openwhisk_error');

function makeparents(filename = '') {
  const parent = p.dirname(filename[0] === '/' ? filename : `/${filename}`);
  if (parent === '/' || parent === '.' || !parent) {
    return ['/'];
  }
  return [...makeparents(parent), parent];
}

/**
 * Fetch documents that will be added to our index.
 *
 * @param {Object} params parameters
 * @param {string} path path to fetch documents for
 * @returns document array
 */
async function indexFile(params, path) {
  const {
    pkg = 'index-pipelines', owner, repo, ref, branch, __ow_logger: log,
  } = params;
  const type = p.extname(path).replace(/\./g, '');

  const docs = [];
  const doc = {
    objectID: `${branch}--${path}`,
    creationDate: new Date().getTime(),
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
    } = await openwhisk().actions.invoke({
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
      docs.push(Object.assign(doc, meta));
    }
  } catch (e) {
    if (!(e instanceof OpenWhiskError && e.statusCode === 404)) {
      throw e;
    }
    log.debug(`Action ${pkg}/${type}_json@latest returned a 404 for path: ${path}`);
  }
  return docs;
}

module.exports = indexFile;
