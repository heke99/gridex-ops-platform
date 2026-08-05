import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalQuoteTimestamptz,
  canonicalQuoteValidUntil,
} from '../lib/pricing/quoteIntegrity.ts'

const zulu = '2026-08-05T21:51:30.966Z'
const postgresUtc = '2026-08-05T21:51:30.966+00:00'
assert.equal(canonicalQuoteValidUntil(zulu), zulu)
assert.equal(canonicalQuoteValidUntil(postgresUtc), zulu)
assert.equal(canonicalQuoteTimestamptz(postgresUtc), zulu)
assert.equal(
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(zulu) }),
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(postgresUtc) }),
)
assert.equal(
  JSON.stringify({ market_data_timestamp: canonicalQuoteTimestamptz(zulu) }),
  JSON.stringify({
    market_data_timestamp: canonicalQuoteTimestamptz(postgresUtc),
  }),
)

const quotes = fs.readFileSync(
  new URL('../lib/pricing/websiteQuotes.ts', import.meta.url),
  'utf8',
)
assert.ok(quotes.includes('valid_until: canonicalQuoteValidUntil(input.validUntil),'))
assert.ok(
  quotes.includes('canonicalQuoteTimestamptz(input.marketDataTimestamp)'),
  'market_data_timestamp must be canonicalized in the integrity payload',
)

const version = '2026-08-05.2'
const finalize = fs.readFileSync(
  new URL('./finalize-openapi-release.cjs', import.meta.url),
  'utf8',
)
assert.match(finalize, new RegExp(`const version = '${version}'`))
assert.match(finalize, /quoteData.properties.offer = permissiveObject/)
assert.match(finalize, /["']offer["']/)

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

const fixtureUrl = new URL(
  `../docs/fixtures/public-contracts-response-${version}.json`,
  import.meta.url,
)
assert.ok(fs.existsSync(fixtureUrl), 'current public-contract fixture is missing')

const websiteOpenApi = JSON.parse(
  fs.readFileSync(
    new URL('../docs/openapi/website-integration-v1.json', import.meta.url),
    'utf8',
  ),
)
const portalOpenApi = JSON.parse(
  fs.readFileSync(
    new URL('../docs/openapi/customer-portal-v1.json', import.meta.url),
    'utf8',
  ),
)
assert.equal(websiteOpenApi.info.version, version)
assert.equal(portalOpenApi.info.version, version)
assert.equal(
  websiteOpenApi.paths['/api/v1/website/public-contracts'].get.responses['200']
    .content['application/json'].example.meta.contract_schema_version,
  version,
  'website public-contracts example must use the current contract version',
)
assert.ok(
  websiteOpenApi.paths['/api/v1/website/quote'].post.responses['201'].content[
    'application/json'
  ].example?.data?.offer,
  'website quote response example must include required offer',
)

const releaseArtifacts = [
  `docs/openapi/releases/${version}/website-integration-v1.json`,
  `docs/openapi/releases/${version}/customer-portal-v1.json`,
  `app/api/v1/openapi/${version}/website-integration-v1.json/route.ts`,
  `app/api/v1/openapi/${version}/customer-portal-v1.json/route.ts`,
]
for (const relative of releaseArtifacts) {
  assert.ok(
    fs.existsSync(new URL(`../${relative}`, import.meta.url)),
    `missing immutable OpenAPI release artifact: ${relative}`,
  )
}

const registry = fs.readFileSync(
  new URL('../lib/api/publicRouteRegistry.ts', import.meta.url),
  'utf8',
)
assert.ok(
  registry.includes(`/api/v1/openapi/${version}/website-integration-v1.json`),
  'publicRouteRegistry is missing the current website OpenAPI release route',
)
assert.ok(
  registry.includes(`/api/v1/openapi/${version}/customer-portal-v1.json`),
  'publicRouteRegistry is missing the current customer portal OpenAPI release route',
)

console.log('website quote integrity and OpenAPI synchronization regression: ok')
