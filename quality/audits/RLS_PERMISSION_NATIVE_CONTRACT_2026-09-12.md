# Plan 77/78 — Native permission, tenant CRUD and storage test contract

2026-09-12; recovery repository observed at `4ae4f1dc`. Read-only preparation requested by root. No application, SQL, migration, workflow, memory, customer data or native database was changed or queried. This document is a finite implementation/test plan; none of its native scenarios has run in this lane.

## Outcome and immediate feasible path

An existing safe native substrate is reusable: `scripts/canonical-auth-provisioning-legacy-batch.py::OwnedPostgres` creates a private, labelled, network-disabled `postgres:17` container, sends SQL through local Docker exec/Unix sockets, rejects external targets and arbitrary database names, captures private logs, and destroys only its matching name/label. Use a **new dedicated container instance** and its already allowlisted `gridex_auth_legacy_native` and `gridex_auth_legacy_atomic` databases for a source-pinned permission/storage fixture; do not attach to a replay controller's active container or extend its admission allowlists. This allows finite native source-behavior tests without production or a mass historical replay.

There is not yet a ready-to-run fixture combining the latest canonical resolver, current storage policies, critical public policies and their exact grants. Existing tenant guard tests are reduced relationship-trigger tests; historical RBAC tests characterize old backfills. A small source manifest and fixture composer still need implementation and independent review. Full effective-schema/managed-Storage-API acceptance remains separate from a successful reduced native fixture.

Root's follow-up direction settles the implementation candidate for ordinary actors: **deny wins across applicable global plus same-company overrides; unrelated-company overrides are excluded**. Preserve the authoritative platform bypass approved in Task 5. This direction is recorded as the candidate contract, not attributed to an already-consistent historical implementation. Direct `user_permissions`, role-deny precedence and permission-key mappings for public table policies remain decisions/gates below.

## Read/routing record and source authority

Read prior `permissions-audit.md`, current state and relevant decisions/failures, then traced actual sources, callers and test harnesses. Applied the Supabase skill's RLS/grants/SECDEF/session/storage review guidance and repository source-to-sink/false-positive/verification discipline. No Supabase feature was implemented, so no live query, migration or CLI generation was attempted. No subagents were used. The only written output is this document.

“Latest body” below means the latest defining/renaming source found in the repository, not deployed truth or proof that the entire selected chain has replayed. The September 11 private alignment boundary also changes historical helper ACLs. The source-selection order/admission manifest must establish the effective combination before a whole-schema claim. `supabase/schema.sql` is supplemental catalog evidence, not a substitute for those source receipts; do not regenerate it from the proposed fixture.

## Resolver and writer source closure

