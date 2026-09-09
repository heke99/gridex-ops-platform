# RBAC canonical restoration

Status: IN_PROGRESS. Published baseline d32a3457983f36b159f5180e8c5ac4fc9516842e.
The isolated reduced RBAC characterization passed PG17.11 in OPS 34227210022,
auth102064145147. This plan advances actual canonical selection and prefix proof.

## Global Constraints

- No production database writes, merge or deployment in this batch.
- Never edit immutable historical migrations or their checksums. No generated
  schema/types regeneration from an incomplete or arbitrary database.
- SQL execution only on a fixed disposable localhost PostgreSQL17 database using
  the existing auth CI service; no user-provided target or command options.
- Use complete actual selected foundation files with the same managed-service
  bootstrap used by canonical replay. Do not replace prerequisites with reduced
  table extracts and call that canonical execution.
- Preserve every existing accounting/parity gate and all other fixtures. Selection
  is not surviving-effect proof; isolated prefix execution is not full replay.
- No phase closes without code/full replay/generated types/ledger/production parity.
- Historical backfill characterization does not authorize running it in production.

### Task 1: Restore and verify the RBAC canonical prefix

Read the actual foundation order, bootstrap substitution manifest/accounting
implementation and the three reviewed sources before editing. Restore these
complete immutable originals exactly once in canonical selection and in order:
20260520_batch_6e_rbac_tenant_stats_whitelabel.sql,
20260520_batch_6e_fix_rbac_backfill_security.sql,
20260520_batch_6e_hard_platform_roles_only.sql.

The earliest current candidate boundary is after
bootstrap/20260527_company_memberships_role_key_foundation.sql. Verify the actual
prefix prerequisites, including company/member/profile columns, all eight billing
domain tables, ediel_actor_settings and the 29 dynamic policy targets. Current
foundation files01/02 define candidates for25targets; attachments, files,
meter_readings and power_of_attorneys are absent there. Do not assume that lexical
presence proves columns, execution or surviving effects. The historical reduced
fixture used a different membership definition, so its success is insufficient.

Retain any narrow bootstrap still needed earlier; account for preserved full
source replay honestly in its manifest instead of dropping provenance. Read
later helper/policy/view overwrites to document the surviving-effect obligations.
Do not reclassify unrelated sources or claim all later effects verified.

Implement a fixed PG17 canonical-prefix selftest using complete selected files
through the chosen boundary and all three restored originals. Assert required
catalog/data effects, full view shapes/invoker option where source defines it,
actual policy-target coverage and absence, existing reference data preservation
outside intended source mutations, and repeated application of the three sources.
Include database-free emit and focused selection/order/provenance checks. Test
real missing prerequisite risks that arise from the actual prefix. If a baseline
prefix fails, record exact source/error and resolve that dependency before claiming
the restored chain executes; never swallow the failure or classify it external.
Integrate with the fixed auth-group runner and its order/failure/status regression.

Run targeted local checks, persist exact results and changes, separate review,
then publish one combined batch for actual hosted PG17 verification. Fix concrete
CI errors and record remaining canonical/production gaps. Root owns active status,
checkpoint and CI receipts; coordinate changed accounting counts before the
status regression. Do not create extra status authorities.

## Confirmed prerequisite for selection: preserve the final role helper

Source inspection at published d32a3457 confirms core01 defines
`gridex_user_has_role_key` with both status and is_active filters. The restored
predecessor definition omits them. No later currently selected immutable source
replaces this helper: the other two historical definitions remain unresolved.
Restoring only the three sources would therefore weaken its final selected
behavior. This is a source-level finding; no vulnerability execution was used.

Add one narrowly scoped forward migration that restores the exact currently
selected core01 helper definition after historical replay. Preserve its complete
signature/body/options and existing grants. Bind the copied definition to the
reviewed core source with a focused equality check. Include the forward migration
in the isolated prefix verification after the historical chain; assert expected
secure active/inactive role behavior only after restoration, using synthetic
identities. Do not demonstrate or execute an exploit of the historical behavior.
Verify accounting selects this migration at the final timestamp boundary and no
later selected helper definition supersedes it. Keep the historical originals
immutable and retain their complete execution/effect accounting.

This is preservation of existing selected behavior, not approval of all RBAC
semantics or a claim that it matches production. On 2026-09-08 a fresh Supabase
catalog-only request for this helper on piidsfebjqjmnepdpnas returned permission
denied. Earlier catalog observations do not establish its current body. Live
parity therefore remains unverified while internal remediation continues.

Follow-up access evidence: Supabase list_projects succeeded on 2026-09-08 but did
not include piidsfebjqjmnepdpnas. The connected project scope therefore cannot
provide the required Gridex catalog. Reconnecting with intended project access is
a scoped external dependency for live verification, not for local/CI remediation.

## Verified final helper options — supersedes early core-option preservation

Fresh authorized catalog reads now succeed for Gridex. The previous connection
blocker is resolved. Live function body MD5 d76c8c4ae10c4f36b772b86255f728ba exactly
matches the core01 body. Its final properties are SECURITY INVOKER and
search_path=public,auth,extensions, with EXECUTE granted to authenticated and
service_role and denied to anon. The selected source
20260611190000_launch_linter_hardening_security_definer_rls.sql lines154 and202-204
establishes those exact later properties and grants through ALTER/REVOKE/GRANT.

The user's no-weakening invariant governs: after copying the exact core function
statement/body into the forward migration, narrowly reapply the verified later
helper-specific search_path, SECURITY INVOKER, PUBLIC/anon revocation and
authenticated/service_role EXECUTE grants. Retain unrelated custom grants.
Assert these final catalog properties as well as secure role-status behavior.
The earlier instruction to retain the core SECURITY DEFINER option as final state
is superseded by this observed later selected hardening. This changes no original
migration and performs no production mutation. Full replay/parity remains open.
