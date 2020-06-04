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

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const proxyquire = require('proxyquire');
const OpenWhiskError = require('openwhisk/lib/openwhisk_error');
const { createBunyanLogger } = require('@adobe/openwhisk-action-utils');

/**
 * Logger.
 */
const log = createBunyanLogger();

/**
 * Add a replacement for openwhisk in our test
 *
 * @param {Function} fn function to invoke instead
 */
const indexFile = (fn) => proxyquire('../src/index-file.js', {
  openwhisk: () => ({
    actions: {
      invoke: fn,
    },
  }),
});

describe('Index File Tests', () => {
  const params = {
    pkg: 'index',
    owner: 'me',
    repo: 'foo',
    ref: 'master',
    branch: 'master',
    __ow_logger: log,
  };
  it('returning no docs element throws', async () => {
    await assert.rejects(
      indexFile(
        () => ({ response: { result: { body: {} } } }),
      )(params, ''),
      /returned no documents/,
    );
  });
  it('throwing an OpenWhiskError 404 returns no documents', async () => {
    assert.deepEqual(
      await indexFile(
        () => { throw new OpenWhiskError('', '', 404); },
      )(params, ''),
      [],
    );
  });
  it('throwing any other OpenWhiskError throws', async () => {
    await assert.rejects(
      indexFile(
        () => { throw new OpenWhiskError('boohoo'); },
      )(params, ''),
      /boohoo/,
    );
  });
});
