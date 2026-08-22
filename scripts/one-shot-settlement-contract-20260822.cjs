#!/usr/bin/env node
const fs = require('node:fs')

const CURRENT = '2026-08-22.1'
const PRIOR = '2026-08-20.2'
const read = (path) => fs.readFileSync(path, 'utf8')
const write = (path, value) => fs.writeFileSync(path, value)
const replaceRequired = (path, from, to) => {
  const source = read(path)
  if (!source.includes(from)) throw new Error(`${path}: missing patch anchor ${from.slice(0, 100)}`)
  write(path, source.replace(from, to))
}
const replaceAllRequired = (path, from, to) => {
  const source = read(path)
  if (!source.includes(from)) throw new Error(`${path}: missing patch anchor ${from}`)
  write(path, source.split(from).join(to))
}

// Runtime contract version and release tooling.
replaceAllRequired('lib/integrations/websiteIntegrationContract.ts', "'2026-08-20.2'", `'${CURRENT}'`)
{
  const path = 'lib/integrations/websiteIntegrationContract.ts'
  let s = read(path)
  s = s.replace(
    /\/\*\*\n \* 2026-08-20\.2[\s\S]*?\n \*\/\nexport const API_COMPATIBILITY_CLASSIFICATION/,
    `/**\n * ${CURRENT} makes website settlement semantics explicit: only fixed contracts\n * lock the energy price at signup. Market monthly/hourly/quarter-hour, portfolio\n * and mixed products accept a pricing model and settle later from actual metered\n * consumption and authoritative period data. valid_until remains compatibility\n * metadata and does not expire a customer-visible quote by wall-clock time.\n */\nexport const API_COMPATIBILITY_CLASSIFICATION`,
  )
  write(path, s)
}

for (const path of [
  'scripts/check-api-compatibility.cjs',
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-documentation-version.cjs',
  'scripts/professionalize-openapi-contract.cjs',
]) replaceAllRequired(path, PRIOR, CURRENT)

{
  const path = 'scripts/finalize-openapi-release.cjs'
  let s = read(path)
  s = s.replace(`const version = '${PRIOR}'`, `const version = '${CURRENT}'`)
  s = s.replace("const priorVersion = '2026-08-20.1'", `const priorVersion = '${PRIOR}'`)
  const versionsAnchor = `const publishedVersions = ['2026-08-02.1', '2026-08-03.1', '2026-08-04.3', '2026-08-05.1', '2026-08-05.2', '2026-08-10.1', priorVersion, version]`
  if (!s.includes(versionsAnchor)) throw new Error('finalize: published versions anchor missing')
  // priorVersion now carries 2026-08-20.2; old immutable releases remain untouched.

  const quoteAnchor = `const quoteData = website.components.schemas.WebsiteQuoteData\nquoteData.additionalProperties = false`
  if (!s.includes(quoteAnchor)) throw new Error('finalize: quote data anchor missing')
  const settlementSchema = `website.components.schemas.WebsiteQuoteSettlement = {\n  type: 'object',\n  additionalProperties: false,\n  required: [\n    'model',\n    'customer_accepts',\n    'energy_price_locked_at_signup',\n    'uses_actual_metered_consumption',\n    'market_data_role',\n    'settlement_resolution',\n  ],\n  properties: {\n    model: { type: 'string', enum: ['fixed_price','market_monthly','market_hourly','market_quarter_hour','portfolio','mixed'] },\n    customer_accepts: { type: 'string', enum: ['fixed_energy_price','pricing_model','portfolio_pricing_model','mixed_pricing_model'] },\n    energy_price_locked_at_signup: { type: 'boolean', description: 'True only for a fixed-price product. Market, portfolio and mixed products do not freeze the future energy price at signup.' },\n    uses_actual_metered_consumption: { type: 'boolean', const: true },\n    market_data_role: { type: 'string', enum: ['not_applicable','indicative_preview_only'] },\n    settlement_resolution: { type: 'string', enum: ['fixed','month','hour','quarter_hour','portfolio_period','mixed_components'] },\n  },\n  description: 'How the accepted product is settled. The authenticated API credential determines the organization; no tenant selector is accepted here.',\n}\n\n${quoteAnchor}`
  s = s.replace(quoteAnchor, settlementSchema)
  s = s.replace(
`  'pricing_snapshot',\n]) {`,
`  'pricing_snapshot',\n  'settlement',\n]) {`,
  )
  s = s.replace(
`quoteData.properties.offer = permissiveObject`,
`quoteData.properties.offer = permissiveObject\nquoteData.properties.settlement = { $ref: '#/components/schemas/WebsiteQuoteSettlement' }\nquoteData.properties.valid_until = { type: 'string', format: 'date-time', description: 'Compatibility and immutable audit metadata. An issued customer-visible website quote is not rejected merely because this timestamp passes.' }\nquoteData.properties.is_binding = { type: 'boolean', description: 'True only when the energy price itself is fixed at signup. False for monthly market, hourly, quarter-hour, portfolio and mixed products.' }`,
  )
  s = s.replace(
`  'site_count',\n]))`,
`  'site_count',\n  'settlement',\n]))`,
  )
  const validationMarker = `website.components.schemas.WebsiteQuoteValidationData = {`
  const markerIndex = s.indexOf(validationMarker)
  if (markerIndex < 0) throw new Error('finalize: validation schema missing')
  write(path, s)
}

