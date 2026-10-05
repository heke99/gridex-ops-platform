# Staff API prerequisite map for named gridex-prod — 2026-10-05

**SOURCE/CATALOG MAP ONLY — production alignment and activation are NOT RUN.**

The 22 frozen Staff forwards cannot run alone in `gridex-prod` (`ayiuxjlfazkjmmtlvhsl`). Missing structures can be supplied by a bounded, guarded prerequisite bundle. A real production tenant/admin and the existing platform readiness gate are separate activation requirements. Replaying all historical migrations would be incorrect.

Frozen forward baseline: OPS `985724f58ef15e222cf4d3b2e1c643c674852106`, tree `0b8ad8d2272f77a346781a13b909aa0cdcc9b8d1`. All 22 source digests match the root-owned readiness receipt. Current portal/backend source is `bd118444dda5095bdb18e0502a801f7121d54b08`, tree `ae709a2054f722dc343b8e6b9853a5afedacd58c`; its additional permission/storage-target changes do not change these migration bytes or prove production alignment.

## Verified facts and limits

`/tmp/gridex-staff-review/gridex-prod-staff-api-readiness.json` records two read-only transactions at `2026-10-05T09:28:46.492292+00:00`: PostgreSQL 17.6, 136 public tables, six ledger entries, none of the 22 Staff filenames/versions and none of their 26 declared public function names. The sampled catalog is not a complete definition/ACL/column audit. A short ledger does not prove every older object absent or authorize executing older migrations.

Root's subsequent read-only inventory confirms `public.user_permissions` exists and `public.customer_portal_write_idempotency` does not. The later check around 10:04 UTC confirms `public.platform_runtime_readiness` is entirely absent and the sampled v3 catalog/integrity/capability definitions are absent. `user_permissions` has the required user_id uuid, permission_id uuid, assigned_at timestamptz, permission_key text, company_id uuid, effect text, status text and is_active boolean columns; its constraints, effective privileges and authority rows remain unqualified. It found two production companies and **no Gridex company**. The earlier Gridex UUID from `piidsfebjqjmnepdpnas` is dev data, not a production tenant choice. Root has asked for the intended company/new-company decision and existing production administrator; these authority choices remain pending.

| Actual production observation | Meaning |
| --- | --- |
| Companies, memberships, invitations, profiles, roles, permissions, user_roles and user_permissions present | Existing definitions, constraints, triggers and effective privileges still need comparison with the actual commands. |
| Customers, contacts, addresses, sites, contracts, metering points and audit_logs present | Preserve rows and access. Check the exact projections and composite ownership keys. |
| customer_cases, customer_case_events, customer_case_attachments and support bucket absent | Add empty support structures/private storage. This does not create incoming cases or import another ticket store. |
| Identity request/event tables, API clients/request/rate-event tables, provider registry and Staff replay table absent | Add only their baseline structures; the original forwards then install Staff guards and RPCs. |
| domain_events/event_outbox and sampled private retention journal absent | Customer mutations need event/outbox structures; the bounded retention reader needs its exact private prerequisites. |
| user_roles.role_id is nullable uuid, without default; reported FK is user_id→auth.users | Forward 18 is compatible already. Do not add the historical dev role_id FK; the captured canonical model does not require it. |
| company_invitations.token and idempotency_key absent | Forward 17 supplies uuid token. Canonical invitation idempotency needs an additional column/index prerequisite. invitation_token text is a different field. |

## Smallest structural closure

The filenames below are **definition origins, not an apply list**. Extract only the final required objects into new guarded forward SQL. Retain existing compatible objects; reject partial/incompatible shapes. Several original files include destructive repairs, unrelated domain changes or data updates and must not be replayed wholesale.

