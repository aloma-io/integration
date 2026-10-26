Issue: PLAT-47

# PLAT-47: the SDK Fetcher sends `fetchOptions.params` as the query string

Run 20261026-104553, on `origin/main` 70a9898 (`@aloma.io/integration-sdk` 3.8.69). The package version is unchanged.

## Status: the fix is written and verified in the box but NOT committed (gate blocker)

The box's commit gate refused the code commit:

    tdd  fail  no test command is configured for this project in the harness (config/tdd.json),
               so a code change cannot be accepted

The gate's test command (`AEH_TDD`) is set from the Mac only; the box cannot change it.

- **Committed on this branch:** this FINDINGS file only. The gate's test-first check needs no test command for a
  docs-only commit.
- **Not committed:** `src/internal/fetcher/fetcher.mts`, `test/fetcher-query-params.test.mjs`,
  `tools/mutation-run.mjs` and the `OPENAPI_TO_CONNECTOR.md` edit. They are left in the box's working tree, and saved
  as one patch at `.aeh/runs/20261026-104553/PLAT-47-fix.patch`.
- **Why the test was not committed on its own:** the gate requires the new test in the same commit as the code
  change, so that it can see red then green.

**To land it:**

1. Configure the gate's test command for this project. For example, `cd integration-sdk && yarn build && node
   test/fetcher-query-params.test.mjs`, or the full `yarn test`. The tester also needs `integration-sdk/node_modules`
   linked (`link` in the tdd settings), because the tester runs with no network.
2. Then apply the patch (`git apply .aeh/runs/20261026-104553/PLAT-47-fix.patch`), review it and commit it as
   "PLAT-47: Fetcher sends fetchOptions.params as the query string".

Everything below describes that patch.

## The change

`src/internal/fetcher/fetcher.mts`:

- `toQuery(params)` turns `params` into a query string with `URLSearchParams`:
  - `undefined` and `null` values (and array items) are skipped;
  - numbers and booleans are stringified (`String(value)`), strings are sent as they are;
  - arrays become repeated keys (`properties=a&properties=b`);
  - a nested object (or an object inside an array) is refused with
    `params.<key> is an object; only strings, numbers, booleans and arrays of them are sent`;
  - a `params` that is not an object is refused (`params must be an object`);
  - a `URLSearchParams` instance is sent as it is. Without this, `Object.entries` of it is empty and it would be
    silently dropped, the same kind of bug as PLAT-47.
- `withQuery(url, query)` appends the query: `?` if the url has none, `&` if it already has one (nothing if it ends in
  `?` or `&`), before any `#fragment`. An empty query returns the url unchanged, so no params, `{}` or all-undefined
  params give exactly today's URL, byte for byte.
- In `fetch()`, the full URL is built after `customize` and after the `//` collapse, into a local `fullURL` only.
  `url` and `options0` are untouched, and `options0` keeps `params`. The caller's `params` object is never mutated.
  Retries go through `onError` → `fetch` → `customize` with the same `url` and `options0`, so a retry rebuilds the
  same URL with the query exactly once.
- Only the object handed to native `fetch` drops `params` (`const {params, ...init} = options0`). Headers, body,
  method, timeout, `customize`, `onResponse`, `unwrap` and the retry policy are unchanged.
- A refused `params` throws a private `ParamsError`, which the `catch` rethrows at once. Without that the error would
  be retried (500 ms each) as if it were a network error.
- **Logging:** the failed-attempt log `console.log(theURL, e)` now logs `theURL.split('?')[0]`, the URL without
  its query string. Query values may hold ids or emails. The params query is never in `theURL` (it lives only in
  `fullURL`), and a query already written into `url` is now stripped from the log too.
- **Typing:** `params?: {[key: string]: any} | URLSearchParams` is added, with JSDoc, to the typed `fetch` options, so
  hand-written connectors using `getClient()` see it. `build/internal/fetcher/fetcher.d.mts` declares it.
- **OAuth:** `OAuthFetcher` does not override `fetch()` and builds no URL of its own, so it inherits the behaviour.
  One test proves it, with the Bearer header still set. The OAuth token calls (`make-oauth.mts`, `finish-oauth.mts`)
  are separate requests and are not touched.

`OPENAPI_TO_CONNECTOR.md` (Parameter Mapping) now says the Fetcher sends `params` and how values are serialised.

`tools/mutation-run.mjs` has Fetcher mutants F01 to F12. They run `test/fetcher-query-params.test.mjs` instead of
mocha, and the runner checks that file's baseline too. `test/MUTATION.md` was **not** regenerated, because the runner
cannot run in this box (see below).