// Public route catalogue gets the new immutable release routes.
{
  const path = 'lib/api/publicRouteRegistry.ts'
  let s = read(path)
  const anchor = `  { method: 'GET', path: '/api/v1/openapi/${PRIOR}/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release ${PRIOR}.', rateLimitClass: 'read' },`
  if (!s.includes(anchor)) throw new Error('publicRouteRegistry new-release anchor missing')
  const rows = `${anchor}\n  { method: 'GET', path: '/api/v1/openapi/${CURRENT}/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release ${CURRENT}.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/${CURRENT}/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release ${CURRENT}.', rateLimitClass: 'read' },`
  s = s.replace(anchor, rows)
  s = s.replace(
    "description: 'Create an authoritative price quote from a published offer, selected price area, customer type, consumption and start date.'",
    "description: 'Create an authoritative checkout quote from a published offer. Fixed products lock the energy price; market, portfolio and mixed products return indicative checkout evidence for the accepted pricing model.'",
  )
  s = s.replace(
    "description: 'Validate that a quote still matches the selected offer, customer type, price area, consumption and start date.'",
    "description: 'Validate the immutable accepted quote and commercial identity. Elapsed wall-clock time alone does not invalidate an issued website quote.'",
  )
  write(path, s)
}

// Canonical quote calculation exposes explicit settlement semantics and fixed-only binding.
{
  const path = 'lib/pricing/offerQuote.ts'
  let s = read(path)
  const importAnchor = `import { fixedPriceOreForArea } from "@/lib/pricing/fixedAreaPricing";`
  if (!s.includes(importAnchor)) throw new Error('offerQuote import anchor missing')
  s = s.replace(importAnchor, `${importAnchor}\nimport { websiteSettlementForContract } from "@/lib/pricing/websiteSettlement";`)
  s = s.replace(
`  const pricingInterval = quotePricingInterval(offer.contract_type, exactSnapshot);\n  const pricingSnapshot = {`,
`  const pricingInterval = quotePricingInterval(offer.contract_type, exactSnapshot);\n  const settlement = websiteSettlementForContract({\n    contractType: offer.contract_type,\n    pricingInterval,\n  });\n  const pricingSnapshot = {`,
  )
  s = s.replace(`    pricing_interval: pricingInterval,`, `    pricing_interval: pricingInterval,\n    settlement,`)
  s = s.replace(`    is_binding: false,`, `    is_binding: settlement.energy_price_locked_at_signup,`)
  write(path, s)
}

