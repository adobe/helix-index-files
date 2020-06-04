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
const fse = require('fs-extra');
const p = require('path');
const proxyquire = require('proxyquire');
const AlgoliaIndex = require('./AlgoliaIndex');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Replacement for @adobe/helix-fetch in our test.
 */
const fsFetch = async (url) => {
  const path = `test/specs/${url.split('/').slice(-1).join('/')}`;
  if (await fse.pathExists(path)) {
    return {
      ok: true,
      status: 200,
      text: async () => fse.readFile(path, 'utf8'),
    };
  }
  return {
    ok: false,
    status: 404,
  };
};

/**
 * Replacement for OW action index-pipeline in our tests.
 */
const fsIndexPipeline = async ({ params }) => {
  const {
    path,
  } = params;
  const indexedJSON = `test/specs/index-pipelines/${path}.json`;
  const docs = [];
  let meta;

  if (await fse.pathExists(indexedJSON)) {
    docs.push(JSON.parse(await fse.readFile(indexedJSON, 'utf8')));
    meta = {};
  }
  return {
    response: { result: { body: { meta, docs }, statusCode: 200 } },
  };
};

/**
 * Proxy our real OW action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const { main } = proxyquire('../src/index.js', {
  algoliasearch: () => ({
    initIndex: (name) => new AlgoliaIndex(name),
  }),
  './fetch-query.js': proxyquire('../src/fetch-query.js', {
    '@adobe/helix-fetch': {
      fetch: fsFetch,
    },
  }),
  './update-index.js': proxyquire('../src/update-index.js', {
    './index-file.js': proxyquire('../src/index-file.js', {
      openwhisk: () => ({
        actions: {
          invoke: fsIndexPipeline,
        },
      }),
    }),
  }),
});

describe('Index Tests', () => {
  describe('Argument checking', () => {
    // Invoke our action with missing combinations of parameters
    const paramsKV = [
      ['owner', 'foo'],
      ['repo', 'bar'],
      ['ref', 'master'],
      ['ALGOLIA_APP_ID', 'foo'],
      ['ALGOLIA_API_KEY', 'bar'],
    ];
    for (let i = 0; i < paramsKV.length; i += 1) {
      const params = paramsKV.slice(0, i).reduce((acc, [k, v]) => {
        acc[`${k}`] = v;
        return acc;
      }, {});
      it(`index function bails if argument ${paramsKV[i][0]} is missing`, async () => {
        await assert.rejects(async () => main(params), /\w+ parameter missing/);
      });
    }
    it('index function bails if branch is missing and ref is not usable', async () => {
      await assert.rejects(async () => main({ ref: 'dd25127aa92f65fda6a0927ed3fb00bf5dcea069' }),
        /branch parameter missing and ref not usable/);
    });
  });

  describe('Setup in test/specs', () => {
    fse.readdirSync(SPEC_ROOT).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(SPEC_ROOT, filename), 'utf8');
        it(`Testing ${name}`, async () => {
          const params = { ALGOLIA_APP_ID: 'foo', ALGOLIA_API_KEY: 'bar', ...input };
          const response = await main(params);
          assert.deepEqual(response.body.results, output);
        }).timeout(60000);
      }
    });
  });
});
