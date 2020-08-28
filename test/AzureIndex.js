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
const pick = require('lodash.pick');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Azure compatible index loaded from file for testing.
 */
class AzureIndex {
  constructor(name) {
    this._file = p.resolve(SPEC_ROOT, name, 'index.json');
  }

  async _init() {
    if (!this._contents) {
      this._contents = await fse.readJSON(this._file, { encoding: 'utf-8' });
    }
  }

  defaults() {
    return this;
  }

  async get(uri, { qs: { $filter, $select } }) {
    await this._init();

    const terms = $filter.split(' and ')
      .reduce((obj, term) => {
        const [key, value] = term.split(' eq ');
        // eslint-disable-next-line no-param-reassign
        obj[key] = value.replace(/^'|'$/g, '');
        return obj;
      }, {});
    let hits = this._contents.filter(
      (item) => (terms.path ? item.path === terms.path : item.sourceHash === terms.sourceHash),
    );
    if ($select) {
      hits = hits.map((hit) => pick(hit, $select.split(',')));
    }
    return {
      value: hits,
    };
  }

  async post(uri, { body }) {
    await this._init();

    const value = body.value[0];
    if (value['@search.action'] === 'delete') {
      const idx = this._contents.findIndex((item) => item.objectID === value.objectID);
      if (idx !== -1) {
        this._contents.splice(idx, 1);
      }
      return value.objectID;
    }
    this._contents.push(value);
    return this._contents.length;
  }
}

module.exports = AzureIndex;
