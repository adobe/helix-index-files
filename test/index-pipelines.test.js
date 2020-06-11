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
const run = (fn) => proxyquire('../src/index-pipelines.js', {
  openwhisk: () => ({
    actions: {
      invoke: fn,
    },
  }),
});

describe('Index Pipeline Tests', () => {
  const params = {
    owner: 'me',
    repo: 'foo',
    ref: 'master',
    branch: 'master',
    __ow_logger: log,
  };
  it('specifying no version runs latest', async () => {
    let actionName;
    await run(
      ({ name }) => {
        actionName = name;
        return {
          activationId: 'e56b6142faf74ee7ab6142faf76ee7a6',
          response: { result: { body: { docs: [] } } },
        };
      },
    )(params, 'test.html');
    assert.equal(actionName, 'index-pipelines/html_json@latest');
  });
  it('specifying a version runs that', async () => {
    let actionName;
    await run(
      ({ name }) => {
        actionName = name;
        return {
          activationId: 'e56b6142faf74ee7ab6142faf76ee7a6',
          response: { result: { body: { docs: [] } } },
        };
      },
    )({ version: '1.0.0', ...params }, 'test.html');
    assert.equal(actionName, 'index-pipelines/html_json@1.0.0');
  });
  it('specifying an empty version omits the version tag', async () => {
    let actionName;
    await run(
      ({ name }) => {
        actionName = name;
        return {
          activationId: 'e56b6142faf74ee7ab6142faf76ee7a6',
          response: { result: { body: { docs: [] } } },
        };
      },
    )({ version: '', ...params }, 'test.html');
    assert.equal(actionName, 'index-pipelines/html_json');
  });
  it('returning no docs element throws', async () => {
    await assert.rejects(
      () => run(
        () => ({ response: { result: { body: {} } } }),
      )(params, ''),
      /returned no documents/,
    );
  });
  it('throwing any Error throws', async () => {
    await assert.rejects(
      () => run(
        () => { throw new Error('boohoo'); },
      )(params, ''),
      /boohoo/,
    );
  });
});
