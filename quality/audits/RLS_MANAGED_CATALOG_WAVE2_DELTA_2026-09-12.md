# Task 11b — managed catalog wave 2 delta

Status: **Required policy-helper and mandatory sink paths closed by current observations; one finite parent-key metadata edge remains before faithful fixture reconstruction.** Native behavior is not verified. The intended 100 CRUD / 18 relationship contract cannot be treated as a blanket positive oracle. This report performs read-only preparation and changes no implementation, source admission, database, memory, or index. Runtime-to-database binding remains UNPROVED.

## Receipt pin and coherence

Input: `quality/audits/RLS_MANAGED_CATALOG_WAVE2_2026-09-12.json`, **1,174,816 bytes**, SHA-256 **`0f798ee90026d898f3e2afc3a05c6da2404aeaf2ee15e209f4f3bf99f29d11f4`**. Status is OBSERVED_CURRENT_MANAGED_CATALOG_WAVE2_WITH_NONADMITTED_SEQUENCE_NUMBERS. The original 1,173,999-byte / `3c3ed1abced57cfa39d7563df7c04e44342c8023f3bca25ff3bc0b7606af602a` file has been superseded by this annotated receipt. Catalog observations were preserved; the annotation excludes rounded sequence configuration numbers from admission.

Separate exact sequence receipt: `quality/audits/RLS_SEQUENCE_TEXT_OBSERVATION_2026-09-12.json`, **1,958 bytes**, SHA-256 **`de78e5e55e68765580700e513d5f5c9a34a6956837f4d8b85ac480ffc634ecbd`**; observed `2026-09-12T10:02:49.555187+00:00`. This is a later SELECT, with the same project/database/server/ledger identifiers, not part of the earlier single-statement snapshot.

Wave 1 reference: `quality/audits/RLS_MANAGED_CATALOG_WAVE1_2026-09-12.json`, 3,537,639 bytes, SHA-256 `8cdca9cf1e6a67a9b4870d00e654eceab3f5d00902cb6c5dad16d53efe672c48`. The completed wave-1 report is 29,705 bytes / `cbf0ef9f0396b3929c43f9b44299e86b44ccbb1736805fbc4edb3c7272abc1d5`.

Wave 2 observation: outer catalog `2026-09-12T09:58:49.391332+00:00`, embedded prior-critical projection `2026-09-12T09:58:48.754112+00:00`, same SELECT. Both share project piidsfebjqjmnepdpnas / gridex-ops-dev, PostgreSQL 17.6, database postgres, ledger 279 / tail 20260904222450. Multiple clock_timestamp values in that statement do not mean separate observations.

The prior-critical projection compares exactly with wave 1, omitting observation time and selecting the same ten tables/field sets. Canonical UTF-8 JSON with sorted object keys, compact separators, ensure_ascii=False and original array order hashes to `2053c6f235f90d2d9da33ceb0d481aac8b16e2006d6f8503758268b58aa12d72`, unchanged. This includes all 110 policies, classifications, role/membership/default ACL metadata and the prior ten table/column/schema ACL observations. No catalog drift was found in that projection; no historical or continuous-runtime conclusion follows.

All 119 root FK records compare field-for-field with the twelve wave-1 root tables' constraints: names, OIDs, child/parent columns, referenced index, definitions, actions, match type, validation and deferral. Their 37 external-parent FK edges map exactly to the requested twenty parent projections, with unchanged current/observed OIDs, qualified public names, referenced-column types and nullability. All 21 supplied referenced indexes are valid, ready, unique and unfiltered/unexpressed. Referenced key column sets match; retain the actual recorded key order and FK order rather than sorting either. Physical parent_key_metadata order is not FK semantic order.

Wave 2 contains eleven requested full relations, zero missing relations, 45 direct function records, 22 noninternal trigger bindings, 982 relation-object dependency edges, 62 function dependency records, four namespace ACL records, and one sequence metadata record. All 21 function records that overlap wave 1 are exactly equal, including definition and ACL. Ten requested helper signatures are present; the deliberate public.digest(text,text) masking probe is absent. All rule lists are empty; no new inbound-FK expansion was requested (all eleven new relations have test_root=false).

