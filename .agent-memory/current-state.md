# Current state

Updated: 2026-09-04

- Active branch `claude/gridex-ops-production-hardening-lrknxa`, based on main
  `62272e9`. Seven commits, pushed.
- `npm run db:parity` compares two databases in both directions over schemas,
  relations, columns, enums, constraints, indexes, functions, triggers,
  policies, grants, RLS state and extensions, in report-only, warning or
  blocking mode. Guarded by `npm run db:parity:selftest`, which asserts fifteen
  injected drift classes are each detected.
- `npm run db:schema:snapshot` / `db:schema:check` produce and verify a
  normalized `schema.sql` and a schema-wide fingerprint. No canonical baseline
  is committed yet; it must come from a CI clean-replay artifact.
- Clean replay runs without Docker via `GRIDEX_REPLAY_DB_URL` plus
  `scripts/sql/gridex-supabase-compatible-bootstrap.sql`. External mode writes
  nothing to the Supabase ledger and states that it carries no ledger
  provenance; the CLI path is unchanged.
- The tenant isolation invariant gate now passes against a database replayed
  from this repository. It previously reported 21 breaches there while passing
  against live. Closed by forward migration
  `20260904120000_canonical_tenant_invariant_convergence.sql`.
- That gate, the parity self-test and the schema snapshot now run inside the
  `clean-migration-replay` CI job, in the same step as the replay so the local
  stack is still alive.
- `security:audit-production` no longer fails when the npm registry is slow or
  unavailable; it retries, bounds each attempt and distinguishes a vulnerability
  from an audit that could not run. It still fails closed.
- `db:types:gen` generates from the local shadow, matching CI exactly.
- KNOWN: CI's clean replay is green on main and produces fingerprint
  `c70fa2f...`, while the dockerless harness produces `324bc8e0...`. The
  harness reconstructs a public schema identical to the CI-verified generated
  types, but is not byte-equivalent for the thirteen fingerprinted tables. Use
  it for structural work, never for canonical provenance.
- KNOWN: the OPS hardening run on main `62272e9` is red, at
  `security:audit-production`, from an npm registry 503. That is what the audit
  gate change above addresses.
- Production database parity and production promotion remain blocked: no
  production Supabase project is visible from this environment.


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
