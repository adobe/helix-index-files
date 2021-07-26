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

function retrofit(fn) {
  return async ({
    method = 'POST', params = null, env = {}, records = null,
  }) => {
    const context = {
      env, invocation: {}, runtime: { name: 'simulate' }, records,
    };

    let url = 'https://helix-service.com/publish';
    let body = null;

    if (params) {
      if (method === 'GET') {
        const searchParams = new URLSearchParams();
        Object.getOwnPropertyNames(params).forEach((k) => {
          searchParams.append(k, params[k]);
        });
        url = `${url}?${searchParams.toString()}`;
      } else {
        body = params;
      }
    }

    const req = new Request(url, {
      method,
      body,
    });

    const resp = await fn(req, context);
    return {
      statusCode: resp.status,
      body: await resp.text(),
      headers: resp.headers.plain(),
    };
  };
}

module.exports = { retrofit };
