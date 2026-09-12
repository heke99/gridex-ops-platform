# Task 11b — managed catalog wave 1 delta (read-only preparation)

Status: **BLOCKED for admitted whole current-policy CRUD execution; READY for a finite second metadata collection.** No database query, native fixture execution, implementation, source replacement, or historical acceptance occurred in this assessment. This report concerns the connected development catalog only; runtime-to-database binding remains UNPROVED. Preserve Task 11c and the selected-source historical lane unchanged.

## Receipt and coherence

Input: `quality/audits/RLS_MANAGED_CATALOG_WAVE1_2026-09-12.json`, 3,537,639 bytes, SHA-256 `8cdca9cf1e6a67a9b4870d00e654eceab3f5d00902cb6c5dad16d53efe672c48`. Observed `2026-09-12T09:41:32.785612+00:00`; project `piidsfebjqjmnepdpnas` / `gridex-ops-dev`, PostgreSQL 17.6, database postgres; ledger 279 / tail 20260904222450.

Project identity and ledger agree with the 09:20 ACL and 09:29 policy receipts. Every field present in the 09:29 catalog, excluding observation time, compares structurally equal after projecting wave 1 tables to those earlier ten tables and their earlier field sets. Canonical UTF-8 JSON, sorted object keys, compact separators, original array order, ensure_ascii=False, SHA-256 of this complete shared catalog projection: `2053c6f235f90d2d9da33ceb0d481aac8b16e2006d6f8503758268b58aa12d72`. This is a larger projection than the earlier ACL-only fingerprint; do not compare those unlike digests.

Thus all 110 policies (70 permissive, 40 restrictive), ten classifications, 31 roles, 22 membership edges, 24 default ACL entries, and the prior ten table/column/schema ACL observations are unchanged. This proves observation coherence, not an unchanged database between SELECTs or historical transformation inputs.

Wave 1 contains exactly the requested 24 relations, zero missing relations, 104 direct function records (95 definitions and nine pg_catalog RI-function metadata records), 95 noninternal trigger bindings across the 24 relations, 2,963 one-hop dependency edges, 343 inbound FK definitions to the twelve test roots, zero selected sequences, and twelve built-in pg_catalog column types. All relation rule lists are empty. Types: _text, bool, date, int2, int4, int8, jsonb, numeric, text, timestamptz, uuid, varchar.

The embedded SELECT has the finite 24-name relation CTE; twelve test-root flags; the eight previously requested policy signatures; catalog objects from those relations; one-hop pg_depend references; functions from those references and all their trigger bindings (including internal FKs); types from actual columns; owned/default-dependent sequences; and inbound FKs whose referenced relation is one of the twelve roots. It reads catalog metadata, current classification records, and migration-ledger aggregate metadata. It does not invoke the collected custom functions, select customer/auth assignment rows, read sequence values, or mutate anything. The large inbound FK section is evidence retention, not authorization to expand all 343 edges.

## Proposed finite fixture profile

The following is a reviewable scope proposal, not an already admitted or executed fixture. Use explicit synthetic IDs, owner-seeded actor/tenant state, disjoint root rows for DELETE and relationship cases, and current role/ACL/policy definitions. Actor/company setup is fixture state construction; do not claim its setup INSERTs exercise the production onboarding trigger graph. If setup INSERTs must run with all support-table triggers active, collect their separate seed closure before execution. Never disable root triggers or use maintenance GUCs to turn a negative into a positive.

