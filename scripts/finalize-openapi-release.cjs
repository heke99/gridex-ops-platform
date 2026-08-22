#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')

const version = '2026-08-22.1'
const websitePath = 'docs/openapi/website-integration-v1.json'
const portalPath = 'docs/openapi/customer-portal-v1.json'
const website = JSON.parse(fs.readFileSync(websitePath, 'utf8'))
const portal = JSON.parse(fs.readFileSync(portalPath, 'utf8'))
const publicContractsExample = JSON.parse(
  fs.readFileSync('docs/fixtures/public-contracts-response-2026-08-19.2.json', 'utf8'),
)
publicContractsExample.meta.contract_schema_version = version

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const uuid = { type: 'string', format: 'uuid' }
const nullableUuid = { type: ['string', 'null'], format: 'uuid' }
const dateTime = { type: 'string', format: 'date-time' }
const contractVersion = { type: 'string', const: version }

const priorVersion = '2026-08-20.2'
const publishedVersions = ['2026-08-02.1', '2026-08-03.1', '2026-08-04.3', '2026-08-05.1', '2026-08-05.2', '2026-08-10.1', priorVersion, version]
const legacyApiKeySunset = '2026-10-31T23:59:59.000Z'
const customerPortalReadScopes = [
  'customer_profile.read',
  'customer_sites.read',
  'customer_contracts.read',
  'customer_invoices.read',
  'customer_metering.read',
  'customer_legal.read',
  'customer_events.read',
  'customer_documents.read',
  'customer_notifications.read',
  'customer_power_of_attorney.read',
]
const customerPortalWriteScopes = [
  'customer_sync.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
  'customer_notifications.write',
  'customer_documents.write',
]

function configureAuthenticationContract(document) {
  document.components = document.components ?? {}
  document.components.securitySchemes = document.components.securitySchemes ?? {}
  document.components.securitySchemes.legacyApiKeyAuth = {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
    deprecated: true,
    description: `Deprecated compatibility header. New integrations MUST use Authorization: Bearer <GRIDEX_API_KEY>. Sunset: ${legacyApiKeySunset}.`,
  }
  document['x-scope-aliases'] = {
    'customer_portal.read': {
      status: 'deprecated_legacy_alias',
      expands_to: customerPortalReadScopes,
      replacement: 'Grant the granular read scopes required by the routes used.',
    },
    'customer_portal.write': {
      status: 'deprecated_legacy_alias',
      expands_to: customerPortalWriteScopes,
      replacement: 'Grant the granular write scopes required by the routes used.',
    },
  }
}

for (const document of [website, portal]) configureAuthenticationContract(document)
if (Array.isArray(website.security)) {
  website.security = [{ bearerAuth: [] }, { legacyApiKeyAuth: [] }]
}

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

function normalizeContractVersionMetadata(document) {
  document.info.version = version
  document['x-contract-schema-version'] = version

  function walk(value) {
    if (!value || typeof value !== 'object') return

    for (const [key, child] of Object.entries(value)) {
      if (
        key.toLowerCase() === 'x-gridex-contract-version' &&
        child &&
        typeof child === 'object' &&
        child.schema &&
        typeof child.schema === 'object'
      ) {
        child.schema.const = version
      }

      if (
        (key === 'contract_schema_version' || key === 'contract_version') &&
        typeof child === 'string' &&
        /^\d{4}-\d{2}-\d{2}\.\d+$/.test(child)
      ) {
        value[key] = version
        continue
      }

      if (
        (key === 'contract_schema_version' || key === 'contract_version') &&
        child &&
        typeof child === 'object' &&
        typeof child.const === 'string' &&
        /^\d{4}-\d{2}-\d{2}\.\d+$/.test(child.const)
      ) {
        child.const = version
      }

      walk(child)
    }
  }

  walk(document)
}

for (const document of [website, portal]) {
  normalizeContractVersionMetadata(document)
}

const canonicalErrorEnvelope = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'request_id', 'correlation_id', 'contract_schema_version'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'retryable', 'field', 'blockers'],
      properties: {
        code: string,
        message: string,
        stage: string,
        field: nullableString,
        hint: string,
        retryable: { type: 'boolean' },
        blockers: {
          type: 'array',
          items: { $ref: '#/components/schemas/ApiBlocker' },
        },
        details: {
          type: [
            'object',
            'array',
            'string',
            'number',
            'boolean',
            'null',
          ],
        },
      },
    },
    request_id: string,
    correlation_id: string,
    contract_schema_version: contractVersion,
  },
  description:
    'Canonical error envelope. Business and provider failures use one nested error object; no parallel top-level aliases are emitted.',
}
website.components.schemas.ApiError = canonicalErrorEnvelope
portal.components.schemas.ApiError = canonicalErrorEnvelope

