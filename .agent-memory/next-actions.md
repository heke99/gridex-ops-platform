# Next actions

1. Apply migration `20260725120000_billing_readiness_and_supply_activation_v1.sql`
   to an authorized staging Supabase database.
2. Prove RPC rollback on every forced mid-transaction error, idempotent replay,
   exactly one `supply.started`, and cross-tenant denial.
3. Exercise billing configuration snapshot creation and mutation rejection with
   real tenant/provider settings.
4. Deploy API/docs version `2026-07-25.1`, then compare the live developer page
   and both live OpenAPI documents with the local release.
5. Run provider-backed invoice partial/overdue/credited scenarios and decide
   when their canonical public webhook names graduate from planned.
6. Continue remaining PHASE-14–21 end-to-end lifecycle matrices after the
   database gate is green.