- Ordinary customers: non-partner metadata and explicit customer_number/customer_reference. Sites: draft consumption, country SE, explicit facility_reference, null address_hash/resolution_id, unverified resolution, no grid owner, and updates to a harmless field that does not name address/geography/materialization columns. Metering points: draft, matching site/customer/company, valid identifier. Retain all actual BEFORE/AFTER triggers for tested statements.
- Contracts: unsigned/unlocked draft, source manual, explicit customer_number/contract_number/customer_contract_reference, no offer/product/publication/quote/legal/price-plan bindings, no signing transition; use a neutral UPDATE. This passes the inspected early branch gates but does not yet prove a valid INSERT: missing callees, row types and support reads remain below.
- Underlays: pending, no export/portfolio bindings, nonnegative amounts; relationship cases deliberately set only their specified customer/contract/site/metering references. Invoices: draft/nonportfolio, no export-item or underlay link unless expressly tested; supply required partner reference. Their invoice_reference is overwritten by the actual digest trigger. Lines need real same-tenant invoice_id and description.
- PoA: draft, non-website/non-partner source, empty signed scope array and legal references; explicit public reference. **Draft still executes UPDATE against power_of_attorney_scopes**; it is not a no-side-effect branch. Legal acceptances: website source, allowed acceptance_type, no application/document evidence. Snapshots: real draft contract, non-v6 selection schema, snapshot JSON and actual normalizer/hash trigger.
- Webhooks: queued, real synthetic subscription and domain event parents, unique idempotency key. Their nonnull FKs make those parent shapes mandatory.

These choices cover permission and the specified relationship axes without claiming coverage of signed-contract orchestration, commercial publication, address resolution, partner dispatch, legal capture, or company onboarding. SQL column-target lists matter: BEFORE/AFTER UPDATE OF triggers fire because a column is named, even if its value is unchanged. Assert the selected branches and generated columns in the fixture specification. Do not infer skipped branches merely from empty JSON: the provisional-site trigger has nullable comparisons; the explicit null address_hash early return is the reliable gate.

## Actual root behavior and blockers

| Path / observed function OID | Evidence and consequence |
|---|---|
| Policy helpers 41367 / 19282 | Platform-admin helper calls missing public.gridex_normalize_platform_role(text); gridex_has_permission calls missing public.gridex_get_user_permissions(uuid). Core role tables were collected, but resolver implementation and its transitive reads are not yet closed. Current bodies are observations, not replacements for admitted source. |
| Relationship guards 67756–67762 | Seven actual wrappers call missing gridex_assert_same_company(uuid,uuid,text,text). Parent reads are invoker reads; a hidden parent can produce NULL or not-found before declarative FK rejection. Snapshot wrapper 67759 explicitly raises 23503 when the contract is not visible. Do not assume all foreign-reference cases return 23514. |
| log_masterdata_change 18063 | Site and metering-point I/U/D insert into public.masterdata_audit_log. Missing sink shape/ACL/triggers is mandatory closure even with simple rows. Actor comes from auth.uid(). |
| Site summary 346247 | Site INSERT/DELETE and listed status UPDATE call missing gridex_refresh_customer_process_summary(uuid,uuid,text). It can write beyond the observed root; return value/sinks remain unknown. Customer legacy-state UPDATE 346249 reaches the same helper below trigger depth 2. |
| PoA materialization 357427 | For status other than signed, UPDATE power_of_attorney_scopes deactivates active rows for that PoA and returns. This is invoker, so scope-table privileges/RLS matter even when no row matches. Signed website branch additionally upserts scope rows; it is outside the proposed profile. |
| Contract normalization 345220; snapshot normalization 345222 | Both call missing private.gridex_normalize_fixed_area_snapshot_v1(jsonb) on nonnull snapshots. Security-definer wrappers do not justify substituting a no-op normalizer. |
| Contract auto-renew 38739 | Calls gridex_add_months_timestamptz(timestamptz,integer) twice unconditionally after early validations, including draft/null-date rows. Need actual strictness/body/ACL. |
| Contract tenant snapshot 137418 | Draft INSERT still reads tenant_legal_profiles, companies, company_email_settings and calls unqualified digest(text,text), with search_path public,extensions,pg_temp. Missing first/third relation shapes and extensions.digest(text,text) metadata. Empty support tables are legitimate synthetic state only after their observed schema/ACL is admitted. |
| Contract offer/publication/quote wrappers 330630,139592,137216,137478,192429; snapshot quote 231129 | Draft null references skip their queries, but DECLARE uses contract_offers, contract_publication_versions, contract_product_versions, website_contract_quotes composite types/%rowtype. Collect actual row shapes to install/compile the actual functions; do not replace types with invented records. |
| Site resolution wrapper 344993 | Declares public.customer_site_resolution%rowtype. Proposed neutral UPDATE avoids activation, but full observed trigger-function installation needs the actual type. |
| Invoice reference 341232; snapshot hash 346637 | Both call extensions.digest(bytea,text), not the text overload used by tenant snapshot. Invoice BEFORE INSERT sets the reference regardless of supplied value. Collect both exact overload metadata and extension ownership/dependency information; never execute them remotely. |
| Public resource reference 249968 | auth effective EXECUTE is false; service true. Four direct defaults (customers, sites, contracts, PoA) invoke this helper. Omitting a reference can fail 42501 before policy/trigger acceptance. Explicit valid references exercise a different declared INSERT shape, not a repair to observed grants. |
| Customer number default 33828 | Calls nextval('public.customer_number_seq') inside the function. Zero sequences in wave 1 only means no selected owned/direct-default dependency. It does not prove absence of this sequence or its effects. Explicit customer_number avoids this default. |
| Number triggers 139082 / 345211 | Missing next_customer_number(uuid) and next_contract_number(uuid,text) are conditional on blank values; supplying nonblank numbers bypasses them. Collect as a finite diagnostic extension if default/automatic-number paths are included. |
| Critical audit 42266 → normalize 192996 | Definite insert into already collected audit_logs for six audited root families. The audit trigger obtains actor from NEW/OLD row fields, not auth.uid(); normalize fills system actor/request/correlation/resource fields. Capture audit sink rows in the result oracle; do not compare only the target row. |
| Invoice-underlay 348033 | Early return when billing_underlay_id is null; when included, updates billing_underlays and invokes its normal triggers. Export lookup needs invoice_export_items only when export item is nonnull. |
| Legal/snapshot immutable 66638 / 132511 | Legal acceptance UPDATE/DELETE always raises a default P0001. Snapshot UPDATE/DELETE raises P0001 unless maintenance GUC is on. Keep it off. Current whole-trigger relationship tests cannot reuse an isolated all-positive UPDATE oracle. |

