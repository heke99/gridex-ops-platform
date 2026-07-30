import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_API_ENDPOINT_ROWS } from "@/lib/api/publicRouteRegistry";
import {
  WEBSITE_INTEGRATION_BASE_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
  CUSTOMER_PORTAL_OPENAPI_URL,
  OPENAPI_RELEASE_MANIFEST_URL,
} from "@/lib/integrations/websiteIntegrationContract";

export const metadata: Metadata = {
  title: "Website API, Mina sidor-koppling & Webhooks | Gridex Developers",
  description:
    "Integrationsguide för hemsidor, kundportaler och partners som ansluter till Gridex API och Customer Portal External Auth Linking.",
};

// Public, static integration guide with no tenant/customer/private data.
// Safe to serve from the CDN with ISR (Group A).
export const revalidate = 3600;

const apiBaseUrl = WEBSITE_INTEGRATION_BASE_URL;
const documentationVersion = WEBSITE_INTEGRATION_CONTRACT_VERSION;
const websiteOpenApiUrl = WEBSITE_INTEGRATION_OPENAPI_URL;
const customerPortalOpenApiUrl = CUSTOMER_PORTAL_OPENAPI_URL;
const releaseManifestUrl = OPENAPI_RELEASE_MANIFEST_URL;

const permissions = [
  [
    "Verifiera tenantkontext",
    "integration_context.read",
    "Hämta opak tenant_reference för API-nyckeln. company_id används aldrig som extern tenantväljare.",
  ],
  [
    "Läsa API-publicerade avtal",
    "api_contracts.read",
    "Hämta avtal som uttryckligen publicerats till kanalen api.",
  ],
  [
    "Diagnostisera publicering",
    "website_contracts.diagnostics",
    "Läsa canonical readiness utan att ändra normal public feed.",
  ],
  [
    "Läsa avtal på hemsidan",
    "website_contracts.read",
    "Hämta publicerade elavtal för rätt bolag.",
  ],
  [
    "Lösa elområde",
    "website_energy_area.resolve",
    "Skapa tenantbunden canonical resolution från adress och anläggningsuppgifter.",
  ],
  [
    "Hämta aktuellt marknadspris",
    "website_market_prices.read",
    "Hämta aktuellt normaliserat spotpris för elområdet i en tenantbunden OPS-resolution.",
  ],
  [
    "Skapa quote",
    "website_quotes.write",
    "Skapa OPS-ägd quote från offer_reference och resolution_id.",
  ],
  [
    "Validera quote",
    "website_quotes.validate",
    "Verifiera quote, resolution, expiry och immutable prissnapshot före teckning.",
  ],
  [
    "Läsa juridik",
    "website_legal.read",
    "Hämta OPS-versionerade juridiska dokument och acceptanskrav.",
  ],
  [
    "Läsa bytesstatus",
    "website_switch_status.read",
    "Läsa status för kundansökan och leverantörsbytesprocess.",
  ],
  [
    "Skicka kundansökningar",
    "website_applications.write",
    "Skicka in kund, anläggning, valt avtal och juridiska godkännanden.",
  ],
  [
    "Mina sidor – läsa kunddata",
    "customer_portal.read",
    "Läsa kundprofil, avtal, anläggningar, fakturor, dokument och händelser.",
  ],
  [
    "Mina sidor – uppdatera kunddata",
    "customer_portal.write",
    "Skicka kompletteringar, flyttanmälan och profiländringar.",
  ],
  ["Läsa händelser", "events.read", "Läsa händelser som skapats för bolaget."],
  [
    "Skicka händelser från hemsidan",
    "website_events.write",
    "Skicka kundhändelser från hemsida eller kundportal.",
  ],
  [
    "Läsa kunddokument",
    "customer_documents.read",
    "Aktiv granulär behörighet. Legacy-scope customer_portal.read accepteras tillfälligt.",
  ],
  [
    "Synka kunddokument",
    "customer_documents.write",
    "Aktiv granulär behörighet för dokumentoperationer. /customer/sync kräver customer_sync.write.",
  ],
  [
    "Läsa kundnotiser",
    "customer_notifications.read",
    "Aktiv granulär behörighet. Legacy-scope customer_portal.read accepteras tillfälligt.",
  ],
  [
    "Uppdatera kundnotiser",
    "customer_notifications.write",
    "Aktiv granulär behörighet för /notifications/read. Legacy-scope customer_portal.write accepteras tillfälligt.",
  ],
];

const futurePermissions = [
  ["Kontaktuppgifter", "customer_contact.write"],
  ["Anläggningsuppgifter", "customer_facility_data.write"],
  ["Fullmakt", "customer_power_of_attorney.write"],
].map(([label, scope]) => [
  label,
  scope,
  "Aktivt granulärt scope. Legacy customer_portal.write accepteras tillfälligt.",
]);

const endpoints = PUBLIC_API_ENDPOINT_ROWS;

const activeWebhookEvents = [
  "customer.created",
  "customer.updated",
  "customer_number.assigned",
  "contract.application_received",
  "contract.confirmation_sent",
  "contract.cooling_off_sent",
  "contract.needs_facility_data",
  "power_of_attorney.signed",
  "document.created",
  "facility_data.received",
  "facility_data.verified",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.disputed",
  "supply.started",
  "metering_values.updated",
  "contracts.publication.changed",
];

const internalLifecycleEvents = [
  "supplier_switch.requested",
  "supplier_switch.accepted",
  "supplier_switch.rejected",
  "supply_period.activated",
  "invoice.provider.partially_paid",
  "invoice.provider.overdue",
  "invoice.provider.credited",
];

const plannedWebhookEvents = [
  "customer.opened_document",
  "customer.downloaded_document",
  "contract.activated",
  "supplier_switch.started",
  "supplier_switch.completed",
  "invoice.partially_paid",
  "invoice.overdue",
  "invoice.credited",
];

const tenantSetupExample = `# .env / Vercel – enda obligatoriska tenantvariabeln
GRIDEX_API_KEY=gridex_live_xxxxxxxxx`;

const authExample = `Authorization: Bearer $GRIDEX_API_KEY
Origin: https://www.exempel.se
Content-Type: application/json`;

const tenantContextExample = `curl -X GET "${apiBaseUrl}/integration/context" \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H "Accept: application/json"

{
  "data": {
    "tenant_reference": "tenant_0123456789abcdef0123456789abcdef0123",
    "api_version": "v1",
    "contract_version": "${documentationVersion}",
    "configuration": {
      "required_environment_variables": ["GRIDEX_API_KEY"],
      "api_base_url": "${apiBaseUrl}",
      "application_reference_location": "top_level",
      "tenant_identity_from_api_key": true,
      "tenant_id_environment_required": false,
      "company_id_environment_required": false
    },
    "capabilities": {
      "website_checkout_ready": true,
      "missing_website_checkout_scopes": []
    }
  }
}`

const publicContractsExample = `curl -X GET "${apiBaseUrl}/website/public-contracts?customer_type=private" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Accept: application/json"`;

