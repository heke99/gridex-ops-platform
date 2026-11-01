// Same-cohort source/component controls only. No database, Auth or network IO.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient as createEsmClient } from '@supabase/supabase-js'
import { appendCohortFile, adoptMain03Cohort, assertAdoptedCohortUnchanged, captureMain03Candidate, cohortHash, COHORT_ORACLE_SHA256,
  MAIN03_STEPS, parseCohortJson, readCohortFile, sealMain03Candidate, validateBusinessAdmission, verifyCohortGraph,
  recordPreparedDraftCandidate, observeCohortAppProcess, observeCohortRuntime, readCohortGraph,
  loadCohortAdmissionFromEnv,
  assertCohortScenarioEnvironment,
  type BusinessAdmission, type CohortPorts, type InputApproval, type ProtectedGraph } from '../scripts/simulation/track1/fixtures/main03Cohort'
import { chooseSafeSalt, formatMilliKwh } from '../scripts/simulation/track1/fixtures/synthetic'
import * as actualSynthetic from '../scripts/simulation/track1/fixtures/synthetic'
import type { Main03Fixture } from '../scripts/simulation/track1/fixtures/main03Fixture'

function main04Boundary(refuse = false) {
  const setup: Array<() => Promise<void>> = []
  const cases: Array<{ name: string; skipped: boolean }> = []
  const fixture = { companyId: 'same-company', actorUserId: 'same-actor', customerId: 'same-customer', pointId: 'same-point', contractId: 'same-contract',
    session: { userId: 'same-actor', companyId: 'same-company', cookieHeader: 'in-memory-only' }, params: { billingMonth: '2027-02' }, salt: 1, oracle: {} }
  const seed = vi.fn(async () => fixture)
  const requests = vi.fn(async () => ({ status: 200, body: { data: { sourceRows: 2688, underlays: 1, readyForPricing: 1 } } }))
  const provider = vi.fn(async () => undefined)
  const adopt = vi.fn(async (...args: unknown[]) => {
    if (!args[0]) throw new Error('missing actual service client')
    if (refuse) throw new Error('cohort_not_admitted')
    return { ...fixture, underlayId: 'same-underlay', cohortSha256: 'a'.repeat(64) }
  })
  const register = Object.assign((name: string) => cases.push({ name, skipped: false }), {
    skip: (name: string) => cases.push({ name, skipped: true }),
  })
  const runtime = { dbRead: vi.fn(() => ['same-underlay']), http: requests, lit: String, TIMINGS: [], timed: async (_: string, fn: () => Promise<unknown>) => fn(), writeArtifact: vi.fn() }
  const serviceClient = { componentPort: 'actual-imported-singleton' }
  const ports: Record<string, unknown> = {
    vitest: { beforeAll: (fn: () => Promise<void>) => setup.push(fn), afterAll: vi.fn(), describe: (_: string, fn: () => void) => fn(), expect, it: register, vi: { mock: vi.fn() } },
    '@/lib/supabase/service': { supabaseService: serviceClient }, '@/lib/billing/invoiceApprovedDispatch': {},
    '../fixtures/main03Fixture': { buildMain03Fixture: seed, DEFAULT_MAIN03_PARAMS: { billingMonth: '2027-02' } },
    '../fixtures/main03Cohort': { adoptMain03CohortFromEnv: adopt, assertAdoptedCohortUnchanged: vi.fn() },
    '../fixtures/substitutions': { SUBSTITUTIONS: [], resetSubstitutions: vi.fn(), substitute: vi.fn() },
    '../fixtures/runtime': runtime, '../fixtures/main04Support': { enableFileInvoiceProvider: provider }, '../fixtures/synthetic': {},
  }
  const filename = path.resolve('scripts/simulation/track1/scenarios/main04.test.ts')
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports: {}, require: (id: string) => { if (!(id in ports)) throw new Error(`uncontrolled_import:${id}`); return ports[id] } }, { filename })
  return { runSetup: () => setup[0](), seed, requests, provider, adopt, cases, serviceClient }
}

describe('actual MAIN04 beforeAll same-cohort boundary', () => {
  it('adopts the existing cohort with zero fixture seeding and zero generate-underlay requests', async () => {
    const control = main04Boundary()
    await control.runSetup()
    expect(control.seed).not.toHaveBeenCalled()
    expect(control.requests).not.toHaveBeenCalled()
    expect(control.adopt).toHaveBeenCalledOnce()
    expect(control.adopt.mock.calls[0][0] === control.serviceClient).toBe(true)
    expect(control.provider).toHaveBeenCalledWith('same-company')
  })

  it('refuses an unadmitted cohort before provider selection or any write', async () => {
    const control = main04Boundary(true)
    await expect(control.runSetup()).rejects.toThrow('cohort_not_admitted')
    expect(control.seed).not.toHaveBeenCalled()
    expect(control.requests).not.toHaveBeenCalled()
    expect(control.provider).not.toHaveBeenCalled()
  })

  it('registers the original MAIN04.04 approval/tamper body as explicitly held', () => {
    const control = main04Boundary()
    expect(control.cases.find(test => test.name.startsWith('MAIN04.04 '))?.skipped).toBe(true)
  })
})

const sourceRequire = createRequire(path.resolve('scripts/simulation/track1/fixtures/main03Cohort.ts'))
function sourceDefaults(): Main03Fixture['params'] {
  const filename = path.resolve('scripts/simulation/track1/fixtures/main03Fixture.ts'), exports: Record<string, unknown> = {}
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, require: (name: string) => name.startsWith('node:') ? sourceRequire(name) : name === './synthetic' ? actualSynthetic : name === 'vitest' ? { vi } : {} }, { filename })
  return exports.DEFAULT_MAIN03_PARAMS as Main03Fixture['params']
}
function sourceBegin(context: ReturnType<typeof protocolControl>) {
  const filename = path.resolve('scripts/simulation/track1/fixtures/main03Cohort.ts')
  const exports: { controlledContext?: unknown; controlledBegin?: (...args: unknown[]) => Promise<unknown> } = { controlledContext: { admission: context.admission, admissionSha256: 'a'.repeat(64), ports: context.ports } }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  // Replace only external admission/runtime IO. The actual begin body, real
  // private input files, actual default/salt validator and callback all execute.
  vm.runInNewContext(code + '\nloadCohortAdmissionFromEnv = () => exports.controlledContext; exports.controlledBegin = beginMain03CohortFromEnv;',
    { exports, process, Buffer, structuredClone, require: (name: string) => name === './synthetic.ts' ? actualSynthetic : sourceRequire(name) }, { filename })
  return exports.controlledBegin!
}
function registeredSetup(file: 'main03' | 'main04', cohortPorts: Record<string, unknown>, service: Record<string, unknown>, seed = vi.fn(), provider = vi.fn(async () => undefined)) {
  let setup: () => Promise<void> = async () => { throw new Error('missing setup') }
  const register = Object.assign(vi.fn(), { skip: vi.fn() })
  const ports: Record<string, unknown> = {
    vitest: { beforeAll: (callback: typeof setup) => { setup = callback }, afterAll: vi.fn(), describe: (_: string, callback: () => void) => callback(), it: register, expect, vi: { mock: vi.fn() } },
    '@/lib/supabase/service': service, '@/lib/billing/sourceBasis': {}, '@/lib/billing/invoiceApprovedDispatch': {},
    '../fixtures/main03Fixture': { buildMain03Fixture: seed, DEFAULT_MAIN03_PARAMS: sourceDefaults() }, '../fixtures/main03Cohort': cohortPorts,
    '../fixtures/substitutions': { resetSubstitutions: vi.fn(), SUBSTITUTIONS: [], substitute: vi.fn() },
    '../fixtures/runtime': { writeArtifact: vi.fn(), TIMINGS: [] }, '../fixtures/synthetic': actualSynthetic,
    '../fixtures/main04Support': { enableFileInvoiceProvider: provider },
  }
  const filename = path.resolve(`scripts/simulation/track1/scenarios/${file}.test.ts`)
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { exports: {}, require: (name: string) => { if (!(name in ports)) throw new Error('undeclared external port'); return ports[name] } }, { filename })
  return { setup: () => setup(), seed, provider }
}
function actualServiceSingleton(url: string, key: string): Record<string, unknown> {
  const filename = path.resolve('lib/supabase/service.ts'), exports: Record<string, unknown> = {}
  const sdk = sourceRequire('@supabase/supabase-js') as { createClient: (...args: unknown[]) => unknown }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const transport = vi.fn(() => { throw new Error('network forbidden') })
  vm.runInNewContext(code, { exports, require: (name: string) => name === '@/lib/env/supabaseServer' ? { getSupabaseServiceEnv: () => ({ url, serviceRoleKey: key }) } : name === '@supabase/supabase-js' ? {
    createClient: (u: unknown, k: unknown, options: Record<string, unknown>) => sdk.createClient(u, k, { ...options, global: { fetch: transport } }),
  } : (() => { throw new Error('undeclared external port') })() }, { filename })
  return { ...exports, transport }
}
function admittedEnvironment(c: ReturnType<typeof protocolControl>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', TRACK1_RUN_DIR: c.admission.runDir, TRACK1_STACK_JSON: c.admission.stack.path, TRACK1_APP_URL: c.admission.appUrl, TRACK1_APP_DIR: c.admission.appDir,
    TRACK1_APP_COMMIT: c.admission.runtime.appCommit, TRACK1_APP_PORT: '3101', TRACK1_DB_URL: c.admission.dbUrl, SIM_HOME: c.home,
    NEXT_PUBLIC_SUPABASE_URL: c.admission.authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.admission.anonKey, SUPABASE_SERVICE_ROLE_KEY: 'controlled-only-service-key' }
}

