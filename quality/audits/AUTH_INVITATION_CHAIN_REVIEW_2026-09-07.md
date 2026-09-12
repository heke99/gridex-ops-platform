# Historical auth/invitation source chain

Status: IN_PROGRESS. This is source characterization, not production approval.

Skill routing: Supabase security checklist, test-driven-development and
verification-before-completion. UI, performance changes, deployment and a broad
security audit are outside this bounded step.

Reviewed complete, unchanged sources:

- 20260519_auth_email_templates_invite_reset_sync.sql
- 20260519_company_invite_temp_password_sync.sql
- 20260520_direct_temporary_password_auth_sync_fix.sql
- 20260520_company_delete_backfill_and_admin_layout.sql

All four remain UNCLASSIFIED. No original source or checksum was modified.

The new isolated PG17 fixture follows the existing auth/POA fixtures and obtains
membership, invitation, roles and user_roles definitions from actual core SQL.
The companies parent is deliberately minimal. It executes every complete source
twice and rolls the whole scenario back. It does not reproduce full canonical
RLS/default privileges, authentication-provider behavior or production data.

The test names these compatibility and data-effect questions:

1. Cleanup before invitation event normalization must fail the named event-status
   CHECK for the earlier valid `completed` state, with transactional rollback.
2. Invitation normalization changes `completed` to `sent` and a missing event type
   to `unknown`; these are lossy historical transformations, not delivery proof.
3. Direct-password normalization clears the earlier flexible profile tracking
   action. The full flexible-normalization successor must execute afterward.
4. Direct-password source accepts an invitation with issued-password metadata
   even when its expiry is past. A passing characterization is NOT approval of
   this behavior or authorization to replay it against existing live data.
5. Identity/payload fields, timestamps, suspended membership, event user FKs and
   RLS are checked separately from the intentionally characterized changes.

Additional open review: the template's event-read policy uses global role-key
membership without a company scope predicate. This is an unapproved historical
policy, not a confirmed production exposure. Full final-policy and effective
grant analysis is required before restoring this source. The orphan-delete
branch is not exercised by this FK-constrained canonical fixture and must be
reviewed separately for legacy schemas. Do not blanket-exclude or replay it.

Local SQL composition and diff checks pass. Hosted PostgreSQL execution is
pending. No production mutation, source selection change, generated artifact
edit, phase closure or external blocker has been established.
## Auth template restoration — 2026-09-07

Complete four-source PG17 characterization PASS: revision
6b47f339bae2d5af13f7e253f75d82c7830e1995, OPS 34092843096, job 101649830022.
Wrong cleanup order is rejected; complete sources run twice. Only the DDL-only
auth template source is now restored after auth/profile prerequisites. Selection
failed UNCLASSIFIED before, passes after, and reversed order fails. Accounting
29 tests, provenance and 587-file integrity PASS. Counts: 506 full, 28 partial,
49 unknown, four exclusions. Restoration-head CI pending. Three effectful
successors remain unclassified, with lossy status/metadata and orphan-delete
semantics requiring review. Production catalog read only: legacy permissive
SELECT is combined with a RESTRICTIVE tenant/session guard; isolated legacy
predicate is not proof of live cross-tenant exposure. No production mutations,
phase closure or generated-artifact edits. Next: verify restoration head, then
review reconstruction/order for the invitation and temporary-password successors.
## Actor-FK continuation — 2026-09-07

Template restoration published at e1ffdd8749e3edb6f42b17050ee6264267366c9c;
OPS 34120804760 auth PG17 job 101738143562 PASS. No full parity claim.
Next review found a fifth related source, direct_account_temporary_password_flow.
Its conditional REFERENCES clauses are skipped when the invitation predecessor
already created disabled_by/removed_by columns. Both actor FKs exist in the live
catalog (read-only verification); the five-source fixture now characterizes their
absence and the restored profile active-company FK. Hosted execution pending.
Next: verify this order-dependent effect loss on PG17, then implement narrowly
scoped forward FK reconstruction or a fully verified prerequisite restoration.
Counts remain 506 full/28 partial/49 unknown/4 excluded. No production writes,
phase closure, generated-artifact edits or external blocker.
