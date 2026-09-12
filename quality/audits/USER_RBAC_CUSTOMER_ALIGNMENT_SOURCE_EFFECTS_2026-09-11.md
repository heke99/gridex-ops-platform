# User/RBAC/customer alignment source effects — 2026-09-11

Status: **BOUNDED SOURCE MAP; IMPLEMENTATION, NATIVE SQL ACCEPTANCE, SELECTION AND PRODUCTION CONVERGENCE PENDING.**

## Scope, authority and pins

This document maps exactly three immutable unresolved migrations. It does not select them or establish their current production effects.

| Alias | Immutable source | Lines | SHA-256 | Current source state |
| --- | --- | ---: | --- | --- |
| A | `supabase/migrations/20260525_debug_step2_code_schema_alignment.sql` | 87 | `e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04` | unresolved / not selected by this review |
| B | `supabase/migrations/20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql` | 280 | `afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2` | unresolved / not selected by this review |
| C | `supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql` | 374 | `5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472` | unresolved / not selected by this review |

The three complete bodies total 741 lines. The ranges below are contiguous file-coverage ranges; the nested `statement` ranges identify executable SQL precisely. Leading comments and blank lines belong to the following covered unit. Current tracked Task18 registration and its working foundation/counts are implementation evidence only: its native actual63 acceptance is pending and is not a prerequisite silently assumed here. The accepted historical prefix and private owned-database lifecycle remain the reusable execution authorities.

Skill routing was bounded to PostgreSQL/Supabase schema and security rules, spec-to-code caller comparison, code review/false-positive verification, and evidence-before-completion. Repository-wide discovery, UI review, performance tuning, package/supply-chain work, dynamic scanners, browser/provider work, implementation/TDD and deployment are outside this read-only source map.

## A — complete 87-line effects

### Complete statement accounting

| Unit / covered lines | Statement | Exact effect and native dependency |
| --- | --- | --- |
| A1 / 1–20 | `CREATE TABLE IF NOT EXISTS` 7–19 | If absent, creates `ediel_tgt_test_data`: UUID PK `id DEFAULT gen_random_uuid()`; nullable `company_id` FK to `companies(id)` with default NO ACTION behavior; `test_suite` and `test_case_code` text NOT NULL; nullable `role_code`, `data_key DEFAULT 'portal_payload'`, `data_value`; `payload jsonb NOT NULL DEFAULT {}`; `is_active boolean NOT NULL DEFAULT true`; non-null current-time `created_at`/`updated_at`. If the relation already exists, no column, PK, FK, type, default or nullability is validated. `companies`, UUID generation and an ordinary compatible target name must exist when creation is needed. |
| A2 / 21–23 | `ALTER TABLE` 21–22 | Sets only `data_key`'s default. The table and column must exist; `IF EXISTS` protects only the table. |
| A3 / 24–26 | `ALTER TABLE` 24–25 | Drops `data_key` NOT NULL. This is a real constraint weakening despite the header's “additive” description. |
| A4 / 27–35 | one `ALTER TABLE`, six subcommands 27–33 | Adds nullable `title`, nullable `source_note`, `raw_text text NOT NULL DEFAULT ''`, `parsed_payload jsonb NOT NULL DEFAULT {}`, nullable `created_by`, nullable `updated_by`. Existing same-name columns are not reconciled. Adding the two defaulted non-null columns fills existing rows under PostgreSQL column-add semantics. |
| A5 / 36–43 | `UPDATE` 36–40 | Copies a nonempty legacy `payload` into `parsed_payload` only when `coalesce(parsed_payload,{})={}` and `coalesce(payload,{})<>{}`. It does not change `payload`, so legacy payload is preserved. The `to_regclass` predicate is not a missing-target guard because the UPDATE target and referenced columns must resolve first. Existing nonempty parsed data is retained. |
| A6 / 44–58 | CTE + `DELETE` 44–57 | Globally ranks every row by `(test_suite, role_code, test_case_code)`, newest `updated_at`, then `created_at`, then greatest UUID `id`, all descending with timestamps NULLS LAST; deletes every `rn>1`. Neither `company_id` nor `is_active` participates. Window partitioning treats NULL `role_code` values as one group. UPDATE/DELETE triggers and all incoming FK actions/restrictions execute normally. |
| A7 / 59–63 | unique index 59–60 | Creates `ediel_tgt_test_data_suite_role_case_uidx` on `(test_suite, role_code, test_case_code)`, no predicate. PostgreSQL's normal unique semantics allow multiple NULL `role_code` rows, unlike A6's NULL grouping. A later insert can therefore recreate NULL-key multiplicity. Same-name `IF NOT EXISTS` is not definition validation. |
| A8 / 64–66 | index 64–65 | `user_permission_overrides_user_active_idx(user_id,is_active,permission_key)`. |
| A9 / 67–70 | index 67–68 | `user_roles_user_active_role_idx(user_id,is_active,status,role_id,role)`. |
| A10 / 71–73 | index 71–72 | `customer_sites_customer_company_idx(customer_id,company_id,created_at DESC)`. |
| A11 / 74–76 | index 74–75 | `customer_contracts_customer_company_idx(customer_id,company_id,created_at DESC)`. |
| A12 / 77–79 | index 77–78 | `customer_contacts_customer_company_idx(customer_id,company_id,created_at DESC)`. |
| A13 / 80–82 | index 80–81 | `customer_addresses_customer_company_idx(customer_id,company_id,created_at DESC)`. |
| A14 / 83–85 | index 83–84 | `outbound_requests_customer_created_idx(customer_id,created_at DESC)`. |
| A15 / 86–87 | index 86–87 | `grid_owner_data_requests_customer_created_idx(customer_id,created_at DESC)`. |

