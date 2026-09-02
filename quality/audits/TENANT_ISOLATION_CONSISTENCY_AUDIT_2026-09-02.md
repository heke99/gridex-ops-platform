# Gridex OPS — tenant-isolation and system-consistency audit

Date: 2026-09-02
Scope: live schema `gridex-ops-dev` (`piidsfebjqjmnepdpnas`, 499 public tables),
application code under `app/` and `lib/`, RLS policy set, permission engine.
Nature: read-only assessment. No production code or schema was changed.

## 1. Skill routing

Activated: `acquire-codebase-knowledge`, `supabase`,
`supabase-postgres-best-practices`, `code-security`, `security-threat-model`,
`find-bugs`, `fp-check`, `spec-to-code-compliance`.
Conditional, not reached: `systematic-debugging`, `test-driven-development`,
`refactor`, `variant-analysis` — these activate on remediation, which the user
did not request in this pass.
Skipped with reason: `semgrep`/`codeql`/`sarif-parsing` (the question is tenant
semantics, not pattern-level static analysis); `web-design-guidelines`,
`vercel-react-best-practices`, `performance-optimization` (no UI or performance
scope); `install-hooks` (no consent requested); `using-git-worktrees` (single
audit branch).

## 2. Baseline inventory (evidence)

| Fact | Value |
|---|---|
| Public tables | 499 |
| Tables carrying `company_id` | 363 |
| Tables with RLS disabled | 0 |
| Tables with `company_id` NOT NULL | 217 |
| Tables with `company_id` nullable | 146 |
| Composite `(…, company_id)` foreign keys | 130 |
| Application files using the service-role client | 444 |

## 3. How isolation is actually enforced

Two independent layers exist, and they do not agree with each other.

**Database layer.** The permissive policy set is deliberately wide. A policy
`gridex_perf_authenticated_select_v1` with `USING (true)` for role
`authenticated` exists on ~110 tenant tables, and many write policies grant on
a bare permission check such as
`gridex_has_permission(auth.uid(),'masterdata.write')` with no row/tenant
binding. Isolation is carried entirely by a separate **restrictive** family,
`tenant_lifecycle_select_guard` / `_insert_guard` / `_update_guard` /
`_delete_guard` / `tenant_lifecycle_anon_deny_guard`, which AND in
`company_id IN (SELECT gridex_user_company_ids())` or
`gridex_can_write_company(company_id)`.

Verified: every `company_id` table that has an open permissive policy also
carries a matching restrictive guard, for SELECT and for INSERT/UPDATE/DELETE.
Query returned zero unguarded tables in both directions. **The database layer
holds.**

**Application layer.** 444 files import `lib/supabase/service.ts`, which is a
`service_role` client. `service_role` bypasses RLS entirely, including the
restrictive guards above. For all normal application traffic the database
layer described above is therefore *not* the enforcing layer — per-query
`.eq('company_id', …)` discipline is.

This is the structural fact behind everything in section 4: the layer that was
verified sound is not the layer that most requests go through.

## 4. Confirmed findings

### F-1 — Application permissions are the union across all of a user's companies (High)

`lib/admin/guards.ts:107` calls
`canonical_authenticated_tenant_context` with `p_selected_company_id: null`.

The scoped implementation `canonical_authenticated_tenant_context_v1_scoped`
resolves permissions correctly:

```sql
and (user_role.company_id is null or user_role.company_id = v_selected_company_id)
```

The wrapper then **overwrites** that result whenever no company is passed:

```sql
if p_selected_company_id is not null or not authorized ... then return v_context; end if;
-- otherwise re-computes roles/permissions with only:
and (user_role.company_id is null
     or exists (select 1 from company_memberships ... membership.company_id = user_role.company_id))
```

The company filter is gone; only *membership somewhere* is required. The
returned `permissions` array is the union over every company the user belongs
to. `requirePermissionServer` / `requireAdminPageAccess` /
`hasPermissionRequirement` all test that flat array, while the operating
company is chosen independently by `getOperationalCompanyScope`
(`lib/tenant/scope.ts`).

