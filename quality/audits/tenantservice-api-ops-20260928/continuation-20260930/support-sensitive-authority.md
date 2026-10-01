# Sensitive support contact authority — frozen bounded packet

Scope: T31/T47 one-time exact-action proof, with T29/T32 ordinary phone intake
preserved. Root approved the internal server action and fresh CLI forward;
contracts/OpenAPI, providers, workflow/checksums, generated artifacts and active
memory remain root-owned. No commit, hosted mutation or production probe was made.

## Implementation and actual caller

`20260930223609_support_sensitive_contact_one_time_proof.sql` was created by
Supabase CLI 2.118.0 `migration new support_sensitive_contact_one_time_proof`.
It is forward-only and creates one unexposed private consumption ledger and one
service-only SECURITY INVOKER command with a fixed pg_catalog search path.
Spent `(issuer_hash,nonce_hash)` pairs remain after historical actor/session or
customer removal; the table has no removal-driven cascading foreign keys.
Current ownership is separately checked on canonical rows. Service role has
SELECT/INSERT only; anon/authenticated have no ledger or command access and no
new auth.sessions privilege is granted.

The separate trust root `GRIDEX_SUPPORT_SENSITIVE_PROOF_TRUST` pins a per-company
HTTPS issuer, audience, public RSA RS256 JWKS, exact sensitive action and stable
issuer/subject/customer binding. No ordinary reusable API assertion or phone
checkbox is promoted. The signed purpose/type, action, channel, company,
customer, case, actual staff and actual session must match the normalized payload,
case/contact revisions, reason and idempotency key. A UUID jti is hashed and
normalized; issued/expiry times are finite integer seconds, with at most five
minutes of validity. The ledger never stores raw tokens, subject/contact values.

`changeSupportContactWithVerificationAction` is an actual internal Next server
action using the existing admin identity guard with **allOf** cases.write and
masterdata.write, selected company, and the existing auth-derived session.
It accepts only exact form fields, rejects duplicate/non-string parts and has no
actor, verified, billing, legal or login input. The command obtains the same
current session and verifies the issuer before the one atomic database call.
The action preserves the committed receipt even if cache refresh fails, asking
the user to reload the page; the spent proof must not be retried after a saved
outcome. This is a concrete internal caller, not a public endpoint or new UI.

The database locks the customer, current authority and case in the existing
order; checks current cases.write and live session; checks exact support case and
its revision/state; locks the current primary contact; atomically inserts the
nonce; then invokes the unchanged current contact v2 command. That command
independently checks masterdata.write, current session, selection and contact
revision. The stable logical key is case UUID plus the caller's idempotency key.
An already completed contact command produces controlled 409 before another
support event or revision; the new nonce rolls back. A distinct fresh command
with unchanged contact records its own case evidence while emitting no additional
contact-change outbox effect. The final session and database-clock expiry check
runs after actual audit writes so waits and late failures roll back every effect,
including the nonce. Existing internal unverified intake remains unchanged.

## RED / GREEN and evidence limits

The first real PostgreSQL-body RED used the CLI-created empty forward and failed
with 42883 for the absent sensitive function. Function implementation then reached
GREEN against actual canonical permission/session/current-contact function bodies.
The fixture is a deliberately small synthetic PostgreSQL schema executed by
PGlite, not Supabase history replay, PostgREST, HTTP or an identity provider.
No authority function is mocked.

Independent review found fresh-nonce replay with a pre-existing primary contact.
The initial small core omitted the actual canonical-audit unique constraint, so
its duplicate outer-effect observation **does not prove production/full-schema
write duplication**. The fixture now includes the actual UNIQUE(company_id,
event_type,idempotency_key). With the new explicit replay guard removed, the real
SQL regression fails with generic 23505 at that audit constraint. With the guard,
it returns controlled support_sensitive_command_already_completed/PT409 and
leaves graph and nonce count unchanged. Both missing-primary and pre-existing
primary shapes are covered. Adapter RED showed that code incorrectly mapped to
503; GREEN maps it to 409. Actual exported action RED showed postcommit cache
failure reporting false; GREEN retains the committed revision/result. The initial
array guard used anyOf; the final action explicitly uses allOf and tests it.

Fresh local executed results (Node 22.23.3 for Vitest/ESLint/type checks):

- Sensitive unit file: **24/24 PASS**, actual RSA signing/verification with
  controlled adapter/session/cache mocks; marker smoke separately **1/1 PASS**.
- PostgreSQL core: **17/17 PASS** including deleted real session, revoked support
  and contact permissions, closed case, bad binding/action/expiry, stale revisions,
  late audit rollback, actual pg_sleep expiry, append-only ACL, changed-payload
  key conflict, fresh-nonce completed-command denial and distinct no-change.
