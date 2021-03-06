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
  const resolver = {
    createURL({ package: pkg, name, version }) {
      return new URL(`https://adobeioruntime.net/api/v1/web/helix/${pkg}/${name}@${version}`);
    },
  };
  return async (params = {}, env = {}, invocation = {}, sqs = false) => {
    const context = {
      resolver,
      env,
      // eslint-disable-next-line no-underscore-dangle
      log: params.__ow_logger,
      invocation,
      runtime: {
        name: 'simulate',
      },
    };
    let req;
    if (!sqs) {
      req = new Request('https://helix-service.com/publish', {
        method: 'POST',
        body: params,
      });
    } else {
      req = new Request('https://helix-service.com/publish');
      context.records = [{
        body: JSON.stringify(params),
      }];
    }
    const resp = await fn(req, context);
    return {
      statusCode: resp.status,
      body: await resp.text(),
      headers: resp.headers.plain(),
    };
  };
}

module.exports = { retrofit };