The embedded query remains a catalog-only, finite SELECT: eleven names; ten helpers plus one masking probe; explicit customer_number_seq metadata; the twenty parent projections; exact 119 root-FK recheck; the prior-critical projection. Direct functions are collected by name or dependency/trigger OID. No customer/auth-assignment rows, custom function invocation, sequence values, DDL or DML occur in this assessment. The sequence annotation excludes a transport precision failure; a separate later text-valued observation supplies usable configuration without changing the original numeric observation.

## Eight required callees: actual closure

| Signature / OID | Observed behavior and privilege boundary | New reached objects |
|---|---|---|
| public.gridex_normalize_platform_role(text), 179573 | Immutable SQL, invoker; normalizes the explicit super_admin/platform_admin aliases, otherwise lower(trim(value)); NULL becomes empty string. Authenticated/service execute; anon does not. | None |
| public.gridex_get_user_permissions(uuid), 19281 | Stable SQL SECURITY DEFINER owned by postgres; role-based permissions require active assignment and either a normalized global platform role or an active company membership; direct user_permissions are unioned; explicit admin_users adds admin.access. Only postgres/service have direct EXECUTE. Existing SECURITY DEFINER has_permission wrapper runs as postgres. | All reads already in wave 1; normalize_platform_role is now observed |
| public.gridex_assert_same_company(uuid,uuid,text,text), 67738 | Invoker, not strict; raises 23514 only when both company IDs are nonnull and unequal. It neither rejects a missing parent company nor performs a parent lookup. PUBLIC/auth/service/anon execute. | None |
| public.gridex_refresh_customer_process_summary(uuid,uuid,text), 346244 | Invoker, volatile; counts active sites by onboarding status and updates customers counts, action, process_summary, intake_status, next_action, updated_at. Only postgres/service have EXECUTE. | Reads customer_sites and writes customers, both in wave 1; downstream root triggers already inspected |
| private.gridex_normalize_fixed_area_snapshot_v1(jsonb), 345219 | Immutable SQL, invoker, search_path pg_catalog; rebuilds JSON arrays for selected fixed price area; no table access. Only postgres EXECUTE. Root snapshot-normalizing trigger wrappers are SECURITY DEFINER postgres, so caller's missing private access does not itself block that path. | None |
| public.gridex_add_months_timestamptz(timestamptz,integer), 38685 | Stable SQL, invoker, not strict; explicit NULL-date/NULL-month return NULL; nonpositive months return original timestamp; otherwise month/day calculation in UTC. PUBLIC EXECUTE. | None |
| extensions.digest(bytea,text), 16449 | pgcrypto 1.3 C function, immutable, strict, parallel safe, PUBLIC EXECUTE; used by invoice reference and snapshot hash. | Exact extension implementation metadata; no SQL custom callee |
| extensions.digest(text,text), 16448 | Same extension/attributes; used by contract tenant snapshot. public.digest(text,text) is absent, extension schema USAGE is available. | None beyond pgcrypto |

The resolver has no user_permission_overrides read and no explicit company argument; direct user_permissions apply through its union. A platform-admin fallback grants admin.access, not every permission. Tests of site/metering masterdata.write must use an explicit synthetic permission assignment when that branch is intended; do not treat platform identity as an implicit universal grant. This describes the observed current resolver, without changing or declaring equality to selected historical source.

The date helper is actually called twice on draft contract writes even with NULL dates, and safely returns NULL for those arguments. The private normalizer is actually called for ordinary nonnull snapshots; retaining the real SECURITY DEFINER wrapper preserves its privilege context. No required callee in this table has dynamic SQL or an unobserved custom callee.

## Site path: closed metadata reveals a real permission boundary

