# Ediel portal test graph: address-command and selected-company repair

Status: **IMPLEMENTED_NOT_NATIVE_VERIFIED**. This is a bounded compatibility
and authority repair for API/tenantservice candidate #422. It does not accept
the full masterplan, change #421/#310, enable market traffic, or authorize a
production/main merge.

## Ownership and skill routing

Worker owns `lib/ediel/portalTestCustomer.ts`, its direct action in
`app/admin/ediel/actions.part-4.ts`, two new unit fixtures and the new native
fixture/config. Root additionally delegated the uniquely CLI-created forward
`20260930212410_ediel_portal_test_graph_authority_preflight.sql`.
Root owns shared command changes, manifests, generated artifacts, workflows,
active memory, publication, and final requirement acceptance. Other workers'
changes are preserved; no commit/push or hosted writes were performed here.

Activated project skills: systematic-debugging (source-to-sink investigation),
test-driven-development and writing-good-tests (observed RED before repair),
spec-to-code-compliance (the selected-tenant and authoritative-command
requirements only), fp-check (counterexample/refutation against the complete
caller/helper/database path), Supabase and Supabase Postgres best practices
(ACL, session, locking and function boundaries),
verification-before-completion (fresh targeted results). Read the installed
Next.js server-function guide for action security. using-superpowers explicitly
exempts dispatched subagents. Repository-wide audit/security-tool/performance
and UI-design groups are outside this bounded source repair; root handles the
full masterplan review and delivery gates. No reusable skill was changed.

## Confirmed findings and refutation

### PADDR-1: raw service address insert conflicts with the authoritative book fence

Severity: medium (the test-customer graph stops and earlier graph mutations can
already have committed). Original `ensureCustomerAddress` directly inserted
registered/billing `customer_addresses`. `makeServerClient` returns
`supabaseService`; it is a service-role writer, not an authenticated table
client. Forward `20260930190549_customer_address_book_atomic_command.sql`
requires a private command marker for service-role book DML and denies an
unmarked insert with `address_book_command_required`. The helper set no marker
and called no authoritative command. The exact consumer regression reproduced
the old raw insert against a simulated DB denial. Actual native denial remains
pending and has a dedicated fixture; it is not claimed from the mock.

Refutation checked: facility mirrors are exempt only for facility-to-facility
work, whereas this helper was invoked only for registered and billing types.
The parent graph used no separate address authority or private marker, and the
only direct external caller is the administrative action.

Repair: retain existing company/customer/type/street reuse lookup; when a row
is missing, freshly read this customer's `address_book_revision` under exact
company ownership, reject missing/non-number/unsafe/negative values, and call
existing `changeCustomerAddress` with actual actor/session and a distinct
idempotency key. The second address reads the revision after the first command
commits. No invented revision zero, blanket service marker, trigger exception,
table grant or direct-DML fallback is added. Facilities, contacts, grid-owner,
route, POA and switch-graph behavior remain on their existing paths.
Compatibility is bounded to valid address-command input. The old raw helper
could insert a blank street when only postal code/city were present; the
authoritative existing command requires a nonblank street. Such partial book
data now fails that validation. The adapter invents no address content and
does not weaken the command to preserve malformed legacy insertion.

### PADDR-2: ambient-company permissions did not authorize the selected target

Severity: high (partial target-company mutations through the service client).
The original action checked all three permissions in the ambient cookie
company via `requireAdminActionAccess`, then accepted another company via
`assertUserCanOperateCompany`. Membership/operational scope alone does not prove
all three permissions for that target. The graph then wrote with the service
role. A user with A-write/B-read membership could reach target-B grid-owner,
route/customer changes before the book fence stopped the old graph.

Refutation checked: the service client bypasses ordinary tenant RLS; target
scope assert did not re-resolve the three write rights. Existing address command
would check target masterdata rights but only after earlier graph writes, and
the old graph did not use it. Native A-writer/B-reader is prepared, not executed.

Repair: action obtains `currentSupportSession('ops', context.userId)` from
verified claims/getUser and ignores form actor/session fields. The graph calls
new `gridex_ediel_portal_test_graph_access_v1(company,user,session)` before its
first mutation. The service-only SECURITY INVOKER RPC locks active tenant,
live exact session/profile, active target membership and existing authority
inputs, then rechecks session clock and all three canonical target permissions:
masterdata.write, switching.write, communication.write. It writes no rows,
sets no marker, grants no auth-table access and never grants authenticated/anon
execution. The same session then enters each locked address command.

The action's initial `requireAdminActionAccess()` now gates authenticated admin
identity and the existing active-workspace membership rule without ambient
write permissions. Inspection verified its no-argument default normalizes to
an empty permission requirement and does not itself authorize target writes.
This lets an A-reader/B-writer select B; the selected-company database preflight
remains the only all-three write-permission decision and still denies
A-writer/B-reader before any graph DML. A dedicated regression first failed
with `ambient_company_is_read_only`, then passed after this narrow guard change.

