# Changelog

## Unreleased

- The package no longer installs an 'aloma' command; that name belongs to the ALOMA CLI (@aloma.io/aloma). Use npx @aloma.io/integration-sdk or the path build/cli.mjs.

## 3.8.71

- **BREAKING:** POST and PATCH requests are no longer retried by default after a 5xx, a timeout or a network error. Set `retryUnsafe: true` on a request to retry it.
- **BREAKING:** 4xx responses other than 408 and 429 are returned as errors on the first attempt (before, only 400 and 422 were; others were retried). The OAuth client still retries a 401 with a refreshed token.
- Retries count 429 responses against the retry limit (before, 429 was retried without limit) and wait for the `Retry-After` header when present, at most 60 seconds.
- **BREAKING:** a successful response whose body is not valid JSON now throws a `ResponseParseError` (an `Error` with `status` and the first 200 characters of the body) instead of a string with the whole body.
- **BREAKING:** the periodic OAuth token refresh now runs every 4 hours by default (before, 60 hours) and refreshes every client the connector created (before, only the first). `noPeriodicTokenRefresh: true` turns it off; before, the flag worked the other way round (`false` turned it off). A `tokenRefreshPeriod` set by the connector is unchanged.
- A failed token refresh reports the HTTP status and the OAuth error code only; the response body is no longer included in the error or the log. A 4xx from the token endpoint is not retried.
- Concurrent callers share a single OAuth refresh at a time; a token stored by another caller during a failed refresh is kept.
- Connector configuration decryption accepts only RSA-OAEP-256 with A256GCM.
- The package ships only build output, the connector template and the README.
