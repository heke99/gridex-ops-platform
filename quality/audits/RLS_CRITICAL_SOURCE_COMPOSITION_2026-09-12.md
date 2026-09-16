# Task11b critical RLS source-composition closure

2026-09-12. Read-only source review; report-only write authorized by root. **COMPLETE finite source report; effective-source closure BLOCKED; native NOT_RUN.**

Scope: ten-relation/100-CRUD and separate 18-reference relationship family in `quality/audits/RLS_PERMISSION_NATIVE_CONTRACT_2026-09-12.md`. Task11a is independent and deliberately finite F16; its witness-only full normalization/performance files do not compose the critical policies. No production/native SQL, application/source/memory/index change or subagent delegation in this lane.

Routing: read AGENTS, active memory/checkpoint/domain memory and decisions/failures; applied Supabase, source-to-sink and fp-check discipline. This is a bounded dependency review, not a restarted broad audit. No suspected exploit is classified solely from a policy or absent GRANT. Implementation/test/performance-remediation/UI/browser/production workflows do not activate; using-superpowers explicitly exempts dispatched subagents. All policy conclusions below are conditional on ACL, role, helper, preceding-policy and source-selection admissions.

## First verified composition facts

* `scripts/gridex-aud-003-foundation-order.json` orders 118 foundation files before remaining timestamped history. Filename chronology alone is wrong: 01/02/03 are first; May19 SaaS/customer policies are foundation entries34/35, May20 RBAC entry39, May26 full alignment entry67, and September11 alignment ACL boundary entry68. Selected does not mean native accepted beyond the separate current finite prefix.
* June12 consolidation freezes all public permissive policies and expands PUBLIC to an actual role universe: existing `anon`, `authenticated`, `service_role`, `authenticator`, `dashboard_user`, `supabase_privileged_role`, plus all explicitly targeted non-PUBLIC roles anywhere in public permissive policies. It does **not** infer arbitrary inherited roles. The companion inventory VIEW has a subtly different role query from the DO block; use the DO block for admission. Any overlap in one role/action enrolls the whole table, then all old permissive policies on that table are replaced, preserving restrictive ones. Absent source roles or policy predecessors change both names and union.
* Generated name is `gridex_mp_` + first20 MD5 hex of `public.<relation>:<UPPERCASE command>:<role>`. SELECT/DELETE use ordered OR of old USING (NULL/empty→TRUE); INSERT uses ordered OR of CHECK fallback USING fallback TRUE; UPDATE independently ORs USING and CHECK fallback. The block catches table-local errors and inserts `status='skipped'`; require exact successful target receipts and reject skipped target events.
* Foundational03 creates PUBLIC permissive SELECT/INSERT/UPDATE (no DELETE) for nine critical tables, excluding webhook_deliveries. Foundation35/May19 final SaaS creates a distinct PUBLIC tenant CRUD family only for customers/customer_sites/metering_points/customer_contracts/billing_underlays among these ten. Presence in another part of a large file is not proof of inclusion in its dynamic target array.
* August26 first SELECT collapse requires **any** authenticated restrictive SELECT plus an authenticated permissive `gridex_mp_%` policy for its explicit heavy-table list. It does not check the restrictive predicate there. Later lifecycle rewrite requires exact `qual='gridex_can_read_company(company_id)'`; the later general collapse separately requires generated SELECT containing `gridex_can_read_company(company_id)` and named restrictive lifecycle guard. The partial prep's stronger “exact restrictive predicate” description must not be used as the first block's source condition.

The completed finite inventory, hashes, source-derived behavior and exact unresolved gates follow. This is not a full600-input audit.

## Source authority actually selected (critical correction)

Read-only execution of the **existing** `gridex-replay-input-accounting.py::account()` selector on this checkout returned 600 inputs:558 FULL_FILE_SELECTED,23 SUBSTITUTED,14 UNCLASSIFIED,5 EXPLICITLY_EXCLUDED. This executes only source selection Python, no shell replay or SQL. Foundation order is118 and timestamp sequence508.

| Candidate predecessor | Actual admission | Consequence for 11b |
|---|---|---|
| May23 `20260523_db3_tenant_isolation_rbac_enforcement.sql` | SUBSTITUTED, no whole-source execution; helper-only bootstrap at foundation26 | Its lines199–238 DELETE/broad-policy removal and242–284 `gridex_db3_*` policies are **not** selected. Must settle full-effect authority explicitly before adding either block. |
| May21 `20260521_batch_customer_intake_batch2_completion.sql` | UNCLASSIFIED | `tenant_members_read_<table>` lines82–151 are not selected. Their inline memberships + role-definition SELECT also require actual `roles.role_key`; existence of roles table alone chooses that branch. |
| May22 `20260522_db1_schema_repair_backfill_foundation.sql` | UNCLASSIFIED | Its DB1 family is not independent second replay authority. Canonical01/02/03 establish the selected foundation. |
| May31 `20260531111600_system_readiness_foundation.sql` | SUBSTITUTED | Its PUBLIC `webhook_deliveries_service_role_all` source is absent from selected whole files; selected webhook DDL comes from foundation106 bootstrap derived from June9 website source. |
| `ediel_rules.sql` | FULL_FILE_SELECTED foundation89 | Already creates `gridcore_ediel_saas_*` on five critical tables. Timestamp1/May30 same-name family then sees existing names and preserves them. |
| Sept11 alignment boundary | FULL_FILE_SELECTED foundation68 | Private context-guarded boundary, not a free-standing late ACL normalization. Does not grant critical table privileges. Do not synthesize its temp context to import the full boundary. |

The snapshot is materially different from a plausible selected-only predecessor chain: e.g. snapshot customers has no permissive DELETE, while foundation39 supplies `<table>_tenant_delete` with platform predicate and the unselected DB3 block is the inspected removal source; snapshot audit_logs has only DB1 permissive S/I/U, while foundation39 adds a separate tenant family. These are **source-composition discrepancies**, not a confirmed live exploit. Do not make snapshot contents the oracle for an unproven source chain or quietly delete selected policies to match it.

## Pre-June12 minimal policy slices and expected families

Abbreviations: `P=gridex_user_is_platform_admin()`, `R=gridex_can_read_company(company_id)`, `W=gridex_can_write_company(company_id)`, `N=company_id IS NOT NULL`, `S=auth.role()='service_role'`. These summarize semantics only; admission must execute and hash exact source slices and compare native deparsed catalog expressions, including initplans.

