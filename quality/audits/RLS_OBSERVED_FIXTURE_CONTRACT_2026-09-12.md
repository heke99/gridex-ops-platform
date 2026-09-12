# Task 11b — current observed-state fixture author brief

**Purpose:** implement a source-pinned projection of the observed dev catalog and characterize ten critical relations × ten named CRUD cases, plus the eighteen actual relationship paths. Inputs are sufficient for this declared profile. No fixture/native test has yet run; no observed regression is fixed or accepted by this brief.

## Seven pinned inputs and authority

| Input under quality/audits | Bytes | SHA-256 |
|---|---:|---|
| RLS_MANAGED_METADATA_OBSERVATION_2026-09-12.json | 30359 | 6dadd2ee0b2549ef398421053ca62dd71cd39045ca504dc1c73be7aa0e49f724 |
| RLS_MANAGED_POLICY_OBSERVATION_2026-09-12.json | 93331 | 710d6d0634bdd23f3ff5770190bd9d2fef568b8e186baad8bc6f013b7ac0c893 |
| RLS_MANAGED_CATALOG_WAVE1_2026-09-12.json | 3537639 | 8cdca9cf1e6a67a9b4870d00e654eceab3f5d00902cb6c5dad16d53efe672c48 |
| RLS_MANAGED_CATALOG_WAVE2_2026-09-12.json | 1174816 | 0f798ee90026d898f3e2afc3a05c6da2404aeaf2ee15e209f4f3bf99f29d11f4 |
| RLS_SEQUENCE_TEXT_OBSERVATION_2026-09-12.json | 1958 | de78e5e55e68765580700e513d5f5c9a34a6956837f4d8b85ac480ffc634ecbd |
| RLS_INTEGRATION_PARENT_KEY_OBSERVATION_2026-09-12.json | 6995 | 38d730b42ddfb339c4b9fa9ac7bd818d0d944aa0b8f94f351b9f4930af3ef2ad |
| RLS_PERMISSION_NATIVE_CONTRACT_2026-09-12.md | 35525 | b7c7fdc6bdabac274b5aa136d5e55d1d11a4b6e63be82004f5583c3859a35c84 |

The first six rows are observations; the seventh is the intended test contract. Use the managed metadata as current-state authority only. Do not turn pg_get_functiondef into historical source admission or claim current shared resolver equals candidate deny-wins algebra. Keep previously accepted 11a/11c native/source work unchanged. Do not apply the whole 07 candidate; its writer, diagnostic and actor closure is separately required.

Observation times are 09:20:37 (ACL), 09:29:46 (policy), 09:41:32 (wave 1), 09:58:49 (wave 2), 10:02:49 (sequence text), 10:05:56 (API-client parent). All are 2026-09-12, same dev identity/ledger; runtime binding is UNPROVED. The first four coherent projections do not make the six receipts simultaneous. Reject changed raw input hashes. Verify referenced definitions, signatures, metadata projection and missing-name assertions before assembling SQL.

## Projection and assembly boundary

