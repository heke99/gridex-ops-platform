#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')

const version = '2026-08-05.2'
const websitePath = 'docs/openapi/website-integration-v1.json'
const portalPath = 'docs/openapi/customer-portal-v1.json'
const website = JSON.parse(fs.readFileSync(websitePath, 'utf8'))
const portal = JSON.parse(fs.readFileSync(portalPath, 'utf8'))
const publicContractsExample = JSON.parse(
  fs.readFileSync('docs/fixtures/public-contracts-response-2026-08-05.2.json', 'utf8'),
)

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const uuid = { type: 'string', format: 'uuid' }
const nullableUuid = { type: ['string', 'null'], format: 'uuid' }
const dateTime = { type: 'string', format: 'date-time' }
const contractVersion = { type: 'string', const: version }

const priorVersion = '2026-08-05.1'
const publishedVersions = ['2026-08-02.1', '2026-08-03.1', '2026-08-04.3', priorVersion, version]
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
  'auth_user_id',
  'customer_portal_user_id',
]))
application.dependentRequired = {
  ...(application.dependentRequired ?? {}),
  auth_user_id: ['customer_portal_user_id'],
  customer_portal_user_id: ['auth_user_id'],
}
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
    'tenant_reference',
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
    tenant_reference: website.components.schemas.TenantMeta.properties.tenant_reference,
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
]) {
  quoteData.properties[field] ??= {}
}
quoteData.properties.offer = permissiveObject
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