Impact: a user who is `finance` in company A and `viewer` in company B passes
`billing.write` while operating in company B. Business impact is wrong-company
writes on billing, pricing, masterdata and switching surfaces.

Status: confirmed by code. **Not reproducible on the dev dataset** — no user
there holds memberships in more than one company (verified: all 7 memberships
map to a single company per user), so no live exploit trace exists. The defect
is in the resolution logic, not in the data.

### F-2 — `gridex_get_user_permissions` ignores tenancy and role status (High)

```sql
from public.user_roles ur ... where ur.user_id = p_user_id
  and coalesce(ur.is_active, true) = true
```

`ur.company_id` is not referenced at all, and `ur.status` is not checked even
though `user_roles_status_check` allows `disabled`, `removed_from_company`,
`invitation_revoked`, `locked_security`. `user_permissions` rows are read with
no active/expiry condition either.

Consequences:
1. `gridex_has_permission(uid, 'x')` is a **global** boolean, unbound to any
   company. Every RLS policy that ORs it in is tenant-blind on its own terms.
2. A user whose role was set to `removed_from_company` keeps the permission,
   because only `is_active` is consulted.
3. The two permission engines disagree: `canonical_authenticated_tenant_context_v1_scoped`
   checks `status`, membership and `role.is_active`; `gridex_get_user_permissions`
   checks none of them. The same permission string resolves differently
   depending on which path asks.

Currently contained at the database layer by the restrictive
`tenant_lifecycle_*` guards (see F-6 for why that containment is fragile), but
**not** contained on service-role paths.

### F-3 — 21 736 canonical energy-flow events carry no tenant (High)

`canonical_energy_flow_events`: 21 736 of 21 819 rows have `company_id IS NULL`.
Its restrictive guard is `company_id IN (SELECT gridex_user_company_ids())`;
`NULL IN (…)` evaluates to NULL, never TRUE. Those rows are therefore invisible
to every tenant user and readable only by platform admin.

The canonical energy event stream — the spine of the flow model — is 99.6 %
unattributed.

### F-4 — Inbound EDIEL manual review is unreachable by any tenant (High)

| Table | Rows | `company_id IS NULL` | Status |
|---|---|---|---|
| `inbound_email_messages` | 44 | 22 | all `manual_review` |
| `inbound_processing_jobs` | 20 | 20 | all `manual_review` |
| `inbound_ediel_parse_results` | 45 | 22 | — |
| `inbound_email_attachments` | 9 | 9 | — |

Every inbound processing job in the system is queued for manual review with no
tenant. By the same NULL-versus-`IN` semantics, no tenant operator can see or
action them. Work exists that nobody is able to reach. `ediel_messages` itself
is clean (7/7 attributed) — the break is upstream, in the inbound
attribution step.

### F-5 — Further untenanted operational and audit data (Medium)

| Table | NULL / total | Why it matters |
|---|---|---|
| `tenant_email_outbox_runs` | 21 852 / 21 852 | a `tenant_`-prefixed table with zero tenant attribution |
| `audit_logs` | 1 258 / 7 981 | 16 % of audit events are unattributable to a company |
| `integration_api_requests` | 521 / 8 878 | API usage not billable or traceable to a tenant |
| `customer_operation_tasks` | 3 / 7 | tasks whose customer, site and metering point all belong to `b3ad1bf6…` while the task row itself is NULL — invisible to that tenant |
| `communication_log_events` | 21 / 30 | |
| `tenant_governance_events` | 6 / 40 | |
| `ediel_certificate_refresh_jobs` | 1 288 / 1 288 | |

Shared reference data (`grid_owners`, `electricity_suppliers`,
`ediel_error_rules`, `ediel_aperak_error_rules`, `consumption_profiles`,
`ediel_field_matrix_rules`, `spot_price_import_jobs`) also shows NULL
`company_id` — that is correct by design for platform-global masterdata and is
**not** counted as a defect. The two categories are not distinguishable by
schema today, which is itself the root cause of F-6.

