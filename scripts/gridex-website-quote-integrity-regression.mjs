import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalQuoteTimestamptz,
  canonicalQuoteValidUntil,
} from '../lib/pricing/quoteIntegrity.ts'
import {
  CANONICAL_CONTRACT_PRICING_SCHEMA,
  normalizeWebsiteQuotePersistenceInput,
} from '../lib/pricing/canonicalContractEngine.ts'

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const readJson = (relative) => JSON.parse(read(relative))
const exists = (relative) => fs.existsSync(new URL(`../${relative}`, import.meta.url))
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const zulu = '2026-08-05T21:51:30.966Z'
const postgresUtc = '2026-08-05T21:51:30.966+00:00'
assert.equal(canonicalQuoteTimestamptz(zulu), zulu)
assert.equal(canonicalQuoteTimestamptz(postgresUtc), zulu)
assert.equal(canonicalQuoteValidUntil(postgresUtc), zulu)

const normalized = normalizeWebsiteQuotePersistenceInput({
  pricingSnapshotSchemaVersion: 'legacy_schema',
  quoteSnapshot: {
    pricing: { source: 'test' },
    pricing_snapshot: { source: 'test' },
  },
})
assert.equal(normalized.pricingSnapshotSchemaVersion, CANONICAL_CONTRACT_PRICING_SCHEMA)
assert.equal(normalized.quoteSnapshot.snapshot_schema, CANONICAL_CONTRACT_PRICING_SCHEMA)
assert.equal(normalized.quoteSnapshot.pricing_snapshot_schema_version, CANONICAL_CONTRACT_PRICING_SCHEMA)
assert.equal(normalized.quoteSnapshot.pricing.snapshot_schema, CANONICAL_CONTRACT_PRICING_SCHEMA)
assert.equal(normalized.quoteSnapshot.pricing_snapshot.snapshot_schema, CANONICAL_CONTRACT_PRICING_SCHEMA)

const quotes = read('lib/pricing/websiteQuotes.ts')
assert.ok(quotes.includes('normalizeWebsiteQuotePersistenceInput(input)'), 'website quote persistence must pass through the canonical contract engine')
assert.ok(quotes.includes('assertWebsiteQuotePersistenceInvariant(canonicalInput)'), 'canonicalized quote must be validated before INSERT')
assert.ok(quotes.includes('valid_until: canonicalQuoteTimestamptz(input.validUntil),'))
assert.ok(quotes.includes('canonicalQuoteTimestamptz(input.marketDataTimestamp)'))
assert.ok(
  quotes.includes("input.priceArea.toUpperCase() !== canonicalResolution.priceArea"),
  'create/validate gate must compare price_area case-insensitively against resolution',
)
assert.match(
  quotes,
  /price_area:\s*canonicalInput\.priceArea\.trim\(\)\.toUpperCase\(\)/,
  'website quote INSERT must persist uppercase canonical price_area',
)
assert.match(
  quotes,
  /quote\.price_area\.toUpperCase\(\)\s*!==\s*String\(canonicalPriceArea\)\.toUpperCase\(\)/,
  'quote validation must compare persisted price_area case-insensitively',
)

const website = readJson('docs/openapi/website-integration-v1.json')
const portal = readJson('docs/openapi/customer-portal-v1.json')
const version = String(website.info?.version ?? '').trim()
assert.ok(version, 'website OpenAPI must declare a canonical release version')
assert.equal(portal.info?.version, version, 'website and customer portal contracts must share the release version')

const finalize = read('scripts/finalize-openapi-release.cjs')
assert.match(finalize, new RegExp(`const version = ['\"]${escapeRegExp(version)}['\"]`))
assert.match(finalize, /quoteData\.properties\.offer = permissiveObject/)
assert.ok(finalize.includes('// Re-normalize after late example assignment'))

for (const relative of [
  'lib/integrations/websiteIntegrationContract.ts',
  'scripts/check-api-compatibility.cjs',
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-documentation-version.cjs',
  'scripts/check-public-contract-runtime-openapi.cjs',
]) {
  assert.ok(read(relative).includes(version), `${relative} is not synchronized to ${version}`)
}

for (const contractName of ['website-integration-v1', 'customer-portal-v1']) {
  const releasePath = `docs/openapi/releases/${version}/${contractName}.json`
  const routePath = `app/api/v1/openapi/${version}/${contractName}.json/route.ts`
  assert.ok(exists(releasePath), `missing immutable release artifact for ${contractName}@${version}`)
  assert.ok(exists(routePath), `missing immutable route for ${contractName}@${version}`)

  const current = readJson(`docs/openapi/${contractName}.json`)
  const release = readJson(releasePath)
  assert.equal(current.info.version, version)
  assert.equal(release.info.version, version)
  assert.deepEqual(current, release, `${contractName} current OpenAPI diverges from immutable release ${version}`)
}

const exampleVersion = website.paths?.['/api/v1/website/public-contracts']?.get?.responses?.['200']
  ?.content?.['application/json']?.example?.meta?.contract_schema_version
assert.equal(exampleVersion, version, 'public-contracts example contract_schema_version is stale')

const registry = read('lib/api/publicRouteRegistry.ts')
assert.ok(registry.includes(`/api/v1/openapi/${version}/website-integration-v1.json`))
assert.ok(registry.includes(`/api/v1/openapi/${version}/customer-portal-v1.json`))

const quoteExampleOffer = website.paths?.['/api/v1/website/quote']?.post?.responses?.['201']
  ?.content?.['application/json']?.example?.data?.offer
assert.ok(quoteExampleOffer && typeof quoteExampleOffer === 'object', 'quote response example must include required offer')

const marketPriceExample = website.paths?.['/api/v1/website/market-price/current']?.post?.responses?.['200']
  ?.content?.['application/json']?.example?.data
for (const field of ['selected_resolution', 'available_resolutions', 'fallback_used']) {
  assert.ok(marketPriceExample && field in marketPriceExample, `current market-price example must include required ${field}`)
}

const developerRoute = read('app/developers/customer-portal-api/page.tsx')
for (const marker of ['Gridex API', 'Responsibilities', 'Gridex platform', 'Your integration', 'Website checkout', 'Customer Portal API', 'Partner API', 'Webhooks']) {
  assert.ok(developerRoute.includes(marker), `developer route is missing professional marker: ${marker}`)
}
for (const forbidden of ['Mina sidor', 'Tack-sida', 'Webhooks till tenant', 'tenant_email_outbox+communication_logs']) {
  assert.ok(!developerRoute.includes(forbidden), `developer route still contains legacy marker: ${forbidden}`)
}

console.log(`website quote integrity and OpenAPI synchronization regression: ok (${version})`)