The site trigger wrapper 346247 is SECURITY INVOKER and calls helper 346244 unconditionally for its firing events. The helper is also invoker and authenticated EXECUTE is false. Therefore an authenticated site INSERT or DELETE that reaches this AFTER trigger has a catalog-supported 42501 permission-error path, even with valid tenant references, explicit public reference, active tenant and masterdata.write. A platform admin acting as the authenticated database role is also subject to that helper ACL. This is **catalog reachability evidence**, not a native reproduction or authority to change grants.

A neutral site UPDATE that does not name onboarding_status, next_action, is_active or status avoids that summary trigger. Avoid address/geography columns too; explicit null address_hash is the earlier reliable gate for provisional geography. An UPDATE explicitly naming a listed column can activate the summary trigger even if the value is unchanged. Authenticated direct customer UPDATE of intake_status/next_action similarly reaches helper 346244 through invoker wrapper 346249 when trigger depth <2; it has the same ACL boundary. A neutral customer UPDATE avoids it.

For service/owner summary execution, the helper's customer UPDATE invokes the customer's ordinary operational/audit triggers. The reaggregation trigger sees nested trigger depth >=2 and returns without reentering the helper. No missing table, function or write sink remains on that declared path. Capture resulting customers.process_summary and audit rows for successful service operations. For the failing authenticated statement, assert rollback of target changes and earlier audit rows; an AFTER trigger exception does not commit those prior effects.

Native tests should distinguish missing masterdata.write/RLS failure before the trigger from the specific helper EXECUTE failure after admission. Do not broaden a grant or switch the test to service_role merely to manufacture the authenticated positive control.

## Mandatory sink closure

| Sink | Actual schema, access and trigger closure | Fixture consequence |
|---|---|---|
| public.masterdata_audit_log, 18046 | Eight columns; required entity_type/text, entity_id/uuid, action/text; UUID and created_at defaults; action allows insert/update/delete. Only FK 18056 points performed_by to already captured auth.users. No custom triggers or rules. Owner postgres; RLS on, FORCE off; table ACL grants authenticated/service all, anon none; sole authenticated SELECT policy checks masterdata.audit.read or masterdata.write. | Actual log_masterdata_change 18063 is SECURITY DEFINER postgres and inserts without requiring an authenticated INSERT policy. Seed synthetic auth.users for actor FK; capture audit contents under owner to assess sink behavior, without claiming caller SELECT access. |
| public.power_of_attorney_scopes, 43003 | Seventeen columns; required company_id, power_of_attorney_id, scope_type/default customer, status/default active, UUID/timestamps. Actual schema has only customer/company FK 357204; do not invent a PoA or site FK because column names suggest one. Unique index 357426 covers company_id,power_of_attorney_id,scope_type. | Draft PoA materializer's invoker UPDATE has actual table UPDATE/SELECT access and matching authenticated permissive policies plus lifecycle restrictions. An empty matching scope set remains a legitimate zero-row UPDATE. |
| Scope audit → audit_logs | One custom scope trigger 43184, AFTER I/D/U, calls previously captured 42266 critical audit; audit_logs then calls previously captured 192996 normalization. All definitions and ACLs are pinned and unchanged. | If a same-PoA synthetic scope is intentionally seeded, materializer's UPDATE deactivates it and produces an audit row. Capture that row; otherwise assert no matching scope/no audit write. No further sink closure is required. |

Six full support relations whose records may be read/seeded on the proposed path (the two sinks, tenant_legal_profiles, company_email_settings, domain_events, webhook_subscriptions) have all reached custom behavior closed or explicitly no tested writes. Keep tenant_legal_profiles and company_email_settings empty in fixture state if the intended contract INSERT tests fallback to companies data. Their optional seed/maintenance triggers are not exercised by an empty-table read.

