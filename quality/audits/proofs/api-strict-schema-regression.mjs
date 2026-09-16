// Supplemental Node >=24 actual-source regression. No packages, network or DB.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isIP } from 'node:net'
import vm from 'node:vm'

const BASE = '4d4fe075198ad61b9df85aa456e40965668549dc'
const useBaseline = process.argv.includes('--baseline')

function sourceFor(path) {
  return useBaseline
    ? execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' })
    : readFileSync(path, 'utf8')
}

function actualModule(path, names, dependencies = {}) {
  const compatibleSource = sourceFor(path)
    // Node's strip-only transform does not lower parameter properties. These
    // error-only fields are not reached by this successful resolver fixture.
    .replace(/readonly (eventType|correlationId|databaseMessage|resource): string/g, '$1')
  const source = stripTypeScriptTypes(compatibleSource)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const context = vm.createContext({
    console,
    process,
    Request,
    Response,
    Headers,
    URL,
    fetch,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Buffer,
    ReadableStream,
    AsyncLocalStorage,
    setTimeout,
    clearTimeout,
    Error,
    Date,
    Map,
    Set,
    ...dependencies,
  })
  const exports = names
    .map((name) => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`)
    .join(',')
  vm.runInContext(`${source}\nglobalThis.__actualModuleExports={${exports}}`, context, {
    filename: path,
  })
  return context.__actualModuleExports
}

const state = {
  dbCalls: [],
  quoteCalls: [],
  validateCalls: [],
  partnerQuoteCalls: [],
  authCalls: [],
}

function reset() {
  state.dbCalls = []
  state.quoteCalls = []
  state.validateCalls = []
  state.partnerQuoteCalls = []
  state.authCalls = []
}

function database() {
  return {
    from(table) {
      const call = { table, operation: 'select', payload: null, filters: {} }
      const finish = async () => {
        state.dbCalls.push({ ...call, filters: { ...call.filters } })
        if (table === 'customer_portal_write_idempotency') {
          return { data: { id: 'portal-idempotency-1' }, error: null }
        }
        if (table === 'integration_api_write_idempotency') {
          return { data: { id: 'integration-idempotency-1' }, error: null }
        }
        if (table === 'customer_notifications') {
          return call.operation === 'update'
            ? { data: [{ id: 'notification-row-1' }], error: null }
            : { data: [{ id: 'notification-row-1' }], error: null }
        }
        if (table === 'platform_runtime_readiness') {
          return {
            data: {
              is_ready: true,
              schema_version: '20260803093300-gridex-runtime-readiness-v3',
              schema_fingerprint: 'a'.repeat(64),
              blocking_issues: [],
              capabilities: {},
            },
            error: null,
          }
        }
        if (table === 'tenant_portal_customer_links') {
          return {
            data: {
              id: 'portal-link-A',
              company_id: 'company-A',
              customer_id: 'customer-A',
              provider: 'fixture',
              external_customer_id: 'customer-external-A',
              status: 'active',
            },
            error: null,
          }
        }
        if (table === 'customers') {
          return {
            data: {
              id: 'customer-A',
              company_id: 'company-A',
              customer_number: '10001',
              external_customer_id: 'customer-external-A',
              customer_type: 'private',
              status: 'active',
              full_name: 'Test Customer',
              email: 'customer@example.test',
            },
            error: null,
          }
        }
        if (table === 'customer_profiles') return { data: null, error: null }
        if (table === 'platform_postal_code_grid_mappings') {
          return {
            data: [{
              postal_code: '11122',
              city: 'Stockholm',
              grid_area_code: 'STH',
              price_area: 'SE3',
              confidence: 1,
              source: 'fixture-catalog',
              updated_at: '2026-09-12T00:00:00.000Z',
            }],
            error: null,
            count: 1,
          }
        }
        if (table === 'platform_grid_areas') {
          const row = {
            id: 'platform-grid-area-A',
            grid_area_code: 'STH',
            grid_area_name: 'Stockholm',
            grid_owner_id: 'platform-grid-owner-A',
            grid_owner_name: 'Grid owner',
            price_area: 'SE3',
            platform_grid_owners: {
              name: 'Grid owner',
              ops_grid_owner_id: 'grid-owner-A',
            },
          }
          return {
            data: Array.isArray(call.filters.grid_area_code) ? [row] : row,
            error: null,
          }
        }
        if (table === 'gridex_verified_grid_owners_v') {
          return {
            data: [{
              grid_owner_id: 'grid-owner-A',
              name: 'Grid owner',
              verification_status: 'verified',
              certificate_status: 'finns',
              verified_for_customer_flow: true,
              can_use_for_prodat: true,
              can_use_for_utilts: true,
              can_start_supplier_switch: true,
              verification_reasons: [],
            }],
            error: null,
          }
        }
        if (table === 'customer_site_resolution') {
          if (call.operation === 'insert') {
            return { data: { id: '00000000-0000-4000-8000-000000000001' }, error: null }
          }
          return {
            data: {
              id: '00000000-0000-4000-8000-000000000001',
              company_id: 'company-A',
              price_area: 'SE3',
              price_area_assurance_status: 'estimated',
              price_area_assurance_source: 'postal_consensus',
              price_area_assurance_confidence: 0.85,
              price_area_candidate_count: 1,
              price_area_unique_count: 1,
              price_area_evidence: {},
              resolution_status: 'postal_suggested',
              confidence: 0.85,
              expires_at: '2030-09-12T00:00:00.000Z',
              resolver_version: 'energy-resolver-v2',
              source_chain: ['postal_code', 'platform_postal_code_grid_mappings'],
            },
            error: null,
          }
        }
        if (table === 'canonical_public_contract_diagnostics_v') {
          return {
            data: [{ offer_reference: 'offer-fixture', customer_type: 'both' }],
            error: null,
          }
        }
        return { data: null, error: null }
      }
      const query = {
        select() { return query },
        insert(payload) { call.operation = 'insert'; call.payload = payload; return query },
        update(payload) { call.operation = 'update'; call.payload = payload; return query },
        eq(field, value) { call.filters[field] = value; return query },
        is(field, value) { call.filters[field] = value; return query },
        in(field, value) { call.filters[field] = value; return query },
        not(field, operator, value) { call.filters[field] = { operator, value }; return query },
        or() { return query },
        order() { return query },
        range() { return query },
        limit() { return query },
        maybeSingle: finish,
        single: finish,
        then(resolve, reject) { return finish().then(resolve, reject) },
      }
      return query
    },
  }
}

const supabaseService = {
  ...database(),
  async rpc(name, input) {
    if (name !== 'authenticate_integration_request_v1') {
      return { data: null, error: null }
    }
    state.authCalls.push({ name, input })
    return {
      data: {
        auth_outcome: 'allowed',
        error_code: null,
        tenant_status: 'active',
        client_id: 'client-A',
        company_id: 'company-A',
        client_name: 'Fixture client',
        client_status: 'active',
        key_prefix: 'prefix',
        secret_hash: 'hash',
        scopes: [
          'customer_notifications.write',
          'website_quotes.write',
          'website_quotes.validate',
        ],
        allowed_ips: [],
        allowed_origins: [],
        metadata: { partner_default_offer_reference: 'offer-fixture' },
        rate_limit_per_minute: 100,
        expires_at: null,
        request_count: 1,
        route_limit: 100,
        reset_at: '2026-09-12T00:01:00.000Z',
      },
      error: null,
    }
  },
}
const idempotencyKeyPolicy = actualModule(
  'lib/api/idempotencyKey.ts',
  ['isValidIdempotencyKey'],
)
const requestBody = async (request) => ({ ok: true, text: await request.text() })
const strict = actualModule(
  'lib/api/strictRequest.ts',
  ['ApiInputError', 'readJsonObject', 'executeIdempotentPortalWrite'],
  {
    createHash,
    supabaseService,
    isValidIdempotencyKey: idempotencyKeyPolicy.isValidIdempotencyKey,
    readTextBodyWithLimit: requestBody,
  },
)
const integrationIdempotency = actualModule(
  'lib/integrations/writeIdempotency.ts',
  [
    'IntegrationWriteIdempotencyError',
    'claimIntegrationWriteIdempotency',
    'completeIntegrationWriteIdempotency',
    'failIntegrationWriteIdempotency',
  ],
  {
    createHash,
    supabaseService,
    isValidIdempotencyKey: idempotencyKeyPolicy.isValidIdempotencyKey,
  },
)

const readinessPolicy = actualModule(
  'lib/platform/schemaReadiness.ts',
  ['assertPlatformSchemaReady'],
  { supabaseService },
)
const ipPolicy = actualModule(
  'lib/integrations/ipPolicy.ts',
  ['ipAllowedByRules', 'trustedClientIp'],
  { isIP },
)
const tenantPolicy = actualModule(
  'lib/tenant/context.ts',
  ['tenantContextForIntegration'],
  { randomUUID },
)
const routePolicy = actualModule(
  'lib/api/publicRouteRegistry.ts',
  ['publicRouteCost'],
)
const secretPolicy = actualModule(
  'lib/integrations/apiClientSecrets.ts',
  ['hashIntegrationApiSecret'],
  { createHash },
)
const authPolicy = actualModule(
  'lib/integrations/apiAuth.ts',
  [
    'currentIntegrationApiResponseContext',
    'integrationCredential',
    'logIntegrationApiRequest',
    'requireIntegrationApiAccess',
  ],
  {
    AsyncLocalStorage,
    after: () => {},
    supabaseService,
    hashIntegrationApiSecret: secretPolicy.hashIntegrationApiSecret,
    assertPlatformSchemaReady: readinessPolicy.assertPlatformSchemaReady,
    ipAllowedByRules: ipPolicy.ipAllowedByRules,
    trustedClientIp: ipPolicy.trustedClientIp,
    tenantContextForIntegration: tenantPolicy.tenantContextForIntegration,
    publicRouteCost: routePolicy.publicRouteCost,
  },
)
const apiErrorPolicy = actualModule(
  'lib/api/apiError.ts',
  ['canonicalApiError', 'normalizeApiBlockers'],
  { WEBSITE_INTEGRATION_CONTRACT_VERSION: '2026-08-22.2' },
)
const publicPayloadPolicy = actualModule(
  'lib/api/publicPayloadSafety.ts',
  ['assertPublicResponsePayload'],
)
const publicReferencePolicy = actualModule(
  'lib/integrations/publicReferences.ts',
  ['isPublicReference', 'publicReference'],
  { createHash },
)
const canonicalEnergyPolicy = actualModule(
  'lib/energy/canonicalEnergyEvents.ts',
  ['recordCanonicalEnergyEvent'],
  { randomUUID, supabaseService },
)
const gridOwnerPolicy = actualModule(
  'lib/grid-owners/verification.ts',
  ['getGridOwnerVerification'],
  { supabaseService },
)
const addressPolicy = actualModule(
  'lib/energy/address.ts',
  ['normaliseSwedishAddress'],
)
const energyResolverPolicy = actualModule(
  'lib/energy/resolver.ts',
  ['resolveEnergyContext'],
  {
    supabaseService,
    recordCanonicalEnergyEvent: canonicalEnergyPolicy.recordCanonicalEnergyEvent,
    normaliseSwedishAddress: addressPolicy.normaliseSwedishAddress,
    getGridOwnerVerification: gridOwnerPolicy.getGridOwnerVerification,
  },
)
const customerResolverPolicy = actualModule(
  'lib/customer-portal/customerResolver.ts',
  ['portalIdentifiersFromRequest', 'resolvePortalCustomer'],
  { supabaseService },
)
const NextResponse = { json }
const customerPortalPolicy = actualModule(
  'lib/customer-portal/externalApi.ts',
  [
    'customerPortalJson',
    'handleCustomerPortalRouteError',
    'logCustomerPortalSuccess',
    'requireCustomerPortalApiContext',
  ],
  {
    randomUUID,
    NextResponse,
    ...authPolicy,
    ...customerResolverPolicy,
    WEBSITE_INTEGRATION_CONTRACT_VERSION: '2026-08-22.2',
    ...apiErrorPolicy,
    ApiInputError: strict.ApiInputError,
    assertPublicResponsePayload: publicPayloadPolicy.assertPublicResponsePayload,
  },
)

class OfferQuoteError extends Error {
  constructor(message, code, status = 422, field, details) {
    super(message)
    this.code = code
    this.status = status
    this.field = field
    this.details = details
  }
}

class WebsiteQuoteValidationError extends Error {
  constructor(input) {
    super(input.message)
    this.code = input.code
    this.status = input.status ?? 422
    this.field = input.field ?? 'quote_reference'
    this.details = input.details
  }
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function request(url, raw, headers = {}) {
  const value = new Request(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer integration-token',
      'content-type': 'application/json',
      'idempotency-key': 'task-10b1-key',
      ...headers,
    },
    body: raw,
  })
  Object.defineProperty(value, 'nextUrl', { value: new URL(value.url) })
  return value
}

const notificationReference = publicReferencePolicy.publicReference(
  'notification',
  'company-A',
  'notification-row-1',
)

const notification = actualModule(
  'app/api/v1/customer/notifications/read/route.ts',
  ['POST'],
  {
    ...strict,
    supabaseService,
    ...publicReferencePolicy,
    ...customerPortalPolicy,
  },
)

const quoteResult = {
  quote_reference: 'quote-fixture',
  offer_reference: 'offer-fixture',
  input: { price_area: 'SE3' },
}
const quote = actualModule(
  'app/api/v1/website/quote/route.ts',
  ['POST'],
  {
    randomUUID: () => 'quote-request',
    scheduleUsageEvent: async () => {},
    customerPortalJson: customerPortalPolicy.customerPortalJson,
    readJsonWithLimit: async (value) => ({ ok: true, body: JSON.parse(await value.text()) }),
    ...authPolicy,
    ...integrationIdempotency,
    calculateOfferQuote: async (input) => { state.quoteCalls.push(input); return quoteResult },
    OfferQuoteError,
    projectPublicWebsiteQuoteEnvelope: (value) => value,
    PublicWebsiteQuoteProjectionError: class extends Error {},
    WebsiteQuoteValidationError,
    canonicalApiError: apiErrorPolicy.canonicalApiError,
    INVOICE_DELIVERY_METHODS: ['email', 'e_invoice', 'paper', 'direct_debit'],
  },
)

const validatedQuote = {
  quote_reference: 'quote-fixture',
  offer_reference: 'offer-fixture',
  valid_until: '9999-12-31T23:59:59.999Z',
  status: 'active',
  energy_resolution_id: '00000000-0000-4000-8000-000000000001',
  resolver_version: 'fixture',
  geodata_version: 'fixture',
  market_reference: {},
  energy_direction: 'consumption',
  quote_snapshot: {},
  price_option_reference: 'option-fixture',
  area_price_reference: null,
  invoice_delivery_method: 'email',
  selected_component_references: [],
  mandatory_component_references: [],
  conditional_component_references: [],
  site_count: 1,
}
const validate = actualModule(
  'app/api/v1/website/quote/validate/route.ts',
  ['POST'],
  {
    randomUUID: () => 'validate-request',
    customerPortalJson: customerPortalPolicy.customerPortalJson,
    readJsonWithLimit: async (value) => ({ ok: true, body: JSON.parse(await value.text()) }),
    ...authPolicy,
    normalizeExternalCustomerType: () => ({ ok: true, value: 'private' }),
    projectPublicMarketReference: (value) => value,
    validateWebsiteQuote: async (input) => { state.validateCalls.push(input); return validatedQuote },
    WebsiteQuoteValidationError,
    resolvePublicContractOffer: async () => ({ id: 'offer-row' }),
    canonicalApiError: apiErrorPolicy.canonicalApiError,
    supabaseService,
  },
)

const partner = actualModule(
  'lib/partner-api/business.ts',
  ['handleBusinessPartnerApi'],
  {
    randomUUID,
    NextResponse: { json },
    ...strict,
    ...authPolicy,
    hashIntegrationApiSecret: secretPolicy.hashIntegrationApiSecret,
    EnergyResolutionBindingError: class extends Error {},
    resolveEnergyContext: energyResolverPolicy.resolveEnergyContext,
    calculateOfferQuote: async (input) => { state.partnerQuoteCalls.push(input); return {
      ...quoteResult,
      valid_until: '9999-12-31T23:59:59.999Z',
      estimate: { monthly_inc_vat: 100, monthly_ex_vat: 80, monthly_vat: 20, annual_ex_vat: 960, annual_vat: 240, annual_inc_vat: 1200 },
      lines: [], offer: {}, warnings: [], assumptions: [],
    } },
    OfferQuoteError,
    CurrentMarketPriceError: class extends Error {},
    loadCurrentMarketPrice: async () => ({}),
    supabaseService,
    stockholmDateForInstant: () => '2026-09-15',
    PARTNER_API_VERSION: '2026-08-22.2',
    handleSimplePartnerApi: async () => null,
  },
)

const quoteBody = {
  resolution_id: '00000000-0000-4000-8000-000000000001',
  offer_reference: 'offer-fixture',
  customer_type: 'private',
  annual_consumption_kwh: 3500,
  start_date: '2026-09-15',
  price_option_reference: 'option-fixture',
  invoice_delivery_method: 'email',
  selected_component_references: [],
  site_count: 1,
}
const validationBody = { quote_reference: 'quote-fixture', ...quoteBody }

const results = []
async function check(name, action) {
  try {
    await action()
    results.push({ name, passed: true })
  } catch (error) {
    results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) })
  }
}

function assertSingleAuthentication(expectedScope, mode = 'all') {
  assert.equal(state.authCalls.length, 1)
  const input = state.authCalls[0].input
  const scopes = Array.from(
    mode === 'any' ? input.p_required_any : input.p_required_all,
  )
  assert.ok(scopes.includes(expectedScope))
}

await check('notification rejects changed ignored fields under one key before claim', async () => {
  reset()
  for (const unexpected of [true, false]) {
    const response = await notification.POST(request(
      'https://app.gridex.se/api/v1/customer/notifications/read',
      JSON.stringify({ notification_references: [notificationReference], unexpected }),
      { 'x-gridex-external-customer-id': 'customer-external-A' },
    ))
    const body = await response.json()
    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'unknown_field')
    assert.equal(body.error.field, 'unexpected')
  }
  assert.equal(state.authCalls.length, 2)
  assert.ok(state.authCalls.every((call) =>
    Array.from(call.input.p_required_all).includes('customer_notifications.write'),
  ))
  assert.equal(state.dbCalls.filter((call) => call.table === 'customer_portal_write_idempotency').length, 0)
})

await check('notification valid control reaches tenant-bound claim and update', async () => {
  reset()
  const response = await notification.POST(request(
    'https://app.gridex.se/api/v1/customer/notifications/read',
    JSON.stringify({ notification_references: [notificationReference] }),
    { 'x-gridex-external-customer-id': 'customer-external-A' },
  ))
  assert.equal(response.status, 200)
  assertSingleAuthentication('customer_notifications.write')
  assert.ok(state.dbCalls.some((call) =>
    call.table === 'tenant_portal_customer_links' &&
    call.filters.company_id === 'company-A' &&
    call.filters.external_customer_id === 'customer-external-A',
  ))
  assert.ok(state.dbCalls.some((call) => call.table === 'customer_portal_write_idempotency' && call.operation === 'insert'))
  assert.ok(state.dbCalls.some((call) => call.table === 'customer_notifications' && call.operation === 'update' && call.filters.company_id === 'company-A' && call.filters.customer_id === 'customer-A'))
})

const invalidConsumptionRaw = [
  ['numeric string', '"3500"'],
  ['comma string', '"3500,5"'],
  ['boolean', 'true'],
  ['null', 'null'],
  ['array', '[3500]'],
  ['object', '{"value":3500}'],
  ['zero', '0'],
  ['negative', '-1'],
  ['overlarge numeric token', '1e309'],
]
const invalidSiteRaw = [
  ['numeric string', '"1"'],
  ['boolean', 'true'],
  ['null', 'null'],
  ['array', '[1]'],
  ['object', '{"value":1}'],
  ['zero', '0'],
  ['negative', '-1'],
  ['fraction', '1.9'],
  ['unsafe integer', '9007199254740992'],
  ['overlarge numeric token', '1e309'],
]

for (const [name, raw] of invalidConsumptionRaw) {
  await check(`quote create rejects annual_consumption_kwh ${name} before claim/business`, async () => {
    reset()
    const body = JSON.stringify(quoteBody).replace('3500', raw)
    const response = await quote.POST(request('https://app.gridex.se/api/v1/website/quote', body))
    const payload = await response.json()
    assert.equal(response.status, 400)
    assert.equal(payload.error.code, 'invalid_quote_input')
    assert.equal(payload.error.field, 'annual_consumption_kwh')
    assertSingleAuthentication('website_quotes.write')
    assert.equal(state.quoteCalls.length, 0)
    assert.equal(state.dbCalls.filter((call) => call.table === 'integration_api_write_idempotency').length, 0)
  })
}

for (const [name, raw] of invalidSiteRaw) {
  await check(`quote create rejects site_count ${name} before claim/business`, async () => {
    reset()
    const body = JSON.stringify(quoteBody).replace('"site_count":1', `"site_count":${raw}`)
    const response = await quote.POST(request('https://app.gridex.se/api/v1/website/quote', body))
    const payload = await response.json()
    assert.equal(response.status, 400)
    assert.equal(payload.error.code, 'invalid_site_count')
    assert.equal(payload.error.field, 'site_count')
    assertSingleAuthentication('website_quotes.write')
    assert.equal(state.quoteCalls.length, 0)
    assert.equal(state.dbCalls.filter((call) => call.table === 'integration_api_write_idempotency').length, 0)
  })
}

await check('quote create valid numerical control keeps tenant-bound claim/business', async () => {
  reset()
  const response = await quote.POST(request('https://app.gridex.se/api/v1/website/quote', JSON.stringify(quoteBody)))
  assert.equal(response.status, 201)
  assertSingleAuthentication('website_quotes.write')
  assert.equal(state.quoteCalls.length, 1)
  assert.equal(state.quoteCalls[0].annualConsumptionKwh, 3500)
  assert.equal(state.quoteCalls[0].siteCount, 1)
  const claim = state.dbCalls.find((call) => call.table === 'integration_api_write_idempotency' && call.operation === 'insert')
  assert.equal(claim.payload.company_id, 'company-A')
  assert.equal(claim.payload.api_client_id, 'client-A')
})

for (const [field, cases, expectedCode] of [
  ['annual_consumption_kwh', invalidConsumptionRaw, 'invalid_quote_assertion'],
  ['site_count', invalidSiteRaw, 'invalid_quote_assertion'],
]) {
  for (const [name, raw] of cases) {
    await check(`quote validate rejects ${field} ${name} before validation I/O`, async () => {
      reset()
      const target = field === 'annual_consumption_kwh' ? '3500' : '"site_count":1'
      const replacement = field === 'annual_consumption_kwh' ? raw : `"site_count":${raw}`
      const body = JSON.stringify(validationBody).replace(target, replacement)
      const response = await validate.POST(request('https://app.gridex.se/api/v1/website/quote/validate', body))
      const payload = await response.json()
      assert.equal(response.status, 400)
      assert.equal(payload.error.code, expectedCode)
      assert.equal(payload.error.field, field)
      assertSingleAuthentication('website_quotes.validate')
      assert.equal(state.validateCalls.length, 0)
      assert.equal(state.dbCalls.filter((call) => call.table.includes('idempotency')).length, 0)
    })
  }
}

await check('quote validate valid numerical control reaches non-idempotent validation', async () => {
  reset()
  const response = await validate.POST(request('https://app.gridex.se/api/v1/website/quote/validate', JSON.stringify(validationBody)))
  assert.equal(response.status, 200)
  assertSingleAuthentication('website_quotes.validate')
  assert.equal(state.validateCalls.length, 1)
  assert.equal(state.validateCalls[0].annualConsumptionKwh, 3500)
  assert.equal(state.validateCalls[0].siteCount, 1)
  assert.equal(state.validateCalls[0].client.company_id, 'company-A')
  assert.equal(state.dbCalls.filter((call) => call.table.includes('idempotency')).length, 0)
})

for (const [name, raw] of invalidConsumptionRaw) {
  await check(`partner price rejects annual_consumption_kwh ${name} before pricing effects`, async () => {
    reset()
    const body = `{"postal_code":"11122","annual_consumption_kwh":${raw}}`
    const response = await partner.handleBusinessPartnerApi(
      request('https://app.gridex.se/api/partner/v1/price', body),
      'POST',
      ['price'],
    )
    const payload = await response.json()
    assert.equal(response.status, 422)
    assert.equal(payload.error.code, 'annual_consumption_invalid')
    assert.equal(payload.error.field, 'annual_consumption_kwh')
    assertSingleAuthentication('website_quotes.write', 'any')
    assert.equal(state.dbCalls.filter((call) => [
      'platform_postal_code_grid_mappings',
      'platform_grid_areas',
      'gridex_verified_grid_owners_v',
      'customer_site_resolution',
    ].includes(call.table)).length, 0)
    assert.equal(state.partnerQuoteCalls.length, 0)
  })
}

await check('partner price valid numerical control preserves credential company', async () => {
  reset()
  const response = await partner.handleBusinessPartnerApi(
    request('https://app.gridex.se/api/partner/v1/price', '{"postal_code":"11122","annual_consumption_kwh":3500}'),
    'POST',
    ['price'],
  )
  assert.equal(response.status, 200)
  assertSingleAuthentication('website_quotes.write', 'any')
  assert.ok(state.dbCalls.some((call) =>
    call.table === 'platform_postal_code_grid_mappings' &&
    call.filters.postal_code === '11122',
  ))
  assert.ok(state.dbCalls.some((call) =>
    call.table === 'customer_site_resolution' &&
    call.operation === 'insert' &&
    call.payload.company_id === 'company-A' &&
    call.payload.price_area === 'SE3' &&
    call.payload.price_area_assurance_status === 'estimated',
  ))
  assert.ok(state.dbCalls.some((call) =>
    call.table === 'canonical_energy_flow_events' &&
    call.operation === 'insert' &&
    call.payload.company_id === 'company-A' &&
    call.payload.event_type === 'energy_area.resolved',
  ))
  assert.equal(state.partnerQuoteCalls[0].client.company_id, 'company-A')
  assert.equal(state.partnerQuoteCalls[0].annualConsumptionKwh, 3500)
})

const failures = results.filter((result) => !result.passed)
console.log(JSON.stringify({
  mode: useBaseline ? 'baseline' : 'working-tree',
  cases: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  failures,
}, null, 2))
if (failures.length > 0) process.exitCode = 1