const identifierProperties = {
  email: { type: 'string', format: 'email', maxLength: 320 },
  customer_number: { type: 'string', maxLength: 100 },
  external_customer_id: { type: 'string', maxLength: 200 },
  authenticated_user_reference: { type: 'string', maxLength: 200 },
}
portal.components.schemas.CustomerSyncRequest = {
  type: 'object',
  additionalProperties: false,
  anyOf: Object.keys(identifierProperties).map((key) => ({ required: [key] })),
  properties: {
    ...identifierProperties,
    profile: {
      type: 'object',
      additionalProperties: false,
      properties: {
        first_name: string,
        last_name: string,
        full_name: string,
        company_name: string,
        phone: string,
        invoice_email: { type: 'string', format: 'email' },
        language_code: string,
        timezone: string,
      },
    },
    facility_data: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          facility_reference: string,
          facility_id: string,
          metering_point_id: string,
          move_in_date: { type: 'string', format: 'date' },
          requested_start_date: { type: 'string', format: 'date' },
          address: {
            type: 'object',
            additionalProperties: false,
            properties: {
              street: string,
              postal_code: string,
              city: string,
              country: string,
              care_of: string,
              apartment_number: string,
            },
          },
          metadata: { type: 'object' },
        },
      },
    },
    documents: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document_reference: string,
          document_type: string,
          title: string,
          status: string,
          secure_url: { type: 'string', format: 'uri' },
          file_name: string,
          mime_type: string,
          file_size_bytes: { type: 'integer', minimum: 0 },
          metadata: { type: 'object' },
        },
      },
    },
    legal_acceptances: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'document_reference',
          'document_code',
          'document_version',
          'document_hash',
          'accepted',
          'accepted_at',
        ],
        properties: {
          document_reference: string,
          document_code: string,
          document_version: string,
          document_hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
          accepted: { type: 'boolean', const: true },
          accepted_at: dateTime,
          metadata: { type: 'object' },
        },
      },
    },
    power_of_attorney: {
      type: 'object',
      additionalProperties: false,
      required: [
        'document_reference',
        'scope',
        'accepted',
        'accepted_at',
      ],
      description:
        'Tenant-synkad fullmakt. signer_name, signer_identity_number och method krävs för att fullmakten ska bli signerad och externt sändbar; äldre payload utan dessa lagras endast som ett ofullständigt utkast och blockerar leverantörsbyte.',
      properties: {
        power_of_attorney_reference: string,
        document_reference: {
          ...string,
          description:
            'Accepterar både den nya customer_documents-referensen för power_of_attorney och äldre exakt module_version-referens från samma tenantbundna legal bundle.',
        },
        scope: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: {
            type: 'string',
            enum: ['supplier_switch', 'facility_information_lookup'],
          },
          contains: { const: 'supplier_switch' },
        },
        accepted: { type: 'boolean', const: true },
        accepted_at: dateTime,
        signer_name: string,
        signer_identity_number: string,
        method: string,
        ip_address: string,
        user_agent: string,
        valid_from: { type: 'string', format: 'date' },
        valid_to: { type: 'string', format: 'date' },
        metadata: { type: 'object' },
      },
    },
    metadata: { type: 'object' },
  },
}
portal.components.schemas.CustomerMoveOutRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['facility_reference', 'requested_move_out_date'],
  properties: {
    ...identifierProperties,
    customer_contract_reference: string,
    facility_reference: string,
    requested_move_out_date: { type: 'string', format: 'date' },
    reason: string,
    new_address: { type: 'object' },
    contact_details: { type: 'object' },
    metadata: { type: 'object' },
  },
}
setRequest(
  portal,
  '/api/v1/customer/sync',
  { $ref: '#/components/schemas/CustomerSyncRequest' },
)
setRequest(
  portal,
  '/api/v1/customer/move-out',
  { $ref: '#/components/schemas/CustomerMoveOutRequest' },
)
portal.components.schemas.CustomerSyncData = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'customer_reference', 'summary'],
  properties: {
    status: { type: 'string', const: 'synced' },
    customer_reference: nullableString,
    customer_number: nullableString,
    external_customer_id: nullableString,
    summary: { type: 'object' },
  },
}
portal.components.schemas.CustomerMoveOutData = {
  type: 'object',
  additionalProperties: false,
  required: [
    'completion_reference',
    'customer_reference',
    'facility_reference',
    'requested_move_out_date',
    'status',
    'replayed',
  ],
  properties: {
    completion_reference: string,
    customer_reference: string,
    facility_reference: string,
    contract_reference: nullableString,
    requested_move_out_date: { type: 'string', format: 'date' },
    status: { type: 'string', const: 'submitted' },
    replayed: { type: 'boolean' },
  },
}
setResponse(
  portal,
  '/api/v1/customer/sync',
  envelope({ $ref: '#/components/schemas/CustomerSyncData' }),
  'post',
)
setResponse(
  portal,
  '/api/v1/customer/move-out',
  envelope({ $ref: '#/components/schemas/CustomerMoveOutData' }),
  'post',
)
portal.paths['/api/v1/customer/move-out'].post.responses['201'] =
  portal.paths['/api/v1/customer/move-out'].post.responses['200']


// Runtime/OpenAPI hardening for release 2026-08-05.1. These overrides are
// deliberately placed after legacy schema construction so the public contract
// has one source of truth even while deprecated components remain resolvable.
for (const document of [website, portal]) {
  document.components.schemas.ApiError = canonicalErrorEnvelope
  document.components.schemas.ErrorEnvelope = canonicalErrorEnvelope
  document.components.schemas.ErrorResponse = canonicalErrorEnvelope
  document.components.schemas.MarketPriceErrorEnvelope = canonicalErrorEnvelope
}

function closedObject(properties, required = []) {
  return { type: 'object', additionalProperties: false, required, properties }
}

