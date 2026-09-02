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
7. The Supabase client is constructed without a `Database` type parameter
   (`lib/supabase/service.ts:6`), so `typecheck` validates no table, column or
   RPC argument. Sweeps in the audit found no drift beyond blocker 5, but the
   gate is manual. N-7.
8. `invoice_export_items.provider_invoice_guid` has no unique index, and the
   billing provider webhook resolves the tenant on it. It fails closed on a
   collision, so it is not an isolation defect, but a duplicate guid takes the
   webhook down for that tenant. N-8.

