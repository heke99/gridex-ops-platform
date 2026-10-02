# Tenant/customer RPC workstream — state 2026-10-02

Separate from the Ediel masterplan V2 workstream (which owns Ediel inbound/outbound
RPCs by user decision). Audit and per-flow status:
`quality/audits/tenant-customer-lifecycle/write-flow-atomicity-register-20261002.md`
and `tenant-customer-consistency-20261002.md`.

## Merged to main
- #441–#443, #446: Ediel overview UI, tenant ownership checks, company-scoped
  Ediel lists, fail-closed matchers, customer archive RPC.
- #449: tenant company FKs (22 tables), atomic test-customer delete, lifecycle
  close, supply end on Z05 (status `ended`, billed to end_date), legal
  retention/anonymization (manual, legal_hold), supplier-switch create/transition/
  finalize, lifecycle decisions.
- #450: grid-owner data request RPC (company_id NOT NULL), POA expiry atomic.
- #451: billing import RPC, invoice purchase RPC.
- #452: customer merge RPC (+ canonical merge columns).
- #453: portal claim RPC (+ canonical claim/event columns).
- #455: invoice test approval, invoice review draft, billing period lock RPCs;
  webhook retry fix; tenant-scoped website and tenant-website-integration writes.
- #457: support-attachment download headers, contract 2026-10-02.3 (fixed the
  `full` E2E job that was red on main since before #446).

## Hosted DB (gridex-ops-dev, piidsfebjqjmnepdpnas)
All migrations 20261002210000–20261002226000 applied; 20261002211000
(atomic_test_customer_delete) was run by the owner in the SQL Editor on
2026-10-02 and recorded in schema_migrations as 20261002192605; verified with a
rolled-back probe (real customer blocked, test customer + site deleted, audit row).

## Operational lessons
- Supabase MCP `apply_migration`/`execute_sql` time out on SQL containing
  `delete from` (interactive confirmation never surfaces): the owner must run such
  migrations in the SQL Editor.
- The repo has no database URL secret; CI cannot write to the hosted DB.
- Every new migration needs types regenerated from the exact-head OPS
  clean-migration-replay artifact (`gridex-rem-002-clean-replay`).
- Canonical schema drift: legacy 8-digit migrations created columns the clean
  replay lacks; converge them idempotently in a forward migration before use.

## Open
None in the register. Accepted (idempotent, tenant-scoped, no RPC): tenant sync,
admin application review save, missing facility information request.

## 2026-10-02 (later) — UI/DB/tenant consistency audit (active)
Register: `quality/audits/ui-consistency-20261002/findings-register.md`.
Branch `claude/ui-audit`: PR A (security) in progress. Order: A security → B broken
→ C DB mismatch/raw codes → D clutter/wording → E intake/contracts/onboarding.
Owner granted full Supabase approval (2026-10-02) and asked to proceed stepwise.
PR A = #462 MERGED. PR B = #463 head b34c5ea7 (schema snapshot refreshed; tenant invariants passed) — merge when replay green.
Stacked branches pushed (no PRs yet): claude/ui-audit-c (C1–C3), claude/ui-audit-d (D1–D6), claude/ui-audit-e (E1–E6; E7 needs product decision, E8 open).
Next: merge #463, then open PR C/D/E against main in order (merge main into each first), CI green, merge.