| Boundary | Exact source and behavior relevant to fixture |
|---|---|
| Canonical authenticated resolver | `20260902091000_company_scoped_permission_engine.sql` delegates to `canonical_authenticated_tenant_context_v1_scoped(uuid)` |
| Actual scoped body | Originally `canonical_authenticated_tenant_context` in `20260810193450_canonical_access_provisioning_runtime_v1.sql` (537–704); renamed and public/authenticated execution revoked on the old name by `20260810224500_canonical_review_remediation_v1.sql` (291 onward) |
| Canonical identity and selection | `auth.uid()` required; auth user nondeleted/unbanned/email-confirmed; profile `user_status='active'`. Ordinary selection requires active membership (`status` and `is_active`) and active same-company `user_roles`. Unknown explicit company does not fall back: it can return authorized=true with null selected company/access_invariant_ok=false. Default selection orders owner then membership creation time |
| Canonical permissions | Active `user_roles` and active `roles`, matching selected company or global role rows; `role_permissions.effect` allow/null only. No `user_permissions` or `user_permission_overrides` lookup |
| Scoped permission array | `20260902091000::gridex_get_user_permissions_in_company(user, company)` validates role assignment status/activity, active role definition and membership for scoped role grants. Global normalized platform roles apply across companies. It also unions `user_permissions` without checking its company, status, activity or effect; overrides omitted |
| Shared permission array | Latest `20260902100000_rpc_surface_and_permission_scope_corrections.sql::gridex_get_user_permissions(user)` returns grants held anywhere backed by active membership/global platform role plus the same unconditional direct-grant union. This intentional shared-masterdata behavior must not become a tenant authorization fallback |
| Boolean wrappers/ACLs | Same September 2 follow-up makes `gridex_has_permission(user,key)` SECDEF, keeps tenant wrapper `gridex_has_permission_in_company(company,key)`, revokes array resolvers from PUBLIC/anon/authenticated and grants boolean wrappers to authenticated. Arbitrary-user boolean wrappers still exist; no new array-RPC exposure is authorized |
| Actor predicate backing Storage | Same follow-up `gridex_actor_has_company_permission(actor,company,key)`: auth user nondeleted/unbanned; broad global platform branches or active membership/company plus scoped permission array. It does not check profile status, confirmation or current-session helper; ordinary company deny-list omits paused |
| Authoritative platform predicates | `canonical_actor_is_platform_admin(user)` latest body in `20260802203000_canonical_runtime_consistency_hardening.sql`; `gridex_user_is_platform_admin()` latest body in `20260802190000_canonical_emergency_access_lockdown.sql`. Both use authoritative global assignment/admin_users plus identity checks, with details not identical. Keep platform identity/status controls and explicitly test inactive assignment versus inactive role-definition variants |
| Role-scope invariant | `20260902091000::gridex_assert_role_scope_is_consistent()` trigger on `user_roles`: global nonplatform role and company-bound platform role reject with 23514. Never disable this trigger to manufacture a “normal” positive fixture |
| Canonical operation metadata | Resolver invokes `canonical_tenant_operation_decision(company,operation)` for seven operations. Latest full body is `20260902094500_decouple_contract_sales_from_ediel_send_state.sql`: companies, company_capabilities, integration_api_clients; optional ediel_production_state. Actual Ediel-send evidence branch is not among those seven resolver calls, so no claim to test that branch |
| Override writer | `app/admin/users/[id]/actions.ts` add/replace/remove/clear actions → `lib/admin/platformUserAccess.ts::runCanonicalPlatformAccessCommand` → `20260802203000::canonical_manage_platform_user_access(jsonb)` |
| Writer admission | Application platform-admin gated; SQL independently requires active authoritative platform actor and any existing nondeleted target auth user. Target need not be platform admin or have a membership. Thus ordinary-user global overrides are a real admitted product path |
| Writer scope/atomicity | Public input has no company target. Override branches write/delete only `company_id IS NULL`. Upsert replaces all global rows for the key; replace rejects allow/deny overlap (23514), validates catalog keys, deletes global rows then inserts allows/denies. Per-target advisory transaction lock, result hash/idempotency and audit are preserved |
| Other override paths | Current app/lib scan found no separate tenant-scoped override create/update path. Admin detail reads all active overrides for the user; user-deletion cleanup references the relation. Do not infer that company overrides are impossible in existing data just because current UI writes global rows only |
| Legacy override read | Latest body `20260526_debug_step1_2c_full_schema_code_alignment.sql::gridex_get_user_permission_overrides(user)` returns active overrides whose `valid_from<=now` and `valid_to>=now`, inclusive, regardless of company. No order clause. `20260911114443_canonical_user_rbac_customer_alignment_boundary.sql` explicitly revokes the helper from nonowner roles inside its private admitted chain |

Read-only source hashes for reproducible body selection are recorded at the end. The fixture must validate parent-source hashes **and** exact signature/body slice; do not rewrite original migrations to simplify prerequisites or rerun their unrelated cleanup DML as an unlabelled baseline setup.

## Permission algebra: established versus candidate versus unresolved

Established product facts:

- Admin user page says role is base access and an override is individual allow/deny beyond that base (`app/admin/users/[id]/page.tsx`, line 80).
- `lib/rbac/getUserPermissions.ts` explicitly says deny still wins after role fallback; it adds allow entries and removes deny entries. This proves the role-grant → individual-deny intent, but implementation is order-dependent when multiple applicable override rows conflict.
- The current writer creates one global decision per key by delete+insert and rejects overlap in bulk replacement. It does **not** constrain the target to platform users and does not enforce uniqueness across global NULL company values through the original nullable composite unique key alone.
- Role and membership activity are part of the existing canonical target authorization boundary. An override cannot establish identity or membership in a company by itself.
- Global authoritative platform bypass in page/action guards was expressly preserved in Task 5 and reaffirmed by root. A permission-array deny must not silently revoke that separate authority.

For ordinary actor u and nonnull target c, define the proposed deterministic candidate:

