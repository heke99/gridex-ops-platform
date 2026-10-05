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