Authentication SQL reads request.jwt.claim.sub/role first, with claims JSON fallback. Session helper 41365 has one EXECUTE, with a fixed literal query against public.user_profiles and a bound uid; its disabled_at column is present in wave 1. Missing profile/status semantics remain exactly those in its observed definition; do not invent stricter actor requirements. Trigger function EXECUTE ACL is not a fresh per-row authorization gate; distinguish it from invoked helper/default function privileges.

## Exact second-wave allowlist

Collect metadata only, in one coherent receipt if practical, retaining same identity/ledger and prior policy/ACL projection. Return explicit missing-name/signature arrays. Functions are identified by qualified signature, not just name; include owner, language, security-definer, config/search_path, strictness, volatility, parallel/leakproof, raw and effective EXECUTE ACL, pg_get_functiondef and direct catalog dependency/extension records.

### Eight required function signatures

| Exact signature | Provenance |
|---|---|
| public.gridex_normalize_platform_role(text) | 41367 platform admin; also 303934/356778 role guards |
| public.gridex_get_user_permissions(uuid) | 19282 gridex_has_permission |
| public.gridex_assert_same_company(uuid,uuid,text,text) | 67756–67762 relationship wrappers |
| public.gridex_refresh_customer_process_summary(uuid,uuid,text) | 346247 site summary; 346249 customer reaggregation |
| private.gridex_normalize_fixed_area_snapshot_v1(jsonb) | 345220 / 345222 snapshot wrappers |
| public.gridex_add_months_timestamptz(timestamp with time zone,integer) | 38739 unconditional date calls |
| extensions.digest(bytea,text) | 341232 invoice reference / 346637 snapshot hash |
| extensions.digest(text,text) | 137418 unqualified digest resolved through its declared extension search path; verify no earlier public overload masks it |

For the last row, collect candidates public.digest(text,text) as an explicit existence/absence assertion too; do not silently presume function search-path resolution. Extension functions may be LANGUAGE c: collect their exact metadata/dependency/version; do not pretend their shared-library implementation is a SQL source body.