- Twelve tested root tables: customers, customer_sites, metering_points, customer_contracts, powers_of_attorney, billing_underlays, customer_invoices, customer_invoice_lines, audit_logs, webhook_deliveries, customer_legal_acceptances, contract_price_snapshots. The first ten supply the 100 CRUD IDs; the last two enter only their relationship paths and explicit immutability/not-found controls.
- Wave 1's twelve other relations supply real actor/policy support: auth.users; public.companies, company_memberships, user_roles, roles, permissions, role_permissions, user_permissions, user_permission_overrides, user_profiles, admin_users, customer_portal_accounts.
- Wave 2 supplies six reached support relations: masterdata_audit_log, power_of_attorney_scopes, tenant_legal_profiles, company_email_settings, webhook_subscriptions, domain_events. Five additional empty relations provide observed composite row types: contract_offers, contract_publication_versions, contract_product_versions, website_contract_quotes, customer_site_resolution. Their full metadata was retained, but their commercial/quote/resolution CRUD and trigger graphs are not tested.
- The twenty original external root-parent key projections plus integration_api_clients include four already named full-shape relations. The remaining seventeen are explicitly empty referenced-key projections, not fabricated complete tables. This yields 52 distinct relation identities (35 full column-shape inputs plus seventeen key projections). Preserve actual root FKs and reached support FKs. Retain all 343 inbound FK definitions as evidence; do not materialize every incoming child graph merely because it exists.
- Restore full columns/generated expressions/checks/indexes and all actual trigger bindings for tested roots and reached sinks. Exact trigger ordering, enabled state, function security context/search_path, table owner, RLS/FORCE and ACL are inputs. For empty composite-type prerequisites, document the exact type-only relation projection and omitted unexecuted constraints/triggers; do not call the result whole managed-schema equality. If that projection makes an actually reached statement fail to resolve, stop with the precise edge rather than stub a function or expand blindly.
- Recreate actor-facing roles/attributes/memberships and object-specific ACLs from observations. SQL that applies a particular observed ACL is permitted fixture reconstruction; a blanket GRANT over fixture tables/functions is not. Account for PUBLIC, schema USAGE, function EXECUTE, column ACL and role membership. Native provisioning role privileges are infrastructure and must not silently make the authenticated or service test role superuser/owner.
- Required helper definitions are the exact eight identified in wave-2 report; unchanged wave-1 trigger/helper definitions are pinned by its receipt. Load pgcrypto 1.3 implementation equivalence through the owned native substrate and check both digest overloads, strictness, owner/schema/ACL. Do not handwrite digest replacements. Reject a public.digest(text,text) masking function in the fixture.
- Create public.customer_number_seq from the separate TEXT configuration receipt, never wave 2's rounded seqmax. Max is the string 9223372036854775807; start 100000, increment/min/cache 1, cycle false. No observed current counter exists. Any synthetic start/reset is labeled fixture state.

The implementation may reuse already approved owned native infrastructure without changing its target/cleanup admission. Create an isolated new run; never use ambient database URLs or attach to a running lane's container. This brief admits no remote execution. A manifest must pin metadata extraction selectors and raw bytes; a convenience reduced SQL fixture with invented helpers/grants does not meet this brief.

## Seed state and actors

Seed database state under the isolated owner/setup context; this is construction of a test state, not testing production company/customer onboarding commands. No authorization trigger may be disabled to manufacture a valid role scope or successful tested command. Use valid global platform assignments and same-company ordinary roles, obeying observed scope rules. Install and verify all actual root/sink triggers before tested DML; state construction and its untargeted support-trigger omissions must be declared in the manifest.

Use disjoint, deterministic UUID namespaces for actors, tenants, parents, test targets and sink witnesses. Tenants A/B are active. U_A has verified nondeleted/unbanned active identity/profile, active A membership with owner/admin/operations write role, no B membership. U_B mirrors it. Add U_A_M with explicit active same-company role grant for masterdata.write; use that actor for site/metering DELETE positive-path diagnosis. Platform controls use an authoritative global role or active admin_users entry with the actual identity requirements; never equate admin.access fallback with all permission keys. Service controls SET LOCAL ROLE service_role with an explicitly labeled synthetic service claim; they exercise actual observed BYPASSRLS, not an authenticated client pretending to be service.

Assert current_user/session claims, ownership and rolsuper/rolbypassrls before cases. Authenticated is neither owner nor bypass/superuser. anon has no ten-root CRUD table ACL. Service role is non-superuser with observed bypass and real table privileges. Verify role-based permissions and current helper answers separately from actual RLS results.

Use separate parent/target rows per named test; do not delete a customer/site/invoice that is also parent of the relationship graph. Each positive DELETE target has no matching synthetic incoming child except an expressly named sink witness. Never infer managed child emptiness from the synthetic fixture. Owner snapshots inspect target and sink data regardless of caller visibility.

## Legal row templates and statement shapes

Use the observed column defaults/checks, with explicit required input values. These are profile choices, not replacement DDL:

| Relation | Required profile inputs and branch limits | Neutral UPDATE target |
|---|---|---|
| customers | private customer, draft, company_id A, explicit nonblank unique customer_number and customer_reference, nonpartner metadata; supply all other required nondefault fields from receipt | metadata; do not name intake_status/next_action |
| customer_sites | same-company customer, site_name, site_type consumption, status draft, country SE, explicit facility_reference; address_hash/resolution_id NULL, unverified resolution, no grid owner; owner-constructed site baseline is needed for authenticated update/delete because INSERT reaches helper ACL failure | site_name; no summary/address/geography target columns |
| metering_points | same-company customer/site, explicit unique metering_point_id, draft; leave identifier normalization triggers intact | metadata |
| customer_contracts | same-company customer, contract_name, valid type manual_override, source manual, status draft, explicit customer_number/contract_number/customer_contract_reference; unsigned/unlocked; no offer/product/publication/quote/price-plan/legal bindings | metadata |
| powers_of_attorney | same-company customer, scope meter_data, status draft, nonpartner/nonwebsite source, explicit reference; empty signed scope and legal refs | metadata; do not mutate signed scope |
| billing_underlays | same-company customer, pending, default currency/source/payload, optional parent references NULL outside the particular relationship path; nonnegative amounts, no portfolio/export/configuration snapshot | payload with no direction changes |
| customer_invoices | same-company customer, draft, explicit partner_invoice_reference; no portfolio/export/underlay bindings; actual digest trigger sets invoice_reference | metadata |
| customer_invoice_lines | same-company invoice, description, defaults for remaining amounts/metadata; preserve actual invoice/company FK | description |
| audit_logs | company A, explicit entity_type/entity_id/action, actor_user_id U_A or valid system context; actual normalization fills actor/request/correlation/resource fields | metadata |
| webhook_deliveries | company A, real same-company subscription and domain event, matching valid event_type, unique idempotency key, queued, explicit payload/default counters | payload (ordinary authenticated UPDATE remains RLS-zero) |
| customer_legal_acceptances | company/customer A, acceptance_type terms, source website, no application/document evidence, optional contract only in relevant case | No positive mutable UPDATE under current policies/immutability |
| contract_price_snapshots | company A, real draft contract, snapshot_json {}, non-v6 selection schema; allow actual fill/normalizer/hash trigger to produce correct hash; pricing_model default spot | No positive mutable UPDATE; maintenance GUC stays off |

Real subscription seed: company_id/name/HTTPS endpoint, explicit webhook_subscription_reference; api_client_id NULL. Real domain event seed: company_id, dotted event_type (e.g. fixture.created), aggregate_type/aggregate_id; actor/subject NULL unless valid observed parent is intentionally supplied. Neither parent has custom triggers. tenant_legal_profiles/company_email_settings remain empty for contract fallback-to-company reads. Use matching site/customer/contract identities when a relationship case activates a chain check; do not create same-company wrong-customer noise that preempts the intended foreign-company case.

## 100 named CRUD cases and expected current behavior

Use stable C_<relation>_01 through _10 IDs; report 100 named cases separately from subassertion counts. Baseline ordinary actor is U_A; where marked M use U_A_M. First verify seeded own row is SELECT-visible and foreign row is not. Expected outcomes below are catalog-derived oracles for native confirmation, not reported native passes.

| ID suffix | Statement and oracle |
|---|---|
| 01 | Own SELECT: one target row on all ten, with appropriate child parents already seeded |
| 02 | Foreign SELECT: zero rows for ordinary U_A on all ten |
| 03 | Own INSERT: use table-specific oracle below; successful INSERT is one target row plus exact expected sinks |
| 04 | Foreign-owner INSERT: valid B-owned row under U_A, explicit defaults/references; expected RLS 42501 after valid prerequisites. Capture any earlier concrete constraint/trigger error as a different result, never generic success |
| 05 | Own nonownership UPDATE: one row except webhook RLS-zero; use the neutral column above. Site neutral UPDATE avoids summary helper |
| 06 | Foreign-row neutral UPDATE: zero rows, no target or sink changes |
| 07 | Own-row company reassignment A→B: no unauthorized committed reassignment. Expected 42501 for simple membership-guarded roots, 23514/23503 where actual BEFORE guard/FK preempts, webhook zero because UPDATE USING is false. Native first-error/row count must be bound to exact statement shape before this case is accepted |
| 08 | Own DELETE: table-specific oracle below, with no matching child graph to create unrelated FK failures |
| 09 | Foreign DELETE: zero rows, no target/sink changes |
| 10 | U_B mirror control: B own SELECT one, A SELECT zero and foreign neutral UPDATE zero; include B own-write mirror of 03/05 when needed for symmetrical diagnosis; keep subassertion counts explicit |

