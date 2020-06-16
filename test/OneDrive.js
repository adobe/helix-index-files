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

/* eslint-disable max-classes-per-file */

'use strict';

const fse = require('fs-extra');
const p = require('path');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

class Worksheet {
  constructor(contents) {
    this._contents = contents;
  }

  getNamedItem(name) {
    return this._contents.namedItems.find((item) => item.name === name);
  }

  addNamedItem(name, value) {
    return this._contents.namedItems.push({ name, value });
  }

  deleteNamedItem(name) {
    const index = this._contents.namedItems.findIndex((item) => item.name === name);
    if (index !== -1) {
      this._contents.namedItems.splice(index, 1);
    }
  }
}

class Table {
  constructor(contents) {
    this._contents = contents;
  }

  getHeaderNames() {
    return this._contents.headerNames;
  }

  addRow(values) {
    return this._contents.values.push(values);
  }

  getRow(index) {
    return this._contents.values[index];
  }

  getRows() {
    return this._contents.values;
  }

  replaceRow(index, values) {
    this._contents.values[index] = values;
    return this._contents.values.length;
  }

  getColumn(name) {
    const index = this._contents.headerNames.findIndex((n) => n === name);
    if (index === -1) {
      throw new Error(`Column name not found: ${name}`);
    }
    return [
      [this._contents.headerNames[index]],
      ...this._contents.values.map((row) => [row[index]]),
    ];
  }
}

class ExcelWorkbook {
  constructor(contents) {
    this._contents = contents;
  }

  worksheet(name) {
    const contents = this._contents.sheets.find((sheet) => sheet.name === name);
    return new Worksheet(contents);
  }

  table(name) {
    const contents = this._contents.tables.find((table) => table.name === name);
    return new Table(contents);
  }
}

class OneDrive {
  constructor(opts) {
    this._log = opts.log;
  }

  getDriveItemFromShareLink(shareLink) {
    this.log.debug(`resolving sharelink: ${shareLink}`);
    return new URL(shareLink).pathname.substring(1);
  }

  getWorkbook(driveItem) {
    this.log.debug(`getting workbook: ${driveItem}`);
    const filename = p.resolve(SPEC_ROOT, driveItem, 'workbook.json');
    const contents = fse.readJSONSync(filename, { encoding: 'utf-8' });
    return new ExcelWorkbook(contents);
  }

  get log() {
    return this._log;
  }
}

module.exports = OneDrive;