### Eleven full relation shapes

All names below are public. Collect the same columns/generated/defaults, owner/schema and table/column ACLs, effective privileges, policies/RLS, constraints/indexes, rules, triggers including enabled state, direct trigger/default/check/index-expression functions, and applicable sequence/type metadata as wave 1. This is one hop, not recursive expansion.

| Relation | Provenance / reason |
|---|---|
| masterdata_audit_log | 18063 direct I/U/D audit sink |
| power_of_attorney_scopes | 357427 direct draft-PoA UPDATE sink; also relevant child of PoA |
| tenant_legal_profiles | 137418 unconditional draft-contract read |
| company_email_settings | 137418 unconditional draft-contract read |
| webhook_subscriptions | webhook_deliveries FK 47621, nonnull subscription column |
| domain_events | webhook_deliveries FK 47626, nonnull event column |
| contract_offers | declared row type in 330630/139592; root FK |
| contract_publication_versions | declared row type in 137216/137478 |
| contract_product_versions | declared row type in 137216/137478 |
| website_contract_quotes | declared row type in 192429/231129 |
| customer_site_resolution | declared row type in 344993; metering FK |

For DELETE positives, use isolated target rows that are not parents of the synthetic relationship graph. Retain all 343 inbound definitions in evidence. Collect a further child shape only if this declared fixture inserts a matching child, a required helper writes one, or its positive DELETE deliberately tests a cascade/SET NULL/restriction. Neither the existence of an incoming FK nor its CASCADE action alone implies a populated child in synthetic state. A projected fixture must explicitly document omitted empty child relations; it cannot claim full managed-catalog equality.

### Finite root-FK key metadata, without child-graph expansion

The twelve roots have exactly twenty external FK parent relations absent from wave 1. Existing constraints contain parent key column type/not-null metadata, but not complete parent-index/schema identity. To retain every root FK in a projected fixture, collect actual qualified identity plus only referenced-column metadata and referenced unique-index/constraint definitions (including key order, opclasses, collations, predicates/expressions and validity). Do not fabricate parent uniqueness. Eleven full shapes above cover four of these parents; the other sixteen only need this compact empty-parent projection unless a fixture path uses their rows.

| Parent (public schema) | Observed relation OID | Exact originating constraint OIDs |
|---|---|---|
| consumption_profiles | 48361 | metering_points: 48447 |
| contract_offers | 33831 | customer_contracts: 33880 |
| customer_onboarding_legal_snapshots | 139191 | powers_of_attorney: 139229 |
| customer_site_resolution | 60835 | metering_points: 140248 |
| domain_events | 47493 | webhook_deliveries: 47626 |
| grid_owner_data_requests | 33566 | billing_underlays: 33680 |
| grid_owners | 17696 | billing_underlays: 33685, customer_sites: 18111, customer_sites: 48936, metering_points: 17824 |
| invoice_export_items | 58593 | customer_invoices: 133909, customer_invoices: 179608 |
| legal_bundle_version_documents | 136713 | customer_legal_acceptances: 137935, powers_of_attorney: 346490 |
| legal_bundles | 67547 | contract_price_snapshots: 67688, customer_contracts: 67673, customer_legal_acceptances: 67713 |
| legal_text_versions | 66546 | customer_legal_acceptances: 66623, powers_of_attorney: 66642 |
| partner_exports | 33693 | customer_invoices: 39148 |
| portfolio_monthly_settlements | 138174 | billing_underlays: 138365, customer_invoices: 138402 |
| portfolios | 138152 | billing_underlays: 138360, customer_invoices: 138397 |
| price_areas | 17708 | customer_sites: 18116, metering_points: 17962, metering_points: 17829 |
| price_books | 67584 | billing_underlays: 67693, contract_price_snapshots: 67683, customer_contracts: 67678 |
| price_plan_versions | 58040 | customer_contracts: 66326, customer_invoice_lines: 231136, customer_invoices: 138392 |
| price_plans | 58021 | customer_contracts: 66321 |
| public_contract_offers | 66267 | contract_price_snapshots: 66539, customer_contracts: 136018 |
| webhook_subscriptions | 47560 | webhook_deliveries: 47621 |

