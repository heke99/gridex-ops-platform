import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalQuoteTimestamp,
  canonicalQuoteValidUntil,
} from '../lib/pricing/quoteIntegrity.ts'

const zulu = '2026-08-05T21:51:30.966Z'
const postgresUtc = '2026-08-05T21:51:30.966+00:00'
assert.equal(canonicalQuoteValidUntil(zulu), zulu)
assert.equal(canonicalQuoteValidUntil(postgresUtc), zulu)
assert.equal(canonicalQuoteTimestamp(postgresUtc), zulu)
assert.equal(canonicalQuoteTimestamp(null), null)
assert.equal(
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(zulu) }),
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(postgresUtc) }),
)
assert.equal(
  JSON.stringify({
    market_data_timestamp: canonicalQuoteTimestamp(zulu),
  }),
  JSON.stringify({
    market_data_timestamp: canonicalQuoteTimestamp(postgresUtc),
  }),
)

const quotes = fs.readFileSync(
  new URL('../lib/pricing/websiteQuotes.ts', import.meta.url),
  'utf8',
)
assert.ok(quotes.includes('valid_until: canonicalQuoteValidUntil(input.validUntil),'))
assert.ok(quotes.includes('market_data_timestamp: canonicalQuoteTimestamp('))

const expectedVersion = '2026-08-05.2'
const finalize = fs.readFileSync(
  new URL('./finalize-openapi-release.cjs', import.meta.url),
  'utf8',
)
assert.match(finalize, new RegExp(`const version = '${expectedVersion}'`))
assert.match(finalize, /quoteData\.properties\.offer = permissiveObject/)
assert.match(finalize, /["']offer["']/)

const openapi = JSON.parse(
  fs.readFileSync(
    new URL('../docs/openapi/website-integration-v1.json', import.meta.url),
    'utf8',
  ),
)
assert.equal(openapi.info?.version, expectedVersion)
assert.equal(openapi['x-contract-schema-version'], expectedVersion)
const quoteData = openapi.components?.schemas?.WebsiteQuoteData
assert.ok(quoteData?.properties?.offer, 'WebsiteQuoteData.offer missing from OpenAPI')
assert.ok(
  Array.isArray(quoteData?.required) && quoteData.required.includes('offer'),
  'WebsiteQuoteData.required must include offer',
)

const contractSource = fs.readFileSync(
  new URL('../lib/integrations/websiteIntegrationContract.ts', import.meta.url),
  'utf8',
)
assert.match(
  contractSource,
  new RegExp(
    `WEBSITE_INTEGRATION_CONTRACT_VERSION = '${expectedVersion}'`,
  ),
)

const releaseWebsite = `docs/openapi/releases/${expectedVersion}/website-integration-v1.json`
const releasePortal = `docs/openapi/releases/${expectedVersion}/customer-portal-v1.json`
assert.ok(fs.existsSync(releaseWebsite), `missing ${releaseWebsite}`)
assert.ok(fs.existsSync(releasePortal), `missing ${releasePortal}`)
assert.equal(
  JSON.parse(fs.readFileSync(releaseWebsite, 'utf8')).info.version,
  expectedVersion,
)

const registry = fs.readFileSync(
  new URL('../lib/api/publicRouteRegistry.ts', import.meta.url),
  'utf8',
)
assert.ok(
  registry.includes(`/api/v1/openapi/${expectedVersion}/website-integration-v1.json`),
)
assert.ok(
  registry.includes(`/api/v1/openapi/${expectedVersion}/customer-portal-v1.json`),
)

console.log('website quote integrity and OpenAPI synchronization regression: ok')
