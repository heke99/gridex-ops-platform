# Auth provisioning diagnostics restoration contract — 2026-09-10

> For the next agentic worker: execute this bounded contract through the existing subagent-driven-development controller and independent task review. This document is design/evidence, not an implementation or selection receipt.

**Goal:** restore the complete 51-line provisioning diagnostics source with a narrowly scoped, immediate forward security repair, preserving canonical invitation/access behavior and all existing replay evidence.

**Architecture:** use the complete immutable diagnostics source G from the [nine-source effects matrix](AUTH_PROVISIONING_SOURCE_EFFECTS_2026-09-10.md), followed immediately by one new transactional forward repair R. G creates its original event table, indexes and integrity view without rewriting user or tenant records. R validates the actual target catalog, makes the view invoker, revokes public/client relation access and enforces service-owned event-table access; it creates no new public RPC or credential path.

**Tech stack:** repository Python fixture/selection machinery, PostgreSQL17, actual Supabase-compatible bootstrap and selected migration bytes. Production provider, rows, schema/types and deployments are outside the next isolated implementation step.

## Decision and narrow boundary

**Naked G is not currently safe for runtime restoration:** it creates an owner-security view over Auth identities and tenant access rows, and an event table without RLS or privilege controls. Missing relation grants in a reduced fixture are not production safety. Its later selected June hardening is conditional and in one sweep catches errors, so simply hoping it runs is insufficient.

**A safe whole-source restoration unit is designable now: G + R**, with the preflight, actual-prefix proof and role tests below. There is no unresolved product/permission decision preventing implementation of that unit. It is not yet implemented, executed, reviewed or selected. R's exact new timestamp/hash must be obtained from actual newly created immutable bytes before selection, not invented in this evidence document.

Alternatives considered:

| Option | Decision and evidence |
| --- | --- |
| Replay all nine as a batch | Reject as next unit. A/C lose audit/status information and C accepts issued-password invitations without canonical verification. E/I grant default company_admin, F reactivates catalog roles, H/I can add conflicting roles. Later safe definitions do not invert committed DML. |
| Copy G's table/view fragments into a substitute | Reject. It would leave seven complete source units unresolved and reproduce the fragment-accounting problem. |
| Whole G followed by narrow R | Choose. All schema prerequisites are already present in the actual selected38 prefix. The only app/lib consumer found is the platform-guarded server service count at `app/admin/system/auth-diagnostics/page.tsx:8–15,40–52`; no app/lib caller needs direct authenticated table/view access. Later source invoker/revoke/platform-only intent backs the boundary. |

R is a deliberate forward tightening of client SQL privileges, not a claim of byte-identical historical ACLs. Existing table policies remain present except the new policy's own exact replacement on repeat. Their effective client access is denied by a restrictive policy and revoked privileges. Service access preserves the existing guarded server count. Owner/admin diagnostic view use remains possible; no new client workflow is introduced.

## Frozen evidence and exact prospective source order

Authority remains code `9e1223659491bb77ec2f13855189e9dd729238e1`, tree `76bd532190382312ab4698b532d448e4709d1533`. All15 fixed commands at OPS34470585925/auth102849298884 passed; this report does not reproduce that run or certify a changed selector. Historical fixtures30/31/32/33, selected38, foundation82, original SQL/checksums and three existing reconstructions remain immutable.

| Alias | Exact existing input | SHA256 |
| --- | --- | --- |
| ORDER0 | `scripts/gridex-aud-003-foundation-order.json` (82 inputs) | `3e12e73296d350b635794c310072ba041bfc0cfeb3fa0725603ecb989d2a6bdc` |
| P38 | `supabase/bootstrap/20260527_company_memberships_role_key_foundation.sql` | `46c5e05a35063f84547dcf6554bc378d9c90d62171cd38843383542c6fe602c5` |
| G | `supabase/migrations/20260528_auth_provisioning_runtime_guard.sql` | `0c2455cbc31553f4be1f1a3fa2800f516295c972bcead8fbbd77c448d3f98026` |
| E6 | `supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` | `47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64` |
| E6FIX | `supabase/migrations/20260520_batch_6e_fix_rbac_backfill_security.sql` | `3e8858b6df6600d5d6fa3e35b7e99bc9f8a07814be64c6e402f172d7ed3d44fc` |
| E6HARD | `supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql` | `03f825a78ea7fcad8bd64aadc94e70d0d067276ee3ed77a349c595effc469d0b` |

