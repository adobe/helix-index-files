/*
 * Copyright 2021 Adobe. All rights reserved.
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

const contains = require('./contains.js');

/**
 * Return a flag indicating whether a index record contains outdated data. This
 * is true if:
 *
 * - the change UID and the HTML UID (or source hash) are different
 * - the change event time is later than the last modified of the HTML
 *
 * In that case, the change reported relates to a different and more recent
 * item, so we shouldn't add an index record for an outdated item.
 *
 * @returns true if the record is outdated and shouldn't be used for indexing
 */
function isOutdated(record, headers, change) {
  if (!change.uid || record.sourceHash === change.uid) {
    // this is consistent
    return false;
  }
  const lastModified = headers.get('last-modified');
  if (!lastModified || !change.time) {
    // unable to determine whether there is a discrepancy without dates
    return false;
  }
  const lastModifiedMs = Date.parse(lastModified);
  if (Number.isNaN(lastModifiedMs)) {
    // last modified date is unusable
    return false;
  }
  const eventTimeMs = Date.parse(change.time);
  if (Number.isNaN(eventTimeMs)) {
    // event time is unusable
    return false;
  }
  return eventTimeMs > lastModifiedMs;
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
 * Determine fetch URL.
 */
function getFetchURL({
  config, owner, repo, ref, path,
}) {
  return contains(config, path)
    ? new URL(config.fetch
      .replace(/\{owner\}/g, owner)
      .replace(/\{repo\}/g, repo)
      .replace(/\{ref\}/g, ref)
      .replace(/\{path\}/g, replaceExt(path, config.source))
      .replace(/(?<!:)\/\/+/g, '/')) // remove multiple slashes not preceded by colon
    : null;
}

module.exports = {
  getFetchURL,
  isOutdated,
};
