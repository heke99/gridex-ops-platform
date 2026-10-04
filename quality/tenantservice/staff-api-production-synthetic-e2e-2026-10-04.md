# Synthetic production staff API verification

The runner prepares isolated synthetic records and calls the deployed API
directly. It does not execute database SQL. Root owns fixture installation and
must execute the generated cleanup SQL in a finally step, including if HTTP
verification or audit verification fails. No production writes were performed
while preparing this runner. Read-only production catalog queries confirmed the
fixture columns, Auth/account constraints and key format on
`piidsfebjqjmnepdpnas`. Direct Node HTTPS access to `https://app.gridex.se` works;
the real `/api/internal/system/health` path returned 401 without a cron secret.
This proves route reachability, not authenticated application health.

Read-only preflight on 2026-10-04 found the production migration tail at
`20261003152539` (`portfolio_analytics_rollups_performance`) and the staff RPCs
absent. The production alias was Vercel deployment
`dpl_7vGX6rNjXca4P55DkV8qp9cQmi6F`, READY, source
`fa4147b33dd3215c150cbe91d755db30e5ae6c62`. Unauthenticated staff roles/cases
routes returned 404. These observations are prerequisites to recheck after
deployment; they are not staff API production acceptance.

Catalog checks confirmed active/disabled account and membership values,
revoked API-client status, the existing invitation `revoked_at` column and a
private `support-case-attachments` bucket accepting PDF/PNG/JPEG with a 10 MiB
limit. Case events, attachments and identity providers have RLS enabled; the
inspected privileged RPCs are callable by `service_role`, not `anon` or
`authenticated`. Cleanup retains audit logs, case history and attachment
records; it neither deletes retained evidence nor changes existing grants.

The live `company_memberships_last_functioning_admin_guard` is an AFTER
DELETE/UPDATE constraint trigger, DEFERRABLE INITIALLY IMMEDIATE. Its function
source SHA256 is
`7d4f481101fc475ac079763566f03bc04c6520ceeb9c68456d5bba6dcbc09ede`, matching
the committed source used by the regression test. The fixture inserts
confirmed Auth users and active profiles before their accepted active
memberships, so both sole administrators are eligible. Cleanup first disables
the exact marker-guarded synthetic profiles and bans their exact Auth users,
then disables memberships. Reversing that order triggers the last-admin rule
and rolls back the same transaction's API-key/provider revocation. The native
guard remains enabled throughout; no constraint or trigger is bypassed.

After all package merges, green authentic clean replay, artifact-derived types,
production migrations and the deployed head are confirmed:

1. `node scripts/staff-api-synthetic-e2e.cjs prepare --output-dir /workspace/scratch/5f3e30311741/staff-e2e-production-RUN`
2. Read and execute that directory's `fixture.sql` using the Supabase connector
   for the confirmed OPS project. The fixture transaction fails before inserts
   if required staff RPCs are missing. It commits only new random company,
   staff and customer IDs, accepted active memberships, an ephemeral public RSA
   key provider and expiring staff API keys. The token SHA256 and 12-character
   prefix match `apiClientSecrets.ts`. It creates no customer contracts.
3. `node scripts/staff-api-synthetic-e2e.cjs run --state /workspace/scratch/5f3e30311741/staff-e2e-production-RUN/state.private.json --base-url https://app.gridex.se`
4. Execute `audit.sql` for the same exact generated IDs. It requires durable
   actor/client/staff_api attribution for customer, staff, case and attachment
   writes and checks exactly one case after idempotent replay.
5. In a finally step, execute `cleanup.sql`. It validates both synthetic company
   markers before changing anything, revokes every generated API client,
   deactivates the staff provider, disables exact fixture accounts before their
   memberships/roles/overrides and revokes any exact synthetic invitation. It retains
   customer/case/attachment records and immutable audit evidence. Verify its
   `synthetic_access_revoked` result. Remove `state.private.json` only after
   cleanup succeeds; retain redacted `results.json` and SQL/evidence as needed.

Each request receives a newly signed five-minute RS256 assertion and a fresh
jti; only the intentional replay test reuses a token. The runner covers missing
proof, issuer/audience mismatch, replay, other-company staff, wildcard opt-in,
scope and role failures; company-scoped customer search/detail/masking,
contact version/idempotency/cross-company checks, identity change without
contracts; case create/idempotency/cross-actor conflict, list/detail, reply,
internal note, phone interaction, status, assignment isolation, raw PDF upload,
download byte integrity and history pagination; role ceiling, self-disable,
last-admin disable/demotion and positive role/disable/reactivation.

Positive invitation delivery is deliberately excluded from production HTTP
verification: its background Auth provider worker may attempt delivery even to
an `example.invalid` recipient. The POST invitation route is exercised with a
role-ceiling rejection before a durable intent is created. Native SQL tests
cover positive invitation creation without external delivery. Root can opt in
with `prepare --include-invite true` only after accounting for the delivery
worker; this additionally requires `STAFF_INVITED` audit evidence.

All generated artifacts stay outside the repository with directory mode 0700
and private state mode 0600. SQL contains public JWK and secret hashes, never
the private key or API tokens. Results contain statuses, error codes, request
IDs, contract versions and counts; response bodies and request credentials are
not logged. The source script and this guide contain no generated secrets.

Local verification: JavaScript syntax check and three focused Vitest tests pass.
The tests verify RSA signatures/fresh jti, private file modes, absence of tokens
or private keys in SQL/results, guarded nondeleting cleanup, and the complete
HTTP sequence using a local fake service with negative responses and matching
binary download bytes. A focused PGlite diagnostic loads the committed native
last-admin function and trigger, verifies its observed production source hash,
reproduces rollback under the old cleanup order, and proves the corrected order
revokes synthetic access while leaving the guard enabled. It loads the existing
forward invitation/account columns absent from the legacy snapshot declaration.
This checks SQL mechanics and runner behavior; authentic native replay and
production application acceptance remain the separate deployment gates above.

Skill routing for the cleanup repair: using-git-worktrees for the isolated
repair branch, code-review for production catalog/source alignment,
test-driven-development and verification-before-completion for the reproduced
rollback and focused checks, and Supabase guidance for read-only catalog
inspection. UI, performance and publishing skills do not apply to this repair.