- `Eligible(u,c)`: verified active identity, active membership in c, selected context bound to c. Exact role-assignment requirements for selecting a company remain the existing canonical contract unless separately changed.
- `R(u,c)`: allow grants from active role definitions and active same-company assignments backed by active membership; global nonplatform assignment never grants.
- `O+(u,c)` / `O−(u,c)`: allow/deny keys from active override rows for u with `company_id IS NULL OR company_id=c` and valid time window. Existing `valid_from`/`valid_to` inclusive boundaries are the source-backed baseline.
- **Candidate effective permission:** `Eligible(u,c) AND key ∈ ((R(u,c) ∪ O+(u,c)) \ O−(u,c))`.
- No grant from an unrelated company's override; global deny wins over same-company allow; same-company deny wins over global allow. Duplicate ordering must not change the answer. Root explicitly directed this fail-closed candidate; the legacy unordered loop does not independently establish cross-scope precedence.

Keep authority and operation decisions separate: platform identity is not equivalent to having every key in the permission array, and a permission does not itself bypass company lifecycle or a command's readiness gate.

Decisions still needed before expanding the candidate:

| Decision | Evidence / boundary |
|---|---|
| Direct `user_permissions` policy | Actual foundation relation has `company_id`, `effect`, `status`, `is_active`, UUID/key columns. Current array helpers ignore all but user and permission_id. Current app/lib scan found no direct writer. Canonical context omits direct grants entirely. Do not silently make global direct grants apply to all companies, or silently delete their semantics. Decide whether this legacy mechanism remains supported; if retained, bind scope/activity and define its deny behavior before adding it to `R` |
| Role-level deny precedence | `role_permissions.effect='deny'` is currently filtered out, not a veto over another role's allow. User override “deny wins” copy does not conclusively establish role-level veto semantics. Preserve existing role allow union while separately deciding role deny behavior |
| Permission catalog `is_active` | Roles are filtered for activity but permission rows are not uniformly filtered. Decide whether inactive permission catalog entries are disallowed or retained as named legacy keys; characterize first |
| Expiry aliases | Legacy override RPC uses valid_from/valid_to. Detail UI reads valid_from/valid_to plus granted_at/expires_at, displaying former first. Current canonical writer does not accept expiry fields. Do not invent a rule combining both column pairs without reconciling source history and write contracts |
| Shared-masterdata overrides | Shared resolver intentionally asks “held in any active membership.” Tenant override must not leak to another tenant; decide whether shared result is union of each independently evaluated active-company permission set plus valid global platform/shared grants. Preserve the F-18 shared-masterdata positive control |
| Public policy permission keys | Customers/sites/metering and several money tables currently grant through membership/lifecycle predicates, not a named users/customers/billing permission. Resolver parity does not make an override block those policies. Table/operation→permission mapping is a separate product/security change; leave open |

## Storage and lifecycle: exact baseline and proposed surface

Latest policy bodies remain `20260806152004_gridex_aud_001_storage_helper_private_schema.sql`, preceded by `20260806151106_gridex_aud_001_customer_document_storage_isolation.sql` which removes obsolete broad policies and creates the service-role bucket policy. The private migration replaces four authenticated policies and removes the public path helper; it does not recreate/drop the predecessor service policy.

Path contract is already strict: exactly `companies/{companyUUID}/customers/{customerUUID}/{customer|site-UUID}/{type}/{filename}`, seven components; RFC-shaped UUID validation, no leading/trailing slash or `//`; allowed types power_of_attorney/complete_agreement/grid_invoice_suggested; bounded safe filename; customer must belong to company; site must belong to both customer and company. Read requires masterdata.read OR switching.read. Write requires masterdata.write OR switching.write. UPDATE checks old and new names. All four policies require customer-documents bucket. Keep all of these checks.

PERM-03 source baseline: private helper eventually calls September 2 actor predicate, whose ordinary company filter accepts active `is_active` and status not archived/suspended/pending_deletion/deleted. Thus paused with is_active=true passes the same write-key predicate as active. The public `20260814162500` restrictive policies apply only to public company_id tables, **not storage.objects**. Its `gridex_can_write_company` accepts only active/onboarding; membership write roles owner/admin/company_admin/operations. `gridex_can_read_company` permits active/onboarding/paused for active members and broader platform read visibility.

