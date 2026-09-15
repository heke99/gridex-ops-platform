# Current state — PR310, 2026-09-15

Status: PARTIAL

## Active work and exact next action

Current bounded task: identify actual native clone failure with a short synthetic
native preflight and closed utility-error categories before modifying semantics.
70ce549f clean34966099676/job104370788723 completed FAILURE at T8 after source
and real CLI ledger verification; prior NULL parse error is gone. Now original
positive restoration succeeds but clone utility fails NATIVE_COMMAND_FAILED,
exit1/command1449; all owned cleanup passes. Artifact10396872362 records this
new boundary. It is not an auth or historical source SQL failure. Exact clone
cause is not yet observed; do not guess, grant privileges or terminate sessions.
The current163e8dfe native/independent-schema runs are pending. A short new
clone-preflight reproduces on the same native bootstrap without the long prefix.

Publication base163e8dfed6fb970db2d8455fd418bb84e151e309, exact tree
ce438cdd43a15fd90fea33142d1697f594ca68a4, published and fetched with equality verified. Preserve its entire ancestry,
including auth ec503fc, the514-source native compiler335f987f, explicit stdin
82cb5d00, complete foundation admission61d6748e, clone NULL70ce549f, complete
non-system snapshot80718722 and operational privilege qualification fd4fb907.

The forward integration is published: two genuine CLI-created, SQL-qualified forward sources
AFTER the unchanged144 foundation and514 historical timestamp inputs, through
the existing live native Runner and owned portable target. The inventory is
603 files, with all original601 path/hash pairs separately pinned unchanged.
Native forward controls require complete historical source/ledger/negative/repeat
receipts, real CLI post-body/ledger rejection, row preservation and no-op repeat.
Portable forward execution is explicitly not official-ledger acceptance.

The two new sources restore customer_documents.contract_id and
ediel_route_profiles.actor_setting_id FKs, and revoke24 excess authenticated
TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grants on6 operational tables. No original
migration is edited. CLI sources20260915111458 and20260915121224 have verified
original SQL hashes; only the exact additional sources are admitted.

Actual operational SQL: fd4fb907 workflow34967447054/job104375184474 SUCCESS,
artifact10395677716 ZIP SHA256
3965feecf1326870dc28148559aa27a4765eeefae257bc806c5ab30dd048fe72.
Original authenticated TRUNCATE bypasses RLS; repaired control rejects42501.
Exact DML/service grants, policies, rows, atomicity/repeat/cleanup pass.
The first FK candidate already passed335f987f job104361913617, including
23503 invalid references, deleteSETNULL/updateNOACTION, orphan rollback,
wrong-definition55000, existing NOTVALID validation and fresh-column path.

Actual composite characterization70ce549f job104370788695 SUCCESS: all7
reference/replay FK cases and immutable legal triggers execute with rollback;
cleanup verified. This is LIMITED_FK_AND_TWO_IMMUTABLE_TRIGGERS, not whole
application graph acceptance. Preserve source-authored NO ACTION composites;
do not blindly restore reference CASCADE definitions.

Native latest fd4fb907 OPS34967447036/job104375186062 is running; earlier
70ce549f native104370788723 also running. Latest fully observed boundary remains
144 foundations plus timestamp1–7 on335f987f. Timestamp8 source and CLI ledger
succeeded there, but a clone identity SQL-NULL JSON parse failed afterwards.
70ce549f corrects that demonstrated defect; actual continuation is pending.
Auth and quality-release-gates on70ce549f are SUCCESS. verify still fails the
genuine generated-types migration-tail guard, not a new auth failure.

Next: complete reviewed forward admission and actual ledger-dependent readiness
T257/T262/T275/T351 behavior qualification without synthetic historical ledger
aliases. Publish coherent reviewed batch, collect native144+514+2 SQL controls,
resolve the remaining independent schema dispositions, run final gates while the
owned native database remains live, genuinely generate types plus manifest from
the accepted full schema, pass same-final-head CI/E2E/review, leave draft and
merge the WHOLE PR to main. User explicitly authorizes commit/push/full merge.
Do not ask again, force-push, bypass red gates, overwrite the reference with the
observed replay, or update only the type manifest.

Independent schema reference remains unchanged at SHA256
b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30.
Full portable335f987f artifact10394485748 agrees with earlier comparison.
Audits now bind exact deltas for typed/remaining columns, constraints, indexes,
policy changes/removals and grants to source/application evidence. Some policy,
function privilege and nullable/default dispositions remain OPEN; full schema
acceptance and generated types remain false. No main merge or production work.

## Preserved history and access

Repository heke99/gridex-ops-platform; PR310;
branch codex/gridex-parity-remediation-20260905. Starting head a59e0ce6 is retained.
Earlier local auth patch is already published at43efaf89 and is an ancestor.
Exact journal ACL correction8130ecf3, required mutation controls d05408c2 and
ASCII-only native primary padding repair ec503fc7 are retained unchanged.
Concurrent publications were fast-forwarded; overlapping local drafts were
superseded, not rebuilt or force-pushed. Preserve and merge ALL PR changes.

Terminal/local Python/dependency installation and official CLI2.101.0 work.
Terminal git push lacks credentials; GitHub connector non-forced publication
works and tree/ref readback is mandatory. Local PostgreSQL/Docker unavailable;
package installation failed setgroups/setuid restrictions. Use Actions for SQL.
Main metadata protected=false, rulesets empty, admin-protection endpoint403;
no formal reviews/threads returned. Never infer acceptance from these facts.

## Actual evidence and remaining gates

Current-base auth diagnostic34960996805/job104354284392 is SUCCESS; actual logs
include complete fixture and all eight exact journal rejection/rollback controls.
Group7 native execution is now verified by the completed ordinary receipt above.
All144+7 source execution is proved; full source/schema acceptance is separate.
The parser repair retains single-primary/code/stage/reason matching.

Full portable schema artifact10371643836 confirms144+514 execution before red
diff. Two missing FKs are confirmed skipped-inline-reference effects. Seven
composite FK replacements have different deletion/update actions;24 anon grant
removals are source-explicit; policy equivalence remains unproved. Keep reference
unchanged. Genuine type generation and all same-head CI/E2E/reviews remain required.
No production mutation, deployment, main merge or whole-replay acceptance claimed.

## Continuity contract

Working-tree accounting is 603 inputs: 591 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

The staged FK draft remains outside the historical selector until separately admitted.
No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
