# PR310 — exact journal ACL correction

Status: LOCAL_CHECKS_PASS; SQL acceptance pending current-commit GitHub Actions.

Publication base: 8130ecf3ec7ab675ba4cb7fd791b071d59521fbe. The exact ACL
correction was concurrently published there before this batch. Its implementation
is reused unchanged; this batch adds mandatory CI wiring and stronger mutation
controls. The superseded local implementation was not committed.

## Access and preservation

Repository: heke99/gridex-ops-platform. Starting PR head:
`a59e0ce6aae821955cf5b07eb1e32598addd4144`, tree
`2fe6ecadc72b97837f4eff67128b4c3dd7727d9f`.
Branch: `codex/gridex-parity-remediation-20260905`; target: main.
Full Git clone and terminal execution work. An unchanged tree write and a
non-forced same-SHA ref update succeeded through the GitHub connector.
Terminal push lacks credentials; publication uses the connector instead.
The preservation commit `43efaf895aaf080abadef84ce724bceafa3e3a79` is an actual
ancestor of HEAD, including the previously local auth-evidence patch. It was
not recreated. The starting PR has 258 commits relative to main.

GitHub branch metadata reports main `protected=false`; the ruleset collection
is empty. The administration-only protection endpoint returns 403. No formal
PR reviews or inline review threads were returned. No review approval or
complete mandatory-check acceptance is inferred from those observations.

## Executed failure and cause

At starting head, OPS run34958678141/job104346776007 and diagnostic
run34958678292/job104346776492 both fail with P0001 at the primary assertion:
`6D2 journal exact owner/ACL/options/no source comments`.
The logs identify `platform_session_revocations` and its `relacl IS NULL`
predicate, not an unidentified auth or RLS failure.

The immutable 6D2 source creates this table without GRANT/REVOKE. The already
published compatible bootstrap grants all table privileges by default to
anon, authenticated and service_role. Native bootstrap acceptance is recorded
in DB_NATIVE_BOOTSTRAP_RECEIPT_2026-09-14.md. The NULL-ACL expectation predates
that correction. PostgreSQL17 includes eight table privileges, including
MAINTAIN; its owner has the standard explicit ACL entry when defaults apply.
Reference: https://www.postgresql.org/docs/17/sql-grant.html

## Correction and non-regression boundaries

The already-published correction replaces the obsolete NULL-ACL predicate with exact normalized equality
against 32 fixed (grantee, privilege, grant-option, grantor) entries. Expected
values are not read from the observed journal or from mutable default ACLs.
PUBLIC, extra roles/privileges, missing privileges and grant options cannot
pass. The owner, relation options and table/column comment checks remain.
This characterizes an intermediate historical source; it does not approve
final production access to the journal.

The new eight real SQL mutation controls exercise missing MAINTAIN, extra PUBLIC,
extra grant option, the obsolete owner-only ACL, wrong owner, relation option,
table comment and column comment. Each must fail at the exact primary
assertion and restore the positive check after transaction rollback. They run
only on the existing disposable whole-source fixture, after its complete
positive suite, in both ordinary auth CI and bounded auth diagnostics.

Historical SQL, bootstrap, source manifests, schema references, generated
types and the pinned whole-source fixture are unchanged. The fixture SHA256
remains c65ae806e179e992affc021062188f6c137ebd02bb98c7adf5128ea806c4ac6a.
No production database, hosted Supabase schema, policy or grant was modified.

## Verification and limits

- 32 native foundation controller tests: PASS on starting head.
- 16 preserved auth-evidence tests: PASS.
- 3 journal contract/control-runner tests: PASS after adaptation to the
  concurrent published implementation. The initial regression failed on the old
  predicate. The published standalone ACL selection check also passes.
- Auth membership group constructor: PASS after adaptation.
- Independent final review of the source-derived ACL and mutation controls: no
  findings within this bounded change; actual SQL execution remains pending.
- Migration integrity: 601 files /505 version groups, checksums PASS.
- git diff --check: PASS.
- Local PostgreSQL/Docker are absent; system package installation failed on
  restricted setgroups/setuid. No SQL test is claimed from local callbacks.
- Current-commit whole-source auth and eight SQL mutations must pass in CI
  before the SQL correction is accepted.

## Remaining whole-PR gates

Starting-head native diagnostics and ordinary replay were still running when
this correction was prepared; residual144 is not newly accepted. Native
timestamp integration is absent. The existing portable timestamp driver has
514 retained inputs but does not provide official CLI ledger provenance.
T201/T202 contain interior transaction boundaries; T221/T222/T224/T225 require
source-specific lock handling. T232 has the authored live-sync repair proof.
These controls cannot be removed to make a generic native adapter accept them.

The independent schema mismatch was observed after complete portable
144+514 execution, and therefore cannot be dismissed as missing native tail
execution. Full schema reconciliation, real type generation, all mandatory
same-head CI/E2E and review remain required before merging the entire PR.

## Skill routing

Applied systematic-debugging, TDD, verification-before-completion, differential
review and Supabase guidance. AGENTS.md and dispatching-parallel-agents were
used for bounded auth implementation and independent timestamp/review work.
UI, performance, deployment, skill creation and whole-codebase documentation
generation are not triggered by this specific correction. Existing quality
gates are retained. Supabase changelog fetch returned unsupported content type;
no Supabase version or provider API changed.