Narrow proposed forward surface: update **private path helper**, preserving signature/name/path validation and grants, to conjunct operation-specific session/lifecycle predicates (`gridex_can_read_company` for read; `gridex_can_write_company` for write) with the existing target-bound permission decision. Do not globally tighten `gridex_actor_has_company_permission` without its EDIEL/command callers. This also adopts the public helper's membership-role write restriction; test operations positive and viewer+write-grant negative and record that intended tightening. Keep platform read behavior and platform write lifecycle restriction explicit: platform active-company write may pass, paused-company raw storage write should fail under this candidate. Task 5's global application authority does not imply unbounded raw Storage operational writes.

The proposed conjunction must not be represented as complete session revocation protection. Latest `gridex_is_current_session_allowed` (`20260730130000_historical_sync_forward_repair.sql`) checks auth.uid, profile status (`disabled`, `locked_security`, `removed_from_company`, `invitation_revoked`) and disabled_at. It does not read auth.sessions or platform_session_revocations; it can return true if no profile row exists. Storage actor predicate separately checks auth user nondeleted/unbanned but not confirmation/profile. These are exact source differences to characterize. No new live/session exploit is classified here: the full revoke action/GoTrue/token/Storage path has not been traced or executed. Test profile-disabled “session denied” separately from a genuinely revoked/missing session token, and leave the latter acceptance pending an explicit contract.

## Finite native fixture design

Two synthetic tenants A/B, two customers A1/A2 in A and B1 in B, and one valid site/contract/metering point per customer. Actor pool:

- U_A: active A member, no B membership; U_B mirror.
- U_AB: active member of A and B, role grants differ by company.
- U_NONE: active identity without company membership.
- U_PLATFORM_ROLE: authoritative global platform role; U_PLATFORM_ROW: active platform admin_users fallback.

Create state variants transactionally from these actors (inactive/removed membership, role assignment, role definition, profile, auth status); do not disable authorization triggers to insert forbidden role scopes. Seed data with owned setup role, then run actions with `SET LOCAL ROLE authenticated` / anon and fixed synthetic JWT claims. Assert actual `current_user`, auth.uid, role non-superuser/non-bypassrls, target ownership and positive fixture visibility before each negative family.

### Lane A: permission predicates and canonical command — 28 named cases

| Cases | Input and expected/candidate result |
|---|---|
| P01–P04 | U_AB A allow/B absent, reverse grant pair; same target resolver and canonical context agree; no cross-company borrowing |
| P05–P08 | Canonical global override command against ordinary U_AB: role allow + deny→denied; absent role grant + allow→allowed; replacement deny→allow; clear restores base |
| P09–P12 | Same-company allow/deny; other-company allow/deny excluded (root candidate) |
| P13–P16 | Global deny + local allow; global allow + local deny; duplicate conflicting rows in both insertion orders (root candidate deterministic deny) |
| P17–P20 | Inactive override; future valid_from; past valid_to; inclusive exact boundary at transaction timestamp |
| P21–P24 | Removed/inactive membership, removed/inactive role assignment, inactive role definition, no membership: override cannot create tenant authority |
| P25–P26 | Real command overlap/unknown permission rejection with unchanged before/after and exact expected SQLSTATE; platform actor admission negative paired with admitted positive |
| P27–P28 | Global platform role/admin_users authority controls, denied ordinary fake platform-role scope INSERT (23514); array contents reported separately from authoritative bypass |

Some rows contain two subassertions within one named case; report the 28 named cases and the assertion count separately. Also maintain a **characterization-only decision set** for direct grants, role-level deny, inactive permission catalog, alias expiries and shared-data override behavior. These are not green acceptance cases until the decisions above are settled.

First reproduce P05 and P06 against actual unmodified resolver sources and actual override command: prove command audit/result rows and active global override row exist, then demonstrate canonical/scoped arrays omit the decision. A failed fixture insert or unavailable command is a setup failure, never an override denial success.

### Lane B: critical public tenant CRUD — 10 relations × 10 cases = 100 named cases

Start with customers, customer_sites, metering_points, customer_contracts, powers_of_attorney, billing_underlays, customer_invoices, customer_invoice_lines, audit_logs, webhook_deliveries. Names are actual runtime/schema names; there is no generic invoices/invoice_lines relation in the inspected snapshot.

Per relation: (1) own SELECT; (2) foreign SELECT zero; (3) own INSERT if granted; (4) foreign-owner INSERT rejects; (5) own nonownership UPDATE if granted; (6) foreign-row UPDATE zero; (7) own-row reassignment A→B rejects; (8) own DELETE if the established policy permits, otherwise exact expected deny; (9) foreign DELETE zero; (10) reverse actor B→A controls. Each negative asserts unchanged before/after multiset and affected-row count. Do not make a missing privilege or absent permissive DELETE policy “pass” an allowed own-row control.