1. DB1/03 lines674–725, foundation3: nine tables (all except webhook). PUBLIC `gridex_db1_<t>_select` USING P OR(N AND R); insert CHECK P OR(N AND W); update USING P OR(N AND R), CHECK P OR(N AND W). No delete. Actual `company_id` presence chooses the tenant branch.
2. May19 final SaaS lines470–524, foundation35: customers/sites/metering/contracts/underlays create PUBLIC `<t>_tenant_{select,insert,update,delete}` with super-admin or membership predicate. These are replaced in the next applicable refresh, not additional surviving policy names.
3. May19 runtime governance lines210–286, foundation37: same five plus PoA/audit_logs. Drops tenant S/I/U/D/WRITE names. S=R, I=W, U USING R/CHECK W, D=P.
4. May20 RBAC lines214–296, foundation39: same seven. Drops tenant S/I/U/D; S=R, I=W, U USING W/CHECK W, D=P. This is the selected surviving tenant family immediately before June consolidation, unless another admitted actual source removes it.
5. `ediel_rules.sql` lines547–594, foundation89: five heavy tables, authenticated `gridcore_ediel_saas_{select,insert,update}_<t>`; P OR(N AND R/W), update R/W. Requires helpers to exist to select that branch. Fallback direct-membership predicate differs. Timestamp1 May30 lines630–682 is a source-exact no-op for those already-existing names; keep the duplicate-source no-op receipt.
6. June11 launch lines77–117: underlays/PoA/webhook add PUBLIC `gridex_launch_tenant_read` S OR P OR R plus `gridex_launch_service_write` ALL USING/CHECK S; enables RLS and revokes anon table ACL. Webhook now has two overlapping SELECT contributions even though the May31 service family was omitted.
7. June11 linter: minimum-policy DO is only for RLS-enabled tables with **zero** policies. Assert all ten already have policies, so this branch contributes none. Its broad table ACL revoke PUBLIC/anon does apply. Its helper invoker/ACL transforms and broad SECDEF revoke are separate dependencies. Do not accidentally manufacture linter policies by ordering the tables too late.
8. June12 12:30 helpers + `gridex_rls_initplan_rewrite(text)`, `gridex_optimize_rls_auth_initplans()` and exact SELECT invocation must precede 14:30 consolidation. It alters existing USING/CHECK while preserving names/roles/mode; failures are returned as `skipped: ...`. Require no skipped target-policy rewrite and source-preserved rewrite output. Do not hand-generate supposedly equivalent catalog text.
9. June12 14:30 consolidation receives the resulting catalog, actual role universe and `gridex_performance_hardening_events` table. Preserve original target selection, OR ordering, null fallbacks, error handling, and generated-name digest; use the complete consolidation DO as policy-only slice, not its unrelated duplicate-index cleanup.

Expected **selected-only** table enrollment: customers/sites/metering/contracts/underlays/PoA/audit_logs consolidate; customer_invoices and customer_invoice_lines have only one PUBLIC DB1 policy per action and therefore do **not** enroll; webhook enrolls from launch READ+ALL. This is a static selected-source expectation requiring native catalog confirmation, not a completed native report.

## Relation closure and expected critical behavior

All rows remain **UNRESOLVED for complete effective source/Data API admission** because starting managed role/default ACL authority is absent and unresolved historical source effects above change catalog composition. The narrow selected-policy candidate is sufficiently mapped to implement a separately labelled characterization fixture.

| Relation | Selected pre-consolidation policy families | Selected-policy behavior after Aug14/Aug26 (assuming required ACLs) | Remaining relation-specific closure |
|---|---|---|---|
| customers | DB1 + tenant + gridcore | lifecycle/session read; permitted tenant-role I/U with lifecycle W; selected D platform-only, ordinary D zero | Resolve DB3 removal and omitted intake read; admit unique customer key, exact graph FKs and all write triggers. |
| customer_sites | DB1 + tenant + gridcore | Same as customers | Same authority gap; customer_id FK and Sept5 guard; related-column ALTER inventory. |
| metering_points | DB1 + tenant + gridcore | Same as customers | Same authority gap; Sept2 national ID uniqueness per company; site/customer pointers and exact existing types. |
| customer_contracts | DB1 + tenant + gridcore | Same as customers | Same authority gap; both site_id/customer_site_id, metering pointer, commercial/snapshot write triggers. |
| powers_of_attorney | DB1 + tenant + launch READ/ALL | lifecycle read; W I/U; D source union platform OR service, ordinary D zero | DB3/intake authority; foundation111 customer_site_id and interleaved customer_contract_id prerequisites; Sept2 website scope replacement distinct from Sept5 generic guard. |
| billing_underlays | DB1 + tenant + gridcore + launch READ/ALL | lifecycle read; W I/U; D platform OR service, ordinary D zero | DB3 authority; billing graph/financial checks, both contract_id/customer_contract_id alias priority, promotion triggers. |
| customer_invoices | DB1 only | DB1 read narrowed by lifecycle; W I/U; no permissive client D | Need Aug5 company RESTRICT/idempotency plus Aug1 customer/contract composite keys and current invoice triggers; no generated SELECT expected from selected-only chain. |
| customer_invoice_lines | DB1 only | DB1 read narrowed by lifecycle; W I/U; no permissive client D | Need metadata/commercial columns before Aug5 validated invoice/snapshot composite FKs and amount checks. |
| audit_logs | DB1 + tenant | lifecycle read; W I/U; selected D platform-only | Snapshot DB1-only mismatch requires authority decision; classify immutable audit direct mutations by actual policy, not conventional expectations. |
| webhook_deliveries | launch READ+service ALL; May31 family absent from selection | Aug12 authenticated tenant/platform SELECT narrowed by lifecycle; authenticated I/U/D false because S=false; service_role bypass plus explicit ALL | Bootstrap106 domain_events/subscriptions chain; June12 exact role expansion; July3 service ALL and platform read; Aug12 drops/normalization. No service writes accepted on missing privileges alone. |

Ordinary writable positive actor must have active/onboarding company, active membership and membership_role owner/admin/company_admin/operations; a plain member with only named permission grants is not necessarily a positive W control. Paused permits member reads, denies operational writes including platform W. Suspended/etc hidden from ordinary users; platform can read through current-session/authoritative-platform gate. Negative own-write contracts must pair with permitted read/service controls and exact affected-row/error/multiset checks, not setup failures.

## Table/column ACL and role closure

Source-to-sink: authenticated JWT/SQL role → schema USAGE and table/column privilege → permissive policy union AND applicable restrictive policy intersection → helper session/membership/company/authoritative platform state → row trigger/FK/check constraints. A source failure at an earlier step cannot be counted as a later isolation success.

