# Invitation replay effects — 2026-09-06

Status: **PARTIAL; no plan phase closed.** Forward reconstruction is locally
verified in an isolated PostgreSQL fixture. Authoritative clean replay, generated
types/schema capture, ledger accounting and two-way live parity remain open.
No production mutation, credential issuance or provider delivery was performed.

## Routing and boundary

Read AGENTS.md, required active memory and database/migration domain memory;
inspected installed skills and actual table, SQL functions, TypeScript callers,
generated types, history checksum and substitution metadata. Applied Supabase,
Supabase Postgres best practices, systematic debugging, test-driven development
and verification-before-completion. `using-superpowers` explicitly exempts
subagents. This is one delegated database reconstruction, not a repository-wide
audit. UI/performance/security scanner/branch delivery skill groups are not
activated: no UI, measured optimization, scanner, branch publication or full
security assessment is in this boundary. The parent owns plan/memory and wider
review. No new agents were dispatched. Supabase CLI reference was consulted;
the changelog Markdown fetch failed on unsupported content type. Local pinned
CLI help/version were verified before migration creation.

## Confirmed finding

**High — canonical invitation runtime depends on absent table columns.**
`supabase/schema.sql:52516` and `supabase/database.types.ts:9758` expose the same
16-column legacy invitation shape. Read-only live catalog observation has 23
columns, including fields required by the current canonical invitation path.
The source `20260527_fix_company_user_invite_runtime_columns.sql` is substituted
by `bootstrap/20260527_company_memberships_role_key_foundation.sql`; the latter
restores memberships only. That substitution does not reconstruct invitations.
This is an evidenced missing-effect finding, not evidence that the entire
historical source has now been accounted for.

| Execution path | Invitation dependency and impact |
| --- | --- |
| `lib/auth/companyInvitationFlow.ts` provision → canonical create RPC | Durable intent INSERT needs full_name, membership_role, role_key, token, invited_by and accept_token_hash. Missing fields prevent creation. |
| `canonical_provision_company` in snapshot | Initial admin intent uses the same fields; the company provisioning path reaches the defect. |
| `lib/tenant/provisioningWorker.ts:100` | Worker reads those columns plus invited_user_id under company_id/idempotency_key; missing columns produce invitation_intent_lookup_failed. |
| `deliverCompanyInvitationIntent` | Verified Auth delivery records invited_user_id under invitation ID/company/status filters. |
| `getCompanyInvitationByToken` | Hash lookup requires accept_token_hash plus full_name/role fields; its schema-error fallback returns null, hiding valid invitations. |
| `canonical_accept_tenant_invitation` | Rowtype accesses invited_user_id, invited_email, role_key, membership_role and invited_by for verified user/email/role checks and membership creation. |
| `lib/tenant/governance.ts:745` | Pending invitation fallback reads invited_user_id, invited_email, role_key and membership_role; its fallback cannot recover when those columns are missing. |
| `lib/tenant/companies.ts:143` | Recent invitations need full_name and role fields; schema failure is hidden as an empty list. |
| `app/admin/companies/actions.ts:325,568` | Compensation and user removal write revoked_at, and removal filters invited_user_id. |
| `app/admin/users/actions.ts:512`; snapshot auth cleanup function | User cleanup references invited_user_id; missing column skips/fails the invitation reference operation depending on caller. |
| Tenant lifecycle, diagnostics, control tower and pending counts | Existing company/status/id fields; no additional missing-column repair needed. |
| Existing invitation triggers | Enqueue uses status/idempotency_key/company_id; acceptance guard uses company_id/status. Definitions remain unchanged. |

## Source and catalog decisions

The forward migration is
`20260906081839_canonical_company_invitation_runtime_reconstruction.sql`,
created by **Supabase CLI 2.101.0 `migration new`**, with its SHA-256 registered
in `scripts/migration-history-manifest.json`.