The required webhook parent rows are now constructible from observed columns/checks: subscription needs company_id, name, HTTPS endpoint, and explicit public subscription reference; domain event needs company_id, a dotted event_type, aggregate_type and aggregate_id. Both have no custom triggers. Keep api_client_id/actor/subject references NULL unless deliberately testing them. A subscription API-client FK still needs its actual parent key metadata below to preserve its declarative definition.

## Exact remaining input: one parent key projection

**public.integration_api_clients** is the sole new missing relation identity/key on the declared root execution/support-parent profile. Provenance: public.webhook_subscriptions constraint **59216**, `webhook_subscriptions_api_client_id_fkey`, `FOREIGN KEY (api_client_id) REFERENCES integration_api_clients(id) ON DELETE SET NULL`, parent relation OID **47634**, referenced unique index OID **47649**, parent column **1 / id uuid NOT NULL**.

Collect only its qualified relation identity, current OID, owner/schema metadata, referenced id column type/nullability/collation, and the actual index 47649/associated unique constraint definition with key order, opclasses, collations, predicate/expression, validity/readiness/uniqueness. Verify constraint 59216 still resolves to it. No full API-client shape, rows, secret-bearing columns, trigger definitions or transitive graph is required: declared subscription api_client_id is NULL and no operation writes this parent.

The prior empty-parent projection convention remains explicit: preserve every tested root FK plus reached support FKs, but do not claim whole managed-catalog equality. Other new full relations collected solely for contract/quote/resolution composite row types are empty type prerequisites, not new CRUD test roots. Their unrelated trigger and FK graphs do not enter the root profile merely because wave 2 retained full metadata. If an implementer elects to exercise their rows or restore/test every constraint of every collected auxiliary table, that is an expanded fixture scope and requires its own finite dependency admission. Do not silently expand or silently describe a projection as full schema equality.

## Sequence metadata: precision failure and separate usable receipt

Wave 2 numeric seqmax is 9223372036854776000, beyond the int8 maximum; the original connector result string already contains that rounded number. It cannot be repaired losslessly by reparsing in JavaScript or Python. Do not infer, replace or admit it as the original database value. The current wave-2 status/boundary annotation correctly leaves these sequence configuration numbers nonadmitted.

The separately pinned 10:02:49 text-valued SELECT casts every pg_sequence bigint field to text before JSON construction. It observes public.customer_number_seq, OID 33827, owner postgres, type OID 20, start **"100000"**, increment **"1"**, min **"1"**, max **"9223372036854775807"**, cache **"1"**, cycle false. Name/OID/owner/ACL/type and all other configuration fields agree with wave 2; only the unusable rounded max differs. This closes exact configuration metadata at the later observation time. The raw ACL grants postgres, anon, authenticated and service_role rwU; wave 2's effective-access rows report USAGE/SELECT/UPDATE true for all four. No current sequence value, last_value, is_called, nextval/currval/setval was read.

Use the separate text strings for configuration admission, retaining its separate timestamp/hash. A synthetic counter start remains fixture state and says nothing about the managed sequence position. Any future catalog query should cast bigint configuration fields to text at the SQL boundary; no further sequence lookup is required by this report.

## Optional numbering and deferred setup remain outside the profile

| Observed optional function | Newly exposed edge | Why it is not a required next-wave input |
|---|---|---|
| gridex_next_customer_number(uuid), 59159 | Calls public.gridex_default_customer_number_prefix(uuid); reads existing customers; inserts/updates public.company_customer_number_sequences | Explicit nonblank customer_number bypasses the assigning trigger branch. Do not collect the prefix helper/counter-table shape unless automatic numbering is added to the fixture. |
| gridex_next_contract_number(uuid,text), 66265 | Calls public.gridex_next_document_number(company_id,'contract',customer_number) | Explicit nonblank contract_number bypasses this branch. Its likely uuid,text,text signature must be confirmed from a requested observed lookup if this optional path is admitted; do not invent the body. |
| customer-number default, wave-1 function 33828 | Uses observed public.customer_number_seq via nextval | Explicit customer_number bypasses the default. Sequence metadata admission permits faithful installation; no real current counter or generated identifier was read. |