describe('preseed admitted defaults and actual cached service credentials', () => {
  it('rejects independently reviewed nondefault saltStart before actual MAIN03 callback can seed', async () => {
    const c = protocolControl(), params = { ...c.approval.params, saltStart: 100 }, chosen = chooseSafeSalt(params.billingMonth, params.saltStart, params.pricing), vector = cohortHash(chosen.oracle.intervals)
    for (const reference of c.approval.independentReviewRefs) c.changeFile(reference, review => { review.inputVectorSha256 = vector })
    c.changeFile(c.admission.inputApproval, input => { input.params = params; input.salt = chosen.salt; input.inputVectorSha256 = vector; input.independentReviewRefs = c.approval.independentReviewRefs })
    const seed = vi.fn(async () => c.fixture), entry = registeredSetup('main03', { beginMain03CohortFromEnv: sourceBegin(c), captureMain03Candidate: vi.fn() }, {}, seed)
    await expect(entry.setup()).rejects.toThrow('cohort_hold:')
    expect(seed).not.toHaveBeenCalled()
  })
  it('rejects the actual cached service.ts singleton stale key before actual MAIN04 provider selection', async () => {
    const c = protocolControl(); c.admission.harnessDir = process.cwd()
    const service = actualServiceSingleton(c.admission.authUrl, 'controlled-stale-service-key'), provider = vi.fn(async () => undefined)
    const entry = registeredSetup('main04', { adoptMain03CohortFromEnv: async (actualPassedClient: unknown) => {
      Reflect.apply(assertCohortScenarioEnvironment, undefined, [c.admission, actualPassedClient, admittedEnvironment(c), c.admission.harnessDir])
      return { ...c.fixture, underlayId: id(10), cohortSha256: 'a'.repeat(64) }
    } }, service, vi.fn(), provider)
    await expect(entry.setup()).rejects.toThrow('cohort_hold:cached_service_client_credential')
    expect(provider).not.toHaveBeenCalled()
    expect(service.transport).not.toHaveBeenCalled()
  })
  it('passes actual checked defaults explicitly to the actual MAIN03 seed boundary', async () => {
    const c = protocolControl(), seed = vi.fn<(params: Main03Fixture['params']) => Promise<typeof c.fixture>>(async () => c.fixture)
    const entry = registeredSetup('main03', { beginMain03CohortFromEnv: sourceBegin(c), captureMain03Candidate: vi.fn() }, {}, seed)
    await entry.setup()
    expect(seed).toHaveBeenCalledOnce(); expect(seed.mock.calls[0][0]).toEqual(sourceDefaults())
  })
  it('rejects another reviewed ambiguity-free salt when the actual default builder would choose the first safe salt', async () => {
    const c = protocolControl(), chosen = chooseSafeSalt(c.approval.params.billingMonth, c.approval.salt + 1, c.approval.params.pricing), vector = cohortHash(chosen.oracle.intervals)
    for (const reference of c.approval.independentReviewRefs) c.changeFile(reference, review => { review.inputVectorSha256 = vector })
    c.changeFile(c.admission.inputApproval, input => { input.salt = chosen.salt; input.inputVectorSha256 = vector; input.independentReviewRefs = c.approval.independentReviewRefs })
    const seed = vi.fn(async () => c.fixture), entry = registeredSetup('main03', { beginMain03CohortFromEnv: sourceBegin(c), captureMain03Candidate: vi.fn() }, {}, seed)
    await expect(entry.setup()).rejects.toThrow('main03_default_chosen_salt')
    expect(seed).not.toHaveBeenCalled(); expect(c.ports.observeRuntime).not.toHaveBeenCalled()
  })
  it('rejects a stale actual cached singleton before the actual MAIN03 seed boundary too', async () => {
    const c = protocolControl(); c.admission.harnessDir = process.cwd()
    const service = actualServiceSingleton(c.admission.authUrl, 'controlled-stale-service-key'), realBegin = sourceBegin(c), seed = vi.fn(async () => c.fixture)
    const entry = registeredSetup('main03', { beginMain03CohortFromEnv: async (client: unknown, defaults: unknown) => {
      Reflect.apply(assertCohortScenarioEnvironment, undefined, [c.admission, client, admittedEnvironment(c), c.admission.harnessDir])
      return realBegin(client, defaults)
    }, captureMain03Candidate: vi.fn() }, service, seed)
    await expect(entry.setup()).rejects.toThrow('cached_service_client_credential')
    expect(seed).not.toHaveBeenCalled(); expect(service.transport).not.toHaveBeenCalled()
  })
  it('accepts matching actual service.ts CJS credentials before provider selection without any SDK request', async () => {
    const c = protocolControl(); c.admission.harnessDir = process.cwd()
    const service = actualServiceSingleton(c.admission.authUrl, 'controlled-only-service-key'), provider = vi.fn(async () => undefined)
    const entry = registeredSetup('main04', { adoptMain03CohortFromEnv: async (client: unknown) => {
      Reflect.apply(assertCohortScenarioEnvironment, undefined, [c.admission, client, admittedEnvironment(c), c.admission.harnessDir])
      return { ...c.fixture, underlayId: id(10), cohortSha256: 'a'.repeat(64) }
    } }, service, vi.fn(), provider)
    await entry.setup(); expect(provider).toHaveBeenCalledWith(c.ids.companyId); expect(service.transport).not.toHaveBeenCalled()
  })
  it('rejects scalar URLs and digest-only or plain-object client declarations', () => {
    const c = protocolControl(), env = admittedEnvironment(c)
    for (const declaration of [c.admission.authUrl, { url: c.admission.authUrl, serviceRoleKeySha256: c.admission.serviceRoleKeySha256 },
      { supabaseUrl: c.admission.authUrl, supabaseKey: 'controlled-only-service-key' }]) {
      expect(() => assertCohortScenarioEnvironment(c.admission, declaration, env, c.admission.harnessDir)).toThrow('cached_service_client_layout')
    }
  })
  it('rejects accessor lookalikes without invoking their credential getter', () => {
    const c = protocolControl(), getter = vi.fn(() => 'controlled-only-service-key')
    const client = createEsmClient(c.admission.authUrl, 'controlled-only-service-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: () => { throw new Error('network forbidden') } } })
    Object.defineProperty(client, 'supabaseKey', { get: getter })
    expect(() => assertCohortScenarioEnvironment(c.admission, client, admittedEnvironment(c), c.admission.harnessDir)).toThrow('cached_service_client_layout')
    expect(getter).not.toHaveBeenCalled()
  })
  it('rejects actual SDK global credential overrides and changed initialized Auth credential headers', () => {
    const c = protocolControl(), transport = vi.fn(() => { throw new Error('network forbidden') })
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } }
    const overridden = createEsmClient(c.admission.authUrl, 'controlled-only-service-key', { ...options, global: { ...options.global, headers: { apikey: 'controlled-override' } } })
    expect(() => assertCohortScenarioEnvironment(c.admission, overridden, admittedEnvironment(c), c.admission.harnessDir)).toThrow('cached_service_credential_override')
    const changed = createEsmClient(c.admission.authUrl, 'controlled-only-service-key', options)
    const headers = Reflect.get(Reflect.get(changed, 'auth'), 'headers') as Record<string, string>
    headers.Authorization = 'Bearer controlled-override'
    expect(() => assertCohortScenarioEnvironment(c.admission, changed, admittedEnvironment(c), c.admission.harnessDir)).toThrow('cached_service_credential_override')
    expect(transport).not.toHaveBeenCalled()
  })
})

