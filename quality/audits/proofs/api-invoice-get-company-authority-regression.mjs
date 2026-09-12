// Task 10b2auth source-only regression for the two invoice GET routes.
// Real auth, canonical selection, lifecycle, receivers and provider client execute;
// only DB/RPC/framework/environment/fetch terminal I/O is synthetic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const sourceHashes = {}
function load(path, names, dependencies = {}) {
  const raw = readFileSync(path, 'utf8')
  sourceHashes[path] = createHash('sha256').update(raw).digest('hex')
  const source = stripTypeScriptTypes(raw, { mode: 'transform' })
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const context = vm.createContext({ console, Date, Error, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, ...dependencies })
  vm.runInContext(`${source}\nglobalThis.loaded = {${names.join(',')}}`, context, { filename: path })
  return context.loaded
}
const state = {}
const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }
const lifecycle = load('lib/tenant/lifecycle.ts', ['isCompanyVisibleInTenantWorkspace', 'isCompanyWritableInTenantWorkspace'])
const roles = load('lib/rbac/roleKeys.ts', ['normalizeRoleKey', 'resolveRoleKey', 'isPlatformAdminRole'])
const accessModel = load('lib/admin/accessModel.ts', ['hasPermissionRequirement'])
const preferences = load('lib/admin/navigationPreferences.ts', ['ADMIN_SELECTED_COMPANY_COOKIE'])
const cookieIO = async () => ({ get: name => {
  assert.equal(name, preferences.ADMIN_SELECTED_COMPANY_COOKIE)
  return state.cookie ? { value: state.cookie } : undefined
} })
const membership = company => ({ company_id: company, user_id: 'actor', membership_role: 'member', status: 'active', is_active: true,
  created_at: company === state.older ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
  companies: { id: company, name: company, slug: company.toLowerCase(), status: state.companyStatuses?.[company] ?? 'active' },
})
function canonical(params) {
  if (state.platform) {
    const companyId = params.p_selected_company_id && params.p_selected_company_id !== state.absent
      ? params.p_selected_company_id
      : null
    state.contexts.push({ companyId, permissions: [], selectedParameter: params.p_selected_company_id })
    return { data: { authorized: true, user_id: 'actor', is_platform_admin: true,
      selected_company_id: companyId, roles: ['platform_admin'], permissions: [] }, error: null }
  }
  const assignments = ['A', 'B'].map(company_id => ({ user_id: 'actor', company_id,
    status: state.assignmentInactive === company_id ? 'disabled' : 'active',
    is_active: state.assignmentInactive !== company_id,
    role_active: state.assignmentInactive !== company_id,
    role_key: 'custom_role',
    permissions: company_id === state.granted ? ['billing.read'] : ['customers.read'],
  }))
  const candidates = ['A', 'B'].filter(company => company !== state.absent).map(membership)
    .filter(row => row.status === 'active' && row.is_active && assignments.some(a => a.company_id === row.company_id && a.status === 'active' && a.is_active))
    .filter(row => !params.p_selected_company_id || row.company_id === params.p_selected_company_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const companyId = candidates[0]?.company_id ?? null
  const permissions = assignments.filter(a => a.company_id === companyId && a.role_active).flatMap(a => a.permissions)
  state.contexts.push({ companyId, permissions, selectedParameter: params.p_selected_company_id })
  return { data: { authorized: true, user_id: 'actor', is_platform_admin: false, selected_company_id: companyId, roles: state.roles ?? ['custom_role'], permissions }, error: null }
}
function dataFor(table, filters) {
  const company = filters.company_id
  if (table === 'company_memberships') return state.order.filter(value => value !== state.absent).map(membership)
  if (table === 'companies') return state.absent === filters.id ? [] : [{ id: filters.id, status: state.companyStatuses?.[filters.id] ?? 'active' }]
  if (table === 'invoice_export_runs') return [{ id: `run-${company}`, company_id: company, environment: state.environment, total_items: 1, private_summary: `export-private-${company}` }]
  if (table === 'invoice_export_items') return [{ id: `item-${company}`, company_id: company, export_run_id: `run-${company}`, environment: state.environment,
    status: 'sent', provider_invoice_guid: state.noGuid ? null : `guid-${company}`, request_payload: { private_invoice_reference: `invoice-private-${company}` } }]
  if (table === 'billing_provider_connections') return state.noConfig ? [] : [{ id: `connection-${company}`, company_id: company, provider: 'capway_aptic',
    environment: state.environment, status: 'active',
    settings: { auth_mode: state.oauth ? 'oauth2' : 'apikey', api_key_header: 'X-Synthetic-Key',
      base_url: `https://provider-${company.toLowerCase()}.invalid`, token_url: `https://token-${company.toLowerCase()}.invalid/token` },
    secret_reference: { api_key_env: 'SYNTHETIC_KEY', client_id_env: 'SYNTHETIC_CLIENT', client_secret_env: 'SYNTHETIC_SECRET' },
  }]
  throw new Error(`Unmodeled table ${table}`)
}
function query(table) {
  const call = { table, operation: 'select', filters: {}, inFilters: {}, orders: [], payload: null }
  const result = (single = false, strict = false) => {
    state.queries.push(structuredClone(call))
    if (call.operation !== 'select') {
      state.writes.push(structuredClone(call))
      return { data: null, error: null }
    }
    const data = dataFor(table, call.filters).filter(row =>
      Object.entries(call.filters).every(([key, value]) => row[key] === value) &&
      Object.entries(call.inFilters).every(([key, values]) => values.includes(row[key])))
    if (strict && !data.length) return { data: null, error: new Error('not found for tenant') }
    return { data: single ? data[0] ?? null : data, error: null }
  }
  const builder = {
    select() { return builder }, eq(key, value) { call.filters[key] = value; return builder },
    in(key, values) { call.inFilters[key] = values; return builder },
    order(key, options) { call.orders.push({ key, options }); return builder }, limit() { return builder },
    update(payload) { call.operation = 'update'; call.payload = payload; return builder },
    async single() { return result(true, true) }, async maybeSingle() { return result(true) },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }
  return builder
}
const supabaseService = { from: query, async rpc(name, params) {
  state.roleRPCs.push({ name, params })
  assert.equal(name, 'gridex_get_user_roles')
  assert.equal(params.p_user_id, 'actor')
  return { data: ['custom_role'], error: null }
} }
const scope = load('lib/tenant/scope.ts', ['CompanyAccessError', 'requireOperationalCompanyId', 'assertUserCanReadCompany', 'assertUserCanOperateCompany'], {
  ...lifecycle, ...roles, ...preferences, supabaseService, cookies: cookieIO, cache: fn => fn,
})
const guards = load('lib/admin/apiGuards.ts', ['requireAdminApiAccess', 'adminApiCompanyAccessErrorStatus', 'assertAdminApiCompanyReadAccess', 'assertAdminApiCompanyAccess'], {
  ...accessModel, ...roles, ...scope, ...preferences, NextResponse, cookies: cookieIO,
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    rpc: async (name, params) => { assert.equal(name, 'canonical_authenticated_tenant_context'); return canonical(params) },
  }),
})
// This is the only fetch implementation visible to real auth and client modules.
// The VM has no actual process.env or native/global fetch, and no remote SDK.
const fetchIO = async (url, init) => {
  const parsed = new URL(url)
  assert.ok(parsed.hostname.endsWith('.invalid'))
  const company = /-(a|b)\./.exec(parsed.hostname)?.[1].toUpperCase()
  assert.ok(company)
  state.http.push({ company, host: parsed.hostname, path: parsed.pathname, method: init.method })
  if (parsed.hostname.startsWith('token-')) {
    assert.equal(init.method, 'POST')
    return { ok: true, status: 200, json: async () => ({ access_token: 'synthetic-token', expires_in: 3600 }) }
  }
  assert.equal(init.method, 'GET')
  assert.ok(init.headers['X-Synthetic-Key'] === 'synthetic-key' || init.headers.Authorization === 'Bearer synthetic-token')
  if (state.providerRejected) throw new Error(`synthetic-${company}-provider-unavailable`)
  const payload = { status: 1, financeStatus: 2, privateProviderMarker: `provider-private-${company}`, path: parsed.pathname }
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
}
const auth = load('lib/integrations/billing/capway/auth.ts', ['resolveCapwayConnectionConfig', 'getCapwayAccessToken', 'clearCapwayTokenCache'], {
  supabaseService, fetch: fetchIO, process: { env: { SYNTHETIC_KEY: 'synthetic-key', SYNTHETIC_CLIENT: 'synthetic-client', SYNTHETIC_SECRET: 'synthetic-secret' } },
})
const client = load('lib/integrations/billing/capway/client.ts', ['createCapwayApticClient'], { ...auth, fetch: fetchIO })
const mapper = load('lib/integrations/billing/capway/statusMapper.ts', ['normalizeCapwayFinanceStatus', 'normalizeCapwayInvoiceStatus'])
const exports = load('lib/integrations/billing/invoiceExportCore.ts', ['getInvoiceExportRun'], { supabaseService })
const routeDeps = { NextResponse, ...guards, ...scope, ...client, ...mapper, ...exports, supabaseService,
  internalApiError: ({ error, status = 500 }) => ({ status, body: { error: error.message } }),
}
const routes = {
  export: load('app/api/internal/invoice-exports/[id]/route.ts', ['GET'], routeDeps),
  provider: load('app/api/internal/invoices/[id]/provider-status/route.ts', ['GET'], routeDeps),
}
const scenarios = [
  { name: 'no-cookie-A-to-B', older: 'A', granted: 'A', order: ['B', 'A'], target: 'B' },
  { name: 'explicit-B-cookie-A', older: 'A', granted: 'A', order: ['A', 'B'], cookie: 'A', requested: 'B', target: 'B' },
  { name: 'explicit-B-snake-cookie-A', older: 'A', granted: 'A', order: ['A', 'B'], cookie: 'A', requested: 'B', snake: true, target: 'B' },
  { name: 'same-A', older: 'A', granted: 'A', order: ['A', 'B'], target: 'A' },
  { name: 'reverse-no-cookie-B-to-A', older: 'B', granted: 'B', order: ['A', 'B'], target: 'A' },
  { name: 'reverse-explicit-A-cookie-B', older: 'B', granted: 'B', order: ['B', 'A'], cookie: 'B', requested: 'A', target: 'A' },
  { name: 'cookie-A-with-B-first', older: 'A', granted: 'A', order: ['B', 'A'], cookie: 'A', target: 'A' },
  { name: 'explicit-same-A', older: 'A', granted: 'A', order: ['B', 'A'], cookie: 'A', requested: 'A', target: 'A' },
  { name: 'cookie-B-denied', older: 'A', granted: 'A', order: ['B', 'A'], cookie: 'B', target: 'B', denied: true },
  { name: 'no-cookie-A-denied', older: 'A', granted: 'B', order: ['B', 'A'], target: 'B', denied: true },
]
const results = []
async function run(route, scenario, extras = {}) {
  Object.assign(state, { cookie: null, requested: null, snake: false, rawQuery: null, absent: null, noGuid: false, noConfig: false,
    providerRejected: false, oauth: false, environment: 'production', platform: false, roles: ['custom_role'],
    assignmentInactive: null, companyStatuses: {}, queries: [], writes: [], contexts: [], roleRPCs: [], http: [] }, scenario, extras)
  auth.clearCapwayTokenCache()
  const query = state.rawQuery ?? (state.requested ? `?${state.snake ? 'company_id' : 'companyId'}=${state.requested}` : '')
  const response = await routes[route].GET({ url: `https://synthetic.invalid/api${query}` }, { params: Promise.resolve({ id: `${route === 'export' ? 'run' : 'item'}-${state.target}` }) })
  return response
}
function record(route, name, response) {
  results.push({ route, scenario: name, canonical: state.contexts[0].companyId, status: response.status,
    serviceReads: state.queries.filter(row => row.operation === 'select' && row.table !== 'company_memberships').length,
    providerGETs: state.http.filter(row => row.method === 'GET').length,
    tokenPOSTs: state.http.filter(row => row.method === 'POST').length, serviceUpdates: state.writes.length })
}
for (const route of Object.keys(routes)) for (const scenario of scenarios) {
  const response = await run(route, scenario)
  const canonicalCompany = scenario.cookie ?? scenario.older
  const foreignRequest = !scenario.denied && (scenario.requested ?? scenario.target) !== canonicalCompany
  const expectedStatus = scenario.denied ? 403 : scenario.requested && foreignRequest ? 403 : foreignRequest ? 500 : 200
  assert.equal(response.status, expectedStatus, `${route}/${scenario.name}: ${JSON.stringify(response)}`)
  if (scenario.denied) { assert.equal(state.queries.length, 0); assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0) }
  else if (foreignRequest) {
    assert.equal(state.http.length, 0)
    assert.equal(state.writes.length, 0)
    if (scenario.requested) {
      assert.equal(state.queries.length, 0, 'explicit foreign company must fail before service I/O')
    } else {
      const recordRead = state.queries.find(row => row.table === (route === 'export' ? 'invoice_export_runs' : 'invoice_export_items'))
      assert.equal(recordRead.filters.company_id, canonicalCompany)
      assert.equal(recordRead.filters.id, `${route === 'export' ? 'run' : 'item'}-${scenario.target}`)
    }
  }
  else {
    assert.equal(state.contexts[0].companyId, canonicalCompany)
    for (const row of state.queries.filter(row => row.table !== 'company_memberships')) assert.equal(row.filters.company_id, canonicalCompany)
    assert.equal(state.queries.find(row => row.table === 'company_memberships').orders.length, 0)
    if (route === 'export') {
      assert.equal(response.body.data.run.private_summary, `export-private-${canonicalCompany}`)
      assert.equal(response.body.data.items[0].request_payload.private_invoice_reference, `invoice-private-${canonicalCompany}`)
      assert.equal(state.writes.length, 0); assert.equal(state.http.length, 0)
    } else {
      assert.equal(state.http.length, 4)
      assert.ok(state.http.every(row => row.company === canonicalCompany && row.method === 'GET'))
      assert.deepEqual(state.http.map(row => row.path).sort(), ['', '/FinancialDetails', '/Purchase', '/Recourse'].map(suffix => `/v1/Invoices/guid-${canonicalCompany}${suffix}`).sort())
      assert.equal(response.body.data.invoice.value.privateProviderMarker, `provider-private-${canonicalCompany}`)
      assert.equal(state.writes.length, 1)
      assert.equal(state.writes[0].filters.id, `item-${canonicalCompany}`)
      assert.equal(state.writes[0].payload.provider_status, 'paid')
      assert.equal(state.writes[0].payload.purchase_status, 'purchased_without_recourse')
    }
  }
  record(route, scenario.name, response)
}
for (const route of Object.keys(routes)) {
  for (const [name, scenario, extras] of [
    ['cookie-A-B-id-no-requested-company', { ...scenarios[6], target: 'B' }, {}],
    ['explicit-B-no-membership', scenarios[1], { absent: 'B' }],
    ['explicit-B-paused', scenarios[1], { companyStatuses: { B: 'paused' } }],
  ]) {
    const response = await run(route, scenario, extras)
    assert.equal(response.status, name === 'cookie-A-B-id-no-requested-company' ? 500 : 403)
    assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
    if (name !== 'cookie-A-B-id-no-requested-company') assert.equal(state.queries.filter(row => row.table !== 'company_memberships').length, 0)
    record(route, name, response)
  }
}
for (const [name, extra, expected] of [
  ['missing-provider-guid', { noGuid: true }, 400],
  ['incomplete-provider-configuration', { noConfig: true }, 500],
]) {
  const response = await run('provider', scenarios[7], extra)
  assert.equal(response.status, expected)
  assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
  record('provider', name, response)
}
const rejected = await run('provider', scenarios[7], { providerRejected: true })
assert.equal(rejected.status, 200)
assert.equal(state.http.length, 4); assert.equal(state.writes.length, 1)
assert.equal(state.writes[0].payload.provider_status, 'unknown')
assert.equal(state.writes[0].payload.status_payload.invoice.status, 'rejected')
record('provider', 'all-four-provider-reads-reject-still-updates-A', rejected)
const oauth = await run('provider', scenarios[7], { oauth: true })
assert.equal(oauth.status, 200)
assert.equal(state.http.filter(row => row.method === 'GET').length, 4)
assert.equal(state.http.filter(row => row.method === 'POST').length, 4)
assert.ok(state.http.every(row => row.company === 'A'))
assert.equal(state.writes.length, 1)
record('provider', 'uncached-oauth-token-exchange-plus-four-reads', oauth)
const testEnv = await run('provider', scenarios[7], { environment: 'test' })
assert.equal(testEnv.status, 200)
assert.equal(state.queries.find(row => row.table === 'billing_provider_connections').filters.environment, 'test')
assert.equal(state.writes.length, 1)
record('provider', 'test-environment-sourced-from-export-item', testEnv)

