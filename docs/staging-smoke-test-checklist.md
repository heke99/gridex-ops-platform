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

## Fullständigt prisunderlag och tenantens kalkylator (`2026-07-22.2`)

Den aktiva integrationsordningen är:

1. `GET /api/v1/website/public-contracts` används för avtalsurval och som fullständigt maskinläsbart beräkningsunderlag.
2. Tenantens webbplats löser själv kundens prisområde och hämtar själv extern marknadsprisindikation för rörligt månads-, tim- och kvartspris.
3. Tenantens kalkylator kombinerar marknadspriset med OPS-publicerade påslag, avgifter, momsregler och förbrukning.
4. `POST /api/v1/website/customer-applications` tecknar direkt med samma `offer_reference`; OPS verifierar inskickat prisområde och låser publicerings-, pris-, avgifts- och juridikversion.

För fastprisavtal skickar OPS alltid det publicerade fasta priset per kWh. Fastpriset är alltid synligt för kunden och kan inte döljas av presentationsinställningen för ett fastprisavtal. Tenantens kalkylator använder det tillsammans med samtliga tillämpliga fasta och förbrukningsbaserade avgifter för att visa beräknad månads- och årskostnad.

`pricing.calculation_components` och kompatibilitetsfältet `pricing.components` innehåller **alla** tillämpliga pris- och avgiftskomponenter. En komponent med `website_visibility=hidden` eller `website_card_visible=false` får inte filtreras bort: den ska fortfarande skickas till tenantens backend och användas när `calculation_inclusion=included` eller dess villkor uppfylls. `pricing.display_components` är den separata listan över sådant som får visas som egna sälj-/avtalsrader.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

OPS externa tenant-API returnerar inte Nord Pool-, spot-, tim- eller kvartsspotpris, interna spot-ID:n, marknadskällor eller fallbackkedjor. De tidigare rutterna `/api/v1/website/quote`, `/api/v1/website/quote/validate`, `/api/v1/website/energy-area/resolve` och `/api/public/energy-area` returnerar `410 Gone` från API `2026-07-22.2`.

`GET /api/v1/website/public-contracts?diagnostics=1` är tenant-scopad och visar readiness för publicering och kanoniska avgifter. Saknade eller motstridiga avgiftsvärden sätts aldrig automatiskt till `0`, utan hanteras versionssäkert med auditspår.