// Public projector allows only the documented settlement object.
{
  const path = 'lib/pricing/publicWebsiteQuote.ts'
  let s = read(path)
  const helperAnchor = `function publicMarketSources(value: unknown): JsonRecord[] {`
  if (!s.includes(helperAnchor)) throw new Error('publicWebsiteQuote helper anchor missing')
  const helper = `function publicSettlement(value: unknown): JsonRecord | null {\n  const row = record(value)\n  if (!row) return null\n  const model = text(row.model)\n  const customerAccepts = text(row.customer_accepts)\n  const marketDataRole = text(row.market_data_role)\n  const settlementResolution = text(row.settlement_resolution)\n  const energyLocked = typeof row.energy_price_locked_at_signup === 'boolean'\n    ? row.energy_price_locked_at_signup\n    : null\n  if (!model || !customerAccepts || !marketDataRole || !settlementResolution || energyLocked === null || row.uses_actual_metered_consumption !== true) return null\n  return {\n    model,\n    customer_accepts: customerAccepts,\n    energy_price_locked_at_signup: energyLocked,\n    uses_actual_metered_consumption: true,\n    market_data_role: marketDataRole,\n    settlement_resolution: settlementResolution,\n  }\n}\n\n${helperAnchor}`
  s = s.replace(helperAnchor, helper)
  s = s.replace(`  const siteCount = finite(source.site_count)`, `  const siteCount = finite(source.site_count)\n  const settlement = publicSettlement(source.settlement)`)
  s = s.replace(
`    siteCount === null ||\n    !Number.isInteger(siteCount) ||`,
`    siteCount === null ||\n    !settlement ||\n    !Number.isInteger(siteCount) ||`,
  )
  s = s.replace(`    pricing_interval: text(source.pricing_interval) ?? undefined,`, `    pricing_interval: text(source.pricing_interval) ?? undefined,\n    settlement,`)
  write(path, s)
}

// Customer and developer documentation.
write('docs/external-website-api-integration-guide.md', `# Gridex Website Integration API\n\nCurrent contract: **${CURRENT}**\n\nThe canonical human-readable documentation is served at \`/developers/customer-portal-api\`. The machine-readable contract is published at \`/api/v1/openapi/website-integration-v1.json\`.\n\n## Responsibility boundary\n\n**Gridex platform** owns published electricity offers, organization-scoped pricing configuration, authoritative price-area resolution, immutable checkout quotes, legal-document versions, customer and contract state, supplier-switch processing and final settlement/invoice calculations.\n\n**Your integration** owns the customer experience, verified end-customer input, server-side API calls, exact display of pricing/legal evidence, stable idempotency keys and persistence of public references. The API credential determines the organization. Never send \`company_id\`, \`tenant_id\` or another organization selector.\n\n## Pricing acceptance and settlement\n\nThe \`settlement\` object on a website quote is the canonical interpretation of what the customer accepts:\n\n- \`fixed_price\`: the energy price is locked at signup. The invoice still uses actual metered consumption, so the total amount can vary with kWh.\n- \`market_monthly\`: the customer accepts the monthly market-price model. Final energy settlement uses actual metered monthly consumption and the authoritative market price for the billing period.\n- \`market_hourly\`: the customer accepts the hourly market-price model. Final settlement uses actual hourly consumption and the applicable hourly market prices.\n- \`market_quarter_hour\`: the customer accepts the quarter-hour market-price model. Final settlement uses actual 15-minute consumption and the applicable quarter-hour market prices.\n- \`portfolio\`: the customer accepts the portfolio pricing model. Final settlement uses the authoritative portfolio settlement for the period and actual metered consumption.\n- \`mixed\`: the customer accepts the published mixture and its component rules; each component is settled according to its configured source and resolution.\n\nFor every non-fixed model, checkout market data is **indicative preview/audit evidence only** and never becomes the future invoice market price. Agreed markups, fees, taxes and other immutable commercial components remain part of the accepted contract.\n\n\`valid_until\` remains in V1-compatible quote payloads as compatibility and immutable audit metadata. Gridex does **not** expire a customer-visible website quote merely because wall-clock time passes. Explicit revocation, tenant mismatch, integrity mismatch or a commercially unavailable/withdrawn offer can still block submission.\n\n\`valid_to\` on a published price option or area price is a commercial validity boundary. \`null\` means no commercial end date is configured.\n\nPublic \`market_reference\` contains public pricing evidence only. Internal source-row identifiers are never part of the public contract.\n\nFor troubleshooting, record Gridex \`request_id\` and your correlation identifier. Do not log API credentials or unnecessary personal data.\n`)

