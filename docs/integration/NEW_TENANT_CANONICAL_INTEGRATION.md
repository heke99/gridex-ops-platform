# Canonical integration for a new tenant

Contract release: `2026-08-14.1`

## 1. Receive one server-side credential

Gridex provisions an Integration Pack containing a one-time `GRIDEX_API_KEY`, an opaque tenant reference, granular scopes, rate-limit profile, canonical OpenAPI URLs, readiness result and optional webhook credentials.

Store the key in a server-side secret manager. Never expose it in browser JavaScript, mobile binaries, logs or support screenshots. A client must not store or send `company_id`, Supabase IDs or internal UUIDs.

## 2. Bootstrap from integration context

Call `GET /api/v1/integration/context` with:

```http
Authorization: Bearer <GRIDEX_API_KEY>
Accept: application/json
```

The response supplies opaque tenant/API-client references, contract version, immutable and latest OpenAPI URLs, capabilities and readiness. Treat this response as the source of integration metadata.

## 3. Generate or validate the client from OpenAPI

Generate TypeScript types or another client from the immutable OpenAPI URL returned by context. Pin the immutable release in production; use `latest` only to detect an available compatible release. Public DTO versions are independent of internal database migrations.

## 4. Call public operations only

Use the documented granular scopes and opaque references. Gridex resolves tenant, client, scopes, status and quota from the API key on every request. A public reference locates a resource only inside that resolved tenant; it is never authorization by itself.

For list operations, follow `next_cursor` until `has_more` is false. Cursors are opaque, tenant/customer/resource-bound and must not be decoded or reused for another endpoint.

## 5. Make every write idempotent

Send a new high-entropy `Idempotency-Key` for each logical write. Retrying the same key with the same canonical payload replays the result. Reusing it with a different payload returns `409`. Never reuse a key across unrelated operations.

## 6. Handle failures explicitly

- `401`: missing, invalid, expired or revoked credential.
- `403`: tenant/client state or scopes do not authorize the operation.
- `404`: resource is absent in the authenticated tenant; no cross-tenant detail is exposed.
- `409`: idempotency or domain-state conflict.
- `422`: request validation failed.
- `429`: quota exceeded; respect `Retry-After` and use bounded exponential backoff with jitter.
- `503`: authentication, limiter, schema or database readiness could not be verified; retry safely and do not convert it to empty data or success.

Preserve the response `request_id` and `correlation_id` when contacting support, but redact credentials and personal data.

## 7. Verify optional webhooks

Each production subscription has its own secret reference and version. Verify the timestamp and signature over the exact received bytes, reject stale timestamps and acknowledge only after durable processing. During an announced rotation window, accept only the explicitly provisioned current/previous secrets. One tenant's secret must never verify another tenant's delivery.

## 8. Require readiness and smoke evidence

Provisioning is complete only when the canonical readiness decision is `READY` and the automated smoke receipt has passed context, public contracts, portal identity/sync and a harmless tenant-bound read using the real API client. Re-run readiness after scope, webhook, tenant-state or contract-version changes.
