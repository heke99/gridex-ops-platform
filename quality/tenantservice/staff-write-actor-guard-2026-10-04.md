# Shared staff write actor guard

Scope: narrow forward repair of `gridex_staff_assert_write_actor_v1`, shared by
staff customer and support writes. Base: S4 stack `3881e689c`. OPS and customer
default paths, existing migration files and the function signature remain unchanged.

Skills used: repository Supabase guidance for forward migrations, Postgres best
practices for least privilege and row lock order, verification-before-completion
for fresh execution evidence. UI, performance, dependency and Ediel work are outside
this repair. Parent agent owns shared memory, migration manifests and CI integration.

The original guard omitted accepted membership, Auth eligibility, client revocation
and explicit staff scopes, and delegated authorization to the broader OPS helper.
The repair locks company, membership/profile/Auth and client rows in that order,
then rechecks eligibility after all blocking locks. Only customers/masterdata write
map to `staff_customers.write`; only cases write maps to `staff_cases.write`.
Unknown permissions fail closed. Permission calculation uses the actual S2 helper
with platform fallback disabled, preserving recognized role profiles and only
same-company overrides with deny precedence.

Auth row locks use a narrowly scoped SECURITY DEFINER function with empty search
path and unchanged service-only execution grants. No Auth table privileges are
added. The native regression qualifies owner privileges, definer configuration and
execution ACLs on the replayed database.

Executed locally:

- Before the repair, 11/21 targeted tests failed on the original guard, including
  unaccepted membership, deleted/banned Auth accounts, revoked clients and missing
  explicit scopes. The fixture deliberately grants the legacy broad helper authority;
  repaired decisions use the real S2 SQL permission helper.
- After the repair, 23/23 targeted embedded PostgreSQL tests passed, covering every
  TS role profile, scoped allow/deny and catalog overrides, eligibility changes,
  explicit scope mapping, unknown roles/permissions and service-only execution
  without Auth table grants. The full rollback SQL script also executed successfully
  on this embedded fixture.
- Scoped ESLint and `git diff --check` passed.
- Adjacent S2 native-policy tests passed together with the new suite: 35/35 tests
  across two files. The S1 account eligibility SQL test also passed (1/1).

Boundaries: embedded PostgreSQL verifies SQL behavior but does not qualify native
row lock concurrency, full schema triggers or Supabase grants. Native clean replay
must run `scripts/staff-write-actor-guard-regression.sql`; parent owns wiring and
generated artifact capture. No production operation or real account was performed.
