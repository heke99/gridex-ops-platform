# Open blockers

Updated: 2026-09-04

1. No production Supabase project is visible; production migration parity is unverified and production promotion is blocked.
2. Authenticated resolver/end-to-end smoke and k6 execution require the hosted preview plus the configured scoped test credentials.
3. Auth uses an absolute 10-connection allocation; production-project capacity configuration is unverified.
4. Production load testing remains forbidden; smoke/load/spike/ETag/soak are staging/preview only.
5. CLOSED 2026-09-04. The canonical schema baseline is committed, captured
   from the green `clean-migration-replay` artifact of run 33874124560
   (`supabase/schema.sql`, `supabase/schema.fingerprint.json`, overall
   fingerprint `3b0dd50e...`). The guarded verification step activates on the
   next run.



## 2026-09-05 — active parity remediation

Status: IN_PROGRESS. No phase closed. Branch codex/gridex-parity-remediation-20260905.
Inventory manifest divergence and unsafe replay cleanup fixed with red/green
regressions, wired into OPS hardening. Production catalog read only; no live
mutations. See quality/audits/MASTER_PRODUCTION_REMEDIATION_STATE.md for baseline,
findings, tests and exact next work. Publish reviewable fixes and verify hosted CI;
then exhaustive replay accounting and forward canonical reconstruction.
Prior claims of unavailable production project or completed schema phases are
superseded by current catalog access and unresolved two-way parity.

2026-09-05 publication update: implementation 49c9b2a4 committed locally; automatic review rejected branch push (payload authorization/destination trust). No workaround attempted. Request approval for the concrete branch push before hosted CI. Typecheck and focused domain 7 files/22 tests PASS locally. Production parity remains open.
