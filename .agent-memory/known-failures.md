# Known failures

## KF-001 — Overloaded energy `automation_allowed`

Status: FIXED_VERIFIED

Purpose-specific loaders and capabilities now keep pricing/quote independent
of customer-specific switch/PRODAT readiness.

## KF-002 — Internal IDs in public application payload

Status: FIXED_VERIFIED

The website application route now applies an explicit public DTO sanitizer and
regression coverage.

## KF-003 — Pricing runs exposed as invoices

Status: FIXED_VERIFIED

Portal invoice list/detail load only persisted `customer_invoices`.

## KF-004 — Git provenance unavailable

Status: BLOCKED

The uploaded archive has no `.git`; branch, commit and original dirty-tree state
cannot be verified from this input.

## KF-005 — Database apply unavailable

Status: READY_FOR_AUTHORIZED_OPERATOR

The new forward migration, preflight and post-apply are static-verified but
cannot be applied or transaction-tested because an authorized database
connection is absent.

## KF-006 — Live contract behind release candidate

Status: PENDING_DEPLOY

The live developer page observed on 2026-07-25 exposes an older contract than
local `2026-07-28.1`.

## KF-007 — Noncanonical remote/local migration history

Status: REPAIR_POINT_IMPLEMENTED_BASELINE_PENDING

Only nine remote historical migrations are registered and their
versions/content do not match the current local chain, while later definitions
exist live. The new repair migration safely converges current objects. A clean
baseline still requires the verified post-apply schema.

## KF-008 — Exported active live function failures

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

All 23 lint errors are covered and all 41 exact function patches match the
exported definitions. Production closure requires applying the migration and a
green postflight.

## KF-009 — Reduced compatibility components in signed website snapshot

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Website onboarding previously wrote
`compatibilitySnapshot.priceComponents` instead of the quote's exact resolved
components. V6 now requires and freezes the quote arrays, and database binding
rejects mismatches.

## KF-010 — Internal catalog contract copied loose scalars

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Internal customer registration now selects a stable option, verified SE row,
invoice method and allowed components, then commits the customer contract and
immutable price snapshot atomically through a service-only RPC.

## KF-011 — Portal signature evidence contract drift

Status: FIXED_VERIFIED

The portal database projection selected `signature_snapshot_sha256` and the
developer guide documented it, but the public DTO and Customer Portal OpenAPI
omitted it. The final go-live regression exposed the mismatch. DTO, release
generator, OpenAPI and a direct regression now agree.

## KF-012 — Recursive sanitizer removed public legal bundle IDs

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

The external DTO sanitizer removed nested keys ending in `_id`, including documented `legal_bundle_version_id`. Legal output is now rebuilt through an explicit strict serializer with parity coverage.

## KF-013 — Public price-option canonical field drift

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Database publication rows use `is_default`, while prior public schema logic treated `default` as canonical. The public model now uses `is_default` everywhere and emits `default` only as an identical deprecated alias.

## KF-014 — Uploaded historical price-option migration checksum mismatch

Status: RELEASE_BLOCKER

The trusted checksum for `20260730220000...` remains `0ab350f0...`, but uploaded bytes hash to `978de5e9...`. No historical checksum or bytes were rewritten by PHASE-36. Resolve from authoritative source/ledger.

## 2026-09-04 — FALSE POSITIVE: "no cron job has a lock" (plan Fas 16, §19)

Do not raise this again without reading the handlers.

Grepping the 21 cron route files in `vercel.json` for lock keywords returns
zero hits, which looks like every scheduled job runs unguarded. It is wrong.
The routes are thin: they authenticate and delegate. Concurrency control lives
in the handler and, below it, in the database.

Checked end to end for `/api/ediel/outbox/process`:

    route -> lib/ediel/outbox/processEdielOutbox.ts
          -> lib/ediel/outbox/claimOutboxItems.ts
          -> rpc claim_ediel_outbox_items
             (supabase/migrations/20260618200000_ops_production_hardening_resolver_queues.sql)

