# Current state — PR310, 2026-09-15

Status: PARTIAL

Preserve and eventually merge ALL PR310 changes, not a subset. The remote base
for this batch is d8ace45ceedc29ef911352f249967d378fd3351a. A separate backup
branch backup/pr310-20260915-d8ace45c preserves the full existing ancestry.
Writer tools are available in this session; the previous read-only limitation
is superseded. The ten-file local auth evidence patch is applied and included
with the native DB2 correction. Do not build these components again.

## Execution boundary

Native1-77 is verified by ordinary OPS34904445623/artifact10372124801.
The newer OPS34939777875/artifact10385038918 executes all144 foundation inputs
and five residual inputs in six successful canonical CLI groups. The seventh
residual144 group is NOT accepted: original55000 atR071 instead of expectedP1480.
The complete chain, timestamp execution, source-effect/schema parity, generated
types and whole-PR merge are still NOT accepted. Owned/private cleanup passes.

## Active correction / actual next action

The native DB2 preflight still admits only the portable fixture's two database
names, not the real owned native postgres database. The new native-only body
transfers exactly that environment predicate to postgres role/database plus
private transaction/backend-bound context. Portable sources/rendered hashes,
legacy scope rejection, all index preimage checks and domain locks remain.
An extra mandatory negative control reproduces the old55000 with its exact
R071 stage and fixed reason before the normal mid/body/ledger controls.
27 local foundation tests PASS after four observed RED regressions;16 previous
auth evidence tests PASS;601 historical migration checksums PASS.
These local tests are NOT native SQL proof. Read the next actual OPS artifact.

The preserved auth patch produces gridex-auth-membership-group evidence with
actual checkout/fixture hashes, first failed command and redacted traceback/
SQLSTATE observations. It does not fix auth. Do not guess company_invitations
or any other SQL cause without that evidence.

After native foundation144: integrate admitted timestamp stages, settle full
independent schema differences with source evidence, fix the actual auth-group
failure, generate real types and pass required same-head CI/E2E/review before
merging the ENTIRE PR. Never change only the type-tail manifest as a bypass.
Existing app/API/company/white-label fields and paused price work are preserved.
No hosted mutation/reset, historical SQL rewrite, forced update, deployment or
main merge is included in this batch.

Current receipt: quality/audits/DB_NATIVE144_TARGET_2026-09-15.md.
Previous auth-patch receipt remains preserved as dated history:
quality/audits/PR310_MERGE_BLOCKERS_2026-09-15.md.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