The checked-in compatible bootstrap creates anon/authenticated/service_role/authenticator/dashboard_user plus postgres and managed auxiliary roles; service_role has BYPASSRLS, ordinary roles NOINHERIT, authenticator and postgres receive anon/authenticated/service_role memberships. It **does not create supabase_privileged_role**. Thus its five named June role candidates differ from the six-role managed list in the migration; other explicit policy roles must still be inventoried. Assert actual pg_roles and pg_auth_members, not only `SET ROLE` availability. Do not add the missing managed role merely to copy the snapshot policy count without authority.

Bootstrap lines85–92 explicitly reproduce only function defaults; **table defaults deliberately omitted**. Source scan of migrations/bootstrap found no literal critical-table GRANT, including multiline statements; relevant generic table revokes were separately inspected. Consequently there is no source-derived authenticated/service DML ACL positive for the ten targets from this compatible bootstrap. BYPASSRLS does not itself grant table privileges. Exact table owners and current/default ACLs require a managed-bootstrap/catalog receipt or separately approved explicit grant source. The snapshot's GRANT ALL observations cannot supply that provenance.

ACL chronology to preserve:

* June11 launch revokes anon on its listed tables (critical PoA/underlays/webhook).
* June11 linter revokes all table privileges from PUBLIC/anon on every public table; helper invoker conversions occur before its broad SECDEF revoke from PUBLIC/anon/authenticated and grant to service_role. It does not grant critical-table access to authenticated.
* June12 performance grants EXECUTE on current platform/read/write/company-ID helpers to authenticated/service_role; the exact body/security mode matters because replacement resets the definition, not arbitrary historical ACL entries.
* August2 emergency lockdown revokes future table/function/sequence defaults from PUBLIC/anon/authenticated for postgres, and attempts supabase_admin defaults with an insufficient-privilege NOTICE fallback. It explicitly does not revoke all preexisting critical table ACLs. Preserve the managed-role default-ACL unresolved outcome if that branch cannot execute.
* August14 explicitly revokes direct INSERT/UPDATE/DELETE on companies/company_memberships/user_roles/company_invitations from anon/authenticated, and all companies privileges from anon. This is the separate16 access-table family. It does not erase column-specific grants. Check `pg_attribute.attacl` and effective `has_column_privilege` per mutable column as well as `pg_class.relacl`; do not infer column closure from table REVOKE.
* September2 dead-policy cleanup drops only policies exclusively targeting supabase_privileged_role/dashboard_user/authenticator when their table has no listed grants. Its actual query uses `information_schema.role_table_grants`, not a full effective column/role-inheritance privilege proof. For a reduced fixture, require empty relevant table AND column ACLs and record role inheritance before calling these policies inert.
* September4 convergence revokes several RPCs from PUBLIC and anon and grants service_role. It does not provide critical-table grants. September11 alignment boundary is foundation68, with only six named function ACLs and debug-view table/column ACLs in its protected private transaction; it does not give the public tenant CRUD fixture authority.

No confirmed security vulnerability is asserted from the missing ACL provenance. Devil's advocate: managed defaults may explain real access; snapshot source effects may differ from canonical selection; BYPASSRLS/owner access can hide policy defects; column grants may survive a table revoke. All four are concrete reasons to keep full reachability unresolved.

## Effective helper definitions and replacement order

All public signatures below must be unique. Source selections are actual order, F=foundation and T=timestamp. These are CREATE/REPLACE definitions; also admit selected ALTER FUNCTION security/search_path/ACL transformations where a preceding predicate is exercised. Intermediate bodies can be omitted only in a labelled final-body policy-semantic fixture whose pre-consolidation catalog is independently pinned; do not call that chronological full replay.

| Signature | Selected definition sequence; latest effective body |
|---|---|
| `gridex_user_is_platform_admin()` | F1 DB1 → F37 governance → F39 RBAC → F41 hard_platform_roles → F53 debug_rbac_alignment → T52 June12 performance → T213 July27 contract_flow → **T249 August2 emergency lockdown** |
| `canonical_actor_is_platform_admin(uuid)` | T244 August2 provisioning_access → T247 security_convergence → **T250 runtime_consistency**; separate explicit-user service function, not interchangeable with current-user platform helper |
| `gridex_is_current_session_allowed()` | F37 governance → T230 July28 channel_publication → **T233 July30 historical_sync_forward_repair** |
| `gridex_user_company_ids()` | F1 DB1 → F35 final_saas → F37 governance → F39 RBAC → T52 performance → **T349 August14 lifecycle** |
| `gridex_can_read_company(uuid)` / `gridex_can_write_company(uuid)` | F1 DB1 → F37 governance → F39 RBAC → T52 performance → **T349 August14 lifecycle** |
| `gridex_user_can_manage_company(uuid)` | F1 DB1 → F35 final_saas → F37 governance → F39 RBAC → **T349 August14 lifecycle** |

Latest session guard checks auth.uid; absent profile table returns true; missing profile row coalesces active; rejects disabled/locked_security/removed_from_company/invitation_revoked or nonnull disabled_at. It does **not** itself verify GoTrue session revocation, deleted/banned/email-confirmation state. Current platform helper separately requires nondeleted/unbanned/confirmed auth user and active profile plus admin_users or global normalized user_roles authority. Explicit-user canonical platform helper omits the confirmation condition; preserve existing Task11a characterization. Ordinary lifecycle helper uses session guard plus active membership and company state, not the canonical context's entire identity admission. Do not overstate expired/revoked JWT proof from these SQL sources.

The exact latest helper dependencies are auth.users(id,deleted_at,banned_until,email_confirmed_at), user_profiles(id,user_status,disabled_at), admin_users(user_id,is_active,role), user_roles(user_id,company_id,is_active,status,role,role_id), roles(id,key,name), company_memberships(company_id,user_id,status,is_active,membership_role), companies(id,status), `auth.uid()` and `gridex_normalize_platform_role(text)`. Real source DDL slices for these already exist in Task11a's manifest; revalidate rather than invent reduced handwritten helper stubs. Task11a's candidate override resolver is a separate later overlay, not a prerequisite for membership-only CRUD policies.

## August normalization/lifecycle/performance order and scoped extraction

Execute June consolidation → July3 event-log policy DO → August12 normalization relevant DO + final webhook statements → August14 four helper definitions/ACLs + complete `$rls$` loop + scoped verification → August26 **first three policy DO blocks**, in source order → September2 dead-role cleanup and graph boundaries → September5 guards. August1/5 graph constraints actually precede August12 and must be admitted before seeded writes; chronological full source composition must not postpone their effects.