// Pure export history remains visible for a paused canonical tenant; the
// provider-status GET is operational and must fail before item/config/provider I/O.
const pausedExport = await run('export', scenarios[7], { companyStatuses: { A: 'paused' } })
assert.equal(pausedExport.status, 200)
assert.equal(pausedExport.body.data.run.private_summary, 'export-private-A')
record('export', 'paused-A-readable', pausedExport)
const pausedProvider = await run('provider', scenarios[7], { companyStatuses: { A: 'paused' } })
assert.equal(pausedProvider.status, 403)
assert.equal(state.queries.filter(row => row.table === 'invoice_export_items').length, 0)
assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
record('provider', 'paused-A-blocked-before-provider', pausedProvider)

// Explicit platform selection uses the authoritative boolean, validates the
// selected company's lifecycle, and needs no membership. No selection fails closed.
for (const route of Object.keys(routes)) {
  const selected = await run(route, { ...scenarios[1], cookie: null }, { platform: true })
  assert.equal(selected.status, 200, `${route}/platform-explicit-B: ${JSON.stringify(selected)}`)
  assert.ok(state.queries.some(row => row.table === 'companies' && row.filters.id === 'B'))
  assert.ok(!state.queries.some(row => row.table === 'company_memberships'))
  if (route === 'provider') assert.equal(state.http.length, 4)
  record(route, 'platform-explicit-B-no-membership', selected)

  const unselected = await run(route, { ...scenarios[0], target: 'B' }, { platform: true })
  assert.equal(unselected.status, 403)
  assert.equal(state.queries.length, 0); assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
  record(route, 'platform-no-selection-fails-closed', unselected)
}
const platformPausedRead = await run('export', { ...scenarios[1], cookie: null }, { platform: true, companyStatuses: { B: 'paused' } })
assert.equal(platformPausedRead.status, 200)
record('export', 'platform-explicit-paused-B-readable', platformPausedRead)
const platformPausedWrite = await run('provider', { ...scenarios[1], cookie: null }, { platform: true, companyStatuses: { B: 'paused' } })
assert.equal(platformPausedWrite.status, 403)
assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
record('provider', 'platform-explicit-paused-B-write-blocked', platformPausedWrite)

// A platform-looking company role never substitutes for canonical platform authority.
for (const route of Object.keys(routes)) {
  const response = await run(route, scenarios[1], { roles: ['super_admin'] })
  assert.equal(response.status, 403)
  assert.equal(state.queries.length, 0); assert.equal(state.http.length, 0); assert.equal(state.writes.length, 0)
  record(route, 'platform-looking-role-false', response)
}

// Both aliases are preserved and camelCase retains precedence when both occur.
for (const route of Object.keys(routes)) {
  const response = await run(route, scenarios[7], { rawQuery: '?companyId=A&company_id=B' })
  assert.equal(response.status, 200)
  if (route === 'provider') assert.ok(state.http.every(row => row.company === 'A'))
  results.push({ route, scenario: 'camel-alias-precedes-snake-alias', status: 200 })
}
console.log(JSON.stringify({ passed: results.length, results, sourceHashes }, null, 2))