Cross-parent drift found by comparing every child/parent pair where both carry
`company_id` (~400 pairs): `customer_operation_tasks` (3 rows on each of
customer/site/metering-point), `customer_sites.grid_owner_id` (2),
`customer_sites.selected_grid_owner_id` (1), `manual_inbound_messages.grid_owner_id`
(2), `ediel_route_profiles.receiver_certificate_id` (1),
`inbound_ediel_parse_results.inbound_email_message_id` (1),
`tenant_integrity_findings.run_id` (6). No case was a genuine A-reads-B
cross-tenant link; all resolve to a NULL on one side. `communication_routes.grid_owner_id`
(351) is the shared-masterdata case above, not drift.

### F-6 — Isolation depends on a guard nothing enforces the presence of (Medium, structural)

Because the permissive layer is open by construction, a new `company_id` table
is cross-tenant-readable the moment it is created and stays that way until
someone remembers to attach `tenant_lifecycle_*`. Today the coverage is
complete, but no constraint, migration test or CI gate was found that fails
when a new tenant table ships without the restrictive guards or without
`company_id NOT NULL` (146 tables are still nullable). The correct state is
currently maintained by convention.

### F-7 — Platform-admin status is inferred from role names, not from company scope (Medium)

`lib/admin/guards.ts` computes the final `isPlatformAdmin` as
`isPlatformAdminContext(base)`, which is `roles.some(isPlatformAdminRole)` —
a pure string test over the role list, **overriding** the database's
authoritative `context.is_platform_admin`. The SQL equivalent
`gridex_user_is_platform_admin()` correctly requires `ur.company_id IS NULL`;
the TypeScript path does not. Combined with F-1's union of roles, a
company-scoped `super_admin` / `platform_admin` row would grant
platform-admin across the entire application, and
`assertCompanyAccessForGuard` in `lib/tenant/entityGuards.ts` returns any
requested company id unchecked for such a caller.

No database constraint prevents a company-scoped platform role
(`user_roles` has only an FK and a status CHECK), and no such row exists today.
Role assignment is gated behind `requirePlatformAdminActionAccess`, so this is
**latent, not currently exploitable** — a defence-in-depth gap, and the
TS/SQL divergence is real regardless.

## 5. False positives (checked and dismissed)

- **`customer_sites` / `metering_points` / `customer_authorization_documents`
  cross-tenant write via `masterdata.write`.** The permissive policies do allow
  it — verified live: user `08bbafb2…` (member of `aa121d1e…` only, not
  platform admin) evaluates the permissive UPDATE/DELETE expression to TRUE
  against rows owned by `b3ad1bf6…`. But the restrictive
  `tenant_lifecycle_update_guard` / `_delete_guard`
  (`gridex_can_write_company(company_id)`) ANDs it back to FALSE. Not
  exploitable at the database layer. Recorded because the permissive
  expressions are still wrong on their own terms and feed F-6.
- **`tenant_integrity_audit_runs` / `tenant_integrity_findings` with
  `USING (true)`.** Granted to `service_role` only.
- **`deleteCustomerForRecreateImpl` deleting a customer graph with no company
  filter.** Gated by `requirePlatformAdminActionAccess()` plus a test-data-only
  check; cross-tenant reach is the intended platform-admin capability.
- **~470 service-role query sites flagged by a `.from(<tenant table>)`-without-
  `company_id` scan.** Sampled across the highest-risk tables
  (`customers`, `customer_contracts`, `powers_of_attorney`,
  `customer_authorization_documents`): the sampled cases filter by an id whose
  tenant was already verified upstream, or derive their id list from a
  company-filtered query, or the filter sat outside the scanner's window.
  `app/admin/customers/[id]/page.part-4.tsx:134` shows the correct pattern
  (`customer.company_id !== tenantScope.companyId` → reject). The scan is a
  lead list, not a finding; see section 7.

## 6. Blocked checks

- Production parity is unverifiable: no production Supabase project is visible
  to this session (matches `.agent-memory/open-blockers.md`). All evidence is
  from `gridex-ops-dev`.
- F-1 could not be exercised end to end because the dev dataset has no
  multi-company user. Proving it live needs a seeded two-company user, which
  would mutate shared dev data and was not done.
