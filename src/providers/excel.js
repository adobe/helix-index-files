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

const { ServiceBusClient } = require('@azure/service-bus');

const mapResult = require('./mapResult.js');

/**
 * Excel provider that assembles all excel based indices to optimize the number of
 * messages sent to the queue. It collects all the index update and delete
 * operations for a path and packs them into one message sent to the queue.
 */
class Excel {
  constructor(params, configs, log) {
    const {
      AZURE_SERVICE_BUS_CONN_STRING: connectionString,
      AZURE_SERVICE_BUS_QUEUE_NAME: queueName,
    } = params;

    if (!connectionString) {
      throw new Error('AZURE_SERVICE_BUS_CONN_STRING parameter missing.');
    }
    if (!queueName) {
      throw new Error('AZURE_SERVICE_BUS_QUEUE_NAME parameter missing.');
    }

    this._connectionString = connectionString;
    this._queueName = queueName;
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

  async _init() {
    this._sbClient = ServiceBusClient.createFromConnectionString(this._connectionString);
    this._queueClient = this._sbClient.createQueueClient(this._queueName);
    this._sender = this._queueClient.createSender();
  }

  /**
   * Update a given index. This operation is immediately sent to the queue.
   *
   * @param {string} index index name
   * @param {object} record record to add to index
   * @returns web response
   */
  async _update(index, record) {
    const { log } = this;

    const { path, sourceHash } = record;
    if (!sourceHash) {
      const message = `Unable to update ${path}: sourceHash is empty.`;
      log.warn(message);
      return mapResult.error(path, message);
    }
    await this._send({ index, record });
    return mapResult.accepted(path);
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
    const { log } = this;

    const { sourceHash } = attributes;
    if (!sourceHash) {
      const message = 'Unable to delete record: sourceHash is empty.';
      log.warn(message);
      return mapResult.error(sourceHash, message);
    }

    if (!this._deletes[sourceHash]) {
      this._deletes[sourceHash] = 0;
    }
    this._deletes[sourceHash] += 1;
    if (this._deletes[sourceHash] === this._indices.length) {
      await this._send({ deleted: true, record: { sourceHash } });
      this._deletes[sourceHash] = 0;
    }
    return mapResult.accepted(sourceHash);
  }

  /**
   * Send an operation to the queue.
   */
  async _send(op) {
    try {
      await this._init();
      await this._sender.send({
        body: op,
      });
    } finally {
      await this._close();
    }
  }

  async _close() {
    if (this._sender) {
      await this._sender.close();
      await this._queueClient.close();
      await this._sbClient.close();

      this._sender = null;
    }
  }

  get indices() {
    return this._indices;
  }

  get log() {
    return this._log;
  }
}

module.exports = {
  name: 'Excel',
  required: ['AZURE_SERVICE_BUS_CONN_STRING', 'AZURE_SERVICE_BUS_QUEUE_NAME'],
  match: (url) => url && /^https:\/\/[^/]+\.sharepoint\.com\//.test(url),
  create: (params, configs, log) => Excel.createProvider(params, configs, log),
};