**R definition:** the single new file returned by Supabase CLI2.101.0 `migration new canonical_auth_provisioning_diagnostics_boundary` (use the verified hosted fallback below when the local CLI is absent), within `supabase/migrations/`, with basename ending `_canonical_auth_provisioning_diagnostics_boundary.sql`. Run CLI `--version` and `migration new --help` first. Local `command -v supabase` and `node_modules/.bin/supabase` checks found no CLI; a pinned npx version probe could not complete because network approval was canceled. CLI availability is not assumed. Capture that actual path and SHA256 in the fixture constant and appropriate history manifest. No generated timestamp or checksum is assumed here. R must have one BEGIN/COMMIT transaction with local10s lock timeout/60s statement timeout and the catalog checks/security changes below; no source excerpt is classified as G. This alias defines a precise file creation operation, not an omitted implementation decision.

The supported CLI fallback is the repository's existing hosted setup, `.github/workflows/ops-hardening.yml:148–150`: `supabase/setup-cli@v1` with `version: 2.101.0`. If the implementation worker still cannot obtain that CLI locally, root temporarily adds the following **after the unchanged15-command step** in `jobs.auth-email-source-effects`, on the branch/PR; it creates a migration skeleton only, with no database connection. At that preparation revision R is not yet committed and the original15 run against current593 accounting. The artifact contains no source/credential data beyond the newly created empty migration skeleton.

```yaml
- uses: supabase/setup-cli@v1
  with:
    version: 2.101.0
- name: Create diagnostics migration skeleton
  run: |
    supabase --version
    supabase migration new --help
    supabase migration new canonical_auth_provisioning_diagnostics_boundary
- uses: actions/upload-artifact@v4
  with:
    name: auth-provisioning-migration-skeleton
    path: supabase/migrations/*_canonical_auth_provisioning_diagnostics_boundary.sql
    if-no-files-found: error
```

Root retrieves that exact artifact through the existing workflow/artifact tooling; author writes R's specified body to the generated filename and records the final bytes/hash. Remove these temporary preparation steps in the implementation commit before running that revised branch (otherwise a second migration skeleton would be created). Never generate a second timestamp by hand, modify an old migration, or invoke apply_migration/production to obtain a filename. Skeleton preparation is separate from the later standalone SQL proof below; it does not pretend the new fixture is already verified.

The separately reviewed selector change is exactly:

1. Preserve the existing first41 entries byte-for-byte and in order: first38 end P38, immediately followed by E6/E6FIX/E6HARD at39/40/41. This adjacency is required by `scripts/canonical-rbac-prefix-selection-selftest.py:41`. In particular first30/31/32/33 remain at their current boundaries.
2. Insert complete G as foundation42 and complete R as foundation43, immediately after E6HARD and before the old foundation42 `bootstrap/20260521_external_contract_intakes_foundation.sql`.
3. E6/E6FIX/E6HARD remain39/40/41, without changing their bytes or adjacency to P38; all former42–82 inputs shift by2, otherwise unchanged. Total foundation becomes84. The original selected38 RBAC fixture remains a historical boundary; add a separate G/R composition lane rather than silently expanding that old fixture.
4. Declare both new foundation inputs in `scripts/gridex-aud-003-legacy-foundation.additions.json` and the same exact order in `scripts/gridex-aud-003-foundation-order.json`. No new derivedBootstrap substitution. R is selected once, as foundation; the existing timestamp-skip logic must prevent a duplicate runtime execution. Do not edit the immutable base foundation JSON.
5. Execute remaining selected timestamp history normally. Full-chain effective ACL/options/policy checks described below remain distinct from the isolated G/R proof. If a later actual source undoes the boundary, stop selection acceptance and add a separately reviewed, precisely evidenced forward repair; do not patch old bytes or relax the expected denial.

Implementation/isolated proof comes first with selection unchanged. The selector update above is a subsequent reviewable commit only after that proof passes. A full-source fixture execution does not itself change accounting.

## Prerequisites and permitted shape repair

All G columns on its four input tables must be present before G. Use actual selected-prefix catalogs, not a hand-built claim of compatibility:

