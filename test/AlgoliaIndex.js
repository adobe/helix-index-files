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

const fse = require('fs-extra');
const p = require('path');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Algolia compatible read-only index loaded from file for testing.
 */
class AlgoliaIndex {
  constructor(name) {
    this._name = name;
    this._file = p.resolve(SPEC_ROOT, 'algolia', 'index.json');
  }

  async _init() {
    if (!this._contents) {
      this._contents = JSON.parse(await fse.readFile(this._file, 'utf-8'));
    }
  }

  async search(_, { filters }) {
    await this._init();
    let path;
    let sourceHash;

    const m1 = filters.match(/path:([^ ]+)/);
    if (m1 && m1[1]) {
      [, path] = m1;
    }
    const m2 = filters.match(/sourceHash:([^ ]+)/);
    if (m2 && m2[1]) {
      [, sourceHash] = m2;
    }
    const hits = this._contents.filter(
      (item) => (path ? item.path === path : item.sourceHash === sourceHash),
    );
    return {
      nbHits: hits.length,
      hits,
    };
  }

  async deleteObject(objectID) {
    await this._init();

    const idx = this._contents.findIndex((item) => objectID === item.objectID);
    if (idx !== -1) {
      this._contents.splice(idx, 1);
    }
    return objectID;
  }

  async saveObject(doc) {
    await this._init();

    this._contents.push(doc);
    return this._contents.length;
  }

  get name() {
    return this._name;
  }
}

module.exports = AlgoliaIndex;