| Relation | Ordinary own INSERT 03 | Neutral UPDATE 05 | Own DELETE 08 | Positive control that must remain separate |
|---|---|---|---|---|
| customers | 1 | 1 | 0: no permissive authenticated DELETE | service DELETE 1 on isolated customer |
| customer_sites | 42501 at summary helper if it reaches AFTER trigger | 1 | M: 42501 at summary helper; without M: 0 | service I/U/D 1 with summary/audit effects; authenticated neutral U 1 |
| metering_points | 1 | 1 | M: 1; without M: 0 | same-company M DELETE and service I/U/D |
| customer_contracts | 1 for explicit unsigned draft shape | 1 | 0: no permissive authenticated DELETE | service DELETE 1 for unsigned/unlocked childless draft |
| powers_of_attorney | 1; draft materializer UPDATE still executes | 1 | 0: permissive predicate requires service claim | service DELETE 1; deliberate scope witness subcase verifies materialization |
| billing_underlays | 1 for pending shape | 1 | 0: service-claim predicate | service DELETE 1 on isolated pending row |
| customer_invoices | 1 for draft/nonportfolio shape | 1 | 0 for ordinary actor; authoritative platform P can pass | service DELETE 1 with no line child; platform active-company DELETE control |
| customer_invoice_lines | 1 | 1 | 0 for ordinary actor; P can pass | service DELETE 1; platform active-company DELETE control |
| audit_logs | 1 with valid normalized context | 1 | 0: no permissive authenticated DELETE | service DELETE 1 on independent audit target |
| webhook_deliveries | 42501 from service-only WITH CHECK | 0 | 0 | service I/U/D 1 with real subscription/event parents |

All ordinary write permissions remain conjuncted with actual lifecycle W=gridex_can_write_company. Sites/metering I/U have W/P/read-derived OR branches; masterdata.write is **not** an additional mandatory I/U gate. Their ordinary DELETE permissive branch is masterdata.write and is still constrained by W. Current site summary helper 346244 is invoker with authenticated EXECUTE=false; wrapper 346247 is invoker, so active membership or platform identity does not bypass the ACL. Pair the diagnosed I/D failure with service success and authenticated neutral U success; do not relabel service results as authenticated positives.

Add explicit supplemental assertions for omitted public-reference defaults (authenticated helper 249968 EXECUTE denial), the no-masterdata DELETE controls, lifecycle paused read/write distinction, and direct anon ACL denial. These are assertion/diagnostic extensions, not silently extra named cases in the 100 count. Candidate permission/override algebra is not automatically imported or claimed covered.

## Eighteen relationship paths

Retain the existing path IDs, but replace the reduced fixture's three-column INSERTs and broad grants with actual current shapes. Each ID owns same-company and foreign-reference INSERT, same-reference UPDATE, foreign-reference UPDATE and company reassignment subassertions under authenticated and service roles. Use an owner-constructed baseline when current own INSERT is intentionally denied. That baseline construction is not a passing caller INSERT.

| R ID | Child.reference |
|---|---|
| 01 | customer_sites.customer_id |
| 02 | metering_points.customer_id |
| 03 | metering_points.site_id |
| 04 | customer_contracts.customer_id |
| 05 | customer_contracts.site_id |
| 06 | customer_contracts.customer_site_id |
| 07 | customer_contracts.metering_point_id |
| 08 | customer_legal_acceptances.customer_id |
| 09 | customer_legal_acceptances.contract_id |
| 10 | powers_of_attorney.customer_id |
| 11 | powers_of_attorney.site_id |
| 12 | powers_of_attorney.metering_point_id |
| 13 | billing_underlays.customer_id |
| 14 | billing_underlays.customer_contract_id |
| 15 | billing_underlays.contract_id |
| 16 | billing_underlays.site_id |
| 17 | billing_underlays.metering_point_id |
| 18 | contract_price_snapshots.contract_id |

Current relationship oracles:

- For mutable children, same-company service INSERT/UPDATE should affect one row. Authenticated same-company INSERT/UPDATE should also do so except R01 INSERT's summary-helper 42501. R01 UPDATE of customer_id alone avoids the summary UPDATE OF column list. Same-company service controls must have valid complete graph/check inputs and verify audit/summary consequences.
- R08/R09 legal acceptance INSERT can succeed for authenticated/service with valid company/customer/contract. Authenticated UPDATE/reassignment sees zero rows because there is no permissive UPDATE policy; service UPDATE/DELETE hits immutable P0001. Neither outcome proves the relationship guard rejected that UPDATE. Never disable the immutable trigger to manufacture the old positive subassertion.
- R18 snapshot same-company INSERT can succeed; authenticated and service same-reference UPDATE hit immutable P0001 with maintenance GUC off. The actual company_guard trigger sorts BEFORE immutable: a foreign-reference UPDATE is expected to reach 23503 for a hidden authenticated parent, 23514 for a visible service parent, and A-to-B reassignment with visible A contract reaches 23514 before immutability. Authenticated DELETE has no applicable permissive path (zero); service DELETE encounters immutable P0001. Retain successful INSERT as its positive control; missing contract_id is expected 23502 and unknown/hidden contract is expected 23503 through actual wrapper 67759. Native execution must confirm this ordering.
- Foreign-reference service INSERT/UPDATE on mutable children makes both companies visible to invoker guards; mismatched nonnull company IDs should raise 23514. On legal acceptance UPDATE, the immutable trigger sorts first and preempts the company guard; snapshot company_guard sorts before its immutable trigger as specified above. Record the actual first error, not a generic relationship-guard pass. Foreign service INSERT still exercises the relationship guard.
- Foreign-reference authenticated reads hide B parents. gridex_assert_same_company rejects only two nonnull unequal IDs, so a hidden parent may fall through to a composite FK 23503. Underlay chain checks for contract/metering explicitly use NOT EXISTS and can raise 23514 even when the parent is hidden. Snapshot wrapper explicitly raises 23503 for not-visible contract. Bind each native case to its actual first error after execution/review; do not accept any exception as a blanket negative.
- A→B child-company reassignment with visible A parent should encounter the actual BEFORE company/chain guard or the RLS CHECK; legal/snapshot mutable-path exclusions above still apply. For references that have no applicable FK/trigger beyond the inspected path, do not invent a stronger same-customer oracle. Use only observed definitions.

A report may have all eighteen IDs executed while some UPDATE guard subassertions are **preempted/not observable** under full current policy/immutability. Preserve that status; it is not equivalent to the old isolated 18-guard acceptance. Old source-only tests remain separate evidence.

## Sinks, atomicity and native acceptance gate

Snapshot and compare target rows plus audit_logs, masterdata_audit_log, customers summary fields and power_of_attorney_scopes by deterministic fixture IDs. Canonical row multiset comparison must preserve null/value distinctions and count actual rows; RETURNING-only visibility is insufficient for owner-side state checks. Record expected generated/hash/reference fields and nondeterministic timestamp/UUID handling explicitly, without deleting unexpected fields from comparison.

Critical audit and masterdata audit execute as postgres. Scope materialization runs as invoker and its one custom scope audit trigger reaches already pinned audit normalization. Service site summary reads sites and updates customers; nested customer reaggregation stops at trigger depth >=2. Empty matching scope set means no scope audit row; an intentional active same-PoA witness must deactivate with an audit row. An authenticated site AFTER-helper failure rolls back target change and earlier audit writes; native receipts must prove it.

Run each error-producing statement inside a controlled subtransaction/savepoint so the harness can inspect owner-side post-state after rollback without accepting setup errors as denials. Capture database role/claims, command text or statement-shape hash, SQLSTATE, message/detail/constraint where available, affected rows and target/sink before/after hashes. A 42703/42P01/42883 or unrelated required-column/check failure is an assembly/row-shape blocker, not a passed security case. First-error ordering that differs from prediction is investigated and recorded before accepting the oracle, not silently added to an allowed-error set.

Independent review must examine exact extraction/ACL/trigger manifests and the native receipts. Reproduce the site-summary 42501 with successful relevant same-company/service controls before proposing any grant/helper fix. Preserve expected denied client operations as current behavior. No blanket grant, no trigger disabling, no maintenance/skip GUC, no candidate rewrite is approved here.

## Explicit limits and stop conditions

Automatic numbering is outside tested statements: supply customer_number and contract_number. The unexecuted next_customer_number path still needs gridex_default_customer_number_prefix and company_customer_number_sequences; next_contract_number still needs gridex_next_document_number if that path is later included. No remote counter state was read.

Keep partner source/channel false; unsigned draft contracts; null commercial/publication/quote/legal bindings; null address_hash and unverified resolution; no website signed-PoA materialization; no qualifying website terms application evidence; no invoice-underlay/export link outside explicitly tested relationship shapes. Company/admin seed operations are fixture-state construction, not onboarding command acceptance. The empty-type and empty-parent projections are reviewed limitations, not historical schema substitutions.

Stop and identify the exact reached missing dependency if native installation/execution shows one despite this closure. Do not broaden into all public functions, 343 inbound children or the full historical migration chain. The current observed fixture is distinct from managed API behavior, production binding, source replay and future permission-deny algebra. None of those receives acceptance from a successful run of this fixture.