| Layer | Required objects/invariants | Exact source origins and boundary |
| --- | --- | --- |
| Foundations | `extensions.digest`; Auth users; compatible companies/customers ownership keys; `domain_events`, `event_outbox`, `audit_logs` columns used by actual writes. | `20260531111600_system_readiness_foundation.sql`; final `supabase/schema.sql`. Existing base definitions are not fully qualified. |
| Canonical user commands, before forward 1 | `canonical_command_results`, `canonical_audit_events`, `canonical_domain_events`, `canonical_event_outbox`, `company_provisioning_jobs`; `canonical_json_sha256`, `canonical_actor_is_authorized`, `canonical_actor_is_platform_admin`, `gridex_normalize_platform_role`; `canonical_tenant_access_role_mapping` and mapped `canonical_change_tenant_user_access(jsonb)`. Forward 1 unconditionally renames that mapped RPC. | `20260802010000_canonical_tenant_operation_policy_lifecycle.sql`, `20260802014000_canonical_provisioning_access.sql`, `20260802170000_canonical_security_convergence.sql`, `20260802203000_canonical_runtime_consistency_hardening.sql`; normalizer origin `20260727010000_contract_flow_integrity_completion.sql`. Preserve command/result hashes, replay and atomic audit/outbox semantics. |
| Roles and authorization | Compatible roles/permissions/role_permissions/admin_users/profiles/memberships/user_roles/user_permissions; global/company role consistency guards; `gridex_get_user_permissions_in_company` and final `gridex_actor_has_company_permission`. Preserve active roles, company-scoped denies and platform role boundaries. | `20260902091000_company_scoped_permission_engine.sql`, `20260902100000_rpc_surface_and_permission_scope_corrections.sql`, `20261001004953_ediel_current_company_permission_denies.sql`; qualified final function definitions in capture. Static mappings do not imply active role assignments or global grants. |
| Invitation command runtime | `company_invitations.idempotency_key`, unique `(company_id,idempotency_key)`, every intent/provisioning-job/result/lease column referenced by the command. | `20260810193450_canonical_access_provisioning_runtime_v1.sql`. Forward 17 does not add idempotency_key. Forward 1 itself creates/replaces invitation core before renaming it, so an old invitation RPC is not separately needed. |
| Provider registry, before forward 2 | `tenant_customer_identity_providers` with its exact active-company index name, RLS and service-only ACL; `platform_table_classification`. Existing provider purpose must default to customer, with explicit separate Staff enrollment afterward. | `20261002080000_tenant_customer_identity_providers.sql`, classification origin `20260902094000_platform_table_classification_and_invariant_gate.sql`. Customer replay table is not necessary solely for Staff; forward 2 creates Staff replay and forward 12 restricts it. |
| Machine credentials/rate limiting, before forward 3 | Full `integration_api_clients`, `integration_api_requests`, `integration_api_rate_limit_events`, `integration_api_rate_limit_buckets`; `integration_api_scope_present_v1`, `integration_api_rate_limit_check`; public `authenticate_integration_request_v1_credential_core` and its private secret-bearing core. Preserve active client/company, expiry/revocation, scopes, IP/origin, atomic cost limiting and private secret ACL. | `20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql`, `20260717235500_integration_api_rate_limiter_canonical_repair.sql`, `20260809182215_authenticate_integration_request_v1.sql`, `20260809191057_authenticate_integration_request_route_cost.sql`, `20260810224500_canonical_review_remediation_v1.sql`. The limiter origin drops objects: extract final guarded definitions. The public/gridex dump excludes the private secret core: derive it from authentic migration source. |
| Shared auth wrapper references | `company_capabilities`, `tenant_website_installation_receipts` structural shapes, even though Staff does not require website activation receipt/sales capability data. Preserve other API branches. | `20260801143000_canonical_multitenant_platform_hardening.sql`, `20260802231000_tenant_website_provisioning_guards.sql`. |
| Outer write idempotency | **`customer_portal_write_idempotency`** with company/client and company/customer FKs, status/hash/response fields and uniqueness for NULL customer pre-resolution records. Staff user commands require those NULL customer rows. | Actual caller `lib/api/strictRequest.ts`; origins `20260712100000_gridex_end_to_end_integrity_hardening.sql`, `20260713150000_api_performance_tenant_hardening.sql`; final two partial uniqueness indexes in `20260809180628_gridex_ops_external_api_performance_foundation.sql`. Do not use the historical NOT NULL customer projection. `integration_api_write_idempotency` is not the Staff handler's idempotency table. |
| Customer mutations, before forward 4 | `customer_identity_change_requests`, `customer_identity_change_events`, exact immutable/append-only triggers, `gridex_mask_identity_number`; required customers contact/identity/metadata/merged-into columns; audit/domain/outbox structures. | `20261002120000_customer_identity_change_requests.sql`, relevant final columns/guards from `20261002230000_customer_merge_portal_lifecycle.sql`. Forward 4 supplies actual contact and identity decision functions. Do not install older contact bodies or merge/data-moving commands. |
| Cases/events, before forward 5 | `customer_cases`, `customer_case_events`; all Staff-reachable fields; composite company/customer/case ownership keys; RLS/service ACL; support metadata idempotency unique index. | `20260520_batch_5_cases_audit_email_ux.sql`, `20260923180557_restore_customer_case_events_atomic_status.sql`, `20261001200000_support_case_idempotency_unique.sql`. Last origin rewrites duplicate metadata: create its index only on new empty tables; existing duplicates require separately reviewed repair. |
| Attachments, before forwards 5/20 | `customer_case_attachments`, ownership FKs, indexes, release MIME constraints and service-only RLS/ACL; private 10 MiB `support-case-attachments` bucket with original PDF/PNG/JPEG formats. Forward 20 adds octet-stream transport only to quarantine. | `20261002100000_support_case_attachments.sql`. Guard absent-bucket creation; do not reuse its unconditional ON CONFLICT UPDATE to rewrite incompatible bucket settings/storage policies. |
| Retention reader, before forward 19 | Exact private `gridex_received_sources.reject_mutation()` function/schema/ACL and hosted migrator privileges. Forward 19 installs the bounded private owner/four-table FORCE-RLS immutable reader model and service-only RPC itself. | Guard origin `20260922095911_ediel_received_source_ledger.sql`; prosrc SHA256 `0d736e35ddb2519022243066a4362e2dacc38d9a9cdccfc42de28846c888d01a`. No received-source ledger, erasers or retention controllers are needed merely for the reader. |

