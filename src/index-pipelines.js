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
const moment = require('moment');
const { JSDOM } = require('jsdom');
const jsep = require('jsep');
const fetchAPI = require('@adobe/helix-fetch');
const { Headers } = require('@adobe/helix-fetch');

const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? fetchAPI.context({ alpnProtocols: [fetchAPI.ALPN_HTTP1_1] })
  /* istanbul ignore next */
  : fetchAPI;

const helpers = {
  parseTimestamp: (elements, format) => {
    if (!elements) {
      return [];
    }
    if (!Array.isArray(elements)) {
      // eslint-disable-next-line no-param-reassign
      elements = [elements];
    }
    return elements.map((el) => {
      const content = typeof el === 'string' ? el : el.textContent;
      const millis = moment.utc(content, format).valueOf();
      return millis / 1000;
    });
  },
  attribute: (elements, name) => elements.map((el) => el.getAttribute(name)),
  textContent: (elements) => elements.map((el) => el.textContent),
  innerHTML: (elements) => elements.map((el) => el.innerHTML),
  match: (elements, re) => {
    // todo: maybe base on function ?
    const result = [];
    const regex = new RegExp(re, 'g');
    elements.forEach((el) => {
      let m;
      const content = typeof el === 'string' ? el : el.textContent;

      // eslint-disable-next-line no-cond-assign
      while ((m = regex.exec(content)) !== null) {
        result.push(m[m.length - 1]);
      }
    });
    return result;
  },
  words: (text, start, end) => {
    if (Array.isArray(text)) {
      // eslint-disable-next-line no-param-reassign
      text = text.join(' ');
    }
    return [text.split(/\s+/g).slice(start, end).join(' ')];
  },
  replace: (s, searchValue, replaceValue) => [s.replace(searchValue, replaceValue)],
};

/**
 * Fetch all HTML sources for all indices configured, ensuring that the
 * HTML source is fetched at most once.
 *
 * @param {object} url url
 * @returns response body or error
 */
async function fetchHTML(url, log) {
  log.info(`Reading HTML from: ${url}`);

  let resp;
  let body;
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent': 'index-pipelines/html_json',
      },
      cache: 'no-store',
    });
    body = await resp.text();
  } catch (e) {
    resp = {
      ok: false,
      status: 500,
    };
    body = e.message;
  }
  if (!resp.ok) {
    const message = body < 100 ? body : `${body.substr(0, 100)}...`;
    log.warn(`Fetching ${url} failed: statusCode: ${resp.status}, message: '${message}'`);
    return { error: { path: url.pathname, status: resp.status, reason: message } };
  }
  const s = body.trim();
  if (s.substring(s.length - 7).toLowerCase() !== '</html>') {
    log.warn(`Document returned from ${url} seems incomplete (html end tag not found)`);
    return { error: { path: url.pathname, status: 500, reason: 'document incomplete' } };
  }
  return { body, headers: new Headers(resp.headers) };
}

function evaluate(expression, context) {
  const { log } = context;
  const vars = {
    ...context,
    ...helpers,
  };

  function evalNode(node) {
    switch (node.type) {
      case 'CallExpression': {
        const args = node.arguments.map(evalNode);
        const fn = evalNode(node.callee);
        if (typeof fn === 'function') {
          return fn(...args);
        } else {
          log.warn('evaluate function not supported: ', node.callee.name);
        }
        return undefined;
      }
      case 'MemberExpression': {
        const obj = vars[node.object.name];
        if (obj) {
          return obj.get(node.property.value);
        }
        return undefined;
      }
      case 'Identifier': {
        return vars[node.name];
      }
      case 'Literal': {
        return node.value;
      }
      default: {
        log.warn('evaluate type not supported: ', node.type);
      }
    }
    return null;
  }

  const tree = jsep(expression);
  return evalNode(tree);
}

/**
 * Return a value in the DOM by evaluating an expression
 *
 * @param {Array.<HTMLElement>} elements
 * @param {string} expression
 * @param {Logger} log
 * @param {object} vars
 */
function getDOMValue(elements, expression, log, vars) {
  return evaluate(expression, {
    el: elements,
    log,
    ...vars,
  });
}

/**
 * Given a HTML document, extract a value and evaluate an expression
 * on it. The index contains the CSS selector that will select the
 * value(s) to process. If we get multiple values, we return an
 * array.
 *
 * @param {Document} document
 * @param {Object} headers
 * @param {Object} index
 * @param {Logger} log
 */
function indexHTML(path, document, headers, index, log) {
  const record = { };

  /* Walk through all index properties */
  Object.keys(index.properties).forEach((name) => {
    const { select, ...prop } = index.properties[name];
    const expression = prop.value || prop.values;
    // create an array of elements
    const elements = select !== 'none' ? Array.from(document.querySelectorAll(select)) : [];
    let value = getDOMValue(elements, expression, log, { path, headers }) || [];
    // concat for single value
    if (prop.value) {
      if (Array.isArray(value)) {
        value = value.length === 1 ? value[0] : value.join('');
      }
    }
    record[name] = value;
  });
  return record;
}

function evaluateHtml(body, headers, path, index, log) {
  const { document } = new JSDOM(body).window;
  return indexHTML(path, document, headers, index, log);
}

async function run(params, config, log) {
  const result = await fetchHTML(config.url.href, log);
  if (result.error) {
    return result;
  }
  const { body, headers } = result;
  return { record: evaluateHtml(body, headers, config.url.pathname, config.config, log), headers };
}

module.exports.run = run;
