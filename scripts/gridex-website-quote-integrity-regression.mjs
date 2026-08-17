import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalQuoteTimestamptz,
  canonicalQuoteValidUntil,
} from '../lib/pricing/quoteIntegrity.ts'

const zulu = '2026-08-05T21:51:30.966Z'
const postgresUtc = '2026-08-05T21:51:30.966+00:00'
assert.equal(canonicalQuoteTimestamptz(zulu), zulu)
assert.equal(canonicalQuoteTimestamptz(postgresUtc), zulu)
assert.equal(canonicalQuoteValidUntil(postgresUtc), zulu)
assert.equal(
  JSON.stringify({
    valid_until: canonicalQuoteTimestamptz(zulu),
    market_data_timestamp: canonicalQuoteTimestamptz(postgresUtc),
  }),
  JSON.stringify({
    valid_until: canonicalQuoteTimestamptz(postgresUtc),
    market_data_timestamp: canonicalQuoteTimestamptz(zulu),
  }),
)

const quotes = fs.readFileSync(
  new URL('../lib/pricing/websiteQuotes.ts', import.meta.url),
  'utf8',
)
assert.ok(
  quotes.includes('valid_until: canonicalQuoteTimestamptz(input.validUntil),'),
)
assert.ok(quotes.includes('canonicalQuoteTimestamptz(input.marketDataTimestamp)'))

const finalize = fs.readFileSync(
  new URL('./finalize-openapi-release.cjs', import.meta.url),
  'utf8',
)
assert.match(finalize, /const version = '2026-08-14.1'/)
assert.match(finalize, /quoteData.properties.offer = permissiveObject/)
assert.match(finalize, /["']offer["']/)
assert.ok(
  finalize.includes('// Re-normalize after late example assignment'),
  'finalize must re-normalize contract versions after late example assignment',
)

const version = '2026-08-14.1'
const versionFiles = [
  'lib/integrations/websiteIntegrationContract.ts',
  'scripts/check-api-compatibility.cjs',
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-documentation-version.cjs',
  'scripts/check-public-contract-runtime-openapi.cjs',
]
for (const relative of versionFiles) {
  const body = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  assert.ok(body.includes(version), `${relative} is not synchronized to ${version}`)
}
assert.ok(
  fs.existsSync(
    new URL('../docs/fixtures/public-contracts-response-2026-08-14.1.json', import.meta.url),
  ),
  'current public-contract fixture is missing',
)

for (const contractName of [
  'website-integration-v1',
  'customer-portal-v1',
]) {
  const releasePath = new URL(
    `../docs/openapi/releases/${version}/${contractName}.json`,
    import.meta.url,
  )
  const routePath = new URL(
    `../app/api/v1/openapi/${version}/${contractName}.json/route.ts`,
    import.meta.url,
  )
  assert.ok(
    fs.existsSync(releasePath),
    `missing immutable release artifact for ${contractName}`,
  )
  assert.ok(fs.existsSync(routePath), `missing immutable route for ${contractName}`)

  const current = JSON.parse(
    fs.readFileSync(
      new URL(`../docs/openapi/${contractName}.json`, import.meta.url),
      'utf8',
    ),
  )
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'))
  assert.equal(current.info.version, version)
  assert.equal(release.info.version, version)
  assert.equal(
    JSON.stringify(current),
    JSON.stringify(release),
    `${contractName} current OpenAPI diverges from immutable release`,
  )

  const exampleVersion =
    current.paths?.['/api/v1/website/public-contracts']?.get?.responses?.['200']
      ?.content?.['application/json']?.example?.meta?.contract_schema_version
  if (contractName === 'website-integration-v1') {
    assert.equal(
      exampleVersion,
      version,
      'public-contracts example contract_schema_version is stale',
    )
  }
}

const registry = fs.readFileSync(
  new URL('../lib/api/publicRouteRegistry.ts', import.meta.url),
  'utf8',
)
assert.ok(registry.includes(`/api/v1/openapi/${version}/website-integration-v1.json`))
assert.ok(registry.includes(`/api/v1/openapi/${version}/customer-portal-v1.json`))

const quoteExampleOffer =
  JSON.parse(
    fs.readFileSync(
      new URL('../docs/openapi/website-integration-v1.json', import.meta.url),
      'utf8',
    ),
  ).paths?.['/api/v1/website/quote']?.post?.responses?.['201']?.content?.[
    'application/json'
  ]?.example?.data?.offer
assert.ok(
  quoteExampleOffer && typeof quoteExampleOffer === 'object',
  'quote response example must include required offer',
)

const marketPriceExample =
  JSON.parse(
    fs.readFileSync(
      new URL('../docs/openapi/website-integration-v1.json', import.meta.url),
      'utf8',
    ),
  ).paths?.['/api/v1/website/market-price/current']?.post?.responses?.['200']
    ?.content?.['application/json']?.example?.data
for (const field of [
  'selected_resolution',
  'available_resolutions',
  'fallback_used',
]) {
  assert.ok(
    marketPriceExample && field in marketPriceExample,
    `current market-price example must include required ${field}`,
  )
}

const developerGuide = fs.readFileSync(
  new URL('../docs/external-website-api-integration-guide.md', import.meta.url),
  'utf8',
)
assert.ok(
  !developerGuide.includes('contract_schema_version: 2026-08-05.1'),
  'legacy website guide must not pin stale contract_schema_version 2026-08-05.1',
)
assert.ok(
  developerGuide.includes(version),
  'legacy website guide must reference the current Website contract version',
)

// Create may accept mixed-case price_area that matches a resolution case-
// insensitively; validate must not reject those quotes, and new creates must
// persist the uppercase Swedish price area used by OPS resolution.
assert.ok(
  quotes.includes("input.priceArea.toUpperCase() !== canonicalResolution.priceArea"),
  'create/validate gate must compare price_area case-insensitively against resolution',
)
assert.match(
  quotes,
  /price_area:\s*input\.priceArea\.trim\(\)\.toUpperCase\(\)/,
  'website quote create must persist uppercase price_area',
)
assert.match(
  quotes,
  /quote\.price_area\.toUpperCase\(\)\s*!==\s*String\(canonicalPriceArea\)\.toUpperCase\(\)/,
  'quote validate must compare price_area case-insensitively',
)
assert.match(
  quotes,
  /String\(quote\.resolution_snapshot\?\.price_area \?\? ''\)\.toUpperCase\(\)\s*!==\s*quote\.price_area\.toUpperCase\(\)/,
  'resolution snapshot price_area compare must be case-insensitive',
)

console.log('website quote integrity and OpenAPI synchronization regression: ok')
