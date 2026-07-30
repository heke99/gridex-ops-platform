#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')

const version = '2026-07-30.1'
const websitePath = 'docs/openapi/website-integration-v1.json'
const portalPath = 'docs/openapi/customer-portal-v1.json'
const website = JSON.parse(fs.readFileSync(websitePath, 'utf8'))
const portal = JSON.parse(fs.readFileSync(portalPath, 'utf8'))

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const uuid = { type: 'string', format: 'uuid' }
const nullableUuid = { type: ['string', 'null'], format: 'uuid' }
const dateTime = { type: 'string', format: 'date-time' }
const contractVersion = { type: 'string', const: version }

function envelope(data, extraRequired = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'request_id', 'contract_schema_version', ...extraRequired],
    properties: {
      data,
      request_id: string,
      correlation_id: nullableString,
      contract_schema_version: contractVersion,
    },
  }
}

function requestSchema(spec, path, method = 'post') {
  return spec.paths[path][method].requestBody.content['application/json'].schema
}

function responseSchema(spec, path, method = 'get', status = '200') {
  return spec.paths[path][method].responses[status].content['application/json'].schema
}

function setRequest(spec, path, schema, method = 'post') {
  spec.paths[path][method].requestBody.content['application/json'].schema = schema
}

function setResponse(spec, path, schema, method = 'get', status = '200') {
  spec.paths[path][method].responses[status].content['application/json'].schema = schema
}

for (const document of [website, portal]) {
  document.info.version = version
  document['x-contract-schema-version'] = version
}

website.components.schemas.LegalAcceptance = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requirement_code',
    'document_id',
    'document_version',
    'document_hash',
    'accepted',
    'accepted_at',
  ],
  properties: {
    requirement_code: string,
    document_id: uuid,
    document_version: string,
    document_hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    accepted: { type: 'boolean', const: true },
    accepted_at: dateTime,
  },
}
website.components.schemas.LegalAcceptances = {
  type: 'array',
  minItems: 1,
  items: { $ref: '#/components/schemas/LegalAcceptance' },
}
website.components.schemas.WebsiteLegalRequirement = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requirement_code',
    'title',
    'description',
    'required',
    'document_id',
    'document_version',
    'document_hash',
    'document_url',
  ],
  properties: {
    requirement_code: string,
    title: string,
    description: string,
    required: { type: 'boolean', const: true },
    document_id: uuid,
    document_version: string,
    document_hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    document_url: { type: 'string', format: 'uri' },
  },
}
const legalBundle = website.components.schemas.WebsiteLegalBundle
legalBundle.properties.requirements = {
  type: 'array',
  items: { $ref: '#/components/schemas/WebsiteLegalRequirement' },
}
legalBundle.required = Array.from(
  new Set([...(legalBundle.required ?? []), 'requirements']),
)
const legalBundleResponse =
  website.components.schemas.WebsiteLegalBundleResponse
legalBundleResponse.properties.contract_schema_version = contractVersion
legalBundleResponse.required = Array.from(
  new Set([
    ...(legalBundleResponse.required ?? []),
    'contract_schema_version',
  ]),
)

const application = website.components.schemas.CustomerApplicationRequest
application.properties.customer_portal_user_id = uuid
application.properties.auth_user_id = uuid
application.properties.legal_bundle_version = uuid
application.properties.legal_acceptances = {
  $ref: '#/components/schemas/LegalAcceptances',
}
delete application.properties.legalAcceptances
delete application.properties.consents
application.required = Array.from(new Set([
  ...(application.required ?? []),
  'legal_bundle_version',
  'legal_acceptances',
]))
application.dependentRequired = {
  ...(application.dependentRequired ?? {}),
  auth_user_id: ['customer_portal_user_id'],
  customer_portal_user_id: ['auth_user_id'],
}