website.components.schemas.LegalAcceptance = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requirement_code',
    'document_reference',
    'document_version',
    'document_hash',
    'accepted',
    'accepted_at',
  ],
  properties: {
    requirement_code: {
      type: 'string',
      description: 'Use agreement, power_of_attorney or withdrawal from legal-bundle requirements. Exact module keys remain accepted only for backward compatibility.',
    },
    document_reference: string,
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
website.components.schemas.CustomerLegalDocument = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requirement_code',
    'document_type',
    'title',
    'description',
    'required',
    'acceptance_mode',
    'document_reference',
    'document_version',
    'document_hash',
    'document_url',
    'legal_bundle_version_id',
    'module_keys',
    'source_document_ids',
    'primary_document_id',
    'sort_order',
  ],
  properties: {
    requirement_code: {
      type: 'string',
      enum: ['agreement', 'power_of_attorney', 'withdrawal'],
    },
    document_type: {
      type: 'string',
      enum: ['agreement', 'power_of_attorney', 'withdrawal'],
    },
    title: string,
    description: string,
    required: { type: 'boolean', const: true },
    acceptance_mode: {
      type: 'string',
      enum: ['accept', 'acknowledge'],
    },
    document_reference: string,
    document_version: string,
    document_hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    document_url: { type: ['string', 'null'], format: 'uri' },
    legal_bundle_version_id: uuid,
    module_keys: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: string,
    },
    source_document_ids: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: uuid,
    },
    primary_document_id: nullableUuid,
    sort_order: { type: 'integer', minimum: 0 },
  },
  description:
    'One of the three customer-facing documents. module_keys and source_document_ids bind the presentation document to every immutable canonical legal module it contains.',
}
website.components.schemas.WebsiteLegalRequirement = {
  ...website.components.schemas.CustomerLegalDocument,
  properties: {
    ...website.components.schemas.CustomerLegalDocument.properties,
    document_url: { type: 'string', format: 'uri' },
  },
}

const legalBundle = website.components.schemas.WebsiteLegalBundle
legalBundle.properties.requirements = {
  type: 'array',
  minItems: 1,
  maxItems: 3,
  items: { $ref: '#/components/schemas/WebsiteLegalRequirement' },
  description:
    'Customer-facing acceptance surface. Private consumer offers normally contain agreement, power_of_attorney and withdrawal. Business offers omit withdrawal when no withdrawal modules are published.',
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
application.properties.legal_bundle_version = string
application.properties.legal_acceptances = {
  $ref: '#/components/schemas/LegalAcceptances',
}
application.properties.price_option_reference = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9_-]{2,99}$',
}
application.properties.invoice_delivery_method = {
  type: 'string',
  enum: ['email', 'e_invoice', 'paper', 'direct_debit'],
}
application.properties.selected_component_references = {
  type: 'array',
  uniqueItems: true,
  items: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9_-]{2,99}$',
  },
}
application.properties.site_count = { type: 'integer', minimum: 1 }
delete application.properties.legalAcceptances
delete application.properties.consents
const powerOfAttorneyInput = website.components.schemas.PowerOfAttorneyInput
powerOfAttorneyInput.additionalProperties = false
powerOfAttorneyInput.properties.scope = {
  type: 'array',
  minItems: 1,
  maxItems: 2,
  uniqueItems: true,
  items: { type: 'string', enum: ['supplier_switch', 'facility_information_lookup'] },
  contains: { const: 'supplier_switch' },
  minContains: 1,
  description:
    'Exact customer-signed scopes. supplier_switch is mandatory; facility_information_lookup may be added. OPS never widens the scope after acceptance.',
}
powerOfAttorneyInput.properties.textVersionId = {
  ...uuid,
  description:
    'Use primary_document_id from the power_of_attorney requirement in the exact accepted legal bundle.',
}
application.required = Array.from(new Set([
  ...(application.required ?? []),
  'legal_bundle_version',
  'legal_acceptances',
  'price_option_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'site_count',
  'settlement',
])).filter((field) => !['auth_user_id', 'customer_portal_user_id'].includes(field))
application.dependentRequired = {
  ...(application.dependentRequired ?? {}),
  auth_user_id: ['customer_portal_user_id'],
  customer_portal_user_id: ['auth_user_id'],
}
application.description =
  'Customer application for one authenticated tenant API client. auth_user_id and customer_portal_user_id are optional as a pair when the tenant policy is post_auth_allowed; when either is supplied both must be the same verified UUID.'
application.properties.auth_user_id.description =
  'Optional verified tenant-portal auth UUID. Must be supplied together with customer_portal_user_id and must match it.'