const publicContractsResponse = `{
  "data": [
    {
      "offer_reference": "offer_...",
      "name": "Fast elpris",
      "contract_type": "fixed",
      "energy_direction": "consumption",
      "customer_type": "private",
      "fixed_price_ore_per_kwh": 112,
      "monthly_fee_sek": 49,
      "invoice_fee_sek": 19,
      "pricing": {
        "fixed_price": {
          "amount": 112,
          "unit": "ore_per_kwh",
          "vat_included": false,
          "vat_rate": 0.25,
          "calculation_inclusion": "included",
          "website_visibility": "visible"
        },
        "monthly_fee": {
          "amount": 49,
          "currency": "SEK",
          "unit": "month",
          "calculation_inclusion": "included",
          "website_visibility": "visible"
        },
        "invoice_fee": {
          "amount": 19,
          "currency": "SEK",
          "unit": "invoice",
          "calculation_inclusion": "included",
          "website_visibility": "summary_only"
        },
        "market_price_responsibility": "not_applicable",
        "calculation_contract": {
          "includes_all_applicable_components": true,
          "hidden_components_must_be_calculated": true,
          "market_price_supplied_by_ops": false
        },
        "calculation_components": [
          {
            "component_code": "monthly_fee",
            "amount": 49,
            "unit": "sek_month",
            "calculation_inclusion": "included",
            "website_visibility": "visible"
          },
          {
            "component_code": "invoice_fee",
            "amount": 19,
            "unit": "sek_invoice",
            "calculation_inclusion": "included",
            "website_visibility": "summary_only"
          }
        ],
        "display_components": [
          {
            "component_code": "monthly_fee",
            "amount": 49,
            "unit": "sek_month",
            "website_visibility": "visible"
          }
        ],
        "summary_components": [
          {
            "component_code": "monthly_fee",
            "amount": 49,
            "unit": "sek_month",
            "website_visibility": "visible"
          },
          {
            "component_code": "invoice_fee",
            "amount": 19,
            "unit": "sek_invoice",
            "website_visibility": "summary_only"
          }
        ]
      },
      "price_areas": ["SE1", "SE2", "SE3", "SE4"],
      "legal": { "requirements": [] },
      "valid_from": "2026-07-22",
      "valid_to": null
    }
  ]
}`;

const currentMarketPriceExample = `curl -X POST "${apiBaseUrl}/website/market-price/current" \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"resolution_id":"f8249704-7ce8-4885-93cb-fbb9922ed77d"}'

{
  "data": {
    "provider": "elprisetjustnu",
    "resolution_id": "f8249704-7ce8-4885-93cb-fbb9922ed77d",
    "price_area": "SE3",
    "reference_type": "current_interval",
    "resolution": "quarterly",
    "selected_resolution": "quarterly",
    "available_resolutions": ["quarterly", "hourly"],
    "time_start": "2026-07-24T16:00:00+02:00",
    "time_end": "2026-07-24T16:15:00+02:00",
    "price_sek_per_kwh": 0.655699,
    "price_ore_per_kwh": 65.5699,
    "price_ex_vat_sek_per_kwh": 0.655699,
    "price_ex_vat_ore_per_kwh": 65.5699,
    "includes_vat": false,
    "includes_supplier_fees": false,
    "includes_grid_fees": false,
    "is_indicative": false,
    "is_stale": false,
    "fallback_used": false,
    "source_as_of": "2026-07-24T14:02:14Z",
    "next_update_at": "2026-07-24T16:15:00+02:00"
  },
  "request_id": "0153b491-b4be-444d-b9a4-56573af449e8",
  "contract_schema_version": "2026-07-30.2"
}`;

const marketReferenceExample = `{
  "market_reference": {
    "provider": "elprisetjustnu",
    "price_area": "SE3",
    "reference_type": "preview",
    "reference_period": "rolling_30_days",
    "price_sek_per_kwh": 0.655699,
    "price_ore_per_kwh": 65.5699,
    "price_ex_vat_sek_per_kwh": 0.655699,
    "price_ex_vat_ore_per_kwh": 65.5699,
    "requested_days": 30,
    "included_days": 30,
    "period_start": "2026-06-24",
    "period_end": "2026-07-23",
    "source_as_of": "2026-07-24T14:02:14Z",
    "generated_at": "2026-07-24T14:05:00Z",
    "stale_after": "2026-07-24T17:05:00Z",
    "effective_stale_at": "2026-07-24T17:02:14Z",
    "unit": "sek_per_kwh",
    "includes_vat": false,
    "includes_supplier_fees": false,
    "includes_grid_fees": false,
    "is_indicative": true,
    "is_stale": false,
    "fallback_used": false,
    "fallback_reason": null
  }
}`;

const marketPriceErrorExample = `{
  "error": {
    "code": "market_reference_window_incomplete",
    "message": "En fullständig marknadsreferens saknas och tenantens policy tillåter inte partiell fallback.",
    "field": "resolution_id",
    "request_id": "0e4366ee-eb3c-426d-8e82-55ec01e94b21",
    "correlation_id": "0e4366ee-eb3c-426d-8e82-55ec01e94b21",
    "retryable": true,
    "details": {
      "price_area": "SE3",
      "requested_days": 30,
      "included_days": 1,
      "allow_indicative_latest": false
    }
  }
}`;

const marketPriceErrors = [
  ['400', 'invalid_request', 'Begäran saknar eller innehåller ogiltiga fält.', 'Nej'],
  ['401', 'missing_api_token', 'Authorization-header eller API-token saknas.', 'Nej'],
  ['401', 'invalid_api_token', 'API-token är ogiltig.', 'Nej'],
  ['403', 'api_scope_missing', 'Nyckeln saknar website_market_prices.read.', 'Nej'],
  ['404', 'resolution_not_found', 'Resolutionen saknas eller tillhör inte tenant.', 'Nej'],
  ['409', 'resolution_expired', 'Resolutionen har gått ut och måste lösas på nytt.', 'Nej'],
  ['409', 'resolution_pricing_not_ready', 'Resolutionens blockerare för prissättning måste åtgärdas. PRODAT-readiness påverkar inte prisleverans.', 'Nej'],
  ['409', 'price_area_mismatch', 'Inskickat price_area motsäger resolutionen.', 'Nej'],
  ['409', 'market_price_stale', 'Provider-evidensen överskrider tenantens max_age_minutes.', 'Ja'],
  ['429', 'rate_limited', 'Klienten har överskridit sin rate limit.', 'Ja'],
  ['503', 'current_market_price_unavailable', 'Aktuellt intervall eller verifierad evidens saknas.', 'Ja'],
  ['500', 'market_price_provider_unavailable', 'Ett oväntat provider- eller driftfel inträffade.', 'Ja'],
] as const;


const calculatorExample = `// Tenantens backend använder OPS canonicala flöde.
const resolution = await gridex.post("/api/v1/website/energy-area/resolve", {
  street, postal_code, city, grid_area_code: claimedGridAreaCode
})

// HTTP 200 betyder att resolutionen sparades, inte alltid att den kan prissättas.
// Exempelvis postal_suggested har blockers och får inte skickas vidare till pris/offert.
if (!resolution.data.capabilities.pricing_ready) {
  renderResolutionBlockers(resolution.data.blockers.pricing)
  return
}

const currentPrice = await gridex.post("/api/v1/website/market-price/current", {
  resolution_id: resolution.data.resolution_id
})
renderCurrentSpotPrice(currentPrice.data)

if (!resolution.data.capabilities.quote_ready) {
  renderResolutionBlockers(resolution.data.blockers.quote)
  return
}

const quote = await gridex.post("/api/v1/website/quote", {
  resolution_id: resolution.data.resolution_id,
  offer_reference: contract.offer_reference,
  price_option_reference: contract.pricing.price_options[0].price_option_reference,
  invoice_delivery_method: "email",
  selected_component_references: [],
  site_count: 1,
  annual_consumption_kwh: annualConsumptionKwh,
  customer_type: "private",
  start_date: "2026-09-01"
})

// Visa quote.data exakt. Bygg inte om energipris, avgifter, rabatt eller moms.
renderPriceSummary(quote.data)

// market-price/current är spotmarknaden för aktuellt intervall, inte komplett kundpris.
// market_reference är den självbärande indikativa referensen som quote faktiskt använder.
// Ingen av dem är slutlig settlementdata för fakturering.`;

