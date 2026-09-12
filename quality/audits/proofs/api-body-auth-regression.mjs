import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isIP } from 'node:net'
import vm from 'node:vm'

function load(path, names, dependencies) {
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const exposed = names
    .map((name) => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`)
    .join(',')
  const context = vm.createContext({
    console, Date, Error, RangeError, TypeError, URL, Headers, Request, Response,
    ReadableStream, TextDecoder, Uint8Array, Buffer, process, structuredClone,
    setTimeout, clearTimeout, ...dependencies,
  })
  vm.runInContext(`${source}\nglobalThis.loaded = {${exposed}}`, context, { filename: path })
  return context.loaded
}

const encoder = new TextEncoder()
const EDIEL_ACTOR_ID = '00000000-0000-4000-8000-000000000001'
const state = { authCalls: 0, actorAuthCalls: 0, createCalls: [], databaseCalls: [] }

function resultFor(call) {
  state.databaseCalls.push(structuredClone(call))
  if (call.table === 'platform_runtime_readiness') {
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
  if (call.table === 'customer_portal_write_idempotency') {
    return { data: { id: 'idem-1' }, error: null }
  }
  if (call.table === 'user_profiles') return { data: null, error: null }
  if (call.table === 'company_memberships') return { data: { id: 'membership-1' }, error: null }
  if (call.table === 'companies') return { data: { id: String(call.filters.id) }, error: null }
  return { data: null, error: null }
}

function from(table) {
  const call = { table, operation: 'select', payload: null, filters: {} }
  const query = {
    select() { return query },
    insert(payload) { call.operation = 'insert'; call.payload = payload; return query },
    update(payload) { call.operation = 'update'; call.payload = payload; return query },
    upsert(payload) { call.operation = 'upsert'; call.payload = payload; return query },
    eq(column, value) { call.filters[column] = value; return query },
    is(column, value) { call.filters[column] = value; return query },
    limit() { return query },
    order() { return query },
    async maybeSingle() { return resultFor(call) },
    then(resolve, reject) { return Promise.resolve(resultFor(call)).then(resolve, reject) },
  }
  return query
}

const supabaseService = {
  from,
  auth: {
    admin: {
      async getUserById(userId) {
        state.actorAuthCalls += 1
        assert.equal(userId, EDIEL_ACTOR_ID)
        return { data: { user: { id: userId } }, error: null }
      },
    },
  },
  async rpc(name, input) {
    if (name === 'authenticate_integration_request_v1') {
      state.authCalls += 1
      const requiredAll = Array.from(input.p_required_all)
      const requiredAny = Array.from(input.p_required_any)
      if (requiredAll.length > 0) {
        assert.deepEqual(requiredAll, ['partner_webhooks.manage'])
      } else {
        assert.ok(requiredAny.includes('website_quotes.write'))
      }
      assert.equal(input.p_rate_limit_cost, 10)
      assert.equal(input.p_client_ip, null)
      return {
        data: {
          auth_outcome: 'allowed', error_code: null, tenant_status: 'active',
          client_id: 'client-A', company_id: 'company-A', client_name: 'A',
          client_status: 'active', key_prefix: 'prefix', secret_hash: 'hash',
          scopes: ['partner_webhooks.manage'], allowed_ips: [], allowed_origins: [],
          metadata: {}, rate_limit_per_minute: 20, expires_at: null,
          request_count: 20, route_limit: 20, reset_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      }
    }
    if (name === 'gridex_create_partner_webhook_subscription_v1') {
      state.createCalls.push(input)
      return { data: { webhook_subscription_reference: 'webhook-public-reference' }, error: null }
    }
    return { data: null, error: null }
  },
}

const bounded = load('lib/http/boundedRequestBody.ts', ['InvalidRequestBodyLimitError', 'readTextBodyWithLimit'], {})
const idempotencyPolicy = load('lib/api/idempotencyKey.ts', ['isValidIdempotencyKey'], {})
const strict = load('lib/api/strictRequest.ts', [
  'ApiInputError', 'executeIdempotentPortalWrite', 'readJsonObject',
], {
  createHash, supabaseService, isValidIdempotencyKey: idempotencyPolicy.isValidIdempotencyKey,
  readTextBodyWithLimit: bounded.readTextBodyWithLimit,
})
const readinessPolicy = load('lib/platform/schemaReadiness.ts', ['assertPlatformSchemaReady'], { supabaseService })
const ipPolicy = load('lib/integrations/ipPolicy.ts', ['ipAllowedByRules', 'trustedClientIp'], { isIP })
const tenantPolicy = load('lib/tenant/context.ts', ['tenantContextForIntegration'], { randomUUID })
const routePolicy = load('lib/api/publicRouteRegistry.ts', ['publicRouteCost'], {})
const secretPolicy = load('lib/integrations/apiClientSecrets.ts', ['hashIntegrationApiSecret'], { createHash })
const auth = load('lib/integrations/apiAuth.ts', [
  'logIntegrationApiRequest', 'requireIntegrationApiAccess',
], {
  AsyncLocalStorage,
  after: () => {},
  supabaseService,
  hashIntegrationApiSecret: secretPolicy.hashIntegrationApiSecret,
  assertPlatformSchemaReady: readinessPolicy.assertPlatformSchemaReady,
  ipAllowedByRules: ipPolicy.ipAllowedByRules,
  trustedClientIp: ipPolicy.trustedClientIp,
  tenantContextForIntegration: tenantPolicy.tenantContextForIntegration,
  publicRouteCost: routePolicy.publicRouteCost,
})
const publicTarget = load('lib/integrations/publicWebhookTransport.ts', [
  'assertPublicWebhookTarget', 'isDisallowedWebhookAddress', 'parsePublicWebhookUrl',
], {
  isIP,
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
  httpsRequest: () => { throw new Error('not used') },
})
const publicPayloadPolicy = load('lib/api/publicPayloadSafety.ts', ['assertPublicResponsePayload'], {})
const NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
  },
}
const shared = {
  createHash, randomUUID, NextResponse,
  ...strict, ...auth,
  assertPublicWebhookTarget: publicTarget.assertPublicWebhookTarget,
  supabaseService,
  PARTNER_API_VERSION: 'test', partnerOpenApi: {}, partnerPublicOpenApi: {},
}
const simple = load('lib/partner-api/simple.ts', ['handleSimplePartnerApi'], shared)
const business = load('lib/partner-api/business.ts', ['handleBusinessPartnerApi'], {
  ...shared,
  handleSimplePartnerApi: simple.handleSimplePartnerApi,
})
const core = load('lib/partner-api/core.ts', ['handlePartnerApi'], {
  ...shared,
  assertPublicResponsePayload: publicPayloadPolicy.assertPublicResponsePayload,
})
const canonical = load('lib/partner-api/canonical.ts', ['handleCanonicalPartnerApi'], {
  randomUUID, NextResponse, ...auth, supabaseService,
  handlePartnerApi: core.handlePartnerApi,
  PARTNER_API_VERSION: 'test',
})
const route = load('app/api/partner/v1/[[...path]]/route.ts', ['POST'], {
  NextResponse,
  handleBusinessPartnerApi: business.handleBusinessPartnerApi,
  handleSimplePartnerApi: simple.handleSimplePartnerApi,
  handleCanonicalPartnerApi: canonical.handleCanonicalPartnerApi,
  handlePartnerApi: core.handlePartnerApi,
  partnerPublicOpenApi: {}, PARTNER_API_VERSION: 'test',
})

function streamedRequest(path, raw, contentLength) {
  const bytes = encoder.encode(raw)
  let offset = 0
  let pulls = 0
  let cancels = 0
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1
      if (offset >= bytes.byteLength) return controller.close()
      const end = Math.min(offset + 1024, bytes.byteLength)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
    cancel() { cancels += 1 },
  }, { highWaterMark: 0 })
  const headers = {
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
    'idempotency-key': `idem-${path.join('-')}`,
    ...(contentLength === undefined ? {} : { 'content-length': contentLength }),
  }
  const request = new Request(`https://app.gridex.se/api/partner/v1/${path.join('/')}`, {
    method: 'POST', headers, body, duplex: 'half',
  })
  Object.defineProperty(request, 'nextUrl', { value: new URL(request.url) })
  return { request, pulls: () => pulls, cancels: () => cancels }
}

