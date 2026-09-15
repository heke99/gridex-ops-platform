# Current work — merge to main before next Ediel phase, 2026-09-15

Status: BLOCKED, active remediation. User explicitly authorized merging the entire work to main and starting the next phase afterward. Preserve all PR310 ancestry and original601 migration hashes. Published combined head1849497413325385b080e33f2bbfffd4073f488f (treebd3bab442377206b7ecb1a34664c1383632f7c3c, local/remote equality verified) contains all PR310 and PR311 ancestry plus reviewed diagnostics. Both feature refs advanced without force. GitHub confirms PR311 merged into PR310 branch at16:58:18UTC; PR310 remains draft/open/unmerged to main eb9a25bc989c6de808903f41c2314d5465e9c07b. Local branch remains the now-closed PR311 continuation.

Fresh actual native evidence supersedes the old T232 boundary: PR310 OPS run34989328503/job104450130810 executes144 foundations,514 timestamps and all6 forwards with nativeLedgerVerified=true. Four final SQL checks preserve catalog/rows/ledger; the fifth, scripts/sql/tenant-isolation-invariants.sql, fails NATIVE_TIMESTAMP_SQL_RESULT. All owned cleanup passes. CompleteReplay/schema/types acceptance remain false. Artifact10408271575 is advertised with ZIP SHA2561cec2c856bce6a17039d2ea08dbb0a20f7f7391100b36f8c3744c5179e2b594c; actual log inspected, archive digest not independently verified this turn.

Fresh independent schema run34989327838/job104449553330 completes514+6 and policy actor SQL, then rejects removed-policy metadata/composition after successful metadata query. Counts={} means no schema comparison result. Exact rejection is hidden by current closed logging; add a reviewed finite diagnostic, preserve exception and all acceptance rules.

PR311 d4f Ediel workflow34996128489 and browser workflow34996128574 PASS. E2E34996128566 smoke14/15 fails only generated-types tail; OPS verify104473224018 fails the same gate. Local db:migrations:check reproduces: inventory607/511, public contract and hardening pass, generated manifest does not cover20260915144319_restrict_ediel_send_lock_client_writes.sql. Never hand-edit it to manufacture acceptance. Full/runtime/real journeys were skipped.

Current repair batch: correct stale frontier fixture counts605/518 to registered607/520 while preserving514 historical selection and all6 exact hash pins; add safe failure diagnostics for removed-policy and native final invariant rejection. Root frontier16 plus related50 tests pass. Root independent review and native55 targeted tests PASS; both diagnostic patches are published. Actual18494974 schema run34998326163/job104480142628 and frontier34998326022/job104480139829 reached owned SQL; OPS34998326584 clean job104480146832 is queued. Actual18494974 schema34998326163/job104480142628 now FAILS REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED before comparison (privacy/disposal verified, counts{}). Schema agent traces exact source mismatch. Frontier34998326022 passes. Combined tenant integrity34998326037/job104480140557 finds2403 direct service calls against2402 baseline; a reviewed shared DSN-safe message lookup removes redundant queries without changing the ratchet; local count2402 PASS and DSN20 tests PASS. Additional closed policy difference counts/ordinals/hashes retain exact267 and all policy hashes; qualification9/formulas9/reference25 PASS. Full Node22 Vitest218 files/2134 tests PASS; application/tests TypeScript PASS. Follow-up published to both feature refs as01ee1d55e515dea336531a3f8820bdf9eafebaf0, treeac3de5c3f7cac10b78ee86adb63aff46c1cf0aae with local/remote equality. PR310/main reverified: draft/open/unmerged, main still eb9a25bc989c6de808903f41c2314d5465e9c07b. New schema34999483634, tenant integrity34999483625 and OPS34999483575 queued/running. This publication receipt is stored on the closed PR311 continuation only to avoid restarting the running PR310 checks. Details: quality/audits/ediel-masterplan-v2/merge-e2e.md, merge-schema.md, merge-native.md.

Next action: inspect actual01ee1d55 diagnostic reruns (publication and stacked history incorporation are complete), repair only evidenced causes with qualified forwards, close independent schema decisions, genuinely generate application types, pass final-head CI/E2E/review, merge whole PR310 to main, then begin the next source-backed Ediel locator/register phase. No main merge, database mutation, market message, production deployment or next-phase implementation is claimed.

## Historical continuation records (superseded status)

# Prior Ediel batch — superseded status, retained evidence

Status: PARTIAL. User supplied the full Ediel v2 masterplan and authorized implementation against Gridex OPS. This isolated branch is codex/ediel-masterplan-v2-alignment-20260915, based on PR310 head b9f732d28ceaf090e3b984e71d13a9cbd27f6408. It is a stacked Ediel change; preserve and continue the underlying PR310 database work recorded below.

Immutable original specification: docs/ediel/masterplan-v2 (33 manifest entries plus original manifest). Implementation/evidence ledger: quality/audits/ediel-masterplan-v2/coverage.json; 121 rules and231 acceptance contracts retained, no full acceptance inferred from unit tests. Execution plan: docs/superpowers/plans/2026-09-15-ediel-masterplan-v2.md.