application.properties.customer_portal_user_id.description =
  'Optional verified tenant-portal user UUID. Must be supplied together with auth_user_id and must match it.'
const stableReference = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9_-]{2,99}$',
}
const stringArray = {
  type: 'array',
  uniqueItems: true,
  items: string,
}
const applicationData =
  website.components.schemas.WebsiteCustomerApplicationData
if (applicationData) {
  applicationData.additionalProperties = false
  applicationData.properties.price_option_reference = nullableString
  applicationData.properties.area_price_reference = nullableString
  applicationData.properties.invoice_delivery_method = nullableString
  applicationData.properties.site_count = {
    type: ['integer', 'null'],
    minimum: 1,
  }
  for (const field of [
    'selected_component_references',
    'mandatory_component_references',
    'conditional_component_references',
  ]) {
    applicationData.properties[field] = stringArray
  }
  applicationData.required = Array.from(new Set([
    ...(applicationData.required ?? []),
    'selected_component_references',
    'mandatory_component_references',
    'conditional_component_references',
  ]))
}
const nullableDate = { type: ['string', 'null'], format: 'date' }
const contractType = {
  type: 'string',
  enum: [
    'fixed',
    'variable_monthly',
    'variable_hourly',
    'variable_quarterly',
    'portfolio',
    'mixed',
  ],
}
const customerType = {
  type: 'string',
  enum: ['private', 'business', 'both'],
}
const invoiceDeliveryMethod = {
  type: 'string',
  enum: ['email', 'e_invoice', 'paper', 'direct_debit'],
}
const permissiveObject = { type: 'object', additionalProperties: true }

website.components.schemas.ContractPriceOptionAreaPrice = {
  type: 'object',
  additionalProperties: false,
  required: [
    'area_price_reference',
    'price_area',
    'energy_price_ore_per_kwh',
    'unit',
    'valid_from',
    'valid_to',
  ],
  properties: {
    area_price_reference: stableReference,
    price_area: { type: 'string', enum: ['SE1', 'SE2', 'SE3', 'SE4'] },
    energy_price_ore_per_kwh: { type: 'number', exclusiveMinimum: 0 },
    unit: { type: 'string', const: 'ore_per_kwh' },
    valid_from: nullableDate,
    valid_to: nullableDate,
  },
}
website.components.schemas.ContractPriceOption = {
  type: 'object',
  additionalProperties: false,
  required: [
    'price_option_reference',
    'option_code',
    'customer_name',
    'contract_type',
    'customer_type',
    'binding_months',
    'notice_months',
    'auto_renew_enabled',
    'renewal_term_months',
    'price_type',
    'resolution',
    'currency',
    'unit',
    'fixed_price',
    'markup',
    'monthly_fee',
    'is_default',
    'default',
    'selection_required',
    'valid_from',
    'valid_to',
    'earliest_start_date',
    'latest_start_date',
    'area_prices',
  ],
  properties: {
    price_option_reference: stableReference,
    option_code: stableReference,
    customer_name: string,
    contract_type: contractType,
    customer_type: customerType,
    binding_months: { type: 'integer', minimum: 0 },
    notice_months: { type: 'integer', minimum: 0 },
    auto_renew_enabled: { type: 'boolean' },
    renewal_term_months: { type: ['integer', 'null'], minimum: 1 },
    price_type: contractType,
    resolution: { type: 'string', enum: ['monthly', 'hourly', 'quarterly'] },
    currency: { type: 'string', const: 'SEK' },
    unit: { type: 'string', const: 'ore_per_kwh' },
    fixed_price: { type: ['number', 'null'] },
    markup: { type: ['number', 'null'] },
    monthly_fee: { type: ['number', 'null'] },
    is_default: {
      type: 'boolean',
      description: 'Canonical source of truth for whether this price option is the default.',
    },
    default: {
      type: 'boolean',
      deprecated: true,
      description: 'Deprecated compatibility alias for is_default. Always identical to is_default.',
    },
    selection_required: { type: 'boolean' },
    valid_from: nullableDate,
    valid_to: nullableDate,
    earliest_start_date: nullableDate,
    latest_start_date: nullableDate,
    area_prices: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/ContractPriceOptionAreaPrice',
      },
    },
  },
}

const legalDocument = website.components.schemas.LegalBundleDocument
legalDocument.additionalProperties = false
legalDocument.properties = {
  id: uuid,
  legal_bundle_version_id: nullableUuid,
  document_reference: string,
  module_key: string,
  version: string,
  title: string,
  published_at: { type: ['string', 'null'], format: 'date-time' },
  content_sha256: {
    type: ['string', 'null'],
    pattern: '^[a-fA-F0-9]{64}$',
  },
  origin: string,
  url: { type: ['string', 'null'], format: 'uri' },
}
legalDocument.required = Object.keys(legalDocument.properties)