{
  const path = 'app/developers/customer-portal-api/template.tsx'
  let s = read(path)
  s = s.replace('API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> is unchanged. Customer-visible website', 'API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> exposes settlement semantics explicitly. Customer-visible website')
  s = s.replace(
`              For variable and spot products, quote market data is checkout and audit evidence only. It does not freeze\n              the market price used on a future invoice.`,
`              Only fixed-price products lock the energy price at signup. Monthly market, hourly, quarter-hour, portfolio\n              and mixed products accept the pricing model; quote market data is checkout/audit evidence only.`,
  )
  write(path, s)
}

for (const path of ['docs/gridex-customer-portal-api.md', 'docs/single-api-key-tenant-integration.md']) {
  replaceAllRequired(path, PRIOR, CURRENT)
}

// Tests: update current-version expectations, keep old immutable artifacts untouched.
for (const path of [
  '__tests__/pricing-settlement-semantics.test.ts',
  '__tests__/website-quote-validate-contract-parity.test.ts',
  '__tests__/post-128-openapi-tip-residuals.test.ts',
  '__tests__/tenant-website-go-live-hardening.test.ts',
]) {
  if (fs.existsSync(path)) replaceAllRequired(path, PRIOR, CURRENT)
}

write('__tests__/website-settlement-model.test.ts', `import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\nimport { websiteSettlementForContract } from '@/lib/pricing/websiteSettlement'\n\nconst read = (path: string) => readFileSync(path, 'utf8')\n\ndescribe('website settlement model', () => {\n  it.each([\n    ['fixed','fixed_price','fixed_energy_price',true,'fixed'],\n    ['variable_monthly','market_monthly','pricing_model',false,'month'],\n    ['variable_hourly','market_hourly','pricing_model',false,'hour'],\n    ['variable_quarterly','market_quarter_hour','pricing_model',false,'quarter_hour'],\n    ['portfolio','portfolio','portfolio_pricing_model',false,'portfolio_period'],\n    ['mixed','mixed','mixed_pricing_model',false,'mixed_components'],\n  ] as const)('%s maps to the correct settlement contract', (contractType, model, accepts, locked, resolution) => {\n    const settlement = websiteSettlementForContract({ contractType })\n    expect(settlement.model).toBe(model)\n    expect(settlement.customer_accepts).toBe(accepts)\n    expect(settlement.energy_price_locked_at_signup).toBe(locked)\n    expect(settlement.uses_actual_metered_consumption).toBe(true)\n    expect(settlement.settlement_resolution).toBe(resolution)\n    expect(settlement.market_data_role).toBe(locked ? 'not_applicable' : 'indicative_preview_only')\n  })\n\n  it('keeps settlement organization-scoped and billing based on metered data, not quote preview market data', () => {\n    const quotes = read('lib/pricing/websiteQuotes.ts')\n    const engine = read('lib/pricing/engine.ts')\n    const sources = read('lib/pricing/priceSourceResolver.ts')\n    const projector = read('lib/pricing/publicWebsiteQuote.ts')\n    expect(quotes).toContain(".eq('company_id', input.client.company_id)")\n    expect(engine).toContain('.eq("company_id", companyId)')\n    expect(engine).toContain('quantityKwh: numberValue(underlay.total_kwh)')\n    expect(engine).toContain('resolveIntervalSpotPricing')\n    expect(sources).toContain('purpose ?? "settlement"')\n    expect(sources).toContain('.eq("company_id", input.companyId)')\n    expect(projector).toContain('publicSettlement')\n    expect(projector).not.toContain('spot_price_summary_id')\n  })\n})\n`)

// Update generated-types manifest tail because this branch already added a forward-only migration.
{
  const path = 'scripts/supabase-types-manifest.json'
  const manifest = JSON.parse(read(path))
  manifest.latest_migration = '20260822103821_non_expiring_website_quotes.sql'
  write(path, JSON.stringify(manifest, null, 2) + '\n')
}

console.log(`Settlement contract patch prepared for ${CURRENT}`)
