# Gridex OPS — consolidated findings register and multi-tenant target architecture

Date: 2026-09-02
Source evidence: `TENANT_ISOLATION_CONSISTENCY_AUDIT_2026-09-02.md` (both passes).
Readable version: https://claude.ai/code/artifact/b02bcf86-1497-451c-97b8-5991b4d04e90
Nature: assessment and design. No production code or schema changed.

## Root causes

All fifteen findings reduce to three:

1. **Wrong enforcing layer.** RLS is correctly configured but bypassed by the whole
   application; isolation rests on 444 files each remembering to filter.
2. **Permissions without a company.** Two permission engines disagree, and both can
   answer yes for the wrong company.
3. **Single-tenant keys.** Unique indexes on metering point ids, customer numbers,
   own-supplier and legal text were never re-scoped for multi-tenancy.

## Register

| ID | Severity | Finding | Where |
|---|---|---|---|
| F-10 | Critical | Metering point identifiers globally unique — blocks supplier switching, the product's core flow. Tenant B's insert fails with 23505; verified not an overwrite. | `metering_points_metering_point_id_key`; `app/admin/website-applications/actions.ts:504` |
| F-1 | High | Application permissions are the union across all of a user's companies. The scoped RPC is correct; the wrapper overwrites it when called with `null`, which the app always does. Proven in code, not reproducible on dev data. | `lib/admin/guards.ts:107`; `canonical_authenticated_tenant_context` |
| F-2 | High | `gridex_get_user_permissions` never references `company_id` and checks only `is_active`, not `status`. Makes `gridex_has_permission()` a global boolean; revoked users keep rights. | `public.gridex_get_user_permissions` |
| F-8 | High | Customer numbers allocated per company behind a global unique index, with a derived, non-unique prefix. Two tenants sharing a prefix collide on their first customer. Live prefixes include a 2-character one (`DX`). | `customers_customer_number_key`; `gridex_next_customer_number` |
| F-4 | High | All inbound EDIEL work is unreachable: 20/20 processing jobs and 22/44 emails sit in `manual_review` with no company. `NULL IN (…)` is never TRUE. `ediel_messages` itself is clean (7/7). | `inbound_processing_jobs`, `inbound_email_messages` |
| F-3 | High | 21 736 of 21 819 `canonical_energy_flow_events` rows carry no tenant — 99.6 % of the flow model's spine invisible to the companies it describes. | `canonical_energy_flow_events` |
| F-15 | High | The entire application runs as `service_role`, verified `rolbypassrls = true`. The row security the audit confirmed does not apply to request traffic. `supabase_privileged_role` already exists with `rolbypassrls = false`. | 444 files importing `lib/supabase/service.ts` |
| F-9 | High (latent) | `UNIQUE (is_own_supplier) WHERE is_own_supplier` has no `company_id` — one own-supplier row platform-wide. Zero such rows today. Org-number and name uniques are global for the same reason. | `electricity_suppliers_single_own_supplier_idx` |
| F-12 | Medium | Customer chain physically enforced on 22 of 99 tables carrying `customer_id` (36 composite FKs cover contracts, invoices, sites, metering points, PoA, switches, underlays). 77 unguarded, including documents, contacts, addresses, notes, notifications. Data clean today (11 checks, 0 rows). | schema-wide |
| F-5 | Medium | Further untenanted rows: `tenant_email_outbox_runs` 21 852/21 852, `audit_logs` 1 258/7 981, `integration_api_requests` 521/8 878, `ediel_certificate_refresh_jobs` 1 288/1 288, `customer_operation_tasks` 3/7. Shared masterdata NULLs are correct and indistinguishable — see F-6. | 40 tables |
| F-6 | Medium | Isolation is carried solely by the restrictive `tenant_lifecycle_*` family; the permissive layer is open by construction (`USING (true)` on ~110 tables). Coverage complete today, but no constraint, test or CI gate enforces it, and 146 tables still allow NULL. | policy set |
| F-14 | Medium | 1 620 policies (≈29 %) target roles holding zero table grants — `supabase_privileged_role` 543, `dashboard_user` 543, `authenticator` 534 — and are provably inert. This is why the policy set cannot be reasoned about by reading it. | policy set |
| F-11 | Medium | `legal_bundle_versions.content_sha256` globally unique; two tenants publishing the same template terms collide. | `legal_bundle_versions_content_sha256_key` |
| F-7 | Medium (latent) | `isPlatformAdmin` re-derived from role-name strings, overriding the database's authoritative value; the SQL equivalent correctly requires `company_id IS NULL`, the TS path does not. No constraint forbids a company-scoped platform role. Role assignment is platform-admin gated, so not currently exploitable. | `lib/admin/guards.ts` |
| F-13 | Low | Three views lack `security_invoker` and read base tables with RLS bypassed. Verified harmless: no grants to `anon`/`authenticated`/`authenticator`/`PUBLIC`. 157 other views are correct. | `gridex_public_contract_offer_api_diagnostics_v`, `contract_publication_readiness_v`, `gridex_tenant_contract_readiness_v` |