Current batch repairs confirmed Z14N parent validation/rendering, UTILTS_ERR APERAK family/alias enforcement, shared UTILTS policy/date reuse, DSN quarantine including nested attachments/old parse rows, and uncertain SMTP outcomes including post-acceptance persistence errors. Independent reviews found additional bypass paths and the patch was extended. Exact final checks and publication are recorded in the batch verification report.

Live Supabase was inspected read-only: gridex-ops-dev ledger279/latest20260904222450. No live database modification, external Ediel send, resend or production activation.

Publication: PR311 (draft) at b06dc9f60af32e99902baf6cf89923b329b95a18; remote tree10c8ea77104f01273582be78ff3ab1b2fb750e6f equals locally tested tree. GitHub CI started; no final remote green claim.

Next action: inspect PR311 CI, then reconcile the source-backed field327/325/date locator and per-object/register validation gaps; implement the remaining F0–F7 requirements in the ordered plan. Provider/service/beneficiary grants are not implemented or certified. Original G01–G07 evidence gates and underlying PR310 full native replay/schema/types/final CI/E2E remain open. Do not merge main or claim the whole masterplan complete from these bounded repairs.

## Underlying PR310 continuation (preserved)

# Current state — PR310, 2026-09-15

Status: PARTIAL

## Active work and exact next action

Complete native144+514 and all qualified forwards, close source/function schema
decisions, genuinely generate application types and manifest, pass final-head
CI/E2E/review, then merge the entire PR310 to main. Already authorized; preserve
all ancestry, ec503 auth repair and original601 migration hashes.

Publication base 437d3e028084d95de3a312d4bc18893dc5871cad, tree
02d0373c802ce68a25a4f201d03fce7162212e6a, fetched/index equality verified.
Actual portable437 run34984859975/job104434241551 completes144+514+6,
2496 real policy actor cases and all31 exact source/current view witnesses.
After this success the unmodified private-artifact guard rejects a derived SQL
fixture containing source literals. The reviewed correction sends that fixed SQL
through memory-only stdin; full actual rerun and reference comparison remain open.
No reference overwrite or privacy exemption is introduced.

Actual short native437 run34984859686/job104434242782 did not reach SQL: a
selftest still rejected the sixth admitted CLI ordinal. That fixture is corrected.
Ordinary437 run34984859825/job104434541400 likewise stopped offline at temporary
historical-prefix fixtures missing newly retained witness sources; those fixture
repairs are tracked separately from actual native evidence. Verify job104434541356
also found a stale593 FULL count versus595 actual. Auth104434541506 and quality
104434542016 PASS. Browser/quality34984859841 PASS; full E2E34984859946 FAIL.

Latest actual ordinary native evidence remains824 run34974499849/job104398696940:
144 foundations+231 timestamps; T232 fails during session ACL behavior. Actual dc0
short34983371143/job104429130148 observes client exit2/SERVER_CONNECTION_CLOSED,
then DATABASE_RECOVERY, rather than required42501. The reviewed exact three-query
transport uses a genuine authenticator login with verified role attributes and
SET permissions, preserving SQL, image, grants and historical source. This tests
the cause hypothesis documented in upstream supabase/postgres issue2409; actual
native rerun remains required. No new server crash reproduction is claimed.

All6 promoted source files retain genuine CLI names and qualified exact bytes:
607inventory/595FULL/520raw timestamps, original601 and historical514 immutable.
59removed-policy supplemental formula/composition and actual capability gate is
reviewed and wired in both runtimes; SQL execution pending. Added486 policies,
211 constraints and451 indexes now have complete source-linked disposition
registers. Registers alone do not grant schema acceptance. Five parent-delete
behaviors and five changed-view source witnesses remain under completion.

Two new source-backed forward candidates await real PG17 and CLI qualification:
auth_email_events.action seven-value CHECK must include the source-authored four
additional actions, including three active caller values; company_invitations and
user_roles retain four nonSELECT capabilities each outside audited RPC writes.
Neither candidate rewrites approved historical authQ/ec503 or enters the ledger
before actual qualification. AGT caller now respects retained expired-but-unreleased
locks covered by the real unique index; its five bounded module tests pass.

Synthetic native CLI typegen succeeds twice with identical5019bytes only. Genuine
APPLICATION types and manifest remain ungenerated. Complete native514, probe cleanup,
exact schema acceptance, final CI/E2E/review and whole PR merge remain open. Main
unchanged; PRdraft/open/unmerged. Next: publish reviewed transport, witnesses and
qualification workflows, inspect short native result, promote only actual qualified
sources, complete schema acceptance and real type generation, then merge wholePR310.

## Earlier evidence (superseded boundaries remain historical)

Actual9f1 short native preflight34975955556/job104403603697 SUCCESS: clone
preservation still passes; real CLI2.101.0 typegen runs twice against the owned
synthetic public schema, identical5019bytes SHA256
a118a1e22652e998c85c99da145487bb283f9fa291f06311d79b2f6d877b4d51.
Schema/rows/ledger and cleanup preserved. Artifact10399357001 ZIP digest
2061b67bede55e0a2181b16ef7d8939c79df99101d2a6cc9beb916c17489ce65.
This proves transport, not application types: actual application types/manifest
are untouched and their guard remains red.