| Relation | Required input fields for G | Existing source of prerequisite |
| --- | --- | --- |
| `public.company_memberships` | id/company_id/user_id UUID; invited_email/status text; updated_at timestamptz | Core `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:387–403`; selected governance/prefix retain them. |
| `public.user_roles` | id/company_id/user_id UUID; status text; is_active boolean; updated_at timestamptz | Core:455–465. |
| `public.user_profiles` | id UUID; email text; updated_at timestamptz | Profile foundation:8–14 plus complete callback. |
| `auth.users` | id UUID; email string usable by lower/coalesce; updated_at and created_at timestamptz | Managed-compatible bootstrap Auth definition; actual Supabase provider owns production schema. An Auth(id)-only fixture is deliberately insufficient. |
| Platform roles | anon/authenticated/service_role/authenticator; service_role has BYPASSRLS; fixture owner can create/alter target objects | Existing managed bootstrap. No credential/role/password creation by R. |
| Extension/functions | pgcrypto installed, gen_random_uuid available; UUID and JSONB/timestamptz builtin types | Existing bootstrap plus G04. No extension move, provider auth schema rewrite or function search-path change by R. |

No additional membership, invitation or Auth schema prerequisite is required by G at P38. R must never add missing Auth timestamps, manufacture role defaults, delete orphan diagnostics or backfill invitation aliases to make G compile. Missing input fields are explicit native failure/rejection lanes, not skipped coverage.

Before running G against an already populated target, validate these exact target identities in the same isolated apply workflow. If table/view absent, creation is allowed. If present, compare relation kind, owner role and complete column/type/default/nullability/PK/index/options/ACL/policy/trigger catalog; preserve existing rows and unsupported extra fields only when they do not conflict with the source projection and named objects. Named target mismatch must fail, not be silently normalized by IF NOT EXISTS. For this first restoration, unexpected extra table columns, constraints, triggers, non-owner grants to unclassified roles, or incompatible view schema are **rejected shapes** pending specific review; this avoids inventing a broader production upgrade policy.

Target table requires exactly11 visible columns in source order:

| Field | Type | Nullability/default |
| --- | --- | --- |
| id | uuid | NN, gen_random_uuid(), sole PK |
| created_at | timestamptz | NN, now() |
| event_type | text | NN, no default |
| status | text | NN, info |
| email | text | nullable, no default |
| user_id | uuid | nullable, no default |
| company_id | uuid | nullable, no default |
| actor_user_id | uuid | nullable, no default |
| supabase_project_ref | text | nullable, no default |
| message | text | nullable, no default |
| details | jsonb | NN, empty-object |

There are no source-defined FKs or event-status CHECKs. Preserve orphan/NULL identity diagnostics, arbitrary status/event strings and JSON; adding relationship constraints would change the purpose of an integrity log. Require one PK index on id, nonunique btree `auth_provisioning_events_company_created_idx(company_id,created_at DESC)` with no predicate, and nonunique btree `auth_provisioning_events_email_created_idx(lower(email),created_at DESC) WHERE email IS NOT NULL`. Existing name with wrong uniqueness/key/order/predicate/invalid index is a rejection; `pg_get_indexdef`/`pg_index` must prove definition, validity and key expressions, not count names. No source triggers.

The view requires precisely11 fields in source order: company_id UUID, user_id UUID, email text, four booleans has_auth_user/has_user_profile/has_company_membership/has_user_role, membership_status text, user_role_status text, user_role_is_active boolean, latest_seen_at timestamptz. Compare the deparsed source projection and dependencies, not only output types. Its FULL JOIN is not a distinct-users count. Require source COMMENT to remain. R changes only `security_invoker=true`, not projection/order/joins; it must not add an Auth-table GRANT or force a tenant filter onto diagnostic semantics.

## R: complete security behavior and failure contract

R validates source target shape before mutation. Raise `AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH` for incompatible target table/index/view, `AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH` if required roles/ownership/service BYPASSRLS are incompatible, and `AUTH_PROVISIONING_POLICY_DEFINITION_MISMATCH` if the new named policy already exists with different commands/roles/predicates. All errors occur inside R's transaction before any committed security change. Definition checks use OIDs/column ordinals/types/default expressions/catalog fields; not only names or string containment. Do not catch and suppress SQL errors.

Required security statements, following successful validation, are:

```sql
alter table public.auth_provisioning_events enable row level security;
alter view public.gridex_user_auth_integrity_v set (security_invoker = true);
revoke all on table public.auth_provisioning_events
  from public, anon, authenticated, authenticator;
revoke all on table public.gridex_user_auth_integrity_v
  from public, anon, authenticated, authenticator;
grant select on table public.auth_provisioning_events to service_role;
```

Add exactly one restrictive event-table policy, creating it only when absent and validating exact semantics when present:

```sql
create policy canonical_auth_provisioning_service_boundary
  on public.auth_provisioning_events
  as restrictive for all to anon, authenticated
  using (false) with check (false);
```

