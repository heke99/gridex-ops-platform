# Staging Smoke Test Checklist

Run on staging before every production deploy (full list before go-live;
sections marked *post-deploy* also run against production after deploy).

## Build & platform (post-deploy)

- [ ] `npm run typecheck && npm run build && npm test` green on the release commit
- [ ] `npm run db:migrations:check` green
- [ ] App boots; `/login` renders; login works (admin + portal user)
- [ ] `/admin/system-health` all checks green

## Public website flows (post-deploy)

- [ ] `/` and `/teckna-avtal` load fast (server-rendered, no errors)
- [ ] `GET /api/v1/website/public-contracts` with tenant API key → published offers
- [ ] `GET /api/v1/website/legal-bundle` → active legal versions
- [ ] Public legal page `/legal/{slug}/{type}/{versionId}` renders

## Website application chain

- [ ] Submit application with `Idempotency-Key` → 200; customer, site, metering
      point, contract, legal acceptances, POA created; events emitted
- [ ] Resubmit the SAME key + payload → 200 with `idempotent: true` (no
      duplicates, no 500)
- [ ] Submit with non-UUID `price_plan_version_id` (e.g. `2026-06-12-v1`) →
      no `invalid input syntax for type uuid`; version name lands in
      `price_version` text field
- [ ] Confirmation email queued via tenant sender; visible in
      `tenant_email_outbox` → `sent`
- [ ] Application visible in `/admin/website-applications` with full chain detail

## Customer portal

- [ ] `POST /api/v1/customer/portal-bundle` with API key + identifiers → bundle
- [ ] Portal login → dashboard, invoices, sites, contracts, consumption pages
- [ ] Cross-customer probe: request another customer's id → 403/404 (never data)

## Admin

- [ ] `/admin` dashboard loads (summary metrics)
- [ ] `/admin/companies`, `/admin/customers` (+ search), `/admin/customers/[id]`
- [ ] `/admin/platform/go-live` list + one company detail with readiness
- [ ] `/admin/messages`, `/admin/events` load bounded lists

## Ediel (test environment)

- [ ] Create Z01 facility lookup for a test customer → intent → outbox →
      blocked or sent per route config (verify guard reasons render)
- [ ] Inbound test message processed: tenant resolved, business flow updated,
      ACK queued
- [ ] AGT run executes and records `actor_test_results`; no production customer
      data touched

## Inbound mail

- [ ] Ediel mailbox poll cron runs green (`ediel_inbound_poll_runs` row)
- [ ] Manual info request: send → outbox row → (reply with GX-FIR token) →
      matched → parsed or `needs_review`
- [ ] Reply without token stays unseen (no wrong-tenant attachment)

## Email

- [ ] Test email from go-live page arrives; DKIM/SPF pass; correct From/Reply-To
- [ ] Kill switch: disable tenant sender → send blocked with safe error; queued
      rows preserved; re-enable → resumes

## Cron & jobs (post-deploy)

- [ ] Each cron endpoint responds 401 without secret, 200 with secret
- [ ] Email outbox / Ediel outbox / customer-operations crons process without errors

## Billing (if in launch scope)

- [ ] Pricing preview for a test contract; monthly run on staging data;
      invoice export dry-run; provider webhook test event processed

## Kanoniskt fakturaavgifts- och quote-kontrakt (`2026-07-20.2`)

Den bindande integrationsordningen är:

1. `GET /api/v1/website/public-contracts` används för avtalskort, urval, marknadstext, kundtyp, juridiska länkar och `offer_reference`.
2. `POST /api/v1/website/quote` används för all faktisk prisberäkning från exakt låst prisversion.
3. `POST /api/v1/website/customer-applications` tecknar samma `offer_reference` och exakt publicerings-/prisversion.

`public-contracts` är ett presentations-API. En prisdel kan vara `null` eller saknas i kortets `pricing.components` när `website_card_visible=false`, men den kan fortfarande vara en verklig debiteringskomponent. Dolda komponenter ingår därför fortsatt i quote, checkout, avtalsdokument, låst avtalssnapshot och fakturering. Tenantens frontend får inte återskapa totalsumman från kort-DTO:n.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

Quote-requesten kräver `offer_reference`, `price_area`, `annual_consumption_kwh > 0` och `start_date` i formatet `YYYY-MM-DD`. `customer_type` får, när det anges, endast vara `private` eller `business`. Svarets `lines` innehåller de verkliga beräkningskomponenterna, inklusive `invoice_fee` med `unit=sek_invoice` och `calculation_type=per_invoice` även när fakturaavgiften är dold på avtalskortet.

`GET /api/v1/website/public-contracts?diagnostics=1` är tenant-scopad och visar `pricing_readiness.invoice_fee`. Ready-status innehåller belopp, enhet, beräkningstyp, kortsynlighet och källa. Blockerad status använder någon av:

- `invoice_fee_missing`
- `invoice_fee_conflict`
- `invoice_fee_ambiguous`

Befintliga publicerade avtal rättas versionssäkert: en ny pris- och publiceringsversion skapas och den gamla markeras `superseded`. Redan signerade kundavtal behåller sin tidigare exakta version. Entydiga draftavtal kan uppdateras via det kanoniska kommandot. Saknade eller motstridiga värden sätts aldrig automatiskt till `0`, utan hamnar i manuell remediation med auditspår.