website.components.schemas.LegacyLegalVersion = {
  type: 'object',
  additionalProperties: false,
  deprecated: true,
  required: [
    'id',
    'type',
    'version',
    'title',
    'published_at',
    'content_sha256',
    'legal_bundle_version_id',
    'document_reference',
    'origin',
    'url',
  ],
  properties: {
    id: uuid,
    type: string,
    version: string,
    title: string,
    published_at: { type: ['string', 'null'], format: 'date-time' },
    content_sha256: {
      type: ['string', 'null'],
      pattern: '^[a-fA-F0-9]{64}$',
    },
    legal_bundle_version_id: nullableUuid,
    document_reference: string,
    origin: string,
    url: { type: ['string', 'null'], format: 'uri' },
  },
}

const legalBlock = website.components.schemas.WebsiteLegalBlock
for (const field of [
  'terms_document_reference',
  'privacy_policy_document_reference',
  'withdrawal_document_reference',
  'price_terms_document_reference',
  'power_of_attorney_document_reference',
  'legal_bundle_reference',
]) {
  legalBlock.properties[field] = nullableString
}
for (const staleAlias of [
  'terms_version_id',
  'privacy_policy_version_id',
  'withdrawal_version_id',
  'price_terms_version_id',
  'power_of_attorney_version_id',
]) {
  delete legalBlock.properties[staleAlias]
}
legalBlock.properties.legal_bundle_version_id = {
  ...nullableUuid,
  description:
    'Immutable legal bundle version locked into the publication snapshot. The property is always present; historical explicitly approved exceptions may be null.',
}
legalBlock.properties.legal_bundle_reference.description =
  'Stable external reference for the locked legal bundle version.'
legalBlock.properties.immutable = {
  type: 'boolean',
  const: true,
  description: 'Published legal snapshots are immutable.',
}
legalBlock.properties.required_modules = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: string,
}
legalBlock.properties.module_versions = {
  type: 'array',
  minItems: 1,
  items: { $ref: '#/components/schemas/LegalBundleDocument' },
}
legalBlock.properties.customer_documents = {
  type: 'array',
  minItems: 1,
  maxItems: 3,
  items: { $ref: '#/components/schemas/CustomerLegalDocument' },
  description:
    'Customer-facing grouped documents. Render these instead of one checkbox per module_version. module_versions remains the immutable evidence manifest.',
}
legalBlock.properties.power_of_attorney_version_id = nullableUuid
legalBlock.additionalProperties = false
legalBlock.required = Array.from(new Set([
  ...(legalBlock.required ?? []),
  'legal_bundle_reference',
  'legal_bundle_version_id',
  'immutable',
  'required_modules',
  'module_versions',
  'customer_documents',
  'power_of_attorney_version_id',
]))

const pricingProperties = Object.fromEntries(
  [
    'monthly_fee',
    'invoice_fee',
    'markup',
    'spot_markup',
    'variable_fee',
    'fixed_price',
    'area_pricing',
    'green_fee',
    'spot_share',
    'portfolio_share',
    'fixed_share',
    'public_price_text',
    'visibility',
    'price_areas',
    'vat_rate',
    'market_price_responsibility',
    'calculation_contract',
    'interval_resolution',
    'energy_direction',
    'production_pricing',
    'base_components',
    'calculation_components',
    'components',
    'display_components',
    'summary_components',
    'electricity_certificate',
    'start_fee',
    'administration_fee',
    'break_fee',
    'portfolio_price',
    'portfolio_monthly_prices',
    'portfolio_method',
    'portfolio_indications',
    'portfolio_management_fee',
    'discount',
  ].map((field) => [field, {}]),
)
const publicPricing = {
  type: 'object',
  additionalProperties: false,
  required: [
    'visibility',
    'calculation_components',
    'display_components',
    'calculation_contract',
    'summary_components',
  ],
  properties: pricingProperties,
}

const pricingSnapshot = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    [
      'schema_version',
      'contract_type',
      'energy_direction',
      'customer_type',
      'price_areas',
      'valid_from',
      'valid_to',
      'binding_months',
      'notice_months',
      'automatic_renewal',
      'power_of_attorney_required',
      'base_components',
      'price_components',
      'display_price_components',
      'summary_price_components',
      'website_visibility',
      'market_price_responsibility',
      'calculation_contract',
      'portfolio_method',
      'portfolio_monthly_prices',
      'public_price_text',
      'vat_rate',
      'vat_rate_percent',
      'interval_resolution',
      'production',
    ].map((field) => [field, {}]),
  ),
}