## Dismissed after verification

- Cross-tenant write via `masterdata.write` — permissive policies do evaluate TRUE
  against a foreign tenant's rows for a non-admin (verified live), but the restrictive
  `tenant_lifecycle_update_guard` ANDs it to FALSE. Feeds F-6; not exploitable.
- `automation_key` collisions — the generator embeds a UUID
  (`customer_site_${siteId}_supplier_switch`), unique by construction.
- `deleteCustomerForRecreateImpl` — no company filter, but gated by
  `requirePlatformAdminActionAccess()` plus a test-data-only check.
- Six `anon`-granted tables without a deny guard — zero permissive `anon` policies,
  RLS on, therefore deny by default; none is a tenant table.
- Global uniqueness on grid owners, spot prices, EDIEL rule packs and
  `ediel_actor_settings` — shared masterdata / market-wide identifiers; correct.
- ~470 hits from the unfiltered-query scan — sampled across the highest-risk tables;
  each filters on an id whose tenant was verified upstream, derives its id list from a
  company-filtered query, or had the filter outside the scanner's window.
- Customer-chain data integrity — 11 checks, 0 deviations. Zero `NOT VALID` constraints.

## Target architecture

Principle throughout: **move correctness from discipline into the schema.** Each layer
has an invariant verifiable by a query, not by reading code.

### 1. Classify every table
`platform_table_classification(table_name, kind in ('tenant','platform_shared','system'), rationale)`.
Today `company_id IS NULL` cannot be told apart from a broken row — that ambiguity is why
the NULL drift grew unnoticed. *Invariant: every public table has exactly one row; an
unclassified new table fails the build.*

### 2. Tenant membership as a schema rule
For every `tenant` table: `company_id NOT NULL REFERENCES companies(id)` — backfill from
correct parents first, then add the constraint. Bind the chain physically, extending the
existing 22-table pattern to all 99:

```sql
alter table customers add constraint customers_id_company_uk unique (id, company_id);
alter table customer_documents
  add constraint customer_documents_customer_fk
  foreign key (customer_id, company_id) references customers(id, company_id);
```

*Invariant: no row can reference a parent in another company or under another customer.*

### 3. Re-scope the keys
Every unique key on a tenant table includes `company_id`, unless the identifier is
market-wide and that is written down.

```sql
create unique index metering_points_company_mp_uk on metering_points (company_id, metering_point_id);
create unique index customers_company_number_uk   on customers (company_id, customer_number);
create unique index electricity_suppliers_one_own_per_company_uk
  on electricity_suppliers (company_id) where is_own_supplier;
create unique index legal_bundle_versions_company_hash_uk
  on legal_bundle_versions (company_id, content_sha256);
```

A national view of the metering point estate, if needed, becomes its own
`platform_shared` register referenced from the tenant row — never by making the tenant
table's key global. *Invariant: two tenants can hold the same metering point, customer
number series and contract text without knowing about each other.*

### 4. Make RLS the real boundary
The largest change, and the one that makes the rest meaningful.

```sql
create role gridex_app nologin nobypassrls;
grant gridex_app to authenticator;
select set_config('app.company_id', $1, true);   -- per request, transaction-local
create policy customers_app_select on customers for select to gridex_app
  using (company_id = current_setting('app.company_id', true)::uuid);
```

