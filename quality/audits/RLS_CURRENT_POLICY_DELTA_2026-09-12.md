# Task11b current managed policy delta

2026-09-12. COMPLETE bounded read-only assessment. Only this report written; no DB queries, customer data, native execution, code/candidate/memory/index changes or delegation. Sole Task11c author/root edits preserved. This extends the two prior finite11b reports; no broad audit restart.

**Decision:** the09:29 receipt supplies a coherent observed current policy+ACL baseline for all ten tables. Current-role/native fixture admission can now pin the actual110 policies instead of guessing them from selected history or the older schema snapshot. Current function definitions and row/default/trigger/FK dependencies are still missing. Production/runtime binding, historical source-equivalence and100-CRUD/18-reference execution remain open.

## Identity and metadata equality

| Receipt | Bytes | SHA-256 |
|---|---:|---|
| `quality/audits/RLS_MANAGED_POLICY_OBSERVATION_2026-09-12.json` | 93331 | `710d6d0634bdd23f3ff5770190bd9d2fef568b8e186baad8bc6f013b7ac0c893` |
| `quality/audits/RLS_MANAGED_METADATA_OBSERVATION_2026-09-12.json` | 30359 | `6dadd2ee0b2549ef398421053ca62dd71cd39045ca504dc1c73be7aa0e49f724` |

Current observation `2026-09-12T09:29:46.131939+00:00`; same connected `piidsfebjqjmnepdpnas` / `gridex-ops-dev`, managed17.6.1.084, database postgres/server17.6, ledger279/tail20260904222450. Runtime→DB binding remains UNPROVED.

Structural comparison is **identical** for all common catalog fields after excluding observed_at and the new per-table policies/classification. This includes all31 roles/attributes,22 membership edges/options/grantors,24 default ACL records, and ten tables' owner/kind/RLS/FORCE/raw+column ACL/effective three-role CRUD/schema usage. Canonical shared projection SHA-256: `6dfc5fa8f3207997dd0b0bc1c9f66fec203af1f71d61ecc27975124fb71e2113`.

Projection encoding: remove only catalog.observed_at and each table's policies/classification, serialize JSON with sorted keys, separators `(',',':')`, ensure_ascii=false, preserving array order, UTF-8. The policies/classification projection (`schema,name,policies,classification` per observed table, same serialization) hashes to `860bf9b0ef23995322429df08c08463b6c73dfc464f6f5e1e8b5f88179f87107`.

All ten remain postgres-owned ordinary public tables, RLS=true/FORCE=false, no explicit column ACLs; authenticated/service_role have effective CRUD and anon does not. Equal metadata across two observations proves no observed difference, not absence of intervening changes.

## Complete policy expression review

Read every policy's roles/command/mode and every USING/WITH CHECK. There are **110 policies:70 permissive +40 restrictive**,38 exact distinct nonnull expression strings. Every restrictive policy targets authenticated; each table has exactly one lifecycle S/I/U/D guard. No policy targets anon, PUBLIC, dashboard_user, authenticator or supabase_privileged_role. Permissive roles are authenticated/service_role only. All59 `gridex_mp_*` names match the June source MD5 formula for current table/command/role; matching names do not prove which historical predicates were combined.

Definitions used below are symbolic references to observed calls, not replacement SQL: P=`gridex_user_is_platform_admin()`, W=`gridex_can_write_company(company_id)`, R=`gridex_can_read_company(company_id)`, M=`gridex_has_permission(auth.uid(),'masterdata.write')`, S=`auth.role()='service_role'`.

Every lifecycle SELECT is exactly the same observed expression:

```sql
(( SELECT gridex_is_current_session_allowed() AS gridex_is_current_session_allowed)
 AND (( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)
 OR (company_id IN ( SELECT gridex_user_company_ids() AS gridex_user_company_ids))))
```

Every lifecycle INSERT CHECK, UPDATE USING+CHECK and DELETE USING is W. Nine tables have permissive `gridex_perf_authenticated_select_v1` USING true; webhook has `webhook_deliveries_tenant_or_platform_read` USING(P OR R). Do not replace stored expressions by their simplified meanings during reconstruction.

| Table | Total / permissive / restrictive | Authenticated permissive operations and DELETE condition | Service permissive operations |
|---|---|---|---|
| audit_logs |11 /7 /4|S/I/U; no D|S/I/U/D; expressions include true disjuncts|
| billing_underlays |12 /8 /4|S/I/U/D; D=S|S/I/U/D|
| customer_contracts |10 /6 /4|S/I/U; no D|S/I/U; no D|
| customer_invoice_lines |12 /8 /4|S/I/U/D; D=P|S/I/U/D|
| customer_invoices |12 /8 /4|S/I/U/D; D=P|S/I/U/D|
| customer_sites |11 /7 /4|S/I/U/D; D=M|S/I/U; no D|
| customers |10 /6 /4|S/I/U; no D|S/I/U; no D|
| metering_points |11 /7 /4|S/I/U/D; D=M|S/I/U; no D|
| powers_of_attorney |12 /8 /4|S/I/U/D; D=S|S/I/U/D|
| webhook_deliveries |9 /5 /4|S/I/U/D; I/U/D=(S OR S)|ALL USING/CHECK true|