August12's first DO splits a named ALL-policy list into I/U/D; none is an expected critical selected-policy name. Assert zero critical matches rather than rewrite the list. Its service-role generated-policy cleanup does hit webhook; its final three webhook statements drop platform_admin_read and generated authenticated SELECT `gridex_mp_b4c6a5bed0f1bb738710`, then create tenant_or_platform_read. The whole file also unconditionally references company_actor_test_runs, grid_owner_contact_channels and event_outbox; a ten-target fixture must label exact extracted slices, or supply their actual DDL/helpers. August13 review_hardening has global expected-nonzero assertions on unrelated platform/service-only policy sets; it is not safe to execute its whole file in a ten-relation fixture or suppress those failures.

August14 loop must see all ten as public ordinary/partitioned tables with UUID company_id (positive attnum, not dropped). It adds restrictive authenticated S/I/U/D plus restrictive anon ALL false, enabling RLS; no FORCE RLS statement. Its full-file companies policy/verification and access-table revokes need actual companies/access tables. August26 dashboard-summary function depends on additional dashboard relations and is outside a labelled policy-only slice; the three relevant DO blocks have catalog-conditioned no-op branches, so assert actual affected table sets. All ten lifecycle SELECT guards should rewrite; five heavy tables and any remaining generated SELECT containing R can become TRUE; invoices/lines without generated policies stay DB1; webhook normalized read stays named. Write policies remain unchanged.

September2 classification/invariant migration supplies the missing second cleanup: its lines173–205 drop every non-PUBLIC-target policy for which no targeted role has effective table S/I/U/D privilege (using has_table_privilege). This explains possible anon-guard removal; it also removes authenticated lifecycle/performance/generated policies in a grantless compatible fixture. Its earlier reclassification changes tenant/mixed tables to system when clients have no table privileges, which changes September2 composite-FK step2 enrollment. Therefore ACL authority must be fixed **before** classification and policy cleanup, not granted after the fact. Column-only access remains an extra admission check because the source tests table privileges. No synthetic blanket grants may be used to force snapshot-shaped classification.

## Exact relation prerequisites and later graph boundaries

The minimal **policy** slice needs original table definitions with real UUID company_id; the minimal **100-CRUD** slice additionally needs actual current mutable-row constraints/triggers. These must not be conflated. Original DDL is source-exact and located below; raw UUID reference columns are not automatically foreign keys.

| Relation | DDL origin and additional minimal dependency |
|---|---|
| customers | 01 CREATE TABLE; companies + normalize_org_number/email/phone/personal_number helper references. Sept2 per-company customer_number uniqueness. Customer-number assignment/protection triggers can call numbering helpers; require their source and sequence-table prerequisites for INSERT. |
| customer_sites | 01 CREATE TABLE, customers/companies; Sept5 customer guard and Aug1 customer composite FK. Address/materialization/summary/event triggers remain part of real INSERT/UPDATE reachability. |
| metering_points | 01 CREATE TABLE and its same-file ALTER block (meter_point_id); ediel_rules adds customer_site_id; interleaved June13 Ediel-ID prerequisite. Sept2 uniqueness requires metering_point_id/meter_point_id/ediel_reference existing with actual types. |
| customer_contracts | 01 CREATE TABLE and same-file customer_site_id ALTER; June11 energy resolver price_area_used, June12 website contract_price_snapshot_id, June14 snapshot_hash, July14 publication/product IDs, July25 billing_eligible_at. Aug5 NOT NULL and billing identity CHECK depend on these fields before any row test. |
| powers_of_attorney | 02 CREATE TABLE and existing reconciliation ALTERs; foundation111 `customer_site_id`; interleaved June17 `customer_contract_id`; June13 legal readiness `contract_id`/valid_until; Sept2 expires_at helper references valid_to/valid_until. Original site/metering UUIDs alone do not establish ownership FKs. |
| billing_underlays | 02 CREATE TABLE + ediel_rules contract_id; June8 customer_site_id; June14 contract_price_snapshot_id; July27 customer_contract_id alias. Aug5 NOT NULL/company RESTRICT and composite snapshot FK. Exact chain guard selects customer_contract_id first, contract_id only if first NULL. |
| customer_invoices | 02 CREATE TABLE; July18 portfolio alignment adds contract_id/customer_contract_id/portfolio fields; July27 alias completion; Aug5 NOT NULL/company RESTRICT and company+partner_reference uniqueness; Aug1 customer/contract composite keys. |
| customer_invoice_lines | 02 CREATE TABLE; foundation82 source metadata line_type/unit/vat_rate/sort_order; July28 completion vat_amount/amount_inc_vat; July29 commercial selection contract_price_snapshot_id/commercial metadata; Aug5 NOT NULL, validated composite invoice/snapshot FKs, vat_rate fraction and amount consistency CHECKs. |
| audit_logs | 02 CREATE TABLE; July27 context-normalization trigger source. `platform_table_classification` explicitly permits mixed NULL-company audit events; the ten-tenant fixture still uses explicit company identities and must not assume all audit rows are tenant-only. |
| webhook_deliveries | foundation106 exact CREATE TABLE requires companies, webhook_subscriptions and domain_events; latter has customer/auth-user FKs and real event_type/aggregate fields. Delivery idempotency and subscription/event indexes precede current write tests. |

Key graph files omitted by a policy-only list:

* `20260801143000_canonical_multitenant_platform_hardening.sql` lines164–207 parent `(company_id,id)` unique indexes,211–259 NOT VALID company-required checks,263–368 conditional typed composite FKs. The values list covers customer/site/metering/contract/PoA and invoice parent edges; skips absent/mismatched columns. Composite FKs use default NO ACTION (NOT VALID), not assumed cascade. Require exact expected target/column enrollment and no skipped intended edge.
* `20260804193000_contract_price_snapshot_company_guard_fix.sql` defines the **current** invoker snapshot guard: NULL contract→23502; missing visible contract→23503; same-company assertion→23514. Revokes PUBLIC/anon/authenticated direct function execute, grants service_role; Sept5 intentionally preserves this body/ACL.
* `20260805085617_api_contract_billing_tenant_hardening.sql` lines18–110 has real backfill/preflight (dependencies include billing_underlay_items, contract_charge_ledger, contract_price_snapshots);118–159 NOT NULL/company RESTRICT/idempotency;162–173 candidate keys;180–248 composite FKs;250–260 validation;265–303 monetary and contract billing-identity checks. Whole-file claim requires integration_api_write_idempotency/clients, website quotes/apps and all billing parents. If extracting only critical-table statements, use exact standalone statements or complete source IF branches with truthful slice labels, not handwritten FK substitutions.
* `20260902090000_tenant_scoped_unique_business_keys.sql` customers/metering statements are standalone scoped slices; whole file requires electricity_suppliers and legal_bundle_versions. Do not use unique-key violations as RLS negatives.
* `20260902094000_platform_table_classification_and_invariant_gate.sql` must run with the actual ACL evidence before `20260902095000_lock_customer_chain_with_composite_keys.sql`. Step1 creates missing `(customer_id,company_id)` keys only where a single-column customers FK already exists and no multi-column customers FK exists; UPDATE/DELETE CASCADE. Step2 uses classification.kind=tenant and no customers FK; UPDATE CASCADE/DELETE SET NULL, catches only preexisting FK violation to retain NOT VALID. Which branch hits invoice_lines (whose original customer_id is a bare UUID) therefore depends on admitted classification and preceding FK source.
* `20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql` adds expires_at synchronization and scope materialization requiring power_of_attorney_scopes(company_id,power_of_attorney_id,scope_type) unique index and signed_scope_snapshot-dependent helpers. It does not replace the generic Sept5 same-company guard. Keep its before/after trigger side effects in the own-write multiset baseline.
* `20260905141608_canonical_tenant_relationship_guards.sql` latest six invoker trigger functions + same-company assertion, attachment DO and exact explicit EXECUTE ACLs. Also requires actual customer_legal_acceptances and contract_price_snapshots for the separate18 family; these two are not in the ten critical relations.

**Remaining full-trigger closure is explicit, not silently omitted.** Current own-INSERT/UPDATE can reach numbering, signed/publication/state-machine guards, partner API events, site resolution/summary, PoA scope materialization and invoice projection. A finite set of concrete trigger-source blockers is appended below; it is not a full trigger replay inventory. A policy-only fixture may extract table+policy+relationship slices and report that exclusion, but cannot call its 100 checks complete current-row CRUD until each triggered body/replacement and sink table has an admitted source slice. This report has not claimed every application-trigger branch closed.

## 18-reference behavior interaction with RLS

Reference list is exact: sites.customer_id; metering.customer_id/site_id; contracts.customer_id/site_id/customer_site_id/metering_point_id; legal_acceptances.customer_id/contract_id; PoA.customer_id/site_id/metering_point_id; underlays.customer_id/customer_contract_id/contract_id/site_id/metering_point_id; price_snapshots.contract_id.

Keep its two roles and same-tenant positives, cross-tenant I/U/reassignment negatives, snapshot23502/23503 controls. However the existing fixture grants parent visibility broadly and tests invoker guards in isolation. In the combined RLS fixture, an ordinary A actor may not SELECT a B parent; most Sept5 guards then read NULL and the assertion intentionally only rejects when both companies are nonnull. An actual composite FK can reject23503 instead; snapshot guard can raise23503 for a hidden parent. Do not falsely insist every combined authenticated negative must be23514, or claim the old 18 guard cases prove current RLS behavior. Preserve two explicitly labelled families: isolated trigger semantics with source-backed role/ACL assumptions; combined RLS+FK behavior with exact current rejection cause and unchanged-row evidence. The contract's18 paths and100 cases both remain required; assess any revised error expectations against native evidence, not a blanket exception catch.

## Suggested 11b admission assertions

1. Freeze source-order manifest/history/additions/exclusions and every raw source/slice hash. Record F/T positions, strict byte offsets, unique signatures, delimiters and first/last bytes. Unknown/duplicate/moved slices fail. Read-only witnesses never count as executed slices.
2. Require all ten table OIDs/relkind, RLS/FORCE flags, owner, exact column names/types/defaults/nullability/generated fields; capture constraints/index definitions and complete enabled trigger definitions before seeding. No substitute relation shape to avoid a trigger dependency.
3. Pin preceding policy multiset (name/command/roles/permissiveness/deparsed USING/CHECK) before June rewrite and consolidation; explicitly assert expected absence of unselected DB3/intake/May31 effects. Resolve authority if target is source parity rather than selected-only characterization. Require exact preimage before dynamic mutation.
4. Pin pg_roles/pg_auth_members plus initial owner/default/table/column/function ACLs; require schema USAGE and positive current-role grants from admitted source. Explicit fixture-only grants, if authorized, must appear in a separate receipt and scope statement before classification. Never describe them as production provenance.
5. Consolidation: compare computed role universe and target set; enumerate exact expected generated names per role/action using source digest formula; require zero target skipped events and exact policy count/expression results. Invoices/lines must retain DB1 names if not enrolled. Restrictive policies unaffected.
6. August12–26: assert webhook role policies before/after normalization; all ten lifecycle targets; own session/platform/helper definition/ACL identities; exact heavy/general collapse target sets; source-normalized guard expressions; no newly permitted write command. Assert no unwanted trigger/helper replacements.
7. September cleanup: capture policies/classification before/after both09:20 and09:40 stages. Enumerate the exact dropped set using actual ACLs; any authenticated lifecycle guard disappearing on a supposed client-reachable tenant table fails admission. Compare column ACLs independently. Parent composite-FK target set must reflect those exact classified sources.
8. Seed synthetic A/B actors/rows through owner setup, then execute each declared SQL role/JWT operation; preserve own/read/writable positive controls and distinguish42501 policy/ACL denial, zero affected rows,23502/23503/23505/23514 constraints and setup failure. Capture row multisets including side-effect tables, not just returned rows.
9. Require two-pass final catalog/ACL stability only where selected source is genuinely idempotent; June consolidation source events/temp tables and August13 expected-nonzero assertions need their own contracts. Do not replay protected private foundation boundaries without their already-reviewed owned protocol.
10. Keep outputs explicit:100 critical CRUD +18 reference paths +16 access cases; managed Data API/JWT/Storage and full schema parity remain separate. No native case has run in this report.


## Source/slice hash receipt

Raw SHA-256; `[start,end)` are zero-based byte offsets, inclusive start/exclusive end. Lines above are navigation only. Table slices are original CREATE TABLE only and deliberately do not claim later ALTER/trigger closure. Existing Task11a slices were rehashed read-only without modifying its finite manifest. These records are a proposed input atlas, not a new admitted runtime manifest.

