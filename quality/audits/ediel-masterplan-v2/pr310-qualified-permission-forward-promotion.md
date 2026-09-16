# PR310 — Source-qualified permission and Storage forward promotion

Date: 2026-09-16. Parent for this integration: 1ad24a17f8c83500f0638bb66f8ed292a02937c9.

## Executed admission, not an inferred pass

Full permission clone run35080283797, job104742368525, on8297f2e3d161ca859f72712be4e2bce8333da604
finished SUCCESS. The downloaded proof artifact10440317323 has ZIP SHA256
`dd0cdfbf83b93d0a68ee13d4cc2d37fd7254d099207814e8b72ab26c74912300`.
The retained final receipt records129 executed SQL decisions,24 changed-function
behaviors,8 exact function definitions and ACLs, per-case complete rollback,
repeat and ACL poison/recovery. Storage S21 was unchanged through original
42501 access-table denial, precise two-policy role narrowing, negative restoration
and recovery. All other catalog/row/ledger data and the parent were preserved.
The receipt explicitly does not certify native-ledger/schema/type completion.

After this success, official Supabase CLI2.101.0 ran `supabase migration new` for:

- 20260916095318_restrict_grid_owner_storage_policy_roles.sql
- 20260916095319_canonical_permission_overrides_and_storage_write_guards.sql

Artifact10439749327 has ZIP SHA256
`6fc1fb52215782286d9e5f504412ca3663fad1d40cc0af1a8b53e2e665761831`.
Both installed bytes equal the independently pinned, executed candidate sources.
No timestamp was invented and no historical migration was edited or marked applied.
Pinned sanitized origin receipts are retained next to this document and admission
rejects missing, changed or semantically incomplete proof.

## Exact scope and security review

The first source changes only the TO lists of grid_owner_agreements_platform_read
and grid_owner_agreements_platform_write on storage.objects from PUBLIC to
 authenticated. It does not grant anon access to roles/user_roles, alter row
predicates, grant table capabilities or bypass RLS. Missing/wrong preimages fail.

The second source installs the eight already-qualified functions. Permission
resolution honors shared and per-company allow/deny overrides while retaining
actor/session/tenant checks. Five internal resolver functions remain owner-only;
platform access management and permission diagnosis remain service-role-only.
The Storage path helper has only authenticated/service EXECUTE, with a fixed
search_path and tenant/customer/site/path/session/read-vs-write checks. No anon
schema/helper access or client access-table writes are added. Source-level
metadata/body and effective ACL predicates are rechecked by the ordinary runtime.
The 129-case proof includes foreign-company, disabled/paused, malformed path,
write denial, idempotency and shared permission semantics; it is not just a count.

## Integration and verification boundaries

The immutable144-foundation/514-timestamp partition and601 historical inventory
remain hash-bound. Only two forward sources and runtime manifest additions are
registered, bringing the exact ordered suffix to12 and physical inventory to613.
Native CLI source transfer, full ledger statement checks, post-body failure PF001,
ledger-insert failure PF002, catalog/row rollback and repeat remain mandatory.
Test-only native filename construction is padded to14 digits for two-digit
ordinals; production identity checks are unchanged.

The post-promotion full-clone route reruns all129 decisions and all24 positive
function behaviors after registered source execution. It replays both forwards,
checks exact metadata/ACLs, deliberately restores the original Storage role
scope and expects the same named42501, then verifies recovery. It also repeats
ACL poisoning/recovery and preserves the complete parent and every case rollback.
The pre-promotion proof is admission history, never a substitute for current CI.

Offline red/green tests cover exact source/identity/proof retention, changed
function/Storage postconditions, all12 negative probes, historical partitioning,
missing/changed/reordered receipts, post-promotion dispatch, incomplete matrix,
mutation and recovery rejection. Full current-head SQL/native/schema/type CI is
still required. Generated types and their manifest are not rewritten in this batch.

No live Supabase mutation, deployment, external market message or PR merge is
claimed. Keep this head stable for clean native execution; superseding PR pushes
cancel the older OPS run. Complete schema decisions must still be independently
reviewed, not copied from an observed difference or accepted wholesale.