Authenticated I/U on the first nine tables includes existing P/R/W branches, always narrowed by restrictive W on the new row and by W for UPDATE's old row. Sites/metering additionally include M in their permissive INSERT and both UPDATE expressions. Those eight M call occurrences (I CHECK, U USING/CHECK, D USING on each table) are real current consumers of the shared permission resolver. Do not label all ten policies membership-only or treat every ordinary DELETE as denied. Site/metering own DELETE needs M **and** W; invoice own DELETE needs P **and** W; PoA/underlay/webhook authenticated DELETE requires S plus W, which does not pass for a normal authenticated role claim. Tables without any applicable permissive DELETE have no policy-permitted DELETE even when W=true.

These are catalog conditions, not successful operation claims: helper definitions/ACLs, SELECT visibility, triggers/FKs and data shape remain gates. Observed service_role BYPASSRLS means absence of its permissive DELETE is not a service DELETE denial; test setup must use the real SQL role and coherent JWT claims, not evaluate service policy text as its entire access model.

## Exact policy dependency inventory

The full expressions contain exactly the following eight function call names. Expected signatures/schema names derive from the prior source atlas; current `pg_depend`/function identity must confirm the OIDs because most observed calls are deparsed unqualified.

| Expected function identity | Occurrences across all USING/CHECK strings | Actual use |
|---|---:|---|
| public.gridex_user_is_platform_admin() |151|Lifecycle/read/write/platform-delete branches|
| public.gridex_can_read_company(uuid) |66|Permissive tenant reads/old-row update branches|
| public.gridex_can_write_company(uuid) |160|All lifecycle mutations and permissive write branches|
| public.gridex_is_current_session_allowed() |10|One lifecycle SELECT per table|
| public.gridex_user_company_ids() |10|One lifecycle SELECT per table|
| public.gridex_has_permission(uuid,text) |8|Sites/metering masterdata.write I/U/D|
| auth.uid() |10|Eight M calls plus two portal service SELECTs|
| auth.role() |28|Service-role conditions in underlay/PoA/webhook policies|

No direct call to canonical context, company-scoped permission wrapper or user metadata appears in these expressions. That does not establish what the eight functions call internally. In particular, public.gridex_has_permission's actual current body and shared-vs-company semantics are required; the accepted11a candidate is an independent overlay and must not be silently treated as the connected database's current helper.

Direct relation references beyond each target's own columns occur in two service SELECTs:

* customer_invoice_lines: `EXISTS` over customer_invoices ci JOIN customer_portal_accounts cpa ON cpa.customer_id=ci.customer_id, where ci.id=customer_invoice_lines.invoice_id, cpa.user_id=auth.uid(), cpa.is_active=true; OR the existing P/(nonnull company AND R) branch.
* customer_invoices: `EXISTS` customer_portal_accounts cpa matching cpa.customer_id=customer_invoices.customer_id, cpa.user_id=auth.uid(), cpa.is_active=true; OR the existing P/(nonnull company AND R) branch.

Thus public.customer_portal_accounts(customer_id,user_id,is_active), public.customer_invoices(id,customer_id) and invoice_lines.invoice_id must exist with exact types/ACLs when all110 policies are parsed. Service bypass does not excuse an unresolvable relation in CREATE POLICY. Other than these portal fields, the policy expressions use target company_id. Literal masterdata.write is the only named permission key directly referenced.

## Classification and source-atlas differences

Nine tables are classified tenant; audit_logs is mixed. All classification timestamps are `2026-09-02T08:44:17.700543+00:00`. Audit explicitly describes NULL-company platform events and has classified_by=`migration:table_classification_mixed_scope`; others use `migration:platform_table_classification`. These fields are current metadata, not proof of migration execution or NOT NULL/FK validation. Audit needs a separate synthetic NULL-company characterization; do not force it into a tenant-only schema. With an ordinary nonplatform actor, the observed SELECT guard does not admit NULL via membership comparison; platform visibility still depends on the real helper.

Current privileges prevent September09:40's grantless reclassification for these ten and protect authenticated-target guards from its grantless-policy removal predicate. Absence of anon/dead-role policies is compatible with cleanup, but neither prior roles/policies nor actual drop history were observed. Classification tenant can enroll a relation in September composite-FK step2 only if the actual FK predicates also hold; no FK conclusion follows from this receipt.

