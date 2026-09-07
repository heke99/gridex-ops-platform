# Membership actor FK reconstruction

Status: IMPLEMENTED_NOT_VERIFIED on PostgreSQL. No masterplan phase closed.

Evidence: complete five-source PG17 characterization passed on revision
3f080869e58880754e204f0430d1d447ee17aa30, job 101739209647, OPS 34121147911.
Invitation source creates disabled_by/removed_by without REFERENCES; later
direct-account ADD COLUMN IF NOT EXISTS statements cannot add their FKs.
Read-only live catalog confirms both named FKs target auth.users(id), SET NULL.

Forward migration 20260907121951 was created using pinned Supabase CLI 2.101.0.
It adds missing nullable UUID actor columns and separately validates both FKs.
Existing matching names must have equivalent columns/targets/delete behavior
and be validated, nondeferrable constraints; conflicting definitions abort.
Unknown actor IDs abort, without changing or discarding data. Existing RLS,
policies, grants, status, role, tenant identity and other FKs are untouched.

The fixed-local-PG17 test creates four disposable databases: existing columns,
missing columns, invalid actor ID, and incompatible same-name constraint.
It asserts baseline failure, two successful applies, preserved membership and
actor data, SET NULL on actor deletion, and rollback of both failure scenarios.
It is not production mutation, full RLS/E2E proof or authoritative replay.

Local SQL composition, diff checks, 29 accounting tests and integrity PASS
(588 files, 492 groups). Hosted repair verification pending. Types remain
deliberately stale until authoritative complete replay can generate them.

Next: verify hosted reconstruction and register exact evidence, then continue
49 unclassified sources/28 partial substitutions. Do not classify whole source
effects as complete merely because these two constraints are reconstructed.
## Verified actor-FK reconstruction — 2026-09-07

Published code 6d9e579c8af1c7f4509cb7bbb13750711e3be4fc; OPS 34121661358,
job 101740868281 PASS. Existing/missing-column repair runs twice, preserves
identities/status/policies/RLS and clears actor references on deletion. Dirty
actor and conflicting-constraint scenarios roll back without partial repair.
Complete five-source characterization and template/POA selections also PASS.
Integrity/readiness PASS: 588 files, 492 groups, 495 ledger-eligible versions.
Types correctly fail new tail 20260907121951. Full-effects gate remains red:
507 full selected, 28 unresolved substitutions, 49 unknown, four exclusions.
No phase closed or production writes. Next: continue unclassified invitation,
direct-account and governance effect reconstruction, then authoritative complete
replay/schema/types and ledger/live parity. Actor FK repair is scoped evidence,
not complete classification of either historical source. PR #310 updated.
