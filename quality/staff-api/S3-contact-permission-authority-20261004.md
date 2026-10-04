# S3 contact permission authority forward

Confirmed important defect: authentic exact-head S3 clean replay workflow
37196421981/job 111419147699 failed the first actual contact mutation in
`scripts/staff-customer-write-native.test.ts` with
`contact_change_actor_not_authorized`. The staff actor was active in the same
company with a recognized `company_admin` profile and explicit customer write
scope. The fresh staff guard admitted it, then the contact RPC independently
used the older OPS permission resolver, which requires legacy catalog/grant
state absent from this valid staff identity. The requested staff API authority
is company membership plus role profiles and company-only overrides.

Forward migration `20261004114944_staff_contact_profile_authority.sql` adds only
`AND p_channel <> 'staff_api'` to the existing legacy staff permission predicate.
The existing exact-company, locked actor/client/scope/profile guard remains
mandatory before replay and mutation. The migration verifies the exact existing
channel, actor kind and `masterdata.write` guard and its position before replay,
refuses unexpected predecessors, and preserves the full `pg_proc` metadata.
OPS, phone and customer API permission behavior and all other contact SQL stay
unchanged. No historical migration or native contact fixture is modified.

The new PGlite test runs the actual historical contact SQL, actual strict staff
guard, actual role-profile/override SQL and actual captured legacy resolver.
Finite synthetic tables supply their real referenced columns; authorization,
mutation and audit functions are not stubbed.

| Evidence | Result |
| --- | --- |
| Test first, empty forward against actual historical SQL | RED: 5 legacy authorization failures, 14 passing controls |
| Valid profile-only staff while legacy resolver is false | Contact/contact row, one atomic audit/event/outbox write succeed |
| Exact-company allow, deny, foreign/global overrides | Only active exact-company allow admits; deny wins |
| Low role despite legacy platform admin admission | Strict staff guard denies |
| Revoked client, wrong scope/company, inactive/unaccepted/banned actor | No contact or audit side effects |
| Cached replay after client revocation | Fresh strict guard denies; no additional audit |
| Wrong-company customer, stale version, invalid actor kind/channel | Original boundary errors and no write |
| OPS/phone actual legacy outcomes and customer API behavior | Preserved |
| Audit insertion failure | Customer/contact/event/outbox writes roll back atomically |
| Full function body and catalog metadata | Exactly one added predicate; identical identity/owner/ACL/configuration/invoker mode |
| Reapplication and changed/moved/missing guard | Reapplication succeeds; unsafe predecessors fail without changing SQL |
| Seven targeted unit suites | 103/103 passed, Node 22.23.3 |
| New test ESLint, migration checks, diff whitespace | Passed; 1052 migration files/955 version groups/checksums |
| Independent S5 read-only review and execution | Approved, no blocker; 27/27 actual-source SQL tests and all four migration subgates passed; checksum and unchanged generated/historical source bytes independently verified |

The generated type, schema and fingerprint bytes and all prior capture receipts
remain untouched. The manifest explicitly marks the function-body forward as
pending capture; its callable signature is unchanged. The prior capture is
historical evidence and does not qualify this new source. Fresh own-prefix
PostgreSQL capture and exact-head clean/upgrade/native CI remain mandatory.
This local source-backed proof is not a native PostgreSQL concurrency or full-CI
claim. No frozen package worktree, hosted database, remote branch or production
environment was mutated by this repair.