A declares exactly nine indexes, including the unique index. All eight ordinary index statements are unguarded relation/column references. A's existing DB1 table predecessor has a different unique constraint over `(company_id,test_suite,test_case_code,data_key)` (`02_db1_operations_ediel_billing_dedupe_and_storage.sql:642–655`); neither constraint substitutes for the other. The later same-name declaration in `20260528_debug_post_repair_schema_guardrails.sql:290–293` has a non-null suite/case predicate, but A's already-created same-name index makes that later `IF NOT EXISTS` a no-op. Static source order therefore leaves A's unpredicated definition unless a reviewed forward boundary changes it.

The app uses a service client to list and fetch this table without company scope and upserts on exactly `test_suite,role_code,test_case_code` (`lib/ediel/testing/tgtTestDataStore.ts:1017–1065,1068–1107`). That matches the non-NULL conflict target but does not settle whether the registry is intentionally global or tenant-owned. `company_id` in the schema and A's cross-company deletion make that ownership decision an admission blocker. A blind replay against populated tenant data is not acceptable.

## B — complete 280-line effects

### Top-level statement accounting

| Unit / covered lines | Statement | Exact effect |
| --- | --- | --- |
| B1 / 1–18 | function 5–17 | Creates/replaces `gridex_debug_column_exists(text,text) RETURNS boolean`, SQL, STABLE, default SECURITY INVOKER. It checks `information_schema.columns` for the named public column. No fixed `search_path`, explicit revoke/grant or RLS effect. A new function receives PostgreSQL's default PUBLIC EXECUTE; replacement preserves the existing owner/ACL. A preexisting incompatible return type would fail. |
| B2 / 19–223 | one `DO` 19–221 | Runs the 16 guarded UPDATE branches below in one PL/pgSQL statement. An uncaught failure in any branch rolls back all writes in this DO statement, but not B1 under a nontransactional file runner. |
| B3 / 224–280 | one `DO` 224–278 | Runs 16 relation branches containing 17 alternative index declarations. An uncaught failure rolls back every index created by this DO statement. Line 280 intentionally leaves B1 installed. |

### Sixteen guarded updates

