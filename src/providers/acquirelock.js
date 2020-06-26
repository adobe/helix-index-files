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

async function acquireLock(worksheet, id, breakMillis = 60000) {
  const name = `N_${id.replace(/[+/=]/g, '_')}`;
  const lock = {
    acquire: async () => {
      const success = await lock.tryLock();
      if (success) {
        return lock;
      }
      const namedItem = await worksheet.getNamedItem(name);
      if (!namedItem) {
        return await lock.tryLock() ? lock : null;
      }
      const { comment } = namedItem;
      if (!comment || Date.now() - new Date(comment).getTime() >= breakMillis) {
        return await lock.breakLock() ? lock : null;
      }
      return null;
    },
    tryLock: async () => {
      try {
        await worksheet.addNamedItem(name, '$A1', new Date().toISOString());
        return true;
      } catch (e) {
        if (e.statusCode !== 409 && e.statusCode !== 429) {
          throw e;
        }
        return false;
      }
    },
    breakLock: async () => {
      try {
        await worksheet.deleteNamedItem(name);
      } catch (e) {
        if (e.statusCode === 429) {
          return null;
        }
        if (e.statusCode !== 404) {
          throw e;
        }
      }
      return lock.tryLock();
    },
    release: async () => {
      try {
        await worksheet.deleteNamedItem(name);
      } catch (e) {
        if (e.statusCode !== 404 && e.statusCode !== 429) {
          throw e;
        }
      }
    },
  };
  return lock.acquire();
}

module.exports = acquireLock;
