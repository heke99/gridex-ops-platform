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


## Active checkpoint 2026-09-06 — supersedes previous progress

IN_PROGRESS. No phase closed. PR #310 published head 0a0f4068 has passing quality
gates and isolated reconstruction/parity SQL tests; verify fails generated-types
tail, and clean replay fails completeness (OPS 33988318141). These are required
internal remediation gates, not external permission blockers.

Next reviewed batch restores eleven invitation columns and corresponding role/FK/
unique-index effects through forward migration 20260906081839. Isolated tests
pass 18 assertions and two invalid-data rollback scenarios; the historical
regression table is frozen separately so canonical artifact refresh cannot erase
the failing baseline. Full RLS/RPC/provider E2E is not established.

Portal/API-origin source 20260609150000 is now preserved after its early bootstrap
at its original timestamp. Whole-source selection failed before the fix; actual
SQL now runs twice in an isolated fixture, preserving existing explicit origins
and valid identities, restoring match_strength=manual (read-only live default),
and verifying indexes. Other historical substitutions remain blocking.

Integrity/readiness pass for 587 files. Types still fail the new migration tail;
no manual hash or schema baseline edits. Complete historical effect review, then
run authoritative full replay, generate types/schema and verify ledger/live parity.
No production mutation performed in this batch.

## Published verification checkpoint — 2026-09-06

Code revision 8344cbb84eb6691bf7507bcc9c6580565bc6a114 is published on draft
PR #310. OPS run 34035865807 finished: quality-release-gates PASS; all isolated
reconstruction/parity SQL fixtures PASS; verify FAIL at the new generated-types
migration tail; clean replay FAIL at completeness. Later verify steps skipped
after the type gate are not certified. No phase closed and no production writes.

Next: complete the bounded Ediel environment source review, then test its complete
SQL with actual prerequisite ordering and successor hardening on PostgreSQL 17
before changing either source-suppression declaration. Full historical accounting,
authoritative schema/types generation and ledger/live comparison remain required.

Ediel next step: isolated PostgreSQL 17 CI fixture implemented; SQL composition
and diff checks pass, execution pending. Both source suppressions remain unchanged.
Inspect ediel-source-effects job before changing selection. No phase closed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.