website.components.schemas.WebsitePortfolioPriceData = {
  type: 'object',
  additionalProperties: false,
  required: [
    'offer_reference',
    'method',
    'historical_final_prices',
    'market_price_responsibility',
    'calculator_market_price_supplied_by_ops',
    'final_billing_rule',
  ],
  properties: {
    offer_reference: string,
    method: string,
    historical_final_prices: {
      type: 'array',
      items: { $ref: '#/components/schemas/PortfolioHistoricalFinalPrice' },
    },
    market_price_responsibility: { type: 'string', const: 'ops_quote' },
    calculator_market_price_supplied_by_ops: { type: 'boolean', const: true },
    final_billing_rule: {
      type: 'string',
      const: 'locked_settlement_only',
    },
  },
}
website.components.schemas.PortfolioHistoricalFinalPrice = {
  type: 'object',
  additionalProperties: false,
  required: [
    'period_month',
    'price_area_code',
    'amount',
    'unit',
    'vat_included',
    'status',
  ],
  properties: {
    period_month: { type: 'string', format: 'date' },
    price_area_code: { type: 'string', enum: ['SE1', 'SE2', 'SE3', 'SE4'] },
    amount: { type: 'number' },
    unit: { type: 'string', const: 'ore_per_kwh' },
    vat_included: { type: 'boolean' },
    status: string,
  },
}
setResponse(
  website,
  '/api/v1/website/portfolio-prices',
  envelope({ $ref: '#/components/schemas/WebsitePortfolioPriceData' }),
)

website.components.schemas.WebsiteQuoteValidationData = {
  type: 'object',
  additionalProperties: false,
  required: [
    'valid',
    'quote_reference',
    'offer_reference',
    'valid_until',
    'status',
    'resolution_id',
    'resolver_version',
    'geodata_version',
    'market_reference',
    'energy_direction',
    'selected_area_price',
  ],
  properties: {
    valid: { type: 'boolean' },
    quote_reference: string,
    offer_reference: string,
    valid_until: dateTime,
    status: string,
    resolution_id: uuid,
    resolver_version: nullableString,
    geodata_version: nullableString,
    market_reference: { $ref: '#/components/schemas/MarketReference' },
    energy_direction: { $ref: '#/components/schemas/EnergyDirection' },
    selected_area_price: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        price_area: {
          type: ['string', 'null'],
          enum: ['SE1', 'SE2', 'SE3', 'SE4', null],
        },
        energy_price_ore_per_kwh: { type: 'number' },
        unit: { type: 'string', const: 'ore_per_kwh' },
        price_option_reference: nullableString,
        price_row_reference: nullableString,
      },
      required: [
        'price_area',
        'energy_price_ore_per_kwh',
        'unit',
        'price_option_reference',
        'price_row_reference',
      ],
    },
  },
}
setResponse(
  website,
  '/api/v1/website/quote/validate',
  envelope({ $ref: '#/components/schemas/WebsiteQuoteValidationData' }),
  'post',
)

website.components.schemas.WebsiteCustomerEventIdentity = {
  type: 'object',
  additionalProperties: false,
  properties: {
    external_customer_id: string,
    customer_number: string,
    auth_user_id: uuid,
    customer_portal_user_id: uuid,
    email: { type: 'string', format: 'email' },
  },
  dependentRequired: {
    auth_user_id: ['customer_portal_user_id'],
    customer_portal_user_id: ['auth_user_id'],
  },
}
website.components.schemas.WebsiteCustomerEventRequest = {
  type: 'object',
  additionalProperties: false,
  required: [
    'event_type',
    'event_reference',
    'occurred_at',
    'customer',
    'subject',
    'data',
  ],
  properties: {
    event_type: { type: 'string', pattern: '^customer\\.[a-z0-9_]+$' },
    event_reference: string,
    occurred_at: dateTime,
    customer: { $ref: '#/components/schemas/WebsiteCustomerEventIdentity' },
    subject: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: string, reference: string },
    },
    data: { type: 'object' },
    metadata: { type: 'object' },
  },
}
website.components.schemas.WebsiteCustomerEventData = {
  type: 'object',
  additionalProperties: false,
  required: [
    'event_id',
    'customer_event_id',
    'event_reference',
    'event_type',
    'customer_reference',
    'status',
  ],
  properties: {
    event_id: nullableUuid,
    customer_event_id: nullableUuid,
    event_reference: string,
    event_type: string,
    customer_reference: nullableString,
    status: { type: 'string', const: 'accepted' },
  },
}
setRequest(
  website,
  '/api/v1/website/customer-events',
  { $ref: '#/components/schemas/WebsiteCustomerEventRequest' },
)
setResponse(
  website,
  '/api/v1/website/customer-events',
  envelope({ $ref: '#/components/schemas/WebsiteCustomerEventData' }),
  'post',
)

