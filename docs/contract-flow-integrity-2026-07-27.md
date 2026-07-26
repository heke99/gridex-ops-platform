# GRIDEX OPS contract-flow integrity completion

Date: 2026-07-27  
Migration: `20260727010000_contract_flow_integrity_completion.sql`

## Canonical runtime flow

The completed path is:

`contract_offers → contract_products → contract_product_versions → tenant_contract_assignments → tenant_contract_channels → public_contract_offers → website_contract_quotes → website_customer_applications → customers/customer_sites/metering_points → customer_contracts → supplier_switch_requests → customer_supply_periods → billing_underlays → invoice_export_items → customer_invoices`.

`invoice_export_items` is the canonical invoice/export item. The monthly
automation no longer creates a competing `billing_export_run_items` flow.
Provider implementations are adapters around `invoice_export_items`.
`partner_export_id` remains a compatibility alias on the invoice mirror; new
code also writes `invoice_export_item_id` and `canonical_export_item_id`.

## Admin contract models

The UI names the four domains explicitly:

1. internal contract products;
2. tenant assignments;
3. website publications;
4. signed customer contracts.

The internal list reads `canonical_internal_contract_offers_v`. That view is a
cheap `security_invoker` list and never executes readiness or the delete
dependency graph per row. Readiness and delete preview are service-side,
tenant-checked calls made only for the selected row. A failed list query has a
separate error state and retry action; only a successful zero-row response is
an empty state.

Platform administrators must select an explicit `company_id`. The selection is
validated again in every server action. No invalid explicit tenant falls back
to a membership or the first company. Successful creation redirects with the
same verified `company_id` and exact new offer ID.

## Roles and tenant authorization

TypeScript uses `normalizePlatformRole()`, `isPlatformAdminRole()` and
`isPlatformSuperAdminRole()`. The supported legacy aliases are:

- `superadmin`, `platform_superadmin`, `platformsuperadmin` → `super_admin`;
- `platformadmin` → `platform_admin`.

PostgreSQL uses `gridex_normalize_platform_role(text)`. The final
`gridex_user_is_platform_admin()` and contract permission predicate call that
normalizer. Mutating contract RPCs retain their own actor/tenant permission
checks; use of the service role does not replace input graph validation.

## Contract creation and deletion

`gridex_upsert_internal_contract_offer_v2` wraps the existing atomic creator and
refuses success unless the offer, canonical product, version and tenant
assignment all exist and match the requested tenant. The server action verifies
the returned IDs and redirects to the exact row.

Delete preview and commit use the existing canonical dependency graph. Commit
checks again while holding the transaction/advisory locks. Used products return
a structured blocked result and are archived/unpublished instead of physically
deleted. Unused drafts may be deleted transactionally and are audit logged.

## Customer identity policy

Legal identity is the only automatic merge key:

- exact personal/organisation number in the same tenant may reuse a customer;
- conflicting legal identifiers or multiple strong candidates require manual
  review;
- facility, site and metering-point matches never select or overwrite a
  customer;
- a supplied portal customer ID is checked against tenant, customer type,
  legal identity and verified e-mail before reuse.

Matching decisions expose method, strength, matched/conflicting identifiers and
`requires_manual_review`. The final onboarding RPC has the same rule, so a
different caller cannot bypass the application service.

## Quote and website API

Canonical endpoints:

- `GET /api/v1/website/public-contracts`
- `GET /api/v1/website/public-contracts/diagnostics`
- `POST /api/v1/website/customer-applications`

The API key resolves the tenant; website payloads do not select `company_id`.
`quote_reference` is revalidated before provisioning and is persisted on both
`website_customer_applications` and `customer_contracts`. A database trigger
requires the quote to belong to the same tenant and, when supplied, the same
contract product version.

Business failures use non-2xx semantics: invalid input `400`, authentication
and scope `401/403`, tenant-scoped not-found `404`, state/identity/quote
conflicts `409`, semantically incomplete applications `422`, and unavailable
resolution/workflow dependencies `503`.

## Supply activation

Only `confirmed`, `accepted` or `completed` switch states may activate supply.
Queued/submitted/sent/waiting states fail inside the database RPC. Assigned,
mandatory-purchase and normal supplier-switch completion events all call the
same canonical activation service. It verifies tenant, customer, contract, site
and metering point, activates the contract, creates the idempotent supply
period, advances application/workflow state and emits the audit/domain event.

