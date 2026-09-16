# Canonical access-table capability correction — 2026-09-15

Decision: stage a forward correction for exactly `public.company_invitations` and `public.user_roles`, revoking only authenticated `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN`. These are pre-existing excess capabilities in the reference, not a defect introduced by the policy compiler. SELECT and the existing INSERT/UPDATE/DELETE denial remain; service-role commands, functions, policies, other principals, column ACLs and rows remain unchanged. This document does not grant schema acceptance.

## Exact evidence and intended behavior

`supabase/schema.sql:114098–114099,117097–117098` explicitly grants authenticated SELECT plus these four capabilities on both tables, and service_role ALL. The actual 9f full portable artifact has no added, removed or changed relation-grant identity for either table. Thus the observed full source replay preserves the reference capability gap; a reference refresh would not repair it.

Artifact: `pr310-schema-9f1ba7ae.zip`, artifact 10399581944, run 34975955635, job 104403606680; ZIP SHA256 `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`; member `full-schema-reference-diff.json` SHA256 `aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772`. Relation-grant section reference hash `b7269463b97b05af1af187fd1d3f54995c82cdfadd66d341710bc82be3c95917`, replay hash `fb60c6e546b670313db2fcd4f9182272e7a407ed8bf89a0a2cdee63b20c4330e`. This diff omits unchanged raw rows; the grant text supplies their values, not a fabricated observed row witness.

`20260814162500_tenant_rls_lifecycle_hardening.sql:201–207` explicitly requires lifecycle/access-source writes to use canonical commands, including browser/platform-admin JWTs, to preserve versioning, audit, side effects, role synchronization and invitation state. It revokes only I/U/D on both tables. Row policies constrain those commands; they do not constrain TRUNCATE. Table administrative capabilities have no client role in this source contract.

The canonical access command in `20260802014000_canonical_provisioning_access.sql:218–367` checks permitted tenant state, actor rights and last-owner/admin protections; updates memberships and roles within one transaction; writes `canonical_audit_events` with `TENANT_USER_ROLE_CHANGED`, domain events, outbox and idempotency result. The later `20260802170000_canonical_security_convergence.sql` and `20260802203000_canonical_runtime_consistency_hardening.sql` preserve the authorization/idempotency/role mapping wrappers. Final reference `canonical_change_tenant_user_access` and its internal versions are at 2407–2820; invitation creation starts at 3013 and platform access management at 3372. All four public canonical invitation/access RPCs have final explicit EXECUTE only for service_role; selection checks these exact grants. The candidate does not revoke function EXECUTE or alter bodies.

Application callers agree: `lib/auth/companyInvitationFlow.ts:250` uses `supabaseService.rpc('canonical_create_tenant_invitation', ...)`; `lib/auth/companyUserAccess.ts:116–137,181,214` requires membership and system-role changes in one database transaction and calls canonical grant/change/remove/accept RPCs; `lib/admin/platformUserAccess.ts:40–75` routes platform access through `canonical_manage_platform_user_access`. Direct TRUNCATE can erase roles or invitations without those authorization decisions, synchronization, audit or delivery-state transitions. No claim is made that this alone bypasses delivery or grants an actor a new tenant role.

Reference table triggers are only row INSERT/UPDATE guards/delivery enqueue (`schema.sql:82366,82474,82888,83476`); there is no target TRUNCATE trigger. The risk is bypass of documented access-state management, including audited membership/role revocation, not merely an RLS predicate difference.

## Candidate and isolated proof contract

`restrict-canonical-access-table-capabilities.sql` locks exactly two ordinary RLS-enabled, non-FORCE tables, rechecks their identity and owner boundary under lock, checks SELECT and effective existing I/U/D denial, then revokes the four named privileges atomically. Unexpected missing/changed relation shape, authenticated owner or owner membership, super/BYPASS membership, PUBLIC/inherited/SET-only residual authority, or any direct authenticated column REFERENCES grant rejects the whole transaction. Column REFERENCES must be rejected before table REVOKE because PostgreSQL would otherwise remove that column grant too. No other principals are silently repaired. Repeat application must preserve the already-correct state.

The PG17 fixture uses the existing fixed localhost:55440 nonce-owned disposable database helper. Its two-table rows, tenant read predicates and canonical audit function are deliberately synthetic. Before the candidate, authenticated sees only one tenant but can TRUNCATE both tenants without an audit event; it can create a REFERENCES dependency and a trigger; its I/U/D is already denied. Afterward TRUNCATE, REFERENCES and TRIGGER operations and I/U/D return fixed SQLSTATE 42501. MAINTAIN is checked as an effective privilege absence, because an ANALYZE warning/skip is not a reliable 42501 assertion. Service DML/TRUNCATE and a service-only synthetic SECURITY DEFINER audited access update remain functional. The actual canonical RPC bodies and Auth helpers are not executed by this fixture.

Whole owned-state equality covers data, column ACLs, policies, functions, triggers, constraints, schemas, defaults, roles/memberships, other role privileges, an outside public table and a same-name table in another schema; only the exact eight table ACL entries may disappear. Negative controls cover missing last table, view shape, disabled/FORCE RLS, authenticated ownership, PUBLIC capability grants, direct column REFERENCES, unexpected I/U/D, inherited and SET-only service membership. Every control rolls back; the success path is repeated.

Offline tests were observed RED before the fixture existed, then four tests GREEN. Real PostgreSQL SQL execution and genuine CLI provenance are pending the dedicated workflow. That workflow creates a genuine timestamped file using pinned Supabase CLI 2.101.0 only after all SQL receipt checks pass, retains source bytes and source-tree/run/proof hashes, and uploads both SQL and provenance. No canonical migration, forward registry, types or historical source has been edited by this batch.

## Exact retained source pins

| Source | SHA256 |
| --- | --- |
| `supabase/schema.sql` | `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30` |
| `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |
| `supabase/migrations/20260802014000_canonical_provisioning_access.sql` | `4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc` |
| `supabase/migrations/20260802170000_canonical_security_convergence.sql` | `e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a` |
| `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql` | `96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930` |
| `lib/auth/companyInvitationFlow.ts` | `f28be56db9240b07dc8890b940bdcd78ed9bbc71cb6e97900be00a2260f9257f` |
| `lib/auth/companyUserAccess.ts` | `9f83ab92080c2fdce9bb267c0f4a96c8a9482f0fa5691f4cd39171f2558da286` |
| `lib/admin/platformUserAccess.ts` | `a6135b919c61fbc55068afb7bff8fc402327378f0fb46337f5de3d8f6d8f569d` |

Candidate SHA256: `ddee41e3266948eef7f9082b331f873823602266448efe7cabcb03fdb3566683`.
