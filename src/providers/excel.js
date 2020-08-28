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

const { ServiceBusClient } = require('@azure/service-bus');

const mapResult = require('./mapResult.js');

/**
 * Excel index provider that sends records to be processed to an Azure Queue.
 */
class Excel {
  constructor(params, config, log) {
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
    this._config = config;
    this._log = log;
  }

  async _init() {
    if (this._sender) {
      return;
    }
    this._sbClient = ServiceBusClient.createFromConnectionString(this._connectionString);
    this._queueClient = this._sbClient.createQueueClient(this._queueName);
    this._sender = this._queueClient.createSender();
  }

  async update(record) {
    const { path, sourceHash } = record;
    if (!sourceHash) {
      const message = `Unable to update ${path}: sourceHash is empty.`;
      this.log.warn(message);
      return mapResult.error(path, message);
    }

    try {
      await this._init();
      await this._sender.send({
        body: { record },
      });
      return mapResult.accepted(path);
    } finally {
      await this._close();
    }
  }

  async delete(attributes) {
    const { sourceHash } = attributes;
    if (!sourceHash) {
      const message = 'Unable to delete record: sourceHash is empty.';
      this.log.warn(message);
      return mapResult.error(sourceHash, message);
    }

    try {
      await this._init();
      await this._sender.send({
        body: { sourceHash },
      });
      return mapResult.accepted(sourceHash);
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

  get log() {
    return this._log;
  }
}

module.exports = {
  name: 'Excel',
  required: ['AZURE_SERVICE_BUS_CONN_STRING', 'AZURE_SERVICE_BUS_QUEUE_NAME'],
  match: (url) => url && /^https:\/\/[^/]+\.sharepoint\.com\//.test(url),
  create: (params, config, log) => new Excel(params, config, log),
};