for (const path of [['webhook', 'subscription'], ['webhooks', 'subscriptions']]) {
  state.authCalls = 0
  state.createCalls = []
  const singular = path[0] === 'webhook'
  const payload = singular
    ? { webhook_event: 'CUSTOMER_CREATED', target_url: 'https://hooks.example.test/events', signing_secret: 'x'.repeat(32) }
    : { name: 'Partner events', endpoint_url: 'https://hooks.example.test/events', event_types: ['customer.created'], signing_secret: 'x'.repeat(32) }
  const streamed = streamedRequest(path, JSON.stringify(payload))
  const response = await route.POST(streamed.request, { params: Promise.resolve({ path }) })
  assert.equal(response.status, 201)
  assert.equal(state.authCalls, 1, `${path.join('/')} must consume one auth/quota unit`)
  assert.equal(state.createCalls.length, 1)
  assert.equal(state.createCalls[0].p_company_id, 'company-A')
}

for (const path of [['webhook', 'subscription'], ['webhooks', 'subscriptions']]) {
  const singular = path[0] === 'webhook'
  const targetField = singular ? 'target_url' : 'endpoint_url'
  const basePayload = singular
    ? { webhook_event: 'CUSTOMER_CREATED', signing_secret: 'x'.repeat(32) }
    : { name: 'Partner events', event_types: ['customer.created'], signing_secret: 'x'.repeat(32) }
  for (const target of ['http://127.0.0.1/internal', 'not a URL', 'https://127.0.0.1/internal']) {
    state.authCalls = 0
    state.createCalls = []
    state.databaseCalls = []
    const requestId = `public-target-${singular ? 'singular' : 'plural'}`
    const candidate = streamedRequest(path, JSON.stringify({ ...basePayload, [targetField]: target }))
    candidate.request.headers.set('x-request-id', requestId)
    const rejected = await route.POST(candidate.request, { params: Promise.resolve({ path }) })
    assert.equal(rejected.status, 422)
    assert.deepEqual(await rejected.json(), {
      error: {
        code: 'webhook_target_not_public',
        message: 'target_url must be a publicly routable HTTPS endpoint.',
      },
      request_id: requestId,
    })
    assert.deepEqual(Object.fromEntries(rejected.headers), {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-gridex-api-version': 'test',
      'x-request-id': requestId,
    })
    assert.equal(state.authCalls, 1)
    assert.equal(state.createCalls.length, 0)
    assert.equal(state.databaseCalls.filter((call) => call.table === 'customer_portal_write_idempotency').length, 0)
  }
}

