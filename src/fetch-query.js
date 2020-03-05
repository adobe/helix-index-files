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

const { fetch } = require('@adobe/helix-fetch');
const { IndexConfig } = require('@adobe/helix-shared');

/**
 * Tries to load the `helix-query.yaml` from the content repository.
 *
 * @param {object} coords repo reference coordinates
 * @param {object} opts options
 * @return {object} the index configuration
 */
module.exports = async ({ owner, repo, ref }, opts) => {
  const rootUrl = 'https://raw.githubusercontent.com/';
  const url = `${rootUrl}${owner}/${repo}/${ref}/helix-query.yaml`;

  // eslint-disable-next-line no-param-reassign
  opts.timeout = opts.timeout || 1000;

  try {
    const res = await fetch(url, opts);
    if (res.ok) {
      return await new IndexConfig()
        .withSource(await res.text())
        .init();
    }
    throw new Error(`request returned: ${res.status}`);
  } catch (e) {
    throw new Error(`Unable to load index definition: ${e.message}`);
  }
};