const publicContractsDiagnosticsExample = `curl -X GET "${apiBaseUrl}/website/public-contracts/diagnostics?customer_type=private" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Accept: application/json"

# Svaret innehåller visible/hidden och blockers per public_contract_offer.
# Använd detta server-side vid publiceringsfelsökning; visa inte intern diagnostik i kundens UI.`;

const portfolioPricesExample = `curl -X GET "${apiBaseUrl}/website/portfolio-prices?offer_reference=offer_...&price_area=SE3" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Accept: application/json"

# data.method beskriver den publika avtalsmetoden utan interna ID:n.
# data.historical_final_prices innehåller sanerade finala/låsta historikrader.
# Endpointen returnerar inga marknadsindikationer till tenantens kalkylator.
# data.final_billing_rule är alltid locked_settlement_only.`;

const applicationExample = `curl -X POST "${apiBaseUrl}/website/customer-applications" \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: website-order-12345" \
  -d '{
    "external_customer_id": "CUSTOMER-12345",
    "offer_reference": "offer_...",
    "quote_reference": "quote_...",
    "resolution_id": "uuid",
    "annual_consumption_kwh": 5000,
    "start_date": "2026-09-01",
    "customer": {
      "customer_type": "private",
      "first_name": "Anna",
      "last_name": "Andersson",
      "email": "anna@example.se",
      "phone": "+46701234567",
      "personal_number": "YYYYMMDDXXXX"
    },
    "site": {
      "facility_id": null,
      "street": "Storgatan 1",
      "postal_code": "21122",
      "city": "Malmö",
      "annual_consumption_kwh": 5000,
      "move_in_date": "2026-09-01",
      "current_supplier_name": "Nuvarande Energi AB",
      "current_supplier_org_number": "5560000000",
      "current_supplier_ediel_id": "12345"
    },
    "contract": {
      "requested_start_mode": "specific_date",
      "requested_start_date": "2026-09-01"
    },
    "customer_portal_user_id": "<gridex-web-supabase-session-user-id>",
    "auth_user_id": "<gridex-web-supabase-session-user-id>",
    "legal_bundle_version": "<bundle-uuid-from-legal-bundle>",
    "legal_acceptances": [
      {
        "requirement_code": "general_consumer_terms",
        "document_id": "<document-uuid-from-legal-bundle>",
        "document_version": "2026-07-30-v1",
        "document_hash": "<64-character-sha256-from-legal-bundle>",
        "accepted": true,
        "accepted_at": "2026-07-30T09:00:00Z"
      }
    ],
    "powerOfAttorney": {
      "accepted": true,
      "scope": ["supplier_switch", "facility_information_lookup"],
      "signerName": "Anna Andersson",
      "signerIdentityNumber": "YYYYMMDDXXXX",
      "method": "website_acceptance",
      "acceptedAt": "2026-07-30T09:00:00Z",
      "textVersionId": "legal_poa_uuid",
      "ipAddress": "203.0.113.10",
      "userAgent": "Mozilla/5.0 ..."
    }
  }'

# offer_reference, quote_reference och resolution_id ligger alltid top-level.
# Inga extra integrationslägen eller OpenAPI-fält behöver konfigureras i ENV.`

// Identity aliases: the customer identity is always stored in the canonical
// personal_number / org_number columns. Accepted private aliases:
// personal_number, personalNumber, personal_identity_number,
// personalIdentityNumber, identity_number, identityNumber, personnummer.
// Accepted business aliases: org_number, orgNumber, organization_number,
// organizationNumber, organisation_number, organisationNumber,
// organisationsnummer, orgnr.
//
// Juridikens source of truth är alltid OPS. Hemsidan ska visa juridiklänkarna
// och versionerna från public-contracts/legal-bundle och skicka tillbaka
// legal_bundle_version och en acceptansrad per returnerat krav med exakt
// document_id, document_version och document_hash. För fullmakt ska
// powerOfAttorney.textVersionId vara
// legal.power_of_attorney_version_id från det publicerade avtalet. Skicka inte
// egna juridiska texter, egna versionsnamn eller egen fullmaktstext som källa.
//
// Structured powerOfAttorney är obligatorisk för AUTOMATIC grid-owner
// communication: powerOfAttorney.accepted=true + signerName +
// signerIdentityNumber + method + textVersionId från OPS. Customer identity är
// inte fallback för nya website POAs. En fristående boolean-consent är inte ett
// canonicalt dokumentbevis; Web ska alltid skicka legal_acceptances-raden och
// den strukturerade fullmakten från samma bundle.
//
// När POST-svaret är accepted fortsätter OPS från ett persistent
// customer_application_continuation-jobb. Workern väljer exakt ett nästa steg:
// fullmaktskomplettering, manuell nätägarbegäran, Z01, supplier switch eller
// manuell granskning. API-requestens livstid styr aldrig fortsättningen.
const applicationResponse = `{
  "data": {
    "customer_id": "uuid",
    "customer_number": "DX-100025",
    "application_id": "uuid",
    "application_number": "APP-20260724-0001",
    "customer_site_id": "uuid",
    "metering_point_id": "uuid",
    "contract_id": "uuid",
    "workflow_id": "uuid",
    "continuation_job_id": "uuid",
    "status": "accepted",
    "workflow_state": "canonical_data_committed",
    "next_step": "automatic_processing",
    "missing_fields": [],
    "blocking_reasons": [],
    "communication": {
      "triggered": [],
      "queued": [],
      "sent": [],
      "failed": [],
      "pending": true,
      "source_of_truth": "communication_logs"
    },
    "supplier_switch": {
      "request_id": null,
      "status": "not_created",
      "can_create_request": true,
      "can_dispatch": false,
      "blockers": [],
      "next_action": "create_supplier_switch_request"
    }
  },
  "request_id": "uuid",
  "correlation_id": "uuid"
}

# accepted betyder att canonical kund/site/avtal/juridiksnapshot och quote
# committades atomiskt och att efterföljande idempotenta signatur-, workflow-
# och continuation-steg också slutfördes. Fel i eftersteg ger partial/failed,
# aldrig ett missvisande accepted. OPS äger därefter kundmail,
# nätägarbegäran, Z01/Z02, Z03/Z04, APERAK och aktivering. Tenant ska inte
# själv starta de stegen. Integrationsklienten följer nextAction/next_action
# i statusresponsen.

curl -X GET "${apiBaseUrl}/website/customer-applications/<application_id>" \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H "Accept: application/json"

# Statusendpointen returnerar endast tenant-skopad extern status:
# accepted | processing | needs_customer_information | completed | rejected | failed.`;

const applicationValidationErrors = `HTTP/1.1 422 Unprocessable Entity
{
  "error": {
    "code": "legal_acceptance_missing",
    "message": "Kunden måste godkänna allmänna villkor, integritetspolicy, ångerrätt, fullmakt och prisvillkor innan ansökan kan skickas.",
    "stage": "legal_acceptance",
    "field": "consents.terms",
    "hint": "Visa alla juridiska checkboxar från OPS publicerade juridikpaket och skicka true för varje required consent."
  }
}

Vanliga 422-koder:
- public_contract_required
- offer_reference_required
- offer_reference_mismatch
- offer_reference_mismatch
- public_contract_not_available
- offer_legal_versions_missing
- offer_legal_versions_invalid
- offer_legal_version_mismatch
- legal_acceptance_missing
- power_of_attorney_missing
- power_of_attorney_not_accepted
- power_of_attorney_version_missing
- requested_start_mode_invalid
- date_invalid
- timestamp_invalid
- unknown_field
- validation_error

Idempotency:
- Idempotency-Key är obligatorisk för POST /api/v1/website/customer-applications och ska vara 8–200 tillåtna tecken.
- Återanvänd samma nyckel endast med exakt samma normaliserade payload.
- Samma nyckel + annan payload ger 409 idempotency_key_payload_mismatch.
- Samma nyckel medan första requesten pågår ger 409 idempotency_in_progress.
- Identisk committed ansökan med en ny nyckel ger 409 duplicate_application.
- Samma kund/anläggning/erbjudande/startdatum som redan behandlas under annan nyckel ger 409 application_business_in_progress.
- Samma affärshändelse som redan är aktiv/committed ger 409 application_business_conflict.
- Replay av en committed status returnerar samma warnings och communication-snapshot som originalsvaret.
- Rätta en ogiltig payload innan första godkända requesten, eller använd en ny nyckel efter ett avslutat fel enligt den returnerade action/hint.`;