function ensureStandardHeaders(document) {
  document.components.headers = document.components.headers ?? {}
  Object.assign(document.components.headers, {
    GridexContractVersion: {
      description: 'Canonical contract version used for this response.',
      schema: contractVersion,
    },
    RequestId: {
      description: 'Stable request identifier for support and audit.',
      schema: string,
    },
    RateLimitLimit: { schema: { type: 'integer', minimum: 1 } },
    RateLimitRemaining: { schema: { type: 'integer', minimum: 0 } },
    RateLimitReset: { schema: dateTime },
    RetryAfter: { schema: { type: 'integer', minimum: 1 } },
    ETag: { description: 'Strong entity tag for conditional retrieval.', schema: string },
    CacheControl: { description: 'Caching policy for this document.', schema: string },
    ContentType: { description: 'Response media type.', schema: string },
    ContentDisposition: { description: 'Suggested inline filename.', schema: string },
    Vary: { description: 'Request headers that affect cache validation.', schema: string },
  })

  function addHeaders(response, status) {
    if (!response || typeof response !== 'object' || response.$ref) return
    response.headers = {
      ...(response.headers ?? {}),
      'X-Gridex-Contract-Version': { $ref: '#/components/headers/GridexContractVersion' },
      'X-Request-ID': { $ref: '#/components/headers/RequestId' },
      'X-RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
      'X-RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
      'X-RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
      ...(String(status) === '429'
        ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } }
        : {}),
    }
  }
  for (const response of Object.values(document.components.responses ?? {})) {
    addHeaders(response, '')
  }
  for (const item of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation) continue
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        addHeaders(response, status)
      }
    }
  }
}


function ensureCanonicalErrorResponses(document) {
  for (const item of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation) continue
      for (const [status, original] of Object.entries(operation.responses ?? {})) {
        if (!/^[45]\d\d$/.test(String(status))) continue
        const referenced = original?.$ref?.startsWith('#/components/responses/')
          ? document.components?.responses?.[original.$ref.split('/').at(-1)]
          : null
        const source = referenced ?? original ?? {}
        operation.responses[status] = {
          description: source.description ?? 'Canonical API error.',
          ...(source.headers ? { headers: source.headers } : {}),
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        }
      }
    }
  }
}

function ensureSecurityFromScopeExtensions(document) {
  for (const item of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation) continue
      const scopes = operation['x-required-scopes']
      if (!Array.isArray(scopes) || scopes.length === 0) continue
      const scopeMode = String(operation['x-scope-mode'] ?? 'all')
      const bearerRequirements = scopeMode.startsWith('any')
        ? scopes.map((scope) => ({ bearerAuth: [scope] }))
        : [{ bearerAuth: scopes }]
      operation.security = [...bearerRequirements, { legacyApiKeyAuth: [] }]
    }
  }
}

function ensureParameterRef(operation, ref) {
  if (!operation) return
  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : []
  if (!parameters.some((parameter) => parameter?.$ref === ref)) {
    operation.parameters = [...parameters, { $ref: ref }]
  }
}