for (const contentLength of [undefined, '2']) {
  state.authCalls = 0
  state.createCalls = []
  const oversized = streamedRequest(
    ['webhook', 'subscription'],
    JSON.stringify({ webhook_event: 'CUSTOMER_CREATED', target_url: 'https://hooks.example.test/events', signing_secret: 'x'.repeat(32), padding: 'x'.repeat(256_000) }),
    contentLength,
  )
  const response = await route.POST(oversized.request, { params: Promise.resolve({ path: ['webhook', 'subscription'] }) })
  assert.equal(response.status, 413)
  assert.equal(state.authCalls, 1)
  assert.equal(state.createCalls.length, 0)
  assert.ok(oversized.pulls() < 260, 'oversized stream must stop without draining')
  assert.equal(oversized.cancels(), 1)
}

let streamed
let response
state.authCalls = 0
streamed = streamedRequest(['price'], JSON.stringify({ postal_code: '11122', padding: 'x'.repeat(256_000) }), '2')
response = await route.POST(streamed.request, { params: Promise.resolve({ path: ['price'] }) })
assert.equal(response.status, 413)
assert.equal(state.authCalls, 1)
assert.equal(streamed.cancels(), 1)

const payloadLimit = load('lib/http/payloadLimit.ts', ['readJsonWithLimit'], {
  InvalidRequestBodyLimitError: bounded.InvalidRequestBodyLimitError,
  readTextBodyWithLimit: bounded.readTextBodyWithLimit,
})
const automationActorPolicy = load('lib/ediel/automationActor.ts', ['resolveConfiguredEdielAutomationActorId'], {
  supabaseService,
})

let terminalCalls = 0
const billingRoute = load('app/api/webhooks/billing/[provider]/route.ts', ['POST'], {
  NextResponse,
  internalApiError: () => NextResponse.json({ error: 'failed' }, { status: 500 }),
  BillingProviderWebhookAuthError: class extends Error {},
  receiveBillingProviderWebhook: async () => { terminalCalls += 1; return {} },
  readTextBodyWithLimit: bounded.readTextBodyWithLimit,
})
streamed = streamedRequest(['webhooks', 'billing', 'capway'], 'x'.repeat(512_001), '2')
response = await billingRoute.POST(streamed.request, { params: Promise.resolve({ provider: 'capway' }) })
assert.equal(response.status, 413)
assert.equal(streamed.cancels(), 1)
assert.equal(terminalCalls, 0)