Column-level grants to PUBLIC/anon/authenticated/authenticator must also be revoked for every source column on these two relations; table REVOKE alone does not remove column grants. Enumerate `pg_attribute` and use identifier-safe `format('%I',...)` with separate SELECT/INSERT/UPDATE/REFERENCES column revokes as supported by PostgreSQL. Validate `has_any_column_privilege` and effective table privileges afterwards, including inherited paths. Reject a residual inherited effective grant rather than modifying other roles/objects or blanket role memberships. Preserve non-target objects' ACLs, defaults, policies and owners exactly. No ALTER DEFAULT PRIVILEGES is part of R.

Do not newly grant service_role view/base-table access: no current app consumer needs it. Existing reviewed owner/service-role privileges are retained, except explicit clients above. The service client must retain SELECT on the event table for the actual count consumer; its BYPASSRLS is the existing backend boundary. If a future consumer needs integrity-view service access, prove its existing base-table privileges and separate authorization; G/R does not grant Auth data access merely to make a query pass.

The new restrictive false policy also denies authenticated table access if a later migration adds a permissive platform-only policy or direct table grant. It does not assert that all later predicates are safe. Anonymous user identities using the authenticated Postgres role are denied identically. An authenticated platform-admin JWT is also denied direct SQL on this backend-owned diagnostic table; the existing application serves it through its platform-gated service path. This is supported by the concrete consumer, not a new user choice.

Expected immediate catalogs: G relation definitions/indexes/comment unchanged; event table RLS enabled; view invoker=true; one new validated restrictive policy with roles anon+authenticated, ALL command, false USING/false CHECK. Existing policies remain unchanged. No new functions/triggers/FKs/checks/role grants, no base-table option changes, no ownership changes. Public/client table and column privileges are absent; service SELECT on event table exists. Source-created indexes get the table owner, normal valid/ready flags and source keys. Repeat R preserves OIDs and rows, indexes, grants and policy identity; validate and retain the existing policy rather than drop/recreate to conceal mismatch.

## Synthetic fixture contract and exact expected effects

Create `scripts/canonical-auth-provisioning-diagnostics-selftest.py`. It follows the fixed disposable PostgreSQL17 host/port/admin database used by `scripts/canonical-membership-actor-fk-selftest.py`; it accepts no arbitrary target URL and strips PG* environment overrides, as the fixed group does. New disposable names are `gridex_auth_provisioning_reduced`, `gridex_auth_provisioning_prefix`, `gridex_auth_provisioning_failure` and `gridex_auth_provisioning_lock`. Never print a connection secret, raw source SQL, token or provider record. Source receipts print path, SHA256, line count, lane and outcome only. Any `--emit` used internally must be captured to a private temporary file rather than terminal/logged source content.

Actual-prefix lane reuses the verified prefix construction pattern from `scripts/canonical-rbac-prefix-selftest.py`, taking the first41 complete inputs (the established first38 through P38 plus the three unchanged adjacent RBAC sources) from the order file and validating every source/artifact checksum. It must use managed-compatible bootstrap and real core/profile/governance bytes. Do not invoke that existing fixture's complete `main` or substitute a hand-extracted four-table setup and label it actual-prefix. Execute G complete bytes then R, twice, with per-file boundaries matching replay; snapshot all prior app/Auth rows and relevant catalogs. Use the established RBAC oracle and its explicit synthetic seed at the preserved38 boundary when a seeded RBAC lane is needed, execute the three complete E6 sources, then snapshot that exact41 boundary before G/R. Do not move seeding ahead of source prerequisites or treat historical E6 row effects as G/R mutations. Preserve the existing selected38 fixture and all15 fixed commands; add the new command at the end only after separate proof and update the runner's exact command-list test to16 without deleting/reordering the prior15.

Reduced lane explicitly declares only the four view inputs plus companies/roles needed to seed shape, with Auth email/created/updated fields. Its looser orphan/NULL/duplicate cases are intentionally impossible under some canonical constraints. Keep those reduced scenarios labelled REDUCED, and assert which constraint is absent; never drop a production constraint in the actual-prefix lane. R's target event table is source-created, not a handwritten replacement.