const emailEventSemantics = `I kundansökans communication-svar är eventKey mall-/affärshändelsen. Läs alltid dispatch_status/queued/sent/failed för faktisk utskicksstatus.

contract.application_received = mottagningsmail har skapats enligt tenantens regel
contract.confirmation_sent = avtalsbekräftelse med fryst avtals-PDF har skapats enligt tenantens regel
contract.cooling_off_sent = ångerrättsmail har skapats enligt tenantens regel

Webhook/domain event med samma *_sent-namn publiceras däremot först när communication_logs har markerats sent/delivered av leverantören. Ett köat mail är aldrig samma sak som levererat.`;

const portalBundlePayload = `{
  "email": "heke99@live.se",
  "customer_number": "DX-100023",
  "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f"
}`;

const customerFetchExample = `fetch("${apiBaseUrl}/customer/portal-bundle", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer $GRIDEX_API_KEY"
  },
  body: JSON.stringify({
    email: session.user.email,
    customer_number: localCustomer.customerNumber,
    external_customer_id: localCustomer.externalCustomerId
  }),
  cache: "no-store"
})`;

const customerFetchHeaderExample = `fetch("${apiBaseUrl}/customer/portal-bundle", {
  headers: {
    Authorization: "Bearer $GRIDEX_API_KEY",
    "x-gridex-customer-portal-user-id": "<gridex-web-supabase-session-user-id>",
    "x-gridex-auth-user-id": "<gridex-web-supabase-session-user-id>",
    "x-gridex-external-customer-id": "CUSTOMER-12345",
    "x-gridex-customer-number": "DX-100025"
  },
  cache: "no-store"
})`;

const authLinkingRequiredHeaders = `Authorization: Bearer $GRIDEX_API_KEY
x-gridex-customer-portal-user-id: <gridex-web-supabase-session-user-id>
x-gridex-auth-user-id: <gridex-web-supabase-session-user-id>
x-gridex-external-customer-id: <external_customer_id>
# eller, om external_customer_id saknas:
x-gridex-customer-number: DX-100025
# optional fallback:
x-gridex-customer-email: kund@example.se`;

const authLinkingFlow = `Gridex-webb Supabase session.user.id
→ x-gridex-customer-portal-user-id till OPS
→ OPS matchar tenant via API-nyckeln
→ OPS matchar kund via redan länkad auth-user, riktigt external_customer_id eller kundnummer + e-post
→ första auto-länkning kräver redan länkad användare eller minst två matchande kunduppgifter
→ OPS skapar/uppdaterar customer_portal_accounts.role = owner
→ OPS fyller customer_portal_identities.auth_user_id och customer_portal_user_id
→ GET /api/v1/customer/portal-bundle returnerar kundens data`;

const authLinkingChecklist = `Tenantens backend ska:
1. läsa Supabase session.user.id server-side
2. skicka user.id i x-gridex-customer-portal-user-id
3. skicka samma user.id i x-gridex-auth-user-id
4. skicka external_customer_id från ansökan eller customer_number från OPS
5. aldrig skicka company_id eller customer_id från frontend
6. använda POST /api/v1/customer/portal-bundle som huvudendpoint för Mina sidor`;

const customerSyncExample = `curl -X POST "${apiBaseUrl}/customer/sync" \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: tenant-sync-12345" \
  -d '{
    "email": "heke99@live.se",
    "customer_number": "DX-100023",
    "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f",
    "power_of_attorney": {
      "scope": "supplier_switch",
      "status": "signed",
      "signed_at": "2026-06-16T15:10:12.647Z",
      "legal_text_version": "2026-06-12-v1",
      "reference": "POA-39e9fbc4-2c94-46fb-a1ee-49d18cb0932a",
      "document": {
        "external_document_id": "tenant-doc-123",
        "document_type": "power_of_attorney",
        "title": "Signerad fullmakt",
        "file_url": "https://tenant.se/documents/tenant-doc-123.pdf"
      }
    },
    "legal_acceptances": [
      { "acceptance_type": "terms", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
      { "acceptance_type": "privacy_policy", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
      { "acceptance_type": "price_snapshot", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" }
    ],
    "documents": [
      {
        "external_document_id": "tenant-contract-123",
        "document_type": "contract_confirmation",
        "title": "Avtalsbekräftelse",
        "file_url": "https://tenant.se/documents/tenant-contract-123.pdf"
      }
    ]
  }'`;

const customerStatusResponseExample = `{
  "data": {
    "profile": {
      "customer_number": "DX-100023",
      "display_name": "Hekmat Hourani",
      "email": "heke99@live.se"
    },
    "customer_status": {
      "code": "needs_facility_data",
      "label": "Ansökan behandlas",
      "message": "Vi behöver komplettera anläggningsuppgifter innan leverantörsbytet kan starta.",
      "supplier_switch": {
        "can_create_request": false,
        "can_dispatch": false,
        "blockers": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"],
        "next_action": "complete_application"
      },
      "can_start_switch": false
    },
    "data_quality": {
      "status": "needs_action",
      "issues": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"]
    }
  }
}`;

const webhookPayload = `{
  "id": "event_123",
  "type": "contract.application_received",
  "event_id": "event_123",
  "event_type": "contract.application_received",
  "created_at": "2026-06-16T10:30:00Z",
  "company_id": "uuid",
  "customer_id": "uuid",
  "customer_number": "DX-100025",
  "external_customer_id": "CUSTOMER-12345",
  "aggregate": { "type": "customer_contract", "id": "uuid" },
  "data": {
    "application_id": "uuid",
    "contract_id": "uuid",
    "status": "application_received"
  }
}`;

const webhookHeaders = `X-Gridex-Event-Id: event_123
X-Gridex-Event-Type: contract.application_received
X-Gridex-Timestamp: 1718532000
X-Gridex-Signature: sha256=<signature>
X-Gridex-Delivery-Id: delivery_123`;

const cronEndpoints = `POST /api/internal/customer-operations/cron     Authorization: Bearer <CUSTOMER_OPERATION_CRON_SECRET | CRON_SECRET>
POST /api/internal/manual-email/outbox/process   Authorization: Bearer <MANUAL_EMAIL_OUTBOX_CRON_SECRET | EMAIL_OUTBOX_CRON_SECRET | CRON_SECRET>
POST /api/internal/manual-inbound/cron           Authorization: Bearer <MANUAL_INBOUND_CRON_SECRET | CRON_SECRET>   (även x-manual-inbound-secret)`;

const webhookReceiver = `import { createHmac, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

function verify(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) return false
  const secret = process.env.GRIDEX_WEBHOOK_SIGNING_SECRET
  if (!secret) return false

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(timestamp + "." + rawBody)
    .digest("hex")

  const received = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  return received.length === wanted.length && timingSafeEqual(received, wanted)
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const ok = verify(
    rawBody,
    request.headers.get("x-gridex-timestamp"),
    request.headers.get("x-gridex-signature")
  )
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 })

  const event = JSON.parse(rawBody)
  // Spara event.id idempotent innan ni kör affärslogik.
  return NextResponse.json({ received: true })
}`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
        {children}
      </div>
    </section>
  );
}