const homes: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) }) // only this test's mkdtemp homes
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function protocolControl() {
  const home = mkdtempSync(path.join(tmpdir(), 'cohort-component-')); chmodSync(home, 0o700); homes.push(home)
  const runDir = path.join(home, 'run'); mkdirSync(runDir, { mode: 0o700 })
  const instant = Date.parse('2026-11-01T10:00:00Z')
  const params = { billingMonth: '2027-02', sites: 1, priceArea: 'SE3' as const, gridOwner: 'synthetic' as const, contractStartDate: '2026-10-15',
    pricing: { spotWeightPercent: 100 as const, markupOrePerKwh: 4, monthlyFeeSek: 49, vatPercent: 25 }, delivery: { kind: 'active' as const }, saltStart: 1 }
  const { salt, oracle } = chooseSafeSalt(params.billingMonth, params.saltStart, params.pricing)
  const ids = { companyId: id(1), actorUserId: id(2), customerId: id(3), siteId: id(4), pointId: id(5), contractId: id(6), supplyPeriodId: id(7), gridOwnerId: id(8), dataRequestId: id(9) }
  const ref = (name: string, value: unknown) => appendCohortFile(path.join(home, name), value, home)
  const inputVectorSha256 = cohortHash(oracle.intervals)
  const approval: InputApproval = { basisKind: 'separately_qualified_synthetic_input', oracleSha256: COHORT_ORACLE_SHA256, params, salt, inputVectorSha256,
    independentReviewRefs: ['A', 'B'].map(reviewerId => ref(`input-review-${reviewerId}.json`, { reviewerId, decision: 'APPROVE_COMPONENT_SYNTHETIC_INPUT_ONLY', inputVectorSha256, basisKind: 'separately_qualified_synthetic_input', oracleSha256: COHORT_ORACLE_SHA256 })),
    substitutions: ['synthetic native-fixture source; transport/browser/original1809.51 NOT_PROVEN'] }
  const inputApproval = ref('input.json', approval)
  const runtime = { appCommit: 'a'.repeat(40), appTree: 'b'.repeat(40), harnessCommit: 'c'.repeat(40), harnessTree: 'd'.repeat(40), nextBuildId: 'same-build', daemonId: 'same-daemon',
    databaseSystemIdentifier: '12345', serverMajor: 17, catalogSha256: '1'.repeat(64), ledgerSha256: '2'.repeat(64), resourcesSha256: '3'.repeat(64), immutableFilesSha256: '4'.repeat(64), custodySha256: '5'.repeat(64), appProcessSha256: '7'.repeat(64) }
  const sourceManifest = Object.fromEntries(['scripts/simulation/track1/scenarios/main03.test.ts', 'scripts/simulation/track1/scenarios/main04.test.ts',
    'scripts/simulation/track1/fixtures/main03Cohort.ts', '__tests__/simulation-main03-cohort-handoff.test.ts'].map(file => [file, '6'.repeat(64)]))
  const stack = ref('stack.json', { runtime, phase: 'separate controlled business phase' })
  const admission: BusinessAdmission = { schema: 'track1-cohort-business-admission-v1', reportKind: 'business_cohort', phase: 'MAIN03_CANDIDATE', campaignId: 'component-campaign',
    operationId: 'main03-operation', producerId: 'source-producer', runId: 'same-run', createdAtUtc: new Date(instant - 10000).toISOString(), expiresAtUtc: new Date(instant + 600000).toISOString(),
    privateHome: home, simHome: home, runDir, appDir: '/controlled-app', harnessDir: '/controlled-harness', dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', appUrl: 'http://127.0.0.1:3101', authUrl: 'http://127.0.0.1:54321', anonKey: 'in-memory-only', serviceRoleKeySha256: createBytesHash(Buffer.from('controlled-only-service-key')),
    runtime, appProcess: { pid: 1234, startTicks: '123', pgid: 1234, sid: 1234, uid: process.getuid!(), cwd: '/controlled-app', exe: '/controlled-node', exeSha256: 'a'.repeat(64), commandSha256: 'b'.repeat(64) },
    sourceManifest, buildManifest: ref('build.json', {}), immutableFiles: [stack], stack, resourceManifest: ref('resources.json', {}), custody: { refs: {}, receipts: [] }, inputApproval,
    candidatePath: path.join(home, 'candidate.json'), graphPath: path.join(home, 'graph.json'), authPath: path.join(home, 'auth.json'), sealedPath: path.join(home, 'sealed.json'),
    adoptedPath: path.join(home, 'adopted.json'), draftPath: path.join(home, 'draft.json') }
  const terms = { pricing_model: 'spot', energy_direction: 'consumption', vat_rate: 0.25, base_components: [{ source_type: 'spot', weight_percent: 100, price_area: 'SE3' }],
    price_components: [{ calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh' }, { calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month' }] }
  const graph: ProtectedGraph = { sources: [], normalized: [], physical: [], items: [],
    underlays: [{ id: id(10), company_id: ids.companyId, customer_id: ids.customerId, metering_point_id: ids.pointId, contract_id: ids.contractId, supply_period_id: ids.supplyPeriodId,
      site_id: ids.siteId, price_area: 'SE3', underlay_year: 2027, underlay_month: 2, status: 'validated', readiness_status: 'ready', energy_direction: 'consumption', settlement_type: 'invoice', total_kwh: oracle.totalKwhText,
      billing_period_start: '2027-02-01', billing_period_end: '2027-03-01', source_meter_value_count: 2688, missing_values_count: 0,
      payload: { billing_period_start_instant: new Date(oracle.month.startMs).toISOString(), billing_period_end_instant: new Date(oracle.month.endMs).toISOString(), billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true },
      contract_price_snapshot_id: id(11), pricing_snapshot: terms }],
    bindings: [{ company_id: ids.companyId, underlay_id: id(10), actor_user_id: ids.actorUserId, finalized_at: '2026-11-01T09:00:00Z', source_basis: { original: true }, source_basis_hash: 'a'.repeat(64), bodyHashMatches: true, exact_total_kwh: oracle.totalKwhText }],
    qualified: [{ id: id(10), qualified: true, correctionRequired: false, totalKwh: oracle.totalKwhText }],
    contracts: [{ id: ids.contractId, company_id: ids.companyId, customer_id: ids.customerId, status: 'signed' }], supplies: [{ id: ids.supplyPeriodId, company_id: ids.companyId, contract_id: ids.contractId, metering_point_id: ids.pointId, status: 'active' }],
    priceSnapshots: [{ id: id(11), company_id: ids.companyId, contract_id: ids.contractId, price_plan_version_id: id(12), snapshot_json: terms, snapshot_hash: 'b'.repeat(64) }],
    priceVersions: [{ id: id(12), company_id: ids.companyId, content_sha256: 'c'.repeat(64), locked_at: '2026-11-01T09:00:00Z', status: 'published' }],
    spots: [], spotLocks: [{ source: 'elprisetjustnu', price_area: 'SE3', billing_month: '2027-02', status: 'locked', locked_at: '2026-11-01T09:00:00Z', verified_at: '2026-11-01T08:00:00Z', covered_duration_minutes: 40320, expected_duration_minutes: 40320, quality_issues: [], source_checksum: 'd'.repeat(64) }],
    pricingRuns: [{ id: id(13), status: 'draft', billing_underlay_id: id(10) }], pricingEvidence: [], invoices: [], exportItems: [], exports: [] }
  const days: Main03Fixture['days'] = []
  for (let day = 1; day <= 28; day++) {
    const sourceId = id(100 + day), transactionRef = `tx-${day}`, bgmReference = `bgm-${day}`, rawSha256 = day.toString(16).padStart(64, '0')
    graph.sources.push({ id: sourceId, company_id: ids.companyId, environment: 'test', customer_id: ids.customerId, site_id: ids.siteId, metering_point_id: ids.pointId, grid_owner_id: ids.gridOwnerId, grid_owner_data_request_id: ids.dataRequestId, direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', transaction_ref: transactionRef, bgm: bgmReference, raw_sha256: rawSha256 })
    days.push({ day, sourceId, transactionRef, bgmReference, rawSha256, normalizedIds: [], meteringValueIds: [], ingestMs: 0, persistMs: 0 })
  }
  for (const [index, interval] of oracle.intervals.entries()) {
    const physical = id(10000 + index), normalized = id(20000 + index), start = new Date(interval.startMs).toISOString(), end = new Date(interval.endMs).toISOString(), quantity = formatMilliKwh(interval.milliKwh), day = days[interval.day - 1]
    graph.normalized.push({ id: normalized, company_id: ids.companyId, customer_id: ids.customerId, site_id: ids.siteId, direction: 'consumption', metering_point_id: ids.pointId, supply_period_id: ids.supplyPeriodId, revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', unit: 'kWh',
      source_message_id: day.sourceId, source_transaction_reference: day.transactionRef, source_metering_value_id: physical, period_start: start, period_end: end, quantity_kwh: quantity })
    graph.physical.push({ id: physical, company_id: ids.companyId, customer_id: ids.customerId, site_id: ids.siteId, metering_point_id: ids.pointId, source_ediel_message_id: day.sourceId, is_current: true, period_start: start, period_end: end, quantity_kwh: quantity })
    graph.items.push({ id: id(30000 + index), company_id: ids.companyId, billing_underlay_id: id(10), source_normalized_metering_value_id: normalized, meter_value_id: physical, metering_point_id: ids.pointId, contract_id: ids.contractId,
      energy_direction: 'consumption', settlement_type: 'invoice', unit: 'kWh', period_start: start, period_end: end, quantity_kwh: quantity })
    day.normalizedIds.push(normalized); day.meteringValueIds.push(physical)
    if (index % 4 === 0) graph.spots.push({ id: id(50000 + index / 4), source: 'elprisetjustnu', price_area: 'SE3', resolution: 'hourly', time_start: start, time_end: new Date(interval.startMs + 3600000).toISOString(), sek_per_kwh: (interval.spotE5 / 100000).toFixed(5) })
  }
  const fixture = { ...ids, params, salt, oracle, days, session: { userId: ids.actorUserId, companyId: ids.companyId, cookieHeader: `gridex_admin_selected_company_id=${ids.companyId}; controlled=not-a-real-token` }, externalPointId: 'synthetic', ownEdielId: 'synthetic', issuerEdielId: 'synthetic', spotMonthlyLock: {} }
  const ports: CohortPorts = { now: () => instant, observeRuntime: vi.fn(async () => structuredClone(runtime)), readGraph: vi.fn(async () => structuredClone(graph)),
    authenticate: vi.fn(async () => ({ userId: ids.actorUserId, companyId: ids.companyId, expiresAtMs: instant + 3600000, permissions: ['billing_underlay.export', 'billing_underlay.read'] })) }
  const candidate = () => captureMain03Candidate({ admission, ports }, fixture, [...MAIN03_STEPS], { 'MAIN03.05': { provokedUnknownOutcome: true, retryStatus: 200 } })
  const terminal = async () => {
    admission.candidate = await candidate(); admission.phase = 'MAIN03_SEAL'
    const raw = { success: true, numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0,
      testResults: [{ name: path.join(admission.harnessDir, 'scripts/simulation/track1/scenarios/main03.test.ts'), status: 'passed', message: '', assertionResults: MAIN03_STEPS.map(step => ({ title: `${step} original scenario`, status: 'passed', failureMessages: [] })) }] }
    const reportFile = (name: string, value: unknown) => appendCohortFile(path.join(runDir, name), value, home)
    const normalized = { runId: admission.runId, runDir, scenarioFile: 'track1/scenarios/main03.test.ts', exitCode: 0, error: null, vitest: Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'testResults')),
      steps: MAIN03_STEPS.map(step => ({ declaredStepId: step, status: 'passed', failure: null })) }
    const logPath = path.join(runDir, 'run.log'); writeFileSync(logPath, 'controlled test producer\nwallMs 1\nexit 0\n', { mode: 0o600 })
    admission.reports = { raw: reportFile('report.json', raw), normalized: ref('SIM_REPORT.json', normalized),
      meta: reportFile('run-meta.json', { harnessCommit: runtime.harnessCommit, appCommit: runtime.appCommit, harnessDirty: false, appDirty: false, scenarioSha256: sourceManifest['scripts/simulation/track1/scenarios/main03.test.ts'], runStartedAtUtc: new Date(instant - 1000).toISOString(), scenarioFile: 'track1/scenarios/main03.test.ts', stack: readCohortFile(stack, home) }),
      log: { path: logPath, sha256: createBytesHash(readFileSync(logPath)) } }
    admission.terminal = ref('terminal.json', { schema: 'main03-observed-terminal-process-v1', runId: admission.runId, operationId: admission.operationId, waitObserved: true, exitCode: 0, pid: 2147483647, startTicks: '123', endedAtUtc: new Date(instant + 1).toISOString(), reports: admission.reports })
    admission.resolution = ref('resolution.json', { schema: 'main03-independent-native-operation-resolution-v1', runId: admission.runId, operationId: admission.operationId, databaseSystemIdentifier: runtime.databaseSystemIdentifier,
      outcome: 'COMMITTED_EXACT_COHORT_NO_INFLIGHT_ORIGINAL_HANDLER', proofKind: 'INDEPENDENT_NATIVE_OPERATION_LIFECYCLE', nativeOperationId: 'controlled-handler-123', independentEvidence: ['A', 'B'].map(reviewerId => ref(`native-review-${reviewerId}.json`, {
        schema: 'main03-native-operation-lifecycle-review-v1', reviewerId, decision: 'APPROVE_CONTROLLED_FAKE_LIFECYCLE_ONLY', runId: admission.runId, operationId: admission.operationId, nativeOperationId: 'controlled-handler-123', terminalProcessSha256: admission.terminal!.sha256,
        candidateSha256: admission.candidate!.sha256, backendRuntimeSha256: cohortHash(runtime) })) })
    return { raw, normalized }
  }
  const seal = async () => { await terminal(); admission.sealed = await sealMain03Candidate(admission, ports); admission.phase = 'MAIN04_PREPARE_REVIEW'; return admission.sealed }
  const changeFile = (reference: { path: string; sha256: string }, mutate: (value: Record<string, unknown>) => void) => {
    const value = JSON.parse(readFileSync(reference.path, 'utf8')); mutate(value); const bytes = Buffer.from(JSON.stringify(value)); writeFileSync(reference.path, bytes); reference.sha256 = createBytesHash(bytes)
  }
  return { home, graph, ids, oracle, fixture, admission, ports, candidate, terminal, seal, ref, approval, changeFile }
}

