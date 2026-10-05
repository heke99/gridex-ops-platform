# Independent support123 checkpoint — 2026-10-05

AUTHORITATIVE USER CORRECTION 2026-10-05: Gridex web and named `gridex-prod`
are one ordinary TENANT of the independent OPS platform. gridex.se owns customer
pages; support123.gridex.se owns an internal staff login and application. Tenant
Auth and delivery state belong in `gridex-prod` (ayiuxjlfazkjmmtlvhsl). Central
customers/cases/staff actors/membership/RBAC/audit remain in OPS and are accessed
through company-scoped APIs. Do NOT move the OPS schema/runtime to the tenant DB.
The previous interpretation requiring ALL central OPS data in gridex-prod is
SUPERSEDED, including the Prod dependency migration/enrollment plan below.

Active source correction: explicit registered tenant Auth issuer/local subject
to central actor binding; normal Staff JWT sub stays the central actor. Own Auth
getUser + fresh identity-resolution API precedes every privileged portal request.
Single existing invitation worker delegates Staff delivery to the tenant-owned
bridge; no OPS Auth invitation/OTP fallback. Native service-only binding RPCs
reuse the canonical membership/RBAC engine. Both PR578 and PR45 are DRAFT again
until corrected-source verification passes. Prior green CI is historical only.
Root owns WEB API client/config/session/tests/docs; identity agent owns OPS
resolver/context/registration; onboarding agent owns existing worker + tenant
bridge and local delivery migration; security agent owns new OPS forward/native
regressions. No overlapping file editing. All hosted writes remain ZERO.

## Historical record below (superseded architecture interpretation)

The following earlier inventory/qualification notes remain as historical
evidence. Their Prod-as-OPS activation instructions and old pending company
mapping question are superseded by the authoritative correction above. They
must not be treated as a current plan or current-source qualification.

Sources: OPS worktree /workspace/gridex-support-portal-ops, branch
codex/support-portal-ops, base 985724f58; web worktree
/workspace/gridex-support123-web, branch codex/support123-staff-portal,
base ff950425. Original ordinary worktrees and frozen Personal API qualification
worktrees are preserved. Historical hosted S1–S5 acceptance remains scoped to
piids/OPS runtime and its recorded sources; it is not named-prod acceptance.

Verified root cause of live marketing page: support123 is assigned to the
marketing gridex-web Vercel project, which has no separate support application
host branch. New source is apps/support, intended as its own Vercel application
root. No OPS host rewrite or marketing link is used for the support interface.
The current live domain is unchanged; no production registration/configuration,
invitation/email, migration or domain reassignment has occurred in this task.

Completed source: standalone login/session, queue, case details/history,
reply/note/phone/status/assignment, attachment download, customer search/detail
and version-bound contact update, staff/role view and staff management commands.
Only the Personal API performs operational reads/writes; no direct portal
membership/customer table writes. Closed immutable contract projection and
fresh signed assertions; Auth pinned to Prod; stable keys/no automatic write
retry; mandatory successful API storage attestation before any command.

OPS verified correction: support pages and navigation now use support.cases
(cases.read). Mutating forms require cases.write; canonical actions remain
unchanged. New storageTarget/http guard compares expected project to the actual
captured service SDK URL BEFORE auth/replay/rate-limit/audit/handler writes.
Both SDK constructors and env-capture stability have permanent tests.

Executed qualification before independent onboarding addition: web 21 client,
9 Auth and 18 actual server-action tests (48 total); 15 real Chromium checks with
synthetic schema-faithful RSA-verifying boundary, zero JS errors; scoped strict
types/lint zero warnings; support production build 10 dynamic routes; existing website
types PASS and lint zero errors/two pre-existing pricing warnings. OPS four focused files/
29 tests PASS. Exact safe evidence in web quality/support123/evidence-20261005.

Named-prod READ ONLY facts: 136 public tables; sampled 17 relations missing,
26 functions declared by 22 frozen forwards all absent,0/22 ledger entries, attachment
bucket missing. Actual Staff write table customer_portal_write_idempotency is
absent, user_permissions exists. Six-entry ledger does not classify historical
OPS baseline. Companies only Div3rsa AB/Nibela AB; no verified Gridex company/admin.
Root asked asynchronously for correct company mapping and existing Prod admin.
No guessed Dev UUID, provider/client/key or user row may be provisioned.

