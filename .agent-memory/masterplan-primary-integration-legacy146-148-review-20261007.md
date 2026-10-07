# Primary integration reviewer checkpoint — legacy146/148 refresh

Agent: primary-root-existing-integration-reviewer. Role: reviewer/unblocker.
Base: d0a655ce192f2c3d6cced06cab91898b0f7ad9b4.
Task: refresh OWN earlier retained #146/#148 residual review against actual current source; no implementation takeover.
Status: READ_ONLY_IN_PROGRESS. No ID, source file, memory-role or merge-role reservation.
Prior completed integration614/615/616 and Web43 remain done; historical #530 receipts preserved.
Before-task receipt: https://github.com/heke99/gridex-ops-platform/issues/673#issuecomment-6044664380
Coverage read:115 VERIFIED rules+185 PASSED contracts=300/352;52 unapproved. No promotions.
Routing: using-superpowers/code-review/verification-before-completion and cloud-runtime. No broad audit, implementation, native producer, artifact download or duplicate test execution.
Next: read own historical findings then exact current processor/poller/reprocess/hash code. Record delivered/reusable/unverified residuals and named owner/resume condition. Read-only review owns no foreign implementation.

## Source review complete / retained-owner handover

Actual main was reread unchanged at d0a655ce. Fresh #146/#148 GETs: CLOSED_UNMERGED, original heads08cbe8db/17704bff and branches preserved. Earlier OPEN wording is historical.

Confirmed source residuals (not new executed runtime proof):
- HIGH terminal synchronization: actual facade exports implementation from edielMailboxPoller.part-2.ts; syncActiveInboundProcessingJobForMessage at595 still filters status at607 to queued/retry/received/processing/manual_review. done/failed cannot be selected and it returns false on no matching row. Old implementation path must not be patched as if still monolithic.
- HIGH reason plumbing: processor return type at77 and manual-review returns provide no reason. Admin actions284 passes only outcomeStatus; queued worker663 passes only step. finish568 selects input.errorMessage then input.step, so opaque manual_review remains a possible persisted review_reason. Existing meaningful message error text (e.g. missing payload203/DSN124) is not carried to the job by these calls. Preserve current technical-only/DSN/attachment/ACK/duplicate-response branches when restoring reason propagation; do not replay the old processor wholesale.
- MEDIUM resolution: finish551 has no resolution input or done closure stamp; sync passes no reprocessed resolution. No behaviour/native test was run by this reviewer.
- Original forward filenames20260814210000 and20260814235000 are absent from COMPLETE recursive main tree. Filename absence alone DOES NOT prove missing equivalent SQL behaviour or request-hash defect. Current E5 atomic-hash/runtime classification remains NOT_REVIEWED, not a newly confirmed failure. Qualified equivalents require separate original-owner review.
- ALREADY DELIVERED/source aligned: both current go-live summary78 and verify144 call selectTenantWebsitePrimaryClient. Current selector26 preserves canonical JSON-text/environment and active-before-paused semantics. Do not restore old selectPrimaryTenantWebsiteClient or old boolean-only fallback; no new website bug claimed.

Exact source blobs:
- lib/inbound-mail/edielMailboxPoller.part-2.ts @ 3eb74c63e637c7953d7a916a7c531f3760b6e615
- lib/inbound-mail/edielInboundProcessor.ts @ 9e606c7b44ce7e00c548bedca41e76006837e03f
- app/admin/inbound-mail/actions.ts @ dd52419c8ed455b36b0dd98640a8af4222987b66
- lib/integrations/tenantWebsiteClient.ts @ ae0da58018e2c156abeb7b3f1435e1ec024476cb
- lib/integrations/tenantWebsiteGoLive.ts @ dda7e458c1d4e7bab96dc80db919ce0ec95e1774
- app/admin/platform/go-live/actions.ts @ 093699c797753d1110fa84f51f548563e5b9f5fa

Custody: original #146 Processa-om operational author, preserved cursor/codebase-health-and-stability-4764; #148 operational/hash author, preserved cursor/codebase-health-and-stability-e446. No current takeover/handoff was observed. Fresh134 atomic refs: no exact locks on three processor/poller/admin implementation paths, but ref absence does not transfer retained custody. Explicit owner confirmation/handoff and new exact claims are required before implementation.

Next concrete implementation unlock: original owner or explicitly handed-off implementer takes current split source and proves (1) done/failed→manual_review reopen and manual_review→processed closure with reprocessed stamp; (2) missing-payload/tenant/match reasons through BOTH worker and admin path, keeping protected tenant/technical-only/DSN/ACK/newer branches and failed/retry guards. Behaviour tests must call code and assert job/message/audit effects; historical source-string tests are not sufficient whole proof. Backfill migration needs fresh forward-only SQL/equivalence review, registration, genuine generation/parity and mandatory current-head checks. No retained #146/#148 wholesale merge or automatic Masterplan row promotion.

Checks: complete current-main source reads, complete original PR file inventories read; current PR states/head reads; complete recursive tree nontruncated; current remote locks; main unchanged. No test execution, DB connection, native producer, artifact fetch, source edit or CI rerun. PR680 exact98779 metadata observed clean-migration-replay and pr-certificate still IN_PROGRESS; no green/merge inferred and original1df owns delivery. Other CORE/GEN/current native owners remain active on673.

Status: REVIEW_COMPLETE / HANDOVER_READY, no reservations or role locks held. Reviewer may resume on explicit retained-owner handoff or a current ready review not already assigned; implementation stays with its confirmed owner. No claim that the Masterplan or current code is wholly accepted. Coverage300/352 unchanged.


## E5 resumption — before source comparison