Actual9f1 full portable34975955635/job104403606680 completes144+514+4 with all
four source postconditions/repeats/rows preserved. Independent schema remains red.
Artifact10399581944 ZIP SHA256
0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af is downloaded
and verified. Added grants1488 ->1457 exactly match24inbound+7tenant removals;
other diff counts are unchanged. Replay document SHA256
8517999aa05f2403937d47f4ca171435488b73f53d651e5926d6c466096707e9.
824f24d4 ordinary native34974499849/job104398696940 and9f1 native34975955484/job104403604836 remain in progress.
9f1 auth-email-source-effects104403605322 fails at canonical-governance-selftest.py;
artifact10400015487 metadata identifies the failed command. Local reproduction
confirms stale historical lexical-group count347 versus348 after exact forward
ordinal518. A reviewed adapter admits the exact finite suffix before preserving
347/335 historical fixture assertions in3 constructors.7 helper tests and3
constructor modes pass; actual SQL rerun pending. Historical auth SQL unchanged.

The next reviewed batch wires actual actor qualification after all4forwards on
both owned runtimes. Exact128 changed policy hashes, actual auth helpers/role
attributes,2496 typed-row policy cases and rollback are mandatory. This evaluates
policy composition, not every business-table DML/trigger or application graph.
A failed actor run prevents completed-tail/schema collection. The coverage audit
and machine-readable1296-row register explicitly keep unresolved classes blocking;
they are NOT a schema acceptance whitelist or a refreshed reference.

A separate staged22-table TRUNCATE candidate completes the discovered added
TRUNCATE base-table scope:29new protected base tables,7already repaired+22remaining.
28other new-relation TRUNCATE rows are views and classified separately; they are
not silently claimed inert. Exact22 source contracts and44catalog hashes are
reviewed. Actual PG17 and genuine CLI filename are required before a fifth source
is promoted; current runtime still has exactly4. The candidate rejects inherited
owner authority and preserves every other principal/privilege/policy/row.

Actual163e8dfe portable34971038792/job104387127532 completes144+514+2 and all
forward postcondition/repeat/row-preservation controls. Independent schema remains
red: removed constraints11 ->9 and added relation grants1512 ->1488 exactly match
the two repairs; remaining difference categories are unchanged. Artifact10397506091
ZIP SHA2569f354091b31b7e3ee2dfbb1ad6b9bb117d0d6e0722fcad5d40024563959597a6.
This does not prove official native ledger acceptance.

Five unchanged, exact-byte-pinned existing final SQL checks are now wired inside
the owned native lifecycle after complete historical and forward ledger admission,
before disposal. They require per-check schema/row/ledger preservation; this is
not schema or type acceptance and has not yet executed against the complete target.
Two additional source-qualified privilege candidates now passed actual PG17 and
are promoted byte-for-byte under their genuine CLI-created filenames:
20260915132224_restrict_inbound_service_table_privileges.sql and
20260915132227_restrict_new_tenant_table_truncate.sql. Runs34974499866 and
34974499894/jobs104398695222 and104398694965 are SUCCESS; exact archives and
receipts are recorded in PR310_FORWARD_PRIVILEGE_PROMOTION_2026-09-15.md.
The runtime admits exactly4 forward sources AFTER unchanged144+514, with real
CLI post-body/ledger failures, rows/ledger preservation and no-op repeats.
Current605 inventory separately binds historical601 and historical514 selection.
The full portable144+514+4 chain is now verified above; full native evidence remains pending.

Synthetic CLI typegen preflight is now wired into the short clone workflow. It
uses the actual2.101.0 --lang syntax on only the owned internal network; two
identical outputs and full native state/ledger preservation are required. It
exports only a hash/size, never application type acceptance. The actual synthetic typegen
preflight is now verified above. Existing application types/manifest remain
unchanged. A native full-schema comparison now runs after5existing final SQL
checks while the native target remains live, and exports identities/hashes only
after cleanup. It keeps the synthetic probe visible and schema acceptance false.

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

Native fd4fb907 OPS34967447036/job104375186062 also fails cloning during the
new full-snapshot qualification, before timestamp execution.70ce549f completed
failure after the T8 positive restoration; actual accepted boundary remains144
foundations and timestamps1–7. Auth and quality-release-gates on70ce549f pass;
verify still fails the genuine generated-types migration-tail guard.

Next: complete reviewed forward admission and actual ledger-dependent readiness
T257/T262/T275/T351 behavior qualification without synthetic historical ledger
aliases. Publish coherent reviewed batch, collect native144+514+4 SQL controls,
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
policy changes/removals and grants to source/application evidence. Column/default and removed function-grant dispositions have source-backed audits.
Some policy and control-view capability dispositions remain OPEN; full schema
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

Working-tree accounting is 607 inputs: 595 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 348 inputs: 336 selected, 2 substituted, 5 unclassified, and 5 excluded.

The six admitted forward sources remain separate from the immutable historical selector.
No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