Use synthetic UUIDs formed from stable suffixes and reserved prefixes: companies `20000000-0000-0000-0000-00000000000N`, users `10000000-0000-0000-0000-00000000000N`, membership IDs `30000000-0000-0000-0000-00000000000N`, user-role IDs `40000000-0000-0000-0000-00000000000N`, event IDs `50000000-0000-0000-0000-00000000000N`. Here N is the fixture's single decimal index1–9, not a source/real identity. Emails use `userN@example.invalid`; timestamps are fixed synthetic instants `2026-01-01T00:00:00Z`, `2026-01-02T00:00:00Z`, `2026-01-03T00:00:00Z`. No password/token/provider fixture is needed for G/R.

| Case | Synthetic seed and exact expected result |
| --- | --- |
| Empty | No app/Auth/access/event rows. G creates table/view/indexes, view0 rows; R secures them. Second G/R preserves0 rows and semantic catalogs. |
| Linked two-tenant same user | User1 has Auth+profile, company1+company2, one membership and one role in each. View exactly2 rows, each keeps its original company and all four presence booleans true. No cross-company membership/role join. |
| Multiple roles | User2 company1, one membership and two role rows. View exactly2 rows for that pair; source is not DISTINCT and must not be silently made one. Existing row count unchanged. |
| Membership only | User3 company1 membership and Auth+profile, no role. One row: has_membership true, has_role false; role status/flag NULL. |
| Role only | User4 company2 user_role and Auth+profile, no membership. One row carries company2 and role status, membership fields NULL. |
| Profile only | User5 Auth+profile with no access rows. One row company NULL, both access-presence flags false. |
| Auth only | User6 Auth only. No view row: Auth is LEFT JOIN, not the driving relation. |
| Orphan app identity, reduced only | User7 membership only, no Auth/profile. One row with membership true and Auth/profile false; no cleanup or new user/profile. |
| NULL company and NULL user, reduced only | One user8 NULL-company membership and one NULL-company role do not equality-join; both separately project the same NULL company/user8, total2 rows. A standalone row whose coalesced user is NULL is omitted. Preserve source rows. |
| Conflicting timestamps/statuses | Membership updated Jan1, role/profile/Auth updated Jan3. latest_seen_at is Jan1, not greatest. Inactive/suspended/disabled indicators project exactly; no reactivation. Conflicting app/Auth emails choose Auth then profile then membership email and lower-case; no alias writes. |
| Legacy duplicate pair, reduced only | Two memberships and two roles for user9/company1 produce4 rows; nothing deduplicates. Actual-prefix pair uniqueness must reject such membership seed natively. |
| Event history preservation | Three events: complete company1/user1/actor2; company2 with NULL actor/user; NULL-company/orphan UUID event with arbitrary status and JSON. Preserve exact before/after row JSON and count3 across G/R repeats. R neither assigns ownership nor removes diagnostic anomalies. |
| Native event constraints | Explicit NULL event_type/status/details/created_at rejected23502; duplicate ID rejected23505. Arbitrary non-NULL status allowed; NULL/orphan actor/company allowed. No new FK/CHECK introduced. |

Rows described in cases are independent lanes unless an explicit combined seed computes the sum. Do not infer global counts by adding overlapping user IDs. Actual-prefix existing source seed rows must be baseline-subtracted or scoped by fixture IDs; do not delete real-prefix rows to reach a convenient count. Assert all before/after values with symmetric EXCEPT ALL or ordered row-JSON hashes so duplicates remain visible.

## Required verification lanes

