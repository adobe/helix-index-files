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
const { AssertionError } = require('assert');
const { condit } = require('@adobe/helix-testutils');
const { rootLogger } = require('@adobe/helix-log');
const action = require('../src/index.js');

describe('Index Tests', () => {
  rootLogger.loggers.get('default').level = process.env.LOG_LEVEL || 'info';

  it('index function bails if neccessary arguments are missing', async () => {
    try {
      assert.throws(await action.main());
    } catch (e) {
      if (e instanceof AssertionError) {
        throw e;
      }
      assert.ok(e);
    }
  });

  condit('Add item to index', condit.hasenvs(['ALGOLIA_API_KEY', 'ALGOLIA_APP_ID']), async () => {
    const result = await action.main({
      package: 'index-pipelines',
      owner: 'davidnuescheler',
      repo: 'theblog',
      ref: 'master',
      branch: 'master',
      path: 'ms/posts/adobe-named-a-leader-in-forresters-latest-enterprise-marketing-software-suites-report.html',
      ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID,
      ALGOLIA_API_KEY: process.env.ALGOLIA_API_KEY,
    });
    assert.equal(result.body.results.length, 1);
    assert.equal(result.body.results[0].status, 201);

    delete result.body.results[0].update.taskID;
    assert.deepEqual(result, {
      body: {
        results: [{
          index: 'blog-posts',
          path: 'ms/posts/adobe-named-a-leader-in-forresters-latest-enterprise-marketing-software-suites-report.html',
          status: 201,
          update: {
            objectIDs: [
              'master--ms/posts/adobe-named-a-leader-in-forresters-latest-enterprise-marketing-software-suites-report.html',
            ],
          },
        }],
      },
      statusCode: 207,
    });
  }).timeout(20000);
});
