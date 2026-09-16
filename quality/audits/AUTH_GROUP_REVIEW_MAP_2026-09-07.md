# Auth, membership and tenant review group

Evidence scope: source review and isolated fixture coverage, not complete replay
or production parity. Current progress belongs to the project current-state
record. This document records review decisions for the grouped remediation.

The reproducible inventory is
`AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json`, generated from unchanged source accounting at `2ed76429`, with the mapper
SHA-256 embedded for reproducibility. It contains every
candidate in the active group: 334 inputs, comprising 265 whole-file selections,
25 unresolved substitutions, 40 unclassified inputs and four explicit exclusions.
The 65 unresolved group candidates overlap other domains; the global unresolved
total remains 77. This inventory is not a claim that all 334 files have received
complete statement-by-statement review. The clusters below are the reviewed next
work boundaries. Re-run `python3 scripts/gridex-replay-review-groups.py --group
auth_membership_tenant` to include the full cross-group adjacency hints; exit 1
is expected until the global unresolved set is resolved.

## Dependency review

The group is broader than auth-named files. Shared objects are routing hints;
the SQL and actual canonical execution order must establish each dependency.
Timestamp order alone is insufficient because the foundation selector changes
the order of historical inputs.

| Cluster | Required review boundary | Evidence and unresolved effects |
| --- | --- | --- |
| Core and profile foundation | Actual companies, roles, user_roles, memberships and auth.users definitions before callback and profile normalization | Existing auth and POA fixtures cover a deliberately reduced parent schema. They do not prove full final privileges or provider behavior. |
| Invitation and direct accounts | Template, invitation temporary-password fields, direct-account flow, auth-sync fix, then orphan cleanup | Five-source PG17 characterization passed. Only the template is restored. Conditional column creation can skip inline actor FKs; the separate forward repair covers those two FKs only. Status normalization and orphan deletion remain separate data decisions. |
| Runtime governance | `20260519_batch_6d2_runtime_governance_completion.sql` plus its table/function prerequisites | Creates session revocation records, role/company helpers and operational guards, but also Ediel functions. Requires cross-group fixtures; restoring auth fragments would not account for this whole file. |
| RBAC and tenant metadata | `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` before `20260520_batch_6e_fix_rbac_backfill_security.sql` | The fix explicitly names its predecessor. It normalizes company environment/status, creates admin memberships from active_company_id and inserts company_admin roles without company_id. These are operational data effects, not harmless DDL defaults. |
| Platform role boundary | `20260520_batch_6e_hard_platform_roles_only.sql` and all later replacements | Deletes non-platform role permissions and replaces gridex_user_is_platform_admin. Later May/June/July definitions and `20260802190000_canonical_emergency_access_lockdown.sql` must be followed before assessing final behavior. |
| Provisioning diagnostics | `20260528_auth_provisioning_runtime_guard.sql` after complete profile/membership/role definitions | Full-join view uses auth.users timestamps missing from minimal fixtures. Both June 11 launch-readiness sources subsequently set security_invoker and revoke anon through dynamic view lists. Creating the initial view alone is not proof of its final security. |
| Final policy and session state | Later policy consolidation, restrictive lifecycle guards and forward repairs | `20260730130000_historical_sync_forward_repair.sql` replaces the complete session guard and has a separate contract-function text-repair prerequisite. Do not isolate that definition and label its containing migration fully accounted. |

## Data effects requiring explicit decisions

- Preserve historical status transformations in the review: completed invitation
  events can become sent/unknown; suspended profiles become disabled. A passing
  characterization establishes what SQL does, not whether replay is appropriate.
- Temporary-password metadata cleanup and orphan deletion require synthetic
  before/after cases and a decision on surviving canonical effects. Never run
  named-user repair scripts automatically based on a filename domain.
- RBAC backfill must cover two-company membership, existing grants, missing
  membership, null active_company_id and disabled states. Check role scope after
  every later overwrite and cleanup, not just the first insertion.
- Dynamic SQL and conditional missing-table branches remain visible for manual
  review. An unexecuted branch is not an accounted effect.

## Next coherent fixture expansion

Extend the isolated auth group with the complete RBAC/tenant metadata predecessor
and fix, followed by the hard platform-role boundary, after validating their
actual core prerequisites. Use synthetic companies/users only. Assert exact
membership and role attribution, existing-row preservation, normalization,
second-apply behavior and transactional failure. Inventory every statement and
cross-group dependency before selecting any whole source.

The RBAC predecessor's final billing view joins customers, customer_sites,
metering_points, ediel_messages, metering_values,
customer_authorization_documents, billing_underlays and partner_exports. Its
undefined-table/column handler silently omits that view. A reduced fixture that
passes without these tables therefore cannot establish complete source effects.
The same source dynamically updates policies for 29 named company-scoped tables;
coverage must enumerate present and deliberately absent branches explicitly.
Its environment CHECK precedes the successor's normalization, so legacy invalid
environment values need a negative-order case before any replay decision.

Then extend governance/provisioning coverage through later function, view and
policy hardening. The fixed group runner consolidates existing fixtures; it does
not itself expand their database coverage. Full canonical replay, generated
schema/types, ledger reconciliation and production parity remain separate gates.

## Inventory validation

The committed inventory was compared directly with the current mapper output:
mapper SHA-256, global counts, candidate count and every retained per-input field
match. All 334 candidates and the global 77 unresolved inputs are preserved.
The mapper's 15 focused tests pass; this inventory check does not execute SQL.
Large JSON size is intentional machine-generated evidence, not a second status
system; regenerate it when its pinned input or mapper changes.