import { createHash } from 'node:crypto'
const createBytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('actual cohort candidate / terminal seal / independent adoption', () => {
  it('keeps the same 28 source IDs, 2688 physical/normalized/item edges and underlay through adoption', async () => {
    const c = protocolControl(); await c.seal()
    const adopted = await adoptMain03Cohort(c.admission, 'a'.repeat(64), c.ports)
    expect(adopted.underlayId).toBe(id(10)); expect(adopted.companyId).toBe(c.ids.companyId)
    expect(adopted.oracle.totalMilliKwh).toBe(c.oracle.totalMilliKwh)
    expect(readCohortFile<Record<string, unknown>>({ path: c.admission.adoptedPath, sha256: createBytesHash(readFileSync(c.admission.adoptedPath)) }, c.home).state).toBe('ADOPTED_READ_ONLY_BEFORE_PREPARE')
    await assertAdoptedCohortUnchanged(adopted)
    expect(readFileSync(c.admission.candidatePath, 'utf8')).not.toContain(c.fixture.session.cookieHeader)
    expect(readFileSync(c.admission.sealedPath, 'utf8')).not.toContain(c.fixture.session.cookieHeader)
  })

  it.each([[], ['MAIN03.01'], [...MAIN03_STEPS].reverse()].map(completed => ({ completed })))('refuses partial/misordered completion $completed', async ({ completed }) => {
    const c = protocolControl()
    await expect(captureMain03Candidate({ admission: c.admission, ports: c.ports }, c.fixture, completed, {})).rejects.toThrow('five_complete_steps_required')
    expect(c.ports.readGraph).not.toHaveBeenCalled()
  })

  it('cannot seal a green candidate without a separately observed terminal process and native lifecycle proof', async () => {
    const c = protocolControl(); c.admission.candidate = await c.candidate(); c.admission.phase = 'MAIN03_SEAL'
    await expect(sealMain03Candidate(c.admission, c.ports)).rejects.toThrow('terminal_and_native_resolution_required')
  })

  it.each([
    ['nonzero process', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.terminal!, v => { v.exitCode = 1 })],
    ['global Vitest failure', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.reports!.raw, v => { v.success = false })],
    ['hook failure', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.reports!.raw, v => { (v.testResults as Array<{ message: string }>)[0].message = 'afterAll failed' })],
    ['copied run', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.reports!.normalized, v => { v.runId = 'copied' })],
    ['skipped scenario', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.reports!.raw, v => { (v.testResults as Array<{ assertionResults: Array<{ status: string }> }>)[0].assertionResults[0].status = 'pending' })],
    ['stable polls only', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.resolution!, v => { v.proofKind = 'STABLE_POLLS' })],
    ['unresolved original handler', (c: ReturnType<typeof protocolControl>) => c.changeFile(c.admission.resolution!, v => { v.outcome = 'UNKNOWN' })],
  ])('refuses %s at actual seal', async (_name, mutate) => {
    const c = protocolControl(); await c.terminal(); mutate(c)
    await expect(sealMain03Candidate(c.admission, c.ports)).rejects.toThrow('cohort_hold:')
  })

  it.each([
    ['lost source', (g: ProtectedGraph) => { g.sources.pop() }], ['duplicate interval', (g: ProtectedGraph) => { g.normalized[1] = { ...g.normalized[0] } }],
    ['changed quantity', (g: ProtectedGraph) => { g.normalized[0].quantity_kwh = '9' }], ['foreign source', (g: ProtectedGraph) => { g.sources[0].company_id = id(999) }],
    ['rewired physical', (g: ProtectedGraph) => { g.normalized[0].source_metering_value_id = g.physical[1].id }],
    ['rewired item', (g: ProtectedGraph) => { g.items[0].source_normalized_metering_value_id = g.normalized[1].id }],
    ['changed UTC end', (g: ProtectedGraph) => { g.normalized[0].period_end = g.normalized[0].period_start }],
    ['different spot inputs', (g: ProtectedGraph) => { g.spots[0].sek_per_kwh = '7.12345' }], ['unlocked month', (g: ProtectedGraph) => { g.spotLocks[0].status = 'verified' }],
    ['different contract terms', (g: ProtectedGraph) => { (g.priceSnapshots[0].snapshot_json as { price_components: Array<{ amount: number }> }).price_components[0].amount = 7 }],
    ['unqualified actual binding', (g: ProtectedGraph) => { g.qualified[0].qualified = false }], ['basis body mismatch', (g: ProtectedGraph) => { g.bindings[0].bodyHashMatches = false }],
    ['other settlement', (g: ProtectedGraph) => { g.underlays[0].settlement_type = 'credit_invoice' }], ['extra monthly underlay', (g: ProtectedGraph) => { g.underlays.push({ ...g.underlays[0], id: id(999) }) }],
  ])('rejects %s through the real full-vector verifier', (_name, mutate) => {
    const c = protocolControl(); mutate(c.graph)
    expect(() => verifyCohortGraph(c.graph, c.ids, c.oracle)).toThrow('cohort_hold:')
  })

  it('rejects a report-only green seal when the live graph differs from the candidate', async () => {
    const c = protocolControl(); await c.terminal(); c.graph.sources[0].raw_sha256 = 'f'.repeat(64)
    await expect(sealMain03Candidate(c.admission, c.ports)).rejects.toThrow('original_source_identity')
  })
  it('refuses a candidate whose claimed original 28-day source vector duplicates one day and omits another', async () => {
    const c = protocolControl(); c.fixture.days[1] = { ...c.fixture.days[0] }
    await expect(c.candidate()).rejects.toThrow('original_source_bijection')
  })

  it.each(['databaseSystemIdentifier', 'daemonId', 'resourcesSha256', 'catalogSha256', 'ledgerSha256', 'nextBuildId', 'appCommit', 'harnessCommit'] as const)('rejects backend/source drift in %s', async key => {
    const c = protocolControl(); await c.seal(); c.ports.observeRuntime = vi.fn(async () => ({ ...c.admission.runtime, [key]: 'changed' }))
    await expect(adoptMain03Cohort(c.admission, 'a'.repeat(64), c.ports)).rejects.toThrow('runtime_identity')
  })

  it.each(['actor', 'company', 'expiry', 'permission'])('rejects actual Auth %s before an adoption receipt exists', async kind => {
    const c = protocolControl(); await c.seal(); c.ports.authenticate = vi.fn(async () => ({ userId: kind === 'actor' ? id(99) : c.ids.actorUserId, companyId: kind === 'company' ? id(99) : c.ids.companyId,
      expiresAtMs: Date.parse('2026-11-01T10:00:00Z') + (kind === 'expiry' ? 1 : 3600000), permissions: kind === 'permission' ? [] : ['billing_underlay.read', 'billing_underlay.export'] }))
    await expect(adoptMain03Cohort(c.admission, 'a'.repeat(64), c.ports)).rejects.toThrow('cohort_hold:')
  })

  it('refuses an old stored/generated total as original1809.51 input qualification', async () => {
    const c = protocolControl()
    for (const reference of c.approval.independentReviewRefs) c.changeFile(reference, review => { review.basisKind = 'original_frozen_input' })
    c.changeFile(c.admission.inputApproval, input => { input.basisKind = 'original_frozen_input'; input.independentReviewRefs = c.approval.independentReviewRefs })
    await expect(c.candidate()).rejects.toThrow('original_frozen_money_input_unqualified')
  })

  it('reobserves before prepare and refuses a foreign writer after adoption', async () => {
    const c = protocolControl(); await c.seal(); const adopted = await adoptMain03Cohort(c.admission, 'a'.repeat(64), c.ports)
    c.graph.invoices.push({ id: id(999) })
    await expect(assertAdoptedCohortUnchanged(adopted)).rejects.toThrow('changed_before_prepare')
  })

  async function preparedControl() {
    const c = protocolControl(); await c.seal(); const adopted = await adoptMain03Cohort(c.admission, 'a'.repeat(64), c.ports)
    const money = { amount_ex_vat: c.oracle.totalExVatCents / 100, vat_amount: c.oracle.vatCents.total / 100, amount_inc_vat: c.oracle.totalIncVatCents / 100 }
    const interval_evidence = c.oracle.intervals.map((interval, index) => ({ id: id(40000 + index), billingUnderlayItemId: id(30000 + index), meteringIntervalStart: new Date(interval.startMs).toISOString(),
      meteringIntervalEnd: new Date(interval.endMs).toISOString(), consumptionKwh: interval.milliKwh / 1000, priceSekPerKwh: interval.spotE5 / 100000, priceSourceId: id(50000 + Math.floor(index / 4)), priceArea: 'SE3' }))
    const snapshot = { billing_underlay_id: id(10), total_kwh: c.oracle.totalMilliKwh / 1000, subtotal_sek_ex_vat: money.amount_ex_vat, vat_sek: money.vat_amount, total_sek_inc_vat: money.amount_inc_vat, interval_evidence,
      pricing_lines: [{ amountExVat: c.oracle.lines.spotCents / 100, vatAmount: c.oracle.vatCents.spot / 100, metadata: { source_type: 'spot' }, unit: 'kWh' },
        { amountExVat: c.oracle.lines.markupCents / 100, vatAmount: c.oracle.vatCents.markup / 100, metadata: {}, unit: 'kWh' }, { amountExVat: c.oracle.lines.monthlyFeeCents / 100, vatAmount: c.oracle.vatCents.monthlyFee / 100, metadata: {}, unit: 'månad' }] }
    c.graph.pricingRuns.push({ id: id(14), company_id: c.ids.companyId, billing_underlay_id: id(10), status: 'locked', locked_at: '2026-11-01T10:00:01Z', total_ex_vat: money.amount_ex_vat, vat_amount: money.vat_amount, total_inc_vat: money.amount_inc_vat })
    c.graph.invoices.push({ id: id(15), company_id: c.ids.companyId, billing_underlay_id: id(10), invoice_export_item_id: id(16), calculation_snapshot: snapshot, calculation_snapshot_sha256: 'f'.repeat(64), consumption_kwh: c.oracle.totalMilliKwh / 1000, ...money })
    c.graph.exportItems.push({ id: id(16), company_id: c.ids.companyId, billing_underlay_id: id(10), pricing_run_id: id(14), total_kwh: c.oracle.totalMilliKwh / 1000, ...money })
    c.graph.pricingEvidence = interval_evidence.map(entry => ({ id: entry.id, company_id: c.ids.companyId, pricing_run_id: id(14), billing_underlay_id: id(10), billing_underlay_item_id: entry.billingUnderlayItemId,
      metering_interval_start: entry.meteringIntervalStart, metering_interval_end: entry.meteringIntervalEnd, consumption_kwh: entry.consumptionKwh, price_sek_per_kwh: entry.priceSekPerKwh, price_source_id: entry.priceSourceId, price_area: entry.priceArea }))
    return { ...c, adopted, snapshot }
  }

  it('records the newly observed locked pricing ID, complete stored snapshot and explicit independent-review HOLD', async () => {
    const c = await preparedControl(), result = await recordPreparedDraftCandidate(c.adopted, { observed: true })
    const candidate = readCohortFile<Record<string, unknown>>(result, c.home, 4 * 1024 * 1024)
    expect(candidate.pricingRunId).toBe(id(14)); expect(candidate.priorPricingRuns).toEqual([id(13)])
    expect(candidate.completeStoredSnapshotSha256).toBe(cohortHash(c.snapshot))
    expect(candidate.independentDraftAcceptance).toBe('NOT_ESTABLISHED')
  })

  it.each([
    ['fresh invoice money', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.graph.invoices[0].amount_inc_vat = 9999 }, 'fresh_money_oracle'],
    ['fresh export item money', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.graph.exportItems[0].amount_ex_vat = 9999 }, 'fresh_money_oracle'],
    ['fresh locked pricing money', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.graph.pricingRuns[1].vat_amount = 9999 }, 'fresh_money_oracle'],
    ['nested snapshot money', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.snapshot.total_sek_inc_vat = 9999 }, 'fresh_snapshot_money_oracle'],
    ['nested line money', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.snapshot.pricing_lines[0].amountExVat += 1 }, 'fresh_line_money_oracle'],
    ['compensating per-line VAT', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.snapshot.pricing_lines[0].vatAmount = (c.oracle.vatCents.spot + 1) / 100; c.snapshot.pricing_lines[1].vatAmount = (c.oracle.vatCents.markup - 1) / 100 }, 'fresh_line_vat_oracle'],
    ['snapshot spot price', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.snapshot.interval_evidence[0].priceSekPerKwh = 9 }, 'draft_evidence_price'],
    ['evidence source ID', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.snapshot.interval_evidence[0].id = id(99999) }, 'draft_native_evidence_edge'],
    ['native evidence quantity', (c: Awaited<ReturnType<typeof preparedControl>>) => { c.graph.pricingEvidence[0].consumption_kwh = 9 }, 'draft_native_evidence_quantity'],
  ])('refuses %s even if the earlier MAIN04 draft observation was green', async (_name, mutate, expected) => {
    const c = await preparedControl(); mutate(c)
    await expect(recordPreparedDraftCandidate(c.adopted, { staleEarlierObservation: 'green' })).rejects.toThrow(expected)
  })
})

