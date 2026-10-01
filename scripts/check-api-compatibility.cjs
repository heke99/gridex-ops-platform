#!/usr/bin/env node
const fs = require('node:fs')

const version = '2026-10-01.1'
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
})
for (const forbidden of [
  '"customer_id"',
  '"contract_id"',
  '"site_id"',
  '"application_id"',
  '"document_id"',
]) {
  assert(
    !publicBoundary.includes(forbidden),
    `public customer boundary leaks internal field ${forbidden}`,
  )
}


const publicContractLegal = website.components.schemas.WebsiteLegalBlock
const publicContractLegalModule = website.components.schemas.LegalBundleDocument
assert(
  publicContractLegal?.properties?.legal_bundle_version_id,
  'public contract legal bundle version is missing',
)
assert(
  publicContractLegalModule?.properties?.legal_bundle_version_id,
  'public contract legal module bundle version is missing',
)
assert(
  publicContractLegal?.properties?.customer_documents,
  'public contract customer-facing legal documents are missing',
)
assert(
  website.components.schemas.CustomerLegalDocument?.additionalProperties === false,
  'customer legal document schema is not closed',
)
assert(
  website.components.schemas.WebsiteLegalBundle?.properties?.requirements?.maxItems === 3,
  'website legal bundle must expose at most three customer requirements',
)
const powerOfAttorneyScope =
  website.components.schemas.PowerOfAttorneyInput?.properties?.scope
assert(
  powerOfAttorneyScope?.contains?.const === 'supplier_switch',
  'power of attorney scope must explicitly include supplier_switch',
)
const priceOption = website.components.schemas.ContractPriceOption
assert(priceOption?.properties?.is_default, 'canonical is_default is missing')
assert(
  priceOption?.properties?.default?.deprecated === true,
  'default compatibility alias is not deprecated',
)

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

const websiteCheckout = website.components.schemas.WebsiteCheckoutResult
assert(websiteCheckout?.additionalProperties === false, 'website checkout result is not closed')
assert(websiteCheckout?.required?.includes('thank_you_ready'), 'website checkout result is missing thank_you_ready')
assert(websiteCheckout?.required?.includes('confirmation_email'), 'website checkout result is missing confirmation_email')
const websiteApplicationResponse = website.components.schemas.WebsiteCustomerApplicationData
assert(websiteApplicationResponse?.properties?.checkout, 'website application response is missing checkout truth')

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

const previousVersion = '2026-09-30.3'
const previousPortal = JSON.parse(fs.readFileSync(`docs/openapi/releases/${previousVersion}/customer-portal-v1.json`, 'utf8'))
const previousMessage = previousPortal.components.schemas.CustomerSupportMessage
const currentMessage = portal.components.schemas.CustomerSupportMessage
assert(currentMessage?.additionalProperties === false, 'support message response must remain closed')
assert(currentMessage?.required?.includes('author_reference'), 'saved staff author_reference is mandatory, including null')
assert(JSON.stringify(currentMessage.properties.author_reference.type) === JSON.stringify(['string', 'null']), 'saved staff reference must be nullable string')
assert(currentMessage.properties.author_reference.pattern === '^support_staff_[A-Za-z0-9_-]{32}$', 'saved staff reference must retain the exact opaque shape')
assert(JSON.stringify(Object.keys(currentMessage.properties).filter(key => key !== 'author_reference')) === JSON.stringify(Object.keys(previousMessage.properties)), 'support release unexpectedly removes/reorders prior fields')
assert(JSON.stringify(currentMessage.required.filter(key => key !== 'author_reference')) === JSON.stringify(previousMessage.required), 'support release unexpectedly changes prior required fields')
for (const [key, schema] of Object.entries(previousMessage.properties)) {
  assert(JSON.stringify(currentMessage.properties[key]) === JSON.stringify(schema), `support release changes previous field ${key}`)
}
console.log(`OpenAPI compatibility gate passed for ${version}; prior ${previousVersion} message fields preserved, required nullable staff reference requires strict response-client update.`)