| Lines | Child ← parent | Assignment and preservation | Guard gap / dependency |
| --- | --- | --- | --- |
| 22–33 | `customer_sites` ← `customers` | Fill NULL child company from non-NULL parent company by customer ID. | Does not verify `customers.id`. |
| 35–48 | `metering_points` ← `customer_sites` | For rows missing either field, independently preserve each existing non-NULL child value with `coalesce`; fill missing company/customer from the site. | Does not verify `customer_sites.id`; it can preserve a company/customer that conflicts with the linked site's other field. |
| 50–61 | `customer_internal_notes` ← `customers` | Fill NULL company only. | Does not verify `customers.id`. |
| 64–74 | `customer_authorization_documents` ← `customers` | Fill NULL company only. | Checks neither `customers.id` nor `customers.company_id`. |
| 76–86 | `powers_of_attorney` ← `customers` | Same. | Same parent-column gap. |
| 88–98 | `power_of_attorney_scopes` ← `customers` | Same. | Same parent-column gap. |
| 100–110 | `customer_portal_accounts` ← `customers` | Same. | Same parent-column gap. |
| 112–122 | `customer_portal_claims` ← `customers` | Same. | Same parent-column gap. |
| 125–135 | `grid_owner_data_requests` ← `customers` | Same. | Same parent-column gap. |
| 137–147 | `metering_values` ← `customers` | Same. | Same parent-column gap. |
| 149–159 | `billing_underlays` ← `customers` | Same. | Same parent-column gap. |
| 161–171 | `partner_exports` ← `customers` | Same. | Same parent-column gap. |
| 173–183 | `outbound_requests` ← `customers` | Same. | Same parent-column gap. |
| 185–195 | `supplier_switch_requests` ← `customers` | Same. | Same parent-column gap. |
| 197–208 | `supplier_switch_events` ← `supplier_switch_requests` | Fill NULL event company from the linked request. | Does not verify parent `id`. |
| 210–220 | `ediel_messages` ← `customers` | Fill NULL company only. | Checks neither `customers.id` nor `customers.company_id`. |

Every B2 UPDATE preserves a populated target `company_id`; only metering can also fill `customer_id`, and it preserves an existing customer ID. No branch explicitly changes `updated_at`. Enabled row/statement triggers, RLS as the executing role sees it, generated/domain/check constraints and outgoing FKs can reject or add indirect writes. Parent IDs are expected to be unique; an unexpected nonunique parent match would make the `UPDATE ... FROM` source choice unspecified. B creates no FK or trigger and disables neither.

### Sixteen index branches / seventeen declarations

Every branch verifies the relation and the two named leading key columns shown in the source, but most fail to verify their time column. Exact declarations are:

