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
const index = require('../src/index.js').main;

describe('Index Tests', () => {
  it('index function bails if neccessary arguments are missing', async () => {
    try {
      await index();
      assert.fail('this should not happen');
    } catch (e) {
      if (e instanceof AssertionError) {
        throw e;
      }
      assert.ok(e);
    }
  });

  condit('index function updates index', condit.hasenvs(['ALGOLIA_API_KEY', 'ALGOLIA_APP_ID']), async () => {
    const result = await index({
      owner: 'adobe',
      repo: 'helix-home',
      ref: '954d95a1733f41d9214c18e7b6d650da9a0d47fc',
      branch: 'master',
      // eslint-disable-next-line prefer-template
      sha: 'fake' + new Date().getTime(),
      path: 'hackathons/6-sxb.md',
      ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID,
      ALGOLIA_API_KEY: process.env.ALGOLIA_API_KEY,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).timeout(10000);

  condit('HTML update index', condit.hasenvs(['ALGOLIA_API_KEY', 'ALGOLIA_APP_ID']), async () => {
    const result = await index({
      owner: 'anfibiacreativa',
      repo: 'helix-norddal',
      ref: 'master',
      branch: 'master',
      // eslint-disable-next-line prefer-template
      sha: 'fake' + new Date().getTime(),
      path: 'posts/adobe-introduces-ai-powered-personalization-and-streamlined-activation.html',
      ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID,
      ALGOLIA_API_KEY: process.env.ALGOLIA_API_KEY,
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).timeout(20000);
});