- Owned nine TypeScript files ESLint: PASS. Owned TypeScript import closure
  including legacy native file: PASS. No full app typecheck was run by this owner.
- Root owns final candidate full checks and independent review/publication.

Reproduction after dependencies are present:

```sh
node node_modules/vitest/vitest.mjs run __tests__/support-sensitive-contact-20260930.test.ts __tests__/ediel-native-server-marker-20260930.test.ts
NODE_PATH=/tmp/ediel-service-check/node_modules node --test scripts/support-sensitive-contact-20260930.postgres.test.cjs
node node_modules/vitest/vitest.mjs run --config scripts/support-sensitive-contact-20260930-native.config.ts
```

The native config requires CI=true, private GRIDEX_NATIVE_STATUS, literal
127.0.0.1:54321 and local PostgreSQL 54322. Its **six native cases are prepared,
NOT_EXECUTED** locally: signed exact action without portal account and denial
without effects; pre-existing primary completed-command replay plus distinct
no-change; two actual auth sessions/independent transactions racing one issuer
nonce with observed Lock wait; current permission/session revocation; observed
case-lock wait past actual expiry; late audit failure rollback/retry and catalog
ACL. No native marker may be claimed before the exact candidate CI reaches it.
Docker/psql are absent locally. This packet does not duplicate the existing
same-case API → OPS response → internal phone → portal-read browser fixture.

## Remaining exact blockers

The issuer config and safe proof delivery/UI are **unenrolled**. Isolated test
RSA keys are test data, never customer identity evidence. No real caller identity,
representative/economic mandate, issuer revocation/status contract, SMS or provider
network is connected. The server validates current configured subject binding
before RPC; there is no live external mandate revocation query during a waiting
transaction. Consequently T47's real phone mandate/delivery workflow remains
explicitly BLOCKED, while local exact binding/one-time consume and actual internal
caller are implemented and qualified. Billing/invoice recipient, identity login,
legal profile, lifecycle statuses and scanner/provider acceptance remain separate.
There is no account fabrication or global email-based authority.

Skills applied: repository fp-check (including deep/direct reproduction),
systematic-debugging, test-driven-development, verification-before-completion,
spec-to-code-compliance; Supabase skill and shipped Next use-server documentation.
Primary references: https://www.postgresql.org/docs/17/sql-insert.html,
https://www.postgresql.org/docs/17/explicit-locking.html and
https://pglite.dev/docs/. These support concurrency/model limits; the native race
is still the required actual full-stack evidence.

## Exact frozen source manifest

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `supabase/migrations/20260930223609_support_sensitive_contact_one_time_proof.sql` | `09d2b9f0f802055231eae6de4d1263b2a6b4ee51` | `75dd6af18cd63f8567427301c85c9e6d4613a642168d94e33f428c7fa0ad284f` |
| `lib/customer-portal/supportSensitiveProof.ts` | `b9d2fe4d7f48b43a15125257bca6795f43c236c5` | `1053e49e06f7e7663fa5892ee39135233039f7705b132553fcaba3324c9b7c4b` |
| `lib/customer-operations/supportSensitiveContact.ts` | `2ec237ad81e1cb8418f4b055342d25227530fd59` | `a0f4b69516f63c7e41da2c62bd1476fb9c066df33c8f8021deeb453ef6be5815` |
| `app/admin/customer-cases/sensitive-contact-action.ts` | `e7b7ce25f0200b34fde1c685852e7f19a8b3b6f9` | `da91b86b65789756ed71ab2120e62e5460a0bad1b2efd1e58b4c68d9bb384a86` |
| `__tests__/support-sensitive-contact-20260930.test.ts` | `c60188df2188648107592e9e9498edb53533c6ed` | `2c4fefa19a7d39d81fcb15226f369b93cdd02c98efae7b4048d9ff33c3417d62` |
| `scripts/support-sensitive-contact-20260930-core.cjs` | `ce0131a2a6939de789a1f40219c7a14bb972b257` | `a565982c60ef62dcfc313b989460b3cde705dbecd8a10e138d535bc17991a566` |
| `scripts/support-sensitive-contact-20260930.postgres.test.cjs` | `e0f3d6fd41fcc566df807ccda5353610b4b595c1` | `855f1a6dbd03e0dd553116cb059643f4e62947d9b4158d1a028d1a79dea53dea` |
| `scripts/support-sensitive-contact-20260930-native.config.ts` | `a0ddf572e75ac4ee8ce0463f4720f76717266135` | `fd0235c1c26121ca2f78117b0dd654d3ac8789df3a43ba681227a485ab0e647b` |
| `scripts/support-sensitive-contact-20260930-native.test.ts` | `03a7cc3386834f12c0d1966e7454e62a89505f00` | `e2b6c136c03587441e910aa2d38bd2f7c38563ca306d764e4ce507893883d056` |