Agents and ownership: safety reviewer verified six case-permission files and new
storage guard plus durable actual SDK-capture test (done). Rollout reviewer owns
quality/staff-api/gridex-prod-prerequisite-map-20261005.md, READ ONLY dependency
closure; no SQL writes. Onboarding agent owns independent callback/registered
origin routing plus separately versioned onboarding API, new tests/docs and
limited registry/parity changes. Root owns web UI/config/browser runner/docs/source
publication. No duplicate shared-file editing.

Final independent onboarding addition (2026-10-05): registered same-company
origin and existing leased delivery; separate 2026-10-05.1 acceptance API;
verified Prod Auth + fresh staff assertion; password-before-grant portal form;
service-only locked native authority wrapper; legacy OPS acceptance refusal;
exact machine-auth route opt-in and predecessor body hash guard. Profile status
is a snapshot, not a global profile-writer serialization claim. New company
reads/inserts use tenant helpers. No duplicate worker or automatic write retry.

Final source qualification: OPS 84 targeted tests PASS, app types and scoped
lint/tenant ratchet/API docs PASS. Web 56 tests (including8own-invitation tests),
17 Chromium checks/zero JS errors, scoped types/lint, production support build
11dynamic paths PASS. Existing website contract preflight, types and complete
launch tests PASS after managed contract/type sync to published2026-10-04.1.
Baseline48/15evidence remains preserved; new receipts are separate addenda.

Publication: OPS draftPR578 https://github.com/heke99/gridex-ops-platform/pull/578;
web draftPR45 https://github.com/heke99/gridex-web/pull/45. Web final code54b406d
already published with all three required remote checks GREEN; OPS source46ecb047e
is published as the native-artifact pilot. Both PRs
are attached to this chat. No production migration, account/provider/client,
Auth callback setting, real email, environment change or domain move occurred.

Authentic generated artifacts imported. Frozen SQL forward SHA256
ac58bb9af7f94b31b2daaa526e4bb2fc19793179b29e2118e1ca2c2813f32492 is registered;
checksum integrity1067files and contract hardening PASS. Exact46ec capture-only
workflow37299065849/artifact11341610088 SUCCESS; published ZIP digest750944617...
and all4members/8inputhashes/rawoutputhashes/source tree verified. Raw types/schema/
fingerprint imported; all nonfunction sections unchanged. Aggregate migration
check now PASS. The pilot's type/upgrade failures were the expected old artifacts;
its test typing issue is fixed with exact port mocks, fulltesttypes and28affected
tests PASS, runtime/SQL unchanged. Source/import are committed at46ecb047e/afee0739f. Current merge incorporates
other agents’ main85b6d6602 qualification updates; their changes are tests,
receipts and memory, with no migration or production-function delta. Active
next action: publish this final combined source and pass required native
clean/upgrade/schema CI. Do not call capture-only native acceptance. Source receipt84tests:
quality/staff-api/independent-onboarding-evidence-20261005/manifest.json.

After source CI: Prod dependency closure additionally must resolve genuine
platform_runtime_readiness (never fake is_ready), actual Gridex/admin mapping,
Prod-shaped SQL qualification and correct runtime Prod configuration. Required
company/admin question remains unanswered. Only then dedicated enrollment,
registered Auth redirect allowlist, actual own invitation delivery/acceptance
and independent Vercel project/domain assignment. Never replay all old OPS
migrations or auto-merge legacy website support tickets.

Latest source checks: independent native artifact/test delta review PASS;
aggregate migration check/types/hash PASS; app types after raw import PASS;
full test types and affected acceptance28/28 PASS. Immutable raw capture and
previous manifest origins are preserved. Final API remains draft until required
CI is green. Portal source54b406d remains green in remote support/verify/contract
CI. All new-task hosted writes are still zero and Gridex/admin information is
still required for any enrollment.

## Current continuation — corrected independent tenant split

