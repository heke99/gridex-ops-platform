# Open blockers

Updated: 2026-09-02

1. No production Supabase project is visible; production migration parity is unverified and production promotion is blocked.
2. Authenticated resolver/end-to-end smoke and k6 execution require the hosted preview plus the configured scoped test credentials.
3. Auth uses an absolute 10-connection allocation; production-project capacity configuration is unverified.
4. Production load testing remains forbidden; smoke/load/spike/ETag/soak are staging/preview only.
5. `public.inbound_operation_events` does not exist in the development database,
   so manual inbound email ingestion throws on every message
   (`lib/inbound-mail/manualInboundIngestion.ts:207`). The repository migration
   `20260824190000_gridex_inbound_operations_foundation.sql` was never applied.
   See `quality/audits/SPEC_VS_REALITY_DEEP_AUDIT_2026-09-02.md` N-1.
6. The repository and the development database are two divergent migration
   lineages: 564 files against 258 recorded migrations, 136 versions in common.
   Until that is reconciled, a passing `db:migrations:integrity` says nothing
   about what the database actually contains. N-2 in the same audit.