- [ ] **Definition and negative-first proof.** At G-only state, capture owner-security/no-RLS state and demonstrate an explicitly seeded hostile relation/default grant exposes diagnostic rows to the reduced client role. This is synthetic proof of the required repair, not a claim of production exposure. Run R and require direct/client denial and owner diagnostic query success. Explicit hostile-default fixture grants are labelled, never represented as actual managed defaults.
- [ ] **Table/column/effective role access.** Exercise SELECT/INSERT/UPDATE/DELETE as anon, ordinary authenticated tenant1, tenant2, inactive user, anonymous Auth user represented by authenticated role, and authenticated platform-admin claims. All direct event-table access is denied after R; no global events leak. Seed column SELECT grants before repair and show they are removed. Service event SELECT succeeds. View direct access is denied to clients; do not grant SELECT on auth.users merely to get a green view check.
- [ ] **Policy interaction.** Start with a preexisting permissive authenticated true policy and direct table grants; R preserves the old policy but restrictive false denies access. Separately add the exact later platform-only policy predicate as an explicitly reduced policy-interaction check, with a fixture helper returning true for the platform-admin case; denial still holds. This extracted policy exercise is not whole June-file execution. The actual later-chain gate remains separate.
- [ ] **Schema mismatch cases.** Missing Auth timestamp42703; missing role relation42P01; incompatible existing view field type/order42P16; same named index wrong key/predicate/unique flags; incorrect event column default/type/nullability/PK; unexpected trigger/constraint/grant shape; same named new policy with true/incorrect roles. R's named mismatch errors must occur with no partial security commit. G may fail before R; record the exact unit and preceding autocommit effects.
- [ ] **Rollback boundaries.** Source-only G with missing input view prerequisite leaves earlier event table/index statements committed under native psql behavior. A separately composed BEGIN + exact G bytes + R body must demonstrate all-or-nothing rollback for the combined unit. Do not naively wrap the complete R file (which contains BEGIN/COMMIT) inside an outer rollback and call it atomic. Derive a transaction-body view of R only for the labelled composite test, verify its delimiters and byte-span; R remains whole-file tested separately. Production integration requires a separately reviewed orchestrator preserving whole-file provenance and one transaction/admission boundary, or no running consumers until offline replay finishes.
- [ ] **Repeat/recovery.** G→R→G→R preserves table/index/view OIDs, exact rows, projection, source comment, invoker and effective ACL/policy semantics. Also test G after R alone to characterize CREATE OR REPLACE option/ACL retention; never assume it. Failed R leaves G-only state and forbids consumer admission; retry after correcting only synthetic incompatible catalog reaches the same result.
- [ ] **Real concurrency.** Two independent connections: holder locks event table, contender runs R with finite lock timeout and receives55P03 with unchanged security/rows; release holder and retry succeeds. Separate concurrent reader of protected table must remain denied at committed boundaries. Isolated G-only unprotected state is never designated runtime-ready. Concurrent identical whole-G creation on an empty schema may produce catalog/duplicate-object errors; record and fail application admission, then serialize/retry, not mask SQL errors.
- [ ] **Prefix/downstream proof.** Complete actual38→E6→E6FIX→E6HARD→G→R and selected final RBAC helper yields preserved preexisting auth/member/invitation/role rows except already characterized E6 effects. First41 is the exact insertion boundary; the first38 historical fixture is preserved. Use existing RBAC fixture/oracle expectations; G/R must contribute zero such row deltas. Report actual-prefix versus reduced lanes distinctly, G path/hash/51-line receipt and R actual hash. Do not claim complete82/all-timestamp replay from that prefix.

Full later-chain security remains a **separate mandatory acceptance gate before production or final parity**, using actual selected timestamp sources and role/session catalogs, not partial DO excerpts. Implicated winners are the June11 named view hardeners, June11 linter sweep, June11 platform-table policy, June12 policy consolidation (preserves permissive OR semantics), August14 restrictive lifecycle guards, and September2 inert-policy cleanup. Require invoker=true and absent effective public/client view access at the final state; event table RLS enabled and the new restrictive service boundary must still exist, effective client writes/reads denied even if names of other policies consolidate. Verify source-defined indexes survive or document any exact selected later index cleanup winner. No policy count, invoker option alone, function text hint or RLS flag alone proves this gate. Canonical provider E2E, session revocation, two-way ledger/live parity and artifact generation remain open masterplan work.

## Canonical behavior held constant

G/R may not change any invitation, profile, membership, role, Auth account, job, session or audit/outbox row. The three existing reconstruction files stay selected and byte-identical. Specifically retain UUID token as distinct from text invitation_token, accept_token_hash as its independently generated lookup hash, and password timestamps as passive metadata. Do not infer passwords from issued timestamps, accept expired invitations, set login_ready=true, map unverified email aliases or generate any credential.

Current creation/acceptance RPC signatures, DEFINER/search_path/EXECUTE ACLs and TypeScript callers are fully traced in the matrix. Preserve durable intent before provider work; worker lease controls delivery; verified user/email/tenant/mapped-role checks apply on fresh canonical acceptance; existing idempotent/already-accepted short circuits remain exactly as implemented. No source historical default to company_admin or NULL→active becomes an allowed upgrade transition by virtue of this contract. No external provider call or real-user read is needed to prove G/R.

## Subsequent implementation files and commands

Only after this document's independent review. The following narrowly scoped existing assertion updates are part of the appropriate next-stage commit, not changes made by this evidence task:

