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

/**
 * Add a replacement for @adobe/helix-fetch in our test
 *
 * @param {Function} fn function to invoke instead
 */
const fetchQuery = (fn) => proxyquire('../src/fetch-query.js', {
  '@adobe/helix-fetch': {
    fetch: fn,
  },
});

describe('Fetch Query Tests', () => {
  const params = { owner: 'me', repo: 'foo', ref: 'bar' };
  it('returning ok=false rejects', async () => {
    await assert.rejects(
      fetchQuery(
        () => ({ ok: false, status: 404 }),
      )(params, {}),
      /request returned: 404/,
    );
  });
  it('throwing an error rejects', async () => {
    await assert.rejects(
      fetchQuery(
        () => { throw new Error('boohoo'); },
      )(params, {}),
      /boohoo/,
    );
  });
});