That function selects `where status in ('prepared','queued') order by priority,
created_at limit least(p_limit,100) for update skip locked`, flips the claimed
rows to `sending` in the same CTE, and separately recovers rows stranded in
`sending` to `delivery_uncertain`. That is claim-based concurrency with a batch
limit and stale-claim recovery — stronger than a global advisory lock, since it
lets workers run in parallel without starving each other. The migration that
introduced the pattern is even named `..._multitenant_integrity_and_claim_locks`.

Lesson: route-level greps say nothing about this codebase's job semantics.
Any Fas 16 audit must trace route -> handler -> RPC before classifying a job.

## Disproved: "relations, columns, functions, indexes and triggers match canonical exactly"

Recorded earlier in this project from the first production parity attempt. It is
WRONG for triggers, and the mismatch is the tenant guards. Production carries six
BEFORE ROW tenant-attribution guard triggers that the canonical chain does not
build at all. The harness that produced the original claim could not see them.
Evidence and the full register: `quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md`,
finding F-PARITY-4.

## PG17 replay proof pitfalls — verified 2026-09-10

- Internal catalog char concatenation: text concatenated with pg_depend.deptype
  produced ambiguous-function42725 in the new repair catalog. Explicit text cast
  correction07f58c3a verified through actual catalog00000 at a38fbd6d and later heads.
  Apply the same check to new internal-char catalog operands; do not drop dependencies.
- Sequence rows have no composite row type (pg_class.reltype0). Whole-row to_jsonb
  on a sequence produced wrong_object_type42809. Correction96cea061 captures and
  compares last_value/log_cnt/is_called explicitly in snapshot/admission/assertions;
  r/p full-row comparisons remain. Actual called/uncalled controls and complete
  batch/repeat passed at017d47e7/517fdb1a respectively. Never remove sequence checks.
- PL/pgSQL record-variable and SQL whole-row alias collision produced42702 in
  admission. Correction4fc34ae9 uses a distinct qualified role_row alias; actual
  complete batch and repeat passed at517fdb1a. Check ambiguous aliases before hosted
  execution; do not change variable-conflict resolution to hide ambiguity.
- Test assertions using IF NOT(condition) accept NULL. T11-R1 uses IS DISTINCT
  FROM true; actual true/false/NULL/empty-scalar/NULL-scalar controls passed at017d47e7.

These are bounded proof-tool corrections, not full replay or production acceptance.
Current status and remaining gates are exclusively in current-state.md.

## Task15 B0 equal-timestamp oracle reuse — closed by review and native execution

At3b3b508a OPS34554272047 fixed-target job103123464997 passed12 cases then
failed FULL_PK_FIELD_ORACLE_MISMATCH at reduced_match_tie, exact cleanup PASS.
Original B0 ORDER BY created_at has no tie-breaker; repeat_rollback reused the
winner from a prior rolled-back source execution. A tied candidate may differ
per whole execution. Correction must independently match one complete legal
preimage-derived candidate postimage each time, retain all PK/field/catalog/
sequence/dependent checks and reject hybrid effects; never force a source order.
Native failing substage not disclosed/observed. Author fix1 in progress; no
full SQL acceptance or source selection inferred.

Task15 T15-F1 correction4ed89ff5 independently ADDRESSED with no new findings;
meaningful synthetic four-sequence red/green and full negative controls PASS.
Corrected native acceptance pending, not inferred from old-head receipts.

T15-F1 native CLOSED:35136233/job103126766378 B0 reduced_match_tie and all B0
cases PASS. Subsequent C2 actor-FK expectation failed; separate fix2 diagnosis.

## Task15 actor FK name overconstraint — C2 native verified; shared D2 lane pending

At35136233/job103126766378 C2 reduced_actor_fk actually returned SQLSTATE23503,
but validator demanded only fixed_actor_fk. Reduced fixtures retain the original
invited_by→auth.users FK too. C2 staleFOUND reaches invitation INSERT; D2 ROW_COUNT
reaches membership INSERT.5ad9c68f validates exact closed names only when full
preimage FK definition and primary-error table/constraint match intended actor
relationship. Full rollback/disposal unchanged. Targeted real-runner synthetic
RED old failure→GREEN, wrong state/table/parent/column/kind/name/catalog/rollback
negatives PASS. Native error name not disclosed/guessed. Scoped review pending.

T15-F2 scoped independent review ADDRESSED5ad9c68f, no new findings; native
corrected acceptance pending.