Check existing customer projections against `lib/staff-api/customerDomain.ts`, `lib/customers/getCustomerForCompany.ts` and `lib/customers/getCustomers.ts`: customer type/status/number, names, personal/org number, contact/language/apartment data, timestamps, metadata/merge state; list duplicate-review, billing/intake/source/test/company fields; contacts/addresses/sites projections with company/customer filters. List hydration additionally attempts contracts, powers_of_attorney and metering points; missing-relation fallbacks do not qualify other failures or bypass the global gate. Contracted identity logic also reads exact binding/notice/start/end/legal-bundle fields in customer_contracts.

Staff overrides use `user_permissions` joined to `permissions` (company/user, permission_key/permission_id, effect/status/is_active). The sampled `user_permission_overrides` is not a substitute. Existing data and every helper's deny precedence remain authoritative.

## Separate readiness dependency

`lib/integrations/apiAuth.ts` invokes `assertPlatformSchemaReady()` **before** Staff credential authentication. `lib/platform/schemaReadiness.ts` requires `public.platform_runtime_readiness` singleton row with `is_ready=true`, version `20260803093300-gridex-runtime-readiness-v3`, a valid 64-hex evidence fingerprint and exactly empty blocking_issues. This is a persisted table, despite legacy view naming; the 30-second cache does not remove the requirement.

The evaluator origins are `20260803093100_gridex_runtime_capabilities_v3.sql`, final targeted catalog `20260812125000_gridex_runtime_schema_catalog_v3_targeted_catalog.sql`, and persistence/refresh `20260813230000_runtime_readiness_dependency_resilience_v1.sql`. It checks **26 relations/nine RPCs**, including website offers/provisioning/readiness, billing, reconciliation and an Ediel rule resolver, plus ACL/RLS/policy and operational integrity (duplicate primary clients, unowned operational rows and invalid client rate limits). The readiness table and sampled v3 definitions are confirmed absent by the root-owned follow-up around 10:04 UTC. The full 26-relation/nine-RPC capability and operational-data state remains unqualified.

The current global gate will therefore reject credentialed Staff requests with 503 before the Staff RPC, even after adding the Staff objects. Inventory its broader required capabilities before choosing genuine full gate closure or a separately authored/qualified Staff capability gate for Staff routes that preserves the global gate elsewhere. The latter is a source change. Never fabricate is_ready, fingerprint, empty issues or historical ledger entries. A Staff-only SQL closure cannot truthfully assert broader readiness.

## Production authority, data and delivery

- Select/create the intended production company with legitimate authority. No Gridex company exists; the dev UUID is not a selection. Do not modify one of the two existing companies or bootstrap a global admin to make tests work.
- Bind the portal's verified production Auth UUID to an active profile and accepted/active company membership with a supported Staff role. Check banned/deleted Auth state, profile status and disabled/expired memberships. Static role definitions/mappings are distinct from active role/permission grants.
- Enroll a dedicated company-bound API client with explicit scopes and a purpose=staff provider with public verification material. Preserve assertion company/user/provider/client binding, permission denies and one-time replay. No credentials or public-provider registration are created by this map.
- Empty new tables produce an empty inbox. Real support cases must have metadata.support_case=true, case_type=other, source starting tenant_support_, without billing/cancellation workflow flags. Do not relabel another ticket store or Ediel/billing rows. Any dev/marketing customer/case import is a separate ownership/FK/public-reference/audit data migration.
- Invitation API commands persist provisioning intent. Actual usable logins require the leased provisioning worker, production Auth, delivery and verified acceptance. Contracted identity changes also need legal bundle/version documents, approval token/route/PDF dependencies and tenant email delivery; failed delivery can cancel a request. These external paths remain unverified until executed.
- Contact and no-contract identity stale guards finish at exact PT409 after forwards 21/22. Prior native/source proof is distinct from a production stale-race test.

