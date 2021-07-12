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

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const uuid = require('uuid');

const mapResult = require('./mapResult.js');

class Excel {
  constructor(params, configs, log) {
    const {
      owner, repo,
      AWS_REGION: region,
      AWS_ACCOUNT_ID: accountId,
      AWS_SQS_QUEUE_NAME: queueName = `https://sqs.${region}.amazonaws.com/${accountId}/helix-excel-${owner}-${repo}.fifo`,
    } = params;

    this._client = new SQSClient({ region });

    this._queueName = queueName;
    this._groupId = uuid.v4();
    this._log = log;

    this._deletes = [];
    this._indices = configs.map((config) => ({
      update: async (record) => this._update(config.name, record),
      delete: async (attributes) => this._delete(attributes),
    }));
  }

  /**
   * Create a single provider and return one handler per index definition.
   *
   * @param {object} params parameters
   * @param {array} configs index configurations
   * @param {object} log logger
   * @returns array of handlers, one per index definition
   */
  static createProvider(params, configs, log) {
    const excel = new Excel(params, configs, log);
    return excel.indices;
  }

  /**
   * Update a given index. This operation is immediately sent to the queue.
   *
   * @param {string} index index name
   * @param {object} record record to add to index
   * @returns web response
   */
  async _update(index, record) {
    const { path } = record;
    await this._send({ index, record });
    return mapResult.accepted({ path }, this._queueName);
  }

  /**
   * Delete an entry given by its source hash. If we received the same amount
   * of deletes as we have index definitions, we know that it is deleted in
   * *every* index and we send *one* delete to the queue.
   *
   * @param {string} index index name
   * @param {object} record record to add to index
   * @returns web response
   */
  async _delete(attributes) {
    const { sourceHash, eventTime } = attributes;
    if (!sourceHash) {
      // we can not delete an item without source hash
      return mapResult.notFound(attributes, false);
    }
    if (!this._deletes[sourceHash]) {
      this._deletes[sourceHash] = 0;
    }
    this._deletes[sourceHash] += 1;
    if (this._deletes[sourceHash] === this._indices.length) {
      await this._send({ deleted: true, record: { sourceHash, eventTime } });
      this._deletes[sourceHash] = 0;
    }
    return mapResult.accepted({ sourceHash }, this._queueName);
  }

  /**
   * Send an operation to the queue.
   */
  async _send(op) {
    try {
      const command = new SendMessageCommand({
        MessageBody: JSON.stringify(op),
        MessageDeduplicationId: uuid.v4(),
        MessageGroupId: this._groupId,
        QueueUrl: this._queueName,
      });
      await this._client.send(command);
      this._log.info(`Sent message to queue (${this._queueName}):`, op);
    } finally {
      await this._close();
    }
  }

  async _close() {
    if (this._client) {
      this._client.destroy();

      this._client = null;
    }
  }

  get indices() {
    return this._indices;
  }
}

module.exports = {
  name: 'Excel',
  required: ['AWS_REGION', 'AWS_ACCOUNT_ID', 'AWS_SQS_QUEUE_NAME'],
  match: (url) => url && /^https:\/\/[^/]+\.sharepoint\.com\//.test(url),
  create: (params, configs, log) => Excel.createProvider(params, configs, log),
};