T15-F2 corrected C2 reduced_actor_fk PASS23503 atf5435f8f/job103129093787.
Shared D2 lane remains beyond current first failure; no full proof closure.

## Task15 invalid inactive fixture status — reviewed correction, hosted pending

Atf5435f8f/job103129093787, C2 actual_null_company_role setup fails before
source RESULT. Shared role_row/other_target_role use inactive, disallowed by
retained user_roles_status_check; disabled is the valid synthetic inactive status.
Immutable F2 later writes inactive for old-user roles, so affected actual lanes
must preserve native CHECK rejection/full rollback and use explicit reduced
fixtures for otherwise unreachable historical success. Same-class shared
fixture/status audit spans C2/D2/F2, no canonical guard/source weakening.

T15-F3 correctioned9ce0ca independently ADDRESSED with no new findings;
10-case seed-domain red-green and strict reduced/native classifier/privacy
controls PASS. Actual new-head SQL acceptance remains pending.

## Task15 D2 missing role type cast — reviewed classification, hosted pending

Atff33ce80/job103132524843 reduced_membership_column_absent returns42601 but
runner expects success. Pinned D2 leaves v_membership_role_type NULL when
company_memberships.membership_role is absent, then interpolates it into
a dynamic cast when company_invitations.membership_role remains present.
Native error substring not exposed/guessed. Correct the historical lane to
require syntax failure/full rollback; add explicitly reduced both-column-absence
whole-source success/repeat if source-supported. No original source/schema/helper
weakening; bounded initialization/use audit and targeted regression pending.

T15-F4 cd9bb843 scoped independent review ADDRESSED, no new findings. Shared
nonzero-exit guard makes interim missing-exit allegation a retracted false-positive.
Corrected native rejection/new reduced success and full102 acceptance pending.

## Active Task15 final privacy blocker — recovered 2026-09-11
At2bbcdab8 all102 native cases pass, final103137885579 fails
SOURCE_LITERAL_IN_PRIVATE_ARTIFACT. Exact known matches are four pinned accepted
whole-source inputs and generated repair-admission.sql. Required correction is
finite canonical physical writer/byte provenance for whole inputs and no physical
generated admission (per-handle memory/stdin), with other artifact/collector guards
unchanged. Unpublished43b90fd0/report lost after environment restoration; a recovered
implementation must earn fresh review and native acceptance. Earlier Task15 F1-F4
native blockers are closed at2bbcdab8, not separate active work.

2026-09-11 fe0379e4 follow-up: all102native/all19/quality/EdielPASS but finalprivacy
stillFAIL. Additional exact source-pinned nonempty-reference reproduction finds
legacy envelope-context.sql and repair-context.sql containing a pinned stored
function body. Prior empty-reference writer audit could not detect these. Approved
scope virtualizes both contexts, retaining generated admission memory; only adjacent
generated repair controls coalesce, no original whole-source/guard change. No general
client-output leak inferred. Implementation/review/native acceptance pending.

2026-09-11 Task15 final privacy blocker CLOSED by actual native acceptance at
e2bb1a9becc07989181405ddccdbdcae173d36d4. Fixed-target103222123596 in
OPS34586595826 passes all102 (18/25/28/31), final complete-private scan and
ownedcleanup. Additional populated-reference correction5b083ba7 independently
APPROVED; exact generated contexts/admission stay private in memory, four whole
inputs retain finite trusted physical/source provenance. Same-head all19/actual
52+56+57/quality/EdielPASS. Earlier F1–F4/native and recovered privacy follow-ups
are closed within Task15, not ongoing production or full-replay acceptance.
Current blockers remain remaining54source effects, native ownership/official-ledger
replay, generated types and full masterplan gates; see current-state.md.

2026-09-11 Task18 first hosted boundary at633a9cf0, OPS34591510426,
continuation103237628157 FAIL: constructor PASS, native terminal category
FIXED_FAILURE_PRIVACY_REJECTED; exact owned cleanup PASS. Native source
acceptance remains OPEN. Original author resumed for narrow source-backed fix1;
independent review required before next coherent publication. No retry/waiver.
Same-head clean103237628240 rejects unsupported native mode before replay;
verify103237628107 fails generated-types check. Existing gates remain enforced.