| Existing file and exact boundary | R registration before G selection | G/R source-selection commit |
| --- | --- | --- |
| `scripts/canonical_full_governance_contract.py:232–241` | Keep len(order)=82, PREFIX_COUNT33/digest and DOWNSTREAM indexes37–40 unchanged. | Change only global len(order)82→84; retain PREFIX_COUNT33/digest and exact DOWNSTREAM indexes37–40. |
| `scripts/canonical-auth-membership-group-selftest.py:413,461` | Keep RBAC38/prefix33/foundation82; original15 commands remain during standalone hosted proof. | Keep RBAC38/prefix33; foundation82→84; command16 addition happens only after standalone pass as below. |
| `scripts/invitation_token_prerequisite_selftest.py:43` | Keep82 and exact source/prefix positions. | Global len(order)82→84 only; keep selected33/source count/checksum/relative-order assertions. |
| `scripts/canonical-governance-selftest.py:42,54–59` | Keep foundation82; total593→594, selected522→523, focused339→340/selected279→280; all other classification counts unchanged. | Foundation82→84; total594 retained, selected523→524, unclassified43→42; focused340 retained, selected280→281, unclassified35→34; substitution/exclusion counts unchanged. |
| `scripts/canonical-operations-sync-selftest.py:80,89–97` | Same exact594/523 and focused340/280 count transition; keep foundation82 and first31 boundary. | Same exact84/594/524/42 and focused340/281/34 transition; retain selected prefix indices and source hashes. |
| `scripts/canonical-rbac-prefix-selection-selftest.py:41–56` | No change: P38 must remain immediately followed by E6/E6FIX/E6HARD. | No change: first41 are preserved. |
| Dynamic memory/accounting equality in `scripts/canonical-auth-membership-group-selftest.py:584–605` | Root updates its owned active count summaries to594/523 and focused340/280 alongside R registration. | Root updates summaries to594/524 and focused340/281 alongside selection. Keep dynamic equality checks, not a bypass. |

The generic accounting/mapper selftests use deliberately small synthetic inventories, so do not globally replace numeric literals. These named guards were located by a bounded search for82/593/522/339/279; preserve historical per-source checks, prefix paths/digests, command order and expected errors. The new diagnostics selection test adds exact first41/G42/R43/suffix preservation assertions, so increasing a total cannot hide accidental reordering.


1. Create R using the actual CLI command above; implement its catalog preflight and exact security body/transaction. Record actual filename/hash. Add its checksum to the normal history manifest without changing existing values.
2. Create `scripts/canonical-auth-provisioning-diagnostics-selftest.py` and its database-free constructor/selection checks in `scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py`. The latter validates G hash/line count, ordered G/R source loading, fixed DB targets, exact first41 prefix including unchanged first38/RBAC adjacency, unchanged original15 commands and the expected source/accounting classifications before versus after the separately proposed selection. Reject source replacement, truncated G, wrong order, missing repair and checksum tampering.
3. Obtain standalone hosted proof before modifying the fixed command tuple: temporarily add the following step directly after `Verify fixed auth and membership group on isolated PostgreSQL 17` in `.github/workflows/ops-hardening.yml`, job `auth-email-source-effects` (existing PostgreSQL17 service, fixed55440 port, gridex_auth_test database, same checkout/revision). Keep the original15-command step unchanged; make no production/staging job changes.

```yaml
- name: Verify standalone auth provisioning diagnostics on PostgreSQL 17
  run: python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py
```

The workflow's existing pull_request trigger runs it on the open PR at the implementation revision. Capture the exact head/job and require both original15 and this new step PASS. No local PG availability is assumed and no passing constructor-only result substitutes for that SQL run. After independent review of the actual standalone proof, append `('python3', 'scripts/canonical-auth-provisioning-diagnostics-selftest.py')` as command16 in the group and its exact command-list test, and **remove the temporary standalone workflow step in the same commit** to avoid duplicate execution. Existing original15 command order and old fixture constructors remain intact; the count assertions above change only at their designated stage. Then require a fresh hosted all16 run. Root owns publication and receipts throughout.
4. After independent implementation review and actual PostgreSQL proof, modify only the two selector JSON files identified above for G/R insertion. Extend the new selection selftest to assert exact new order84, prior first41 including unchanged first38/RBAC adjacency, shifted unchanged former42–82 suffix, R no duplicate timestamp execution and unchanged other classifications. Update only the source-count expectation in `scripts/canonical-auth-membership-group-selftest.py` from foundation82 to84 at this selection step; keep its prefixCount33 and RBAC prefix38 assertions intact. This is a separate source-selection review.

Commands for that next stage (not executed in this evidence task):

