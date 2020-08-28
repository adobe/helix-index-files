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

const fse = require('fs-extra');
const p = require('path');
const mapResult = require('../src/providers/mapResult');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Excel compatible index loaded from file for testing.
 */
class ExcelIndex {
  constructor(name) {
    this._file = p.resolve(SPEC_ROOT, name, 'index.json');
  }

  async _init() {
    if (!this._contents) {
      this._contents = await fse.readJSON(this._file, { encoding: 'utf-8' });
    }
  }

  async update(record) {
    await this._init();

    const { sourceHash, path } = record;

    const idx = this._contents.findIndex((item) => item.sourceHash === sourceHash);
    if (idx !== -1) {
      const oldRecord = this._contents[idx];
      this._contents[idx] = record;
      return mapResult.moved(path, oldRecord.path, this._contents.length);
    } else {
      this._contents.push(record);
      return mapResult.created(path, this._contents.length);
    }
  }

  async delete(sourceHash) {
    await this._init();

    const idx = this._contents.findIndex((item) => item.sourceHash === sourceHash);
    if (idx !== -1) {
      const result = mapResult.notFound({ path: this._contents[idx].path }, true);
      this._contents.splice(idx, 1);
      return result;
    }
    return mapResult.notFound({ sourceHash }, false);
  }

  async process(message) {
    const { body: { sourceHash, record } } = message;
    let result;

    if (record) {
      result = await this.update(record);
    } else {
      result = await this.delete(sourceHash);
    }
    this._latest = result;
    return result;
  }

  get latest() {
    return this._latest;
  }
}

module.exports = ExcelIndex;
