# Changelog

## 3.8.71

- **BREAKING:** POST and PATCH requests are no longer retried by default. Retrying them is opt-in per call.
- Retries count 429 responses and follow the `Retry-After` header.
- Retries stop on client errors.
- Concurrent callers share a single OAuth refresh at a time.
- Connector configuration decryption accepts RSA-OAEP-256 with A256GCM.
- The package ships only build output.