Task18 diagnostic native aec7a34f OPS34592482485/job103240714820 confirms
H2_COMPLETE cause EMPTY_FIXED_BUSINESS_REQUIRED, privacy
SOURCE_LITERAL_IN_PRIVATE_ARTIFACT, disposal VERIFIED; final wrapper FAIL and
owned cleanup PASS. No speculative SQL finding; author fix2 from ccd5cefd
diagnoses exact accepted-prefix rows and retained artifact. Root preserves strict
privacy/closed admission; underlying actual63 still unaccepted. Task19 sole-doc
ccd5cefd is under independent read-only review, no selection or SQL claim.

Task18 fix2 contract correction required (no implementation yet): immutable first
input01_db1_schema_repair_core_helpers_and_canonical_tables.sql:513–515 inserts
an initial public.companies row. Task16's empty-companies/one-new-company
assumption conflicts with the actual accepted prefix; runtime correctly rejects
EMPTY_FIXED_BUSINESS_REQUIRED. User explicitly requests correcting the entire
plan and broken points, authorizing this factual contract correction without
renewed permission. No blanket seed exemption, deletion/recreation or second
company is approved. Author prepares exact source-bound sole-company reuse/PK/
P-materialization/S1/cleanup preservation amendment for independent review.
Private artifact cause remains separately under source-backed diagnosis.

54ae6759 new native continuation103250143594: standalone six whole inputs/
restoration/disposal/canary/finalprivacy PASS. Actual staged shell reaches
actual_replay_foundation63/bounded success, then test's stale-handle assertion
wrongly calls patched observation wrapper, which asserts empty submissions and
H2_COMPLETE despite SUCCEEDED/six inputs. This is a proof-wrapper defect;
original trusted stale-handle denial must be exercised. Fix3 sole author active,
no runtime/SQL/privacy changes required. All remaining native fault modes pending.


2026-09-11 Task18 native blockers CLOSED on6c9e05d2: complete actual63/full fault/death/privacy proof103253167529 PASS after reviewed fixes1–3. Historical19 initial103253167445 failed reduced controller cleanup with masked category; exact runtime/job unchanged from passing54ae6759. One targeted retry103257042591 PASS complete standalone/actual57/controller death/privacy/cleanup at12:20UTC. Initial cause remains unclassified/nonreproduced, no assertion of specific infrastructure cause; preserve diagnostic report and initial failure if it recurs. No code change or weakened guard was justified by this transient occurrence. Fullnative/types gates remain open.


Native replay follow-up (source-level, dormant behind existing fail-closed target/full-effects gates): scripts/gridex-aud-003-clean-replay.sh:429–448 prints required presence/runtime-shape booleans without asserting IS TRUE. ON_ERROR_STOP alone accepts false/NULL SELECT results, so these lines cannot certify readiness. Existing fingerprint rejection remains effective; no live missing object or current green native run is claimed. Before native restoration closes, replace this printed-status acceptance with explicit true-only assertions and meaningful negative coverage. The workflow210–315 also assumes a CLI stack/start-stop lifecycle removed from the current compatible-only script; restore actual owned native lifecycle/private logging before running its downstream regressions/typegen/snapshot, rather than relabeling synthetic transport or unreachable ledger code as official provenance. Root's bounded details are in ignored downstream-native-types-routing.md; fullnative/types remains OPEN.

2026-09-11T13:24:56+00:00 Root separate bounded DB2 live-catalog receipt: Supabase get_project confirmed piidsfebjqjmnepdpnas, name gridex-ops-dev, ACTIVE_HEALTHY, PostgreSQL17.6.1.084. One BEGIN READ ONLY / exact four-label pg_class-to_regclass SELECT / ROLLBACK returned public.contract_agreements=NULL, public.customer_delivery_points=NULL, public.customer_profiles=NULL, public.document_ai_extractions=r. Thus first three relations are absent in this connected project's currently observed public catalog; document_ai_extractions is ordinary table. No customer rows, definitions, secrets or mutations read/executed. This is root supplemental evidence outside Task23 source-only author/reviewer scope, not an actual63 native-prefix receipt, live production-binding proof, full parity acceptance or permission to invent prerequisite schemas. Runtime project binding remains unproved. Task22 hosted exact-prefix receipt remains separately required.

