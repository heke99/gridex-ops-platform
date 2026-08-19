#!/usr/bin/env node
const fs = require('node:fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(source, before, after, label) {
  const i = source.indexOf(before)
  if (i < 0) throw new Error(`Missing patch anchor: ${label}`)
  if (source.indexOf(before, i + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`)
  return source.slice(0, i) + after + source.slice(i + before.length)
}

// Make the single human-facing page complete enough to implement the Partner
// flow without maintaining a second documentation page.
{
  const path = 'app/developers/customer-portal-api/page.tsx'
  let source = read(path)
  source = replaceOnce(
    source,
    "const webhookExample = `POST https://tenant.example.com/webhooks/gridex",
    `const partnerContractExample = \`POST \${PARTNER_API_BASE_URL}/contract\nAuthorization: Bearer $GRIDEX_API_KEY\nIdempotency-Key: partner_contract_01J...\nContent-Type: application/json\n\n{\n  "customer": {\n    "first_name": "Anna",\n    "last_name": "Andersson",\n    "soc_id": "19900101-1234",\n    "customer_type": "PRIVATE",\n    "email": "anna@example.se"\n  },\n  "site": {\n    "address": "Exempelgatan 1",\n    "zip_code": "11122",\n    "city": "Stockholm",\n    "country": "SE",\n    "site_electricity_type": "CONSUMPTION"\n  },\n  "power_of_attorney": {\n    "poa_type": "WEB",\n    "transaction_type": "SWITCH",\n    "file_base64": "<pdf_base64>",\n    "file_extension": "pdf"\n  }\n}\`\n\nconst partnerWebhookSubscriptionExample = \`POST \${PARTNER_API_BASE_URL}/webhook/subscription\nAuthorization: Bearer $GRIDEX_API_KEY\nIdempotency-Key: partner_webhook_01J...\nContent-Type: application/json\n\n{\n  "webhook_event": "CONTRACT_STATUS_CHANGE",\n  "target_url": "https://tenant.example.com/webhooks/gridex",\n  "notification_email": "integration@example.se",\n  "signing_secret": "<at-least-32-random-characters>"\n}\`\n\nconst webhookExample = \`POST https://tenant.example.com/webhooks/gridex`,
    'Partner examples insertion',
  )

  source = replaceOnce(
    source,
    `          <Section id="partner-api" title="6. Partner API">\n            <p className="leading-7 text-slate-700">\n              Partner API är den enklare backend-to-backend-ytan för leverantörer eller externa system som vill registrera avtal,\n              hämta kund/site/faktura/mätdata och prenumerera på förändringar. Gridex konfigurerar tenant och default publicerat erbjudande utanför API:t.\n            </p>\n            <EndpointTable rows={partnerEndpointRows} />\n          </Section>`,
    `          <Section id="partner-api" title="6. Partner API">\n            <p className="leading-7 text-slate-700">\n              Partner API är den enklare backend-to-backend-ytan för leverantörer eller externa system som vill registrera avtal,\n              hämta kund/site/faktura/mätdata och prenumerera på förändringar. Gridex konfigurerar bolag, API-credential, permissions\n              och vilket publicerat standarderbjudande som gäller utanför API:t. Partnern skickar alltså affärsdata — inte interna tenant-,\n              produkt- eller offer-ID:n. Returnerade <code>entity_id</code> är opaka publika referenser.\n            </p>\n            <h3 className="text-lg font-semibold text-slate-950">Registrera kund + site + avtal i ett anrop</h3>\n            <CopyCodeBlock code={partnerContractExample} language="json" />\n            <h3 className="text-lg font-semibold text-slate-950">Prenumerera på förändringar</h3>\n            <CopyCodeBlock code={partnerWebhookSubscriptionExample} language="json" />\n            <p className="text-sm leading-6 text-slate-600">\n              <code>signing_secret</code> används för HMAC-SHA256-verifiering av inkommande Gridex-webhooks. Tenantens receiver ska\n              kontrollera signaturen och deduplicera leveranser innan eventet används som signal för att hämta aktuell state.\n            </p>\n            <EndpointTable rows={partnerEndpointRows} />\n          </Section>`,
    'Partner section completion',
  )
  write(path, source)
}

// The docs gate must validate data at its canonical source. The unified page
// intentionally renders Partner endpoints from partnerOpenApi instead of
// hard-coding every path into TSX, and it may legitimately mention fields such
// as offer_reference while documenting the separate Website API.
{
  const path = 'scripts/check-api-documentation-examples.cjs'
  let source = read(path)
  source = replaceOnce(
    source,
    "const partnerRedirectPage = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')\nconst partnerDocumentationPage = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')\nconst customerPortalRoute = partnerDocumentationPage",
    "const partnerRedirectPage = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')\nconst partnerDocumentationPage = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')\nconst partnerOpenApiSource = fs.readFileSync('lib/partner-api/openApi.ts', 'utf8')\nconst customerPortalRoute = partnerDocumentationPage",
    'Partner OpenAPI source loader',
  )

  const oldRequired = `for (const requiredTerm of [\n  'Gridex API',\n  'Partner API',\n  'Tack-sida och avtalsbekräftelse',\n  'thank_you_ready',\n  'tenant_email_outbox+communication_logs',\n  'Authorization: Bearer',\n  'Idempotency-Key',\n  '/contract/{contract_id}/state',\n  '/customer/{customer_id}/site/{site_id}/invoice',\n  '/customer/{customer_id}/site/{site_id}/measurement',\n  '/webhook/subscription',\n  'HMAC-SHA256',\n  'signing_secret',\n]) {\n  if (!partnerDocumentationPage.includes(requiredTerm)) {\n    failures.push(\`Partner developer guide is missing \${requiredTerm}.\`)\n  }\n}\nif (\n  !partnerDocumentationPage.includes('Gridex determines the company from the API key') ||\n  !partnerDocumentationPage.includes('published electricity offer server-side') ||\n  !partnerDocumentationPage.includes('product IDs')\n) {\n  failures.push('Partner developer guide must state that company/product configuration remains Gridex-managed.')\n}`
  const newRequired = `for (const requiredTerm of [\n  'Gridex API',\n  'Partner API',\n  'Tack-sida och avtalsbekräftelse',\n  'thank_you_ready',\n  'tenant_email_outbox+communication_logs',\n  'Authorization: Bearer',\n  'Idempotency-Key',\n  'HMAC-SHA256',\n  'signing_secret',\n  'partnerOpenApi',\n]) {\n  if (!partnerDocumentationPage.includes(requiredTerm)) {\n    failures.push(\`Unified API developer guide is missing \${requiredTerm}.\`)\n  }\n}\nfor (const requiredPartnerContractTerm of [\n  '/contract/{contract_id}/state',\n  '/customer/{customer_id}/site/{site_id}/invoice',\n  '/customer/{customer_id}/site/{site_id}/measurement',\n  '/webhook/subscription',\n  'signing_secret',\n  'HMAC-SHA256',\n]) {\n  if (!partnerOpenApiSource.includes(requiredPartnerContractTerm)) {\n    failures.push(\`Canonical Partner OpenAPI source is missing \${requiredPartnerContractTerm}.\`)\n  }\n}\nif (\n  !partnerOpenApiSource.includes('Gridex configures the company, API credential, permissions and default published offer outside the API.') ||\n  !partnerDocumentationPage.includes('Gridex konfigurerar bolag, API-credential, permissions') ||\n  !partnerDocumentationPage.includes('inte interna tenant-')\n) {\n  failures.push('Unified Partner guide must state that company/product/offer configuration remains Gridex-managed.')\n}`
  source = replaceOnce(source, oldRequired, newRequired, 'Partner docs canonical-source checks')

  const oldNegative = `if (partnerDocumentationPage.includes('company_id') || partnerDocumentationPage.includes('tenant_id')) {\n  failures.push('Canonical Partner developer guide must not expose company_id or tenant_id selection fields.')\n}\nif (partnerDocumentationPage.includes('tenant_reference')) {\n  failures.push('Canonical Partner developer guide must not expose tenant_reference.')\n}\nif (partnerDocumentationPage.includes('offer_reference')) {\n  failures.push('Canonical Partner developer guide must not require partners to select internal offer configuration.')\n}`
  const newNegative = `for (const forbiddenPartnerInput of [\n  "company_id: {",\n  "tenant_id: {",\n  "tenant_reference: {",\n  "offer_reference: {",\n]) {\n  if (partnerOpenApiSource.includes(forbiddenPartnerInput)) {\n    failures.push(\`Canonical Partner OpenAPI must not expose internal selector \${forbiddenPartnerInput.slice(0, -3)}.\`)\n  }\n}`
  source = replaceOnce(source, oldNegative, newNegative, 'Partner selector negative checks')

  source = source.replace(
    "console.log('API documentation examples OK (simple Partner guide + legacy Website OpenAPI/guide).')",
    "console.log('API documentation examples OK (unified human guide + canonical Website/Partner sources).')",
  )
  write(path, source)
}

console.log('PR #165 unified API docs and source-aware docs gate fixed.')
