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


## Active checkpoint 2026-09-05 — supersedes earlier status claims

IN_PROGRESS; no masterplan phase is complete. Publication is authorized and
PR #310 is open as draft. Head 2568c28f has passing verify/quality jobs and a
failing canonical replay completeness gate (OPS run 33971545934). This is a real
repository remediation task, not an external permission blocker.

Forward migration 20260905141608 restores seven tenant relationship triggers
while preserving the newer snapshot function. Isolated PGlite 0.3.14 tests pass
18 reference cases under authenticated/service_role, twice; live read-only
catalog assertion also passes. These tests do not establish full RLS isolation
or canonical replay provenance. Integrity and production-readiness pass for
586 files; generated-types check correctly fails the new migration tail. Do not
update the types manifest without actual authoritative generation.

Two exact reviewed read-only diagnostic inputs receive an explicit classification.
The plan still has 56 unclassified files and 32 unresolved substitutions.
Next: finish reviewed effect reconstruction and parity semantic checks, then
obtain authoritative replay/type/schema artifacts and compare both ways with
production. No production mutation has occurred in the 2026-09-05 campaign.

Parity semantics: 26 isolated catalog checks PASS; expanded schema fingerprint requires authoritative recapture. Replay recovery: 14 tests PASS; no stop on preflight failure. Ownership of a pre-existing local stack after reaching startup remains unresolved; do not call this a fully isolated replay.
