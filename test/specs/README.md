# Tests for index-files OW action, against indexes that directly return a result

## `helix-query.yaml`

Contains the Helix indexing configuration.

## `algolia/*.json`

Contains the Algolia index contents. The name is formatted as `owner--repo--index-name.json`.

## `index-pipelines/*.json`

Contains the fixed output of invoking the mocked `index-pipelines/html_json` OW action. The
result of asking for the indexed contents for `ms/added.html` is e.g. in `ms/added.html.json`.

## `sync/*.json`

Contains the OW action input parameters for Algolia and Azure and the expected results.

## `excel/*.json`

Contains the OW action input parameters for Excel and the expected queue operaration.