The eight required functions now expose **zero missing custom callees** on the declared root profile. Both mandatory direct sink schemas and the mandatory indirect summary sink close. The earlier one fixed-literal dynamic SELECT in the session helper remains the only dynamic SQL on these reached paths; it targets already captured user_profiles with a bound uid. There are zero unresolved dynamic target expressions on inspected reached paths. Missing optional numbering and branch/setup helpers remain explicitly unresolved outside that claim.

Company onboarding, admin-user seed audits, partner event emission, signed-contract orchestration, verified postal learning, legal publication, and website terms reconciliation retain the prior report's exclusions. Owner-seeded fixture state must be declared as construction of a database state, not proof that production onboarding INSERTs succeeded. Retain actual root triggers and ACLs for every tested command. No maintenance/skip GUC, blanket grant or replacement helper is authorized by this report.

## Authoring decision

A source-pinned observed-state fixture design can proceed with the current policy/helper/sink evidence, including expected regressions; **faithful reconstruction is not yet declared ready** until the one API-client parent key projection is admitted. Accordingly, no separate ready-to-author fixture brief is issued in this bounded assessment.

After those finite inputs, keep the 100 CRUD / 18 relationship cases indexed to the original contract while recording actual current oracles: table ACL denial, RLS denial/zero rows, invoker-hidden-parent 23503 versus visible-company-mismatch 23514, immutable P0001/55000, public-reference-default 42501, and the newly closed site-summary ACL 42501. Same-tenant INSERT positives must use actual legal required columns and explicit references/numbers; their inability to succeed under an observed ACL is a result to expose, not a fixture defect to hide. Native execution must establish actual first-error ordering and row/sink atomicity before any fix or acceptance claim.

No observed body is installed into historical source admission. The managed dev receipts do not prove production identity, original transform ACLs, historical default grants or native 77 acceptance. Current source and candidate work remains untouched.

## Required definition pins

Hashes below are SHA-256 of the exact UTF-8 pg_get_functiondef strings in wave 2, including final newlines. ACL/owner/security metadata is separately pinned by the full receipt SHA. C function definitions identify library symbols, not SQL implementations.

| OID | Signature | Definition SHA-256 |
|---|---|---|
| 16448 | extensions.digest(text, text) | ab7a61f8768189dc1783433785f02808cfb17a200faa4ce270284f76e0156226 |
| 16449 | extensions.digest(bytea, text) | 53b6c34c27c86e4466e4b562104d9cac51febbc1bbadafa2c5d1a7ac81d015b3 |
| 19281 | public.gridex_get_user_permissions(p_user_id uuid) | e881450787cecc76aaefde63d302e32820294a04acf24a776ccfc026d2f9b453 |
| 38685 | public.gridex_add_months_timestamptz(base_value timestamp with time zone, months_int integer) | d996cdbd9e6b8ed2a148193aca138a048e12eb7dfbd445618f0ab7d7c3dfe978 |
| 67738 | public.gridex_assert_same_company(p_child_company_id uuid, p_parent_company_id uuid, p_child_table text, p_reference_column text) | d43794288c66ada107329aa50c88e66c03c9367d5a268a6469e9be74aa7a939a |
| 179573 | public.gridex_normalize_platform_role(p_role text) | e3f2ba068b2d5beff1ea7bc4f3bbff680bae1e816c75f5a1e315e5bb4b010763 |
| 345219 | private.gridex_normalize_fixed_area_snapshot_v1(p_snapshot jsonb) | 41fd39395d4cb81ace7335e2f86fb83f95e94fd5a48a8097b65a5b5ab8e4b68c |
| 346244 | public.gridex_refresh_customer_process_summary(p_company_id uuid, p_customer_id uuid, p_latest_action text) | f7927f45c556dd9bc45c6d3867a3a6aa8b8820f597d541495676efc2f16e2cfa |