describe('private immutable protocol IO and distinct business phase', () => {
  it('rejects duplicate nested keys, nonfinite values, trailing bytes and prototype keys', () => {
    for (const raw of ['{"a":{"x":1,"x":2}}', '{"x":NaN}', '{"x":1}junk', '{"__proto__":{}}']) expect(() => parseCohortJson(raw)).toThrow('cohort_hold:')
  })
  it('refuses existing or symlink output and preserves the original bytes', () => {
    const c = protocolControl(), original = c.ref('immutable.json', { exact: 'original' })
    expect(() => appendCohortFile(original.path, { wrong: true }, c.home)).toThrow()
    expect(readCohortFile(original, c.home)).toEqual({ exact: 'original' })
    const link = path.join(c.home, 'link.json'); symlinkSync(original.path, link)
    expect(() => readCohortFile({ path: link, sha256: original.sha256 }, c.home)).toThrow('private_symlink')
  })
  it('rejects public file modes, changed byte hashes and auth/report path aliases', () => {
    const c = protocolControl(), file = c.ref('private.json', { safe: true }); chmodSync(file.path, 0o644)
    expect(() => readCohortFile(file, c.home)).toThrow('private_file_mode'); chmodSync(file.path, 0o600)
    expect(() => readCohortFile({ ...file, sha256: 'f'.repeat(64) }, c.home)).toThrow('file_changed')
    c.admission.authPath = path.join(c.admission.runDir, 'auth.json')
    expect(() => validateBusinessAdmission(c.admission, 'MAIN03_CANDIDATE', c.ports.now())).toThrow('receipt_or_auth_inside_report')
    c.admission.runDir += '/'
    expect(() => validateBusinessAdmission(c.admission, 'MAIN03_CANDIDATE', c.ports.now())).toThrow('run_directory_path')
  })
  it('explicitly refuses current infrastructure smoke and expired admissions', () => {
    const c = protocolControl(); Object.assign(c.admission, { reportKind: 'infrastructure_smoke' })
    expect(() => validateBusinessAdmission(c.admission, 'MAIN03_CANDIDATE', c.ports.now())).toThrow('distinct_business_phase_required')
    c.admission.reportKind = 'business_cohort'; c.admission.expiresAtUtc = '2026-11-01T09:00:00Z'
    expect(() => validateBusinessAdmission(c.admission, 'MAIN03_CANDIDATE', c.ports.now())).toThrow('phase_expired')
  })
})