## Array form chosen, and why

**Repeated keys** (`properties=a&properties=b`).

- connector-hubspot-private-v2 and the HubSpot OpenAPI spec are not in this box (no network, and no HubSpot spec under
  `examples/`), so the connector's generated code could not be read here.
- The generator (`openapi-to-connector.mts`) copies raw values into `fetchOptions.params` and ignores `style` and
  `explode`. A generator that ignores them is implicitly assuming the OpenAPI default for query parameters, which is
  `style: form, explode: true`, i.e. repeated keys.
- The task notes that HubSpot accepts repeated keys for `properties` on CRM v3 GET endpoints, and that form is the
  stated fallback.
- **Doubt:** not checked against HubSpot's live documentation from the box. Mutant F03 (comma-joined) shows the tests
  pin the choice, so switching later is a one-line change plus test updates.

**Nested objects are refused, not JSON-encoded.** The generator emits no serialisation for objects and has no
`deepObject` or JSON intent. Sending `[object Object]` silently is the worst outcome, and guessing a JSON or
`a[b]=c` encoding would silently be wrong for some vendors. A clear error names the key instead.

## Tests (`test/fetcher-query-params.test.mjs`, standalone script)

The test uses a stubbed `globalThis.fetch`, plus one real local HTTP server on 127.0.0.1. Nothing leaves the test
process. "Today" means the unchanged 70a9898 source, built and run with the same test file.

| # | Test | Rule | Today | After |
|---|------|------|-------|-------|
| 1 | numbers, strings and booleans are stringified into the query string | 1 | FAIL (query missing) | pass |
| 2 | query parameters already in the url are kept | 1 | FAIL (`bar=2` missing) | pass |
| 3 | undefined and null values are skipped (`0` and `''` kept) | 1 | FAIL (query missing) | pass |
| 4 | arrays become repeated keys | 1 | FAIL (query missing) | pass |
| 5 | undefined and null array items are skipped, other items stringified | 1 | FAIL (query missing) | pass |
| 6 | nested objects are refused with a clear error, nothing is sent, not retried | 1 | FAIL (no error) | pass |
| 7 | objects inside arrays are refused too | 1 | FAIL (no error) | pass |
| 8 | values are encoded by URLSearchParams and a `//` inside a value is not collapsed | 1 | FAIL (query missing) | pass |
| 9 | a URLSearchParams instance is sent as it is | 1 | FAIL (query missing) | pass |
| 10 | without baseUrl the query is appended to the url as given | 1 | FAIL (query missing) | pass |
| 11 | params is not passed on to global fetch; headers, body and method unchanged | 2 | FAIL (`params` reaches fetch) | pass |
| 12 | the caller's options and params objects are not mutated | 2 | pass (guard) | pass |
| 13 | customize runs as before and can change url and params | 2 | FAIL (query missing) | pass |
| 14 | a retried request sends the same url with the query string exactly once | 2 | FAIL (query missing) | pass |
| 15 | a failed attempt logs the url without its query string (the query is still sent) | 2 | FAIL (query not sent) | pass |
| 16 | no params, `{}`, all-undefined or `undefined` params give exactly the old url | 3 | pass (guard) | pass |
| 17 | the OAuth fetcher sends the query string and its Bearer token | 2 | FAIL (query missing) | pass |
| 18 | a local HTTP server receives the query string through the real global fetch | 1 | FAIL (request line has no query) | pass |
| 19 | params is part of the typed fetch options (`fetcher.d.mts`) | typing | FAIL (not declared) | pass |

Today: 17 fail, 2 pass. After: 19/19 pass.

Tests 12 and 16 pass on today's code by design. Rule 3 says today's URL must not change, and today's code never
mutates the caller, so these two guard against regressions. Mutants F04, F05 and F10 show they bite.

A typing check, done by hand outside the repo, compiled a hand-written call with `params: {limit, properties: [...],
archived}` and with a `URLSearchParams`, and a `// @ts-expect-error` confirmed that `params: 'a=1'` is a type error.

## Mutation results

Run by hand with a driver that reads the F rows from `tools/mutation-run.mjs`. For each mutant it applies the change
to `src/`, rebuilds with tsc, runs the test file and restores the source.