Task23 review source-contract findings (not live exploitability): nullable p_apply reaches writes while dry-run key is selected; nested unique run-key upsert serializes same-key bodies, contradicting the initial interleaving oracle; explicit profile active_company_id synthesizes company_admin without invitation/role authority; mapping/readiness accepts inactive links unlike engine active-only matching. Original static map needs I1–I4 corrections; immutable historical SQL remains unchanged. M1 viewcount and M2 local counter survival after row-subtransaction rollback are adjacent minor corrections. These source facts inform private characterization and later separately reviewed forward disposition, not new runtime grants or live data repair.

Root bounded prerequisite history check: repository is nonshallow,3891 locally reachable commits. Two git log --all -G searches scoped only to supabase and CREATE TABLE definitions for customer_profiles/customer_delivery_points/contract_agreements (unquoted/public-qualified and separately quoted identifiers) completed exit0 with no matching commits. This adds no source-backed supplier for those three historical dependencies; it does not rule out multiline/dynamic DDL, external/unreachable history or out-of-band old schemas. No fetch, source change, row read or SQL execution. Preserve missing-prerequisite status and use explicit reviewed historical-characterization/forward-disposition contracts, not invented accepted tables.

Task22 implementation review ACCEPTED after scopedfix14b85b355e3ff52d48de8515a5562db8ae55923f (BASEcfbc9f46,2testfiles111+/1-). I1 wholeAexistingparsedpayload/NULLtimestamp/UUID/emptycount coverage and I2 rollback-only postC inheritedEXECUTE/direct+inheritedcolumnWrevocation both addressed; independent spec+quality APPROVED nofindings, fullreport read by root. Focused1guardRED/GREEN,2AST/whitespacePASS. P/Wpins/runtime/accounting/workflow unchanged from55f29c50. NativeSQL/completePG17/fixture/catalog/privilege/death/privacy acceptance pending; Task22 notcomplete, A/B/Cstillunclassified. Task21design5bdee189 and Task23mapcfbc9f46 independentlyapproved. Coherent nextpublication includes these reviewed changes and rootmetadata; no prodaction.

Published1d6f75ede1606c084fc39e26796768e5665016e0/tree33f3a960d2801131b38aa78ca11ab8c718ef1fde exactreviewed27filebatch (localeb902cf779a8487377a9716e2abfa988222fae66 archived archive/alignment-reviewed-eb902cf7). Payload1158096chars/10partsSHA32d0902b56977a609255c403e0e30acc0411da15ce1536291ceb6a8b8a525d6c; GitHubtreeequalslocal, nonforceref/fetch/localalignmentPASS, originalcache/stash/otherworktreepreserved. PR310bodyupdated. OPS34606383824newalignment103285713102 FAILED:10constructorsPASS13:48:08.492, genericPRIVATE_PROOF_FAILED13:48:43.526beforefirstactual63catalogreceipt, ownedcleanupPASS. Exactcauseunproved, no newnativeacceptance/A/B/Cselection. Ediel103285712932/tenant34606383811PASS; clean103285713024FAIL; otherspendingcollection. Task22fix2 scopedauthoractive, no blindretry or guardweakening. Fullplanopen/noproductionactions.

Currenthead1d6f75ed additional CI receipts: OPS34606383824 quality103285713039, repair18/actual56 103285712745 and legacy17/actual52 103285712936 PASS; Ediel103285712932 and tenant34606383811PASS. Browser-public103285713088 and coverage103285713242PASS; skippedstaging/load/real/runtime/nightly/full notaccepted. Completedclean103285713024 log confirms exact unsupported native/external target beforeSQL; completedverify103285713017 and smoke103285713426 logs confirm generatedtypes tail20260911114443 guard. PRcertificate103286166269correctlyFAIL. No generatedtypes/tailhash refreshed or guardwaived. Remainingauth16/historical19/full102/continuation jobs stillpendingcollection.