Scope: unresolved own E5 atomic request-payload/hash equivalence review only, main d0a655ce; before-task6736044762283. Original processor/selector review stays complete. No source/ID/role custody or producer/test/artifact duplication. Next trace exact registered final SQL and command consumers for production transition, first-live-send, provision, actor profile and user access; report genuine equivalence/gap and native proof boundary. SOURCE_REVIEW_IN_PROGRESS.


## E5 current-source equivalence — completed independent review

Exact base main d0a655ce192f2c3d6cced06cab91898b0f7ad9b4. Current committed supabase/schema.sql downloaded once into OWN /tmp/gridex-primary-e5-schema-d0a655.sql; git hash-object762a574163ba39c60fef6386912c79b83ed53f9d matches official current file metadata. SHA256e7b55509430bc0ab2416ffd65120299f74f27201bcd0b239012b2e1bfc85d852. Initial connector oversize/empty-range source reads did not prove anything; only actual complete source/hash binding used. This is source, not a native artifact or live database.

Completed primary + independent e5_hash_equivalence_review read-only review. Narrow invariant after wrapper cache binding: request_hash=canonical_json_sha256(request_payload). No new implementation required for this invariant in these five CURRENT committed-schema flows:

| Flow | Current source evidence | Disposition |
| --- | --- | --- |
| Production transition | schema40711 wrapper hashes full v_request40736; atomic pair40775-40777; both unchecked branches return to it. Registered forward20260902094600_fix_canonical_transition_request_hash_rewrite.sql at83-84. | Current equivalent delivered; do not import old148 replacement. |
| Actor profile | schema40019 enriched v_defaults||p_command; hash40020 and pair40031-40032 both use v_command minus actor; later40123 updates result only. Registered forward20260815002945_fix_actor_profile_hash_and_authoritative_projection.sql patches only pair without weakening hash guard. | Current equivalent delivered; broader profile/replay approval not claimed. |
| Company provision | public37994 calls v3_pre_invitation_intent38125. Internal generated company_id is not substituted into original outer request; pair38180-38182 and38185-38187 bind original request in both tables. Registered forward20260817210500_fix_canonical_provision_company_request_hash.sql83-89. | Current equivalent delivered; preserve current initial invitation handling. |
| Tenant user access | public36402 -> pre_staff36465 -> v2_unmapped36717 -> unchecked; pair36749. Staff enrichment36435 subsequently rebound to original outer request with pair36444-36445. Registered20261004083640_staff_user_commands.sql343 plus current outer staff wrapper. | Current equivalent delivered; preserve role/permission/membership/lock-order chain. |
| First-live-send approval | v_request35383 EXACT SAME jsonb_build_object('readiness_check_id',p_readiness_check_id) as unchecked insert35473-35475. Payload-only35409 does not change hash input. | Prior assumed hash-mismatch class is FALSE_POSITIVE for this current path; do not add a cosmetic forward on that premise. |

Common guard: current schema36824-36837 refuses mismatched supplied/existing hash then computes/binds actual payload hash; trigger145255 runs BEFORE INSERT OR UPDATE OF payload/hash. Hash function37473-37479, cache request_hash NOT NULL103316. Complete scoped schema scan found no additional command-cache trigger/rule/trigger-disabling override. Current first-live-send caller app/admin/companies/[id]/ediel-actions.ts409 actually invokes this public RPC; companyUserAccess137/181 invokes public access command.

Current main Git-tree migration pins compared to original local Git-tree bytes BEFORE using local source: security convergencec29053a; actor repair358ee8b; provision repairc071703; transition repairb6d678b; consistency31689ae; staff commandscef7908; staff lock-order80d43cf. All match current main. Current canonical/additions manifests read: the actor, provision, transition, consistency and staff forwards are registered; runtime-additions contains no extra matching override. The complete current schema supplies the final callable chain, not the old monolithic PR.

Existing behavioural proof pointer scripts/gridex-canonical-provision-request-hash-regression.sql blob59e49483: real public provision RPC, exact paired hashes in both caches, one company/command, replay and changed-payload refusal, full rollback. Read only; NOT rerun/not new PASS. Existing user staff guard/provenance tests likewise not rerun or borrowed. First-live-send current native full proof remains unqualified here; source equivalence is not CI/native/production delivery evidence.

Limits: no live DB/native execution, migration-to-schema parity, current CI qualification, full #148 acceptance, profile-default replay/global auth/security audit or rule promotion. Prior first-live unreviewed warning is narrowed by direct evidence, not a wholesale supersession. #146/#148 originals remain CLOSED_UNMERGED and preserved; the earlier current processor/terminal/reprocessed/backfill criteria retain their exact documented gaps.

Next ownership/result: original operational authors of146/148 or explicitly documented recipient should implement the remaining TWO processor effect groups under fresh exact current split-file claims, with real worker/admin tests and negative-flow preservation. For E5, reuse the named delivered forwards/current guard and qualify only genuinely remaining full-current-native/effect boundaries; do not recreate old2350SQL or change checksums/generated outputs. Original146/148 file handoff still not observed; no source takeover.

Latest current source reviews682 already have TWO owner-attributed approvals; review-acc382 owns its supplemental check and SC054 next source lane. READ680/H677/CORE/GEN/native/source680 and682 observers remain named on673. No competing reviewer/test/artifact operation selected. Primary's unfinished E5 source question is now complete, unique own checkpoint retained. Status REVIEW_COMPLETE/HANDOVER_READY; no ID/source/memory/merge locks held, none need deletion. Resume on an explicitly handed-over original scope or a fresh unassigned exact-source review request; occupied work continues with its owners.