The 20 parent names above plus the eleven full shapes form 27 distinct new relations; **only eleven require full shape collection** in this next wave. Resolve OIDs again by qualified names and assert identity; these OIDs are evidence locators, not stable cross-database IDs. Preserve actual parent-column order from parent_columns, not the display order of parent_key_metadata (which is physical column order).

### One sequence and two optional number functions

Collect existence and catalog metadata for `public.customer_number_seq` (edge: function 33828 literal nextval). Include pg_sequence configuration, pg_class owner/ACL, schema ACL, effective USAGE/SELECT/UPDATE and dependencies. Do not select last_value/is_called, sequence values, nextval/currval/setval, or pg_sequences.last_value. Its original startup parameters are not proof of the current counter position, and synthetic sequence state must be labeled synthetic.

`public.gridex_next_customer_number(uuid)` (139082) and `public.gridex_next_contract_number(uuid,text)` (345211) are the only optional automatic-number function signatures added to the eight required signatures in the proposed second wave. Collect their definitions if default/automatic-number diagnostics are retained; otherwise explicit numbers and branch assertions keep them outside executed closure. Total recommended function lookup set: ten signatures, plus an existence/metadata probe for public.digest(text,text) to check masking. No lookup authorizes execution.

Collect namespace owner/ACL and effective USAGE for public/private/extensions/auth alongside these functions. Existing function effective EXECUTE alone does not settle schema access. For newly discovered functions, return direct catalog dependencies only; inspect the returned bodies and derive a named third wave only if a declared fixture path actually reaches an uncovered object. Existing pg_depend does not track every relation/function named in SQL/plpgsql string bodies, as wave 1 demonstrates.

## Closure counts and deferred branches

Across the 95 supplied definitions, there is **one executable dynamic-SQL statement**: the fixed-literal user_profiles SELECT in 41365. Its target and argument binding are known. **Zero unresolved dynamic target expressions are visible in the supplied bodies.** This is not global dynamic-SQL closure: the missing callees have unread bodies. Comments and CREATE TRIGGER text were excluded from this count.

A body call census finds **19 missing qualified function names, representing 20 identified signatures when digest's two overloads are distinguished**. Eight required signatures are above; two numbering signatures are optional. The remaining ten names are branch/setup exclusions, not resolved dependencies:

| Missing name | Calling OID(s) | Boundary that avoids its execution |
|---|---|---|
| private.gridex_emit_partner_resource_event_v2 | 344903,344928–344931 | No partner_api source/channel on contract/customer/site/PoA or invoice's parent customer |
| private.remove_terms_accepted_from_application_response | 347888 | No qualifying contract_application_id + terms/document evidence |
| public.gridex_ensure_internal_contract_publication | 137478 | Null contract_offer_id |
| public.canonical_seed_company_capabilities | 301368 | No tested company INSERT; explicit actor/tenant fixture setup boundary |
| public.gridex_bump_contract_publication_revision | 345166 | No tested company/catalog-dependency mutation |
| public.gridex_normalize_country_code | 137750 | No tested company I/U |
| public.gridex_normalize_postal_code | 137750 | Same company setup boundary |
| public.gridex_normalize_swedish_organization_number | 137750 | Same company setup boundary |
| public.gridex_rebuild_company_legal_profile | 137703 | Same company setup boundary; do not set skip GUC to evade it |
| public.gridex_seed_default_legal_package_for_company | 127365 | Same company setup boundary; its exception-catching wrapper is not proof of seed success |

The census counts names of calls, not INSERT column lists; relation names followed by parentheses are not functions. No claim is made that these missing bodies contain no dynamic SQL or further sinks.

There are **13 directly named SQL write-sink relations** in the 95 definitions. Two have wave-1 shapes (audit_logs, billing_underlays). Eleven are missing: **two are required** by the proposed root paths (masterdata_audit_log, power_of_attorney_scopes); **nine are deferred** under explicit branch/setup gates (admin_users_audit_events, company_market_price_sources, company_provisioning_jobs, customer_operation_events, customer_operation_jobs, customer_operation_request_snapshots, customer_operation_tasks, platform_postal_code_grid_mappings, website_customer_applications). These are direct-target counts; they do not include unobserved sinks behind the missing callees.