Portal source now uses own tenant getUser, bearer-only getSession, explicit fresh
identity resolution, central actor sub + four binding claims, and separately
configured central OPS project attestation. The API resolver and ordinary Staff
context use registered public tenant Auth and current native exact bindings.
The tenant bridge/private durability registry and original worker are implemented;
bootstrap uses explicitly trusted OPS-admin canonical invitation intent. Native
owner is finalizing key-rotation lifecycle and no-login anchor compatibility.
New source tests/type/lint,17offlineChromium/0errors and production12route build
PASS; full corrected native replay/schema capture/CI still pending. Historical
4fd/54b green checks are NOT qualification of this uncommitted correction.
Hosted writes remain ZERO; one read-only central OPS catalog query found
postgres TRIGGER privilege on GoTrue Auth relations and no user-defined triggers.
No central OPS migrations may be applied to tenant gridex-prod.


## Corrected tenant split: source frozen for genuine capture

All four owners and independent reviewer have frozen their source. No Critical/Important source blocker remains. WEB75 tests,17 local browser checks and both builds/types pass. OPS123 resolver/context/SDK tests,84 invitation/delivery tests and7 whole-source embedded SQL cases pass; suite counts overlap. New OPS migration20261005124901 has SHA c6bf00b7; new tenant-only delivery migration20261005125326 has SHA9fbe18d5. All1067 prior OPS SQL hashes and38 prior WEB SQL hashes remain unchanged.

WEB corrected source is being published on PR45; OPS PR578 next publishes the genuine capture pilot. Types/schema provenance deliberately remains capture-pending. Required final native clean/upgrade/type/schema parity must run after authentic raw artifact import. New evidence folder quality/staff-api/tenant-split-evidence-20261005 preserves this source qualification separately. All hosted writes remain ZERO.


## Authentic corrected-source capture imported; final native next

Capture37318392819/artifact11349745078 succeeded on64c9c652c8033998c239ea2a7019c4d724604bbd/treef1cbded8 (PG17, CLI2.101). Authenticated ZIPec7ca64f contains exactly4safe files/validCRC; all8input hashes and raw3output hashes verified. Importe286ad568 copies raw3 unchanged and preserves complete historical manifest pointers. Current665e6e9be main changes merged conflict-free in7dc45526b; all reviewed Staff/Auth/tenant/runtime/migration bytes and producer inputs unchanged except intended generated/provenance import. App/test types, full migrations check and API docs PASS after composition.

WEBf792aedfc557e66251cfd581c5d3887ac8992129 passes all3required remote checks (support/verify/contract); test-only unsigned synthetic key supplement qualifies its fixture delta. OPS pilot expensive hardening37318392906 was deliberately canceled before replay because missing future artifact baseline would fail; only genuine producer needed at that source. HistoricalSC071 feedback at pilot failed on missing newly-main-owned export-feedback-inputs.json; the665 union includes it. No unrelated Ediel source modified. Next: independent artifact/import review, publish final composed source, then full mandatory native clean/upgrade/parity/required CI exactly once unless a real failure requires correction. Capture-only NOT_RUN flags remain honest; hosted writes stillZERO.


## Canonical customer handoff and final contract correction

Gridex web/Prod remains one ordinary OPS tenant; support123 is its own internal staff login/app. Tenant Auth/private delivery/public anonymous contacts stay Prod; canonical customers/cases/actors/membership/RBAC/audit stay OPS. Authenticated Mina sidor support now uses existing frozen Customer API to share cases and replies with Staff, with no local ticket fallback. Anonymous intake has a separately gated readonly own-tenant inbox, not automatic customer matching/case copying. WEB426da all3 CI green; final test-fidelity correction adds explicit staff-created customer ownership and exact canonical event/actor/reference semantics (root121PASS/23browserPASS0errors), separately preserved in WEB final-fidelity evidence.

OPS e545 capture37321777599/art11351027966 reproduces all raw3 bytes and8captureinputs; genuine ancestor upgrade37321777130/art11351588510 passes with matching fingerprints/retained state. The old whole-unit CI fails3finite fixtures missing the real new external-actor guard. Four-file actual captured dependency closure fixes20failures and adds3no-binding/no-effects negatives (45PASS). A subsequent reviewer-found production channel defect is fixed only in publicSupportCase: staff_api projects to frozen Customer channel admin; Staff/rawmetadata stays staff_api and internal descriptions stay hidden (actual frozen-schema RED4 to67focusedPASS). Intermediate wholecoverage10761PASS is not final-source qualification. App/fulltest types and parity PASS. Final6source pins plus owner/independent/root evidence are in quality/staff-api/tenant-handoff-final-source-20261005. FinalpublishedheadmustpassnewmandatoryCI; do not relabel historicalnative receipts. All hosted writes remain ZERO; real trusted enrollment/deployment/domain activation is separate.