export default function CustomerPortalApiDocsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">
            Gridex Developers
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">
            Website API, Mina sidor-koppling och webhooks
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
            Den här guiden är den publika online-dokumentationen för tenants och
            webbteam. En tenant behöver endast en server-side
            <code>GRIDEX_API_KEY</code>. API-nyckeln identifierar tenant, bolag
            och scopes; bas-URL, payloadplacering och OpenAPI-version är fasta
            delar av kontraktet.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Dokumentationsversion: <code>{documentationVersion}</code>
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-slate-500">
                API Base URL
              </div>
              <div className="mt-2 break-all font-mono text-sm text-slate-950">
                {apiBaseUrl}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-slate-500">
                Auth
              </div>
              <div className="mt-2 font-mono text-sm text-slate-950">
                Bearer API key
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-slate-500">
                Support
              </div>
              <div className="mt-2 text-sm text-slate-950">
                Supportärenden ligger utanför API:t.
              </div>
            </div>
          </div>
        </section>

        <Section title="1. Autentisering och säkerhet">
          <p>
            Tenantens enda obligatoriska miljövariabel är
            <code>GRIDEX_API_KEY</code>. API-nyckeln identifierar tenant, bolag
            och behörigheter. Lägg nyckeln i servermiljö, aldrig i publik
            frontend. Lägg inte in tenant-ID, company-ID, separat payloadläge,
            separat tenantreferens eller OpenAPI-sökväg som miljövariabler.
          </p>
          <CodeBlock>{tenantSetupExample}</CodeBlock>
          <CodeBlock>{authExample}</CodeBlock>
          <p>
            Verifiera alltid nyckelns opaka tenantidentitet via
            <code>GET /api/v1/integration/context</code>. Värdet
            <code>tenant_reference</code> är stabilt och tenantunikt men är inte
            samma sak som internt <code>company_id</code>. Externa klienter får
            aldrig skicka <code>company_id</code> som tenantväljare.
          </p>
          <CodeBlock>{tenantContextExample}</CodeBlock>
          <p>
            Allowed origins skyddar webbläsaranrop. Server-till-server-anrop kan
            sakna Origin-header och ska därför alltid hålla API-nyckeln hemlig.
            API:t filtrerar data per bolag från nyckeln; klienten ska inte
            skicka egen bolagsidentifierare.
          </p>
          <p>
            API-klientens status och tenantens driftstatus kontrolleras separat
            vid varje anrop. En tenant i <code>onboarding</code> får
            <code>403 tenant_not_operationally_ready</code>, en pausad tenant
            får <code>423 tenant_paused</code>, och en terminalt stängd tenant
            får <code>410 tenant_closed</code>. Pausning och stängning blockerar
            därmed även public contracts, nya quotes och kundansökningar; det
            räcker inte att API-nyckeln fortfarande ser aktiv ut i en gammal
            klientcache.
          </p>
        </Section>

        <Section title="2. Behörigheter">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">I vanliga ord</th>
                  <th>Teknisk behörighet</th>
                  <th>Betydelse</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((row) => (
                  <tr key={row[1]} className="border-b last:border-0">
                    <td className="py-2 font-semibold text-slate-900">
                      {row[0]}
                    </td>
                    <td className="font-mono text-xs">{row[1]}</td>
                    <td>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            OPS provisionerar standardpaketet för hemsida/Mina sidor på samma
            API-nyckel. Tenantens webb ska inte konfigurera scopes som
            miljövariabler. Kundroutes filtrerar alltid per bolag från nyckeln.
          </p>
          <ul className="list-disc pl-5">
            {futurePermissions.map((row) => (
              <li key={row[1]}>
                <strong>{row[0]}:</strong> <code>{row[1]}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="3. Endpoints">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Metod</th>
                  <th>Path</th>
                  <th>Behörighet</th>
                  <th>Beskrivning</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((row) => (
                  <tr
                    key={`${row[0]}-${row[1]}`}
                    className="border-b last:border-0"
                  >
                    <td className="py-2 font-mono text-xs">{row[0]}</td>
                    <td className="font-mono text-xs">{row[1]}</td>
                    <td className="font-mono text-xs">{row[2]}</td>
                    <td>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="4. Hämta publicerade avtal">
          <p>
            Svaret innehåller bara avtal som är publicerade, aktiva för
            hemsida/API, datumgiltiga, kopplade till aktiv prisversion/prislista
            och har publicerad juridik.
          </p>
          <CodeBlock>{publicContractsExample}</CodeBlock>
          <CodeBlock>{publicContractsResponse}</CodeBlock>
          <p>
            <code>GET /public-contracts</code> är urvals-API och publicerat
            produktunderlag. <code>pricing.calculation_components</code> innehåller
            alla tillämpliga prisdelar och avgifter, även när
            <code>website_visibility=hidden</code>, men kundens slutliga preview ska
            alltid hämtas från OPS quote. <code>pricing.display_components</code> är
            avtalskortets synliga delmängd. Värdet <code>0</code> är ett giltigt
            publicerat penningvärde; kontrollera uttryckligen null/undefined.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Operation</th>
                  <th>Syfte</th>
                  <th>Aktuellt spotpris</th>
                  <th>Komplett kundpris</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b"><td className="py-2 font-mono text-xs">GET /website/public-contracts</td><td>Produkt- och urvalsfeed</td><td>Nej</td><td>Nej</td></tr>
                <tr className="border-b"><td className="py-2 font-mono text-xs">POST /website/market-price/current</td><td>Aktuellt spotprisintervall</td><td>Ja</td><td>Nej</td></tr>
                <tr><td className="py-2 font-mono text-xs">POST /website/quote</td><td>Canonical kundkalkyl</td><td>Som market_reference</td><td>Ja</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            <code>public-contracts</code> returnerar inte dynamiskt aktuellt spotpris.
            Använd <code>market-price/current</code> när sidan ska visa &quot;Elpriset just nu&quot;.
            Det svaret är före moms, energiskatt, leverantörspåslag, månadsavgift,
            fakturaavgift och elnätsavgifter. Använd alltid <code>quote</code> för kundens
            kompletta beräkning.
          </p>
          <CodeBlock>{currentMarketPriceExample}</CodeBlock>
          <CodeBlock>{marketReferenceExample}</CodeBlock>
          <p>
            <code>requested_days</code> beskriver önskat referensfönster och
            <code>included_days</code> hur många verifierade dygn som faktiskt ingår.
            En partiell fallback returneras endast om tenantens policy uttryckligen tillåter den.
            <code>source_as_of</code> kommer från provider-evidensen medan
            <code>generated_at</code> bara är beräkningstiden.
          </p>
          <CodeBlock>{marketPriceErrorExample}</CodeBlock>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th className="py-2">HTTP</th><th>Kod</th><th>När</th><th>Retry</th></tr></thead>
              <tbody>
                {marketPriceErrors.map((row) => (
                  <tr key={row[1]} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{row[0]}</td>
                    <td className="font-mono text-xs">{row[1]}</td>
                    <td>{row[2]}</td>
                    <td>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Tenantens backend ska först skapa en tenantbunden områdesresolution
            och därefter en OPS-quote. Det gäller fastpris, rörligt månadspris,
            timpris och kvartspris. Tenant får visa den returnerade quoten men får
            inte räkna om energipris, områdesrad, påslag, avgifter, rabatt eller moms.
            För rörliga produkter innehåller quoten en indikativ
            <code>market_reference</code> med källa, period, as-of, freshness och fallback.
          </p>
          <CodeBlock>{calculatorExample}</CodeBlock>
          <p>
            Hemsidan ska använda exakt <code>offer_reference</code> från svaret
            när kunden tecknar avtal. Det är den enda avtalsväljaren.{" "}
            <code>product_code</code>, <code>price_plan_id</code>,{" "}
            <code>price_plan_version_id</code> och{" "}
            <code>contract_offer_id</code> får inte användas för att välja
            avtal; motstridiga legacyfält ger{" "}
            <code>422 offer_reference_mismatch</code>.
          </p>
          <p>
            <code>customer_type=both</code> kompletteras med{" "}
            <code>
              customer_types=[&quot;private&quot;,&quot;business&quot;]
            </code>
            . Tenantens UI ska därför visa <strong>Privat och företag</strong>,
            inte behandla okända värden som privatkund.
          </p>
          <p>
            Varje publicerad priskomponent skiljer på
            <code>calculation_inclusion</code> och <code>website_visibility</code>.
            Dold presentation får aldrig ta bort komponenten från API:t eller
            kalkylen. <code>pricing.components</code> är ett kompatibilitetsalias
            för hela <code>calculation_components</code>; använd
            <code>display_components</code> för avtalskortet och
            <code>summary_components</code> för den fullständiga prisuppdelningen.
          </p>
          <p>
            Historiska slutpriser kan returneras i{" "}
            <code>pricing.portfolio_monthly_prices</code>. De är sanerade,
            historiska och får inte behandlas som ett aktuellt marknadspris i
            tenantens kalkylator. Portföljandel, portföljpris och
            portföljförvaltningsavgift är olika begrepp. En procentuell
            förvaltningsavgift använder värden i intervallet <code>0..100</code>{" "}
            och måste ange en explicit beräkningsbas i{" "}
            <code>calculation_base</code>.
          </p>
          <p>
            För en separat historikvy används{" "}
            <code>GET /api/v1/website/portfolio-prices</code>. Endpointen är
            read-only, tenant-scopad från API-nyckeln och kräver exakt{" "}
            <code>offer_reference</code>. Svaret innehåller endast publik metod
            och sanerade finala historikrader. OPS returnerar inga prognoser,
            interna portfölj-ID:n, prisplansversions-ID:n eller
            marknadsindikationer till tenantens kalkylator. Slutlig fakturering
            kräver fortfarande exakt låst intern avräkning.
          </p>
          <CodeBlock>{portfolioPricesExample}</CodeBlock>
          <p>
            <code>energy_direction</code> är obligatoriskt och är antingen
            <code>consumption</code> eller <code>production</code>. Ett
            produktionsavtal har dessutom explicit <code>production_pricing</code>
            med ersättningsmodell, upplösning, avdrag/påslag eller fast
            ersättning, momsbehandling och <code>settlement_mode</code>. Vid
            <code>self_billing</code> skapas kredit-/självfaktureringsflöde och
            aldrig en vanlig konsumtionsleverans eller konsumtionsfaktura.
          </p>
          <p>
            Juridikpaketet hämtas canonicalt med
            <code>GET /api/v1/website/legal-bundle</code>. Tenant härleds från
            API-nyckeln; endpointen accepterar inget <code>company_id</code>.
            Den äldre sökvägen <code>/website/legal/bundle</code> finns inte och
            ska inte användas.
          </p>
          <p>
            Juridiken i <code>legal</code> är OPS source of truth. Visa
            dokumentlänkarna från OPS och skicka separata consent-flaggor. OPS
            binder varje accept server-side till exakt{" "}
            <code>legal_bundle_version_document_id</code>, dokumentversion och
            dokumenthash i den låsta juridikpaketversionen. Kravuppsättningen är
            databasdriven och kan variera med kundtyp, avtal, prismodell, kanal,
            produkt och fullmakt; klienten får inte anta fem fasta dokument.
          </p>
          <p>
            Vid publiceringsfelsökning kan tenantens backend använda{" "}
            <code>/api/v1/website/public-contracts/diagnostics</code> med scope <code>website_contracts.diagnostics</code>. V1-kompatibiliteten <code>diagnostics=1</code> finns kvar men är deprecated och kräver samma separata scope. Svaret förklarar per erbjudande varför
            det är synligt eller blockerat, exempelvis status, datum, kundtyp,
            prisbok, prisplansversion eller juridikpaket. Fältet
            <code>pricing_readiness.invoice_fee</code> visar amount, unit,
            website_card_visible och källa, eller blockerarkoderna
            <code>invoice_fee_missing</code>, <code>invoice_fee_conflict</code>
            och <code>invoice_fee_ambiguous</code>.
          </p>
          <CodeBlock>{publicContractsDiagnosticsExample}</CodeBlock>
        </Section>

        <Section title="5. Skicka kundansökan">
          <p>
            Kundansökan ska innehålla canonical top-level
            <code>offer_reference</code>, <code>quote_reference</code> och
            <code>resolution_id</code> från samma OPS-flöde, tillsammans med
            <code>annual_consumption_kwh</code>, startdatum, kund, adress och de
            dokumenterade juridiska godkännandena. Tenantens webb skickar inte
            ett eget prisområde som sanning och lägger inte referenserna under
            <code>contract</code>. När kunden redan är inloggad skickas webbens
            Supabase <code>session.user.id</code> som både
            <code>customer_portal_user_id</code> och <code>auth_user_id</code>.
            OPS skapar kund, kundnummer, portal
            identity, prissnapshot och ett först väntande avtal. Därefter
            verifierar en atomisk serverfunktion de exakta juridikversionerna
            och sätter <code>status=signed</code>, <code>signed_at</code>,
            ångerfrist och <code>signature_snapshot_sha256</code>. Klientens
            egna <code>signed_at</code>/<code>acceptedAt</code> används inte som
            avtalets juridiska signeringstid.
          </p>
          <p>
            Direkt efter lyckad signering köas mottagningsmail,
            avtalsbekräftelse med fryst PDF och ångerrättsmail enligt tenantens
            regler. Detta är frikopplat från anläggningsuppslagning och
            leverantörsbyte. <code>can_send_agreement_confirmation</code>{" "}
            beskriver juridisk behörighet att skicka bekräftelsen och är därför
            oberoende av <code>supplier_switch.can_create_request</code> och{" "}
            <code>supplier_switch.can_dispatch</code>. Läs{" "}
            <code>communication.queued/sent/failed</code> för faktisk status.
          </p>
          <CodeBlock>{applicationExample}</CodeBlock>
          <CodeBlock>{applicationResponse}</CodeBlock>
          <h3 className="mt-6 text-lg font-bold text-slate-900">
            422-validering och juridiska retries
          </h3>
          <p>
            Om avtal, juridiska versioner, acceptanser, datum eller fullmakt
            saknas/är ogiltiga returneras <code>422</code> med stabil{" "}
            <code>error.code</code>, <code>stage</code> och <code>field</code>.{" "}
            <code>requested_start_mode</code> accepterar endast{" "}
            <code>earliest_possible</code> eller <code>specific_date</code>;
            datum ska vara <code>YYYY-MM-DD</code> och{" "}
            <code>powerOfAttorney.acceptedAt</code> ska vara ISO 8601. Okända
            top-level- och nested-fält returnerar <code>unknown_field</code> i
            stället för att ignoreras.
          </p>
          <p>
            <code>Idempotency-Key</code> är obligatorisk för kundansökan.
            Återanvänd nyckeln endast med exakt samma normaliserade payload. En
            ändrad payload ger <code>409 idempotency_key_payload_mismatch</code>
            , en pågående request ger <code>409 idempotency_in_progress</code>,
            en identisk committed ansökan under ny nyckel ger{" "}
            <code>409 duplicate_application</code>, en parallell pågående
            affärshändelse ger <code>409 application_business_in_progress</code>{" "}
            och en redan aktiv/committed affärshändelse ger{" "}
            <code>409 application_business_conflict</code>.
          </p>
          <p>
            Nuvarande leverantör kan skickas under{" "}
            <code>site.current_supplier_name</code>,{" "}
            <code>current_supplier_id</code>,{" "}
            <code>current_supplier_org_number</code>,{" "}
            <code>current_supplier_ediel_id</code> och kompletterande
            avtalsfält. Leverantörs-ID:t snapshotas på både site och switch
            request. Svaret skiljer på{" "}
            <code>supplier_switch.can_create_request</code> och{" "}
            <code>supplier_switch.can_dispatch</code>. En skapad men blockerad
            switch returnerar en konkret blockerare och{" "}
            <code>supplier_switch.next_action</code>. När site, mätpunkt,
            nuvarande leverantör eller signerad fullmakt kompletteras körs
            reconcile och en saknad/öppen switch kan skapas eller återupptas.
          </p>
          <CodeBlock>{applicationValidationErrors}</CodeBlock>
        </Section>

        <Section title="6. Obligatoriskt: Mina sidor-koppling">
          <p>
            Det här flödet heter{" "}
            <strong>Customer Portal External Auth Linking</strong>. På svenska
            kallar vi det <strong>Mina sidor-koppling</strong>. Det ska användas
            när tenantens hemsida har egen Supabase Auth och OPS inte har kunden
            i sin egen <code>auth.users</code>.
          </p>
          <p>
            Tenantens backend måste skicka webbens Supabase{" "}
            <code>session.user.id</code> till OPS tillsammans med en stabil
            kundnyckel. API-nyckeln avgör alltid bolag/tenant; hemsidan ska
            aldrig skicka <code>company_id</code> eller ett fritt{" "}
            <code>customer_id</code>.
          </p>
          <CodeBlock>{authLinkingRequiredHeaders}</CodeBlock>
          <CodeBlock>{authLinkingFlow}</CodeBlock>
          <CodeBlock>{authLinkingChecklist}</CodeBlock>
          <p>
            OPS skapar eller uppdaterar då <code>customer_portal_accounts</code>{" "}
            med rollen <code>owner</code> och fyller{" "}
            <code>customer_portal_identities.auth_user_id</code>,{" "}
            <code>customer_portal_identities.customer_portal_user_id</code> och{" "}
            <code>external_account_id</code>. Värdet <code>customer</code> är
            inte en giltig portalroll. Skicka inte OPS-kundnummer som{" "}
            <code>external_customer_id</code>; använd{" "}
            <code>customer_number</code> när det är kundnumret.
          </p>
          <p>
            OPS-kundnummer är tenantens kundnummer. Fakturapartners som Capway
            ska senare kopplas via separata fält som{" "}
            <code>billing_customer_ref</code> och provider-metadata, inte genom
            att skriva över <code>customer_number</code> eller blanda ihop det
            med <code>external_customer_id</code>.
          </p>
        </Section>

        <Section title="7. Hämta Mina sidor-data">
          <p>
            Tenantens Mina sidor ska anropa OPS server-side med exakt
            kundidentifiering från den inloggade kunden. Rekommenderad
            JSON-payload är <code>email</code>, <code>customer_number</code> och{" "}
            <code>external_customer_id</code>.
          </p>
          <CodeBlock>{portalBundlePayload}</CodeBlock>
          <CodeBlock>{customerFetchExample}</CodeBlock>
          <p>Headers/query stöds fortsatt för äldre implementationer:</p>
          <CodeBlock>{customerFetchHeaderExample}</CodeBlock>
          <CodeBlock>{customerStatusResponseExample}</CodeBlock>
          <p>
            Alla kundroutes filtrerar på bolag från API-nyckeln och löser kunden
            via riktigt <code>external_customer_id</code>, kundnummer eller unik
            e-post. Om flera kunder matchar samma e-post returneras{" "}
            <code>409 ambiguous_customer_match</code>. Saknade listor returneras
            som tomma arrayer, inte 500.
          </p>
          <p>
            <code>customer_status.supplier_switch</code> skiljer på att skapa
            och att skicka en bytesbegäran. <code>can_start_switch</code> är en
            utfasad kompatibilitetsalias för <code>can_dispatch</code>.
          </p>
        </Section>

        <Section title="8. Synka dokument, fullmakt och juridiska godkännanden till OPS">
          <p>
            Godkända fullmakter, juridiska godkännanden och dokument ska skickas
            till OPS så att OPS kan starta rätt automatiska processer. Använd{" "}
            <code>POST /api/v1/customer/sync</code>. Anropet är tenant-säkert:
            API-nyckeln avgör bolag och payloaden får inte innehålla fritt{" "}
            <code>company_id</code>.
          </p>
          <CodeBlock>{customerSyncExample}</CodeBlock>
          <p>
            OPS sparar fullmakt i <code>powers_of_attorney</code>, juridiska
            godkännanden i <code>customer_legal_acceptances</code> och dokument
            i <code>customer_documents</code>. Om anläggningsdata saknas skapas
            statusen <code>needs_facility_data</code> och switch blockeras tills
            mätpunkt/nätägare är verifierade.
          </p>
        </Section>

        <Section title="9. Webhooks">
          <p>
            Webhookar skickas som POST till konfigurerad HTTPS-URL. Leveransen
            signeras med HMAC SHA-256 över <code>timestamp.rawBody</code>.
            Mottagaren ska svara 2xx när eventet är mottaget.
          </p>
          <CodeBlock>{webhookHeaders}</CodeBlock>
          <CodeBlock>{webhookPayload}</CodeBlock>
          <p>Aktiva/byggda events:</p>
          <ul className="grid gap-1 md:grid-cols-2">
            {activeWebhookEvents.map((event) => (
              <li key={event} className="font-mono text-xs text-slate-800">
                {event}
              </li>
            ))}
          </ul>
          <p>Interna livscykelhändelser (inte ett publikt webhooklöfte):</p>
          <ul className="grid gap-1 md:grid-cols-2">
            {internalLifecycleEvents.map((event) => (
              <li key={event} className="font-mono text-xs text-slate-500">
                {event}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-lg font-bold text-slate-900">
            Mail- och webhook-semantik
          </h3>
          <p>
            Juridiska webhookar speglar faktisk kommunikation:{" "}
            <code>contract.confirmation_sent</code> och{" "}
            <code>contract.cooling_off_sent</code> publiceras först när
            respektive mail-logg är <code>sent</code>/<code>delivered</code>. I
            kundansökans direkta svar är samma namn däremot
            mall-/affärshändelser och måste alltid läsas tillsammans med{" "}
            <code>dispatch_status</code>.
          </p>
          <CodeBlock>{emailEventSemantics}</CodeBlock>
          <p>Planerade events som kan tillkomma senare:</p>
          <ul className="grid gap-1 md:grid-cols-2">
            {plannedWebhookEvents.map((event) => (
              <li key={event} className="font-mono text-xs text-slate-500">
                {event}
              </li>
            ))}
          </ul>
          <CodeBlock>{webhookReceiver}</CodeBlock>
          <h3 className="mt-6 text-lg font-bold text-slate-900">
            Resend-leveranswebhook och interna cron-jobb
          </h3>
          <p>
            Manuell nätägar-e-post levereransspåras via Resend-webhooken{" "}
            <code>POST /api/webhooks/resend</code>. Den verifieras mot{" "}
            <strong>rå</strong> request-body med Svix-huvuden och{" "}
            <code>RESEND_WEBHOOK_SECRET</code>. Felklasser:{" "}
            <code>missing_headers</code> (400), <code>missing_secret</code>{" "}
            (500), <code>resend_webhook_invalid_signature</code> (401) och{" "}
            <code>event_processing_failed</code> (500). En manuell{" "}
            <code>curl</code> utan giltiga Svix-huvuden misslyckas avsiktligt –
            använd Resend-dashboardens testevent och deploya om Vercel efter att
            miljövariabeln ändrats. <code>RESEND_WEBHOOK_SECRET</code> måste
            vara den exakta signeringshemligheten för exakt den endpoint som
            används.
          </p>
          <p>
            Webhooken uppdaterar{" "}
            <code>manual_email_outbox.delivery_status</code> (<code>sent</code>/
            <code>delivered</code>/<code>delivery_delayed</code>/
            <code>bounced</code>/<code>complained</code>/<code>failed</code>/
            <code>suppressed</code>) och sätter den länkade begäran till{" "}
            <code>needs_review</code> vid negativ leverans. Interna cron-jobb
            skyddas med <code>Authorization: Bearer &lt;secret&gt;</code> eller{" "}
            <code>x-cron-secret</code>:
          </p>
          <CodeBlock>{cronEndpoints}</CodeBlock>
        </Section>

        <Section title="10. Fel, rate limits och idempotency">
          <p>
            Rate limiting är per API-klient, endpoint och 60-sekundersfönster.
            Läs <code>X-RateLimit-Limit</code>,{" "}
            <code>X-RateLimit-Remaining</code> och{" "}
            <code>X-RateLimit-Reset</code>. Ett verkligt kvotöverskridande ger{" "}
            <code>429 rate_limited</code> samt <code>Retry-After</code>. Vänta
            minst angiven tid före retry. Infrastrukturfel i limitern ger i
            stället <code>503 api_rate_limiter_unavailable</code>, och felaktig
            klientgräns ger <code>503 api_rate_limit_invalid</code>.
          </p>
          <p>
            Alla write-anrop bör skicka <code>Idempotency-Key</code>; för{" "}
            <code>POST /api/v1/website/customer-applications</code> är den
            obligatorisk och valideras till 8–200 tecken. Samma nyckel är låst
            till samma normaliserade payload via SHA-256. Stabil
            idempotency-respons: <code>idempotency_key_required</code> (400),{" "}
            <code>idempotency_key_invalid</code> (400),{" "}
            <code>idempotency_key_payload_mismatch</code> (409),{" "}
            <code>idempotency_in_progress</code> (409),{" "}
            <code>duplicate_application</code> (409),{" "}
            <code>application_business_in_progress</code> (409),{" "}
            <code>application_business_conflict</code> (409) och{" "}
            <code>idempotent_failed</code> (409). En committed replay returnerar
            den sparade responsen inklusive warnings och communication. Ett
            avslutat misslyckat försök får endast retryas enligt returnerad
            hint; komplettering ska göras på befintlig ansökan och en verkligt
            ny affärshändelse ska använda ny nyckel samt annan
            site/offer/start-identitet.
          </p>
          <p>
            Batch 8.1 live-schema alignment: inkommande mätpunkter provisioneras
            mot <code>public.metering_points</code>;{" "}
            <code>external_customer_id krävs</code> för stabil kundlänkning;
            mailinställningar stödjer <code>sender_email</code> och{" "}
            <code>reply_to_email</code>.
          </p>
        </Section>

        <Section title={`11. Canonical integrationskontrakt ${documentationVersion}`}>
          <h3 className="text-lg font-bold text-slate-900">Kundtyp och routes</h3>
          <p>
            Canonical kundtyper är <code>private</code> och <code>business</code>.
            <code>company</code> accepteras tillfälligt som deprecated alias för
            <code>business</code> till och med 2026-10-31. Ogiltiga queryvärden
            ger strukturerat <code>400</code>. Canonical routes är
            <code>/api/v1/website/public-contracts</code>,
            <code>/api/v1/website/public-contracts/diagnostics</code>,
            <code>/api/v1/website/customer-applications</code>,
            <code>/api/v1/contracts</code> och
            <code>/api/v1/customer/portal-bundle</code>. Parametern
            <code>?diagnostics=1</code> är deprecated till 2026-10-31 och
            returnerar deprecation- och sunset-headers.
          </p>

          <h3 className="mt-6 text-lg font-bold text-slate-900">Kanaler</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li><code>internal</code>: endast OPS interna sälj- och administrationsflöden.</li>
            <li><code>website</code>: public feed, tenantautentiserad elområdesresolution, canonical quote och teckning på tenantens hemsida.</li>
            <li><code>api</code>: separat partnerfeed via <code>GET /api/v1/contracts</code> och scope <code>api_contracts.read</code>.</li>
          </ul>
          <p>
            Revision, ETag och cache är bundna till <code>tenant + channel</code>.
            Skicka <code>If-None-Match</code> med föregående ETag; oförändrad feed
            ger <code>304 Not Modified</code>. Publish, unpublish, pause,
            republish, archive, delete samt publiceringspåverkande pris-, juridik-
            och avgiftsändringar höjer revisionen.
          </p>

          <h3 className="mt-6 text-lg font-bold text-slate-900">Pris- och elområdesansvar</h3>
          <p>
            OPS är source of truth för publicerad prismodell, fast pris per SE-område,
            påslag, alla avgifter, moms, synlighetsregler och versionskopplingar.
            Ett fastprisavtal publiceras en gång och innehåller sin prismatris i
            <code>area_pricing</code>. Tenantens backend använder den autentiserade
            <code>/api/v1/website/energy-area/resolve</code>, skapar en tenantbunden
            <code>/api/v1/website/quote</code> och validerar den före teckning.
            Endast den oautentiserade legacyrutten <code>/api/public/energy-area</code>
            är fortsatt borttagen.
          </p>
          <p>
            OPS äger både den indikativa marknadsreferensen och slutlig settlement.
            Quotens <code>market_reference</code> är självbärande och innehåller direkt pris i SEK/kWh och öre/kWh, requested/included days, <code>source_as_of</code>, <code>generated_at</code>, effective freshness och fallback. Settlementdata exponeras inte som preview och får endast
            användas efter full täckning, verifiering och explicit immutable låsning.
          </p>

          <h3 className="mt-6 text-lg font-bold text-slate-900">Diagnostics och webhook</h3>
          <p>
            Diagnostics använder samma canonical graf och readinesskälla som
            normal feed och rapporterar minst
            <code>canonical_graph_consistent</code>,
            <code>forward_publication_link_valid</code>,
            <code>reverse_legacy_link_valid</code>,
            <code>company_chain_valid</code>,
            <code>tenant_assignment_valid</code>, <code>channel_valid</code>,
            <code>source_offer_consistent</code>, <code>pricing_ready</code>,
            <code>legal_ready</code>, <code>invoice_fee_ready</code>,
            <code>publication_active</code> och
            <code>application_acceptance_ready</code>. Normalfältet
            <code>data</code> byter aldrig typ.
          </p>
          <p>
            <code>contracts.publication.changed</code> levereras genom samma
            signerade <code>webhook_deliveries</code>-pipeline som övriga events.
            Payloaden innehåller event-ID, opak tenantreferens, kanal, revision,
            orsak och timestamp. Mottagaren ska verifiera HMAC, avvisa gamla
            timestamps, deduplicera på event-ID/idempotency key och returnera 2xx.
            OPS hanterar retries, leveranshistorik och dead-letter-status.
          </p>
          <p>
            Maskinläsbara kontrakt publiceras stabilt på
            <a className="ml-1 font-mono text-emerald-700 underline" href={releaseManifestUrl}>
              {releaseManifestUrl}
            </a>,{" "}
            <a className="ml-1 font-mono text-emerald-700 underline" href={websiteOpenApiUrl}>
              {websiteOpenApiUrl}
            </a>{" "}
            och
            <a className="ml-1 font-mono text-emerald-700 underline" href={customerPortalOpenApiUrl}>
              {customerPortalOpenApiUrl}
            </a>. OpenAPI används för utveckling och typgenerering, aldrig som
            runtime-spärr eller tenantkonfiguration.
          </p>
        </Section>
      </div>
    </main>
  );
}
