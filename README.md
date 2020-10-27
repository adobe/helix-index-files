# Helix Index File

> Send indexable files to an IaaS (Index as a Service)

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-index-files.svg)](https://codecov.io/gh/adobe/helix-index-files)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-index-files.svg)](https://circleci.com/gh/adobe/helix-index-files)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-index-files.svg)](https://github.com/adobe/helix-index-files/blob/main/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-index-files.svg)](https://github.com/adobe/helix-index-files/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-index-files.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-index-files)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

## Usage

```bash
curl https://adobeioruntime.net/api/v1/web/helix/helix-observation/index-files@v1
```

## Development

### Deploying Helix Static

Deploying Helix Service requires the `wsk` command line client, authenticated to a namespace of your choice. For Project Helix, we use the `helix-index` namespace.

All commits to main that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get deployed as `/helix/helix-observation/index-files@ci<num>` and tagged with the CI build number.
