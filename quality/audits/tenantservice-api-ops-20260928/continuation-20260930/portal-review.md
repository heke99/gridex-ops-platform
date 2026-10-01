# Independent Ediel portal address review, 2026-09-30

Verdict: bounded source/fixture review passed with no newly confirmed code
blocker. Actual native qualification remains NOT_EXECUTED. This result does
not accept the historical entire multi-step graph as atomic or fully current
through every legacy mutation.

## Reviewed scope

Reviewed the action, graph, service address adapter, new selected-company
preflight, their underlying current-session/authority/address SQL paths, two
unit files and six prepared native cases in the root continuation checkout
`/workspace/scratch/b08749f7eca6/gridex-api`.

| File | Reviewed Git blob |
| --- | --- |
| lib/ediel/portalTestCustomer.ts | 1c6496dd0599c3f14062ef9860d6e6d963ba4e33 |
| app/admin/ediel/actions.part-4.ts | 36fd740ef5987aa5107636936f5755491a65692c |
| supabase/migrations/20260930212410_ediel_portal_test_graph_authority_preflight.sql | 54e564105c478dfc964d248b09ad29115420acc2 |
| __tests__/ediel-portal-address-authority.test.ts | fcd5560b18da7ab3c160e6bccd242d876646e2a5 |
| __tests__/ediel-portal-target-company-action.test.ts | 64fc94293b7dedab35854974094a23e252ccc4f5 |
| scripts/ediel-portal-address-command-native.config.ts | 7658bf5c6b6dacfc7041bb59f97520a7171b5e67 |
| scripts/ediel-portal-address-command-native.test.ts | 574bf3335c868ba66edd35263e460a358351953b |

## Authority and isolation trace

The action derives the actor from the admin guard and actual verified current
Auth session, ignores forged actor/session form controls, resolves the selected
resource company and passes that company/session to the graph. Its initial
`requireAdminActionAccess()` retains the canonical admin identity and active
workspace gate but no longer requires the three write rights in the ambient
company. Reviewed the actual guard's empty default requirement and
`hasPermissionRequirement`; selected-company rights remain mandatory in the
database preflight. This avoids the inherited A-reader/B-writer false denial
without borrowing A's write rights for B. The service client is confirmed as
the existing `makeServerClient` implementation.

Before first graph DML, the new invoker RPC requires service_role, active
selected company, an active exact user/session, active selected-company
membership and all three canonical rights: masterdata.write, switching.write
and communication.write. Company/membership/session/authority row locks are
used. A final session clock check runs after permission lock waits. Null
identities return false; no marker or future authority token is issued.
EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to
service_role. No Auth table grant is added.

Each new registered/billing address goes through the existing authoritative
address command with the same current actor/session and a freshly loaded
tenant/customer book revision. Missing, unsafe or negative revisions fail
closed. The command independently locks resource/current authority, validates
revision, namespaces idempotency, rechecks clocks after waits and commits the
book row/revision/result/audit/outbox together. No legacy direct-book fallback
or bypass marker was introduced by the graph adapter.

The graph preserves its existing type/street address reuse behavior. A random
new key identifies each newly issued address command; a repeated graph call
first reuses an existing address. Concurrent/partial graph behavior is outside
this bounded adapter claim and must not be described as one atomic graph
transaction or a stable whole-graph command replay.

## Executed and prepared verification

Executed with project Node 22:

```text
node node_modules/vitest/vitest.mjs run __tests__/ediel-portal-address-authority.test.ts __tests__/ediel-portal-target-company-action.test.ts
```

Result after the selected-target guard update: 14/14 tests in two files passed,
including the new A-reader/B-writer action regression. These run actual graph/action/adapter
logic against controlled RPC/query boundaries; they do not prove PostgreSQL.

The prepared native config requires CI=true, the exact disposable localhost
API URL and private replay status. It executes the real graph/PostgREST/command
paths, with only server-only's bundler marker stubbed. Reviewed cases cover:
two command-owned book rows and revision/reuse, A-write/B-read selected-company
denial, deleted/expired sessions, each missing right and inactive membership,
a real permission-lock wait that expires the session, direct unmarked DML
denial and low-role RPC/Auth-table ACLs. The lock-wait fixture uses separate
psql sessions, observes the waiter in pg_stat_activity, waits for wall-clock
expiry before release, and expects false plus unchanged graph state.

These six native cases were inspected but not executed by this reviewer.
Their markers remain expectations until observed in exact-candidate CI.
The earlier published bounded repair candidate
`0d81465617d11f099502832385d976fdedf3cc6d` has different scope and does not
qualify these reviewed local portal blobs. Its clean replay stops at site SQL
before the native fixtures; no portal native marker was observed there.

## Explicit acceptance boundary

Preflight locks end at RPC return. Existing legacy graph writes before/after
the individual address commands are separate calls; later revocation can occur
between them, and a later failure can leave earlier legacy steps persisted.
The source and author report explicitly retain that limitation. The new
address commands protect their own writes, but whole-graph atomicity, concurrent
graph retries and current authority for every legacy graph mutation are not
accepted by this review.

Skills: code-review, systematic-debugging and verification-before-completion.
The fp-check trigger was inspected; there is no new claimed security finding
to classify. Broader scanners, deployment, market activation and publishing
are outside this delegated read-only review.
