#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const CURRENT = '2026-08-19.2'
const PRIOR = '2026-08-19.1'

function replaceRequired(file, from, to) {
  const before = fs.readFileSync(file, 'utf8')
  if (before.includes(to) && !before.includes(from)) {
    console.log(`${file}: already synchronized`)
    return
  }
  if (!before.includes(from)) throw new Error(`${file}: missing expected text ${from}`)
  fs.writeFileSync(file, before.split(from).join(to))
  console.log(`${file}: synchronized`)
}

for (const file of [
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-compatibility.cjs',
  'scripts/check-public-contract-runtime-openapi.cjs',
]) {
  replaceRequired(file, `const version = '${PRIOR}'`, `const version = '${CURRENT}'`)
}

replaceRequired(
  'scripts/check-api-documentation-version.cjs',
  `const legacyExpected = '${PRIOR}'`,
  `const legacyExpected = '${CURRENT}'`,
)

let quoteRegression = fs.readFileSync('scripts/gridex-website-quote-integrity-regression.mjs', 'utf8')
quoteRegression = quoteRegression
  .replace(/const version = '2026-08-19\.1'/g, `const version = '${CURRENT}'`)
  .replace(/const version = \\'2026-08-19\\\.1\\'/g, `const version = \\'${CURRENT}\\'`)
  .replace(/2026-08-19\.1/g, CURRENT)
  .replace(
    /const legacyDeveloperRoute = fs\.readFileSync\([\s\S]*?assert\.ok\([\s\S]*?'legacy developer route must not pin stale contract schema versions',\n\)\n/s,
    `const developerRoute = fs.readFileSync(\n  new URL('../app/developers/customer-portal-api/page.tsx', import.meta.url),\n  'utf8',\n)\nfor (const marker of [\n  'Gridex API',\n  'Responsibilities',\n  'Gridex platform',\n  'Your integration',\n  'Website checkout',\n  'Customer Portal API',\n  'Partner API',\n  'Webhooks',\n]) {\n  assert.ok(developerRoute.includes(marker), \`developer route is missing professional marker: \${marker}\`)\n}\nfor (const forbidden of ['Mina sidor', 'Tack-sida', 'Webhooks till tenant', 'tenant_email_outbox+communication_logs']) {\n  assert.ok(!developerRoute.includes(forbidden), \`developer route still contains legacy marker: \${forbidden}\`)\n}\n`,
  )
fs.writeFileSync('scripts/gridex-website-quote-integrity-regression.mjs', quoteRegression)
console.log('scripts/gridex-website-quote-integrity-regression.mjs: synchronized')

const fixtureSource = 'docs/fixtures/public-contracts-response-2026-08-19.1.json'
const fixtureTarget = `docs/fixtures/public-contracts-response-${CURRENT}.json`
const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))

function transformFixture(value) {
  if (Array.isArray(value)) return value.map(transformFixture)
  if (typeof value === 'string') {
    return value
      .replaceAll(PRIOR, CURRENT)
      .replace(/^tenant_/, 'organization_')
      .replaceAll('ops_quote', 'gridex_quote')
      .replaceAll('market_price_supplied_by_ops', 'market_price_supplied_by_gridex')
  }
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    const nextKey = key
      .replaceAll('tenant_reference', 'organization_reference')
      .replaceAll('market_price_supplied_by_ops', 'market_price_supplied_by_gridex')
    output[nextKey] = transformFixture(child)
  }
  return output
}
fs.writeFileSync(fixtureTarget, `${JSON.stringify(transformFixture(fixture), null, 2)}\n`)
console.log(`${fixtureTarget}: materialized`)

replaceRequired(
  'scripts/finalize-openapi-release.cjs',
  `docs/fixtures/public-contracts-response-${PRIOR}.json`,
  `docs/fixtures/public-contracts-response-${CURRENT}.json`,
)
replaceRequired(
  'scripts/check-public-contract-runtime-openapi.cjs',
  `docs/fixtures/public-contracts-response-${PRIOR}.json`,
  `docs/fixtures/public-contracts-response-${CURRENT}.json`,
)

const externalGuide = `# Gridex Website Integration API\n\nCurrent contract: **${CURRENT}**\n\nThe canonical human-readable documentation is served at \`/developers/customer-portal-api\`. The machine-readable contract is published at \`/api/v1/openapi/website-integration-v1.json\`.\n\n## Responsibility boundary\n\n**Gridex platform** owns published electricity offers, authoritative price-area resolution and quotes, legal-document versions, canonical customer and contract state, idempotent processing, supplier-switch and facility-information processing, communication state, and the customer-facing data exposed by enabled services.\n\n**Your integration** owns the customer experience, verified end-customer identity, customer and site input, server-side API calls, exact display of Gridex pricing/legal evidence, stable idempotency keys, persistence of public application references, and webhook signature verification/deduplication.\n\nDo not send internal database identifiers. The API credential determines the organization and permissions.\n`
fs.writeFileSync('docs/external-website-api-integration-guide.md', externalGuide)

const portalGuide = `# Gridex Customer Portal API\n\nCurrent contract: **${CURRENT}**\n\nUse the canonical developer guide at \`/developers/customer-portal-api#customer-portal\` and the OpenAPI specification at \`/api/v1/openapi/customer-portal-v1.json\`.\n\nCustomer portal access is server-to-server. Gridex resolves the organization from the API credential and limits customer data to the verified linked customer identity. Internal database identifiers are not part of the public integration contract.\n`
fs.writeFileSync('docs/gridex-customer-portal-api.md', portalGuide)

const credentialGuide = `# Gridex server-side API credential\n\nCurrent contract: **${CURRENT}**\n\nA production integration uses \`GRIDEX_API_KEY\` only from a trusted backend. Gridex derives the organization, permissions and integration context from that credential. Do not expose the key in browser JavaScript, mobile applications, analytics payloads or client-visible environment variables.\n\nSee \`/developers/customer-portal-api#authentication\` for the current integration flow.\n`
fs.writeFileSync('docs/single-api-key-tenant-integration.md', credentialGuide)
console.log('external markdown guides: synchronized')

let docCheck = fs.readFileSync('scripts/check-api-documentation-version.cjs', 'utf8')
docCheck = docCheck.replace(
  /for \(const marker of \[\n  'Gridex API',[\s\S]*?\n\]\) \{\n  if \(!customerPortalDeveloperRoute\.includes\(marker\)\) failures\.push\(`Unified API developer page is missing marker: \$\{marker\}`\)\n\}/,
  `for (const marker of [\n  'Gridex API',\n  'Responsibilities',\n  'Gridex platform',\n  'Your integration',\n  'Website checkout',\n  'Customer Portal API',\n  'Partner API',\n  'Webhooks',\n  'data.checkout',\n  'thank_you_ready',\n  '/api/partner/v1/openapi.json',\n]) {\n  if (!customerPortalDeveloperRoute.includes(marker)) failures.push(\`Unified API developer page is missing marker: \${marker}\`)\n}\nfor (const forbidden of ['Mina sidor', 'Tack-sida', 'Webhooks till tenant', 'tenant_email_outbox+communication_logs']) {\n  if (customerPortalDeveloperRoute.includes(forbidden)) failures.push(\`Unified API developer page still contains legacy marker: \${forbidden}\`)\n}`,
)
fs.writeFileSync('scripts/check-api-documentation-version.cjs', docCheck)
console.log('scripts/check-api-documentation-version.cjs: professional markers synchronized')

console.log(`Public API release synchronization complete for ${CURRENT}.`)