Audit/finance/webhook direct operations are **not automatically all allowed**: webhook writes are service-only; many customer/finance DELETE paths have no permissive client grant or deny via policy. Treat their own-write cases as explicit denied access contracts and pair with a permitted read or service-command control. Permission-overrides are not expected to affect membership-only policies until a key mapping is approved.

Add 16 access-table cases: companies, company_memberships, user_roles, company_invitations × direct INSERT/UPDATE/DELETE denial and allowed same-user/tenant SELECT control. Include table and column ACL checks; do not grant writes to make the fixture convenient.

Reuse the existing 18 relationship paths (`canonical-tenant-guard-behavior.sql`) as a separate 18-reference family with same-tenant positive, cross-tenant INSERT/UPDATE/reassignment negatives under authenticated and service_role. Preserve exact 23514 distinction and current snapshot's 23502/23503 controls. Add same-company wrong-customer relationship checks only where a real FK/trigger defines them. This family does not replace the 100 RLS cases.

### Lane C: storage — 24 named cases plus managed API follow-up

S01–S04 own active SELECT/INSERT/UPDATE/DELETE; S05–S08 foreign actor B operations against A; S09–S10 rename A path→B path and upsert existing foreign object; S11–S12 selected A permission must not grant B target and reverse pair; S13–S16 paused A read allowed/write INSERT/UPDATE/DELETE denied; S17 suspended read/write denied; S18 inactive membership; S19 removed membership; S20 disabled profile/disabled_at; S21 anon; S22 platform read paused but write denied, active target write allowed; S23 malformed path family (bad UUID/slashes/type/filename/site-customer mismatch); S24 non-customer-documents bucket denied by these policies. Every accepted write must have required read grants as needed for UPDATE/upsert and return one affected row.

Run once with the exact old private helper and once after the reviewed forward helper, asserting PERM-03 RED specifically at paused write and then GREEN. Record permission-array/bound-company state, old/new object metadata rows and exact SQLSTATE. SQL metadata tests do not upload/delete actual object bytes. Separate managed Storage API tests are required for upload, signed/direct URLs, upsert/rename and revoked JWT/session behavior; the raw offline PostgreSQL container has no Storage server or GoTrue. Never mark those passed from metadata SQL.

## Critical relation policy/grant/trigger prerequisite map

| Group | Source prerequisites that must be admitted together | Catalog/behavior check |
|---|---|---|
| All ten tenant relations | Foundational table definitions in 01/02 and their exact subsequent ALTER/FK statements; base tenant policies in 03 and May tenant/RBAC sources; `20260612143000_performance_policy_consolidation_and_index_cleanup.sql`; `20260812210800_gridex_rls_policy_normalization_v1.sql`; `20260814162500_tenant_rls_lifecycle_hardening.sql`; `20260826093000_platform_dashboard_and_rls_read_performance.sql` | Exact policy roles, command, permissive/restrictive, USING/WITH CHECK, RLS flags, table+column ACLs, trigger definitions. Dynamic consolidation uses prior policy union: filenames alone do not determine its result |
| Customers/sites/metering/contracts | Above plus `20260902090000_tenant_scoped_unique_business_keys.sql`, `20260902095000_lock_customer_chain_with_composite_keys.sql`, `20260905141608_canonical_tenant_relationship_guards.sql` | Per-company keys; composite parent identity; snapshot notes permissive TRUE read combined with restrictive lifecycle, membership write policies; no assumed named permission gate |
| PoA/underlay/snapshot graph | Relationship migration above; `20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql`; snapshot's already-existing newer guard body (preserved by September 5 migration) | Customer/site/metering/contract ownership; nullable parent behavior; no overwritten snapshot guard. DELETE permission distinguished from retention/graph rules |
| Customer invoices/lines | Actual 02 and 03 table/policy source plus parent composite migrations and exact finance ALTER statements | Invoice-company/customer and line-invoice graph; inspect existing FK DELETE/UPDATE actions instead of assuming cascade. Native row baseline mandatory before deletion positives |
| Webhook deliveries | Existing integration table DDL; `20260812210800` explicitly replaces SELECT with webhook_deliveries_tenant_or_platform_read; lifecycle/performance policies above | Authenticated read vs service-only writes; task5 real action service write is a separate boundary |
| Access tables | Canonical provisioning/access sources; `20260814162500` revokes INSERT/UPDATE/DELETE from authenticated/anon; September 2 role-scope trigger and permission RPC ACLs; September 11 admitted helper-ACL boundary | Direct browser mutation denied even for platform JWT; command ACL/admission and immutable role scope preserved |
| Storage | Managed-compatible bootstrap storage objects/bucket shape; whole authenticated/service policy family from `20260806151106`; private helper/four policies from `20260806152004`; actor/scoped permission bodies from September 2; session/lifecycle helpers | Bucket private; no leftover broad policy can OR-bypass the four intended policies; both UPDATE expressions; private schema USAGE/helper EXECUTE; authenticated metadata DML grants independently established |
| Shared masterdata control | `20260826103000_electricity_suppliers_masterdata_rls_guard.sql` and `20260902100000` shared resolver semantics, plus actual mixed/shared classification | F-18: legitimate tenant role can read shared masterdata; do not replace shared resolver with company-only empty result |
| Classification/invariant supplement | `20260902094000_platform_table_classification_and_invariant_gate.sql`, `20260902092000_view_security_invoker_and_dead_policy_cleanup.sql`, `20260904120000_canonical_tenant_invariant_convergence.sql` | Catalog/classification/ACL cleanup, not CRUD proof. Avoid treating a grantless inert policy as an exploit |