| Difference from prior finite selected-source expectation | Supported current fact | Consequence |
|---|---|---|
| Customers/contracts/audit selected tenant family supplied platform DELETE | No authenticated permissive DELETE currently | Current own-delete contract cannot copy selected-only expectation. Historical removal authority still unresolved. |
| Sites/metering selected DELETE was platform predicate, with no M branch in the finite atlas | Current D=M and I/U include M | Add actual shared-permission helper/inputs and positive+negative permission controls; no invented new key mapping. |
| Underlays/PoA selected DELETE union included platform OR service | Current D=S only | Do not expect authenticated platform JWT alone to delete. |
| Invoices/lines selected-only atlas predicted DB1 policies/no consolidation/no permissive D | Both have generated policies, true authenticated SELECT and P DELETE; service SELECT contains portal relation predicates | Current catalog has concrete additional source effects. Pin those observed policies and retrieve dependencies; do not import unclassified sources to guess provenance. |
| Old checked-in snapshot characterization had audit DB1-only policies | Current audit has generated +performance policies and service true branches | Snapshot is not the current oracle. Generated-name formula alone does not identify the old union's sources. |
| Webhook selected pipeline predicted tenant/platform read and service writes | Current family matches that outline; I/U/D contain duplicate S disjuncts | Preserve exact expression and provenance uncertainty; duplicated terms cannot identify a specific historical predecessor. |

No finding here is classified as an exploitable tenant bypass: current helper behavior, authentic caller state, graph constraints and business permission expectations are still unverified.

## Next query allowlist: fixed first wave

This is a **proposed read-only catalog scope**, not SQL executed in this lane. Use one coherent catalog receipt with project/version/ledger/time and unchanged roles/ACL/policy fingerprint. Exact metadata roots are the following12 relations (ten CRUD +two extra18-reference tables):

```text
public.customers
public.customer_sites
public.metering_points
public.customer_contracts
public.powers_of_attorney
public.billing_underlays
public.customer_invoices
public.customer_invoice_lines
public.audit_logs
public.webhook_deliveries
public.customer_legal_acceptances
public.contract_price_snapshots
```

Fixed policy/helper-state support allowlist,12 additional relations, all metadata only:

```text
auth.users
public.companies
public.company_memberships
public.user_roles
public.roles
public.permissions
public.role_permissions
public.user_permissions
public.user_permission_overrides
public.user_profiles
public.admin_users
public.customer_portal_accounts
```

The support entries are finite expected dependencies from the previously traced helpers plus the newly observed portal/permission branches, not proof all are used by the connected bodies. Their exact schemas are needed for synthetic actor/permission setup; no table rows or role assignment data may be read. Reconstruct support-table policies and ACLs too where caller/invoker access can reach them; definer access must use the real owner/security mode.

| Catalog read | Exact selection boundary | Required fields/output |
|---|---|---|
| Relation/namespace | Resolve only the24 names above, retaining a missing-object result | OID/name/schema/relkind/owner/RLS/FORCE/ACL, namespace owner/ACL, effective schema/table privileges for test roles; view definition/security_invoker only if a named relation is actually a view |
| Columns/defaults | pg_attribute for those24 relation OIDs; positive attnum/not dropped; left join pg_attrdef and pg_type | Column ordinal/name/type OID+format/collation/notnull/identity/generated/inheritance/default pg_get_expr/attacl; no row samples |
| Table/domain checks and unique/index definitions | pg_constraint.conrelid in24 OIDs; domain constraints only for column domain type OIDs; pg_index.indrelid in24 | Name/type, exact pg_get_constraintdef, columns/validation/deferrability, backing index definition/predicate/expressions/uniqueness/validity/readiness; retain FK action/match properties explicitly |
| Outbound FK edges | pg_constraint.contype='f' AND conrelid in24 | Child+parent qualified names/OIDs/columns, exact definition, ON DELETE/UPDATE, MATCH, validation/deferrability. Return parent **names and referenced-key metadata** outside24; no unbounded parent-table dump |
| Inbound FK edges relevant to DELETE/reassignment | contype='f' AND confrelid in12 test roots | Same edge metadata and child table names. Cascades/SET NULL can mutate children and fire triggers; do not infer an isolated DELETE from outgoing edges alone |
| Triggers and rules | pg_trigger.tgrelid and pg_rewrite.ev_class in24 | All enabled/disabled/internal triggers with OID/name/tgenabled/tgisinternal/constraint linkage/function OID and pg_get_triggerdef; rule definition for non-view DML rules; never execute them |
| Policy dependencies | pg_depend.classid=pg_policy for all policies of24 relations; include catalog of new12 relations | Referenced function/relation/type/operator identities and schema-qualified signatures; exact roles/mode/command/USING/CHECK, not guessed search_path resolution |
| Expression dependencies | pg_depend for selected pg_attrdef/pg_constraint/index objects, plus exact type metadata | Referenced function/operator/type/sequence names/OIDs. Owned/identity sequences: pg_sequence configuration+owner/ACL only, **no last_value/is_called/current business counters** |
| Direct policy functions | Exact eight expected signatures listed above, resolved and checked against observed policy dependency OIDs | pg_get_function_identity_arguments/result/functiondef, owner/ACL, language, security mode, volatility/strictness/parallel/leakproof/config/search_path and effective EXECUTE for relevant roles; record missing/mismatching signature rather than fallback |
| Direct row functions | Function OIDs from the allowed trigger/default/check/index/rule dependencies only | Same function metadata/definitions for user-defined routines; pg_catalog/extension built-ins need exact signature/version/security/ACL identity, not every server function body |