- Per-message EDIEL business semantics (Z03/Z04/APERAK/UTILTS field- and
  state-level conformance against the rule packs) were not audited. That is a
  separate body of work; this pass covered message **tenant attribution**,
  which is where the break is.

## 7. Recommended remediation, smallest reviewable units first

1. **F-1** — pass the resolved operational company into the context call, or
   delete the union branch from `canonical_authenticated_tenant_context` so it
   always delegates to the scoped variant. One-line call-site change plus a
   forward migration. Add a two-company regression test.
2. **F-2** — add `p_company_id` to `gridex_get_user_permissions`, filter on
   `ur.company_id`, and check `ur.status = 'active'` and membership. Update the
   policies that call it. Forward migration only.
3. **F-7** — derive `isPlatformAdmin` from the database's
   `context.is_platform_admin` instead of re-deriving it from role names; add a
   partial unique/CHECK constraint forbidding platform roles with a non-null
   `company_id`.
4. **F-3/F-4/F-5** — backfill `company_id` from the already-correct parent rows
   (customer/site/metering point/mailbox), then set `NOT NULL` on the tables
   that are genuinely tenant-owned. Introduce an explicit marker (a
   `is_platform_global` column or a documented allowlist) separating shared
   masterdata from tenant data so the two NULL populations stop being
   indistinguishable.
5. **F-6** — add a CI/migration gate asserting that every table with
   `company_id` has the `tenant_lifecycle_*` restrictive guards and, unless
   allowlisted as shared masterdata, `company_id NOT NULL`.
6. **F-1/F-2 follow-up** — reduce service-role usage on request paths, or
   introduce a lint rule requiring an explicit company predicate on
   service-role queries against tenant tables, so isolation stops resting on
   444 files of manual discipline.

## 8. Verification matrix

| Check | Method | Result |
|---|---|---|
| RLS enabled on all public tables | `pg_class.relrowsecurity` | 0 disabled |
| Open permissive SELECT without restrictive company guard | policy-set query | 0 tables |
| Open permissive INSERT/UPDATE/DELETE without restrictive guard | policy-set query | 0 tables |
| Permissive write policies with tenant-unbound predicate | policy-set query | 9 tables (contained; F-6) |
| Live evaluation of tenant-unbound predicate as a real non-admin user | `set_config('request.jwt.claims')` + predicate evaluation | TRUE on foreign-tenant rows; restrictive guard ANDs to FALSE |
| Child/parent `company_id` drift across ~400 FK pairs | `query_to_xml` dynamic counts | 11 pairs non-zero; all NULL-side or shared masterdata |
| NULL `company_id` census | dynamic counts over 363 tables | 40 tables affected; F-3/F-4/F-5 |
| `company_id` NOT NULL coverage | `pg_attribute.attnotnull` | 217 of 363 |
| Service-role blast radius | import graph of `lib/supabase/service.ts` | 444 files |
| Permission-resolution divergence | `pg_get_functiondef` on both context functions | confirmed (F-1, F-2) |

No tests were executed and no build was run: this pass changed no code.

---

# Addendum — second pass: other mismatch classes

Follow-up question: *"har vi andra mismatches utöver detta?"* and
*"varje kund ska vara konsekvent så att inget blir fel också"*.
The first pass tested one axis: `company_id`. This pass tests the axes it did
not — the customer chain, unique business keys, views, and constraint validity.

## 9. Customer-chain consistency

**Data is clean.** Every check below returned zero rows:

| Check | Result |
|---|---|
| `customers` without `company_id` | 0 |
| `metering_points.customer_id` vs its site's customer | 0 |
| `customer_contracts.site_id` pointing at another customer's site | 0 |
| `customer_invoices.customer_id` vs its contract's customer | 0 |
| `billing_underlays.customer_id` vs its metering point's customer | 0 |
| `supplier_switch_requests` vs its site's customer | 0 |
| `powers_of_attorney` vs its site's customer | 0 |
| `customer_authorization_documents` vs its PoA's customer | 0 |
| sites / metering points / contracts without `customer_id` | 0 |
| generic `customer_id` drift over all single-column FK pairs | 1 pair, 6 rows, all NULL-side (`canonical_energy_flow_events.resolution_id`), 0 real conflicts |