const manualInboundRoute = load('app/api/webhooks/manual-inbound/route.ts', ['POST'], {
  createHmac, randomUUID, timingSafeEqual, NextResponse,
  ingestManualInboundEmail: async () => { terminalCalls += 1; return {} },
  supabaseService,
  readTextBodyWithLimit: bounded.readTextBodyWithLimit,
})
streamed = streamedRequest(['webhooks', 'manual-inbound'], 'x'.repeat(2_000_001), '2')
response = await manualInboundRoute.POST(streamed.request)
assert.equal(response.status, 413)
assert.equal(streamed.cancels(), 1)
assert.equal(terminalCalls, 0)

const resendPolicy = load('lib/email/resendWebhookEvents.ts', [
  'ResendWebhookError', 'getResendWebhookHeaders', 'getResendWebhookSecret',
], { supabaseService })
const resendRoute = load('app/api/webhooks/resend/route.ts', ['POST'], {
  NextResponse,
  getResendWebhookHeaders: resendPolicy.getResendWebhookHeaders,
  getResendWebhookSecret: resendPolicy.getResendWebhookSecret,
  verifyResendWebhook: () => { terminalCalls += 1; throw new Error('must not verify') },
  processResendWebhookEvent: async () => { terminalCalls += 1; return {} },
  ResendWebhookError: resendPolicy.ResendWebhookError,
  readTextBodyWithLimit: bounded.readTextBodyWithLimit,
})
delete process.env.RESEND_WEBHOOK_SECRET
streamed = streamedRequest(['webhooks', 'resend'], 'x'.repeat(100_000))
response = await resendRoute.POST(streamed.request)
assert.equal(response.status, 400)
assert.equal(streamed.pulls(), 0)
process.env.RESEND_WEBHOOK_SECRET = 'configured'
streamed = streamedRequest(['webhooks', 'resend'], 'x'.repeat(2_000_001), '2')
for (const [name, value] of [['svix-id', 'id'], ['svix-timestamp', '1'], ['svix-signature', 'v1,x']]) {
  streamed.request.headers.set(name, value)
}
response = await resendRoute.POST(streamed.request)
assert.equal(response.status, 413)
assert.equal(streamed.cancels(), 1)
assert.equal(terminalCalls, 0)

const workerDefinitions = [
  {
    path: 'app/api/internal/email/outbox/process/route.ts',
    url: ['internal', 'email', 'outbox', 'process'],
    secretNames: ['EMAIL_OUTBOX_CRON_SECRET', 'CRON_SECRET'],
    configuredSecret: 'EMAIL_OUTBOX_CRON_SECRET',
    dependencies: {
      randomUUID, timingSafeEqual, NextResponse, supabaseService,
      processTenantEmailOutbox: async () => { terminalCalls += 1; return { errors: [], scanned: 0, claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 } },
      readJsonWithLimit: payloadLimit.readJsonWithLimit,
    },
  },
  {
    path: 'app/api/internal/manual-email/outbox/process/route.ts',
    url: ['internal', 'manual-email', 'outbox', 'process'],
    secretNames: ['MANUAL_EMAIL_OUTBOX_CRON_SECRET', 'EMAIL_OUTBOX_CRON_SECRET', 'CRON_SECRET'],
    configuredSecret: 'MANUAL_EMAIL_OUTBOX_CRON_SECRET',
    dependencies: {
      randomUUID, timingSafeEqual, NextResponse,
      processManualEmailOutbox: async () => { terminalCalls += 1; return { errors: [], scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 } },
      readJsonWithLimit: payloadLimit.readJsonWithLimit,
    },
  },
  {
    path: 'app/api/ediel/outbox/process/route.ts',
    url: ['ediel', 'outbox', 'process'],
    secretNames: ['EDIEL_CRON_SECRET', 'CRON_SECRET'],
    configuredSecret: 'EDIEL_CRON_SECRET',
    dependencies: {
      timingSafeEqual, NextResponse,
      processEdielOutbox: async () => { terminalCalls += 1; return {} },
      resolveConfiguredEdielAutomationActorId: automationActorPolicy.resolveConfiguredEdielAutomationActorId,
      readJsonWithLimit: payloadLimit.readJsonWithLimit,
    },
  },
]
process.env.EDIEL_AUTOMATION_ACTOR_USER_ID = EDIEL_ACTOR_ID
for (const definition of workerDefinitions) {
  for (const name of definition.secretNames) delete process.env[name]
  const workerRoute = load(definition.path, ['GET', 'POST'], definition.dependencies)
  let callsBefore = terminalCalls
  streamed = streamedRequest(definition.url, 'x'.repeat(300_000))
  response = await workerRoute.POST(streamed.request)
  assert.equal(response.status, 503)
  assert.equal(streamed.pulls(), 0)
  assert.equal(terminalCalls, callsBefore)

  process.env[definition.configuredSecret] = 'worker-secret'
  streamed = streamedRequest(definition.url, 'x'.repeat(300_000))
  streamed.request.headers.set('authorization', 'Bearer wrong-secret')
  response = await workerRoute.POST(streamed.request)
  assert.equal(response.status, 401)
  assert.equal(streamed.pulls(), 0)

  streamed = streamedRequest(definition.url, 'x'.repeat(256_001), '2')
  streamed.request.headers.set('authorization', 'Bearer worker-secret')
  callsBefore = terminalCalls
  response = await workerRoute.POST(streamed.request)
  assert.equal(response.status, 413)
  assert.equal(streamed.cancels(), 1)
  assert.equal(terminalCalls, callsBefore)

  streamed = streamedRequest(definition.url, '')
  streamed.request.headers.set('authorization', 'Bearer worker-secret')
  response = await workerRoute.POST(streamed.request)
  assert.equal(response.status, 200)
}

