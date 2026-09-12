// Task 10b2auth source-only regression. Run from repository root with Node >=24.
// Real guard, canonical selection, lifecycle, route and receiver code execute with
// synthetic DB/RPC/framework terminal I/O. No network, provider or SQL action.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const hashes = {}
function load(path, names, deps = {}) {
  const raw = readFileSync(path, 'utf8')
  hashes[path] = createHash('sha256').update(raw).digest('hex')
  const source = stripTypeScriptTypes(raw)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const exposed = names
    .map(name => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`)
    .join(',')
  const context = vm.createContext({ console, Date, Error, URL, ...deps })
  vm.runInContext(`${source}\nglobalThis.loaded = {${exposed}}`, context, { filename: path })
  return context.loaded
}
const state = {}
const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }
const time = load('lib/time/stockholm.ts', ['parseBillingMonth', 'stockholmMonthBounds', 'stockholmLocalToUtc', 'stockholmDateForInstant', 'strictIsoDate'])
const types = load('lib/pricing/types.ts', ['isPriceArea', 'normalizeBillingMonth'])
const lifecycle = load('lib/tenant/lifecycle.ts', ['isCompanyVisibleInTenantWorkspace', 'isCompanyWritableInTenantWorkspace'])
const roles = load('lib/rbac/roleKeys.ts', ['normalizeRoleKey', 'resolveRoleKey', 'isPlatformAdminRole'])
const accessModel = load('lib/admin/accessModel.ts', ['hasPermissionRequirement'])
const previewBuilder = load('lib/pricing/pricePreviewBuilder.ts', ['finalizePricingPreview'])
const production = load('lib/pricing/productionSettlement.ts', ['buildProductionSettlement'])
const cookieIO = async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined })
const membership = company => ({
  company_id: company, user_id: 'actor', membership_role: 'member',
  status: state.membershipInactive === company ? 'disabled' : 'active',
  is_active: state.membershipInactive !== company,
  created_at: company === state.older ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
  companies: { id: company, name: company, slug: company.toLowerCase(), status: state.companyStatuses?.[company] ?? 'active' },
})
// Canonical RPC I/O is derived from the same valid active-membership and
// active company-bound assignment fixture, following scoped SQL lines 622-637.
// No independently supplied canonical company or contradictory permission set.
function canonical(params) {
  if (state.platform) {
    const companyId = params.p_selected_company_id && params.p_selected_company_id !== state.absent
      ? params.p_selected_company_id
      : null
    state.contexts.push({ companyId, permissions: [], selectedParameter: params.p_selected_company_id })
    return { data: { authorized: true, user_id: 'actor', is_platform_admin: true,
      selected_company_id: companyId, roles: ['platform_admin'], permissions: [] }, error: null }
  }
  const assignments = ['A', 'B'].map(company_id => ({
    user_id: 'actor', company_id,
    status: state.assignmentInactive === company_id ? 'disabled' : 'active',
    is_active: state.assignmentInactive !== company_id,
    role_active: state.assignmentInactive !== company_id,
    role_key: 'custom_role', permissions: company_id === state.granted
      ? ['billing.read', 'billing.write', 'pricing.write'] : ['customers.read'],
  }))
  const candidates = ['A', 'B'].filter(company => company !== state.absent).map(membership)
    .filter(row => row.status === 'active' && row.is_active && assignments.some(assignment =>
      assignment.company_id === row.company_id && assignment.status === 'active' && assignment.is_active))
    .filter(row => !params.p_selected_company_id || row.company_id === params.p_selected_company_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const companyId = candidates[0]?.company_id ?? null
  const permissions = assignments.filter(assignment => assignment.company_id === companyId && assignment.role_active)
    .flatMap(assignment => assignment.permissions)
  state.contexts.push({ companyId, permissions, selectedParameter: params.p_selected_company_id })
  return { data: { authorized: true, user_id: 'actor', is_platform_admin: false,
    selected_company_id: companyId, roles: state.roles ?? ['custom_role'], permissions }, error: null }
}
const bounds = time.stockholmMonthBounds('2026-08')
function underlay(company) {
  return { id: `underlay-${company}`, company_id: company, customer_id: `customer-${company}`,
    metering_point_id: `meter-${company}`, contract_id: `contract-${company}`, contract_price_snapshot_id: `snapshot-${company}`,
    underlay_year: 2026, underlay_month: 8, billing_period_start: '2026-08-01', billing_period_end: '2026-09-01',
    status: state.blocked ? 'pending' : 'validated', readiness_status: state.blocked ? 'blocked' : 'ready',
    missing_values_count: 0, readiness_issues: [], billing_block_reason: state.blocked ? `private-${company}-billing-blocker` : null,
    total_kwh: 10, source_meter_value_count: 1, price_area: 'SE3', energy_direction: 'production', settlement_type: 'credit_invoice',
    pricing_snapshot: { price_area: 'SE3', production: { enabled: true, compensation_sek_per_kwh: company === 'A' ? 1 : 2, settlement_mode: 'credit_invoice', vat_rate: 0 } },
  }
}
function dataFor(table, filters) {
  const company = filters.company_id
  if (table === 'company_memberships') return state.order.filter(company => company !== state.absent).map(membership)
  if (table === 'companies') return state.absent === filters.id ? [] : [{ id: filters.id, status: state.companyStatuses?.[filters.id] ?? 'active' }]
  if (table === 'platform_runtime_readiness') return [{ id: true, is_ready: true, schema_version: '20260803093300-gridex-runtime-readiness-v3', schema_fingerprint: 'a'.repeat(64), blocking_issues: [] }]
  if (table === 'billing_period_locks') return state.periodLocked || state.route === 'period-get'
    ? [{ id: `lock-${company}`, company_id: company, billing_year: 2026, billing_month: 8, status: 'locked', lock_reason: `private-${company}-lock-reason` }] : []
  if (table === 'price_period_locks') return []
  if (table === 'billing_underlays') return [underlay(company)]
  if (table === 'customer_contracts') return [{ id: `contract-${company}`, company_id: company, customer_id: `customer-${company}`, status: 'active', contract_type: 'fixed', energy_direction: 'production' }]
  if (table === 'contract_price_snapshots') return [{ id: `snapshot-${company}`, company_id: company, contract_id: `contract-${company}`, valid_from: '2026-01-01', snapshot_json: underlay(company).pricing_snapshot }]
  if (table === 'billing_underlay_items') return [{ ...underlay(company), id: `item-${company}`, billing_underlay_id: `underlay-${company}`,
    period_start: bounds.start, period_end: bounds.end, quantity_kwh: 10, unit: 'kWh', status: 'ready_for_pricing', warnings: [], source_normalized_metering_value_id: `normalized-${company}` }]
  if (table === 'pricing_runs') return [{ id: `run-${company}`, company_id: company, billing_underlay_id: `underlay-${company}`, customer_id: `customer-${company}`,
    status: 'success', billing_period_start: '2026-08-01', billing_period_end: '2026-09-01', errors: [] }]
  if (table === 'customer_supply_periods') return [{ id: `supply-${company}`, company_id: company, customer_id: `customer-${company}`, metering_point_id: `meter-${company}`, contract_id: `contract-${company}`, start_date: '2026-08-01', end_date: null, status: 'active' }]
  if (['pricing_interval_evidence', 'normalized_metering_values'].includes(table)) return []
  throw new Error(`Unmodeled table: ${table}`)
}
function query(table) {
  const call = { table, operation: 'select', filters: {}, orders: [], payload: null }
  const result = (single = false) => {
    state.queries.push(structuredClone(call))
    if (call.operation !== 'select') {
      state.effects.push(structuredClone(call))
      return { data: call.payload, error: null }
    }
    let data = dataFor(table, call.filters).filter(row => Object.entries(call.filters).every(([key, value]) => row[key] === value))
    if (single && !data.length && call.strictSingle) return { data: null, error: new Error('not found for tenant') }
    return { data: single ? data[0] ?? null : data, count: data.length, error: null }
  }
  const builder = {
    select() { return builder }, eq(key, value) { call.filters[key] = value; return builder },
    in() { return builder }, not() { return builder }, lt() { return builder }, gt() { return builder },
    lte() { return builder }, or() { return builder }, range() { return builder }, limit() { return builder },
    order(key, options) { call.orders.push({ key, options }); return builder },
    upsert(payload) { call.operation = 'upsert'; call.payload = payload; return builder },
    update(payload) { call.operation = 'update'; call.payload = payload; return builder },
    async single() { call.strictSingle = true; return result(true) },
    async maybeSingle() { return result(true) },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }
  return builder
}
const supabaseService = { from: query, async rpc(name, params) {
  state.effects.push({ rpc: name, params: structuredClone(params) })
  if (name === 'gridex_persist_pricing_run') return { data: `new-run-${params.p_company_id}`, error: null }
  if (name === 'gridex_lock_pricing_run') return { data: { status: 'locked' }, error: null }
  if (name === 'gridex_unlock_pricing_runs_for_month') return { data: 1, error: null }
  if (name === 'gridex_store_billing_underlay_batch') return { data: params.p_commands.map((_, index) => `generated-${params.p_company_id}-${index}`), error: null }
  throw new Error(`Unmodeled RPC: ${name}`)
} }
const scope = load('lib/tenant/scope.ts', ['CompanyAccessError', 'requireOperationalCompanyId', 'assertUserCanReadCompany', 'assertUserCanOperateCompany'], {
  ...lifecycle, ...roles, supabaseService, cookies: cookieIO, cache: fn => fn, ADMIN_SELECTED_COMPANY_COOKIE: 'company',
})
const guards = load('lib/admin/apiGuards.ts', ['requireAdminApiAccess', 'adminApiCompanyAccessErrorStatus', 'assertAdminApiCompanyReadAccess', 'assertAdminApiCompanyAccess'], {
  ...accessModel, ...roles, ...scope, NextResponse, cookies: cookieIO, ADMIN_SELECTED_COMPANY_COOKIE: 'company',
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    rpc: async (name, params) => { assert.equal(name, 'canonical_authenticated_tenant_context'); return canonical(params) },
  }),
})
const readiness = load('lib/platform/schemaReadiness.ts', ['assertPlatformSchemaReady'], { supabaseService })
const invoice = load('lib/billing/invoiceReadiness.ts', ['getBillingPeriodLock', 'lockBillingPeriod', 'unlockBillingPeriod', 'assertBillingPeriodOpen'], { supabaseService, ...time, createHash, ...readiness })
const evidence = load('lib/billing/underlayEvidence.ts', ['underlayValidationErrors', 'loadUnderlayEvidence', 'loadPricingRunEvidence', 'billingPeriodInstant', 'evidenceQuantityKwh'], { supabaseService, ...time, ...types })
const pricing = load('lib/pricing/engine.ts', ['calculatePricingPreviewForUnderlay', 'calculatePricingPreviewForBillingMonth', 'lockPricingPreview'], { supabaseService, ...time, ...types, ...invoice, ...evidence, ...previewBuilder, ...production })
const generation = load('lib/billing/underlayEngine.ts', ['generateBillingUnderlaysForMonth'], { supabaseService, ...time, ...types, ...invoice, ...readiness })
const routeDeps = { NextResponse, ...guards, ...scope, ...invoice, ...pricing, ...generation,
  internalApiError: ({ error, status = 500 }) => ({ status, body: { error: error.message } }),
}
const period = load('app/api/internal/billing/period-locks/route.ts', ['GET', 'POST'], routeDeps)
const generate = load('app/api/internal/billing/generate-underlay/route.ts', ['POST'], routeDeps)
const preview = load('app/api/internal/pricing/preview/route.ts', ['POST'], routeDeps)
const lock = load('app/api/internal/pricing/lock-preview/route.ts', ['POST'], routeDeps)
const reprice = load('app/api/internal/pricing/reprice/route.ts', ['POST'], routeDeps)
const routes = {
  'period-get': { fn: period.GET, body: () => ({}) },
  'period-lock': { fn: period.POST, body: () => ({ action: 'lock' }) },
  'period-unlock': { fn: period.POST, body: () => ({ action: 'unlock' }) },
  generate: { fn: generate.POST, body: () => ({}) },
  'preview-read': { fn: preview.POST, body: target => ({ billing_underlay_id: `underlay-${target}`, persist: false }) },
  'preview-write': { fn: preview.POST, body: target => ({ billing_underlay_id: `underlay-${target}` }) },
  'preview-month': { fn: preview.POST, body: () => ({}) },
  reprice: { fn: reprice.POST, body: target => ({ billing_underlay_id: `underlay-${target}` }) },
  'lock-preview': { fn: lock.POST, body: target => ({ pricing_run_id: `run-${target}` }) },
}
const scenarios = [
  { name: 'no-cookie-A-to-B', older: 'A', granted: 'A', order: ['B', 'A'], target: 'B' },
  { name: 'same-company-A', older: 'A', granted: 'A', order: ['A', 'B'], target: 'A' },
  { name: 'reverse-no-cookie-B-to-A', older: 'B', granted: 'B', order: ['A', 'B'], target: 'A' },
  { name: 'cookie-A-with-B-first', older: 'A', granted: 'A', order: ['B', 'A'], cookie: 'A', target: 'A' },
  { name: 'cookie-B-denied', older: 'A', granted: 'A', order: ['B', 'A'], cookie: 'B', target: 'B', denied: true },
  { name: 'no-cookie-permission-denied', older: 'A', granted: 'B', order: ['B', 'A'], target: 'B', denied: true },
]
const results = []
async function run(route, scenario, extra = {}) {
  Object.assign(state, {
    cookie: null, queries: [], effects: [], contexts: [], blocked: false,
    periodLocked: false, platform: false, roles: ['custom_role'], absent: null,
    assignmentInactive: null, membershipInactive: null, companyStatuses: {}, bodyReads: 0,
  }, scenario, extra, { route })
  const entry = routes[route]
  const response = await entry.fn({
    url: 'https://synthetic.invalid/api?billing_month=2026-08',
    json: async () => {
      state.bodyReads += 1
      return { billing_month: '2026-08', ...entry.body(scenario.target) }
    },
  })
  return response
}
const idScopedRoutes = new Set(['preview-read', 'preview-write', 'reprice', 'lock-preview'])
for (const [route] of Object.entries(routes)) for (const scenario of scenarios) {
  const response = await run(route, scenario)
  const authorizedCompany = scenario.cookie ?? scenario.older
  const foreignId = !scenario.denied && idScopedRoutes.has(route) && scenario.target !== authorizedCompany
  const expectedStatus = scenario.denied ? 403 : foreignId ? 500 : 200
  assert.equal(response.status, expectedStatus, `${route}/${scenario.name}: ${JSON.stringify(response)}`)
  if (scenario.denied) { assert.equal(state.queries.length, 0); assert.equal(state.effects.length, 0) }
  else if (foreignId) {
    assert.equal(state.effects.length, 0)
    const lookup = state.queries.find(row => row.filters.id === (route === 'lock-preview' ? `run-${scenario.target}` : `underlay-${scenario.target}`))
    assert.equal(lookup.filters.company_id, authorizedCompany)
  }
  else {
    assert.equal(state.contexts[0].companyId, authorizedCompany)
    const memberRead = state.queries.find(row => row.table === 'company_memberships')
    assert.equal(memberRead.orders.length, 0, 'operational memberships really are unordered')
    const targetReads = state.queries.filter(row => row.filters.company_id)
    assert.ok(targetReads.length || state.effects.length)
    for (const row of targetReads) assert.equal(row.filters.company_id, authorizedCompany)
    for (const effect of state.effects) assert.equal(effect.params?.p_company_id ?? effect.payload?.company_id ?? effect.filters?.company_id, authorizedCompany)
    if (route === 'period-get') assert.equal(response.body.data.lock.lock_reason, `private-${authorizedCompany}-lock-reason`)
    if (route === 'preview-read') { assert.equal(response.body.data.totalExVat, authorizedCompany === 'A' ? -10 : -20); assert.equal(state.effects.length, 0) }
    if (['preview-write', 'preview-month', 'reprice'].includes(route)) assert.ok(state.effects.some(effect => effect.rpc === 'gridex_persist_pricing_run'))
    if (route === 'lock-preview') assert.ok(state.effects.some(effect => effect.rpc === 'gridex_lock_pricing_run'))
    if (route === 'generate') {
      const effect = state.effects.find(effect => effect.rpc === 'gridex_store_billing_underlay_batch')
      assert.ok(effect)
      assert.equal(effect.params.p_commands[0].underlay.customer_id, `customer-${authorizedCompany}`)
      assert.equal(effect.params.p_commands[0].underlay.status, 'pending')
      assert.equal(effect.params.p_commands[0].underlay.readiness_status, 'blocked')
    }
  }
  results.push({ route, scenario: scenario.name, status: response.status, canonical: state.contexts[0].companyId, requestedRecordCompany: scenario.target, writesOrRPCs: state.effects.length })
}
// Existing operational evidence/period locks remain real protections; no mocked
// helper claims that an invalid or locked run/underlay can be promoted.
for (const route of ['generate', 'preview-write', 'preview-month', 'reprice']) {
  const response = await run(route, scenarios[1], { periodLocked: true })
  assert.equal(response.status, ['generate', 'preview-write', 'preview-month'].includes(route) ? 409 : 500)
  assert.equal(state.effects.length, 0)
  results.push({ route, scenario: 'A-period-locked', status: response.status, writesOrRPCs: 0 })
}
const invalidLock = await run('lock-preview', scenarios[1], { blocked: true })
assert.equal(invalidLock.status, 500)
assert.equal(state.effects.length, 0)
results.push({ route: 'lock-preview', scenario: 'A-underlay-blocked', status: 500, writesOrRPCs: 0 })
const privateRead = await run('preview-read', scenarios[1], { blocked: true })
assert.equal(privateRead.status, 200)
assert.ok(privateRead.body.data.errors.includes('private-A-billing-blocker'))
assert.equal(state.effects.length, 0)
results.push({ route: 'preview-read', scenario: 'A-blocker-information-returned', status: 200, writesOrRPCs: 0 })
for (const route of ['preview-read', 'preview-write', 'reprice', 'lock-preview']) {
  const response = await run(route, { ...scenarios[3], target: 'B' })
  assert.equal(response.status, 500)
  assert.equal(state.effects.length, 0)
  const lookup = state.queries.find(row => row.filters.id === (route === 'lock-preview' ? 'run-B' : 'underlay-B'))
  assert.equal(lookup.filters.company_id, 'A')
  results.push({ route, scenario: 'cookie-A-foreign-B-id-not-found', status: 500, writesOrRPCs: 0 })
}

// Paused tenant history stays readable, while every writer binds and rejects
// before request-body processing or domain effects.
const pausedRead = await run('period-get', scenarios[1], { companyStatuses: { A: 'paused' } })
assert.equal(pausedRead.status, 200)
assert.equal(pausedRead.body.data.lock.lock_reason, 'private-A-lock-reason')
results.push({ route: 'period-get', scenario: 'paused-A-readable', status: 200, writesOrRPCs: 0 })
for (const route of ['period-lock', 'period-unlock', 'generate', 'preview-read', 'preview-write', 'preview-month', 'reprice', 'lock-preview']) {
  const response = await run(route, scenarios[1], { companyStatuses: { A: 'paused' } })
  assert.equal(response.status, 403)
  assert.equal(state.bodyReads, 0)
  assert.equal(state.effects.length, 0)
  results.push({ route, scenario: 'paused-A-write-blocked-before-body', status: 403, writesOrRPCs: 0 })
}

// The canonical SQL fixture excludes inactive memberships/assignments. These
// cases therefore never invent a mismatched selected company in the harness.
for (const extra of [{ membershipInactive: 'A' }, { assignmentInactive: 'A' }]) {
  const response = await run('period-lock', scenarios[1], extra)
  assert.equal(response.status, 403)
  assert.equal(state.bodyReads, 0)
  assert.equal(state.queries.length, 0)
  results.push({ route: 'period-lock', scenario: Object.keys(extra)[0], status: 403, writesOrRPCs: 0 })
}

// Authoritative platform state comes only from the canonical boolean. A selected
// active company needs no membership; no selected company never falls back.
for (const route of Object.keys(routes)) {
  const selected = await run(route, { ...scenarios[1], cookie: 'B', target: 'B' }, { platform: true })
  assert.equal(selected.status, 200, `${route}/platform-selected: ${JSON.stringify(selected)}`)
  assert.ok(state.queries.some(row => row.table === 'companies' && row.filters.id === 'B'))
  assert.ok(!state.queries.some(row => row.table === 'company_memberships'))
  results.push({ route, scenario: 'platform-selected-B-no-membership', status: 200, writesOrRPCs: state.effects.length })

  const unselected = await run(route, { ...scenarios[1], cookie: null }, { platform: true })
  assert.equal(unselected.status, 403)
  assert.equal(state.bodyReads, 0)
  assert.equal(state.queries.length, 0)
  assert.equal(state.effects.length, 0)
  results.push({ route, scenario: 'platform-no-selection-fails-closed', status: 403, writesOrRPCs: 0 })
}
console.log(JSON.stringify({ passed: results.length, results, sourceHashes: hashes }, null, 2))
