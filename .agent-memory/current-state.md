# Current state — PR310, 2026-09-15

Status: PARTIAL

## Active correction / exact next action

Current inspected head d05408c228c5d38678503bfc0291944afbed2513; exact local
source tree50a323536b39d9cd2e38a0e70b86288db8dfe8e3 verified. The previously
published auth ACL correction and mandatory SQL controls are retained unchanged.
The local overlapping auth candidate was superseded and stashed, not published.

Completed native diagnostic34958678292/job104346776068 on a59e0ce6,
artifact10392753658, proves that the expected55000/R071 primary line includes
its fixed reason plus322 trailing ASCII spaces. Reconstructing all426 bytes
matches the artifact primary SHA256 exactly. The parser's strict fullmatch
rejects this display padding; group7 remains unaccepted despite the correct
underlying error. Strip only trailing ASCII spaces before the existing exact
single-primary match. Required code/stage/reason, SQL controls and ledger guards
remain unchanged. Two tests reproduce the failure and reject nonspace suffixes;
all34 foundation tests pass after the correction. Actual native SQL is pending.

Publish this bounded parser repair on the same PR and inspect its ordinary
native group7 controls/execution/ledger/repeat. Auth validation for the published
ACL batch also remains pending. Then native timestamps, independent schema,
types and all same-head CI/E2E/review gates must pass before whole-PR merge.
Current receipt: quality/audits/PR310_NATIVE_PRIMARY_PADDING_2026-09-15.md.

## Preservation and access

Preserve and eventually merge ALL PR310 changes. Starting head for this
continuation is a59e0ce6aae821955cf5b07eb1e32598addd4144; repository
heke99/gridex-ops-platform; branch codex/gridex-parity-remediation-20260905.
Full original Git history is cloned. Before publication a concurrent commit
8130ecf3ec7ab675ba4cb7fd791b071d59521fbe was discovered and fast-forwarded.
It already contains the exact ACL correction; reuse its implementation unchanged. The previously local auth-evidence patch
is published at43efaf895aaf080abadef84ce724bceafa3e3a79 and is an actual ancestor.
Do not rebuild it. Backup ref backup/pr310-20260915-d8ace45c remains historical
preservation evidence. No force update, selective merge or history rewrite.

Terminal, local Python tests and dependency installation work. Git terminal
push lacks credentials; the GitHub connector successfully wrote an unchanged
tree and performed a non-forced same-SHA ref update. Publish through it.
PostgreSQL/Docker are unavailable locally; system package installation failed
on setgroups/setuid restrictions. Native SQL acceptance must come from Actions.
Main branch metadata reports protected=false and no rulesets were returned;
reading the administration protection endpoint is forbidden (403). No formal
PR reviews or inline threads were returned. No merge acceptance is inferred.

## Auth correction already published

Actual starting-head OPS34958678141/job104346776007 and diagnostic
34958678292/job104346776492 identify P0001 at the exact assertion
6D2 journal exact owner/ACL/options/no source comments.
The immutable source creates platform_session_revocations without ACL changes;
the previously native-verified bootstrap supplies explicit managed defaults.
The obsolete relacl IS NULL assumption is corrected to exact normalized
32-entry ACL equality, retaining owner/options/comment checks. Eight real
rollback-only mutation controls are mandatory in ordinary and diagnostic auth
CI. No historical SQL, bootstrap, schema reference or type manifest changed.

The duplicate local implementation was superseded before commit. This batch
adds CI wiring and stronger mutation controls around the published correction.
The three adapted local guards and auth constructor pass; SQL acceptance is
NOT claimed.
The reviewed auth batch is published at d05408c2. Inspect its whole-source auth and its
eight new mutation controls. The pinned fixture bytes remain unchanged.
Auth receipt: quality/audits/PR310_AUTH_JOURNAL_ACL_2026-09-15.md.

## Native replay, schema, types and final gates

Starting-head native diagnostics and ordinary replay were still running when
this auth correction was prepared. Read their actual artifacts before any
residual144 correction or acceptance. Prior accepted boundary remains144
regular foundation inputs plus five residuals in six groups; group7 remains
unaccepted. Never infer success from controller-only tests.

The portable timestamp driver already retains514 inputs but has no official
CLI ledger. Native integration is still absent. Static source compilation
identifies interior transaction controls at T201/T202 and source-specific LOCK
handling at T221/T222/T224/T225; T232 requires its full authored repair proof.
Keep source pins, atomicity/rollback checks and genuine statement ledger.

The independent schema comparison is already red after full portable144+514
execution. Its differences must be causally reconciled, never copied into a
reference to manufacture equality. Then genuinely generate types and pass all
mandatory same-head CI/E2E and independent review before whole-PR merge.
Verify all PR ancestry/content in main after merge. No production database
mutation, deployment, main merge or completed masterplan step is claimed.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