```sh
python3 scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py
python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py
python3 scripts/canonical-auth-membership-group.py --dry-run
python3 scripts/canonical-auth-membership-group-selftest.py
python3 scripts/gridex-replay-input-accounting-selftest.py
node scripts/check-migration-versions.cjs
node scripts/gridex-aud-003-migration-provenance-regression.cjs
python3 scripts/canonical-auth-membership-group.py
```

Use existing CI PostgreSQL17 setup, no new arbitrary endpoint. The final group command must report all16 while retaining the15 historical commands, after standalone fixture proof. No extra production permission prompt is introduced: the user already requested continuous verified work; runtime delivery remains gated by evidence, not repeated execution-choice questions.

## Exact accounting and unresolved next effects

Current evidence task changes **nothing**:593=522/24/43/4,67 unresolved; focused339=279/21/35/4,56 unresolved. A new R file adds one selected timestamp input when first registered, so an implementation-only state with R present but no G selection is expected to be **594=523/24/43/4,67 unresolved**. If R is registered before any selector changes, it must safely reject missing G rather than generate a false readiness result; source-completeness is already blocking authoritative replay. That intermediate state is not a production release.

After separately reviewed G selection plus R foundation placement, expect **594=524 FULL_FILE_SELECTED +24 SUBSTITUTED +42 UNCLASSIFIED +4 EXPLICITLY_EXCLUDED;66 unresolved**. Focused group includes the auth-named R, so **340=281/21/34/4;55 unresolved**. Before selection but with R registered, focused340=280/21/35/4;56 unresolved. Verify the mapper output rather than changing arithmetic expectations to accommodate unrelated drift. G changes UNCLASSIFIED→FULL_FILE_SELECTED; F remains SUBSTITUTED and the other seven A/B/C/D/E/H/I remain UNCLASSIFIED. No exclusion or substitution is added. Selecting G accounts for all seven source units/51 lines, not final production security.

Specific source-backed remaining work is retained, not blanket-blocked:

| Remaining source | Exact prerequisite/repair before it can safely be proposed |
| --- | --- |
| A | Lossless admission for original profile/member/invitation/event states and role/category mismatches; prevent unknown inactive values becoming active or delivery states becoming pending; preserve original event/action history before lossy source normalization. A wider later CHECK alone does not reconstruct lost values. Existing token/hash and actor constraints must remain semantically exact. |
| B | Repair/validate conditional FKs independently of column existence (existing actor reconstruction already handles two), require profile action normalized output preserves intended evidence, and restore expanded invitation delivery CHECK immediately after any complete narrow historical run. Clean/dirty CHECK/active_company FK shape must be proven. |
| C | Precondition of zero eligible legacy acceptance rows for any unchanged whole-source live run, or a reviewed lossless transactional preservation/forward reconstruction of original invitation/event/profile fields. Never substitute expiry metadata for canonical verified acceptance. Existing five-source pass characterizes the bad transition; it does not satisfy this prerequisite. |
| D | Catalog metadata/flag/name/scope delta admission and exact invitation-status compatibility; demonstrate whether unchanged14-key overwrite is acceptable for existing tenant role catalog. No user/tenant seed is required, but role metadata is not universally harmless. |
| E | Block default company_admin grant branch and unresolved/tied role/auth/company ownership shapes before whole-source invocation; safe forward grant must use canonical explicit assignable mapping and active identity, not E's else default. Retain original active and inactive rows and prove unique/concurrent pair behavior. |
| F | Full-source includes all-role reactivation and unconditional conflicting alias backfills beyond its membership substitute. Require explicit verified identity/role mapping, catalog activation admission, and no delivery-status regression. UUID token/hash/legacy invitation_token cannot be guessed from alias columns. |
| H | Explicit role mapping is safer than E, but NULL→active, role-only orphan links, tied DISTINCT choices and additional conflicting role-ID grants remain. Require deterministic source admission and canonical actor/profile/company/role validation; no blanket assumption that the word final repairs earlier grants. |
| I | Eliminate or make unreachable the empty-role-key→company_admin branch, multiple-role duplicate membership INSERT and conflicting role-ID addition. Its filename says compact but source has no DELETE; do not invent a cleanup contract. |

These are concrete next preconditions, not approved source deletions, manufactured exclusions or demands for new user permission. A lossless row-preservation design for A–F/H/I is separate from this narrow G/R contract. No unresolved user decision blocks implementing G/R; actual dirty production catalog shape, full later-chain ACLs, source completeness, generated artifacts and production binding remain unverified acceptance boundaries.