const publicContractProperties = Object.fromEntries(
  [
    'id',
    'offer_reference',
    'contract_offer_id',
    'publication_reference',
    'offer_code',
    'code',
    'product_code',
    'name',
    'public_name',
    'description',
    'public_description',
    'contract_type',
    'energy_direction',
    'type',
    'billing_model',
    'area_pricing',
    'customer_type',
    'customer_types',
    'production_pricing',
    'portfolio_price_ore_per_kwh',
    'portfolio_management_fee',
    'monthly_fee_sek',
    'invoice_fee_sek',
    'markup_ore_per_kwh',
    'spot_markup_ore_per_kwh',
    'variable_fee_ore_per_kwh',
    'fixed_price_ore_per_kwh',
    'green_fee_mode',
    'green_fee_value',
    'terms_version',
    'terms_url',
    'public_price_text',
    'binding_months',
    'notice_months',
    'website_cta_enabled',
    'price_areas',
    'automatic_renewal',
    'power_of_attorney_required',
    'vat_rate',
    'mix',
    'withdrawal_version',
    'legal_versions',
    'valid_from',
    'valid_to',
    'is_public',
    'is_active',
    'sort_order',
    'channel',
  ].map((field) => [field, {}]),
)
for (const field of ['id', 'contract_offer_id', 'publication_reference']) {
  publicContractProperties[field] = {
    type: 'string',
    deprecated: true,
    description:
      'Deprecated compatibility alias. Contains the same stable external value as offer_reference and never a database UUID.',
  }
}
publicContractProperties.offer_reference = stableReference
publicContractProperties.name = string
publicContractProperties.description = nullableString
publicContractProperties.contract_type = contractType
publicContractProperties.energy_direction = {
  $ref: '#/components/schemas/EnergyDirection',
}
publicContractProperties.customer_type = customerType
publicContractProperties.channel = { type: 'string', const: 'website' }
publicContractProperties.valid_from = nullableDate
publicContractProperties.valid_to = nullableDate
publicContractProperties.product_code = nullableString
publicContractProperties.legal_versions = {
  type: 'array',
  deprecated: true,
  description:
    'Deprecated compatibility view of legal.module_versions. New clients must use legal.module_versions.',
  items: { $ref: '#/components/schemas/LegacyLegalVersion' },
}
publicContractProperties.area_pricing = {
  type: 'array',
  deprecated: true,
  description:
    'Deprecated presentation-only area pricing. Use top-level price_options[].area_prices for canonical commercial selection.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'price_area',
      'energy_price_ore_per_kwh',
      'unit',
      'vat_included',
      'vat_rate',
    ],
    properties: {
      price_area: { type: 'string', enum: ['SE1', 'SE2', 'SE3', 'SE4'] },
      energy_price_ore_per_kwh: { type: 'number' },
      unit: { type: 'string', const: 'ore_per_kwh' },
      vat_included: { type: 'boolean' },
      vat_rate: { type: 'number' },
    },
  },
}
publicContractProperties.price_options = {
  type: 'array',
  minItems: 1,
  items: { $ref: '#/components/schemas/ContractPriceOption' },
}
publicContractProperties.pricing = publicPricing
publicContractProperties.pricing_snapshot = pricingSnapshot
publicContractProperties.legal = {
  $ref: '#/components/schemas/WebsiteLegalBlock',
}
website.components.schemas.PublicContract = {
  type: 'object',
  additionalProperties: false,
  required: [
    'offer_reference',
    'name',
    'contract_type',
    'energy_direction',
    'customer_type',
    'price_options',
    'pricing',
    'legal',
    'channel',
  ],
  properties: publicContractProperties,
}

website.components.schemas.ApiPublicContract = {
  type: 'object',
  additionalProperties: false,
  required: [
    'offer_reference',
    'name',
    'description',
    'contract_type',
    'energy_direction',
    'customer_type',
    'price_options',
    'pricing',
    'legal',
    'valid_from',
    'valid_to',
    'channel',
  ],
  properties: {
    offer_reference: string,
    name: string,
    description: nullableString,
    contract_type: contractType,
    energy_direction: {
      $ref: '#/components/schemas/EnergyDirection',
    },
    customer_type: customerType,
    price_options: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/ContractPriceOption' },
    },
    pricing: publicPricing,
    legal: { $ref: '#/components/schemas/WebsiteLegalBlock' },
    valid_from: nullableString,
    valid_to: nullableString,
    channel: { type: 'string', enum: ['website', 'api'] },
  },
}