Task22 fix2 diagnostic-only8092b6376e01ed0c0b9d3fa8cf000667f2a94c9c (BASE1d6f75ed,1selftest161+/31-) independently spec+qualityAPPROVED nofindings; rootreadfullreport/review. Closed first-stage/exacttype/finitecategory receipt, unchanged inheritedrun/exactquerysuccesspredicate/failurepropagation. Focused2RED/GREEN+2seamGREEN/AST/whitespacePASS. FirsthostedcauseUNPROVED; diagnosticreview doesnotresolveSQL/ownership/oraclefailure. Onehostedfollow-up needed. Currenthead1d6f75ed historical19job103285712900PASS; onlyactual63continuation103285713126 stillrunningamongpriorboundedgates. Fullnative/types/productionremainOPEN; no guardweakening/rerun/prodaction.

Diagnosticpublication29c419f0d8b06b8ceae14d4b49267ee89e77b9b8/treea0ba1a79ea9ad370bb2b3c22e46333db0a88db8c exact9file689974char/6partpayloadSHA150f4d0e358f16ecfd6033ec361d5e2495fa63a9791a2a96feed4231f6444f4f; nonforce/fetch/localalignmentPASS, local3f6ce2c42c463301b3fde3361b02933a36643df5 preservedarchive/alignment-diagnostic-reviewed-3f6ce2c4. PR310updated. Prior1d6f75ed allboundedpredecessorgatesPASS including historical19finalactual57controller13:56:29.397 andcompleteactual63continuation14:01:19.195/finalprivacy/cleanup14:01:19.694; no cancellation/retry/guardweakening. NewOPS34607798880/job103290440301FAILED14:03:22:14constructorsPASS,closedstagecatalog_equality/typeBOUNDARY/categoryBOUNDARY_REJECTED,cleanupPASS. Snapshotqueries/referenceDecode completed; independentlyconstructed vsactual63catalogdifferenceunlocalized. Source-stateequality/fourlabelreceipt not reached. Task22fix3 scopedauthoractive, no causalfixclaimed or comparator/projectionrelaxation. Fullplanopen/no prodactions.

Task22 fix round 3/5: e3c0db35bf76a594d2491bc1929bb4114c203adf independently spec/quality APPROVED with no findings; root read the complete review. Two-file diagnostic adds only finite catalog kind/change/field labels and integer counts, preserving exact comparison and operands. Two focused RED/GREEN tests, two AST parses and whitespace passed. Native cause remains unproved; publish this reviewed batch for the next isolated PG17 observation. On published29c419f0, OPS34607798880 original16/17/18/19/full102/actual63 continuation, quality and Ediel jobs all completed successfully; tenant34607799117 and browser34607798980 passed. Alignment103290440301 failed at catalog_equality; full native/types remain open. No production action.


2026-09-11 published5ec9b426/tree00fc09bf: exact reviewed19-file tree, nonforce
ref/fetch/local alignment passed; reviewed history retained. OPS34620219856
alignment103332040645 passed23constructors/actual63/catalog-source equality/
diagnostic binding, emitted four missing relation labels, then QUERY_DATATYPE
(42804) in native_cases; cleanupPASS. Dedupe103332040656 passed constructors
then BoundaryError before any SQL/first43 receipt; cleanupPASS. Exact cause
unproved and runtime files unchanged from passingd060. No retry or causalfix.
Auth/legacy/repair/fixed102, Ediel, quality/build and complete actual63
continuation/fault/death/privacy103332040184 PASS (final16:21:09Z); tenant and
public-browser PASS. Verify and E2E smoke both stop on existing generated-types
tail20260911114443; smoke14/15, coverage/P0contractPASS; runtime/staging/full/
nightly skipped. Clean native ownership/reference/private logging stays blocked.
No source-order/accounting/native acceptance/production change.


2026-09-11 bounded diagnostic instrumentation VERIFIED locally and independently
approved without findings: alignment7ac14cdc (24constructors; four injected
oracle/mutation+cleanup RED/GREEN), dedupefa6828b (all constructors; six actual
startup/reference/actual56+cleanup seams and closed-payload negatives). Root
read both complete reviews. Normalized AST checks retain preexisting SQL/guards/
operation order. Dedupe first receipt is only the first exception reaching its
instrumented context; no claim to recover internally replaced exceptions.
Unchanged group/status test PASS. Native causes remain unproved; next hosted
run supplies evidence. No source/classification/workflow/production mutation.