| Effect | Evidence | Decision |
| --- | --- | --- |
| full_name, membership_role, role_key, token, invited_by, invited_user_id, revoked_at | `20260519_final_saas_hardening.sql`, active RPCs/callers, live catalog | Add missing fields; membership_role NN/member and token NN/gen_random_uuid preserve source/live declaration. |
| accept_token_hash | `20260519_company_invite_temp_password_sync.sql`, token lookup/RPC, live | Add nullable text. |
| invited_email | `20260527_fix_company_user_invite_runtime_columns.sql`, acceptance/governance, live | Add nullable text. Do not infer or backfill identity from aliases. |
| temporary_password_issued_at/expires_at | `20260519_company_invite_temp_password_sync.sql`, live | Add passive nullable timestamps only. No temporary credentials are generated or flows revived. |
| Membership role CHECK | May 27 source and exact live role vocabulary | Add only if absent, fully validate existing data. |
| Invited actor/user foreign keys | May 19 final source and live pg_constraint | Add missing auth.users FKs with ON DELETE SET NULL. |
| Token and accept-hash uniqueness | May 19 sources and live pg_indexes | Add standalone unique indexes. Live pg_constraint confirms token uniqueness is not a UNIQUE constraint. |
| Expanded delivery status CHECK | Canonical and live both include pending/sending/sent/delivery_uncertain/accepted/revoked/expired/invitation_revoked/invited/failed | Preserve; do not regress to historical smaller vocabularies. |
| Existing data, grants, RLS, policies, triggers | Safety boundary and source-independent invariants | No UPDATE/DELETE statements or privilege/trigger/policy changes. Existing legacy fields remain. |

A token column newly introduced to a populated legacy table receives the original
source-defined random UUID default. No existing token is replaced, no legacy
invitation_token is interpreted, no accept hash is invented, and no delivery
trigger fires from this DDL. Membership role similarly receives its source
member default only when the entire column is absent. This is structural
reconstruction, not verified conversion of old invitation records.

## Verification

Fixture command (PGlite **0.3.14**, installed outside the repository):

```sh
GRIDEX_PGLITE_MODULE=/tmp/gridex-invitation-validation/node_modules/@electric-sql/pglite/dist/index.js node quality/audits/invitation-replay-effects-selftest.mjs
node scripts/check-migration-versions.cjs
```

- RED: three real runtime projection shapes fail with PostgreSQL 42703 against
  the invitation CREATE TABLE extracted from committed schema.sql. The red
  baseline ran before migration implementation; the selftest repeats it.
- GREEN: 18 assertions pass for runtime projections, current RPC INSERT column
  shape, preservation of every pre-existing row field, repeat apply preservation,
  role/status rejection, both auth FKs, token/hash uniqueness, unchanged company
  deletion RESTRICT and unchanged RLS enabled flag.
- Two additional dirty-upgrade scenarios reject invalid existing membership role
  and dangling invited_by with 23514/23503. Explicit rollback leaves original
  values intact and removes newly added token DDL.
- Migration integrity passes: **587 files, 491 version groups, checksums verified**.
- Read-only live pg_constraint and pg_indexes queries verified exact role/status
  check vocabularies, actor FKs and unique-index shapes. No customer rows read.

The fixture has minimal auth.users/companies parents and the snapshot invitation
DDL. It does **not** run the full canonical RPC, provider delivery, JWT/RLS role
matrix, full migration chain, ledger or extensions. RLS flag preservation is not
proof of tenant isolation. No type manifest or schema snapshot was hand-edited.

## Residual and blocked checks

1. Canonical-only invitation_token/cancelled_at/created_by/updated_by columns
   remain; live updated_at is nullable while canonical is NN. A rename/drop or
   nullability change lacks a reviewed lifecycle decision.
2. Company FK is canonical ON DELETE RESTRICT versus live CASCADE. Preserve
   RESTRICT; do not weaken deletion safety just to reduce the parity count.
3. Live query/FK-support indexes are not fully reconstructed in this bounded
   runtime/constraint patch. Index column orders differ across historical sources.
4. Existing fields/constraints/indexes with the correct name but incompatible
   definitions are preserved by IF NOT EXISTS. A future controlled apply must
   preflight types/defaults/nullability, constraint definitions and index keys,
   unique flags/predicates; block on mismatches rather than treating a successful
   apply as semantic parity. Dirty rows abort validation; no automatic data repair.
5. Historical role seeds, membership/user-role effects, backfills, policies and
   other effects from substituted sources remain outside this partial account.
   Do not mark a source fully verified from this table-only migration.
6. Authoritative Supabase-stack replay may reveal earlier dependencies not
   covered by this table fixture. Types/schema must be regenerated from the
   approved canonical replay artifact and compared both ways to live and ledger.
7. Production/staging application, real authenticated acceptance and provider
   E2E are not executed. The migration remains unapplied to production.

Next: review this bounded migration, run authoritative canonical replay and
regeneration, classify the remaining invitation differences/effects, then perform
full code/types/schema/ledger/live parity before any phase closure.

Parent review: the historical invitation table fixture is frozen in
`scripts/sql/canonical-company-invitation-baseline.sql`, copied verbatim from
`supabase/schema.sql` at commit 0a0f40684f8e7cfb7a269e660f6c6fb1e821e71a.
The regression reads that fixture so an authoritative future schema refresh
does not erase its failing-before-repair case. It is not a replacement baseline.
