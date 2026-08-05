#!/usr/bin/env node
const fs = require('node:fs')
const expected = '2026-08-05.1'
const files = [
  'lib/integrations/websiteIntegrationContract.ts',
  'docs/openapi/website-integration-v1.json',
  'docs/openapi/customer-portal-v1.json',
  'app/developers/customer-portal-api/page.tsx',
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
]
const failures = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(expected) && file !== 'app/developers/customer-portal-api/page.tsx') {
    failures.push(`${file} does not expose ${expected}`)
  }
  if (source.includes('2026-07-24.1')) failures.push(`${file} still contains the superseded contract version`)
}

const mapperSource = fs.readFileSync('lib/external-contracts/publicationDto.ts', 'utf8')
if (!mapperSource.includes('WEBSITE_INTEGRATION_CONTRACT_VERSION')) {
  failures.push('API public-contract mapper must reuse the canonical runtime version source')
}
if (/API_CONTRACT_RESPONSE_SCHEMA_VERSION\s*=\s*['"]/.test(mapperSource)) {
  failures.push('API public-contract mapper must not hardcode a second contract version')
}
const guideSource = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')
for (const marker of [
  'documentationVersion = WEBSITE_INTEGRATION_CONTRACT_VERSION',
  'openApiRelease = buildOpenApiReleaseManifest()',
  'websiteOpenApiSha256',
  'customerPortalOpenApiSha256',
]) {
  if (!guideSource.includes(marker)) failures.push(`Developer guide is missing canonical marker: ${marker}`)
}

for (const file of ['docs/openapi/website-integration-v1.json', 'docs/openapi/customer-portal-v1.json']) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (spec.info?.version !== expected) failures.push(`${file} info.version mismatch`)
  if (spec['x-contract-schema-version'] !== expected) failures.push(`${file} x-contract-schema-version mismatch`)
}
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`API documentation version parity OK (${expected}).`)