const publicContractMeta = {
  type: 'object',
  additionalProperties: false,
  required: [
    'organization_reference',
    'api_version',
    'channel',
    'count',
    'publication_revision',
    'publication_updated_at',
    'contract_schema_version',
    'feed_state',
    'empty_feed_authorization',
  ],
  properties: {
    organization_reference: string,
    api_version: { const: 'v1' },
    channel: { type: 'string', enum: ['website', 'api'] },
    count: { type: 'integer', minimum: 0 },
    publication_revision: { type: 'integer', minimum: 0 },
    publication_updated_at: { type: ['string', 'null'], format: 'date-time' },
    contract_schema_version: contractVersion,
    feed_state: { type: 'string', enum: ['contracts_present', 'canonical_empty'] },
    empty_feed_authorization: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: [
        'authorized',
        'reason',
        'publication_revision',
        'canonical_source',
        'affected_offer_references',
        'blockers',
      ],
      properties: {
        authorized: { type: 'boolean', const: true },
        reason: {
          type: 'string',
          enum: [
            'no_canonical_publications',
            'canonical_unpublished_or_archived',
            'publication_validity_ended',
            'canonical_no_visible_contracts',
          ],
        },
        publication_revision: { type: 'integer', minimum: 0 },
        canonical_source: {
          type: 'string',
          const: 'canonical_public_contract_delivery_readiness_v',
        },
        affected_offer_references: { type: 'array', items: string },
        blockers: { type: 'array', items: string },
      },
    },
    deprecated_aliases: { type: 'array', items: string },
    customer_type: { type: ['string', 'null'], enum: ['private', 'business', null] },
    deprecated_customer_type_alias: { type: 'boolean' },
  },
}

function publicContractsEnvelope(contractSchema) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'contracts', 'meta', 'request_id'],
    properties: {
      data: { type: 'array', items: contractSchema },
      contracts: {
        type: 'array',
        deprecated: true,
        description: 'Deprecated compatibility alias for data.',
        items: contractSchema,
      },
      meta: publicContractMeta,
      diagnostics: { type: 'object', additionalProperties: true },
      request_id: uuid,
    },
  }
}

setResponse(
  website,
  '/api/v1/website/public-contracts',
  publicContractsEnvelope({ $ref: '#/components/schemas/PublicContract' }),
)
website.paths['/api/v1/website/public-contracts'].get.responses['200'].content[
  'application/json'
].example = publicContractsExample
for (const path of ['/api/v1/public-contracts', '/api/v1/contracts']) {
  setResponse(
    website,
    path,
    publicContractsEnvelope({ $ref: '#/components/schemas/ApiPublicContract' }),
  )
}

for (const path of [
  '/api/v1/website/public-contracts',
  '/api/v1/public-contracts',
  '/api/v1/contracts',
]) {
  const responses = website.paths[path].get.responses
  for (const response of Object.values(responses)) {
    response.headers = {
      ...(response.headers ?? {}),
      'X-Gridex-Contract-Version': {
        schema: contractVersion,
        description: 'Canonical public contract schema version.',
      },
      'X-Request-ID': {
        schema: uuid,
        description: 'Correlation identifier returned in the response body and logs.',
      },
    }
  }
  for (const status of ['200', '304']) {
    const response = responses[status]
    if (!response) continue
    response.headers = {
      ...(response.headers ?? {}),
      ETag: {
        schema: string,
        description: 'Tenant- and channel-specific publication revision token.',
      },
      'X-RateLimit-Limit': { schema: { type: 'integer', minimum: 0 } },
      'X-RateLimit-Remaining': { schema: { type: 'integer', minimum: 0 } },
      'X-RateLimit-Reset': { schema: nullableString },
    }
  }
}

const quoteRequest = website.components.schemas.WebsiteQuoteRequest
quoteRequest.additionalProperties = false
quoteRequest.properties.price_option_reference = stableReference
quoteRequest.properties.invoice_delivery_method = invoiceDeliveryMethod
quoteRequest.properties.selected_component_references = stringArray
quoteRequest.properties.site_count = { type: 'integer', minimum: 1 }
quoteRequest.required = Array.from(new Set([
  ...(quoteRequest.required ?? []),
  'invoice_delivery_method',
  'selected_component_references',
  'site_count',
]))

const quoteValidationRequest =
  website.components.schemas.QuoteValidationRequest
quoteValidationRequest.additionalProperties = false
delete quoteValidationRequest.properties.application_id
quoteValidationRequest.properties.application_number = string
quoteValidationRequest.required = (quoteValidationRequest.required ?? []).filter(
  (field) => field !== 'application_id',
)
quoteValidationRequest.properties.price_option_reference = stableReference
quoteValidationRequest.properties.invoice_delivery_method =
  invoiceDeliveryMethod