Caveat: the dev dataset holds 3 customers. Clean data here is weak evidence.
What matters is whether it is *enforced*, which is F-12.

### F-12 — The customer chain is enforced on 22 of 99 tables (Medium)

36 composite foreign keys carrying `customer_id` exist, covering the
money-and-legal path: `customer_contracts`, `customer_invoices`,
`customer_sites`, `metering_points`, `powers_of_attorney`,
`customer_authorization_documents`, `supplier_switch_requests`,
`billing_underlays`, `invoice_export_items`, `customer_portal_identities`,
`grid_owner_data_requests`, `website_customer_applications` and others. On
those tables a row physically cannot reference a parent belonging to a
different customer. That is the right design and it is working.

77 of the 99 tables carrying `customer_id` have no such guard, including:

`customer_addresses`, `customer_contacts`, `customer_documents`,
`customer_internal_notes`, `customer_notifications`, `customer_communications`,
`customer_cases`, `customer_case_events`, `customer_blockers`,
`customer_operation_jobs`, `customer_operation_tasks`,
`customer_portal_claims`, `customer_portal_completions`,
`customer_portal_requests`, `customer_site_address_history`,
`customer_site_resolution`, `customer_lifecycle_events`, `customer_merge_events`.

On these, an address, a contact, a document, an internal note or a
notification can be attached to the wrong customer with nothing in the schema
objecting. Nothing is wrong today; nothing prevents it either. Given the first
pass showed the application runs on `service_role` (RLS off), these tables are
protected by application discipline alone.

## 10. Unique keys that are not tenant-scoped

Most unique indexes on tenant tables are scoped through a parent id that is
itself tenant-bound (e.g. `contract_offer_versions(contract_offer_id,
version_number)`) and are correct. The following are not, and each one means a
second tenant collides with the first.

### F-8 — Customer numbers can collide across tenants and block onboarding (High)

`customers_customer_number_key` is `UNIQUE (customer_number)` **globally**,
while numbers are allocated **per company**:
`gridex_next_customer_number(p_company_id)` reads
`max(...)+1` scoped to `where company_id = p_company_id`, defaulting to
`100001`, and prefixes it with `gridex_default_customer_number_prefix()`.

The prefix is derived, short, and **not unique**. Verified: no unique index on
`company_customer_number_sequences.prefix`, none on
`companies.customer_number_prefix`.
`gridex_normalize_customer_number_prefix` strips exactly the words that
distinguish Swedish electricity retailers — `EL`, `ENERGI`, `ELHANDEL`,
`ENERGY`, `POWER`, `AB`, `HB`, `KB` — then collapses multi-word names to
**initials**. Two-word names therefore become two letters. Live prefixes today:

| Company | Prefix |
|---|---|
| Gridex El AB | `DX` |
| Green Hero Energy AB | `GHE` |
| Nibela AB | `NIBELA` |
| Test bolag | `TESTIN` |

Two tenants resolving to the same prefix both allocate `PREFIX-100001` for
their first customer. The second insert fails on the global unique index
(23505). Tenant B cannot onboard its first customer.

### F-9 — Only one "own supplier" can exist platform-wide (High)

```sql
CREATE UNIQUE INDEX electricity_suppliers_single_own_supplier_idx
  ON public.electricity_suppliers USING btree (is_own_supplier)
  WHERE (is_own_supplier = true);
```

The predicate has no `company_id`. In a platform where every tenant *is* an
electricity supplier and needs to mark itself, exactly one row in the entire
database may carry `is_own_supplier = true`. This is a single-tenant leftover.
Currently unexercised (0 such rows; all 9 supplier rows have `company_id IS
NULL`), so it is latent, not yet failing.

`electricity_suppliers_org_number_unique_idx` and
`electricity_suppliers_name_unique_idx` are global for the same reason and
prevent two tenants from holding their own record of the same counterparty.

### F-10 — Metering point identifiers are globally unique (High)

```sql
CREATE UNIQUE INDEX metering_points_metering_point_id_key
  ON public.metering_points USING btree (metering_point_id);
```
plus the same on `meter_point_id` and `ediel_reference`.