The existing snapshot demonstrates e.g. GRANT ALL to authenticated on customers/sites/underlays/customer_invoices/lines/overrides; company_memberships excludes INSERT/UPDATE/DELETE; webhook has GRANT ALL but its policies deny ordinary writes. These are **snapshot observations only**. The compatible bootstrap intentionally does **not** reproduce table default privileges. Source provenance for every effective table grant remains an admission blocker for whole-schema acceptance. A reduced fixture may use explicitly labelled fixture-only grants to test a policy expression, but must report that narrower scope and cannot claim original Data API reachability. Do not import the whole snapshot or invent a blanket GRANT to hide this boundary.

## Implementation sequence and bounded forward SQL surface

1. Build a source-pinned reduced fixture manifest containing exact function bodies and required relation/column/constraint/ACL sources. Admission verifies one definition per signature, correct dollar delimiters and original source hashes. Use actual source bodies, not handwritten authorization stubs. Canonical context's operation-policy dependency must be complete for its seven invoked operations; its companies/company_capabilities/integration_api_clients prerequisites cannot be omitted. Unexercised Ediel-send evidence branch is labelled outside scope.
2. Run P05/P06 and S13–S16 against baseline in a new OwnedPostgres instance; retain positive controls and exact native error/row receipts. This is source-semantic proof, not whole migration replay. A missing required relation/column/ACL is a fixture blocker.
3. After review, implement one forward permission resolver surface: shared internal effective-company permission resolver; update canonical context and target wrapper(s) to use it, preserving signatures/returned contract and identity/selection/platform behavior. Apply root's ordinary override algebra. Do not add direct grants or change shared-global semantics until its decision is explicit. Revoke internal resolver access from PUBLIC/anon/authenticated; authenticated wrappers remain self-context boundaries. Preserve existing command transaction/audit/idempotency logic.
4. Independently implement one forward private Storage helper change for read/write lifecycle/session conjunction. Keep permission resolution company-bound and preserve strict path validation. No broad actor-predicate rewrite or grant widening.
5. Run corrected permission/storage matrices, then bounded public CRUD/relationship families with explicit relation admission. Execute the forward candidate twice against the owned fixture, assert second-pass stable function definitions/ACLs and no unexpected data effects. Update independent review before choosing production migration identity or external execution.

No migration filename has been invented. Root owns approved migration generation/registration, exact source selection and subsequent native/managed gates. If a forward helper needs data repair for duplicate global overrides, do not silently rewrite rows: deterministic query-level deny first, inventory synthetic cases, and leave real data disposition to a separate reviewed task.

## Existing test/harness reuse and limits

