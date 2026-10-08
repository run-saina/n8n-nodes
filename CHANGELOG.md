# Changelog

## 0.3.0

### Added
- Every request sends an `Idempotency-Key`: one UUIDv7 (RFC 9562) per item per execution.
- **Advanced → Idempotency Key** pins a key from upstream data (expressions supported). Pinned keys must be UUIDv7; other values stop the item before a request is made.
- **Advanced → Max Retries** (default 2): bounded automatic retries that reuse the same key and identical body, only after connection loss or timeout, a gateway response without a Saina error body, or `accounting_unavailable`, `request_in_progress`, `rate_limited`, and not-admitted `overloaded` / `inference_unavailable`. Honors `Retry-After` with exponential backoff; terminal errors are never retried.
- Typed API errors: the Saina error code, HTTP status, request ID, idempotency key, `admitted` / `state` / `retry`, and guidance (for example, buy credits at https://saina.run/console/) in the n8n error. With fallback error handling or Continue On Fail, the same fields are output under `saina.error`.
- **Advanced → Include Billing Metadata** (default on): `_saina` holds `request_id`, `idempotency_key`, `credits_charged`, `balance`, `price_version`, `replayed`, and `attempts`. Credit strings above `Number.MAX_SAFE_INTEGER` raise an error instead of being rounded; exact strings are kept in `*_raw` fields.

### Changed
- The credential's API Base URL defaults to `https://api.saina.run`; credential help explains console-issued hosted keys (shown once) and self-hosted keys.
- Templates point to the console for hosted keys and credits and explain idempotent retries. The HTTP Request template documents that requests without an idempotency key must not be retried automatically.
- Requests now read the full response (`returnFullResponse`, `ignoreHttpStatusErrors`) to access billing headers and error bodies. The `saina` result itself is unchanged.
