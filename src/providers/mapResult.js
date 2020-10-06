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

/* eslint-disable no-param-reassign */

'use strict';

const mapResult = {
  created: (path, update) => ({
    status: 201,
    path,
    update,
  }),
  accepted: (path, update) => ({
    status: 202,
    path,
    update,
  }),
  moved: (path, oldLocation, update) => ({
    status: 301,
    path,
    movedFrom: oldLocation,
    update,
  }),
  notFound: (attributes, gone) => {
    const name = 'path' in attributes ? 'path' : 'sourceHash';
    return {
      status: gone ? 204 : 404,
      [name]: attributes[name],
      reason: `Item ${gone ? 'gone' : 'not found'} with ${name}: ${attributes[name]}`,
    };
  },
  error: (path, reason) => ({
    status: 500,
    path,
    reason,
  }),
};

module.exports = mapResult;
