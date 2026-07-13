# Gridex OPS – Performance, API and tenant hardening

Implemented 2026-07-13 against the supplied project archive.

## Batch coverage

1. **Critical API and schema gate:** monotonic schema compatibility, 30-second readiness cache, current migration requirement.
2. **Idempotency:** shared external-write executor; enabled for customer sync, profile update and move-out; request hash conflicts and replayed responses are enforced.
3. **Auth and rate limiting:** explicit API-client projection, atomic database rate-limit bucket, no request-log COUNT, detached last-used telemetry.
4. **Database performance:** tenant/customer/date indexes for portal identities, sites, invoices, metering values, request logs and idempotency.
5. **Fast rendering:** global admin fallback no longer replaces the full viewport or hides the persistent layout.
6. **Customer portal read model:** website application, document, power-of-attorney and invoice responses no longer select internal payloads or storage paths.
7. **Cache:** schema readiness now uses bounded in-process request-path caching; cache compatibility accepts newer migrations.
8. **Queues/side effects:** customer profile automation enqueue is detached from the synchronous response after the durable write. Existing project outbox/worker architecture remains the delivery path.
9. **API documentation:** public route registry is the endpoint source for the developer page; actual routes, granular scopes, idempotency and legal-bundle/customer-portal sync are documented; non-emitted document events are marked planned.
10. **Observability:** request logging remains request-id/tenant/client bound while non-critical client telemetry no longer blocks responses.
11. **Retention/scalability:** atomic rate buckets self-prune and supporting indexes prevent unbounded request-log COUNT scans.
12. **CI gates:** public API registry completeness, tenant filters, forbidden public fields and `select('*')` checks; migration checksum gate updated.

## Deployment order

1. Apply `supabase/migrations/20260713150000_api_performance_tenant_hardening.sql`.
2. Deploy the application build.
3. Verify `/api/internal/system/health` and a scoped V1 API client.
4. Rotate or review clients still using legacy `customer_portal.read/write` scopes.
5. Require `Idempotency-Key` for the documented write endpoints in all integrating systems.

## Verification completed

- Next.js production build: passed.
- TypeScript as part of production build: passed.
- Changed-file ESLint: passed.
- Public API contract gate: passed.
- API performance/tenant gate: passed.
- Migration history/checksum gate: passed.
