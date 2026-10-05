# F-DB-05-01 — hard delete of a company cascades away journal/billing/audit history (CONFIRMED, not fixed)

Card: DB-05 prohibited effect "Radera inte all historik med CASCADE". Found 2026-10-05 by Claude on main 498ebd1.

## Evidence
- `supabase/schema.sql`: 407 of 1884 FKs are `ON DELETE CASCADE`; 265 of them hang directly off `public.companies` or `public.customers`.
  Among them journal/billing/audit tables such as `canonical_audit_events`, `canonical_domain_events`, `contract_charge_ledger`,
  `invoice_documents`, `invoice_export_files`, `billing_period_locks`, `customer_events`, `customer_case_events`,
  `power_of_attorney_events`, `route_decision_logs`, `ediel_ack_transaction_results`, `ediel_route_history`.
- No `BEFORE DELETE` trigger on `public.companies` (nor on `canonical_audit_events`); `service_role` has ALL on `public.companies`.
- Reproduction (`hard-delete-cascade-repro.mjs`, run from the repo root with `@electric-sql/pglite` installed, loads supabase/schema.sql snapshot object by object; user triggers on the two tables are disabled only to seed a minimal company; FK/RI triggers untouched): insert company + one `canonical_audit_events` row, `DELETE FROM public.companies` → no error, audit row count 1 → 0.
- Existing offboarding (`canonical_transition_tenant_lifecycle`, 20260810191822) soft-closes; it is not what a hard delete uses. The migration `20261002210000_tenant_company_foreign_keys.sql` states "Companies are only soft-deleted today" — that is a convention, not a DB constraint.

## Limits
Snapshot-in-PGlite, not native PostgreSQL; 670 snapshot chunks fail to load there (extensions/PostGIS etc.), none of them the tables above. Native confirmation should run through the existing clean-replay workflow.

## Decision needed from the owner (no migration written)
Options: (a) BEFORE DELETE guard on `companies`/`customers` refusing while retained-evidence rows exist, with an explicit, journaled purge path per retention class; (b) change the journal/billing FKs to RESTRICT/NO ACTION; (c) both. Risk: code or tests that rely on cascade cleanup of disposable tenants (`deleted_test_only`). A forward migration also touches the shared manifest/schema/types owned by root.

DB-05 / AT-DB-05 stay NOT_VERIFIED.