describe('actual entry and read-only system adapters', () => {
  it('actual MAIN03 refuses missing business admission before fixture seeding; partial afterAll mints nothing', async () => {
    let setup: () => Promise<void> = async () => { throw new Error('missing setup') }, finish = setup
    const seed = vi.fn(), capture = vi.fn(), artifact = vi.fn()
    const ports: Record<string, unknown> = {
      vitest: { beforeAll: (fn: typeof setup) => { setup = fn }, afterAll: (fn: typeof setup) => { finish = fn }, describe: (_: string, fn: () => void) => fn(), it: vi.fn(), expect, vi: { mock: vi.fn() } },
      '@/lib/supabase/service': { SUPABASE_SERVICE_URL: 'http://127.0.0.1:54321' }, '@/lib/billing/sourceBasis': {},
      '../fixtures/main03Fixture': { buildMain03Fixture: seed, DEFAULT_MAIN03_PARAMS: { billingMonth: '2027-02' } },
      '../fixtures/main03Cohort': { beginMain03CohortFromEnv: async () => { throw new Error('separate_root_pinned_business_admission_missing') }, captureMain03Candidate: capture },
      '../fixtures/substitutions': { resetSubstitutions: vi.fn(), SUBSTITUTIONS: [] },
      '../fixtures/runtime': { writeArtifact: artifact }, '../fixtures/synthetic': {},
    }
    const filename = path.resolve('scripts/simulation/track1/scenarios/main03.test.ts')
    vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports: {}, require: (name: string) => { if (!(name in ports)) throw new Error(`uncontrolled_import:${name}`); return ports[name] } }, { filename })
    await expect(setup()).rejects.toThrow('separate_root_pinned_business_admission_missing')
    await finish(); expect(seed).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(artifact).toHaveBeenCalledTimes(3)
  })

  function processControl() {
    const c = protocolControl(), processIdentity = c.admission.appProcess
    const fields = Array<string>(25).fill('0'); fields[0] = 'S'; fields[2] = String(processIdentity.pgid); fields[3] = String(processIdentity.sid); fields[19] = processIdentity.startTicks
    const bytes: Record<string, Buffer> = {
      '/proc/1234/stat': Buffer.from(`1234 (next server) ${fields.join(' ')}`),
      '/proc/1234/status': Buffer.from(`Uid:\t${processIdentity.uid}\t${processIdentity.uid}\t${processIdentity.uid}\t${processIdentity.uid}\n`),
      '/proc/1234/exe': Buffer.from('controlled-node-image'), '/proc/1234/cmdline': Buffer.from('node\0controlled-app\0'),
      '/proc/net/tcp': Buffer.from('header\n0: 0100007F:0C1D 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 4242\n'), '/proc/net/tcp6': Buffer.from('header\n'),
    }
    processIdentity.exeSha256 = createBytesHash(bytes['/proc/1234/exe']); processIdentity.commandSha256 = createBytesHash(bytes['/proc/1234/cmdline'])
    const links: Record<string, string> = { '/proc/1234/cwd': processIdentity.cwd, '/proc/1234/exe': processIdentity.exe, '/proc/1234/fd/3': 'socket:[4242]' }
    const io = { read: (file: string) => { if (!bytes[file]) throw new Error('unexpected proc read'); return bytes[file] }, link: (file: string) => { if (!links[file]) throw new Error('unexpected proc link'); return links[file] }, entries: () => ['3'] }
    return { ...c, processIdentity, bytes, links, io }
  }
  it('observes exact Node image/session/start ticks and actual loopback listener inode without signals', () => {
    const c = processControl()
    expect(observeCohortAppProcess(c.processIdentity, c.admission.appUrl, c.io)).toBe(cohortHash(c.processIdentity))
  })
  it.each(['birth', 'image', 'cwd', 'foreign listener', 'wildcard'])('refuses changed %s through the actual process observer', kind => {
    const c = processControl()
    if (kind === 'birth') c.processIdentity.startTicks = 'other'
    if (kind === 'image') c.bytes['/proc/1234/exe'] = Buffer.from('changed image')
    if (kind === 'cwd') c.links['/proc/1234/cwd'] = '/foreign'
    if (kind === 'foreign listener') c.links['/proc/1234/fd/3'] = 'socket:[9999]'
    if (kind === 'wildcard') c.bytes['/proc/net/tcp'] = Buffer.from(c.bytes['/proc/net/tcp'].toString().replace('0100007F', '00000000'))
    expect(() => observeCohortAppProcess(c.processIdentity, c.admission.appUrl, c.io)).toThrow('cohort_hold:')
  })
  it('executes the actual graph reader with one snapshot, service-role qualified read and no database writes', () => {
    const c = protocolControl(), execute = vi.fn<(args: string[], input?: string) => string>(() => JSON.stringify(c.graph.qualified) + '\n' + JSON.stringify(c.graph) + '\n')
    const graph = readCohortGraph(c.admission, c.ids, c.oracle, execute)
    expect(verifyCohortGraph(graph, c.ids, c.oracle)).toBe(id(10))
    expect(execute).toHaveBeenCalledOnce()
    const [argv, sql] = execute.mock.calls[0]
    expect(argv).toEqual(['psql', c.admission.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
    expect(sql).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(sql).toContain('SET LOCAL ROLE service_role;'); expect(sql).toContain('RESET ROLE;')
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT)\b/i)
    expect(sql?.trimEnd()).toMatch(/COMMIT;$/)
  })
  it('refuses a malformed graph response without accepting a partial source vector', () => {
    const c = protocolControl()
    expect(() => readCohortGraph(c.admission, c.ids, c.oracle, () => '{}')).toThrow('readonly_snapshot_shape')
  })

  function runtimeControl() {
    const c = protocolControl(), app = path.join(c.home, 'app'), harness = path.join(c.home, 'harness')
    mkdirSync(app, { mode: 0o700 }); mkdirSync(harness, { mode: 0o700 }); mkdirSync(path.join(app, '.next'), { mode: 0o700 })
    writeFileSync(path.join(app, '.next/BUILD_ID'), 'same-build')
    for (const file of Object.keys(c.admission.sourceManifest)) { mkdirSync(path.dirname(path.join(harness, file)), { recursive: true, mode: 0o700 }); writeFileSync(path.join(harness, file), file); c.admission.sourceManifest[file] = createBytesHash(Buffer.from(file)) }
    c.admission.appDir = app; c.admission.harnessDir = harness; c.admission.dbUrl = 'postgresql://127.0.0.1:54322/unused'
    c.admission.buildManifest = c.ref('runtime-build.json', { BUILD_ID: createBytesHash(Buffer.from('same-build')) })
    const roles = { database: 'a'.repeat(64), api: 'b'.repeat(64), storage: 'c'.repeat(64) }
    c.admission.resourceManifest = c.ref('runtime-resources.json', { containerIds: Object.values(roles), networkIds: ['d'.repeat(64)], volumeNames: ['owned-db-data'], roles })
    const ports = (internal: string, external: string) => ({ [internal]: [{ HostIp: '127.0.0.1', HostPort: external }] })
    const containers = new Map(Object.entries(roles).map(([role, fullId]) => [fullId, [fullId, `/owned-${role}`, 'created', 'image', { owned: 'controlled' }, {}, [], true,
      role === 'database' ? ports('5432/tcp', '54322') : role === 'api' ? ports('8000/tcp', '54321') : {}, role === 'database' ? ports('5432/tcp', '54322') : role === 'api' ? ports('8000/tcp', '54321') : {}]]))
    const refs = { 'refs/tags/agent-claims/masterplan/backend-controlled': 'e'.repeat(40), 'refs/tags/agent-claims/masterplan/producer-controlled': 'e'.repeat(40) }
    const message = JSON.stringify({ base: 'f'.repeat(40), files: [], operation: 'controlled neutral pair receipt' })
    c.admission.custody = { refs, receipts: [{ sha: 'e'.repeat(40), parent: 'f'.repeat(40), tree: 'a'.repeat(40), messageSha256: createBytesHash(Buffer.from(message)) }] }
    const calls: Array<{ argv: string[]; input?: string }> = [], database = { sysid: '12345', major: 17, catalogs: { functions: 'full controlled definition', RLS: true }, ledger: [{ version: 'known' }] }
    const execute = (argv: string[], input?: string) => {
      calls.push({ argv, input })
      if (argv[0] === 'git') return argv.includes('status') ? '' : argv.includes('HEAD^{tree}') ? (argv[2] === app ? c.admission.runtime.appTree : c.admission.runtime.harnessTree) : (argv[2] === app ? c.admission.runtime.appCommit : c.admission.runtime.harnessCommit)
      if (argv[0] === 'psql') return JSON.stringify(database)
      if (argv[0] === 'docker') {
        if (argv[1] === 'info') return JSON.stringify('same-daemon')
        if (argv[1] === 'container') return JSON.stringify(containers.get(argv.at(-1)!))
        if (argv[1] === 'network') return JSON.stringify(['d'.repeat(64), 'owned-network', {}, {}, {}, false, false])
        if (argv[1] === 'volume') return JSON.stringify(['owned-db-data', 'local', {}, '/owned', {}])
      }
      if (argv[0] === 'gh') return JSON.stringify(argv.at(-1)!.includes('/git/ref/') ? { object: { sha: 'e'.repeat(40) } } : argv.at(-1)!.endsWith('e'.repeat(40)) ? { tree: { sha: 'a'.repeat(40) }, parents: [{ sha: 'f'.repeat(40) }], message } : { tree: { sha: 'a'.repeat(40) } })
      throw new Error('uncontrolled command')
    }
    return { ...c, execute, calls, containers, database, roles }
  }
  it('runs the actual runtime observer against fake Git/Docker/GitHub/psql and private actual source/build bytes', async () => {
    const c = runtimeControl(), observed = await observeCohortRuntime(c.admission, c.execute, () => '7'.repeat(64))
    expect(observed.catalogSha256).toBe(cohortHash(c.database.catalogs)); expect(observed.ledgerSha256).toBe(cohortHash(c.database.ledger))
    expect(observed.databaseSystemIdentifier).toBe('12345'); expect(observed.nextBuildId).toBe('same-build')
    expect(c.calls.filter(call => call.argv[0] === 'docker').every(call => ['inspect', 'info'].some(operation => call.argv.includes(operation)))).toBe(true)
    expect(c.calls.find(call => call.argv[0] === 'psql')?.input).toContain('READ ONLY')
    expect(c.calls.find(call => call.argv[0] === 'psql')?.input).toContain('pg_catalog.pg_policy')
  })
  it('refuses a same-ID resource whose actual published DB port is different', async () => {
    const c = runtimeControl(); c.containers.get(c.roles.database)![8] = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '59999' }] }
    await expect(observeCohortRuntime(c.admission, c.execute, () => '7'.repeat(64))).rejects.toThrow('role_endpoint_binding')
  })
  it('actual standalone Node22 seal entry fails closed before any external read without an explicit business admission', () => {
    const node = process.execPath, source = path.resolve('scripts/simulation/track1/fixtures/main03Cohort.ts')
    try { execFileSync(node, [source, 'seal'], { env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'] }); throw new Error('unexpected CLI success') }
    catch (error) { expect((error as { status: number }).status).toBe(1); expect(String((error as { stderr: Buffer }).stderr)).toContain('cohort_hold:seal_failed') }
  })
  it('refuses a foreign ambient DB URL before the actual scenario can seed or prepare', () => {
    const c = protocolControl()
    c.admission.createdAtUtc = new Date(Date.now() - 1000).toISOString(); c.admission.expiresAtUtc = new Date(Date.now() + 600000).toISOString()
    c.admission.dbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'; c.admission.harnessDir = process.cwd()
    Object.assign(c.admission, { simHome: c.home, serviceRoleKeySha256: createBytesHash(Buffer.from('controlled-only-service-key')) })
    const file = c.ref('admission.json', c.admission)
    for (const [key, value] of Object.entries({ TRACK1_COHORT_ADMISSION_FILE: file.path, TRACK1_COHORT_ADMISSION_SHA256: file.sha256,
      TRACK1_RUN_DIR: c.admission.runDir, TRACK1_STACK_JSON: c.admission.stack.path, TRACK1_APP_URL: c.admission.appUrl, TRACK1_APP_DIR: c.admission.appDir,
      TRACK1_APP_COMMIT: c.admission.runtime.appCommit, TRACK1_APP_PORT: '3101', TRACK1_DB_URL: 'postgresql://127.0.0.1:59999/foreign', SIM_HOME: c.home,
      NEXT_PUBLIC_SUPABASE_URL: c.admission.authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.admission.anonKey, SUPABASE_SERVICE_ROLE_KEY: 'controlled-only-service-key' })) vi.stubEnv(key, value)
    vi.stubEnv('TRACK1_ASSIGNMENT_FILE', undefined); vi.stubEnv('NEXT_PHASE', undefined)
    expect(() => loadCohortAdmissionFromEnv('MAIN03_CANDIDATE')).toThrow('ambient_scenario_binding')
  })
  it('binds the actual scenario environment and actual cached service client; current smoke assignment stays unusable', () => {
    const c = protocolControl(), env: NodeJS.ProcessEnv = { NODE_ENV: 'test', TRACK1_RUN_DIR: c.admission.runDir, TRACK1_STACK_JSON: c.admission.stack.path, TRACK1_APP_URL: c.admission.appUrl,
      TRACK1_APP_DIR: c.admission.appDir, TRACK1_APP_COMMIT: c.admission.runtime.appCommit, TRACK1_APP_PORT: '3101', TRACK1_DB_URL: c.admission.dbUrl, SIM_HOME: c.home,
      NEXT_PUBLIC_SUPABASE_URL: c.admission.authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.admission.anonKey, SUPABASE_SERVICE_ROLE_KEY: 'controlled-only-service-key' }
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: () => { throw new Error('network forbidden') } } }
    const client = createEsmClient(c.admission.authUrl, 'controlled-only-service-key', options)
    expect(() => assertCohortScenarioEnvironment(c.admission, client, env, c.admission.harnessDir)).not.toThrow()
    for (const key of ['TRACK1_DB_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'TRACK1_APP_URL', 'TRACK1_STACK_JSON']) {
      expect(() => assertCohortScenarioEnvironment(c.admission, client, { ...env, [key]: 'foreign' }, c.admission.harnessDir)).toThrow('ambient_scenario_binding')
    }
    const foreignClient = createEsmClient('http://127.0.0.1:59999', 'controlled-only-service-key', options)
    expect(() => assertCohortScenarioEnvironment(c.admission, foreignClient, env, c.admission.harnessDir)).toThrow('cached_service_client_url')
    expect(() => assertCohortScenarioEnvironment(c.admission, client, { ...env, SUPABASE_SERVICE_ROLE_KEY: 'changed' }, c.admission.harnessDir)).toThrow('service_key_binding')
    expect(() => assertCohortScenarioEnvironment(c.admission, client, { ...env, TRACK1_ASSIGNMENT_FILE: '/current-infrastructure-smoke.json' }, c.admission.harnessDir)).toThrow('business_assignment_integration_required')
  })
})


