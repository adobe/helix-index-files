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
  accepted: (attributes, update) => ({
    status: 202,
    update,
    ...attributes,
  }),
  notFound: (attributes) => ({
    status: 404,
    path: attributes.path,
    message: `Item not found with path: ${attributes.path}`,
  }),
  error: (status, path, message) => ({
    status,
    path,
    message,
  }),
};

module.exports = mapResult;
