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
const OpenWhiskError = require('openwhisk/lib/openwhisk_error');

const AlgoliaIndex = require('./AlgoliaIndex.js');
const OneDrive = require('./OneDrive.js');
const AzureIndex = require('./AzureIndex.js');

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

  let entry;
  if (await fse.pathExists(indexedJSON)) {
    const doc = JSON.parse(await fse.readFile(indexedJSON, 'utf8'));
    entry = { docs: [doc] };
  } else {
    entry = { error: { status: 404, reason: `File not found: ${indexedJSON}` } };
  }
  return {
    response: {
      result: {
        body: {
          algolia: entry,
          excel: entry,
          azure: entry,
        },
        statusCode: 200,
      },
    },
  };
};

/**
 * Index pipeline stub.
 */
let indexPipelineStub = fsIndexPipeline;

/**
 * Azure index
 */
let azureIndex;

/**
 * Proxy our real OW action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const { main } = proxyquire('../src/index.js', {
  './fetch-query.js': proxyquire('../src/fetch-query.js', {
    '@adobe/helix-fetch': {
      fetch: fsFetch,
    },
  }),
  './index-pipelines.js': proxyquire('../src/index-pipelines.js', {
    openwhisk: () => ({
      actions: {
        invoke: indexPipelineStub,
      },
    }),
  }),
  './providers/algolia.js': proxyquire('../src/providers/algolia.js', {
    algoliasearch: () => ({
      initIndex: (name) => new AlgoliaIndex(name),
    }),
  }),
  './providers/excel.js': proxyquire('../src/providers/excel.js', {
    '@adobe/helix-onedrive-support': {
      OneDrive,
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
  describe('Argument checking', () => {
    // Invoke our action with missing combinations of parameters
    const paramsKV = [
      ['owner', 'foo'],
      ['repo', 'bar'],
      ['ref', 'master'],
      ['path', 'test.html'],
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
        /branch parameter missing and ref looks like a commit id/);
    });
  });

  describe('Run tests against Algolia', () => {
    const dir = p.resolve(SPEC_ROOT);
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        it(`Testing ${name} against Algolia`, async () => {
          const params = {
            ALGOLIA_APP_ID: 'foo',
            ALGOLIA_API_KEY: 'bar',
            ...input,
          };
          const response = await main(params);
          assert.deepEqual(response.body.results[0].algolia, output);
        }).timeout(60000);
      }
    });
  });

  describe('Run tests against Excel', () => {
    const dir = p.resolve(SPEC_ROOT);
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        it(`Testing ${name} for Excel`, async () => {
          const params = {
            AZURE_WORD2MD_CLIENT_ID: 'foo',
            AZURE_HELIX_USER: 'bar',
            AZURE_HELIX_PASSWORD: 'baz',
            ...input,
          };
          const response = await main(params);
          assert.deepEqual(response.body.results[1].excel, output);
        }).timeout(60000);
      }
    });
  });

  describe('Run tests against Azure', () => {
    beforeEach(() => {
      azureIndex = new AzureIndex('azure');
    });
    const dir = p.resolve(SPEC_ROOT);
    fse.readdirSync(dir).forEach((filename) => {
      if (filename.endsWith('.json')) {
        const name = filename.substring(0, filename.length - 5);
        const { input, output } = fse.readJSONSync(p.resolve(dir, filename), 'utf8');
        it(`Testing ${name} for Azure`, async () => {
          const params = {
            AZURE_SEARCH_API_KEY: 'foo',
            AZURE_SEARCH_SERVICE_NAME: 'bar',
            ...input,
          };
          const response = await main(params);
          assert.deepEqual(response.body.results[2].azure, output);
        }).timeout(60000);
      }
    });
  });

  describe('Tests returning bogus results from index-pipelines', () => {
    afterEach(() => {
      indexPipelineStub = fsIndexPipeline;
    });
    it('Throwing 502 in index pipeline propagates the error through our action', async () => {
      indexPipelineStub = () => {
        throw new OpenWhiskError(
          'The action did not produce a valid response and exited unexpectedly.', null, 502,
        );
      };
      const { input } = fse.readJSONSync(p.resolve(SPEC_ROOT, 'added_with_path.json'), 'utf8');
      const params = {
        ALGOLIA_APP_ID: 'foo',
        ALGOLIA_API_KEY: 'bar',
        ...input,
      };
      await assert.rejects(
        async () => main(params),
        /The action did not produce a valid response and exited unexpectedly./,
      );
    });
    it('Throwing 504 in index pipeline propagates the error through our action', async () => {
      indexPipelineStub = () => {
        throw new OpenWhiskError(
          'Response Missing Error Message.', null, 504,
        );
      };
      const { input } = fse.readJSONSync(p.resolve(SPEC_ROOT, 'added_with_path.json'), 'utf8');
      const params = {
        ALGOLIA_APP_ID: 'foo',
        ALGOLIA_API_KEY: 'bar',
        ...input,
      };
      await assert.rejects(
        () => main(params),
        /Response Missing Error Message./,
      );
    });
    it('Returning an incomplete response', async () => {
      indexPipelineStub = () => ({ activationId: '148f00fd3d0d47388f00fd3d0d17385f' });
      const { input } = fse.readJSONSync(p.resolve(SPEC_ROOT, 'added_with_path.json'), 'utf8');
      const params = {
        ALGOLIA_APP_ID: 'foo',
        ALGOLIA_API_KEY: 'bar',
        ...input,
      };
      await assert.rejects(
        () => main(params),
        /TypeError: Cannot destructure property `result` of 'undefined' or 'null'/,
      );
    });
  });
});