## Underlay and invoice integrity

Every overlapping billable supply period now creates a monthly control row.
Missing meter values produce a blocked underlay with
`missing_meter_values`; the customer is not skipped.

Readiness compares the exact company, customer, customer contract, metering
point and overlapping period. The underlay stores the canonical customer
contract ID. Database triggers reject cross-customer or cross-contract
relationships between supply, underlay, export item and customer invoice.

`gridex_create_invoice_export_graph_v1` reserves the run, all canonical export
items and their draft customer invoice mirrors in one advisory-locked database
transaction. A provider call happens only after that commit. The key
`provider:environment:company:billing-month:financing-mode` makes monthly
reservation idempotent.

Webhooks match the pre-created export item, not a provider customer number.
They validate amount and currency, reject unknown/mismatched references, ignore
stale state regressions and update the same invoice by
`(company_id, invoice_export_item_id)`.

## Deployment order

1. Back up the database and record the current migration ledger.
2. Deploy application code capable of reading both legacy and additive fields.
3. Apply `20260727010000_contract_flow_integrity_completion.sql`.
4. Refresh PostgREST schema cache.
5. Deploy/restart Next.js and automation workers.
6. Run the read-only production checks below.
7. Exercise one test-tenant draft creation, quote/application, confirmed switch
   and test-provider invoice export before enabling production automation.

## Read-only post-deploy checks

Replace the three values before running:

```sql
-- :company_id, :offer_id and :billing_month (YYYY-MM)
select id,company_id,contract_product_id,contract_product_version_id,
       relation_status,lifecycle_status,internal_channel_status,
       website_channel_status,created_at,updated_at
from public.canonical_internal_contract_offers_v
where company_id=:'company_id'::uuid and id=:'offer_id'::uuid;

select o.id offer_id,cp.id product_id,cpv.id version_id,ta.id assignment_id,
       o.company_id,ta.company_id assignment_company,ta.status
from public.contract_offers o
left join public.contract_products cp on cp.id=o.contract_product_id
left join public.contract_product_versions cpv
  on cpv.id=o.contract_product_version_id
 and cpv.contract_product_id=cp.id
left join public.tenant_contract_assignments ta
  on ta.company_id=o.company_id
 and ta.contract_product_version_id=cpv.id
where o.company_id=:'company_id'::uuid and o.id=:'offer_id'::uuid;

select bu.id underlay_id,bu.customer_id,bu.customer_contract_id,
       iei.id export_item_id,iei.customer_id export_customer,
       iei.customer_contract_id export_contract,
       ci.id invoice_id,ci.customer_id invoice_customer,
       ci.customer_contract_id invoice_contract,ci.status
from public.billing_underlays bu
left join public.invoice_export_items iei
  on iei.company_id=bu.company_id and iei.billing_underlay_id=bu.id
left join public.customer_invoices ci
  on ci.company_id=iei.company_id and ci.invoice_export_item_id=iei.id
where bu.company_id=:'company_id'::uuid
  and to_char(bu.billing_period_start at time zone 'Europe/Stockholm','YYYY-MM')
      = :'billing_month'
order by bu.created_at,iei.created_at,ci.created_at;
```

## Rollback

Runtime rollback is to deploy the preceding application release and pause
monthly/provider workers first. The migration is additive but its integrity
triggers intentionally reject inconsistent writes. Do not drop them while new
runtime code is active.

If a database rollback is required:

1. pause writes and export/webhook workers;
2. preserve new invoice/quote columns and data;
3. restore the preceding definitions of
   `canonical_internal_contract_offers_v`,
   `gridex_user_is_platform_admin()`,
   `gridex_contract_actor_has_permission(uuid,text)`,
   `activate_customer_supply_v1(...)`,
   `gridex_onboard_customer_graph(jsonb)` and
   `gridex_store_billing_underlay(...)` from the immediately preceding
   migrations;
4. drop only the new triggers/functions/indexes by exact name;
5. do not drop additive columns until all rows written by the new release have
   been exported and reconciled.

No broad `CASCADE` is part of the rollback procedure.