quoteValidationRequest.properties.selected_component_references = stringArray
quoteValidationRequest.properties.site_count = {
  type: 'integer',
  minimum: 1,
}
quoteValidationRequest.required = Array.from(new Set([
  ...(quoteValidationRequest.required ?? []),
  'price_option_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'site_count',
]))

website.components.schemas.WebsiteQuoteSettlement = {
  type: 'object',
  additionalProperties: false,
  required: [
    'model',
    'customer_accepts',
    'energy_price_locked_at_signup',
    'uses_actual_metered_consumption',
    'market_data_role',
    'settlement_resolution',
  ],
  properties: {
    model: { type: 'string', enum: ['fixed_price','market_monthly','market_hourly','market_quarter_hour','portfolio','mixed'] },
    customer_accepts: { type: 'string', enum: ['fixed_energy_price','pricing_model','portfolio_pricing_model','mixed_pricing_model'] },
    energy_price_locked_at_signup: { type: 'boolean', description: 'True only for a fixed-price product. Market, portfolio and mixed products do not freeze the future energy price at signup.' },
    uses_actual_metered_consumption: { type: 'boolean', const: true },
    market_data_role: { type: 'string', enum: ['not_applicable','indicative_preview_only'] },
    settlement_resolution: { type: 'string', enum: ['fixed','month','hour','quarter_hour','portfolio_period','mixed_components'] },
  },
  description: 'How the accepted product is settled. The authenticated API credential determines the organization; no tenant selector is accepted here.',
}

const quoteData = website.components.schemas.WebsiteQuoteData
quoteData.additionalProperties = false
for (const field of [
  'offer',
  'status',
  'selected_area_price',
  'input',
  'resolution',
  'market_reference',
  'estimate',
  'lines',
  'energy_direction',
  'production_pricing',
  'pricing_interval',
  'estimate_method',
  'source_period',
  'source_window',
  'market_data_timestamp',
  'is_binding',
  'market_sources',
  'warnings',
  'assumptions',
  'pricing_snapshot_schema_version',
  'snapshot_schema',
  'price_option_reference',
  'area_price_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'mandatory_component_references',
  'conditional_component_references',
  'site_count',
  'pricing',
  'resolved_base_components',
  'resolved_price_components',
  'pricing_snapshot',
  'settlement',
]) {
  quoteData.properties[field] ??= {}
}
quoteData.properties.offer = permissiveObject
quoteData.properties.settlement = { $ref: '#/components/schemas/WebsiteQuoteSettlement' }
quoteData.properties.valid_until = { type: 'string', format: 'date-time', description: 'Compatibility and immutable audit metadata. An issued customer-visible website quote is not rejected merely because this timestamp passes.' }
quoteData.properties.is_binding = { type: 'boolean', description: 'True only when the energy price itself is fixed at signup. False for monthly market, hourly, quarter-hour, portfolio and mixed products.' }
quoteData.required = Array.from(new Set([
  ...(quoteData.required ?? []),
  'offer',
  'price_option_reference',
  'area_price_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'mandatory_component_references',
  'conditional_component_references',
  'site_count',
]))
website.components.schemas.WebsiteQuoteResponse = envelope({
  $ref: '#/components/schemas/WebsiteQuoteData',
})
setResponse(
  website,
  '/api/v1/website/quote',
  { $ref: '#/components/schemas/WebsiteQuoteResponse' },
  'post',
  '201',
)
const quoteResponseContent =
  website.paths['/api/v1/website/quote'].post.responses['201'].content[
    'application/json'
  ]
const quoteExample = quoteResponseContent.example
if (quoteExample?.data) {
  quoteExample.data.offer ??= {
    offer_reference: quoteExample.data.offer_reference ?? 'offer_example',
    energy_direction: 'consumption',
  }
  quoteExample.data.price_option_reference ??= 'price_option_example'
  quoteExample.data.area_price_reference ??= null
  quoteExample.data.invoice_delivery_method ??= 'email'
  quoteExample.data.selected_component_references ??= []
  quoteExample.data.mandatory_component_references ??= []
  quoteExample.data.conditional_component_references ??= []
  quoteExample.data.site_count ??= 1
  quoteExample.contract_schema_version = version
}

const marketPriceExample =
  website.paths?.['/api/v1/website/market-price/current']?.post?.responses?.[
    '200'
  ]?.content?.['application/json']?.example
