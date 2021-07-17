/*
 * Copyright 2020 Adobe. All rights reserved.
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
const { Headers } = require('@adobe/helix-fetch');
const { isOutdated } = require('../src/utils.js');

describe('Outdated tests', () => {
  it('returns false if change has no UID', () => {
    const result = isOutdated({}, {}, { uid: null });
    assert.strictEqual(result, false);
  });
  it('returns false change and indexed record have same UID', () => {
    const result = isOutdated({ sourceHash: 'x' }, {}, { uid: 'x' });
    assert.strictEqual(result, false);
  });

  it('returns false if we have no last modified header', () => {
    const result = isOutdated({ sourceHash: 'x' }, new Headers(), { uid: 'y' });
    assert.strictEqual(result, false);
  });

  it('returns false if we have no change time', () => {
    const result = isOutdated(
      { sourceHash: 'x' },
      new Headers({ 'Last-Modified': 'Mon, 22 Feb 2021 15:28:00 GMT' }),
      { uid: 'y' },
    );
    assert.strictEqual(result, false);
  });

  it('returns false if last modified is not a date', () => {
    const result = isOutdated(
      { sourceHash: 'x' },
      new Headers({ 'Last-Modified': 'not a date' }),
      { uid: 'y', time: 'Mon, 22 Feb 2021 16:28:00 GMT' },
    );
    assert.strictEqual(result, false);
  });

  it('returns false if change.time is not a date', () => {
    const result = isOutdated(
      { sourceHash: 'x' },
      new Headers({ 'Last-Modified': 'Mon, 22 Feb 2021 15:28:00 GMT' }),
      { uid: 'y', time: 'not a date' },
    );
    assert.strictEqual(result, false);
  });

  it('returns true if change.time is more recent than the document`s last modification time', () => {
    const result = isOutdated(
      { sourceHash: 'x' },
      new Headers({ 'Last-Modified': 'Mon, 22 Feb 2021 15:28:00 GMT' }),
      { uid: 'y', time: 'Mon, 22 Feb 2021 16:28:00 GMT' },
    );
    assert.strictEqual(result, true);
  });
});