## Bounded follow-up and admission stop conditions

Do not query every public function/table or recursively dump the schema. First-wave foreign-key/function/expression output becomes an explicit, reviewed second-wave **name/OID/signature allowlist**, preserving the edge that justified each entry. Collect missing referenced parents/key definitions and potential cascade children only from those returned edges. Collect invoked helper and write-sink definitions only when directly demonstrated by an allowed current function body. For PL/pgSQL/dynamic SQL, pg_depend alone is not complete: inspect the admitted body and retain unknown/dynamic targets as blockers. Do not invoke application RPCs, auth functions, triggers, custom “introspection” helpers or extension network functions to discover dependencies.

Already-known candidate dependencies to reconcile against returned identities include webhook_subscriptions/domain_events for deliveries; power_of_attorney_scopes for PoA materialization; contract/publication/product/price-plan/snapshot parents for contracts/invoices; numbering sequences and side-effect tables for customer/site/event/projection triggers. These examples are **not an additional blanket query authorization**. The earlier source atlas identifies relevant source sites, but current metadata must prove each exact target and shape. Refuse silent omission, limit truncation or placeholder schemas when a needed dependency lies outside the frozen list.

Retain the exact18 edges: sites.customer_id; metering.customer_id/site_id; contracts.customer_id/site_id/customer_site_id/metering_point_id; legal_acceptances.customer_id/contract_id; PoA.customer_id/site_id/metering_point_id; underlays.customer_id/customer_contract_id/contract_id/site_id/metering_point_id; snapshots.contract_id. Admit observed constraints/guard bodies for each, including both underlay contract aliases and their actual priority. Hidden foreign parents under invoker RLS can yield23503/FK rejection rather than the isolated guard fixture's23514. Preserve null/not-found controls and separate combined RLS/FK evidence from isolated trigger semantics.

Ready-to-author admission requires:

1. Coherent current24-root metadata and closed finite dependency list, plus exact current function definitions/ACLs mapped to pinned repository bytes or an explicitly recorded observed-body discrepancy. New connected definitions do not rewrite historical source files or manifests.
2. An observed-state reconstruction manifest with exact110 target policies/40 guards, current role+ACL profile and graph/side-effect schema. Pin raw expressions and command/role/mode; materialize the admitted final catalog directly. Do not rerun June/September transformations against fabricated preimages to claim history.
3. Declared per-table own-operation expectations from the current policy table above. Add M true/false and W true/false site/metering DELETE controls; invoice platform/nonplatform DELETE controls; customer/contract/audit absent-permissive DELETE controls; ordinary/service webhook and underlay/PoA controls. Named permission held in another company is a characterization of the actual shared helper plus W until source/business contract establishes its intended scope, not an automatic finding.
4. Synthetic A/B rows and actual SQL-role/JWT controls reaching real row constraints/triggers, unchanged-row and side-effect multisets, and exact failure attribution. No100-CRUD/18-reference acceptance before native execution. The16 access-table family and managed API/runtime binding require their own still-open admissions.

No Task11a/11c candidate change follows automatically from this assessment. New current masterdata.write consumers and observed-vs-selected policy differences are inputs to the later reviewed11b integration gate.

## Verification receipt

Both supplied file byte lengths/SHA-256 values matched. Shared metadata equality passed. Parsed all110 policies and read all38 distinct exact USING/CHECK strings, retaining null-vs-expression distinctions; counts70 permissive/40 restrictive,59 generated names,9 tenant/1 mixed classification verified. Every generated name matched the source digest formula. No source mutation, DB/native query or customer-row access occurred in this lane. This is a completed finite prep report, not an accepted fixture or production/historical-policy claim.