const companyWorker = load('app/api/ediel/outbox/process-company/route.ts', ['POST'], {
  timingSafeEqual, NextResponse, supabaseService,
  processEdielOutbox: async () => { terminalCalls += 1; return {} },
  resolveConfiguredEdielAutomationActorId: automationActorPolicy.resolveConfiguredEdielAutomationActorId,
  readJsonWithLimit: payloadLimit.readJsonWithLimit,
})
delete process.env.EDIEL_PLATFORM_MAINTENANCE_SECRET
delete process.env.EDIEL_CRON_SECRET
streamed = streamedRequest(['ediel', 'outbox', 'process-company'], 'x'.repeat(300_000))
response = await companyWorker.POST(streamed.request)
assert.equal(response.status, 503)
assert.equal(streamed.pulls(), 0)
process.env.EDIEL_PLATFORM_MAINTENANCE_SECRET = 'worker-secret'
streamed = streamedRequest(['ediel', 'outbox', 'process-company'], 'x'.repeat(300_000))
streamed.request.headers.set('authorization', 'Bearer wrong-secret')
response = await companyWorker.POST(streamed.request)
assert.equal(response.status, 401)
assert.equal(streamed.pulls(), 0)
streamed = streamedRequest(['ediel', 'outbox', 'process-company'], 'x'.repeat(256_001), '2')
streamed.request.headers.set('authorization', 'Bearer worker-secret')
const companyCallsBeforeOversize = terminalCalls
response = await companyWorker.POST(streamed.request)
assert.equal(response.status, 413)
assert.equal(streamed.cancels(), 1)
assert.equal(terminalCalls, companyCallsBeforeOversize)
streamed = streamedRequest(['ediel', 'outbox', 'process-company'], '')
streamed.request.headers.set('authorization', 'Bearer worker-secret')
response = await companyWorker.POST(streamed.request)
assert.equal(response.status, 400)

streamed = streamedRequest(
  ['ediel', 'outbox', 'process-company'],
  JSON.stringify({ companyId: 'company-A', reason: 'maintenance', limit: 7 }),
)
streamed.request.headers.set('authorization', 'Bearer worker-secret')
response = await companyWorker.POST(streamed.request)
assert.equal(response.status, 200)
assert.deepEqual(await response.json(), {
  ok: true,
  source: 'ediel_outbox_company_maintenance',
  companyId: 'company-A',
  environment: null,
  result: {},
})

assert.equal(state.actorAuthCalls, 3, 'real Ediel actor policy must resolve auth + active membership for generic, empty-company and valid-company runs')
assert.equal(state.databaseCalls.filter((call) => call.table === 'user_profiles').length, 3)
assert.equal(state.databaseCalls.filter((call) => call.table === 'company_memberships').length, 3)
assert.equal(state.databaseCalls.filter((call) => call.table === 'companies').length, 1)
assert.equal(state.databaseCalls.filter((call) => call.table === 'audit_logs' && call.operation === 'insert').length, 1)
assert.equal(terminalCalls, 4, 'only the three authorized empty generic worker POSTs and valid company maintenance may execute')
console.log('PASS 32 actual-source cases: 11 partner auth/body/public-target/price, 4 signed upper-body/pre-read, 17 worker secret/body/empty/company with real Ediel actor policy')
