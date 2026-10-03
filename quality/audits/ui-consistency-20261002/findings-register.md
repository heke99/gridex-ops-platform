# UI / DB / tenant consistency audit — 2026-10-02

Scope: all of `app/admin/**` (except Ediel, done in #441/#443), the customer
portal, customer intake, contract creation and tenant onboarding. Findings come
from five area audits and are verified against code and `supabase/schema.sql`
before they are fixed. Status: open / fixed (PR) / false positive / accepted.

## PR A — security and tenant isolation
| # | Finding | Status |
|---|---|---|
| S1 | Tenant user without an operational company got `companyId = null`, which pages read as "all companies" (system-health, webhooks/deliveries, website-applications, messages, outbound/*, operations/*, billing/underlays, metering, …) | fixed at the source: `getOperationalCompanyScope` throws `TenantCompanyRequiredError` for non-platform users; `tenantReadCompanyId` guards the admin read scope |
| S2 | `sendWebhookTestEventAction` trusts subscription id | false positive: `enqueueWebhookDeliveriesForEvent` filters by the event's company |
| S3 | `updateOutboundRequestStatusAction` used the form's customer id for sync/audit | fixed: uses the saved request's customer |
| S4 | company-settings: `tenants.invite` alone can grant roles; tenants could change a member's global login e-mail (account takeover) | fixed: role/user edits need `users.write`; login e-mail changes are platform-only |
| S5 | company-settings: tenants can edit Ediel market identity | fixed: fields read-only, action ignores them unless platform admin (RPC keeps omitted keys) |
| S6 | system-health: platform-only cards shown to tenants | fixed: computed and rendered only for platform admins; Swedish labels |
| S7 | duplicates grouped across tenants; full personnummer and raw key shown | fixed: grouping keyed per tenant, personnummer masked, key removed |
| S8 | control tower actions use a different company scope than the rows shown | fixed: rows carry company_id, actions authorise that company; real drift view; redirects no longer swallowed |

| S9 | 20 admin action files swallowed Next redirects inside try/catch (success shown as NEXT_REDIRECT error) | fixed: `unstable_rethrow` first in every catch |

## PR B — broken / dead
Control-tower and automation success redirects swallowed (`redirect` in try);
control tower reads non-existent tables; grid-owner agreements page crashes
(table missing from canonical schema); dead anchors on contracts page;
customer-case 404 for platform admins; work-queue status list vs DB check;
analytics filters ignored; dead billing `_components.tsx` and stub actions;
company-settings environment select and membership-role select do nothing;
underlay detail windowed fetch; "Ny nätägare" link.

## PR C — DB mismatch and raw codes
Status/priority label maps: customer cases, customer info requests (statuses
not in DB check, missing DB statuses), work queue, webhooks deliveries (missing
`blocked_tenant_state`, `delivery_uncertain`), control tower, audit log, data
quality, partner exports, metering, pricing, network owners, portal pages.
Raw UUID fallbacks → names. Data-quality green state when checks cannot run.

## PR D — clutter, duplicates, wording
Duplicate customer-list buttons, customer card menu duplicating tabs, button rows
→ `<details>` menus (website applications, contracts offers, companies, data
cleanup, network owners, outbound cards, webhook rows, portal nav); nav label
duplicates; English and platform jargon shown to tenants.

## PR E — customer intake, contract creation, tenant onboarding
| # | Finding | Status |
|---|---|---|
| E1 | intake/CSV could create contracts as `active`/`signed` without a signed agreement | fixed: intake creates only draft/pending_signature; signed only with the signed file |
| E2 | a contract offer id that did not exist for the company silently fell back to a default contract | fixed: error |
| E3 | partner-export, POA-scope and lifecycle-decision audit rows written without company_id | fixed |
| E4 | tenant admins could change their own role and demote the last company administrator | fixed: `roleChangeGuard` in both role forms (+ tests); audit text no longer says "superadmin" for tenants |
| E5 | website review fell back to bare site/metering-point inserts on any schema error, dropping grid owner/area fields | fixed: fallbacks removed, errors surface |
| E6 | website review stored only raw UUID grid owners and dropped platform ids | fixed: `normalizeGridOwnerIdToOps` like admin intake |
| E7 | website channel defaults (monthly reading, `variable_monthly`) differ from admin intake | fixed per owner decision (2026-10-03): metering requests follow the customer's contract (`lib/metering/contractMeteringResolution.ts`); website no longer guesses `monthly` meters or a contract type; contract type comes from the accepted offer |
| E8 | website review writes site, metering point and contract as separate statements (not one transaction) | fixed: `gridex_save_website_application_review_v1` (migration 20261003100000) writes site, MP, contract, customer intake and application in one locked transaction; applied on hosted and probed (rolled back) |


### PR B progress
| # | Finding | Status |
|---|---|---|
| B1 | grid_owner_access_agreements, tenant_email_domains, customer_data_quality_open_issues exist only via legacy migrations (fresh env: agreements page crashes, data-quality silently green) | fixed: forward migration 20261002227000 converges them; applied to hosted |
| B2 | hosted-only policy `gridex_perf_authenticated_select_v` (select to authenticated using true) exposed every tenant's grid-owner agreements | fixed: dropped; both tables now service-role only (no client grants), hosted + migration |
| B3 | data-quality view (personnummer) readable by authenticated without RLS (security definer view) | fixed: security_invoker, service_role only |
| B4 | data-quality page rendered "no issues" when a check failed | fixed: fails closed |
| B5 | contracts page anchors `#tenant-assignment`/`#website-publication` point to sections only rendered in tenant view | fixed: point to create/offers sections |
| B6 | work queue filtered customer_info_requests by statuses not in its DB check (open, new, pending_review…), hiding real open requests | fixed: list mirrors the DB check minus terminal states |
| B7 | dead `app/admin/billing/_components.tsx`, unused export-center actions, nav entry to a redirect-only page | fixed: removed |
| B8 | company-settings: environment select had no name (change ignored); membership-role select ignored by action; empty phone field wiped user phone on every save | fixed |
| B9 | customer-cases list linked platform admins (no company) to a detail page that 404s by design | fixed: title is plain text until a company is selected |
| B10 | `customer-applications` and `external-contract-intakes` duplicated the website-applications page | fixed: redirect (query preserved); company link points to canonical page |
| B11 | analytics overview/reports showed filters their data ignores | fixed: month-only picker there; forecast keeps full filters |
| B12 | underlay detail fetched first 500/200/50/1000 rows and filtered in JS (older underlays rendered empty) | fixed: queried by id |

### PR C progress
| # | Finding | Status |
|---|---|---|
| C1 | raw status/priority/severity codes rendered in ~36 admin/portal views (webhook `blocked_tenant_state`/`delivery_uncertain`, info-request statuses, tasks, switches, cases…) | fixed: shared `formatStatusLabel` covers DB check values and humanizes unknown codes; applied across views (Ediel left to masterplan agent) |
| C2 | raw customer UUIDs shown in outbound, switches, tasks, grid-owner requests, ready-to-execute, cases | fixed: shared `<CustomerName>` (name + customer number) |
| C3 | free-text company UUID inputs (audit filter, manual mailboxes, contact channels) | fixed: shared `<CompanySelect>`; "tenant-override" wording → "bolagsspecifik" |

### PR D progress
| # | Finding | Status |
|---|---|---|
| D1 | contracts nav needed contracts.write/pricing.write while the page allows contracts.read (readers had no menu entry) | fixed: nav key includes contracts.read |
| D2 | Prismotor nav shown to tenants; page is platform-only | fixed: platformOnly |
| D3 | two nav entries both "Osäkra matchningar"; "Analytics" English | fixed: "Osäkra Ediel-matchningar", "Analys" |
| D4 | customer list repeated Kundintag/Avtal buttons in the side card | fixed: one button row |
| D5 | customer card "Fler åtgärder" menu only repeated the tab bar | fixed: removed (test updated to forbid it) |
| D6 | English/internal jargon in headings and buttons (Publish, Save draft, Batch 2C, Batch 7A.1, Sweep 7.8, Partner exports, Customer Integrity / Operations Dashboard, "platformstyrda") | fixed: Swedish, user-facing wording |

## Contract-driven metering (2026-10-03, owner request)
| # | Finding | Status |
|---|---|---|
| M1 | billing completeness only checked time coverage: one monthly total counted as "complete" for hourly/quarter-hour contracts, so interval values were never requested | fixed: completeness takes each point's contract resolution; `metering_resolution_insufficient` blocks invoicing and the autopilot re-requests |
| M2 | hourly/quarter contract on a monthly-read meter was not detected | fixed: `metering_point_resolution_mismatch` blocks and opens a grid-owner task instead of a pointless re-request |
| M3 | grid-owner meter-value requests carried no resolution; UTILTS used the meter's reading frequency | fixed: requests store `requested_resolution` from the contract (capped by the meter); E73 payload carries it |
| M4 | E66 draft mapped monthly → 1440 (day) and hourly meters → 15 (quarter-hour) | fixed: contract resolution → 15/60/1440 |
| M5 | `lib/cis/db-grid-owner.ts` still has a direct-insert `createGridOwnerDataRequest` bypassing the atomic RPC | open (dead code, no importers); left because Ediel masterplan gate manifests hash the file |

## Preliminary billing and reconciliation (2026-10-03, owner decision)
| # | Finding | Status |
|---|---|---|
| P1 | missing metering values blocked the invoice entirely; `billing_adjustment_cases` / `gridex_register_late_metering_correction` existed but nothing used them | fixed: missing periods/gaps are billed from the customer's history (`lib/billing/consumptionEstimate.ts`: same period last year → last 4 weeks average → intake annual consumption with monthly profile), keeping the contract's hour/quarter shape; marked preliminary on the invoice |
| P2 | no settlement of preliminary periods | fixed: when an invoiced (locked) preliminary period gets complete final values, the next run credits the preliminary quantity and charges the final one over the original period (energy-dependent components only, prices of the original month); net = difference on the next invoice |
| P3 | pricing used the run's month for spot/source prices | fixed: prices follow the billed period (identical for regular underlays) |
| P4 | pre-existing static regressions red on main and not in CI: gridex-canonical-market-resolution-quote-billing, gridex-invoice-fee-canonical, gridex-svk-billing-area | open (not caused by this change) |
| P5 | no history and no intake annual consumption left the period blocked with no follow-up | fixed: `ensureHistoricalMeteringRequest` opens a metering permission and queues PRODAT Z13VH history (last 12 months to yesterday; POA covering metering data required, else `missing_authorization`); system runs leave a draft + operator task; idempotent per metering point. Note: the Z13 dispatcher itself is still gated in `lib/ediel/flows/prodatSwitch.ts` (Ediel masterplan workstream) |
