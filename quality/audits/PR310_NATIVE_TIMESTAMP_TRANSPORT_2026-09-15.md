# PR310 native timestamp psql stdin correction

Status: REVIEWED_LOCAL_TESTS_PASS; SQL_PENDING; NOT_MERGED.
Publication basef5a5fa88e2e6271f4f644013206fc4996bf8b3dd;
exact source tree3f59f3c00bb4bd56d2c9180c94b553194a3045fc.

## Preserved concurrent work

335f987f already integrates514 timestamps, bebe77a1 corrects the ledger diagnostic
fixture, and f5a5fa88 restores required truthful accounting sentences. Each exact
tree was imported and verified. Our overlapping reviewed T53 and fixture/continuity
drafts were stashed as superseded. No force update or original history replacement.
Auth patch43efaf89 and ACL corrections8130ecf3/d05408c2 remain published ancestors.

Actual ec503 native diagnostic34960996805/job104354284703 is SUCCESS.
Artifact10394223040 ZIP SHA2565352f1730aa9afa662c47c93511ae57cd7c2871239ec7fa315059b714291ce5f
matches GitHub metadata. All144 foundation+7 residual inputs execute; all7 groups
verify genuine CLI statement ledgers and no-op repeats. Group7 passes the exact
portable55000 plusP1480/P1481/P1482 rollback controls. Current success/control
program hashes and all source receipts were compared with the artifact. Owned
cleanup/private-input disposal pass. This is not full replay acceptance.

## Confirmed defect and narrow repair

Independent review identified `psql --single-transaction` with bare piped stdin
but neither `-c` nor `-f`. PostgreSQL17 requires one of these options. The generated
argument shape was reproduced and the new regression failed before correction.
Add `-f -` so privately supplied SQL is an explicit stdin script. Both transaction
modes have exact argument tests; transaction=False keeps authored boundaries
unwrapped. No database role, target, source SQL, schema reference or ledger is changed.

Primary reference: [PostgreSQL17 psql options](https://www.postgresql.org/docs/17/app-psql.html#APP-PSQL-OPTION-SINGLE-TRANSACTION).

All16 proof tests pass. Independent review reran the suite and approved this
transport correction. These tests do not execute PostgreSQL. Actual335 fixture
and continuity failures were separately reproduced and verified fixed locally;
their concurrently published implementations were preserved, not republished.

## OPEN full-tail review findings

- Bind complete foundation source receipts and every expected control program
  hash/case/rollback result before timestamp execution; retain65-file and actual
  statement readback.
- Extend catalog/row snapshots to source-modified schemas, extension metadata,
  enum/domain and event-trigger surfaces. The legacy projection misses effects.
- Execute and record LEDGER_DEPENDENT_READINESS qualifications at257/262/275/351;
  declared requirements must not silently become nativeVerified.

Continue from current-head native/FK CI. These findings, full source execution,
independent schema reconciliation, genuine type generation and mandatory CI/E2E/
review remain required before whole-PR merge. No production/main/deployment or
full schema/type acceptance is claimed.

Skill routing: systematic-debugging, test-driven-development,
requesting-code-review, verification-before-completion and Supabase execution
contract review. No UI/React/deployment/performance or skill-editing changes.