// SITE01 source-only clock binding: actual native end still requires its own
// accepted relationship and source provenance on a qualified backend.
describe('SITE01 ordinary end uses the independent site oracle', () => {
  it('binds September25 inclusive to the exact exclusive instant in Ediel fixed UTC+1', async () => {
    const { SITE_B, chooseSiteOracle, siteEndPlan } = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
    const oracle = chooseSiteOracle(SITE_B)
    expect(siteEndPlan(SITE_B, oracle)).toEqual({
      endDate: '2026-09-25', effectiveAtUtc: '2026-09-25T22:00:00.000Z', endWireMinute: '202609252300',
    })
  })

  it('refuses an active site rather than inventing an end date', async () => {
    const { SITE_A, chooseSiteOracle, siteEndPlan } = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
    expect(() => siteEndPlan(SITE_A, chooseSiteOracle(SITE_A))).toThrow('site01_end_date_required')
  })

  it('refuses a changed civil end date that disagrees with the unchanged interval oracle', async () => {
    const { SITE_B, chooseSiteOracle, siteEndPlan } = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
    expect(() => siteEndPlan({ ...SITE_B, endDate: '2026-09-26' }, chooseSiteOracle(SITE_B))).toThrow('site01_end_oracle_mismatch')
  })
})

async function siteEndBoundary(mode: 'valid' | 'missing-original' | 'held' | 'missing-effects' | 'sibling-drift' | 'repeat-drift' | 'wrong-status' = 'valid') {
  const endModule = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
  const guide = await import('./helpers/prodatGuideOrderedFixture')
  const identity = await import('./fixtures/prodat-identity')
  const register = await import('./fixtures/prodat-register')
  const calls: string[] = [], wires: string[] = []
  let processes = 0
  const a = { siteId: 'site-a', pointId: 'point-a', contractId: 'contract-a', companyId: 'own-company', customerId: 'own-customer' }
  const b = { siteId: 'site-b', pointId: 'point-b', contractId: 'contract-b', companyId: 'own-company', customerId: 'own-customer',
    actorUserId: 'own-actor', sender: '11111', receiver: '22222', external: '735120000000000001', gridAreaCode: 'TEB', brpEdielId: '33333',
    customerIdentity: { id: '191212121212', qualifier: 'SE1', agency: '260' } }
  const supply = { supplyPeriodId: 'period-b', sourceId: 'accepted-z04-source' }
  const sql = (query: string) => {
    if (query.includes("'site',(SELECT")) return { sibling: mode === 'sibling-drift' && processes ? 'changed' : 'unchanged' }
    return {
      period: { id: 'period-b', customer_id: 'own-customer', metering_point_id: 'point-b',
        source_message_id: mode === 'missing-original' ? 'foreign-source' : supply.sourceId,
        status: processes && mode !== 'wrong-status' ? 'ended' : 'active',
        contract_id: 'contract-b', customer_contract_id: 'contract-b', source_end_message_id: processes ? 'new-z05-source' : null,
        market_state_version: processes ? mode === 'repeat-drift' ? 1 + processes : 2 : 1,
        end_date: processes ? '2026-09-25' : null, market_end_at: processes ? '2026-09-25T22:00:00Z' : null },
      contract: { status: processes ? 'terminated' : 'signed' },
      effects: processes && mode !== 'missing-effects' ? 1 : 0, followups: processes ? 1 : 0,
      terminations: processes ? 1 : 0, finalTasks: processes ? 1 : 0,
      acknowledgements: processes ? [{ family: 'APERAK', outcome: 'positive' }, { family: 'CONTRL', outcome: 'positive' }] : [],
    }
  }
  // All unused application imports are inert ports: invoking one fails instead
  // of reaching a real service. The helper's wire builders are actual modules.
  const ports: Record<string, unknown> = {
    'node:crypto': createRequire(import.meta.url)('node:crypto'),
    '@/__tests__/helpers/prodatGuideOrderedFixture': guide,
    '@/__tests__/fixtures/prodat-identity': identity,
    '@/__tests__/fixtures/prodat-register': register,
    '@/scripts/helpers/ediel-normal-switch-native-fixture': { nativeSql: sql, literal: (value: string) => `'${value}'` },
    '@/scripts/helpers/originalMailboxNative': { seedOriginalMailboxNative: async (_sql: unknown, _literal: unknown, input: { raw: string }) => { calls.push('mail'); wires.push(input.raw); return { parsed: {}, inboundEmailMessageId: 'mail-original', parseResultId: 'parse-original' } } },
    '@/lib/ediel/mailReadiness': { assertEdielSmtpReadiness: () => ({ from: 'synthetic@example.invalid' }) },
    '@/lib/inbound-mail/inboundMatcher': { matchOutboundRequestForInbound: async () => ({ status: 'not_found' }), matchMeteringPointForInbound: async () => ({ status: 'matched' }) },
    '@/lib/inbound-mail/inboundStatusUpdater': { createInboundEdielMessage: async () => { calls.push('birth'); return 'new-z05-source' } },
    '@/lib/ediel/db': { getEdielMessageById: async () => ({ company_id: 'own-company', message_code: 'Z05', rule_profile_key: 'PRODAT:Z05:L:26.A:r3' }) },
    '@/lib/ediel/core/runtimeDecision': { resolveCanonicalRuntimeDecisionWithRegistry: async () => ({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: mode === 'held' ? 'held' : 'accepted', issues: [] }) },
    '@/lib/ediel/flows/inboundProcessing': { processInboundEdielMessage: async (input: { edielMessageId: string }) => { expect(input.edielMessageId).toBe('new-z05-source'); calls.push('process'); processes++ } },
    './site01Synthetic': endModule, './substitutions': { substitute: () => undefined },
  }
  const filename = path.resolve('scripts/simulation/track1/fixtures/site01Fixture.ts')
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exported: { endExistingSiteSupply?: (...args: unknown[]) => Promise<unknown> } = {}
  vm.runInNewContext(js, { exports: exported, require: (id: string) => ports[id] ?? {} }, { filename })
  const run = () => exported.endExistingSiteSupply!(a, b, supply, endModule.chooseSiteOracle(endModule.SITE_B))
  return { run, calls, wires }
}