## Bounded implementation order and safety

1. Read-only compare remaining definitions: canonical tables/helpers, rate buckets/private credential core, exact existing columns, ownership keys, triggers, role scopes, RLS/effective ACL and readiness row/evaluator. Inspect migrator CREATEROLE/BYPASSRLS/SET ROLE and grant options needed by forward 19. Dev rollback probes do not prove production privileges.
2. Author new guarded prerequisite forwards from the closure above. Preserve compatible objects/rows; incompatible partial objects abort. No blanket grants, data cleanup, workers, erasers or unrelated Ediel migrations.
3. Dependency order: foundations/ownership keys → canonical access/invitation idempotency → machine credential/rate core/provider/classification → outer write idempotency → customer identity/case/attachment/bucket and immutable guard → all original 22 forwards below. Their internal transaction boundaries require an exact reviewed rollback rehearsal; naïvely concatenating BEGIN/COMMIT files is unsafe.
4. Qualify a faithful production-shape upgrade fixture, real RPC/native tests, generated schema/types and effective security/ownership/replay/idempotency assertions. Root owns exact hosted rollback rehearsal, one reviewed ledger apply and postflight exact source checksums. Do not fabricate older ledger entries or require the unrelated dev ledger.
5. Separately provision approved tenant/admin/client/provider, align the backend service target with the named production project, verify mismatch rejection before auth/rate/audit/handler writes and successful JSON/binary project attestation, then run scoped production acceptance/cleanup. Current source target protection is not deployed production evidence.

**Safe additive:** absent empty service-owned structures, compatible new indexes, nullable invitation columns, qualified function wrappers/static non-authority mappings and guarded private bucket creation. **Needs data analysis or a separate data migration:** existing duplicate/invalid ownership or role scopes, NOT NULL backfills, invitation token conversion, tenant/admin enrollment, business data/credentials/active-role transfer. Empty schema alone does not require transferring dev data; inbox continuity and authority are separate.

## Historical scope and reviewer activity

Prior hosted Staff acceptance on `piidsfebjqjmnepdpnas` belongs to the project named **gridex-ops-dev**, even when accessed at app.gridex.se. Preserve those receipts as history. CI native/clean/upgrade proves its exact source/synthetic schema; it does not prove production ledger, Auth, tenant rows, delivery or service target. This map ran no SQL/HTTP, tests/replays, key/configuration/provider/domain or production actions.

Skill routing: Supabase/Postgres security, direct source dependency tracing, repository context and evidence-before-completion apply. Migration implementation/CLI, UI/performance, provider setup and broad masterplan/scanner audits are outside this bounded task. Root owns shared checkpoints; this document is this reviewer's sole repository edit.

## Frozen forward order

Full digests are bound by the accompanying review receipt and original readiness receipt; these are original source filenames, not predicted hosted migration timestamps.

1. `20261004083640_staff_user_commands.sql`
2. `20261004083735_staff_identity_provider_purpose.sql`
3. `20261004083809_staff_api_integration_auth.sql`
4. `20261004084204_staff_customer_write_attribution.sql`
5. `20261004084206_staff_case_write_attribution.sql`
6. `20261004085008_staff_active_membership.sql`
7. `20261004085710_staff_support_create_atomic.sql`
8. `20261004090602_staff_case_events_api_auth.sql`
9. `20261004093111_staff_write_actor_guard.sql`
10. `20261004094344_staff_user_client_guard.sql`
11. `20261004095500_staff_user_actor_guard.sql`
12. `20261004100320_staff_assertion_replay_least_privilege.sql`
13. `20261004100849_staff_case_assignee_eligibility.sql`
14. `20261004100918_staff_user_lock_order.sql`
15. `20261004114944_staff_contact_profile_authority.sql`
16. `20261004115007_staff_case_status_actor_compatibility.sql`
17. `20261004132630_staff_invitation_domain_columns.sql`
18. `20261004165620_staff_user_role_id_nullability.sql`
19. `20261004205603_staff_customer_retention_read_prerequisite.sql`
20. `20261004205816_support_attachment_quarantine_carrier.sql`
21. `20261005004623_customer_contact_version_conflict_http409.sql`
22. `20261005010327_customer_identity_version_conflict_http409.sql`
