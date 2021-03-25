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

'use strict';

class Change {
  constructor({
    path,
    uid = null,
    type = 'modified',
    time = null,
  }) {
    this._path = path;
    this._uid = uid;
    this._type = type;
    this._time = time;
  }

  get path() {
    return this._path;
  }

  get uid() {
    return this._uid;
  }

  get deleted() {
    return this._type === 'deleted';
  }

  get time() {
    return this._time;
  }
}

module.exports = Change;
