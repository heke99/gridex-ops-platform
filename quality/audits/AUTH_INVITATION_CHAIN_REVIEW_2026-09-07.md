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
