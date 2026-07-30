#!/usr/bin/env node
const fs = require('node:fs')

const version = '2026-07-30.3'
const website = JSON.parse(
  fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8'),
)
const portal = JSON.parse(
  fs.readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'),
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

for (const [name, document] of [
  ['website', website],
  ['customer portal', portal],
]) {
  assert(document.info.version === version, `${name}: wrong info.version`)
  assert(
    document['x-contract-schema-version'] === version,
    `${name}: wrong contract schema version`,
  )
}

const publicBoundary = JSON.stringify({
  portalPaths: Object.fromEntries(
    Object.entries(portal.paths).filter(([path]) =>
      path.startsWith('/api/v1/customer/')),
  ),
  portalSchemas: portal.components.schemas,
  websiteApplication:
    website.components.schemas.CustomerApplicationResponse,
  websiteLegal: website.components.schemas.WebsiteLegalBundle,
})
for (const forbidden of [
  '"customer_id"',
  '"contract_id"',
  '"site_id"',
  '"application_id"',
  '"document_id"',
  '"legal_bundle_version_id"',
]) {
  assert(
    !publicBoundary.includes(forbidden),
    `public customer boundary leaks internal field ${forbidden}`,
  )
}

const syncSchema =
  portal.components.schemas.CustomerSyncRequest
const moveOutSchema =
  portal.components.schemas.CustomerMoveOutRequest
assert(syncSchema?.additionalProperties === false, 'customer sync is not closed')
assert(
  syncSchema?.properties?.legal_acceptances,
  'customer sync legal acceptances are undocumented',
)
assert(
  syncSchema?.properties?.power_of_attorney,
  'customer sync power of attorney is undocumented',
)
assert(moveOutSchema?.additionalProperties === false, 'move-out is not closed')
assert(
  moveOutSchema?.properties?.facility_reference,
  'move-out facility_reference is missing',
)

const websiteApplication =
  website.components.schemas.CustomerApplicationRequest
assert(
  websiteApplication?.properties?.legal_acceptances,
  'website legal acceptances are missing',
)
assert(
  !websiteApplication?.properties?.consents,
  'legacy consent fallback is still published',
)

console.log(`OpenAPI compatibility gate passed for ${version}.`)
