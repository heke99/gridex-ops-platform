#!/usr/bin/env node
const fs = require('node:fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(source, before, after, label) {
  const i = source.indexOf(before)
  if (i < 0) throw new Error(`Missing anchor: ${label}`)
  if (source.indexOf(before, i + before.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`)
  return source.slice(0, i) + after + source.slice(i + before.length)
}

// Use a real publication instant before the materialization commit occurred.
{
  const path = 'lib/integrations/openApiReleaseManifest.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "export const OPENAPI_RELEASED_AT = '2026-08-19T11:20:00.000Z' as const",
    "export const OPENAPI_RELEASED_AT = '2026-08-19T09:20:00.000Z' as const",
    'release instant',
  )
  write(path, source)
}

{
  const path = '__tests__/post-128-openapi-tip-residuals.test.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "expect(OPENAPI_RELEASED_AT).toBe('2026-08-14T18:26:00.000Z')",
    "expect(OPENAPI_RELEASED_AT).toBe('2026-08-19T09:20:00.000Z')",
    'release instant assertion',
  )
  write(path, source)
}

{
  const path = '__tests__/partner-api-docs-no-internal-banner.test.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "    expect(page).toContain(\"import PartnerApiDocumentationPage from '../partner-api/page'\")",
    "    expect(page).toContain(\"from '@/lib/partner-api/openApi'\")\n    expect(page).toContain('partnerOpenApi')\n    expect(page).toContain('Tack-sida och avtalsbekräftelse')\n    expect(page).toContain('thank_you_ready')",
    'unified docs assertion',
  )
  write(path, source)
}

{
  const path = '__tests__/partner-api-surface.test.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "  it('serves the same simple guide on the customer-portal developer URL', () => {\n    expect(docs).toContain('Partner API Reference')\n    expect(docs).toContain('Registration, Data Retrieval & Webhooks')\n    expect(docs).toContain('Send business information only. Gridex determines the company from the API key')\n    expect(docs).toContain('grid owner, market-price source and published electricity offer server-side')\n    expect(docs).toContain('/location')\n    expect(docs).toContain('/price/current')\n    expect(docs).toContain('/price')\n    expect(docs).toContain('/contract/{contract_id}/state')\n    expect(docs).toContain('/customer/{customer_id}/site/{site_id}/invoice')\n    expect(docs).toContain('/webhook/subscription')\n    expect(docs).not.toContain('tenant_reference')\n    expect(customerPortalDocs).toContain(\"import PartnerApiDocumentationPage from '../partner-api/page'\")\n    expect(customerPortalDocs).toContain('<PartnerApiDocumentationPage />')\n  })",
    "  it('serves Partner API from the single canonical customer-portal developer URL', () => {\n    expect(docs).toContain(\"redirect('/developers/customer-portal-api#partner-api')\")\n    expect(customerPortalDocs).toContain('Gridex API')\n    expect(customerPortalDocs).toContain('Partner API')\n    expect(customerPortalDocs).toContain('partnerOpenApi')\n    expect(customerPortalDocs).toContain('PARTNER_API_BASE_URL')\n    expect(customerPortalDocs).toContain('/api/partner/v1/openapi.json')\n    expect(customerPortalDocs).toContain('server-to-server')\n    expect(customerPortalDocs).toContain('Idempotency-Key')\n    expect(customerPortalDocs).toContain('Webhooks till tenant')\n    expect(customerPortalDocs).toContain('thank_you_ready')\n    expect(customerPortalDocs).not.toContain('api_client_not_launch_ready')\n  })",
    'partner docs single-page test',
  )
  write(path, source)
}

{
  const path = 'scripts/gridex-multitenant-website-application-flow-regression.cjs'
  let source = read(path)
  source = replaceOnce(
    source,
    "// The historical customer-portal developer URL must expose the exact same\n// supplier-facing canonical Partner API guide without reintroducing old API docs.\ncheck(\n  legacyDocs.includes(\"import PartnerApiDocumentationPage from '../partner-api/page'\") &&\n    legacyDocs.includes('<PartnerApiDocumentationPage />'),\n  'legacy customer-portal API URL serves the canonical Partner API guide',\n)\ncheck(partnerDocs.includes('Partner API Reference') && partnerDocs.includes('PARTNER_API_BASE_URL') && partnerDocs.includes('/api/partner/v1/openapi.json'), 'Partner API documentation exposes the canonical v1 base URL and OpenAPI contract')\ncheck(partnerDocs.includes('The API is server-to-server') && partnerDocs.includes('Authorization: Bearer') && partnerDocs.includes('Do not put the key in a browser or mobile app'), 'Partner API documentation makes server-side authentication and key handling explicit')\ncheck(partnerDocs.includes('Do not send company IDs, tenant IDs') && partnerDocs.includes('opaque public IDs; they are not database IDs'), 'Partner API documentation keeps tenant and database identifiers server-side')\ncheck(partnerDocs.includes('Registration POST requests require an') && partnerDocs.includes('Idempotency-Key') && partnerDocs.includes('retrying the same request'), 'Partner API documentation requires idempotency for registration retries')\nfor (const endpoint of ['POST /contract', 'POST /customer', 'POST /customer/{customer_id}/site', 'GET /contract/{contract_id}/state', 'POST /webhook/subscription']) {\n  check(partnerDocs.includes(endpoint), `Partner API documentation exposes ${endpoint}`)\n}\ncheck(partnerDocs.includes('HMAC-SHA256') && partnerDocs.includes('target_url must be a public HTTPS endpoint'), 'Partner API webhook documentation requires signature verification and public HTTPS delivery')\ncheck(partnerDocs.includes('CONTRACT_STATUS_CHANGE'), 'Partner API documentation exposes the canonical contract status-change webhook signal')\n\ncheck(portalPreAuthRelease.includes('breaking-client-update-required-for-portal-identity') && portalPreAuthRelease.includes('breaking-request-requirement'), 'historical portal pre-auth release preserves its breaking classification')\ncheck(releaseManifest.includes('API_COMPATIBILITY_CLASSIFICATION') && websiteContract.includes('additive-public-boundary-and-tenant-remediation'), 'legacy website release manifest keeps the single canonical remediation compatibility classification')",
    "// One canonical human-facing API page now covers Website API, Customer Portal,\n// Partner API and webhooks. The old Partner URL is redirect-only to avoid docs drift.\ncheck(\n  legacyDocs.includes('Gridex API') &&\n    legacyDocs.includes(\"from '@/lib/partner-api/openApi'\") &&\n    legacyDocs.includes('PUBLIC_API_ENDPOINT_ROWS'),\n  'customer-portal API URL is the single canonical human API guide',\n)\ncheck(partnerDocs.includes(\"redirect('/developers/customer-portal-api#partner-api')\"), 'legacy Partner API documentation redirects to the unified guide')\ncheck(legacyDocs.includes('PARTNER_API_BASE_URL') && legacyDocs.includes('/api/partner/v1/openapi.json'), 'unified API documentation exposes the Partner v1 base URL and OpenAPI contract')\ncheck(legacyDocs.includes('server-to-server') && legacyDocs.includes('Authorization: Bearer') && legacyDocs.includes('GRIDEX_API_KEY'), 'unified API documentation makes server-side authentication and key handling explicit')\ncheck(legacyDocs.includes('company_id') && legacyDocs.includes('interna UUID'), 'unified API documentation keeps tenant and database identifiers server-side')\ncheck(legacyDocs.includes('Idempotency-Key') && legacyDocs.includes('retry'), 'unified API documentation requires idempotency for registration retries')\ncheck(legacyDocs.includes('partnerOpenApi') && legacyDocs.includes('partnerEndpointRows'), 'unified API documentation derives Partner endpoints from canonical OpenAPI instead of duplicating endpoint strings')\ncheck(legacyDocs.includes('HMAC-SHA256') && legacyDocs.includes('Webhooks till tenant'), 'unified API documentation requires signed webhook verification')\ncheck(legacyDocs.includes('data.checkout') && legacyDocs.includes('thank_you_ready') && legacyDocs.includes('confirmation_email'), 'unified API documentation exposes tenant checkout and confirmation truth')\n\ncheck(portalPreAuthRelease.includes('breaking-client-update-required-for-portal-identity') && portalPreAuthRelease.includes('breaking-request-requirement'), 'historical portal pre-auth release preserves its breaking classification')\ncheck(releaseManifest.includes('API_COMPATIBILITY_CLASSIFICATION') && websiteContract.includes(\"release: 'backward-compatible'\"), 'current website release is explicitly backward-compatible')",
    'multitenant docs regression',
  )
  source = replaceOnce(
    source,
    "for (const property of ['automation', 'communication', 'webhook']) {",
    "for (const property of ['automation', 'communication', 'checkout', 'webhook']) {",
    'status checkout OpenAPI regression',
  )
  write(path, source)
}

console.log('PR #165 CI contract fixes applied.')
