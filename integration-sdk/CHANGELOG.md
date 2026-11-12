# Changelog

## 4.0.0

- **BREAKING:** Node 22 or later is required.
- **BREAKING:** The package no longer installs an 'aloma' command; that name belongs to the ALOMA CLI (@aloma.io/aloma). Use npx @aloma.io/integration-sdk or the path build/cli.mjs.

## 3.8.71

- **BREAKING:** POST and PATCH requests are no longer retried by default. Retrying them is opt-in per call.
- Retries count 429 responses and follow the `Retry-After` header.
- Retries stop on client errors.
- Concurrent callers share a single OAuth refresh at a time.
- Connector configuration decryption accepts RSA-OAEP-256 with A256GCM.
- The package ships only build output.
