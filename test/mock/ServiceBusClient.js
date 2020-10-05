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

/**
 * ServiceBusClient mock.
 */
const ServiceBusClient = (queues) => ({
  createFromConnectionString: () => ({
    createQueueClient: (name) => {
      const queue = queues[name];
      if (!queue) {
        // eslint-disable-next-line no-param-reassign
        queues[name] = [];
      }
      return {
        createSender: () => ({
          send: ({ body }) => queues[name].push(body),
          close: () => {},
        }),
        close: () => {},
      };
    },
    close: () => {},
  }),
});

module.exports = ServiceBusClient;