| # | Mutant | Result | Killed by (failing tests) |
|---|--------|--------|---------------------------|
| F01 | params handling removed (`fullURL = theURL`) | killed | 15 tests (every query test) |
| F02 | array handling dropped | killed | arrays, array items, retry, OAuth, local server |
| F03 | arrays comma-joined instead of repeated keys | killed | arrays, array items, objects in arrays, retry, OAuth, local server |
| F04 | undefined not skipped (`=== null`) | killed | undefined/null skipped, array items, old url |
| F05 | null not skipped (`=== undefined`) | killed | undefined/null skipped, array items, old url |
| F06 | nested objects sent instead of refused | killed | nested objects refused, objects in arrays |
| F07 | refused params retried | killed | nested objects refused (timing) |
| F08 | always `?` even when the url has a query | killed | existing query kept, log test |
| F09 | `params` passed on to native fetch | killed | params not passed on, retry, OAuth |
| F10 | `delete options0.params` (the map's original approach) | killed | retry keeps the query |
| F11 | log the full URL with its query | killed | log test |
| F12 | URLSearchParams instance dropped | killed | URLSearchParams test |

**12/12 killed.** That covers the three mutants the task asks for: params handling removed (F01), array handling
dropped (F02), undefined not skipped (F04).

## Build and full suite: what could and could not be run in this box

**Doubt, for Patrick to re-run on the Mac:** this box could not install the repo's lockfile.

- `yarn install --frozen-lockfile` fails: the egress proxy answers 403 for registry.yarnpkg.com.
- The offline yarn cache lacks exact locked versions of `zod@4.6.6`, `ws@8.21.2`, `qs@6.15.2`, `body-parser@1.20.9`,
  `brace-expansion@2.1.7`, `serialize-javascript@7.0.5`, `chai@4.5.0`, `comment-parser@1.4.1` and a few
  ts-node/mocha-type dependencies.
- Installing other versions would change the dependencies, which needs Patrick's agreement, so it was not done.
- What was done: the exact locked versions that *are* in the local cache (typescript 5.2.2, @types/node 18.19.39,
  prettier, mocha's own package and others) were copied into the git-ignored `node_modules/`. Nothing was downloaded,
  `yarn.lock` and `package.json` are unchanged (lockfile sha256 checked before and after).

Results with that partial install:

- **`yarn build` (tsc):** the same three errors before and after the change, all `TS2307 Cannot find module` for the
  uninstalled `zod`, `ws` and `comment-parser`. No new error. tsc still emits `build/`.
- **`node tools/run-tests.mjs`:** 8 of 13 entries fail both before and after the change, every one with
  `Cannot find module/package` (`brace-expansion` for mocha; `ws` or `zod` for the standalone scripts). The new
  `test/fetcher-query-params.test.mjs` is the only added entry, and it passes.
- **Not run here:** the mocha suite (including `harness.test.mjs` "records the url the Fetcher really sends", which
  pins the path-only URL and should be unaffected by rule 3), the generator and scenario tests, and
  `yarn test:mutation` (M01 to M32 plus the new F rows).

Please run `yarn install --frozen-lockfile && yarn build && yarn test && yarn test:mutation` on the Mac, and commit
the regenerated `test/MUTATION.md`.

## Follow-ups (not changed in this run)

- **Generator, dotted query names:** a name such as `a.b` becomes a nested option object in the method signature,
  but the body emits `fetchOptions.params.a.b = options.a.b`. That throws at runtime when `fetchOptions.params.a` is
  undefined (`openapi-to-connector.mts`, query params loop). It should emit `fetchOptions.params['a.b'] = ...`.
- **Generator, serialisation:** it ignores `style` and `explode` and emits raw values for null, arrays and objects. The
  Fetcher now applies one fixed rule (form, explode true; objects refused). Specs that use `explode: false` (comma
  form), `deepObject` or `pipeDelimited` would need the generator to pre-serialise, or to pass a per-parameter style.
- **Generator, headers and cookies:** `in: header` and `in: cookie` parameters are dropped by the generator (from the
  map), separately from this issue.
- **Retry re-runs `customize`:** a non-idempotent `customize` (for example one that appends to `url`) is still applied
  twice on retry. That is unchanged and out of scope; the params query is safe because it never enters `url`.
- **VendorMock string matchers** compare the full URL including the query. Connector tests that now send a query
  must use a regexp or function matcher, or the exact query string.

## Rollout risks to check before release

- A connector whose `customize` already works around PLAT-47 by appending `params` to `options.url` itself (the
  workaround noted in the map) would now send every parameter twice. Patrick checked 29 active connectors and only
  connector-hubspot-private-v2 uses `params`. A grep of its `customize` for `params` or `URLSearchParams` before
  release settles it.
- A call that passes an object value in `params` used to have it silently dropped; it now fails with a clear error and
  sends nothing. This is intended (rule 1), but it is a visible behaviour change.
