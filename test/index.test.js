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

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const assert = require('assert');
const fse = require('fs-extra');
const nock = require('nock');
const p = require('path');
const proxyquire = require('proxyquire');

const AlgoliaIndex = require('./mock/AlgoliaIndex.js');
const AzureIndex = require('./mock/AzureIndex.js');

const { retrofit } = require('./utils.js');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Message queues.
 */
const queues = [];

/**
 * Replacement for ServiceBusClient.
 */
const ServiceBusClient = require('./mock/ServiceBusClient.js')(queues);

/**
 * Azure index
 */
let azureIndex;

/**
 * Proxy our real OW action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const { main: proxyMain } = proxyquire('../src/index.js', {
  './providers/algolia.js': proxyquire('../src/providers/algolia.js', {
    algoliasearch: () => ({
      initIndex: (name) => new AlgoliaIndex(name),
    }),
  }),
  './providers/excel.js': proxyquire('../src/providers/excel.js', {
    '@azure/service-bus': {
      ServiceBusClient,
    },
  }),
  './providers/azure.js': proxyquire('../src/providers/azure.js', {
    'request-promise-native': {
      defaults: () => azureIndex,
      get: (uri, opts) => azureIndex.get(uri, opts),
      post: (uri, opts) => azureIndex.post(uri, opts),
    },
  }),
});

describe('Index Tests', () => {
  const main = retrofit(proxyMain);

  before(async () => {
    nock('https://raw.githubusercontent.com')
      .get((uri) => uri.startsWith('/foo/bar/main'))
      .reply((uri) => {
        const path = p.resolve(SPEC_ROOT, p.basename(uri));
        if (!fse.existsSync(path)) {
          return [404, `File not found: ${path}`];
        }
        return [200, fse.readFileSync(path, 'utf-8')];
      })
      .persist();
  });

  describe('Argument checking', () => {
    it('index function returns 400 if owner/repo/ref is missing', async () => {
      assert.strictEqual((await main({})).statusCode, 400);
      assert.strictEqual((await main({
        owner: 'foo',
      })).statusCode, 400);
      assert.strictEqual((await main({
        owner: 'foo',
        repo: 'bar',
      })).statusCode, 400);
    });

    it('index function returns 400 if path is missing', async () => {
      assert.strictEqual((await main({
        owner: 'foo',
        repo: 'bar',
        ref: 'main',
      })).statusCode, 400);
    });

    it('Indexing an incomplete document gives a 500', async () => {
      const params = {
        owner: 'foo',
        repo: 'bar',
        ref: 'main',
        path: '/pages/en/incomplete.html',
      };
      const env = {
        ALGOLIA_APP_ID: 'foo',
        ALGOLIA_API_KEY: 'bar',
      };
      const res = await main(params, env);
      assert.strictEqual(res.statusCode, 500);
    }).timeout(60000);
  });

  before(async () => {
    nock('https://bar-foo.project-helix.page')
      .get((uri) => uri.startsWith('/pages'))
      .reply((uri) => {
        let path = p.resolve(SPEC_ROOT, uri.substr(1));
        const dot = path.lastIndexOf('.');
        if (dot <= path.lastIndexOf('/')) {
          path = `${path}.html`;
        }
        if (!fse.existsSync(path)) {
          return [404, `File not found: ${path}`];
        }
        return [200, fse.readFileSync(path, 'utf-8'), {
          'last-modified': 'Mon, 22 Feb 2021 15:28:00 GMT',
          server: 'nock',
        }];
      })
      .persist();
  });

  describe('Run tests against Algolia', () => {
    const dir = p.resolve(SPEC_ROOT, 'units');
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        it(`Testing ${name} against Algolia`, async () => {
          const env = {
            ALGOLIA_APP_ID: 'foo',
            ALGOLIA_API_KEY: 'bar',
          };
          const [algolia] = JSON.parse((await main(input, env)).body);
          delete algolia.name;
          assert.deepStrictEqual(algolia, output);
        }).timeout(60000);
      }
    });
  });

  describe('Run tests against Azure', () => {
    beforeEach(() => {
      azureIndex = new AzureIndex('azure');
    });
    const dir = p.resolve(SPEC_ROOT, 'units');
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        it(`Testing ${name} against Azure`, async () => {
          const env = {
            AZURE_SEARCH_API_KEY: 'foo',
            AZURE_SEARCH_SERVICE_NAME: 'bar',
          };
          const [, azure] = JSON.parse((await main(input, env)).body);
          delete azure.name;
          assert.deepStrictEqual(azure, output);
        }).timeout(60000);
      }
    });
  });

  describe('Run tests against Excel', () => {
    /**
     * Excel pushes changes into a queue, so we don't check the immediate result, but
     * the contents of the queue after processing the change.
     */
    const dir = p.resolve(SPEC_ROOT, 'units');
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, queue } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        if (queue) {
          it(`Testing ${name} against Excel`, async () => {
            const env = {
              AZURE_SERVICE_BUS_CONN_STRING: 'foo',
              AZURE_SERVICE_BUS_QUEUE_NAME: name,
            };
            await main(input, env, {}, true);
            if (!input.observation && queues[name]) {
              // eslint-disable-next-line no-param-reassign
              queues[name].forEach(({ record }) => delete record.eventTime);
            }
            const result = queues[name] || [];
            assert.deepStrictEqual(result, queue);
          }).timeout(60000);
        }
      }
    });
  });
});