| Slice ID | Source | Byte interval | SHA-256 |
|---|---|---|---|
| db1_policies | `supabase/migrations/03_db1_backfill_functions_rls_reports_and_finish.sql` | [28306,32041) | `70a4846278cb54366f2b7f778e2c241b1eb39a92402fb8c7c2a194ac1b079016` |
| saas_tenant_policies | `supabase/migrations/20260519_final_saas_hardening.sql` | [18543,21196) | `5f37fa54c0adb103167c6e4997f757d45e641325bf7f9c56af002c32e738b894` |
| governance_tenant_policies | `supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql` | [7524,10285) | `b6ec629cfc480d99379fbf3e4cd175f8cb0e699db9172becc80cb6d2a666ef8a` |
| rbac_tenant_policies | `supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` | [7234,9969) | `489ee3b64b5bb851993a984b775b8a5df0eae17ca216d02e65bc57bd4d45a932` |
| gridcore_foundation_policies | `supabase/migrations/ediel_rules.sql` | [30390,32828) | `882259281eb806ff0a2df6819659a6ae322deccc6931a0698e67ab446a8dcbff` |
| gridcore_timestamp_policies | `supabase/migrations/20260530110000_gridcore_ediel_multitenant_foundation.sql` | [30473,32916) | `c41c1f8bf1e28682f392d68d34877ad929ea571740711caee0445de485359aa1` |
| launch_policies | `supabase/migrations/20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql` | [4248,7107) | `fa570d6f0e9fdea19caf0edf0b21a7eb2d98c28ed64482a117705e174a150521` |
| linter_public_anon_table_revokes | `supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql` | [13258,13492) | `aba196d0c04a04ecf9a52a317d4721624ad5ac1c19b5d1a2186c605e3dadfed0` |
| consolidation | `supabase/migrations/20260612143000_performance_policy_consolidation_and_index_cleanup.sql` | [2558,10892) | `039eda6f2867306262a256fb8e2aabf7c1958e9724825f5cf5c2e1b6d1622d04` |
| webhook_service_platform_policies | `supabase/migrations/20260703110000_gridex_event_log_rls_hardening.sql` | [1388,5580) | `ad3a77705793622de90ec60c2f437a46866e9fea6f68752a43d719500edc6315` |
| normalization_service_drop | `supabase/migrations/20260812210800_gridex_rls_policy_normalization_v1.sql` | [5395,6178) | `2c69c5e43e2431b3288daf9bcb2dca32721a867547c2a58be0598f225faa38c3` |
| webhook_normalized_select | `supabase/migrations/20260812210800_gridex_rls_policy_normalization_v1.sql` | [6623,6995) | `4810af0dd30e38347acc9786b1396c5b27d762c9c6e75f2eadddd2f24961958c` |
| perf_heavy_select | `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | [7728,9579) | `075de309036309a5aad7cb740ba18dfab8a5d083424872d199874a0cfe8689e5` |
| perf_lifecycle_select | `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | [9817,10510) | `aa160308983d46673a6c860eb0bfce933cdd9ffb6299745299fb4584e666cbb1` |
| perf_general_select | `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | [10857,12438) | `494c529e00da293eb6ffa3fd366d6bafb77a95d9b8ec77069ecfc8fbabad965d` |
| customers_original_table | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | [24770,25849) | `7f5f831dc8da1fd597537a88db065aa6ccd0469de6d8edca3f76df4253e945b1` |
| customer_sites_original_table | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | [29582,30763) | `0fa0955790031fb92008baaa477bbb1d05571feda67e97e82f22b380906c101d` |
| metering_points_original_table | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | [30765,31828) | `d94a5300e0f0aca90dd81fd7ca277f66601393aea564066e784a137159e2121b` |
| customer_contracts_original_table | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | [33072,35362) | `ef79081fcfd86c3863121160404280f01b718cc7c67987e508294edbb97137f4` |
| powers_of_attorney_original_table | `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | [351,1010) | `c0ee05ed9d0d5ffa47f2f0664895a6e42abd122fbc29fbe7ca5a5e9c56e453d9` |
| billing_underlays_original_table | `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | [11993,12877) | `ac97be27d92e187722dcc75f281a4981c904d0fde640ba56cd1067c30b257554` |
| customer_invoices_original_table | `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | [28774,29690) | `90092a12f8c4034cf3a80f9bda4c1dc0ffd6a5774bba82f526953c5500c5ce0c` |
| customer_invoice_lines_original_table | `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | [29692,30122) | `c80a2ead6530d993744b97926201e8cb57d81d926f5f16a1845fa0cac4f1ae19` |
| audit_logs_original_table | `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | [26642,26999) | `52bfc1e85213c5b445d322612630a0286e2023f4a1588f60f7aaf936ac269050` |
| webhook_original_table | `supabase/bootstrap/20260609_webhook_email_readiness_foundation.sql` | [4857,6069) | `2eeb181e7c54ff4d5b131c9300330c77f02bf9ce127bce58e958deff12433058` |
| managed_compatible_bootstrap | `scripts/sql/gridex-supabase-compatible-bootstrap.sql` | [0,9537) | `209b0c391bcfa957ec8b30cfc338622b4bda776e6976d3624fdd2d04779b8914` |
| normalize_platform_role | `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql` | [137,680) | `ad67c326ba8465cc624a3e90cfb3918518e9cbaea9d974a3f3aac3d848135dbd` |
| canonical_platform_actor | `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql` | [17020,18227) | `409e0bd0e66e9a143245232400317a3a196450bdbca7b21518bd7081da952ddc` |
| platform_actor_current_user | `supabase/migrations/20260802190000_canonical_emergency_access_lockdown.sql` | [5417,6688) | `9c3b2609740c39e7ea674e0b2e603510df7f83b23cc4e86542aca5bfd736e98a` |
| session_guard | `supabase/migrations/20260730130000_historical_sync_forward_repair.sql` | [2098,3221) | `9f91fd19decd3cabdef45136270fa235c7b598778cac63e5c2c0c0726f148b55` |
| gridex_user_company_ids | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [792,1382) | `3c1086e20583f61788b941619dddf2d27e72fbfb1baadfc24c9cf982750b46c0` |
| gridex_can_read_company | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [1384,2149) | `5e69f20b0b035faefc6dd85c351e4e17d0c89dcfc4f27ea0a286fe44ee68b8f7` |
| gridex_can_write_company | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [2151,3067) | `30cf91fab4bfb241724507b6f1a7cb8e2f41fbbe12ff7f5c69a76c6b3758d6b5` |
| gridex_user_can_manage_company | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [3069,4037) | `12b4098fdfc96b023fb3d6c38dab4aa9256b524d85750f3e3ad69c82f78bce61` |
| lifecycle_helper_acls | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [4123,5013) | `dd929d050cec09f0dcd9795007ed570c72ec7af6f01834c7c54a38a96836686d` |
| access_table_write_revokes | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [8368,8734) | `931eb39d1b5463967a8e824a8edc57a2fcaaaefad8f1556cc5202a62399247b8` |
| lifecycle_dynamic_policy_family | `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | [5204,7626) | `25321424b8eee8e9799d50881157c5becdf45cad57d71399f894f7159c4f0cac` |

### Whole-source identity and actual selection

F/T positions come from the exact existing selector, not filename sorting. Bootstrap106 is in the foundation-order manifest; compatible bootstrap is a separate harness input.

| Source | Selected position/disposition | Whole-file SHA-256 |
|---|---|---|
| `scripts/sql/gridex-supabase-compatible-bootstrap.sql` | bootstrap/harness prerequisite | `209b0c391bcfa957ec8b30cfc338622b4bda776e6976d3624fdd2d04779b8914` |
| `supabase/bootstrap/20260609_webhook_email_readiness_foundation.sql` | bootstrap/harness prerequisite | `c42f8658753cee18e34e566b6387a9ad330575b24b2c066b83a4a7090b436898` |
| `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | F1 | `85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2` |
| `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | F2 | `0413f4dca84aca387297954b900a163aa63d0f84552570c372c12e8f8abdd693` |
| `supabase/migrations/03_db1_backfill_functions_rls_reports_and_finish.sql` | F3 | `877e395df0050a36ec71298d279c72fb0e6cb13d8b90082277450012e196f169` |
| `supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql` | F37 | `b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab` |
| `supabase/migrations/20260519_final_saas_hardening.sql` | F35 | `2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e` |
| `supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` | F39 | `47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64` |
| `supabase/migrations/20260521_batch_customer_intake_batch2_completion.sql` | UNCLASSIFIED | `9cf593a45de464b273eb0642645d21d4b831fbc6e2458cb41711dcfdb90fff6a` |
| `supabase/migrations/20260523_db3_tenant_isolation_rbac_enforcement.sql` | SUBSTITUTED | `ac4d51086e0d6865de6012cc5e84ca524a59c094daccf987261afa2580a9f450` |
| `supabase/migrations/20260530110000_gridcore_ediel_multitenant_foundation.sql` | T1 | `2915c459e7285c8f8813483d7958f5ff5ca3fdbefd263f0062e772f8c9dcb839` |
| `supabase/migrations/20260531111600_system_readiness_foundation.sql` | SUBSTITUTED | `e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2` |
| `supabase/migrations/20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql` | T48 | `f05590c61dcae469c8ca6e324582024ab79a1cb8862775eddeccec97e16727c2` |
| `supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql` | T49 | `b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1` |
| `supabase/migrations/20260612123000_performance_batches_1_to_3_db_acceleration.sql` | T52 | `1711c1f0fb6a50a453db3c66c554c0a0bcd2d4c0b63f96996254707e05ea93a1` |
| `supabase/migrations/20260612143000_performance_policy_consolidation_and_index_cleanup.sql` | T53 | `ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60` |
| `supabase/migrations/20260703110000_gridex_event_log_rls_hardening.sql` | T145 | `5716af633659b247aa016ed4e76ddbafab82ecf148128ab25d9946c75620eba6` |
| `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql` | T213 | `392d9e90c4fcec6752644fb75721ed7a113c3dcd2cb68d3185e3bfd44a065c4f` |
| `supabase/migrations/20260730130000_historical_sync_forward_repair.sql` | T233 | `3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b` |
| `supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql` | SUBSTITUTED | `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0` |
| `supabase/migrations/20260802190000_canonical_emergency_access_lockdown.sql` | T249 | `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43` |
| `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql` | T250 | `96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930` |
| `supabase/migrations/20260804193000_contract_price_snapshot_company_guard_fix.sql` | T278 | `fb01ad3dcd01d37f5feb630d06735a4309eca42b276b23237d6c1cae700b739e` |
| `supabase/migrations/20260805085617_api_contract_billing_tenant_hardening.sql` | T282 | `b17abd19803511156eb21902e9d57b4ca8219fef303c9238e33a03a69ff140b7` |
| `supabase/migrations/20260812210800_gridex_rls_policy_normalization_v1.sql` | T331 | `2d9609109928967f571401864893a47bee1598bce8b115b5f26f3fadc236643a` |
| `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | T349 | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |
| `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | T437 | `f9084068f4eead62330b1b394b6b4cab5f47ff68b411bdb144009314c2b85a2c` |
| `supabase/migrations/20260902090000_tenant_scoped_unique_business_keys.sql` | T474 | `bbb755c51bd128352d3b0d7a4e916dec01fa870c4c0083b83ebd82f3e7044035` |
| `supabase/migrations/20260902092000_view_security_invoker_and_dead_policy_cleanup.sql` | T476 | `911df38c226051d3b60726d8027f322bc566d30d72e51632b71797fb88ef0ed2` |
| `supabase/migrations/20260902094000_platform_table_classification_and_invariant_gate.sql` | T478 | `29ea84caceca14260c6a909534c89a26a015568d9bf56741cd796a5cd1896470` |
| `supabase/migrations/20260902095000_lock_customer_chain_with_composite_keys.sql` | T481 | `bd3e79d2dab7f3332487b6259e595a258c413c288d073c63c5163555f7cd9c38` |
| `supabase/migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql` | T484 | `d069342180f5d86f39a8988ad6905fa4dca0e451ca8c23d96a1cd8b647895e10` |
| `supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql` | T504 | `3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1` |
| `supabase/migrations/20260905141608_canonical_tenant_relationship_guards.sql` | T505 | `8e1ec819b7775072ff04370e2ce7327793e094acf248a971968565e643bfe8f5` |
| `supabase/migrations/20260911114443_canonical_user_rbac_customer_alignment_boundary.sql` | F68 | `80f58edf6d9a48baef4999202744040979cd7af1cc0e61b812e52369ad13aff1` |
| `supabase/migrations/ediel_rules.sql` | F89 | `2f9249c6c34999258472580e87da8aa2a1658cf5d4c272fbe22b17b4f1d3dca2` |

| Ordering/admission reference | SHA-256 |
|---|---|
| `scripts/gridex-aud-003-foundation-order.json` | `8c98f1e825b0f6cadb1671065993745d7bd1a2ac29179e1f902c02c82a796b6b` |
| `scripts/gridex-aud-003-legacy-foundation.json` | `7196bf2e7fc66cbb5ec0546e8b3d75675410763dbf569036d5c0bcdc627e4ba9` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `ac62084491e2220aa2f332d34ad118bc302676958248e8d7be41b484b925486d` |
| `scripts/gridex-aud-003-noncanonical-artifacts.json` | `5b04bc64a1800b7d3d2f83b2188e1e9a40077bb83c6dfc08c2b6cf91dccef7b7` |
| `scripts/migration-history-manifest.json` | `a894d8b2c7fbd45a0aebd75d5224998fa0a61e76d2a6b324b8a963b5857ae59c` |
| `scripts/migration-history-manifest.additions.json` | `41bd9612d8ce3f608a44ff35e9420fd1d4089926ef082f34b1c791832c07f059` |
| `scripts/migration-history-manifest.runtime.additions.json` | `cbcb3d21e3f5fbb549e2269d537d52121101b7c20b555742bc0562afa6a32894` |
| `scripts/sql/canonical-permission-native-sources.json` | `f36227df8641d901eab06148e00730c34d19fe379bdb2a6391ddc7502404a188` |

## Concrete trigger-source blockers for the implementer

These are actual selected CREATE TRIGGER sites found while tracing the ten tables. This bounded list directs the remaining dependency work without claiming every trigger replacement/sink has been closed.

| Critical relation/group | Concrete required source sites beyond the policy/relationship fixture |
|---|---|
| customers | July19 `20260719120000_canonical_customer_number_assignment.sql`:40/67 assignment/protection; Aug16 `20260816170000_partner_api_v1_canonical_surface_events.sql`:445 events; Aug21 `20260821135500_enforce_site_summary_and_request_idempotency.sql`:71 reaggregation. |
| customer_sites | June18 `20260618213000_ops_completion_workflows_health.sql`:360 address invalidation; Aug16 events:451; Aug17 `20260817094125_papilite_verified_postal_learning.sql`:85 and `20260817124500_site_resolution_materialization_guard.sql`:79; Aug21 summary:52; Aug24 `20260824080448_unique_postal_city_provisional_grid_owner.sql`:142; Sept2 `20260902221500_facility_initial_address_and_unknown_supplier_semantics.sql`:234. |
| customer_contracts | June8 `20260608152000_billing_source_normalized_fix.sql`:90 company setter; July14 signed immutability/evidence (`20260714130000`:474, `20260714160000`:244); July16 exact-publication (`20260716010000`:654), locked tenant snapshot (`20260716140000`:966), finalization (`20260716183000`:1418/1483); July27 chain/state (`20260727010000`:201, `20260727040000`:620, `20260727167000`:110/176); Aug4 fee trigger (`20260804003000`:74); Aug16 events (`20260816101505`:560); Aug18 identity/pricing (`20260818121500`:412, `20260818124500`:71); Sept1 price-area binding (`20260901151000`:32). Full filenames are uniquely prefixed in migrations. |
| powers_of_attorney | July20 `20260720110000_canonical_customer_onboarding_transaction.sql`:183 signed-scope immutability; Aug16 events:457; Aug24 `20260824140830_website_poa_materialization_and_grid_owner_send_guard.sql`:105 materialization; Sept2 scope/expires triggers:27/158. |
| billing_underlays | July16 `20260716010000_contract_billing_end_to_end_completion.sql`:994 exact refs; `20260716090000_production_settlement_export_completion.sql`:85 normalization; July25 billing-readiness:55 immutable configuration; July27 contract-flow:381 customer chain; Aug4 `20260804190000_svk_geodata_and_billing_price_area_canonicalization.sql`:416 price area. |
| customer_invoices | July18 portfolio publication/billing:601 evidence; July27 contract-flow:405 chain; Aug10 `20260810110149_customer_invoice_public_reference.sql`:55; Aug16 events:462; Aug26 `20260826213000_invoice_review_projection_sync.sql`:64 projection. |
| audit_logs | July27 `20260727040000_contract_security_energy_direction_api_completion.sql`:728 context normalization. |
| metering_points / customer_invoice_lines / webhook_deliveries | Actual Sept5 metering guard and source constraints above are mapped; this finite read has not certified absence of additional dynamically attached/default side effects. Exact final pg_trigger/default-expression inventory remains required, not an invented “no trigger” assertion. |

## Closure decision and verification receipt

**Report complete; full point77/source reachability remains blocked.** The finite selected-policy chain, its original table prerequisites, latest authority helpers, four main policy transformation stages, ACL-sensitive later cleanup, key graph sources and exact source hashes are mapped. No native or managed access acceptance is claimed.

Actionable blockers, in dependency order:

1. **Historical policy authority:** choose an explicitly labelled selected-chain characterization, or admit the missing DB3 removal/policies and intake policies with reviewed source-effect disposition. Do not alter the existing600-input selection from this report. Snapshot differences are evidence requiring disposition, not permission to recreate snapshot policies.
2. **Managed ACL/role authority:** obtain/pin the actual initial default privileges/table+column grants/owners and effective role universe, or separately authorize a fixture-only privilege profile with narrower claims. In particular, table ACLs must be settled before September classification/cleanup and composite-FK step2.
3. **Full-row write closure:** admit each real column/constraint/trigger/helper/sink needed for the declared own positive row shape. The policy atlas is complete enough to construct a bounded candidate, but current100-CRUD cannot be accepted while such write effects are omitted. Reuse existing focused billing/tenant source reports where applicable; no broad audit restart is needed.
4. **Native catalog/error evidence:** implement reviewed source-admission assertions, then run the owned native lane separately. Compare exact pre/post policies, grants, guards, FK enrollment and behavior. Keep23514 isolated-trigger evidence separate from23503 invisible-parent/FK combined behavior.

Read-only verification performed here: exact existing selector returned expected600 dispositions and118/508 stages;37 raw source slices rehashed (including12 reused finite manifest IDs);36 whole-source identities and8 ordering/admission references recorded; all reused slice SHA values matched. Source scans checked concrete policy arrays, generic catalog transforms, multiline GRANT/REVOKE/default privileges, helper replacement definitions and ten-table relationship/trigger prerequisites. No SQL was parsed by PostgreSQL or executed. Git working tree was inspected; existing root/reviewer changes were preserved. Only this report was written by this lane; it resides under the requested task path (which is ignored by normal git status).

Next implementer action: decide the explicit11b evidence scope and ACL source admission first, then turn the37-slice atlas plus required source-backed write dependencies into a separate reviewed manifest. No change to Task11a is needed or authorized by this report.
