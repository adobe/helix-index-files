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
const nock = require('nock');
const proxyquire = require('proxyquire');
const action = require('../src/index.js');
const AlgoliaIndex = require('./AlgoliaIndex');

/**
 * Replacement for fetch documents in our OW action. Will try to load
 * a JSON file matching the HTML page requested.
 *
 * @param {Object} parameters passed to fetch action
 */
const fetchDocuments = async ({ params: { path } }) => {
  const indexedJSON = `${path}.json`;
  const docs = [];
  let meta;

  if (await fse.pathExists(indexedJSON)) {
    docs.push(JSON.parse(await fse.readFile(indexedJSON, 'utf8')));
    meta = {};
  }
  return {
    response: {
      result: {
        body: {
          meta,
          docs,
        },
        statusCode: 200,
      },
    },
  };
};

/**
 * Proxy our real OW action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const proxyaction = (invoke = fetchDocuments) => proxyquire('../src/index.js', {
  algoliasearch: () => ({
    initIndex: (name) => new AlgoliaIndex(name),
  }),
  openwhisk: () => ({
    actions: {
      invoke,
    },
  }),
});

/**
 * Create params object for our OW action.
 *
 * @param {String} name name of HTML page to fetch
 */
const createParams = (name = 'added') => ({
  pkg: 'index-pipelines',
  owner: 'me',
  repo: 'repo',
  ref: 'master',
  branch: 'master',
  path: `test/specs/${name}.html`,
  ALGOLIA_APP_ID: 'foo',
  ALGOLIA_API_KEY: 'bar',
});

describe('Index Tests', () => {
  beforeEach(() => {
    nock('https://raw.githubusercontent.com')
      .get('/me/repo/master/helix-index.yaml')
      .replyWithFile(200, 'test/specs/helix-index.yaml');
  });

  // Invoke our action with missing combinations of parameters
  const requiredParamNames = [
    'owner', 'repo', 'ref', 'branch', 'path', 'ALGOLIA_API_KEY', 'ALGOLIA_APP_ID',
  ];
  for (let i = 0; i <= requiredParamNames.length - 1; i += 1) {
    const params = requiredParamNames.slice(0, i).reduce((acc, name) => {
      acc[`${name}`] = 'bogus';
      return acc;
    }, {});
    it(`index function bails if argument ${requiredParamNames[i]} is missing`, async () => {
      await assert.rejects(() => action.main(params), /\w+ parameter missing/);
    });
  }

  // Simulate an OW failure
  it('html_json throws', async () => {
    const response = await proxyaction(() => {
      throw new Error('html_json throws');
    }).main(createParams());
    assert.equal(response.body.results[0].status, 500);
  });

  // Simulate an error response from our html_json action
  it('html_json returns no docs element', async () => {
    const response = await proxyaction(() => ({
      response: {
        result: {
          body: {},
        },
      },
    })).main(createParams());
    assert.equal(response.body.results[0].status, 404);
  });

  it('Indexing a new item', async () => {
    const response = await proxyaction().main(createParams());
    assert.equal(response.body.results[0].status, 201);
  });

  it('Indexing a moved item', async () => {
    const response = await proxyaction().main(createParams('moved_to'));
    assert.equal(response.body.results[0].status, 201);
  });

  it('Indexing a deleted item', async () => {
    const response = await proxyaction().main(createParams('deleted'));
    assert.equal(response.body.results[0].status, 404);
  });
});