website.components.schemas.OpsDomainWebhookEnvelope = {
  type: 'object',
  additionalProperties: false,
  required: [
    'event_id',
    'event_type',
    'occurred_at',
    'tenant_reference',
    'data',
  ],
  properties: {
    event_id: uuid,
    event_type: {
      type: 'string',
      enum: [
        'invoice.paid',
        'invoice.disputed',
        'supply.started',
        'metering_values.updated',
        'facility_data.verified',
      ],
    },
    occurred_at: dateTime,
    tenant_reference: string,
    subject_reference: nullableString,
    data: { type: 'object' },
  },
}

website.components.schemas.OpenApiReleaseManifest = {
  type: 'object',
  additionalProperties: false,
  required: [
    'release_version',
    'website_openapi_version',
    'customer_portal_openapi_version',
    'runtime_contract_version',
    'guide_version',
    'released_at',
    'specifications',
  ],
  properties: {
    release_version: contractVersion,
    website_openapi_version: contractVersion,
    customer_portal_openapi_version: contractVersion,
    runtime_contract_version: contractVersion,
    guide_version: contractVersion,
    released_at: dateTime,
    specifications: {
      type: 'object',
      additionalProperties: false,
      required: ['website', 'customer_portal'],
      properties: {
        website: { $ref: '#/components/schemas/OpenApiReleaseSpecification' },
        customer_portal: {
          $ref: '#/components/schemas/OpenApiReleaseSpecification',
        },
      },
    },
  },
}
website.components.schemas.OpenApiReleaseSpecification = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'sha256'],
  properties: {
    url: { type: 'string', format: 'uri' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
}
website.paths['/api/v1/openapi/release-manifest.json'] = {
  get: {
    operationId: 'getOpenApiReleaseManifest',
    summary: 'Hämta atomiskt OpenAPI release-manifest',
    'x-required-scopes': [],
    responses: {
      200: {
        description: 'Aktuell kontraktsrelease.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OpenApiReleaseManifest' },
          },
        },
      },
    },
  },
}

portal.components.parameters.CustomerPortalUserId = {
  name: 'x-gridex-customer-portal-user-id',
  in: 'header',
  required: true,
  schema: uuid,
}
portal.components.schemas.ErrorResponse = portal.components.schemas.ApiError
portal.components.schemas.WebsiteVisibilityMode = {
  type: 'string',
  enum: ['visible', 'hidden', 'summary_only'],
}
portal.components.parameters.AuthUserId = {
  name: 'x-gridex-auth-user-id',
  in: 'header',
  required: true,
  schema: uuid,
}

for (const [path, item] of Object.entries(portal.paths)) {
  if (path.includes('/openapi/') || path === '/api/v1/integration/context') continue
  const portalIdentityPath =
    path.startsWith('/api/v1/customer/') ||
    path.startsWith('/api/v1/customer-portal/')
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = item[method]
    if (!operation) continue
    const existing = Array.isArray(operation.parameters)
      ? operation.parameters
      : []
    const retained = existing.filter((parameter) => ![
        'x-gridex-customer-portal-user-id',
        'x-gridex-auth-user-id',
      ].includes(String(parameter?.name ?? '').toLowerCase()) &&
        ![
          '#/components/parameters/CustomerPortalUserId',
          '#/components/parameters/AuthUserId',
        ].includes(String(parameter?.$ref ?? '')))
    operation.parameters = portalIdentityPath
      ? [
          ...retained,
          portal.components.parameters.CustomerPortalUserId,
          portal.components.parameters.AuthUserId,
        ]
      : retained
  }
}

