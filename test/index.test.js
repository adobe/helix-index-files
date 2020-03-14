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
const YAML = require('yaml');
const proxyquire = require('proxyquire');
const AlgoliaIndex = require('./AlgoliaIndex');

const SPEC_ROOT = p.resolve(__dirname, 'specs/params');

/**
 * Replacement for @adobe/helix-fetch in our test.
 */
const fsFetch = async (url) => {
  const path = `test/specs/${url.split('/').slice(-4).join('/')}`;
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
    owner, repo, ref, path,
  } = params;
  const indexedJSON = `test/specs/${owner}/${repo}/${ref}/${path}.json`;
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
    const requiredParamNames = [
      'owner', 'repo', 'ref', 'branch', 'ALGOLIA_API_KEY', 'ALGOLIA_APP_ID',
    ];
    for (let i = 0; i < requiredParamNames.length; i += 1) {
      const params = requiredParamNames.slice(0, i).reduce((acc, name) => {
        acc[`${name}`] = 'bogus';
        return acc;
      }, {});
      it(`index function bails if argument ${requiredParamNames[i]} is missing`, async () => {
        await assert.rejects(() => main(params), /\w+ parameter missing/);
      });
    }
  });

  describe('Setup in test/specs/params', () => {
    fse.readdirSync(SPEC_ROOT).forEach((filename) => {
      const source = fse.readFileSync(p.resolve(SPEC_ROOT, filename), 'utf8');
      const json = YAML.parseDocument(source, {
        merge: true,
        schema: 'core',
      }).toJSON();
      it(`Testing ${filename}`, async () => {
        const params = { ALGOLIA_APP_ID: 'foo', ALGOLIA_API_KEY: 'bar', ...json.params };
        const response = await main(params);
        assert.deepEqual(response.body.results, json.results);
      });
    });
  });
});
