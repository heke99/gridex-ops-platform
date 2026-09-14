# Native53–56 trigger admission — 2026-09-14

Status: BLOCKED_AT_PUBLICATION; candidate SQL behavior remains NATIVE_UNVERIFIED.
No full replay, auth-email, generated-types, release, merge or production claim.

## Published and actually executed

Diagnostic commit: d503e1fa896002a72b6a55f16aeec4147214720d.
OPS run 34884449551, clean job 104111486320, artifact 10364318629.
Artifact SHA256: 83a4e07b38cf3579870810b54e1274c9a54e31218b74635229c4061178d52d03.
The downloaded ZIP digest was verified before reading the JSON report.
Native1–52 remain verified. The repair56 independent source-DDL oracle rolls
back. The original provider-lock denial42501 passes as a negative control.
The next expectedP5653 instead encountersP0004; repair56 remains unverified.
Owned resources and private workspace were disposed successfully.

The diagnostic establishes zero active non-internal public.roles triggers and
eight active Supabase event triggers. The immutable portable admission bans all
active event triggers, so it rejects the provider's native baseline. The eight
are graphql_watch_ddl/drop, issue_graphql_placeholder, issue_pg_cron_access,
issue_pg_graphql_access, issue_pg_net_access, pgrst_ddl_watch/drop. All event and
function owners are supabase_admin; exact function execution-contract hashes,
event types and tags are in the redacted native report. Observed names alone
are NOT an authorization to weaken admission.

## Local candidate — NOT published, NOT native-qualified

Eight-file patch: gridex-native53-56-provider-events.patch, supplied in the
conversation artifact bundle, based on the exact d503e1fa source tree.
Patch SHA256: e40612db619c0874bbd90dfffb1e380e4d284aa3f59c380bd6ede0a01feb8b53.
A clean source-tree application was checked and all eight resulting files were
byte-compared with the locally tested candidate. This is not a CI result.

The candidate adds a complete fixed provider contract, rechecked on a pristine
owned native image BEFORE any repository SQL and again at native52. Native
admission substitutes only the blanket event predicate, keeping the roles
trigger ban and the original immutable portable support. The replacement is a
full JSON comparison including routine body/owner/ACL/config/execution hashes,
not an owner/name exception. Image ID is pinned to
sha256:9ff6402f578a9b0d4f2aa31f660bd398b8e378761d61d31efda6ff9ad92408e5;
pg_graphql is pinned to1.5.11. Missing/extra/changed events fail closed.

It requires the oldP0004 rejection as a real negative control, three expected-
contract mismatch controls, and the existing42501/P5653/57014/P5656/P5657
transaction/ledger controls. These additional native controls are NOT executed
yet. No claim is made that actual malicious provider routines were injected.

Extra read-only snapshots cover extensions/graphql/graphql_public/net static
catalog, provider routine contracts and GraphQL sequence definition. Domain
row/sequence checks and locks are unchanged. The provider's
`graphql.seq_schema_version` counter is explicitly NOT claimed to roll back;
its reviewed DDL-trigger increments are cache invalidations. No event trigger
is disabled, no sequence is reset and no privilege is elevated.

## Verification actually completed locally

145 control/source tests PASS: historical prefix33, lock boundary9,
legacy envelope22, repair envelope44 (includes six diagnostic and seven new
provider tests), ledger regression8, lifecycle15, bootstrap14. The provider
suite was first RED before implementation. This environment has no native
Docker/psql execution; callbacks are not SQL proof.
All601 historical migration checksums PASS. git diff --check PASS.
The paused partner-price patch, application/API code, generated types and
original migration/support files were not changed by this candidate.

## Publication blocker

GitHub accepted the candidate repair-envelope blob
fa0845355d4acedcd49aed2ac41c3d0d74fac461, but creating the next lifecycle blob was
blocked by the tool because it could not determine the request's safety status.
No candidate tree/commit/ref update was performed. An unattached blob is not a
published fix. The blocked write was not routed through another transport or
encoding. The complete candidate is preserved as a user-downloadable patch.

## Exact next action

Publish the complete eight-file candidate through an authorized GitHub write,
then execute ordinary OPS clean-migration-replay. Require pristine provider
proof, all nine negative controls, the real46th ledger entry, unchanged earlier
ledger/source bytes, final scoped/provider catalog, no-op repeat and cleanup.
If a control fails, fix the actual failure; do not advance the accepted boundary.
After native56 is truly verified: integrate57–144 and the timestamp chain,
full schema comparison, auth-email, actual type generation and required CI.
The separate type-tail mismatch at
20260913211625_ediel_intent_customer_company_integrity.sql remains unresolved.
Do not refresh its manifest without generating types from a complete replay.

## Review routing and primary references

Activated: systematic-debugging, test-driven-development, verification-before-
completion, database/source-contract and security/differential review. Browser,
UI, React, deployment and marketing skills are not triggered by this isolated
migration harness change. Google/Gemini were not used.

Reviewed provider implementations: supabase/postgres tag17.6.1.106,
`migrations/schema-17.sql`, Git blob8017d88412ef5453b626cdad73c4714e8fe391a1;
and supabase/pg_graphql tagv1.5.11, `sql/schema_version.sql`, Git blob
6ab2b0d417b92d563422c4c43861b25a164a960e. PostgREST hooks notify schema reload;
GraphQL hooks increment the cache sequence. Extension grants/placeholders are
conditional on extension/resolve-object events not declared by the pinned
R2/E2/S2/W programs. Fresh-image verification remains mandatory.