Reserve `service_role` for migrations and genuine system jobs; cross-company jobs set
`app.company_id` per company in their loop rather than running unbounded. Remove the
`USING (true)` policies and the 1 620 inert ones; let the permissive layer bind the
company and keep `tenant_lifecycle_*` as defence in depth, not the reverse.

Transitional step, since 444 files do not move at once: a repository layer where a query
cannot be constructed without a company — `tenantDb(companyId).from('customers')` —
plus an eslint rule banning `supabaseService.from(` outside it, so the remaining direct
calls are measurable in CI. *Invariant: a query without company context returns zero
rows instead of everyone's rows.*

### 5. One permission engine, always with a company
Permission is always a pair: who, and in which company.

```sql
create function app.has_permission(p_company_id uuid, p_permission text)
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp as $$
  select exists (
    select 1 from user_roles ur
      join company_memberships m on m.user_id = ur.user_id and m.company_id = ur.company_id
      join role_permissions rp on rp.role_id = ur.role_id
      join permissions p on p.id = rp.permission_id
     where ur.user_id = auth.uid()
       and (ur.company_id is null or ur.company_id = p_company_id)
       and coalesce(ur.status,'active') = 'active'
       and coalesce(ur.is_active, true)
       and m.status = 'active'
       and coalesce(rp.effect,'allow') = 'allow'
       and p.key = p_permission);
$$;
```

Make the company a required argument in TypeScript too —
`requirePermission(companyId, 'billing.write')` — so it cannot be forgotten. Read
platform-admin status from the database, never derive it from role names, and add a
constraint so a company-scoped platform role cannot be created.

### 6. Attribute at ingestion; quarantine instead of NULL
Resolve the tenant at reception from mailbox or receiver EDIEL id. When it cannot be
resolved, the message lands in an explicit `platform_inbound_quarantine` (kind `system`)
that someone owns. Then `inbound_email_messages`, `inbound_processing_jobs` and
`canonical_energy_flow_events` can take `company_id NOT NULL`. Same for `audit_logs` and
`integration_api_requests`: a genuinely platform-wide event belongs in a system-classed
table, not as a NULL in a tenant table. *Invariant: no row in a tenant table lacks a
tenant; unattributed work is visible in a queue with an owner.*

### 7. Gates that keep it true
Migration tests that fail the build: every table classified; every tenant table has
`company_id NOT NULL` with an FK; every unique index on a tenant table includes
`company_id` unless explicitly exempted with a rationale; every FK between two tenant
tables is composite; every tenant table has a positively-binding RLS policy and no
`USING (true)`; no policy targets a role without grants; every view has
`security_invoker = true`; `supabaseService.from(` appears only in the repository layer.

Plus a **two-tenant fixture**: two companies seeded to collide deliberately — same
metering point id, same customer number prefix, same legal text hash, and one user with
memberships in both under different roles. Run the full flow (offer → customer →
contract → switch → metering → invoice) and assert nothing leaks and nothing collides.
This is exactly what prevented F-1 from being reproduced.

## Delivery order

| PR | Content | Cost |
|---|---|---|
| 1 | Key re-scoping — F-10, F-8, F-9, F-11. Unblocks supplier switching and second-tenant onboarding. | forward migration |
| 2 | Company-scoped permissions — F-1. Remove the union branch, pass the operating company. | small, high impact |
| 3 | One permission engine — F-2, F-7. Scope the function, check status, read platform admin from DB, add the constraint. | migration + guards.ts |
| 4 | Attribution and quarantine — F-4, F-3, F-5. Resolve at reception, backfill, set NOT NULL. | migration + ingest |
| 5 | Classification and gates — F-6, F-14, F-13. | CI work |
| 6 | Full customer chain — F-12. Composite FKs from 22 to 99 tables, in batches of ten. | several migrations |
| 7+ | Connection role — F-15. Repository layer, then the lint rule, then files in batches, then the role switch. | ongoing |

PR 1 and PR 2 are both small and remove the two blockers that directly prevent a second
tenant in production.

