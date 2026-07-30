# Next actions

1. Recover the trusted bytes for `20260728170000_live_schema_code_canonical_sync.sql`; do not change its manifest hash.
2. Require `npm run db:migrations:check` to pass.
3. Apply pending forward migrations through `20260730120000_atomic_website_portal_identity.sql` to clean and realistically upgraded staging databases.
4. Run migration preflight/postflight plus two-tenant and portal-identity concurrency denial tests.
5. Repeat the production build under declared Node 22 and deploy OPS runtime/migrations together.
6. Verify the live `2026-07-30.1` release manifest and both canonical OpenAPI SHA-256 values.
7. Run Web `npm run api:sync`, `api:check:live`, `api:runtime` and `api:compatibility`.
8. Execute the complete guest/authenticated checkout, atomic portal, portal resources, customer events, signed webhook, retry/dead-letter, idempotency and two-tenant staging matrix.
