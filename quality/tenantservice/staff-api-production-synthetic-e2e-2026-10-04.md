# Synthetic production staff API verification

The runner prepares isolated synthetic records and calls the deployed API
directly. It does not execute database SQL. Root owns fixture installation and
must execute the generated cleanup SQL in a finally step, including if HTTP
verification or audit verification fails. No production writes were performed
while preparing this runner. Read-only production catalog queries confirmed the
fixture columns, Auth/account constraints and key format on
`piidsfebjqjmnepdpnas`. Direct Node HTTPS access to `https://app.gridex.se` works;
the probed `/api/health` path returned 404 and is not an acceptance endpoint.

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
   deactivates the staff provider, disables exact fixture memberships/roles/
   overrides/accounts and revokes any exact synthetic invitation. It retains
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

Local verification: JavaScript syntax check and both focused Vitest tests pass.
The tests verify RSA signatures/fresh jti, private file modes, absence of tokens
or private keys in SQL/results, guarded nondeleting cleanup, and the complete
HTTP sequence using a local fake service with negative responses and matching
binary download bytes. This checks runner behavior; production application and
native SQL acceptance are the separate post-deployment steps above.