portal.components.schemas.PortalSyncRequest = {
  type: 'object',
  additionalProperties: false,
  required: [
    'external_customer_id',
    'customer_portal_user_id',
    'auth_user_id',
  ],
  properties: {
    external_customer_id: string,
    external_account_id: string,
    customer_portal_user_id: uuid,
    auth_user_id: uuid,
    email: { type: 'string', format: 'email' },
    personal_number: string,
    organization_number: string,
    customer_number: string,
    facility_id: string,
    metadata: { type: 'object' },
  },
  dependentRequired: {
    auth_user_id: ['customer_portal_user_id'],
    customer_portal_user_id: ['auth_user_id'],
  },
}
portal.components.schemas.PortalSyncData = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'access_granted'],
  properties: {
    status: {
      type: 'string',
      enum: ['linked', 'pending_review', 'rejected'],
    },
    outcome: {
      type: 'string',
      enum: ['linked', 'pending_review', 'lead_created', 'rejected'],
    },
    customer_reference: nullableString,
    customer_number: nullableString,
    external_customer_id: string,
    customer_portal_user_id: uuid,
    auth_user_id: uuid,
    portal_role: { type: 'string', enum: ['owner', 'billing', 'viewer'] },
    created: { type: 'boolean' },
    access_granted: { type: 'boolean' },
    reason: string,
    identity_id: uuid,
  },
}
setRequest(
  portal,
  '/api/v1/customer-portal/sync',
  portal.components.schemas.PortalSyncRequest,
)
setResponse(
  portal,
  '/api/v1/customer-portal/sync',
  envelope({ $ref: '#/components/schemas/PortalSyncData' }),
  'post',
)

portal.components.schemas.ClosedPortalResourceEnvelope = envelope({
  oneOf: [
    { type: 'object' },
    { type: 'array', items: {} },
    { type: 'null' },
  ],
})
portal.components.schemas.ClosedPortalMutationRequest = {
  type: 'object',
  additionalProperties: false,
  properties: {
    data: { type: 'object' },
    notification_ids: { type: 'array', items: uuid },
    external_customer_id: string,
    customer_number: string,
    email: { type: 'string', format: 'email' },
    auth_user_id: uuid,
    customer_portal_user_id: uuid,
    facility_data: { type: 'object' },
    profile: { type: 'object' },
    requested_move_out_date: { type: 'string', format: 'date' },
    reason: string,
    metadata: { type: 'object' },
  },
}

function explicitlyPermissive(schema) {
  return schema?.type === 'object' && (
    schema.additionalProperties === true ||
    (
      schema.additionalProperties !== false &&
      Object.keys(schema.properties ?? {}).length === 0
    )
  )
}

for (const [path, item] of Object.entries(portal.paths)) {
  if (path.includes('/openapi/') || path === '/api/v1/integration/context') continue
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = item[method]
    if (!operation) continue
    const request = operation.requestBody?.content?.['application/json']?.schema
    if (
      explicitlyPermissive(request) &&
      path !== '/api/v1/customer-portal/sync'
    ) {
      operation.requestBody.content['application/json'].schema = {
        $ref: '#/components/schemas/ClosedPortalMutationRequest',
      }
    }
    const response = operation.responses?.['200']?.content?.['application/json']?.schema
    if (
      explicitlyPermissive(response) &&
      path !== '/api/v1/customer-portal/sync'
    ) {
      operation.responses['200'].content['application/json'].schema = {
        $ref: '#/components/schemas/ClosedPortalResourceEnvelope',
      }
    }
  }
}

function assertLocalRefs(document, name) {
  const failures = []
  function walk(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      let cursor = document
      for (const part of value.$ref.slice(2).split('/')) {
        cursor = cursor?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
      }
      if (cursor === undefined) failures.push(value.$ref)
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(document)
  if (failures.length) {
    throw new Error(`${name} contains unresolved refs: ${[...new Set(failures)].join(', ')}`)
  }
}

assertLocalRefs(website, 'website')
assertLocalRefs(portal, 'customer portal')
fs.writeFileSync(websitePath, `${JSON.stringify(website, null, 2)}\n`)
fs.writeFileSync(portalPath, `${JSON.stringify(portal, null, 2)}\n`)
const hashes = {
  website: crypto
    .createHash('sha256')
    .update(`${JSON.stringify(website)}\n`)
    .digest('hex'),
  customer_portal: crypto
    .createHash('sha256')
    .update(`${JSON.stringify(portal)}\n`)
    .digest('hex'),
}
console.log(JSON.stringify({ version, hashes }, null, 2))