describe('SITE01 actual ordinary Z05 orchestration through finite ports', () => {
  it('uses public source birth, exact end minute, actual processing and a terminal repeat', async () => {
    const control = await siteEndBoundary()
    expect(await control.run()).toMatchObject({ sourceId: 'new-z05-source', periodId: 'period-b', effectiveAtUtc: '2026-09-25T22:00:00.000Z', endWireMinute: '202609252300' })
    expect(control.calls).toEqual(['mail', 'birth', 'process', 'process'])
    expect(control.wires).toHaveLength(1)
    expect(control.wires[0]).toContain('DTM+93:202609252300:203')
    expect(control.wires[0]).toContain('RFF+LI:SITE-END-')
  })

  it('refuses a mismatched original relationship before retaining a new original', async () => {
    const control = await siteEndBoundary('missing-original')
    await expect(control.run()).rejects.toThrow('site01_end_original_relationship_required')
    expect(control.calls).toEqual([])
  })

  it('does not process a source whose canonical functional decision is held', async () => {
    const control = await siteEndBoundary('held')
    await expect(control.run()).rejects.toThrow('site01_z05_not_accepted')
    expect(control.calls).toEqual(['mail', 'birth'])
  })

  it('does not reprocess a source when its committed effect receipt is missing', async () => {
    const control = await siteEndBoundary('missing-effects')
    await expect(control.run()).rejects.toThrow('site01_z05_followup_mismatch')
    expect(control.calls).toEqual(['mail', 'birth', 'process'])
  })

  it('detects a changed sibling graph before attempting a terminal repeat', async () => {
    const control = await siteEndBoundary('sibling-drift')
    await expect(control.run()).rejects.toThrow('site01_z05_changed_site_a')
    expect(control.calls).toEqual(['mail', 'birth', 'process'])
  })

  it('refuses a repeat that changes the already observed business graph', async () => {
    const control = await siteEndBoundary('repeat-drift')
    await expect(control.run()).rejects.toThrow('site01_z05_repeat_changed_business_graph')
  })
})


it('SITE01 refuses a source that leaves the historical B delivery active', async () => {
  const control = await siteEndBoundary('wrong-status')
  await expect(control.run()).rejects.toThrow('site01_z05_end_effect_mismatch')
  expect(control.calls).toEqual(['mail', 'birth', 'process'])
})

// Versioned input epoch: replacing v1 or rounding away the first hour breaks these controls.
describe('SITE native input-v2 independent oracle', () => {
  it('preserves the historical v1 counts and totals', async () => {
    const m = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
    for (const [spec, count] of [[m.SITE_A, 2880], [m.SITE_B, 960]] as const) {
      const o = m.chooseSiteOracle(spec)
      expect(o.intervals).toHaveLength(count)
      expect([o.totalMilliKwh, o.totalIncVatCents]).toEqual(spec.key === 'A' ? [485845, 56830] : [153310, 26046])
      expect(o.lines).toEqual(spec.key === 'A' ? { spotCents: 38621, markupCents: 1943, monthlyFeeCents: 4900 } : { spotCents: 11557, markupCents: 1380, monthlyFeeCents: 7900 })
      expect(o).toEqual(m.buildSiteOracle(spec, o.consumptionSalt))
    }
  })
  it('derives fixed+01 starts from declared raw input and keeps the original exclusive end', async () => {
    const m = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
    expect(m.chooseSiteNativeV2Oracle).toBeTypeOf('function')
    for (const [spec, count] of [[m.SITE_A, 2876], [m.SITE_B, 956]] as const) {
      const input = { epoch: 'site-native-input-v2' as const, convention: 'ediel-fixed-utc+01' as const, rawStartMinute: spec.startDate.replaceAll('-', '') + '0000' }
      const o = m.chooseSiteNativeV2Oracle(spec, input)
      const start = Date.parse(spec.startDate + 'T00:00:00+01:00')
      expect(o.nativeInput).toEqual(input)
      expect(o.billableStartMs).toBe(start)
      expect(o.intervals).toHaveLength(count)
      expect(o.intervals[0].quarter).toBe(4)
      expect(o.intervals.every(i => i.startMs >= start)).toBe(true)
      expect(o.billableEndMs).toBe(m.chooseSiteOracle(spec).billableEndMs)
      if (spec.key === 'B') expect(m.siteEndPlan(spec, o)).toEqual({ endDate: '2026-09-25', effectiveAtUtc: '2026-09-25T22:00:00.000Z', endWireMinute: '202609252300' })
      expect(() => m.assertSiteNativeV2Start(o, new Date(start).toISOString())).not.toThrow()
      expect(() => m.assertSiteNativeV2Start(o, new Date(start - 3600000).toISOString())).toThrow('site01_native_start_mismatch')
      const round = (n: bigint, d: bigint) => Number((BigInt(2) * n + d) / (BigInt(2) * d))
      let quantity = BigInt(0), rawSpot = BigInt(0)
      for (let day = spec.firstDay; day <= spec.lastDay; day++) for (let q = day === spec.firstDay ? 4 : 0; q < 96; q++) {
        const milli = BigInt(actualSynthetic.quarterMilliKwh(day, q, o.consumptionSalt))
        quantity += milli
        rawSpot += milli * BigInt(actualSynthetic.hourlySpotE5(day, Math.floor(q / 4), spec.priceSalt))
      }
      const lines = { spotCents: round(rawSpot, BigInt(1000000)), markupCents: round(quantity * BigInt(spec.markupOrePerKwh), BigInt(1000)), monthlyFeeCents: spec.monthlyFeeSek * 100 }
      const ex = Object.values(lines).reduce((a, b) => a + b, 0)
      const vat = Object.values(lines).reduce((a, b) => a + round(BigInt(b) * BigInt(25), BigInt(100)), 0)
      expect(o.totalMilliKwh).toBe(Number(quantity))
      expect(o.lines).toEqual(lines)
      expect(o.totalExVatCents).toBe(ex)
      expect(o.vatCents.total).toBe(vat)
      expect(o.totalIncVatCents).toBe(ex + vat)
      expect(o.ambiguities).toEqual([])
      expect(() => m.buildSiteNativeV2Oracle(spec, o.consumptionSalt, { ...input, rawStartMinute: '202609020000' })).toThrow('site01_native_input_mismatch')
      expect(() => m.buildSiteNativeV2Oracle({ ...spec, firstDay: spec.firstDay + 1 }, o.consumptionSalt, input)).toThrow('site01_native_input_mismatch')
    }
  })
})

async function nativeActivationBoundary(marketStartAt: unknown) {
  const m = await import('../scripts/simulation/track1/fixtures/site01Synthetic')
  const f = { companyId: 'company', pointId: 'point', customerId: 'customer', switchId: 'switch', contractId: 'contract', requestedStartDate: m.SITE_A.startDate }
  const oracle = m.chooseSiteNativeV2Oracle(m.SITE_A, { epoch: 'site-native-input-v2', convention: 'ediel-fixed-utc+01', rawStartMinute: '202609010000' })
  let selected = ''
  const read = { eq: () => read, then: (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: 'period', customer_id: 'customer', source_message_id: 'source', source_switch_request_id: 'switch', source_process: 'supplier_switch_confirmation', status: 'confirmed_by_grid_owner', start_date: f.requestedStartDate, contract_id: 'contract', market_start_at: marketStartAt }] }) }
  const ports = {
    assertEdielSmtpReadiness: () => ({}), buildCancellationProspectiveZ04: () => 'wire',
    seedOriginalMailboxNative: async () => ({ parsed: {} }), literal: String, randomUUID: () => 'id',
    sql: (q: string) => q.includes('normal_supply_activations') ? 1 : undefined,
    matchOutboundRequestForInbound: async () => ({}), matchMeteringPointForInbound: async () => ({}),
    createInboundEdielMessage: async () => 'source',
    getEdielMessageById: async () => ({ company_id: 'company', message_code: 'Z04', rule_profile_key: 'PRODAT:Z04:L:26.A:r3' }),
    resolveCanonicalRuntimeDecisionWithRegistry: async () => ({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' }),
    processInboundEdielMessage: async () => undefined, advanceSupplyMarketDeadlines: async () => ({}),
    supabaseService: { from: () => ({ select: (columns: string) => { selected = columns; return read } }) },
    must: (v: unknown, message: string) => { if (!v) throw new Error(message) }, assertSiteNativeV2Start: m.assertSiteNativeV2Start,
  }
  const source = readFileSync(path.resolve('scripts/simulation/track1/fixtures/site01Fixture.ts'), 'utf8')
  const start = source.indexOf('async function activateSwitchSupply(')
  const end = source.indexOf('// ------------------------------------------------------------------- spot', start)
  const js = ts.transpileModule(source.slice(start, end) + '\nexports.run = activateSwitchSupply', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exported: { run?: (f: unknown, oracle: unknown) => Promise<unknown> } = {}
  vm.runInNewContext(js, { ...ports, exports: exported })
  return { run: () => exported.run!(f, oracle), selected: () => selected }
}

describe('actual SITE activation binds declared input epoch', () => {
  it('reads and accepts only the declared fixed+01 source start', async () => {
    const c = await nativeActivationBoundary('2026-08-31T23:00:00Z')
    await expect(c.run()).resolves.toEqual({ supplyPeriodId: 'period', sourceId: 'source' })
    expect(c.selected().split(',')).toContain('market_start_at')
  })
  it.each([null, '2026-08-31T22:00:00Z', 'invalid'])('holds a differing actual start %s', async value => {
    const c = await nativeActivationBoundary(value)
    await expect(c.run()).rejects.toThrow('site01_native_start_mismatch')
  })
})