`metering_points.metering_point_id` is NOT NULL and globally unique, while
`company_id` and `customer_id` on the same table are nullable and the rows are
tenant-scoped. A Swedish anläggnings-ID is a *national* identifier for a
physical facility — and supplier switching, the core function of this product,
means the same facility moves between suppliers. Two tenants on this platform
cannot both hold a row for the same metering point, whether concurrently during
a switch or sequentially after one.

Verified the failure mode is a blocked insert, not silent corruption:
`upsertApplicationMeteringPoint` (`app/admin/website-applications/actions.ts:504`)
does a plain INSERT with no `onConflict`, and its UPDATE branch is correctly
scoped by `.eq('company_id', …)`. The only `onConflict` on this key elsewhere
is `company_id,metering_point_id,period_month` on a different table, correctly
company-scoped. So tenant B's onboarding fails with 23505 rather than
overwriting tenant A's row. The existing `facilityConflictStatus` branch
suggests the conflict is known but handled as an application state, not fixed
at the schema level.

### F-11 — Identical legal text blocks the second tenant (Medium)

`legal_bundle_versions_content_sha256_key` is `UNIQUE (content_sha256)`
globally. Two tenants publishing the same standard terms — the normal case
when both start from a template — produce the same hash, and the second
insert fails.

### Reviewed and accepted as correct

- `ediel_actor_settings_unique_active_production_ediel_idx` — an EDIEL ID is a
  genuine market-wide identifier; global uniqueness per environment is right.
- `grid_owners_ediel_id_key` / `_code_key` / `_owner_code_key`,
  `spot_price_import_jobs(provider, price_area, calendar_date)`,
  `ediel_*_rules` keys — shared platform masterdata (all rows have
  `company_id IS NULL`). Correct today, but they inherit F-5/F-6: nothing
  distinguishes "shared reference row" from "tenant row" in the schema, so a
  tenant-specific override would collide.
- `automation_key` collisions: checked the generator
  (`customer_site_${siteId}_supplier_switch`,
  `lib/customer-operations/supplierSwitchOrchestration.ts:615`). The key embeds
  a UUID, so it is globally unique by construction. **Not a finding.**
- Token/credential uniques (`integration_api_clients.key_prefix`,
  `customer_contract_signature_requests.token_hash`,
  `company_invitations.token`) — global uniqueness is the point.

## 11. Other structural checks

| Check | Result |
|---|---|
| `NOT VALID` constraints (unenforced legacy) | **0** — clean |
| Views with `security_invoker = true` | 157 |
| Views without `security_invoker` (run as owner, bypass RLS) | 3 — F-13 |
| Materialized views | 0 |
| Composite FKs including `company_id` | 130 |

### F-13 — Three views run with owner privileges (Low)

`gridex_public_contract_offer_api_diagnostics_v`,
`contract_publication_readiness_v`, `gridex_tenant_contract_readiness_v` are
owned by `postgres` and lack `security_invoker`, so they read their base tables
with RLS bypassed. **Verified not exploitable:** none of the three carries any
grant to `anon`, `authenticated`, `authenticator` or `PUBLIC`, so PostgREST
cannot reach them. Hygiene gap, and a trap if a grant is ever added.

## 12. Revised priority

1. F-10 metering point global uniqueness — blocks the product's core flow
2. F-8 customer number prefix collision — blocks tenant onboarding
3. F-1 permission union across companies (first pass)
4. F-2 tenant-blind permission function (first pass)
5. F-9 single own-supplier row
6. F-3/F-4/F-5 untenanted rows (first pass)
7. F-12 unguarded customer chain on 77 tables
8. F-11 legal bundle hash, F-6 missing guard gate, F-7 platform-admin inference,
   F-13 view hygiene

F-8, F-9, F-10 and F-11 share one root cause: **unique constraints written for
a single-tenant world were never re-scoped when the platform became
multi-tenant.** The fix in each case is to add `company_id` to the index
(and, where the identifier is genuinely market-wide, to say so explicitly
rather than leaving it implied).
