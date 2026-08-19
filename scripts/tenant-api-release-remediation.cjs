#!/usr/bin/env node
const fs = require('node:fs')

const previous = '2026-08-14.1'
const version = '2026-08-19.1'

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`)
  return source.slice(0, first) + after + source.slice(first + before.length)
}
function replaceAllInFile(path, before, after) {
  const source = read(path)
  if (!source.includes(before)) return
  write(path, source.split(before).join(after))
}

// Register the immutable current release routes in the same runtime registry
// that powers authentication cost and the unified developer endpoint table.
{
  const path = 'lib/api/publicRouteRegistry.ts'
  let source = read(path)
  const anchor = `  { method: 'GET', path: '/api/v1/openapi/${previous}/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release ${previous}.', rateLimitClass: 'read' },\n`
  const addition = `${anchor}  { method: 'GET', path: '/api/v1/openapi/${version}/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release ${version}.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/${version}/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release ${version}.', rateLimitClass: 'read' },\n`
  source = replaceOnce(source, anchor, addition, 'public route registry current release')
  write(path, source)
}

for (const path of [
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-compatibility.cjs',
  'scripts/check-public-contract-runtime-openapi.cjs',
  'scripts/gridex-website-quote-integrity-regression.mjs',
  'scripts/gridex-customer-legal-package-regression.cjs',
  '__tests__/post-128-openapi-tip-residuals.test.ts',
]) replaceAllInFile(path, previous, version)

// Preserve the previous fixture and create a new immutable-looking fixture for
// the current release. Only release-version strings are changed; business data
// remains the same regression corpus.
{
  const oldPath = `docs/fixtures/public-contracts-response-${previous}.json`
  const newPath = `docs/fixtures/public-contracts-response-${version}.json`
  const source = read(oldPath).split(previous).join(version)
  write(newPath, source)
  replaceAllInFile('scripts/finalize-openapi-release.cjs', oldPath, newPath)
  replaceAllInFile('scripts/check-api-documentation-examples.cjs', oldPath, newPath)
  replaceAllInFile('scripts/check-public-contract-runtime-openapi.cjs', oldPath, newPath)
}

// Human-readable repository guides follow the same current release, while old
// immutable OpenAPI release directories remain untouched.
for (const path of [
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
  'docs/integration/NEW_TENANT_CANONICAL_INTEGRATION.md',
]) replaceAllInFile(path, previous, version)

// Documentation version gate: the single web page is now canonical for all
// API families. The old Partner page must redirect into its section instead of
// maintaining a second, drifting guide.
{
  const path = 'scripts/check-api-documentation-version.cjs'
  let source = read(path)
  source = source.replace("const legacyExpected = '2026-08-14.1'", `const legacyExpected = '${version}'`)
  source = source.replace(
    "if (!partnerGuide.includes('PARTNER_API_VERSION')) {\n  failures.push('Partner developer guide must render the canonical PARTNER_API_VERSION source')\n}\nif (!partnerGuide.includes('v{PARTNER_API_VERSION}')) {\n  failures.push('Partner developer guide must visibly render the canonical Partner API version')\n}\nif (!customerPortalDeveloperRoute.includes(\"import PartnerApiDocumentationPage from '../partner-api/page'\")) {\n  failures.push('The /developers/customer-portal-api route must render the canonical Partner API guide')\n}\n",
    "if (!partnerGuide.includes(\"redirect('/developers/customer-portal-api#partner-api')\")) {\n  failures.push('The legacy Partner developer route must redirect to the unified API page')\n}\nif (!customerPortalDeveloperRoute.includes('PARTNER_API_VERSION') || !customerPortalDeveloperRoute.includes('partnerOpenApi')) {\n  failures.push('The unified API page must render Partner API version and endpoints from canonical sources')\n}\n",
  )
  const markerBlockStart = "for (const marker of [\n  'Partner API Reference',"
  const markerBlockEnd = "if (partnerGuide.includes('offer_reference')) {\n  failures.push('Canonical Partner developer guide must not require partners to select internal offers')\n}\n"
  const start = source.indexOf(markerBlockStart)
  const end = source.indexOf(markerBlockEnd)
  if (start < 0 || end < 0) throw new Error('Documentation gate Partner guide block anchors changed')
  const replacement = `for (const marker of [\n  'Gridex API',\n  'Teckna på hemsidan',\n  'Tack-sida och avtalsbekräftelse',\n  'Mina sidor / Customer Portal API',\n  'Partner API',\n  'Webhooks till tenant',\n  'data.checkout',\n  'thank_you_ready',\n  'tenant_email_outbox+communication_logs',\n  '/api/partner/v1/openapi.json',\n]) {\n  if (!customerPortalDeveloperRoute.includes(marker)) failures.push(\`Unified API developer page is missing marker: \${marker}\`)\n}\nif (!partnerGuide.includes("redirect('/developers/customer-portal-api#partner-api')")) {\n  failures.push('Legacy Partner developer guide must only redirect to the unified API page')\n}\n`
  source = source.slice(0, start) + replacement + source.slice(end + markerBlockEnd.length)
  source = source.replace('API documentation parity OK (legacy ${legacyExpected}; simple Partner API ${partnerExpected}).', 'API documentation parity OK (Gridex API ${legacyExpected}; Partner API ${partnerExpected}).')
  write(path, source)
}

// Example gate now validates the single canonical page, not the redirect stub.
{
  const path = 'scripts/check-api-documentation-examples.cjs'
  let source = read(path)
  source = source.replace(
    "const partnerDocumentationPage = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')\nconst customerPortalRoute = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')",
    "const partnerRedirectPage = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')\nconst partnerDocumentationPage = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')\nconst customerPortalRoute = partnerDocumentationPage",
  )
  source = source.replace(
    "  'Partner API Reference',\n  'Registration, Data Retrieval & Webhooks',",
    "  'Gridex API',\n  'Partner API',\n  'Tack-sida och avtalsbekräftelse',\n  'thank_you_ready',\n  'tenant_email_outbox+communication_logs',",
  )
  source = source.replace(
    "if (!customerPortalRoute.includes(\"import PartnerApiDocumentationPage from '../partner-api/page'\")) {\n  failures.push('Customer Portal developer URL must render the canonical Partner API guide.')\n}\nif (!customerPortalRoute.includes('<PartnerApiDocumentationPage />')) {\n  failures.push('Customer Portal developer URL does not render PartnerApiDocumentationPage.')\n}\n",
    "if (!partnerRedirectPage.includes(\"redirect('/developers/customer-portal-api#partner-api')\")) {\n  failures.push('Legacy Partner developer URL must redirect to the unified API guide.')\n}\nif (!customerPortalRoute.includes('partnerOpenApi') || !customerPortalRoute.includes('PUBLIC_API_ENDPOINT_ROWS')) {\n  failures.push('Unified API guide must derive endpoint tables from canonical registries.')\n}\n",
  )
  write(path, source)
}

// Compatibility gate explicitly protects the new tenant-facing thank-you truth.
{
  const path = 'scripts/check-api-compatibility.cjs'
  let source = read(path)
  source = source.replace(
    "const websiteApplication =\n  website.components.schemas.CustomerApplicationRequest\n",
    "const websiteCheckout = website.components.schemas.WebsiteCheckoutResult\nassert(websiteCheckout?.additionalProperties === false, 'website checkout result is not closed')\nassert(websiteCheckout?.required?.includes('thank_you_ready'), 'website checkout result is missing thank_you_ready')\nassert(websiteCheckout?.required?.includes('confirmation_email'), 'website checkout result is missing confirmation_email')\nconst websiteApplicationResponse = website.components.schemas.WebsiteCustomerApplicationData\nassert(websiteApplicationResponse?.properties?.checkout, 'website application response is missing checkout truth')\n\nconst websiteApplication =\n  website.components.schemas.CustomerApplicationRequest\n",
  )
  write(path, source)
}

console.log(`Tenant API release ${version} source/checker patches applied.`)