if (marketPriceExample?.data) {
  marketPriceExample.data.selected_resolution ??=
    marketPriceExample.data.resolution ?? 'hourly'
  marketPriceExample.data.available_resolutions ??= [
    marketPriceExample.data.selected_resolution,
  ]
  marketPriceExample.data.fallback_used ??= false
  marketPriceExample.contract_schema_version = version
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
    'price_option_reference',
    'area_price_reference',
    'invoice_delivery_method',
    'selected_component_references',
    'mandatory_component_references',
    'conditional_component_references',
    'site_count',
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
    price_option_reference: nullableString,
    area_price_reference: nullableString,
    invoice_delivery_method: invoiceDeliveryMethod,
    selected_component_references: stringArray,
    mandatory_component_references: stringArray,
    conditional_component_references: stringArray,
    site_count: { type: 'integer', minimum: 1 },
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
        area_price_reference: nullableString,
      },
      required: [
        'price_area',
        'energy_price_ore_per_kwh',
        'unit',
        'price_option_reference',
        'area_price_reference',
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

website.components.schemas.PublicationChangedWebhook = {
  type: 'object',
  additionalProperties: false,
  required: [
    'event_id',
    'delivery_id',
    'event_type',
    'created_at',
    'tenant_reference',
    'aggregate',
    'data',
    'contract_schema_version',
  ],
  properties: {
    event_id: {
      type: 'string',
      pattern: '^event_[a-f0-9]{32}$',
    },
    delivery_id: {
      type: 'string',
      pattern: '^delivery_[a-f0-9]{32}$',
    },
    event_type: {
      type: 'string',
      const: 'contracts.publication.changed',
    },
    created_at: dateTime,
    tenant_reference: {
      type: 'string',
      pattern: '^tenant_[A-Za-z0-9._-]+$',
    },
    environment: {
      type: ['string', 'null'],
      enum: ['test', 'production', null],
    },
    aggregate: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'reference'],
      properties: {
        type: { type: 'string', const: 'contract_publication' },
        reference: string,
      },
    },
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['customer_reference', 'customer_number'],
      properties: {
        customer_reference: nullableString,
        customer_number: nullableString,
      },
    },
    data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'channel',
        'publication_revision',
        'revision_token',
        'reason',
        'timestamp',
      ],
      properties: {
        channel: {
          type: 'string',
          enum: ['website', 'api', 'internal', 'phone', 'partner'],
        },
        publication_revision: { type: 'integer', minimum: 1 },
        revision_token: string,
        reason: string,
        timestamp: dateTime,
      },
    },
    contract_schema_version: contractVersion,
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
  required: [
    'contract_name',
    'contract_version',
    'url',
    'sha256',
    'compatibility',
  ],
  properties: {
    contract_name: string,
    contract_version: contractVersion,
    url: { type: 'string', format: 'uri' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    compatibility: {
      type: 'string',
      enum: ['backward-compatible', 'breaking'],
    },
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
portal.components.schemas.CustomerContract = {
  type: 'object',
  additionalProperties: false,
  required: ['contract_reference', 'status'],
  properties: {
    contract_reference: string,
    contract_number: nullableString,
    offer_reference: nullableString,
    contract_name: nullableString,
    contract_type: nullableString,
    energy_direction: string,
    status: string,
    start_date: nullableString,
    end_date: nullableString,
    signed_at: nullableString,
    withdrawal_deadline_at: nullableString,
    signature_snapshot_sha256: nullableString,
    price_area: nullableString,
    monthly_fee_sek: { type: ['number', 'null'] },
    invoice_fee_sek: { type: ['number', 'null'] },
    fixed_price_ore_per_kwh: { type: ['number', 'null'] },
    markup_ore_per_kwh: { type: ['number', 'null'] },
    binding_months: { type: ['number', 'null'] },
    notice_months: { type: ['number', 'null'] },
    auto_renew_enabled: { type: 'boolean' },
    created_at: nullableString,
  },
}
portal.components.schemas.CustomerInvoice = {
  type: 'object',
  additionalProperties: false,
  required: ['invoice_reference', 'status'],
  properties: {
    invoice_reference: string,
    invoice_number: nullableString,
    period_start: nullableString,
    period_end: nullableString,
    total_kwh: { type: ['number', 'null'] },
    amount_ex_vat: { type: ['number', 'null'] },
    vat_amount: { type: ['number', 'null'] },
    amount_inc_vat: { type: ['number', 'null'] },
    currency: string,
    issued_at: nullableString,
    due_date: nullableString,
    paid_at: nullableString,
    status: string,
    created_at: nullableString,
  },
}
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
    notification_references: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$',
      },
    },
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
require('./finalize-openapi-release.portal.cjs')({
  application,
  canonicalErrorEnvelope,
  contractVersion,
  crypto,
  dateTime,
  envelope,
  fs,
  normalizeContractVersionMetadata,
  nullableString,
  portal,
  portalPath,
  priorVersion,
  publicContractsExample,
  publishedVersions,
  setRequest,
  setResponse,
  string,
  uuid,
  version,
  website,
  websitePath,
})
