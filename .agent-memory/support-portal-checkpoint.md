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

Current next actions: finish independent onboarding's explicit Auth+assertion+
canonical acceptance and all bounded tests; independent security review; final
source qualification and reviewable PRs. Prod dependency closure additionally must
resolve broad platform_runtime_readiness (never fake is_ready), actual Gridex/admin
mapping, nativeProd-shapedSQLqualification, and proper runtime Prod configuration.
Only then enrollment/live acceptance/domain assignment. Never replay all old OPS
migrations or auto-merge legacy website support tickets.
