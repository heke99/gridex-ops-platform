#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Documentation release 2026-10-22.1 (FINDINGS F51, owner decision 2026-10-22, effective
// immediately). Publishes the runtime requirement that a Website customer application carries
// customer.registered_address: the customer's own Swedish registered address
// (folkbokföringsadress; for a business customer the organisation's registered address). This is a
// breaking request requirement for every Website profile; responses, error envelopes and the wire
// revision 2026-10-09.1 are unchanged and the minimum stays 2026-10-02.3. Customer-portal and Staff
// documents only receive the new documentation revision. Prior immutable artifacts are preserved.
// Same procedure as release-openapi-2026-10-09.1.cjs: run this, then npm run api:materialize.
// Idempotent: running it again on 2026-10-22.1 changes nothing.
const fs = require('node:fs')
const { releaseManifestSchemas } = require('./lib/openapi-release-schemas.cjs')

const PREVIOUS = '2026-10-12.1'
const VERSION = '2026-10-22.1'
const MINIMUM = '2026-10-02.3'
const RUNTIME = '2026-10-09.1'

function replaceVersion(value) {
  if (typeof value === 'string') return value.split(PREVIOUS).join(VERSION)
  if (Array.isArray(value)) return value.map(replaceVersion)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVersion(item)]))
  return value
}

function bumpRelease(original) {
  if (![PREVIOUS, VERSION].includes(original.info.version)) throw new Error(`unexpected version ${original.info.version}`)
  if (original['x-contract-schema-version'] !== RUNTIME) throw new Error(`unexpected wire revision ${original['x-contract-schema-version']}`)
  if (original.info.version === VERSION) return original
  const spec = replaceVersion(original)
  for (const [route, item] of Object.entries(original.paths)) {
    if (!route.startsWith(`/api/v1/openapi/${PREVIOUS}/`)) continue
    spec.paths[route] = structuredClone(item)
    const next = replaceVersion(item)
    for (const operation of Object.values(next)) {
      if (operation && typeof operation.operationId === 'string') operation.operationId = operation.operationId.replace(PREVIOUS.replace(/\D/g, ''), VERSION.replace(/\D/g, ''))
    }
    spec.paths[route.replace(PREVIOUS, VERSION)] = next
  }
  return spec
}

function appendSentence(target, key, sentence) {
  const current = typeof target[key] === 'string' ? target[key] : ''
  if (current.includes(sentence)) return
  target[key] = current ? `${current} ${sentence}` : sentence
}

// --------------------------------------------------------------- Website
const REGISTERED_ADDRESS = 'customer.registered_address'

function documentWebsite(spec) {
  spec.components.schemas.CustomerRegisteredAddress = {
    type: 'object',
    additionalProperties: false,
    required: ['street', 'postal_code', 'city'],
    properties: {
      street: {
        type: 'string',
        minLength: 1,
        maxLength: 35,
        pattern: '\\S',
        description: 'Street address with number exactly as registered, for example "Hemvägen 4". Required; at most 35 characters (Ediel customer master-data limit). An empty value or "." is rejected.',
      },
      street2: {
        type: 'string',
        maxLength: 35,
        description: 'Optional second address line, for example c/o or apartment ("lgh 1102"). At most 35 characters. Omit it when it is not used.',
      },
      postal_code: {
        type: 'string',
        pattern: '^\\s*(?:\\d\\s*){5}$',
        description: 'Swedish postal code: exactly five digits, with or without a space ("41301" or "413 01"). Gridex stores it as "NNN NN".',
      },
      city: {
        type: 'string',
        minLength: 1,
        maxLength: 35,
        pattern: '\\S',
        description: 'Postal town (postort) as registered. Required; at most 35 characters.',
      },
      country: {
        type: 'string',
        enum: ['SE'],
        default: 'SE',
        description: 'ISO 3166-1 alpha-2 country code. Only SE (Sweden) is accepted; when omitted Gridex uses SE. Any other country returns 422 registered_address_invalid with error.field customer.registered_address.country.',
      },
    },
    description: 'The customer\'s own registered address in Sweden: for customer_type private the folkbokföringsadress (population-register address), for customer_type business the organisation\'s registered address. Required in every new application for both customer types. It is not the billing address (customer.billing_*) and not the facility or supply address (site.*); Gridex never derives it from either and never substitutes them for it. Gridex stores it as the customer\'s single current registered address and uses it as the end-user address in the customer master data sent to the grid owner (Ediel). Text values are trimmed and repeated whitespace is collapsed before the length checks. Unknown keys (for example postalCode) are rejected.',
  }

  const application = spec.components.schemas.CustomerApplicationRequest
  const customer = application.properties.customer
  if (customer?.type !== 'object' || customer.additionalProperties !== false) {
    throw new Error('CustomerApplicationRequest.customer must remain a closed object')
  }
  customer.properties.registered_address = { $ref: '#/components/schemas/CustomerRegisteredAddress' }
  customer.required = Array.from(new Set([...(customer.required ?? []), 'registered_address']))

  const operation = spec.paths['/api/v1/website/customer-applications'].post
  appendSentence(operation, 'description', `Every new application must include ${REGISTERED_ADDRESS} (street, optional street2, postal_code, city, optional country SE) for both private and business customers: the customer's own registered address (folkbokföringsadress; for a business the organisation's registered address), never the billing or facility address. Only a retry with the same Idempotency-Key of an application that was already committed returns its original result without the field.`)
  appendSentence(operation.responses['422'], 'description', `registered_address_required: ${REGISTERED_ADDRESS} is missing; error.field is ${REGISTERED_ADDRESS}. registered_address_invalid: ${REGISTERED_ADDRESS} is not an object or fails validation (empty or "." street, street, street2 or city longer than 35 characters, postal code without exactly five digits, country other than SE, non-text value); error.field names the first failing path (${REGISTERED_ADDRESS}, or ${REGISTERED_ADDRESS}.street, .street2, .postal_code, .city or .country) and error.details.fields and error.details.errors list every failing path. unknown_field: ${REGISTERED_ADDRESS} contains a key other than street, street2, postal_code, city and country; error.field is ${REGISTERED_ADDRESS}.<key> and error.details.fields lists every unknown key. A null ${REGISTERED_ADDRESS} returns validation_error. No customer, address or application is created by these errors.`)
  appendSentence(operation.responses['409'], 'description', `idempotency_key_payload_mismatch also applies when an Idempotency-Key is reused with a different ${REGISTERED_ADDRESS}; a retry never changes the stored registered address.`)
}

function documentUnchanged() {}

const documenters = {
  'website-integration-v1': documentWebsite,
  'customer-portal-v1': documentUnchanged,
  'staff-v1': documentUnchanged,
}
for (const name of ['website-integration-v1', 'customer-portal-v1', 'staff-v1']) {
  const file = `docs/openapi/${name}.json`
  const spec = bumpRelease(JSON.parse(fs.readFileSync(file, 'utf8')))
  documenters[name](spec)
  Object.assign(spec.components.schemas, releaseManifestSchemas(VERSION, MINIMUM, { includeStaff: true, runtimeVersion: RUNTIME }))
  // The new immutable route is a clone of the 2026-10-12.1 route; its header documentation is
  // already current, so documentVersionedOpenApiHeaders is not reapplied to frozen routes.
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`)
}
console.log(`OpenAPI documentation release ${VERSION} prepared; run npm run api:materialize next.`)
