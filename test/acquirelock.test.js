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

const acquireLock = require('../src/providers/acquirelock.js');
const OneDrive = require('./OneDrive.js');

describe('Lock tests', () => {
  const id = '+i/8f6rBgLRF6aM3';
  const od = new OneDrive({ log: console });

  it('lock can be obtained and released', async () => {
    const worksheet = od.getWorkbook('excel').worksheet('excel');
    const lock = await acquireLock(worksheet, id);
    assert.notEqual(lock, null);
    await lock.release();
  });
  it('lock cannot be obtained twice', async () => {
    const worksheet = od.getWorkbook('excel').worksheet('excel');
    const lock1 = await acquireLock(worksheet, id);
    assert.notEqual(lock1, null);
    const lock2 = await acquireLock(worksheet, id);
    assert.equal(lock2, null);
    await lock1.release();
  });
  it('lock can be broken after delay', async () => {
    const worksheet = od.getWorkbook('excel').worksheet('excel');
    const lock1 = await acquireLock(worksheet, id);
    assert.notEqual(lock1, null);
    const lock2 = await acquireLock(worksheet, id, -1);
    assert.notEqual(lock2, null);
    lock2.release();
  });
});