## Not covered

- **Production parity.** No production Supabase project is visible; all evidence is from
  `gridex-ops-dev` and the operational counts are that database's.
- **Per-message EDIEL business semantics.** Z03/Z04/APERAK/UTILTS field- and state-level
  conformance against the rule packs is a separate work package. This covered message
  *tenant attribution*, which is where the break is.
- **F-1 live.** Proven in code; dev has no multi-company user, which the layer-7 fixture
  addresses.
- **Dataset size.** Three customers, seven EDIEL messages. Clean data proves little,
  which is why this register weighs schema guarantees above zeroed counts.

---

# Remediation status — 2026-09-02

Implemented on `claude/system-consistency-tenant-isolation-dljtbw`. Five forward
migrations applied and verified against `gridex-ops-dev`; no schema was rewritten.

| ID | Status | What changed |
|---|---|---|
| F-1 | Fixed | `canonical_authenticated_tenant_context` delegates to the scoped resolver; the union branch is gone. Both `lib/admin/guards.ts` and `lib/admin/apiGuards.ts` pass the selected company and share one engine. Verified: a tenant owner resolves 36 permissions in their own company, **0** in a foreign one. |
| F-2 | Fixed | `gridex_get_user_permissions` checks company, `status` and membership; a company-scoped role no longer grants platform-wide. `gridex_get_user_permissions_in_company` / `gridex_has_permission_in_company` added for policy use. Three redundant global `company_admin` rows repaired (verified identical permission sets to the users' `owner` role, so no access lost). |
| F-3 | Corrected, then fixed | The original reading was wrong. All 21 752 untenanted rows are `market_price.*` / `energy_geodata.*` — platform-wide by nature; every tenant event type was already fully attributed. `event_scope` now makes the distinction explicit, coupled to `company_id` by a check constraint. |
| F-4 | Fixed | `platform_inbound_quarantine` gives unresolvable inbound mail an owned queue. The 22 stranded messages are enrolled. Root cause recorded: the mailboxes themselves carry no company. |
| F-5 | Fixed / declared | `customer_operation_tasks` backfilled (0 NULL left). The rest are declared `mixed` with what NULL means written down and enforced. |
| F-6 | Fixed | `platform_table_classification` covers all 501 tables; `scripts/tenant-isolation-invariants.sql` (`npm run tenant:invariants`) fails the build on any breach. Passes against the live schema. |
| F-7 | Fixed | `isPlatformAdmin` read from the database, never from role names. Trigger `gridex_user_roles_scope_consistent` forbids both a company-scoped platform role and a global company role. |
| F-8 | Fixed | `UNIQUE (company_id, customer_number)`. Proven: two tenants allocate the same customer number; a duplicate inside one tenant is still rejected. |
| F-9 | Upgraded, then fixed | Reclassified from latent to **confirmed cross-tenant write**: `setOwnElectricitySupplier` cleared `is_own_supplier` on every row in the database, reachable by any tenant admin with `switching.write`. Both it and the resolver are company-scoped, the hardcoded "Gridex" fallback is gone, and one own-supplier row per tenant is enforced. |
| F-10 | Fixed | `UNIQUE (company_id, metering_point_id)` and the same for `meter_point_id` / `ediel_reference`. Proven in a rolled-back transaction: two tenants hold the same national metering point. |
| F-11 | Fixed | `UNIQUE (company_id, content_sha256)`. |
| F-12 | Fixed | Composite customer keys extended from 22 to **94 of 99** tables. Also surfaced a defect the audit missed: 26 tenant tables carried `customer_id` with no foreign key at all, and two held dangling ids to deleted customers (32 rows). Those two get the key `NOT VALID`. |
| F-13 | Fixed | All 160 views run as invoker. |
| F-14 | Fixed | 2 761 policies targeting roles that cannot reach their table removed, verified inert first. |
| F-15 | Contained | `lib/supabase/tenantDb.ts` gives new code a wrapper where the company predicate cannot be forgotten. `npm run tenant:service-role-ratchet` freezes the count at 2 401 call sites across 451 files — it may fall, never rise. |

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx vitest run` | 169 files / 1066 tests pass (8 new) |
| `npm run db:migrations:integrity` | pass — 558 files, 462 version groups |
| `npm run tenant:invariants` (live schema) | all checks pass |
| `npm run tenant:service-role-ratchet` | 2401 call sites, at baseline |
| `eslint` on changed files | clean |

## Still open

- **F-15 proper.** The destination is a database role without `BYPASSRLS` so the
  policies do the enforcing. The ratchet holds the line meanwhile; it does not fix
  the 2 402 existing call sites.
- **Two `NOT VALID` keys** on `ediel_message_intents` and `route_decision_logs`,
  pending a decision from whoever owns that log data about the 32 orphan rows.
- **Inbound mailboxes carry no company.** The quarantine makes the backlog
  visible, but assigning the 22 messages and binding the mailboxes to tenants is a
  product decision, not one to guess.
- **Production parity** remains unverified: no production Supabase project is
  visible to this session. Everything here is verified against `gridex-ops-dev`.
- **Per-message EDIEL business semantics** (Z03/Z04/APERAK field and state level)
  were never in scope for this work.

---

# Data cleanup — 2026-09-02 (dev)

Requested scope: keep Gridex El AB, Nibela AB and Test bolag; keep customers
Mirvat and Hafez HOURANI; remove everything else as residue from incomplete
deletions. Confirmed with the requester that tenant configuration is kept — the
alternative reading would have removed 18 252 configuration rows including Gridex
El AB's EDIEL identity 21660.

## Before deleting: the quarantined inbound was not residue

The 22 messages parked in `platform_inbound_quarantine` turned out to be real
EDIEL traffic — UTILTS, APERAK and CONTRL from sender 91100, addressed to
receiver 21660, which `ediel_actor_settings` confirms is Gridex El AB's active
production supplier id, plus one to 92825, its test id. They had no tenant only
because the mailbox carries no company, so the resolver never bound them.

Migration `attribute_quarantined_inbound_by_receiver_ediel_id` derives the
receiver from the interchange header and matches it against `ediel_actor_settings`,
assigning a company only where exactly one owns that id. 20 messages were
attributed to Gridex El AB and their parse results, attachments and processing
jobs followed. Deleting them as "old data" would have destroyed live market
messages.

## Removed

| What | Rows |
|---|---|
| Green Hero Energy AB (already flagged `deleted_test_only`) and all its data | 150 across 27 tables |
| Customer "Test Fakturakund" (`is_test_data = true`) and its full graph | contract, site, metering point, invoice, supply period, acceptances, domain events |
| Inbound shells with no sender, subject, payload or timestamp | 2 |
| Rows referencing customers that no longer existed | 32 (`ediel_message_intents` 3, `route_decision_logs` 29) |

Append-only guard triggers were disabled for the duration and restored in the
same transaction. This is dev-data cleanup, deliberately not written as a
migration: the same repair in another environment must be re-derived from that
environment's data.

## After

| Company | Customers | Sites | Contracts | Inbound mail | EDIEL identities |
|---|---|---|---|---|---|
| Gridex El AB | 2 (Mirvat, Hafez HOURANI) | 2 | 2 | 42 | 4 |
| Nibela AB | 0 | 0 | 0 | 0 | 0 |
| Test bolag | 0 | 0 | 0 | 0 | 0 |

Three previously open items closed as a result: zero orphan rows, so both
`NOT VALID` foreign keys are now validated; zero unresolved quarantine entries.
The tenant invariant gate passes.


---

# Gates wired into CI — 2026-09-02

Both gates were only runnable by hand, which meant nothing stopped the invariants
from eroding again. They now run automatically.

| Gate | Where | Trigger |
|---|---|---|
| `tenant:service-role-ratchet` | `ops-hardening.yml` | every pull request and push to main |
| `tenant:service-role-ratchet` | `tenant-integrity-regression.yml` | tenant-related paths, for earlier feedback |
| `tenant:invariants` | `tenant-isolation-invariants.yml` | manual dispatch with confirmation, `workflow_call`, and a weekly drift check |

The SQL gate needs a live schema, so it follows the shape already established by
`canonical-quote-db-release-gate.yml`: an explicit confirmation string, the
`production-e2e` environment and the `GRIDEX_OPS_DATABASE_URL` secret. It moved to
`scripts/sql/` to match the other database gates.

`tenant-integrity-regression.yml` now also watches `lib/supabase/service.ts`,
`lib/supabase/tenantDb.ts`, `lib/admin/guards.ts`, `lib/admin/apiGuards.ts` and
the gate files themselves.

Verified by adding a throwaway file with one `supabaseService.from(` call: the
ratchet reported 2403 against a baseline of 2402 and exited 1; removing the file
returned it to 0. Migration integrity passes and 169 test files / 1066 tests pass
with the gates in place.

---

# Second audit pass — 2026-09-02, after running the security advisor

The first pass never ran Supabase's own security advisor. It reported 95 findings.
Three were real, and two of those were caused or worsened by the remediation
itself.

## F-16 — SECURITY DEFINER helpers exposed as REST RPC (High)

28 SECURITY DEFINER functions were executable by `authenticated` and 7 by `anon`.
Most derive everything from `auth.uid()` and are safe. Two are not:
`gridex_get_user_permissions(p_user_id)` and
`gridex_get_user_permissions_in_company(p_user_id, p_company_id)` take an
arbitrary user id and return that user's permission set, so any authenticated
caller — and for the second, any anonymous caller — could read another user's
permissions straight off `/rest/v1/rpc`. **The company-scoped one was introduced
by this remediation.**

Fixed by making `gridex_has_permission` SECURITY DEFINER so the 47 policies that
use it keep working, then revoking the resolvers from all client roles. Trigger-only
functions were revoked too, a dead function left behind by the F-7 work was
dropped, and the mutable `search_path` warnings were pinned.

Verified: `anon`-executable SECURITY DEFINER functions went 7 → 0; advisor
findings 95 → 82, with the 17 remaining all legitimate policy predicates that
either derive from `auth.uid()` or return a boolean rather than a data set.

## F-17 — Storage document access checked the permission in the wrong company (High)

`gridex_actor_has_company_permission` backs every storage policy on
`customer-documents`, which holds powers of attorney and signed agreements. It
required membership in the target company but then evaluated the permission with
the company-blind resolver. A user who was finance in company A and viewer in
company B satisfied "masterdata.read for company B" using A's permission.

Fixed by resolving the permission in the company being asked about. Verified: an
owner of Nibela AB reads their own documents and is denied Gridex El AB's.

The rest of the storage layer held up: all nine buckets are private, and
`gridex_private.customer_document_path_allows` validates the path shape, that the
customer belongs to the company in the path, and that the site belongs to that
customer and company.

## F-18 — The F-2 fix over-tightened and broke shared masterdata (High, self-inflicted)

Narrowing `gridex_has_permission` to platform roles closed the "a company role
grants everywhere" hole, but the policies on grid owners, price areas and
electricity suppliers grant on that predicate alone. Verified before the fix: an
owner of Nibela AB evaluated `false` for reading `grid_owners` — those pickers
would have been empty in the application.

The mistake was treating one predicate as if it answered one question. It answers
two: shared masterdata has no tenant, so the question is "anywhere the user is an
active member"; tenant data must ask "in this company". `gridex_has_permission`
regains the first semantic while keeping the status, role-activity and membership
hygiene F-2 added, and the invariant gate asserts that tenant tables still carry
their restrictive company guard.

## Gate additions

The invariant gate now also fails on a permission resolver executable by a client
role, and on any SECURITY DEFINER function in `public` executable by `anon`.

## Checked and clean

- All nine storage buckets private; seven have no client policy at all and are
  reachable only by `service_role`.
- `anonymize_user_account` refuses to act on a user other than the caller.
- `gridex_can(text)` is dead code — referenced by no policy and no function.
- The 65 `rls_enabled_no_policy` findings are INFO: RLS on with no policy denies
  every client role, which is the intended posture for service-only tables.

## Verification

Typecheck clean, 169 test files / 1066 tests pass, migration integrity passes
(562 files), and the tenant invariant gate passes against the live schema.
