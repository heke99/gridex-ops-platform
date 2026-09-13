# Current state

Updated: 2026-09-13.
Status: PARTIAL

## Active task and scope

Database reconstruction and generated-type acceptance remain the single active
work item for PR310 / codex/gridex-parity-remediation-20260905. Continue the
masterplan in order: database/types; the two runtime faults; full RLS/permissions;
native billing transactions; jobs including point86 starvation; paused API
remainder; independent review and final merge/release. No gate is waived.

## Current verified code and evidence

Latest verified database code:85149c49108e24884d82e92df9f70c6302d89c5b.
Tree:0485f1c435f2f374b6209013c2a47035b510063a. Previous increment775d58171737ed2bd4bde779db0e18da7182280a.
Four of the11 residual originals at the start of this session are restored as
whole files: inbound7a1, rulebook hardening/systemtest UI, June15 company guards,
and May28 rulebook completion before V4. Historic SQL/hashes are unchanged.

Native run34755559678/job103719212176 passed150 source tests and the complete
selected144-foundation/513-continuation chain, including all four new source
proofs and corruption controls. Regular published-code frontier
34755799372/job103719840158 repeated PASS. These are selected-chain and bounded
source proofs, NOT normal canonical replay/ledger/generated-type acceptance.
The six earlier session reconstruction proof cases remain verified; its source
replacement is still disclosed and requires normal-path acceptance/review.

Evidence:quality/audits/DB_RESIDUAL_WHOLE_SOURCES_2026-09-13.md and companion.json.
Earlier session results, including118/508 and the33/37 residual counts, are
historical; previous active state is archived under archive/pre-residual-20260913.

## Accounting and actual remaining migrations

Working-tree accounting is 600 inputs: 588 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 334 selected, 2 substituted, 5 unclassified, and 5 excluded.

Seven originals remain: DB2 preflight and DB2 validation; May21 live readiness;
May21 customer-intake completion; May22 full DB1 repair; May25 schema/code
alignment; June1 Ediel production readiness. Their errors include unresolved
legacy-model dependencies, view/function shape changes, roles.role_key versus
roles.key, and old per-environment send-lock inserts versus required lock_key.
No full-source closure is claimed for these seven. The isolated role-rename and
early-placement experiments are diagnosis only, not adopted migration fixes.

## Additional follow-up in this tree

Residual checks now use exact HOLD-retained bytes, not original paths that the
clean shell has moved away. Four new negative/read-retention cases and all19
residual-source tests pass locally. The full recorder checks exact callback order
and bytes, with no claim of native execution. Old standalone test totals now
match144/current accounting while preserving protected first77 boundaries and
all source, ownership, rollback and failure-stop guards. Local named-scope
constructors and auth-group regression pass. Hosted native recheck of this
follow-up tree is still required; do not attribute the earlier code's green
native jobs to untested changes.

## Other gates and preserved work

On85149c4, OPS34755799360 application quality/build103719840231 and
permission/private-Storage103719840272 passed; tenant-integrity34755799381 and
browser-quality34755799452 passed. Clean replay/types103719840293 and
fullE2E34755799382 failed; stale standalone constructor failures are addressed by
the follow-up but are not accepted until rerun. Normal canonical CLI/lifecycle,
complete effects, ledger provenance and type tail20260911114443 remain open.
Do not regenerate accepted schema/types from an uncertified/live arbitrary DB.

The install log also reports11 dependency vulnerabilities, including one critical;
package/production applicability is not investigated here. ggshield is unavailable
and no independent code/security review is claimed.

Application baseline52b2de4d81cae370bf250e5a80f12c300bbddd16/tree76e633e2c7189807ae8b7de297a6d2e6e2343234 is preserved.
quality/paused/2026-09-12-partner-price-wip.patch stays unapplied and byte-identical.
No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
No main merge or Vercel API action occurred. Managed access was read-only catalog
metadata, not authoritative deployment/database binding or customer export.

## Exact next action

Verify the staged-byte/standalone-fixture follow-up on hosted PostgreSQL and record
its actual outcome. Then implement and prove correct complete-source admission
for the seven originals above; prioritize the canonical role-column mismatch and
the early DB1/alignment dependency order without creating fictional legacy tables.
Keep the normal canonical full-effects/ledger/schema/type gate closed until its
own accepted complete replay passes. After that, continue the preserved masterplan.