| Lines | Index declaration(s) | Missing guard |
| --- | --- | --- |
| 226–228 | `customer_sites_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 229–231 | `metering_points_site_company_created_idx(site_id,company_id,created_at DESC)` | `created_at` |
| 232–234 | `customer_internal_notes_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 235–237 | `customer_authorization_documents_customer_company_uploaded_idx(customer_id,company_id,uploaded_at DESC)` | `uploaded_at` |
| 238–240 | `powers_of_attorney_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 241–243 | `power_of_attorney_scopes_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 244–246 | `grid_owner_data_requests_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 247–253 | If `read_at` exists, `metering_values_customer_company_read_idx(customer_id,company_id,read_at DESC)`; otherwise `metering_values_customer_company_created_idx(customer_id,company_id,created_at DESC)`. | Else branch does not verify `created_at`; only one alternative is created per run. |
| 254–256 | `billing_underlays_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 257–259 | `partner_exports_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 260–262 | `outbound_requests_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 263–265 | `supplier_switch_requests_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 266–268 | `supplier_switch_events_request_company_created_idx(switch_request_id,company_id,created_at DESC)` | `created_at` |
| 269–271 | `customer_portal_accounts_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 272–274 | `customer_portal_claims_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |
| 275–277 | `ediel_messages_customer_company_created_idx(customer_id,company_id,created_at DESC)` | `created_at` |

All declarations are ordinary nonpartial B-tree indexes with default ASC leading keys and the stated DESC final key. `IF NOT EXISTS` validates neither relation ownership nor an existing same-name index's keys, predicate, uniqueness, validity or readiness. A and B create distinct same-shape indexes on `customer_sites(customer_id,company_id,created_at DESC)` under different names; selecting both preserves both physical indexes and their write cost unless a separately reviewed cleanup proves one may be removed.

## C — complete 374-line effects

### Top-level statement accounting

| Unit / covered lines | Statement | Exact effect |
| --- | --- | --- |
| C1 / 1–59 | one `DO` 5–57 | Five backfill branches below. |
| C2 / 60–127 | one `DO` 60–125 | Thirty-one dynamic `CREATE INDEX IF NOT EXISTS` statements below. Table existence is the only branch guard. |
| C3 / 128–168 | view 128–163 | Creates/replaces four-column `gridex_debug_step1_2_schema_alignment_v` over 14 literal table names, reporting `to_regclass` existence and `pg_class.relrowsecurity`; every non-RLS present relation except `billing_export_runs` is `review_rls`. It is a catalog report, not an authorization decision. |
| C4 / 169 | `DROP VIEW IF EXISTS gridex_debug_batch2_rbac_v` | Drops the known dependent view using RESTRICT semantics. It deliberately removes that object's owner/ACL/options. Unknown objects depending on the view can block it. |
| C5 / 170–171 | `DROP FUNCTION IF EXISTS gridex_get_user_roles(uuid)` 170 | Drops the prior signature using RESTRICT semantics. Because C4 precedes it, the known predecessor view is handled. Any other actual dependent blocks the source; the current static tree does not prove the native dependency catalog. |
| C6 / 172–205 | function 172–201 plus grant 203 | Creates table-return role lookup and explicitly grants anon/authenticated/service_role; details below. The create and grant are separate top-level statements. |
| C7 / 206–222 | view 206–221 | Recreates `gridex_debug_batch2_rbac_v`, now aggregating the table-return role rows. |
| C8 / 223–239 | function 223–238 | Creates/replaces the permission-override lookup. |
| C9 / 240–284 | function 240–283 | Creates/replaces latest-contract bucket counts. |
| C10 / 285–337 | function 285–336 | Creates/replaces the single Ediel rule resolver. |
| C11 / 338–374 | function 338–374 | Creates/replaces the inbound Ediel rule resolver. |

C contains 12 top-level SQL statements when the separate C6 grant is counted: two DO statements, two views, five functions, two drops and one grant. None of A/B/C contains transaction control or a psql meta-command; the `begin` tokens at B20/B225/C6/C61 are PL/pgSQL block bodies. Without an outer transaction, earlier top-level statements can persist after a later failure. C is especially unsafe in autocommit because C4/C5 can persist before C6 fails. All three sources therefore plausibly belong in one outer transaction with a required final boundary.

### Five backfills

| Lines | Exact source behavior | Guard gap / semantic concern |
| --- | --- | --- |
| 7–17 | On metering rows where customer or company is NULL, **overwrite `customer_id` unconditionally** from linked site, preserve non-NULL company via `coalesce`, and fill `updated_at` only if it was NULL. | Checks only the two relations and target `customer_id`; assumes target `company_id/site_id/updated_at` and site `id/customer_id/company_id`. Unlike B42–47, it can replace a non-NULL customer when only company was missing. It can preserve a conflicting non-NULL company. |
| 19–27 | Fill NULL inbound-case company from message and fill NULL `updated_at`. | Table-only guard; assumes all referenced columns. |
| 29–37 | Fill NULL portal-account company from customer and fill NULL `updated_at`. | Same. |
| 39–47 | Fill NULL portal-claim company from customer and fill NULL `updated_at`. | Same. |
| 49–56 | Fill NULL portal-event company from customer; no timestamp write. | Same. |

These updates invoke the current five targets' enabled triggers and enforce current constraints/FKs. A meaningful proof must retain the difference between B's coalesced metering customer and C's overwrite; combining them into one generic “tenant backfill” oracle would be wrong.

### Thirty-one indexes

C2 checks only table existence. Every named column, expression input and compatible operator class must already exist; one failure rolls back all indexes created inside C2. Exact declarations are:

| Lines | Relation | Exact index names and ordered keys |
| --- | --- | --- |
| 62–67 | `customers` | `idx_customers_company_status_created(company_id,status,created_at DESC)`; `idx_customers_company_normalized_email(company_id,normalized_email)`; `idx_customers_company_normalized_personal(company_id,normalized_personal_number)`; `idx_customers_company_normalized_org(company_id,normalized_org_number)` |
| 69–72 | `customer_sites` | `idx_customer_sites_company_customer_created(company_id,customer_id,created_at DESC)`; `idx_customer_sites_company_facility(company_id,facility_id)` |
| 74–79 | `metering_points` | `idx_metering_points_company_customer(company_id,customer_id)`; `idx_metering_points_company_site(company_id,site_id)`; `idx_metering_points_company_meter_point(company_id,meter_point_id)`; `idx_metering_points_company_normalized(company_id,normalized_metering_point_id)` |
| 81–86 | `customer_contracts` | `idx_customer_contracts_company_customer(company_id,customer_id,created_at DESC)`; `idx_customer_contracts_company_site(company_id,site_id)`; `idx_customer_contracts_company_customer_site(company_id,customer_id,coalesce(customer_site_id,site_id))`; `idx_customer_contracts_company_metering_point(company_id,metering_point_id)` |
| 88–91 | `customer_import_rows` | `idx_customer_import_rows_company_status_created(company_id,status,created_at DESC)`; `idx_customer_import_rows_company_batch(company_id,import_batch_id,row_number)` |
| 93–95 | `billing_export_runs` | `idx_billing_export_runs_company_status_created(company_id,status,created_at DESC)` |
| 97–103 | `billing_export_run_items` | `idx_billing_export_items_company_run_status(company_id,billing_export_run_id,status)`; `_customer(company_id,customer_id)`; `_site(company_id,site_id)`; `_metering_point(company_id,metering_point_id)`; `_contract(company_id,contract_id)` |
| 105–110 | `ediel_inbound_cases` | `idx_ediel_inbound_cases_company_status_created(company_id,status,created_at DESC)`; `_customer(company_id,customer_id)`; `_site(company_id,site_id)`; `_metering_point(company_id,metering_point_id)` |
| 112–115 | `customer_portal_accounts` | `idx_customer_portal_accounts_company_customer(company_id,customer_id)`; `idx_customer_portal_accounts_user_customer(user_id,customer_id)` |
| 117–120 | `customer_portal_claims` | `idx_customer_portal_claims_company_customer(company_id,customer_id)`; `idx_customer_portal_claims_company_status_created(company_id,status,created_at DESC)` |
| 122–124 | `customer_portal_events` | `idx_customer_portal_events_company_customer_created(company_id,customer_id,created_at DESC)` |

All 31 are ordinary nonpartial indexes. The three source files declare 57 unique index names in total: A9 + B17 + C31. Static repository search found no other declaration of B's or C's names and only the later incompatible same-name A7 declaration described above. That does not prove absence, validity, ownership or shape in the unqueried actual catalog.

### Views, functions, actor and result contracts

`gridex_debug_step1_2_schema_alignment_v` currently has a selected later source-backed shape with 15 literal names, adding `customer_import_batches` (`20260526_debug_step1_2f_customer_import_foundation.sql:239–275`; selected foundation order at `scripts/gridex-aud-003-foundation-order.json:40`). C3 executes after that accepted-prefix source in any append-only continuation and would regress it to 14 rows. A post-C boundary must restore the exact selected 15-name definition, owner, ACL and security options. `CREATE OR REPLACE VIEW` does not itself validate or preserve an intended later body merely because the four output columns remain compatible.

`gridex_get_user_roles(uuid)` at C172–203 returns rows `(role_key,key,code,name)`:

- user-role rows coalesce `roles.key`, `user_roles.role`, then `roles.name` for the first three fields; `name` prefers role name. Rows qualify when supplied `p_user_id` matches and NULL `is_active/status` are treated as active (`C179–188`);
- company-membership rows repeat the first nonempty of `role_key`, `membership_role::text`, `role` into all four fields; NULL activity/status again qualify (`C192–200`);
- `UNION` deduplicates complete four-column rows, but an all-NULL row remains possible; there is no actor, `auth.uid()`, company or role-scope predicate;
- it is SQL/STABLE/SECURITY DEFINER with `search_path=public`. C first drops the known R2 text-array view/function pair at 169–170, so the complete source does **not** have the isolated CREATE OR REPLACE return-type conflict. The source still fails if `pg_depend` contains another dependent. Repeating C works because its predecessor is then the same table-return signature and the recreated view is explicitly dropped first;
- the explicit grant to anon/authenticated/service_role does not revoke default PUBLIC EXECUTE on a newly created function. This reverses the accepted Task9 W private diagnostic boundary (`20260910174947_canonical_user_rbac_repair_boundary.sql:39–56`).

Current callers tolerate text-array/string or table/object role rows: dashboard passes the verified current user and fails closed on RPC error (`app/dashboard/page.tsx:53–80`); permission fallback does the same normalization and also reads active memberships (`lib/rbac/getUserPermissions.ts:56–86,152–185`); the current sole app caller of that permission aggregator is behind `requirePlatformAdminAccess` and supplies the route target user (`app/admin/users/[id]/page.tsx:38–55`). The service-role tenant scope path calls the helper and treats a matching returned string as platform authority (`lib/tenant/scope.ts:63–84`); that result bypasses membership scoping for any requested active company (`lib/tenant/scope.ts:189–225`) and is reused by many write routes/actions. Therefore a membership `role_key` that looks like a platform role cannot be allowed to confer global platform authority. Caller shape compatibility is not authorization compatibility.

`gridex_debug_batch2_rbac_v` at C206–221 exposes all membership/company rows and aggregates role values per membership user. It is recreated without `security_invoker` or explicit ACL. A new view is owner-only by default, but replacement/predecessor ACL state and later blanket migrations still require exact catalog proof. It must remain private unless a separately reviewed diagnostic consumer exists; none was found in app/lib.

`gridex_get_user_permission_overrides(uuid)` at C223–238 returns `(permission_key,effect)` for the supplied user when NULL activity is treated active and the current timestamp is within inclusive nullable bounds. It is SECURITY DEFINER, has no actor/company predicate and no explicit ACL; a new function has PUBLIC EXECUTE. The current app call is only the platform-admin user detail aggregation and suppresses RPC errors (`lib/rbac/getUserPermissions.ts:152–185`; caller above). Company-specific overrides can be merged across tenants because neither this signature nor the caller supplies company scope.

`admin_customer_latest_contract_counts(text,text)` at C240–283 is SECURITY DEFINER with no explicit ACL or tenant parameter. It searches all customers by status or unescaped substring over six fields, selects the latest contract per customer by `created_at DESC NULLS LAST,id DESC`, and returns: one `all` row; one `none` row for customers without a contract; and grouped latest-contract statuses with NULL status coalesced to `none`. Thus two separate `none` rows may occur. `lib/customer-contracts/db.ts:689–731` sums **every** returned total into `counts.all` while also accumulating known buckets; paired with this C body it double-counts the customer population because the explicit `all` row and partition totals are both added. No current app/lib caller of `getLatestContractBucketCounts` was found, so this is a source/interface blocker, not a claimed runtime incident.

`ediel_resolve_message_rule` at C285–336 is SECURITY DEFINER and returns one 13-column row. It matches family case-insensitively; NULL/empty input code means any code, otherwise exact case-insensitive code; standard is case-insensitive with `edifact` coalescing; NULL activity qualifies; direction must exactly equal the supplied value or literal `both`; both inclusive validity bounds apply. It orders `valid_from DESC NULLS LAST, valid_to ASC NULLS LAST, created_at DESC NULLS LAST`, with no ID tie-break, then limits one. An explicitly NULL direction/date behaves differently from omitting defaults. It has no company predicate despite `ediel_message_rules.company_id` in the accepted base schema.

`ediel_resolve_inbound_message_rules` at C338–374 returns seven columns for every case-insensitive family/code/standard match whose activity is true, direction is exactly `inbound`/`both`, and `valid_from` is not in the future. It does **not** reject expired `valid_to` rows, has no limit or ID tie-break, and uses the same date ordering. Both Ediel functions have default PUBLIC EXECUTE when newly created and no explicit grant/revoke. Current code uses `supabaseService` (`lib/ediel/core/versionRegistry.ts:130–171`), bypasses both DB functions for canonical Edifact families, and uses them only for noncanonical/evidence registry paths (`lib/ediel/core/versionRegistry.ts:174–245`). That caller contract requires exact ordering/window tests and a global-versus-tenant rule ownership decision; service-role use alone does not supply a tenant predicate.

The substituted `20260525_debug_fix_batch_1b_schema_code_alignment.sql` is not selected by lexical similarity. It is relevant only to concrete dependencies: it supplied same-signature earlier function bodies (`160–280,493–604,860–939`) and, critically, declares `billing_export_run_items.contract_id` at line 37. The accepted early billing bootstrap supplies `billing_export_run_id` but not `contract_id` (`supabase/bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql:171–231`). The existing derived contract-id artifact is intentionally scheduled for the later 20260716 consumer (`supabase/bootstrap/20260716_billing_export_run_items_runtime_prerequisite.sql:1–39`), so it cannot be silently assumed before C97–103. This exact missing column is the only demonstrated reason to consult 1B; admitting its whole broad body is neither proposed nor implied.

## Coherent next implementation contract

### Dependency order and boundaries

The smallest plausible complete-source group is:

1. **P (logical identity only, not yet CLI-created):** an exact pre-source structural prerequisite for `public.billing_export_run_items.contract_id uuid`, but only if the then-accepted actual-prefix catalog independently confirms the column absent. It must preserve existing rows/defaults/nullability/FKs and may not import the rest of 1B. An actual CLI skeleton and reviewed identity are required before implementation; no timestamp or filename is invented here.
2. **A → B → C:** execute each immutable whole file exactly once, in filename/source order, as separate `-f` inputs within one transaction. A supplies its TGT shape first; B performs guarded/coalesced tenant fills; C then performs its deliberately different metering overwrite and installs the final table-return interfaces.
3. **W (logical identity only, not yet CLI-created):** an immediate context-bound structural/security boundary in the same transaction. W must reject standalone execution and require exact P/A/B/C stage/hash/context/transaction identity.

No source has internal COMMIT, so the existing private owner-held PostgreSQL lifecycle can publish only after W and independent assertions succeed; any error, backend death or failed assertion rolls back the transactional row/catalog effects of P/A/B/C/W together. Sequence advances or another nontransactional discrepancy are not claimed rolled back: either makes the owned target terminal and requires disposal plus reconstruction from the fresh accepted prefix before retry. A mutex must precede fresh catalog admission; acquire deterministic locks on every DML/index/view/function target, referenced parent, enabled trigger write target and discovered dependent. A concurrent writer must not enter between A6 deletion and A7 uniqueness.

W must, at minimum:

- restore the selected 15-name `gridex_debug_step1_2_schema_alignment_v` body and its exact owner/ACL/options;
- keep the C table-return role signature expected by current callers only behind an explicit runtime authorization rule: deny PUBLIC/anon; permit authenticated self lookup and separately proved platform-admin target lookup, plus the exact internal service path; prevent company-membership role text from becoming global platform authority; prove RLS/actor behavior rather than relying on the caller UI;
- make the RBAC debug view private and `security_invoker=true`; remove direct/inherited/column grant paths except its owner;
- deny PUBLIC/anon on the column helper, permission overrides, counts and both Ediel functions. Permission override access must be platform-admin-only or gain an explicit company context; the count function remains service/private until its all-row/caller aggregation contract and tenant scope are resolved; Ediel RPCs may be service-only only after global/null-company versus tenant-owned rule semantics are fixed;
- preserve every A/B/C source-created column/default/nullability and all 57 exact index declarations unless an independently justified forward cleanup explicitly owns a redundant/incompatible result. The TGT global-versus-company ownership decision must determine the final uniqueness contract; no boundary may silently restore rows deleted by A or call the deletion safe;
- account for the later selected `20260611190000_launch_linter_hardening_security_definer_rls.sql:119–143,164–234`, whose caught per-object loops can alter view/function invoker and ACL state. Immediate W success is not final-chain security proof. If that later source broadens an interface, a separate late canonical convergence boundary is required at its real chronological point, with its own actual CLI identity if new.

Task18's native actual63 result must be accepted before that prefix becomes the Task19 execution base. This design declares no new selected count, foundation endpoint, migration timestamp or actual catalog shape.

### Admission and independent before/after oracle

Before SQL, verify immutable pins/lengths, exact P/A/B/C/W order, private regular-file ownership/no symlinks, and the accepted prefix's exact tree. In one fresh READ COMMITTED transaction: take the established database mutex before catalog reads; lock all targets/dependents; then reject any unknown relation kind, column type/collation/generated/identity shape, PK/FK/check/domain, index collision, function return/body/owner/options/ACL, view column/dependency/owner/options/ACL, RLS/policy or enabled trigger/rule. Specifically require `pg_depend` to show C4 removes every actual dependent needed before C5; unexpected dependents block implementation rather than invite CASCADE.

Build expected results independently of W and compare exact fields/PKs with bidirectional `EXCEPT ALL`, not counts/hashes alone. Snapshot and compare:

- all rows in the 19 distinct A/B/C DML targets, every referenced parent, every trigger-written audit/history/job/outbox table, and every table reached by incoming FK actions from TGT rows;
- attributes by ordinal name/type/type modifier/collation/nullability/default/identity/generated state; table owner/RLS/FORCE RLS/ACL; PK/FK/check/exclusion/unique definitions and validation/deferrability;
- all 57 index declaration identities by table, ordered expression/key, ASC/DESC/NULL ordering, collation/opclass, included columns, predicate, uniqueness, validity/readiness, ownership tablespace and expected first/repeat identity, including expected absence, a preserved preexisting alternative and guard-skipped branches; the mutually exclusive B metering alternatives must not both be required, and no same-name/wrong-shape object may satisfy `IF NOT EXISTS`;
- the six functions and two views affected by B/C, including identity arguments, OUT/result columns, body, volatility, language, security mode, config/search path, owner, complete direct/inherited EXECUTE/SELECT paths and dependency OIDs;
- every implicated sequence's complete state, including `last_value/is_called`, even though these sources have no explicit `nextval` DML; defaults or triggers may consume values.

Required meaningful cases are:

1. **A populated behavior:** legacy payload empty/nonempty and already parsed rows; same-company, cross-company, active/inactive and NULL-role duplicate groups; NULL/equal timestamps and UUID tie-breaks; base four-key constraint interaction; incoming FK RESTRICT/NO ACTION, CASCADE/SET NULL and UPDATE/DELETE trigger effects. Prove A6's NULL grouping separately from A7's NULL-distinct uniqueness. Unsafe cross-tenant/active-state loss is rejected or rollback-only native characterization, never accepted cleanup.
2. **B/C backfills:** at least one dirty and one already-populated row for every B branch and every C branch; missing/null parents; conflicting child/parent company/customer IDs; B metering preservation versus C metering overwrite; parent-company NULL; enabled trigger mutations/side writes; outgoing FK/check failures. Compare every PK and changed field, including C's conditional timestamp fills.
3. **Guard/native catalog behavior:** absent guarded relations; present relation with each guard-covered column missing; present relation with an unguarded time/join/expression column missing; wrong types/operator classes; same-name wrong index shape/invalid index; B metering with `read_at`, without it but with `created_at`, and with neither. C's missing `billing_export_run_items.contract_id` must fail in a rollback-only native characterization and pass only through admitted P.
4. **Role/override actors:** current-user, other-user, anon, authenticated, service and inherited-grant paths; active/inactive and NULL status flags; multi-company membership; company membership containing a platform-looking `role_key`; platform-admin inspection of a target user; cross-company permission overrides. Confirm dashboard failure closes, and `assertUserCanOperateCompany` never upgrades membership-only input to global access.
5. **Counts:** no-contract, NULL-status and every known/unknown latest status; ties and NULL contract times; filters containing `%`/`_`; two companies; explicit `all` plus partition rows and duplicate `none` rows. Pair the native C output with `lib/customer-contracts/db.ts:719–729` to expose the double-count contract; lack of current reachability does not waive it.
6. **Ediel rules:** current/expired/future windows; inbound/outbound/both and NULL/case variants; empty/NULL/exact message code; standard/default/explicit NULL inputs; equal sort keys; global and two-company rules. Verify canonical Edifact caller bypass and noncanonical/evidence use independently. No tenant-owned rule may be selected across company boundaries.
7. **Atomicity/repeat/concurrency/cleanup:** first run and exact repeat; failures after each A/B/C stage and inside W; backend death before release; DML writer and index/dependency lock contenders with observed native outcomes; no partial drop/function/index/data publication; canary database untouched; private logs/fixtures removed and owner-held handle released only after full comparison.

Use the approved private owned-database transport, allowlisted receipts and existing catalog/oracle formats. Whole sources remain separate exact inputs; fixtures and P/W are additional controls, not replacements. Do not regenerate types, query production, create provider identities, use customer data, claim official native CLI ledger behavior, or run the original 19/102 matrices merely to mirror this document. Exact actual native catalog shapes, trigger/dependent graphs, TGT ownership, safe runtime helper predicates, count semantics and Ediel rule ownership remain explicit implementation blockers until the cases above pass.