The site summary helper is an unavoidable unresolved write boundary for site positives and DELETE. The permission resolver, snapshot normalizer and other required missing functions remain unread behavior boundaries too; their names must not be treated as proof of read-only/pure execution. At least two new direct sink schemas and one mandatory indirect summary boundary therefore prevent a ready-to-execute finding. Any new trigger on the collected sinks is another finite edge to classify before execution.

For deferred root paths: signed contract 355443 inserts jobs/tasks/events; address-change 128119 updates jobs/request snapshots; verified site 344986 updates/inserts postal mappings; terms reconciler 347888 updates website applications; invoice projection 348033 updates already collected underlays. No child shape is added merely because it has an inbound FK to a root. Real synthetic children of immutable legal/snapshot tables can block a parent DELETE through CASCADE or SET NULL; use independent DELETE fixtures, and assert their declared child inventory is empty. This is an empty synthetic-state assertion, not a claim about managed rows.

## Admission decision and exact next gates

1. Accept wave 1 as a coherent **current metadata receipt**. Verify its raw SHA and the unchanged shared policy/ACL projection. Keep its 104 function metadata entries and 343 incoming FK definitions as evidence.
2. Keep historical source composition unresolved where previously reported. Current body/policy/ACL observations cannot establish original ACL defaults, intermediate June/August transformation preimages, or executed source order. Do not rewrite source manifests from current pg_get_functiondef text.
3. Collect the bounded second wave above: eleven full shapes; the twenty external root-parent key projections (overlap four full shapes); eight required function signatures, optionally two automatic-number signatures; digest-masking probe; one indirect sequence's metadata; schema access metadata. Return exact names and missing entries, direct dependencies only. No data rows/custom RPCs/function executions.
4. Admit explicit fixture-state and statement-shape specifications before execution. Verify required row fields, generated columns, checks and actual trigger ordering by name; distinguish permission denial, RLS zero rows, relationship 23503/23514, immutable P0001/55000 and default/helper permission failures. Include positive same-tenant controls without weakening their real schema. The 100 CRUD/18 relationship count remains an intended coverage contract, not an already passing or unchanged oracle.
5. Close newly observed helper reads/write sinks on declared paths. Only then author the current-state fixture. Keep source-only candidate acceptance, managed observation, and eventual native acceptance separately labeled.

## Definition fingerprints for the directly discussed critical edges

SHA-256 below is the exact UTF-8 pg_get_functiondef string in this receipt, including its final newline. These hashes identify observed bytes only; pg_get_functiondef formatting is not evidence of historical source equality. The full receipt SHA pins all other 104 metadata entries.