2026-09-11 published17204f06/tree4ab25230: exact reviewed9-file tree, nonforce
ref/fetch/local alignment PASS; archive/proof-stages-reviewed-4e624d67 retained.
OPS34622016471 alignment103338041853 passed24constructors/actual63/catalog-source
equality/view binding/oracleDDL, then proved42804 at timestamp_mutation16:27:27Z;
cleanupPASS. Reviewed139b532 replaces concrete-array assignment with PG-created
temp-donor anyarray copying, preserving exact1drift/raw42804/preservation/disposal.
25constructors and focused10reviewsubcases PASS; no findings; native SQL pending.
Legacy103338041773 failed beforefirst43 with BoundaryError; causeUNCLASSIFIED.
Dedupe103338041737 now PASS whole standalone/actual57/all19/death/privacy/cleanup
16:35:06Z; auth/repair/fixed102/quality/Ediel and tenant/browserPASS. Existing
types/clean-native gates remain open, actual63continuation collection pending.
Sharedstartup separately has a source-proven temporary-server readiness gap;
scopedd89a497 requires finalPID1+socketready under unchanged bounds/logging.
Real__enter__ temporary/final/timeout cleanup seams RED/GREEN and existinglegacy
constructors/AST/whitespacePASS; independent review pending, no native claim.
No historical SQL/classification/workflow/production change.

17204f06 complete actual63 continuation103338041627 PASS16:37:14Z including finalrepeat/death/privacy/cleanup. Verify103338041867 exact known types tail failure; clean103338041829 rejects unsupported native target before replay. No retries or production actions.

2026-09-11 startupd89a497 scoped independent review APPROVED, no findings; root
read complete report. Actual lifecycle3scenario/timeout/ownership/privacy checks
PASS, originaldeadline semantics retained (not a native wall-clock measurement).
Alignment139b532 independently approved; native verification pending for both.
Root unchangedgroup/status regression PASS after metadata update. Current17204
fullE2E smoke confirmed14/15: only types tail; coverage/P0contractPASS, fullruntime
lanes skipped. CurrentCI inspection complete; no historicalcause/retry/prodclaim.

2026-09-12 — Tool-store object round trips can reorder JSON keys. For an exact-byte large GitHub blob, retain the serialized artifact as a string before store/load, or reconstruct from the preserved raw JSON string with original field order. JSON.stringify(load(receiptObject)) produced a different Git blob than the already written JSON; the equality gate correctly stopped before tree/ref creation. Reconstructing from the raw catalog response and original wrapper order matched469ed879781f8f82d23f078a26b264390a252c7f; only the exact tree was published. Never adopt a different blob or relax staged-tree equality for semantic JSON equivalence.

2026-09-12 — Managed catalog JSON transport is not lossless for bigint numbers above2^53. Original Supabase connector response itself represented pg_sequence.seqmax as9223372036854776000, outsideint8; reparsing the retained response with Python could not recover precision. Preserve this failedobservation asnonadmittedmetadata. A separate SQL query casting every bigintconfigurationfield totext beforeJSON returned exact max"9223372036854775807". Use text casts for futurebigintmetadata and retainseparateobservationtimestamps; never infer a database value from a rounded token. No actualsequencevalue/nextval/currval/setval was read.

2026-09-12 — Transfer length gates must distinguish Python Unicode code points from JavaScript UTF-16 code units. The API proof contains emoji: the exact payload has973382 code points but973388 JS string units. The first length guard stopped locally before publication; comparing code points and then exact staged/GitHub tree identity preserved all bytes. Do not alter payload text or bypass final tree equality to accommodate Unicode.

Task10b1 firsthosted589eda87 OPS34698160723 quality103565128134 FAILED3newvalidquote controls (create201/validateinitialcreate201/partner200 allgot422).8newnegative/notification tests PASS;207filespassed/1failed,1601testsPASS/3FAIL. Lint/script+testtypes/mechanical/quality45PASS; downstreambuild notrun. api_default_company_impl explicitlypausedprewrite/noownedchanges. Original10b1author soleCI1fixnext; no supportedacceptance. Native103565128054 repeated129+10baseline/42construction/ACLcleanupPASSactuallogs; fullverify103565128137 tail20260911114443 andclean103565128059 unsupportedtarget failures rechecked.
