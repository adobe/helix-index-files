/*
 * Copyright 2020 Adobe. All rights reserved.
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

const mm = require('micromatch');

/**
 * Return a flag indicating whether a particular path is included
 * in the indexing configuration (include element).
 *
 * @param {Array} include indexing configuration's include element
 * @param {string} path path to check
 *
 * @returns {Boolean} whether path is included in configuration
 */
module.exports = ({ include }, path) => {
  if (!include) {
    // no clause includes everything
    return true;
  }
  if (include.length === 0) {
    // empty include list includes none
    return false;
  }
  return mm.isMatch(path, include
    // expand braces in every include (creates an array of arrays)
    .map((i) => mm.braces((i)))
    // flatten to a simple array of strings
    .reduce((a, i) => {
      a.push(...i);
      return a;
    }, []));
};
