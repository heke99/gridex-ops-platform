# Current task

Updated: 2026-09-02

Status: `VERIFIED`

Active work item: remediate the tenant-isolation and multi-tenant consistency
findings from the 2026-09-02 audit.

## Completed batch

1. Tenant-scoped unique business keys (F-8, F-9, F-10, F-11).
2. Company-scoped permission engine, one path (F-1, F-2, F-7).
3. Explicit tenant scope plus an owned inbound quarantine (F-3, F-4, F-5).
4. View hardening and removal of inert policies (F-13, F-14).
5. Table classification and the invariant gate (F-6).
6. Composite customer keys on 94 of 99 tables (F-12).
7. Service-role wrapper and ratchet (F-15, contained not closed).

## Plan of record

`quality/audits/MASTER_REMEDIATION_PLAN_2026-09-02.md` holds the full register
(F-1 … F-18, N-1 … N-10) and the six-stage sequence. Work it in stage order.

## Exact next action

Reconcile the repository against the database before anything else (N-2), then
apply `20260824190000_gridex_inbound_operations_foundation.sql` to restore manual
inbound ingestion (N-1). The composite-key orphans are resolved -- no `NOT VALID`
foreign key remains and a 451-key scan found no cross-tenant row -- so what is
left of the product questions is the two inbound mailboxes that carry no company.
Then type the Supabase client (N-7) and plan the move off `service_role` for
request traffic (F-15 proper).
