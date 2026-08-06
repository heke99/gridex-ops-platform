# Integrations and synchronization

## Integration map

| Integration | Internal truth | Sync risks | Current evidence/status |
|---|---|---|---|
| Tenant website API | immutable offer/price/legal/quote/application records | contract version, quote hash, retries, tenant mapping | Quote timestamp defect confirmed; external tenant E2E unavailable. |
| Customer portal API | customer/contract/site/document/notification records | multi-resource sync, partial writes, error mapping | Routes/artifacts present; client and live two-tenant E2E unavailable. |
| EDIEL/actor registry | actor, route, certificate, job and message tables | certificate freshness, imports, conflicts, duplicate jobs | Platform-global read isolation remediated in dev/main; fingerprint write error confirmed. |
| Market/portfolio prices | versioned intervals/previews/references | source freshness, fallback, units, stale publication | Source/database paths present; external freshness and production values not verified. |
| Email/Resend/SMTP/IMAP | outbox/run/event records | retries, duplicate mail, PII logs, provider failure | High run volumes visible; provider E2E unavailable. |
| Webhooks | request/event/idempotency records | signature, raw body, replay, status mapping | Complete provider matrix/E2E not verified. |
| Cron/workers | job tables, claim/status/attempt fields | concurrent claims, timeouts, backoff, stuck jobs | High call volumes visible; bounded concurrency/load tests unavailable. |
| LDAP/external directory | actor/certificate/config state | credentials, timeouts, schema changes | Source dependencies visible; external execution unavailable. |

## Confirmed EDIEL defect

Recent PostgreSQL logs show a write to `ediel_certificate_directory_cache` failing because `sha256_fingerprint` is null while the column is NOT NULL. This can leave certificate directory/cache refresh incomplete and downstream routing/readiness stale.

Required reproduction:

1. Use a controlled certificate record/provider response missing or failing fingerprint derivation.
2. Run the same refresh function/job in non-production.
3. Assert the job fails with a structured, non-sensitive error and does not partially promote cache state.
4. Positive test derives a deterministic fingerprint, persists atomically and advances job status.
5. Retry must be idempotent and must not duplicate certificates/cache rows.

## Cross-system release contract

A release is not synchronized until:

- database migration/version/fingerprint is verified;
- OpenAPI current and immutable artifacts are generated;
- generated client declarations compile;
- tenant website and portal pin/accept the version;
- live quote/application and portal flows pass;
- external provider callbacks/jobs pass idempotency and error mapping;
- request/correlation IDs connect tenant request, server operation, database event and provider interaction.

## Failure containment requirements

Use explicit timeouts, bounded retries with jitter, idempotency keys, durable status/attempt fields, atomic state promotion, dead-letter/manual recovery and redacted structured logs. External errors must not produce a customer/contract/application state that claims completion.