- `canonical-auth-provisioning-legacy-batch.py::OwnedPostgres`: usable infrastructure without calling `prefix()` or historical `execute()`; supports reset/run_files/sql on finite allowed databases, private files and finite receipts. Use `GRIDEX_LEGACY_CONTAINER_NAME=gridex-auth-legacy-permissions-<run>-<attempt>` in a dedicated new lane when implemented. Cleanup `cleanup_workflow_owned()` validates exact regex/name/label. Existing `Proof` in fixed-target selftest is **not** a generic permission fixture: it requires ACTUAL57 and state/reference identity, so do not bypass its admission to reuse query helpers.
- `.github/workflows/ops-hardening.yml`: owned native jobs show the create/run/always-cleanup model. No new job is implemented in this task. The fixed localhost auth-email service lane is isolated in CI, but older `canonical-rbac-tenant-selftest.py` resets a hardcoded DB and is explicitly historical characterization, not suitable to run against arbitrary local connections.
- `scripts/canonical-rbac-tenant-selftest.py`: reuse source extraction concepts and real-table snippet provenance, not its three old backfills as current authorization acceptance. It has eight present and 21 absent policy targets and says “not authorization or replay approval.”
- `scripts/canonical-saas-tenant-selftest.py` / `role_permission_identity_selftest.py`: useful exact catalog/row-preservation comparisons and mandatory permission-ID/uniqueness controls. Their authentic source prefixes do not contain the latest policy stack by themselves.
- `scripts/canonical-tenant-guard-selftest.mjs` + fixture/catalog/behavior SQL: useful 18-reference RED/GREEN and two-pass snapshot preservation. PGlite pinned 0.3.14, simplified table shapes and broad fixture grants; it is not RLS CRUD or PG17 provenance evidence. Its SQL bodies can be run in the new native container once the separate source-backed shape/role/grant admissions are explicit.
- `scripts/sql/tenant-isolation-invariants.sql`: catalog, row-null, role-scope and classification supplement only. Do not run against ambient DATABASE_URL or treat presence of restrictive policies as decision correctness.

## Gates and next decisions

No new permission model needs to be invented to begin the **ordinary global override RED/GREEN** and **paused Storage RED/GREEN** fixtures. Root's candidate precedence permits deterministic conflicting-global/local negative cases too. Before whole resolver parity and public RLS acceptance: decide direct-grant support, role-deny policy and shared-masterdata override interpretation; approve per-operation permission mapping if public policies are expected to enforce those keys. Before any actual session-revocation claim: trace revoke caller→token/session state→Data API/Storage enforcement, then test managed API with real synthetic sessions.

Feasible next action: implement/review the reduced source manifest and finite native fixture using a new existing OwnedPostgres substrate, starting with the two confirmed defects. Do not wait for full historical replay to gather that bounded evidence; do not turn it into full effective-schema or production acceptance.

## Source hashes read in this preparation

All paths below are under `supabase/migrations/`.

| File | SHA-256 |
|---|---|
| 20260810193450_canonical_access_provisioning_runtime_v1.sql | 390b0223a8fbafb633795f1ad0116d6cf8ebbddea056226be84711e7d878a4b8 |
| 20260810224500_canonical_review_remediation_v1.sql | 12fb80b8c13f7e105e4c5b63a6145e863872874fd4a2caaea9f669df5a80010d |
| 20260902091000_company_scoped_permission_engine.sql | dc72cc26cbb53ab814fcf214dc9324f27bfac9f4bf77940b9e9a0527428f359a |
| 20260902100000_rpc_surface_and_permission_scope_corrections.sql | 9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919 |
| 20260802203000_canonical_runtime_consistency_hardening.sql | 96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930 |
| 20260526_debug_step1_2c_full_schema_code_alignment.sql | 5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472 |
| 20260730130000_historical_sync_forward_repair.sql | 3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b |
| 20260814162500_tenant_rls_lifecycle_hardening.sql | e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2 |
| 20260826093000_platform_dashboard_and_rls_read_performance.sql | f9084068f4eead62330b1b394b6b4cab5f47ff68b411bdb144009314c2b85a2c |
| 20260806151106_gridex_aud_001_customer_document_storage_isolation.sql | 0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16 |
| 20260806152004_gridex_aud_001_storage_helper_private_schema.sql | ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f |
| 20260905141608_canonical_tenant_relationship_guards.sql | 8e1ec819b7775072ff04370e2ce7327793e094acf248a971968565e643bfe8f5 |
| 20260902095000_lock_customer_chain_with_composite_keys.sql | bd3e79d2dab7f3332487b6259e595a258c413c288d073c63c5163555f7cd9c38 |
| 20260902094500_decouple_contract_sales_from_ediel_send_state.sql | 88831015a6f70723b647bc9e6b5091a3c56c40f16ce48ee824456577b10c8c9a |
