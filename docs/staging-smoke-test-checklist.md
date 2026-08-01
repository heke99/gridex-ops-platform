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

## Canonical fastpris/quote/teckning (`2026-08-01.1`)

- [ ] `public-contracts` returnerar ett fastprisavtal en gång med SE1–SE4 i `area_pricing`.
- [ ] Olika SE-priser ger `fixed_price_ore_per_kwh=null`; klienten använder vald rad i `area_pricing`.
- [ ] Tenantautentiserad `energy-area/resolve` löser korrekt prisområde och nätägare; legacy `GET /api/public/energy-area` ger fortsatt 410.
- [ ] `quote` skapar en tenantbunden immutable quote och `quote/validate` godkänner exakt samma offer/kundtyp/område/förbrukning/startdatum.
- [ ] Quote kräver `resolution_id`; ett motstridigt klientinskickat `price_area` eller `grid_area_code` ger konflikt och ändrar inte OPS-resolutionen.
- [ ] Rörlig quote innehåller `market_reference` med provider, referensperiod, `as_of`, `is_indicative`, freshness och fallbackmetadata.
- [ ] Senaste kompletta svenska dygn importeras för SE1–SE4; 92-/100-intervallsdygn godkänns genom faktisk tidscoverage och en lucka/överlapp blockeras.
- [ ] Avslutad månad blir `verified`, låses explicit och används därefter som settlement. Preview eller olåst `verified` period blockeras i fakturering.
- [ ] SVK-cron startar ny version när geodata är gammal och resolver blockerar automation innan en komplett version är verifierad.
- [ ] Dubbel submit med samma `Idempotency-Key` skapar inte ny kund, nytt kundnummer, nytt avtal eller nytt leverantörsbyte.
- [ ] Kund med inkommande `external_customer_reference` får referensen bevarad och samma OPS-kundnummer i ansökan, kundportal och fakturering.
- [ ] Avtalsbekräftelse köas en gång och innehåller kundnummer samt rätt avtal/startstatus.
- [ ] Saknat anläggningsunderlag köar uppgiftsbegäran; komplett underlag startar leverantörsbyte automatiskt när route/fullmakt/readiness är godkänd.
- [ ] `contract_price_snapshots.base_price_components_snapshot` innehåller endast kundens valda SE-prisrad för fastpris.
- [ ] Fakturaunderlaget använder låst snapshot, inklusive dolda avgifter och publicerad nollavgift.
- [ ] OpenAPI, utvecklarsida och runtime rapporterar kontraktsversion `2026-08-01.1`.