## Evidence and current limits

| Check | Result |
|---|---|
| New action regression on old implementation | RED: missing current-session call; revoked session was ignored |
| New graph regression on old implementation | RED: unmarked book insert reaches simulated `address_book_command_required`; target preflight absent |
| Node22 targeted graph/action/address bundle | PASS: 41/41 in 3 files |
| Node22 expanded actual Ediel callers + graph/action/address/site action before target-only guard | PASS: 97/97 in 6 files |
| Target-only action guard regression and expanded caller bundle | RED observed for A-reader/B-writer on old ambient allOf; GREEN: 98/98 in 6 files |
| Scoped ESLint for source, tests and prepared native fixture/config | PASS |
| TypeScript tests project, incremental disabled | PASS |
| TypeScript scripts project, including final lock-wait fixture | PASS |
| TypeScript app project without repository heap flag | Infrastructure failure: Node's 2GB heap exhausted, no diagnostic about source |
| TypeScript app project with repository 4096MB heap flag | PASS before final no-argument action-guard narrowing; repeat on evolving shared tree exited 137 without source diagnostic (resource SIGKILL); root exact-candidate gate remains pending |
| Native SQL/PostgREST exact graph/current authority/ACL/clock tests | PREPARED_NOT_EXECUTED; local psql/Docker absent |
| Native generated schema/type parity / exact-head CI / build / browser | Root integration gates pending |

Executed targeted commands use Node22 through
`PATH=/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin:$PATH`.
Tests: `node node_modules/vitest/vitest.mjs run` with the six files
`ediel-prodat-register-admin-panel`, `ediel-prodat-reporting-chain`,
`ediel-portal-address-authority`, `ediel-portal-target-company-action`,
`customer-address-command`, `ops-customer-site-action` under `__tests__`.
Typechecks use `node node_modules/typescript/bin/tsc --noEmit -p
tsconfig.tests.json --incremental false` and the scripts variant.
App retry uses `node --max-old-space-size=4096` as configured by package.json.
`git diff --check` for owned files passes. Official Supabase changelog markdown
fetch was unsupported by the lookup service; the HTML changelog and official
getClaims reference were inspected instead. No SDK/auth helper or dependency
upgrade was required for this repair.

## Prepared native qualification

Run only in the CI-created disposable localhost stack:
`npx vitest run --config scripts/ediel-portal-address-command-native.config.ts`.
The config requires `CI=true`, `GRIDEX_NATIVE_STATUS`, literal API URL
`http://127.0.0.1:54321`, and reads only this replay status. The actual graph,
service adapter, PostgREST and database commands execute; only the `server-only`
bundler marker is stubbed. Synthetic companies/users/sessions only.

Expected evidence markers (not observed here):

- EDIEL_PORTAL_ADDRESS_NATIVE_GRAPH_PASS: real registered/billing command rows,
  revision 2, command records, facility behavior, repeated address reuse, no
  Ediel messages.
- EDIEL_PORTAL_ADDRESS_NATIVE_TARGET_PASS: A-write/B-read denies before any
  target graph DML.
- EDIEL_PORTAL_ADDRESS_NATIVE_SESSION_PASS: deleted and expired exact sessions
  deny before graph DML.
- EDIEL_PORTAL_ADDRESS_NATIVE_AUTHORITY_PASS: every one of the three target
  permissions and active membership are independently required.
- EDIEL_PORTAL_ADDRESS_NATIVE_LOCK_CLOCK_PASS: real permission-row lock wait,
  session expires during wait, final clock recheck denies without graph DML.
- EDIEL_PORTAL_ADDRESS_NATIVE_FENCES_PASS: raw unmarked book DML still denied,
  anon/authenticated cannot execute preflight, service role has no SELECT grant
  on auth.sessions.

## Explicitly unaccepted boundary

The historical entire test graph is multi-step and non-transactional. Preflight
locks end when its RPC returns; it is a point-in-time authorization decision,
not a transaction-spanning capability. Revocation after preflight can occur
between legacy steps. Each address command independently locks/rechecks current
session/target rights and handles revision conflicts. The rest of this legacy
graph retains existing behavior, including partial progress on a late failure.
This bounded repair must not be used as proof of whole-graph atomicity or
transaction-spanning authorization, full Ediel acceptance, or market activation.

Next action: root registers the new migration checksum, integrates native
workflow/config, obtains real disposable receipts and authentic generated
artifacts, then reviews exact-head CI/build/browser together with all original
T/U requirements. Do not promote prepared markers to passed evidence.
