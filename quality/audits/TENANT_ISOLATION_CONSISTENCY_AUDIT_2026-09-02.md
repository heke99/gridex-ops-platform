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