| OID | Qualified function | Definition SHA-256 |
|---|---|---|
| 18063 | public.log_masterdata_change() | 77a396bed6dd5c323854207c6f6aed0c26038d0d9b353dab6e9ad90bd96e1db6 |
| 19282 | public.gridex_has_permission(p_user_id uuid, p_permission text) | 33fda11ec123d0e5513c7db30f78f16715759e0c95c827bc29a8fa28ff3e1880 |
| 33828 | public.gridex_generate_customer_number() | 6712f712a97dbd11f2df33da8c7eb43d711e75bca7a9f25ce5ea19b0cfd7642a |
| 38739 | public.gridex_customer_contracts_auto_renew_guard() | 95b0301297d7569547fabfce717a1ee04aa0fb6c4dec7f424076458fe219f8e3 |
| 41365 | public.gridex_is_current_session_allowed() | e5d0120f395117bfcc5cb12960cbbf3322dd409df2c12ca0adc9e111f7d675b8 |
| 41367 | public.gridex_user_is_platform_admin() | 466a8eca1bf594a94beea9c662a8d880f1812648661c88e2d43dab238a4144c4 |
| 42266 | public.gridex_audit_critical_row_change() | 9f69be6ac6dd14867d08625a23c719ec631779c26a4f144e13416e8c3e4bce1a |
| 66638 | public.gridex_customer_legal_acceptances_immutable() | 55751ed3466458badefa4420ab702ebab3a03daa7014013580771fd2351745d6 |
| 67756 | public.gridex_customer_sites_company_guard() | 28d097dc0a7bfbd7460dd02f490a5007dc6ec59b44969fb8bef60676e2704d51 |
| 67757 | public.gridex_metering_points_company_guard() | 28a4b22c5a385e1043c721ab8bce192e02db718d4d3d73f67cc59ddc66d65399 |
| 67758 | public.gridex_customer_contracts_company_guard() | b6af76ca40838ab00c63378231d576d30f18205d3fcad0c1d0e2457827857f91 |
| 67759 | public.gridex_contract_price_snapshots_company_guard() | e4124732768fdb01599b879169086bd4bb7fadfdcf77389db7e129b0662ce41f |
| 67760 | public.gridex_customer_legal_acceptances_company_guard() | 7039252389ad530e006f962242f099654d465a90b27bc4dbad5aaa47bb129825 |
| 67761 | public.gridex_powers_of_attorney_company_guard() | b1b2ad30057ba6bee3b295c45719c4594a198640cedbeceafee4afaa43f94e80 |
| 67762 | public.gridex_billing_underlays_company_guard() | f839dd6dca6705f12f4b0d089c6b481299502bf94174ae70c047c60bc6797679 |
| 132511 | public.gridex_block_contract_price_snapshot_mutation() | 74eae75f83edef9e6528efc3823dc5d4317b0a09194e618c377d1cbb0b5ef546 |
| 137418 | public.gridex_lock_customer_contract_tenant_snapshot() | b111dce52602b3c089cf0bd573763881f8b4097e2574639abc0134886c136760 |
| 139082 | public.gridex_assign_customer_number() | 0d77a7edf1ba3259666e7abcde946fdb517650337c69904a63e70437a77a7fc3 |
| 192996 | public.gridex_normalize_audit_context_v1() | c28e7c02567f65b630d471f0bdd680423e3d44ae0c009530ff4fbc7d0149aff9 |
| 249968 | public.gridex_new_public_resource_reference(p_prefix text) | 4b9ded1ae67443ff40bf980282bc1f8ee566bdb1fb09f5931889f9ee78edfe2d |
| 341232 | public.ensure_customer_invoice_reference_v1() | 5d6ded6ad74ba9db4c491a270f05cf0ee98f0a52deb216e06faad2f7b51ecba1 |
| 345211 | public.gridex_assign_customer_contract_identity_v1() | acab33711100b69221900e571fc7b15eb389f6e51d579371e8f39710523c8c88 |
| 345220 | public.gridex_normalize_customer_contract_pricing_snapshot_v1() | 4f68a452ee749c344c4d626001507be2b5e28b70ca5040aee9a14fd4fad0398e |
| 345222 | public.gridex_normalize_contract_price_snapshot_row_v1() | 07021340904818840c0c4c78e6f9643279c4168675f17b5cb733f3e9a0139166 |
| 346247 | public.gridex_refresh_customer_summary_from_site_trigger() | 38f65b3eb13da325b1c0e05e8b9a39f93f1ed3d666aa0cdd21c53190568864df |
| 346249 | public.gridex_reaggregate_customer_after_legacy_state_write() | d7239c74ba4efd419acebaa122de84797d9800efd536b195a38e20fc459289b2 |
| 346637 | public.gridex_enforce_contract_price_snapshot_hash_v1() | a1f173248b5366467ffdd491e9409fecfe491bb49930c79fe6a7d76769932a9a |
| 348033 | public.gridex_sync_underlay_invoice_projection_v1() | 5eeccf9b2e9c334d82d033a8c6392ba5967ab9348a39b33a3e45c1996b43da9b |
| 357427 | public.gridex_materialize_poa_scopes() | 1395b9fe97a8455bad54ff5af05ffcddfed4d7837921d29aa455d922cb24678a |
