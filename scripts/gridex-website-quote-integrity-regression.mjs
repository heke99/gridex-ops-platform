import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canonicalQuoteValidUntil } from '../lib/pricing/quoteIntegrity.ts'

const zulu = '2026-08-05T21:51:30.966Z'
const postgresUtc = '2026-08-05T21:51:30.966+00:00'
assert.equal(canonicalQuoteValidUntil(zulu), zulu)
assert.equal(canonicalQuoteValidUntil(postgresUtc), zulu)
assert.equal(
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(zulu) }),
  JSON.stringify({ valid_until: canonicalQuoteValidUntil(postgresUtc) }),
)

const quotes = fs.readFileSync(new URL('../lib/pricing/websiteQuotes.ts', import.meta.url), 'utf8')
assert.ok(quotes.includes('valid_until: canonicalQuoteValidUntil(input.validUntil),'))

const finalize = fs.readFileSync(new URL('./finalize-openapi-release.cjs', import.meta.url), 'utf8')
assert.match(finalize, /const version = '2026-08-05.2'/)
assert.match(finalize, /quoteData.properties.offer = permissiveObject/)
assert.match(finalize, /["']offer["']/)

console.log('website quote integrity and OpenAPI synchronization regression: ok')

const versionFiles = [
  'lib/integrations/websiteIntegrationContract.ts',
  'scripts/check-api-compatibility.cjs',
  'scripts/verify-openapi-release.cjs',
  'scripts/check-api-documentation-version.cjs',
  'scripts/check-public-contract-runtime-openapi.cjs',
]
for (const relative of versionFiles) {
  const body = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  assert.ok(body.includes('2026-08-05.2'), `${relative} is not synchronized to 2026-08-05.2`)
}
assert.ok(
  fs.existsSync(new URL('../docs/fixtures/public-contracts-response-2026-08-05.2.json', import.meta.url)),
  'current public-contract fixture is missing',
)
