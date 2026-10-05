# Independent support123 checkpoint — 2026-10-05

Active user decision: support123 is an independent company support application,
with its own login and navigation, using the shared Personal API. Gridex is one
company; the API serves all companies. All persistent data MUST be in named
`gridex-prod`, Supabase ref `ayiuxjlfazkjmmtlvhsl`, account link
`link_6abfe8a022548191be4c4495dee62966`. Do not use or relabel `gridex-ops-dev`
(`piidsfebjqjmnepdpnas`) as this target.

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
