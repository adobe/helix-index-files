/*
 * Copyright 2021 Adobe. All rights reserved.
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

const { Request } = require('@adobe/helix-fetch');

/**
 * Wrapper that returns records passed by SQS in our request body.
 *
 * @param {UniversalFunction} func the universal function
 * @param {object} opts Options
 * @returns {UniversalFunction} an universal function with the added middleware.
 */
function records(func) {
  return async (request, context) => {
    if (context.records && context.records.length === 1) {
      const { body } = context.records[0];
      const newreq = new Request(request.url, {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      });
      return func(newreq, context);
    }
    return func(request, context);
  };
}

module.exports = records;