The completed e545 clean run failed only external-identity native fixture setup: inserting its invitation invoked the actual enqueue trigger, then the test tried to insert the same unique job. Other674JUnit have0fail/7complementaryskips,31browserPASS/raw3exact; no externalidentitynative acceptance inferred. Two-file fixture correction now uses the captured enqueue function/trigger/PK/UNIQUE/FK and STRICTleases its ownedpendingjob instead of inserting another (bootstrap similarlystrict). Genuine same23505RED2/7 toGREEN7/7; undoing3jobsetup replacements restores originalscript4297 byte-exact, so all security assertions/roles/notice/rollback remain. Newscript26715686/newCJS cb492553, existingtest4d61/migrationc6bf/raw3/8captureinputs unchanged. Owner a5d5ec3f and independent fd9a9948 receipts preserved in final-source evidence. Final publication now includes these necessary fixture and customer-projection corrections once; fresh exact-head mandatory CI/native required.

## Additive classification closure after authentic final-source native failure

Published OPS0cf has11otherCIchecksPASS (838files/10775tests, ratchet and build); WEBac1 hasall3requiredCIgreen and PR45ready. Authentic0cf clean11356657780/run37331703621 reaches the entire external-identity SQL PASS notice,674JUnit0fail/7complementaryskips and31browserPASS, then fails only schema gate F-6: three new private tables have no platform_table_classification entries. Its upgrade11354623255 independentlyPASS; receiptsd83f12cd andcbfda140 remain exact historical evidence, not whole-clean acceptance.

The unchanged entire invariant proves that adding classifications alone reveals three F-8 invitation uniqueness conditions. New forward20261005160940 (f103cebf) registers true tenant ownership and replaces exactly three preserved-name UNIQUE(invitation_id) keys with UNIQUE(invitation_id,company_id). Validated composite parent FK, global invitation PK, NOT NULL company and canonical NULL uniqueness preserve exactly the admitted rows. Unexpected predecessor/catalog/dependency drift is refused. Oldc6bf/gate/RLS/ACL/FKs/checks/triggers/functions and frozen contracts stay unchanged. Actual-source11SQLtests and combined entirec6bf/newforward/native script pass embedded qualification; fulltesttypes/lint/integrity1069files/972groups/contracthardening and independent source review0422d04f PASS. Evidence: quality/staff-api/tenant-classification-evidence-20261005.

This is real DDL: authentic new PostgreSQL17 capture/import is required before final mandatory clean/upgrade CI. Existing raw3 remain historical pending output, and composition_capture_pending is honestly true. Root owns checksum/provenance/capture import/publication; reviewer consumes the single root-downloaded capture and owns independent native/upgrade review. No duplicate hosted writes, accounts, emails, migration execution, configuration, deployment or domain changes. Support123 live activation remains separate from source qualification; no central OPS migration belongs in tenant gridex-prod.

Authentic a315f2f96/tree0da2 capture37341406566/artifact11358368604 SUCCESS, ZIP96e3a8f8: all8producerinputs/latestf103/PG17/4safeCRCmembers verified. Actual dump differs only at the3preserved-name UNIQUE keys; every other byte/count/function/RLS/ACL remains unchanged. Typebytes1543 are unchanged; canonicalFP now128b9a9975ecca5785b75c9abe08f9d4c8568cff8703cde15abdfb57598644e2 (constraints/indexes only). Root imported actualraw3 with reviewed d4de importer, archived full0cf/preimporta315 manifests and oldcurrentcapture/composition before updating currentlatest/prefix/receipt/artifact. Aggregate migration/contracts/types check1069files/972groups and independent artifact/import review51928f4f PASS. Pilot6preimport autoruns were deliberately canceled; capture NOT_RUN flags remain honest. Current composition_capture_pending is nowfalse for this genuine import; final full clean/upgrade/native/required CI must pass on the next published composedhead. No hosted or domain activation.
