# PR310 — exact native primary-error padding

Status: local regression PASS; actual native group7 re-execution PENDING.
Base: d05408c228c5d38678503bfc0291944afbed2513,
tree50a323536b39d9cd2e38a0e70b86288db8dfe8e3.
Preserve the complete branch and previously published auth/ACL controls.
The prior overlapping local auth candidate is stashed and superseded by the
published8130ecf3/d05408c2 implementation, not applied again.

## Executed evidence and root cause

Native diagnostic job104346776068/run34958678292 on a59e0ce6 finished FAILED.
Artifact10392753658, ZIP SHA256
18d19fae2bd89eb43775010b7994f3b219ef82be0e9daac3717ccf0f4a32d06f,
contains blocker-native.json and native-supabase-lifecycle.json.
The execution reaches144 ordinary foundation inputs plus5 residuals in6 groups.
Group7 rejects its required portable55000/R071 control because the acceptance
parser does not return the fixed reason. Cleanup and private disposal pass.

The independent diagnostic reports exactly one primary ERROR line,426 bytes,
SQLSTATE55000, stageR071 and the known reason
DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED, with no ANSI bytes.
Its primary-line SHA256 is
7e67b94c0d3e709502c478f538731bbb7fb3f3d65250fbc2d7ebfe352625da93.
Constructing the fixed104-byte primary message plus322 ASCII spaces produces
exactly426 bytes and the identical SHA256. This proves the actual line's bytes
without exporting raw SQL, arbitrary error messages or environment values.
The existing fullmatch rejects only this terminal display padding.

## Narrow correction and tests

Only strip trailing ASCII space bytes from the single primary line immediately
before its existing exact fullmatch. The required primary ERROR, reason, R071,
55000, unique primary line, and no-source-excerpt rules remain unchanged.
Tabs, vertical tabs, nulls, ANSI suffixes and arbitrary trailing text still fail.
No SQL wrapper, migration input, ledger check, transaction/rollback control,
source pin, grant, schema reference, type baseline or release gate changes.

RED: two focused tests ran; the artifact-bound positive failed because the
parser omitted reason, and the nonspace-suffix negative passed.
GREEN: all34 foundation tests pass, including ledger/rollback/repeat/failure
controls and the two new padding tests. git diff --check passes.
This proves the parser repair against the exact observed line; it does not
qualify the remaining native SQL execution or full foundation acceptance.
Independent review approved publication with no blocking findings; its five
focused parser/security controls pass. Full SQL/CI remain pending.

## Continuation

Publish on the same PR with actual current GitHub parent and nonforce ref update.
Run the ordinary native job and verify group7's original rejection, remaining
negative controls, execution, real ledger and repeat. Then complete native
514-input timestamp integration, independent full schema reconciliation, genuine
type generation, final auth and mandatory same-head CI/E2E/review before merging
all of PR310. Do not infer success beyond the last executed control.
No production database changes or main merge occurred.

Skills: systematic-debugging, TDD, verification-before-completion and independent
requesting-code-review. This exact transport correction does not trigger UI,
performance, deployment or new database migration work.
