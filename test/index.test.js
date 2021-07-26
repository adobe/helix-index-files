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

const { retrofit } = require('./utils.js');

const SPEC_ROOT = p.resolve(__dirname, 'specs');

/**
 * Message queues.
 */
const queues = [];

/**
 * Proxy our real OW action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const { main: proxyMain } = proxyquire('../src/index.js', {
  './excel.js': proxyquire('../src/excel.js', {
    '@aws-sdk/client-sqs': {
      SQSClient: class {
        // eslint-disable-next-line class-methods-use-this
        send({ input: { MessageBody, QueueUrl: name } }) {
          if (!queues[name]) {
            queues[name] = [];
          }
          queues[name].push(JSON.parse(MessageBody));
        }

        // eslint-disable-next-line class-methods-use-this
        destroy() {
          this._queue = null;
        }
      },
    },
  }),
});

describe('Index Tests', () => {
  const main = retrofit(proxyMain);
  const env = {
    AWS_REGION: 'foo',
    AWS_ACCOUNT_ID: 'bar',
    AWS_SQS_QUEUE_NAME: 'baz',
  };

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
      assert.strictEqual((await main({ env })).statusCode, 400);
      assert.strictEqual((await main({ params: { owner: 'foo' }, env })).statusCode, 400);
      assert.strictEqual((await main({ params: { owner: 'foo', repo: 'bar' }, env })).statusCode, 400);
    });

    it('index function returns 400 if path is missing', async () => {
      assert.strictEqual((await main({
        params: {
          owner: 'foo',
          repo: 'bar',
          ref: 'main',
        },
        env,
      })).statusCode, 400);
    });

    it('Indexing an incomplete document rejects with a 500', async () => {
      const params = {
        owner: 'foo',
        repo: 'bar',
        ref: 'main',
        path: '/pages/en/incomplete.html',
      };
      await assert.rejects(async () => main({ params, env }), /incomplete/);
    }).timeout(60000);

    it('Indexing a document with a gateway timeout rejects with a 504', async () => {
      const params = {
        owner: 'foo',
        repo: 'bar',
        ref: 'main',
        path: '/pages/en/gateway.html',
      };
      await assert.rejects(async () => main({ params, env }), /statusCode: 504/);
    }).timeout(60000);

    it('Indexing a document that throws an error in fetch() rejects with a 500', async () => {
      const params = {
        owner: 'foo',
        repo: 'bar',
        ref: 'main',
        path: '/pages/en/error.html',
      };
      await assert.rejects(async () => main({ params, env }), /statusCode: 500/);
    }).timeout(60000);
  });

  it('Testing status', async () => {
    const params = {
      owner: 'foo',
      repo: 'bar',
      ref: 'main',
      path: '/pages/en/brown.html',
    };
    const result = await main({
      method: 'GET',
      params,
      env,
    });
    assert.strictEqual(result.statusCode, 207);
  });

  it('Testing other method', async () => {
    const params = {
      owner: 'foo',
      repo: 'bar',
      ref: 'main',
      path: '/pages/en/brown.html',
    };
    const result = await main({
      method: 'DELETE',
      params,
      env,
    });
    assert.strictEqual(result.statusCode, 405);
  });

  before(async () => {
    nock('https://bar-foo.project-helix.page')
      .get((uri) => uri.endsWith('/error.html'))
      .replyWithError(new Error('Oops'))
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
        const metadata = `${path}.json`;
        let status = 200;
        let headers = { 'last-modified': 'Mon, 22 Feb 2021 15:28:00 GMT' };

        if (fse.existsSync(metadata)) {
          ({ status, headers } = fse.readJSONSync(metadata));
        }
        return [status, fse.readFileSync(path, 'utf-8'), headers];
      })
      .persist();
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

        it(`Testing ${name} against Excel`, async () => {
          const records = [{ body: JSON.stringify(input) }];
          await main({
            method: null,
            records,
            env: {
              AWS_REGION: 'foo',
              AWS_ACCOUNT_ID: 'bar',
              AWS_SQS_QUEUE_NAME: name,
            },
          });
          if (queue) {
            if (!input.observation && queues[name]) {
              // eslint-disable-next-line no-param-reassign
              queues[name].forEach(({ record }) => delete record.eventTime);
            }
            const result = queues[name] || [];
            assert.deepStrictEqual(result, queue);
          }
        }).timeout(60000);
      }
    });
  });
});