function dedupeOperationParameters(document) {
  for (const item of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation || !Array.isArray(operation.parameters)) continue
      const seen = new Set()
      operation.parameters = operation.parameters.filter((parameter) => {
        const key = parameter?.$ref
          ? `ref:${parameter.$ref}`
          : `parameter:${parameter?.in ?? ''}:${parameter?.name ?? JSON.stringify(parameter)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
  }
}

function removeMisappliedLegalDescription(document) {
  function walk(value, key = '') {
    if (!value || typeof value !== 'object') return
    if (
      value.description === 'Stable external reference for the locked legal bundle version.' &&
      !/legal_bundle/i.test(key)
    ) delete value.description
    for (const [childKey, child] of Object.entries(value)) walk(child, childKey)
  }
  walk(document)
}

const publicReferenceSchema = {
  type: ['string', 'null'],
  pattern: '^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$',
}
const websiteApplicationData = website.components.schemas.WebsiteCustomerApplicationData
for (const internalField of [
  'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
  'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
]) delete websiteApplicationData.properties[internalField]
websiteApplicationData.required = (websiteApplicationData.required ?? []).filter(
  (field) => ![
    'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
    'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
  ].includes(field),
)
Object.assign(websiteApplicationData.properties, {
  application_number: string,
  customer_reference: publicReferenceSchema,
  application_reference: publicReferenceSchema,
  facility_reference: publicReferenceSchema,
  metering_point_reference: publicReferenceSchema,
  contract_reference: publicReferenceSchema,
  supplier_switch: closedObject({
    request_reference: publicReferenceSchema,
    status: { type: 'string', enum: ['created', 'not_created'] },
    can_create_request: { type: 'boolean' },
    can_dispatch: { type: 'boolean' },
    blockers: { type: 'array', items: string },
    next_action: string,
  }, ['request_reference', 'status', 'can_create_request', 'can_dispatch', 'blockers', 'next_action']),
})
websiteApplicationData.required = Array.from(new Set([
  ...(websiteApplicationData.required ?? []),
  'application_number',
  'supplier_switch',
]))
website.components.schemas.WebsiteCustomerApplicationResponse = envelope({
  $ref: '#/components/schemas/WebsiteCustomerApplicationData',
})
setResponse(
  website,
  '/api/v1/website/customer-applications',
  { $ref: '#/components/schemas/WebsiteCustomerApplicationResponse' },
  'post',
  '200',
)
if (website.paths['/api/v1/website/customer-applications']?.post) {
  website.paths['/api/v1/website/customer-applications'].post.description =
    'Scope: website_applications.write. Idempotency-Key krävs. Tenant härleds enbart från API-nyckeln. auth_user_id och customer_portal_user_id krävs som samma verifierade UUID. OPS committar canonical kund, kundnummer, site/mätpunkt, avtal, juridik, portalidentitet, workflow och ett beständigt customer_application_continuation-jobb. status=accepted betyder att denna beständiga commit är klar; e-post, anläggningsuppslag, leverantörsbyte och webhooks fortsätter asynkront och följs via statusendpointen.'
}
if (website.paths['/api/v1/website/customer-applications/{application_id}']) {
  website.paths['/api/v1/website/customer-applications/{application_number}'] =
    website.paths['/api/v1/website/customer-applications/{application_id}']
  delete website.paths['/api/v1/website/customer-applications/{application_id}']
}
const applicationStatusPath = website.paths['/api/v1/website/customer-applications/{application_number}']
if (applicationStatusPath?.get) {
  applicationStatusPath.get.description =
    'Scope: website_switch_status.read. application_number is resolved strictly inside the API-key tenant. Internal database UUIDs are never accepted or returned.'
  applicationStatusPath.get.parameters = (applicationStatusPath.get.parameters ?? []).map((parameter) => {
    if (parameter?.in === 'path') {
      return { ...parameter, name: 'application_number', required: true, schema: string }
    }
    return parameter
  })
}
const applicationAutomationStatus = closedObject({
  status: string,
  attempts: { type: 'integer', minimum: 0 },
  max_attempts: { type: 'integer', minimum: 0 },
  next_retry_at: nullableString,
  completed_at: nullableString,
  last_error: nullableString,
}, ['status', 'attempts', 'max_attempts'])
const applicationCommunicationEntry = closedObject({
  event_type: nullableString,
  status: string,
  occurred_at: nullableString,
  message: nullableString,
}, ['event_type', 'status'])
const applicationCommunicationStatus = closedObject({
  pending: { type: 'boolean' },
  source_of_truth: { type: 'string', const: 'communication_logs' },
  triggered: { type: 'array', items: applicationCommunicationEntry },
  queued: { type: 'array', items: applicationCommunicationEntry },
  sent: { type: 'array', items: applicationCommunicationEntry },
  failed: { type: 'array', items: applicationCommunicationEntry },
}, ['pending', 'source_of_truth', 'triggered', 'queued', 'sent', 'failed'])
const applicationWebhookStatus = closedObject({
  status: { type: 'string', enum: ['not_triggered', 'not_configured', 'pending', 'sent', 'failed'] },
  fanout_status: { type: 'string', enum: ['not_started', 'pending', 'completed', 'failed'] },
  queued: { type: 'integer', minimum: 0 },
  sent: { type: 'integer', minimum: 0 },
  failed: { type: 'integer', minimum: 0 },
  attempts: { type: 'integer', minimum: 0 },
  next_retry_at: nullableString,
  last_error: nullableString,
  updated_at: nullableString,
}, ['status', 'fanout_status', 'queued', 'sent', 'failed', 'attempts'])
const canonicalApplicationStatusProperties = {
  application_number: string,
  status: { type: 'string', enum: ['processing', 'accepted', 'needs_customer_information', 'rejected', 'failed', 'completed'] },
  stage: string,
  customer_number: nullableString,
  contract_status: nullableString,
  supplier_switch_status: string,
  supply_status: nullableString,
  requested_start_date: nullableString,
  confirmed_start_date: nullableString,
  missing_customer_action: { type: 'boolean' },
  next_step: nullableString,
  blocking_reason: nullableString,
  automation: applicationAutomationStatus,
  communication: applicationCommunicationStatus,
  webhook: applicationWebhookStatus,
  updated_at: nullableString,
}
const canonicalApplicationStatusRequired = [
  'application_number', 'status', 'stage', 'supplier_switch_status',
  'missing_customer_action', 'automation', 'communication', 'webhook',
]
if (website.components.schemas.CustomerApplicationStatus) {
  website.components.schemas.CustomerApplicationStatus = closedObject(
    canonicalApplicationStatusProperties,
    canonicalApplicationStatusRequired,
  )
}
website.components.schemas.WebsiteCustomerApplicationStatusData = closedObject(
  canonicalApplicationStatusProperties,
  canonicalApplicationStatusRequired,
)
if (applicationStatusPath?.get) {
  setResponse(
    website,
    '/api/v1/website/customer-applications/{application_number}',
    envelope({ $ref: '#/components/schemas/WebsiteCustomerApplicationStatusData' }),
  )
}

if (website.components.schemas.WebsiteEnergyAreaResolveResponse) {
  website.components.schemas.WebsiteEnergyAreaResolveResponse.properties.contract_schema_version = contractVersion
  website.components.schemas.WebsiteEnergyAreaResolveResponse.required = Array.from(new Set([
    ...(website.components.schemas.WebsiteEnergyAreaResolveResponse.required ?? []),
    'contract_schema_version',
  ]))
}

for (const [path, scopes] of [
  ['/api/v1/integration/context', ['integration_context.read']],
  ['/api/v1/website/switch-status', ['website_switch_status.read']],
]) {
  const operation = website.paths[path]?.get
  if (!operation) continue
  operation.security = [{ bearerAuth: scopes }]
  operation['x-required-scopes'] = scopes
}
const legalOperation = website.paths['/api/v1/website/legal-bundle']?.get
if (legalOperation) {
  legalOperation.security = [
    { bearerAuth: ['website_legal.read'] },
    { bearerAuth: ['website_contracts.read'] },
  ]
  legalOperation['x-required-scopes'] = ['website_legal.read', 'website_contracts.read']
  legalOperation['x-scope-mode'] = 'any'
  legalOperation['x-scope-requirement'] = {
    anyOf: ['website_legal.read', 'website_contracts.read'],
  }
}

const eventIdentity = closedObject({
  external_customer_id: string,
  customer_number: string,
  auth_user_id: uuid,
  customer_portal_user_id: uuid,
  email: { type: 'string', format: 'email' },
})
const customerEventRequest = closedObject({
  event_type: { type: 'string', pattern: '^customer\\.[a-z0-9_]+$' },
  event_reference: { type: 'string', minLength: 1, maxLength: 200 },
  occurred_at: dateTime,
  customer: eventIdentity,
  subject: closedObject({ type: string, reference: string }, ['type']),
  data: { type: 'object' },
  metadata: { type: 'object' },
}, ['event_type', 'event_reference', 'occurred_at', 'customer', 'subject', 'data'])
const customerEventData = closedObject({
  event_reference: string,
  event_resource_reference: publicReferenceSchema,
  event_type: string,
  customer_reference: nullableString,
  status: { type: 'string', const: 'accepted' },
  occurred_at: dateTime,
  replayed: { type: 'boolean' },
}, ['event_reference', 'event_resource_reference', 'event_type', 'customer_reference', 'status', 'occurred_at', 'replayed'])
website.components.schemas.WebsiteCustomerEventIdentity = eventIdentity
website.components.schemas.WebsiteCustomerEventRequest = customerEventRequest
website.components.schemas.WebsiteCustomerEventData = customerEventData
setRequest(website, '/api/v1/website/customer-events', { $ref: '#/components/schemas/WebsiteCustomerEventRequest' })
setResponse(website, '/api/v1/website/customer-events', envelope({ $ref: '#/components/schemas/WebsiteCustomerEventData' }), 'post')

portal.components.schemas.CustomerNotificationReadRequest = closedObject({
  notification_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: uuid },
}, ['notification_ids'])
portal.components.schemas.CustomerNotificationReadData = closedObject({
  data: { type: 'array', items: closedObject({ id: uuid, status: string, read_at: dateTime }, ['id', 'status', 'read_at']) },
  updated_count: { type: 'integer', minimum: 0 },
}, ['data', 'updated_count'])
setRequest(portal, '/api/v1/customer/notifications/read', { $ref: '#/components/schemas/CustomerNotificationReadRequest' })
setResponse(portal, '/api/v1/customer/notifications/read', envelope({
  $ref: '#/components/schemas/CustomerNotificationReadData',
}), 'post')

portal.components.schemas.CustomerProfile = {
  ...closedObject({
  first_name: string,
  last_name: string,
  full_name: string,
  company_name: string,
  email: { type: 'string', format: 'email' },
  phone: string,
  invoice_email: { type: 'string', format: 'email' },
  language_code: string,
  timezone: string,
  }),
  minProperties: 1,
}
const customerFacilityAddress = {
  ...closedObject({
    street: string,
    postal_code: string,
    city: string,
    country: string,
    care_of: string,
    apartment_number: string,
  }),
  minProperties: 1,
}
portal.components.schemas.CustomerFacilityUpdate = closedObject({
  facility_reference: string,
  address: customerFacilityAddress,
  external_request_id: string,
}, ['facility_reference', 'address'])
portal.components.schemas.CustomerProfileUpdateRequest = {
  type: 'object',
  additionalProperties: false,
  anyOf: [{ required: ['profile'] }, { required: ['facility_data'] }],
  properties: {
    profile: { $ref: '#/components/schemas/CustomerProfile' },
    facility_data: { $ref: '#/components/schemas/CustomerFacilityUpdate' },
    metadata: { type: 'object' },
  },
}
portal.components.schemas.CustomerProfileUpdateData = closedObject({
  completion_reference: string,
  status: string,
  created_at: dateTime,
  profile_updated: { type: 'boolean' },
  facility_updated: { type: 'boolean' },
  address_result: { type: ['object', 'null'] },
}, ['completion_reference', 'status', 'created_at', 'profile_updated', 'facility_updated', 'address_result'])
setRequest(portal, '/api/v1/customer/profile-update', { $ref: '#/components/schemas/CustomerProfileUpdateRequest' })
setResponse(portal, '/api/v1/customer/profile-update', envelope({ $ref: '#/components/schemas/CustomerProfileUpdateData' }), 'post')
const profileOperation = portal.paths['/api/v1/customer/profile-update']?.post
if (profileOperation) {
  profileOperation.security = [
    { bearerAuth: ['customer_contact.write'] },
    { bearerAuth: ['customer_facility_data.write'] },
  ]
  profileOperation['x-required-scopes'] = ['customer_contact.write', 'customer_facility_data.write']
  profileOperation['x-scope-mode'] = 'any-per-request; both required when both operations are present'
  profileOperation['x-scope-requirement'] = {
    anyOf: ['customer_contact.write', 'customer_facility_data.write'],
    allOfWhenBothPayloadSectionsArePresent: [
      'customer_contact.write',
      'customer_facility_data.write',
    ],
  }
}

portal.components.schemas.CustomerEventIdentity = eventIdentity
portal.components.schemas.CustomerEventRequest = customerEventRequest
portal.components.schemas.CustomerEventData = customerEventData
portal.components.schemas.PublicDomainEvent = closedObject({
  event_id: string,
  event_type: string,
  created_at: dateTime,
  tenant_reference: string,
  environment: { type: ['string', 'null'], enum: ['test', 'production', null] },
  aggregate: closedObject({ type: string, reference: string }, ['type', 'reference']),
  customer: closedObject({ customer_reference: nullableString, customer_number: nullableString }),
  data: { type: 'object' },
  contract_schema_version: contractVersion,
}, ['event_id', 'event_type', 'created_at', 'tenant_reference', 'environment', 'aggregate', 'data', 'contract_schema_version'])
portal.components.schemas.DomainEventListData = {
  type: 'array',
  items: { $ref: '#/components/schemas/PublicDomainEvent' },
}
setRequest(portal, '/api/v1/events', { $ref: '#/components/schemas/CustomerEventRequest' }, 'post')
setResponse(portal, '/api/v1/events', envelope({ $ref: '#/components/schemas/CustomerEventData' }), 'post')
setResponse(portal, '/api/v1/events', {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'next_before', 'request_id', 'contract_schema_version'],
  properties: {
    data: { $ref: '#/components/schemas/DomainEventListData' },
    next_before: nullableString,
    request_id: string,
    correlation_id: nullableString,
    contract_schema_version: contractVersion,
  },
}, 'get')
const eventsGet = portal.paths['/api/v1/events']?.get
if (eventsGet) {
  const queryNames = new Set(['event_type', 'external_customer_id', 'before', 'limit'])
  eventsGet.parameters = [
    ...(eventsGet.parameters ?? []).filter((parameter) =>
      !(parameter?.in === 'query' && queryNames.has(parameter?.name)),
    ),
    { name: 'event_type', in: 'query', required: false, schema: { type: 'string', pattern: '^customer\\.[a-z0-9_]+$' } },
    { name: 'external_customer_id', in: 'query', required: false, schema: string },
    { name: 'before', in: 'query', required: false, schema: dateTime },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
  ]
}

website.components.parameters = website.components.parameters ?? {}
website.components.parameters.IdempotencyKey = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: {
    type: 'string',
    minLength: 8,
    maxLength: 200,
    pattern: '^[A-Za-z0-9._:+~-]+$',
  },
}
ensureParameterRef(
  website.paths['/api/v1/website/customer-events']?.post,
  '#/components/parameters/IdempotencyKey',
)


function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function ensureVersionedOpenApiRoutes() {
  const websiteCurrent = website.paths['/api/v1/openapi/website-integration-v1.json']
  const portalCurrent = website.paths['/api/v1/openapi/customer-portal-v1.json']
  if (websiteCurrent) {
    website.paths[`/api/v1/openapi/${priorVersion}/website-integration-v1.json`] = clone(websiteCurrent)
    website.paths[`/api/v1/openapi/${version}/website-integration-v1.json`] = clone(websiteCurrent)
  }
  if (portalCurrent) {
    website.paths[`/api/v1/openapi/${priorVersion}/customer-portal-v1.json`] = clone(portalCurrent)
    website.paths[`/api/v1/openapi/${version}/customer-portal-v1.json`] = clone(portalCurrent)
  }
  const portalDocumentCurrent = portal.paths['/api/v1/openapi/customer-portal-v1.json']
  if (portalDocumentCurrent) {
    portal.paths[`/api/v1/openapi/${priorVersion}/customer-portal-v1.json`] = clone(portalDocumentCurrent)
    portal.paths[`/api/v1/openapi/${version}/customer-portal-v1.json`] = clone(portalDocumentCurrent)
  }
}

function movePublicationWebhookToTopLevel() {
  const pathItem = website.paths['/webhooks/contracts.publication.changed']
  if (!pathItem) return
  delete website.paths['/webhooks/contracts.publication.changed']
  const webhook = clone(pathItem)
  const operation = webhook.post
  if (operation) {
    operation.summary = 'Receive contracts.publication.changed from Gridex'
    operation.description = 'This callback URL is hosted by the tenant, not by app.gridex.se. Gridex signs the exact raw request body with HMAC-SHA256 over `${timestamp}.${rawBody}`. Verify timestamp freshness and X-Gridex-Signature, then deduplicate X-Gridex-Event-Id and X-Gridex-Delivery-Id before returning any 2xx response. Non-2xx responses enter the documented retry and dead-letter pipeline.'
    operation.security = []
    delete operation['x-required-scopes']
    delete operation['x-scope-mode']
    operation.parameters = [
      { name: 'X-Gridex-Event-Id', in: 'header', required: true, schema: { type: 'string', pattern: '^event_[a-f0-9]{32}$' } },
      { name: 'X-Gridex-Delivery-Id', in: 'header', required: true, schema: { type: 'string', pattern: '^delivery_[a-f0-9]{32}$' } },
      { name: 'X-Gridex-Timestamp', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'X-Gridex-Signature', in: 'header', required: true, schema: { type: 'string', pattern: '^sha256=[a-f0-9]{64}$' } },
    ]
    operation.responses = {
      '2XX': { description: 'Event accepted and durably deduplicated by the tenant receiver.' },
    }
  }
  website.webhooks = website.webhooks ?? {}
  website.webhooks.contractsPublicationChanged = webhook
}

function staticDocumentHeaders() {
  return {
    'X-Gridex-Contract-Version': { $ref: '#/components/headers/GridexContractVersion' },
    'X-Request-ID': { $ref: '#/components/headers/RequestId' },
    ETag: { $ref: '#/components/headers/ETag' },
    Vary: { $ref: '#/components/headers/Vary' },
    'Cache-Control': { $ref: '#/components/headers/CacheControl' },
    'Content-Type': { $ref: '#/components/headers/ContentType' },
    'Content-Disposition': { $ref: '#/components/headers/ContentDisposition' },
  }
}

function normalizePublicOpenApiDocumentOperations(document) {
  const paths = [
    '/api/v1/openapi/release-manifest.json',
    '/api/v1/openapi/website-integration-v1.json',
    '/api/v1/openapi/customer-portal-v1.json',
    ...publishedVersions.flatMap((publishedVersion) => [
      `/api/v1/openapi/${publishedVersion}/website-integration-v1.json`,
      `/api/v1/openapi/${publishedVersion}/customer-portal-v1.json`,
    ]),
  ]
  for (const path of paths) {
    const operation = document.paths?.[path]?.get
    if (!operation) continue
    operation.security = []
    operation['x-required-scopes'] = []
    const response200 = operation.responses?.['200']
    if (response200 && !response200.$ref) response200.headers = staticDocumentHeaders()
    operation.responses = operation.responses ?? {}
    operation.responses['304'] = {
      description: 'Not Modified. The supplied If-None-Match value matches the current ETag.',
      headers: staticDocumentHeaders(),
    }
  }
}

ensureVersionedOpenApiRoutes()
movePublicationWebhookToTopLevel()

for (const document of [website, portal]) {
  dedupeOperationParameters(document)
  ensureSecurityFromScopeExtensions(document)
  ensureCanonicalErrorResponses(document)
  ensureStandardHeaders(document)
  normalizePublicOpenApiDocumentOperations(document)
  removeMisappliedLegalDescription(document)
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

// Re-normalize after late example assignment so fixture/example versions cannot
// drift from info.version / x-contract-schema-version.
for (const document of [website, portal]) {
  normalizeContractVersionMetadata(document)
}

fs.writeFileSync(websitePath, `${JSON.stringify(website, null, 2)}\n`)
fs.writeFileSync(portalPath, `${JSON.stringify(portal, null, 2)}\n`)
const hashes = {
  website: crypto
    .createHash('sha256')
    .update(`${JSON.stringify(website, null, 2)}\n`)
    .digest('hex'),
  customer_portal: crypto
    .createHash('sha256')
    .update(`${JSON.stringify(portal, null, 2)}\n`)
    .digest('hex'),
}
console.log(JSON.stringify({ version, hashes }, null, 2))
