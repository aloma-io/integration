# Mutation check for the SDK tests that `yarn test` now runs

Result: **8/8 mutants killed** (24 Oct). Run with `yarn build && node tools/mutation-run-entry.mjs`.

Each row is one deliberate single-point bug in `src/openapi-to-connector.mts` (the OpenAPI to connector generator). The
script applies it alone, rebuilds, runs the full `yarn test`, expects a failure, and restores the file.

| # | Bug | Result |
|---|-----|--------|
| E01 | the HTTP verb is taken in lower case | killed |
| E02 | path parameter substitution is guarded by the wrong condition | killed |
| E03 | fallback method name drops the separator | killed |
| E04 | body properties are documented with the wrong required flag | killed |
| E05 | headers are dropped from the generated options type | killed |
| E06 | options is not defaulted in generated methods | killed |
| E07 | invalid specs are no longer rejected | killed |
| E08 | a property is required only if both the schema and the body say so | killed |

A first run left two survivors: E02 (nothing asserted the path parameter substitution) and a draft E03 aimed at
`disambiguateMethodName` (no test reaches it, so a different mutant on the fallback name was used). A test for E02 was
added to `test/openapi-to-connector.test.mts`; `disambiguateMethodName` remains without direct coverage.
