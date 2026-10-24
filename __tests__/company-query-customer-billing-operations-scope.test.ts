import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const querySites = [
  [
    "app/admin/customers/[id]/registered-address-actions.ts",
    "saveCustomerRegisteredAddressAction",
    "customers",
    "select"
  ],
  [
    "app/admin/customers/actions.part-2.ts",
    "resolveManualIntakeSiteGeography",
    "customer_sites",
    "select"
  ],
  [
    "app/admin/customers/actions.part-2.ts",
    "resolveManualIntakeSiteGeography",
    "customer_sites",
    "update"
  ],
  [
    "lib/billing/exportCenter.ts",
    "listExactBillableContractsByUnderlayIds",
    "customer_supply_periods",
    "select"
  ],
  [
    "lib/billing/historyRequest.ts",
    "ensureHistoricalMeteringRequest",
    "metering_permissions",
    "select"
  ],
  [
    "lib/billing/monthlyAutomation.ts",
    "closeOrphanedRuns",
    "billing_automation_runs",
    "update"
  ],
  [
    "lib/billing/supplyEndRegate.ts",
    "regateSupplyEndValues",
    "customer_supply_periods",
    "select"
  ],
  [
    "lib/billing/supplyEndRegate.ts",
    "regateSupplyEndValues",
    "normalized_metering_values",
    "select"
  ],
  [
    "lib/billing/supplyEndRegate.ts",
    "regateSupplyEndValues",
    "metering_values",
    "select"
  ],
  [
    "lib/cis/db-outbound.ts",
    "recordHeldOutboundStatusFacts",
    "outbound_requests",
    "update"
  ],
  [
    "lib/customer-contracts/db.ts",
    "assertContractHasNoOpenSupply",
    "customer_supply_periods",
    "select"
  ],
  [
    "lib/customer-contracts/db.ts",
    "getCustomerContractNoticeDays",
    "customer_contract_notice_terms",
    "select"
  ],
  [
    "lib/customer-contracts/importSignedAgreement.ts",
    "recordSignedAgreementDocument",
    "customer_authorization_documents",
    "insert"
  ],
  [
    "lib/customers/registeredAddress.ts",
    "recordRegisteredAddress",
    "customer_addresses",
    "select"
  ],
  [
    "lib/customers/registeredAddress.ts",
    "recordRegisteredAddress",
    "customer_addresses",
    "update"
  ],
  [
    "lib/customers/registeredAddress.ts",
    "recordRegisteredAddress",
    "customer_addresses",
    "insert"
  ],
  [
    "lib/integrations/tenantWebsiteReadiness.ts",
    "reconcileTenantOperationalCapabilities",
    "company_capabilities",
    "upsert"
  ],
  [
    "lib/integrations/tenantWebsiteReadiness.ts",
    "listTenantOperationalCapabilities",
    "company_capabilities",
    "select"
  ],
  [
    "lib/metering/monthlyAutopilot.ts",
    "loadSuppliedWindows",
    "customer_supply_periods",
    "select"
  ],
  [
    "lib/operations/switchCustomerMasterdataPreparation.ts",
    "verifiedSignedAgreement",
    "customer_contracts",
    "select"
  ],
  [
    "lib/operations/switchCustomerMasterdataPreparation.ts",
    "verifiedSignedAgreement",
    "customer_contract_documents",
    "select"
  ],
  [
    "lib/operations/switchCustomerMasterdataPreparation.ts",
    "deriveCustomerMasterdataBeforeSwitch",
    "supplier_switch_requests",
    "select"
  ],
  [
    "lib/operations/switchInvoiceePreparation.ts",
    "selectInvoiceeBeforeSwitch",
    "supplier_switch_requests",
    "select"
  ],
  [
    "lib/operations/switchInvoiceePreparation.ts",
    "selectInvoiceeBeforeSwitch",
    "supplier_switch_requests",
    "update"
  ],
  [
    "lib/operations/switchInvoiceePreparation.ts",
    "boundPowerOfAttorneyReference",
    "powers_of_attorney",
    "select"
  ],
  [
    "lib/operations/switchRequestedMethodPreparation.ts",
    "deriveRequestedMethodBeforeSwitch",
    "supplier_switch_requests",
    "select"
  ],
  [
    "lib/pricing/engine.ts",
    "loadContract",
    "customer_supply_periods",
    "select"
  ]
] as const

const nativeRequire = createRequire(import.meta.url)
function text(path: string) { return readFileSync(join(process.cwd(), path), 'utf8') }
function compile(source: string) { return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText }
function port(companyId: string, calls: Array<Record<string, unknown>>) {
  return { from(table: string) {
    const call: Record<string, unknown> = { table, filters: [] }; calls.push(call)
    const q: Record<string, unknown> = {}
    for (const name of ['select', 'update', 'insert', 'upsert', 'eq', 'in', 'or', 'not', 'lt', 'gt', 'lte', 'gte', 'neq', 'order', 'range', 'limit', 'maybeSingle', 'single', 'returns']) q[name] = (...args: unknown[]) => {
      if (['update', 'insert', 'upsert'].includes(name)) { call.operation = name; call.values = args[0] }
      if (name === 'eq') (call.filters as unknown[][]).push(args)
      return q
    }
    q.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      const filters = call.filters as unknown[][]
      const belongs = filters.some(([key, value]) => key === 'company_id' && value === companyId)
      return Promise.resolve({ data: belongs ? [{ id: 'row', company_id: companyId }] : [], error: null }).then(resolve, reject)
    }
    return q
  } }
}
function loader(service: unknown, stubs: Record<string, unknown> = {}) {
  const cache = new Map<string, Record<string, unknown>>()
  return function load(path: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
    if (cache.has(path)) return cache.get(path)! as Record<string, (...args: unknown[]) => Promise<unknown>>
    const exports: Record<string, unknown> = {}; cache.set(path, exports)
    const require = (id: string): unknown => {
      if (id === '@/lib/supabase/service') return { supabaseService: service }
      if (id in stubs) return stubs[id]
      if (id === '@/lib/supabase/tenantDb' || id === '@/lib/supabase/tenantQuery') return load(id.slice(2) + '.ts')
      if (id.startsWith('node:')) return nativeRequire(id)
      return {}
    }
    const source = text(path) + (path === 'lib/cis/db-outbound.ts' ? '\nexport { recordHeldOutboundStatusFacts }' : '')
    runInNewContext(compile(source), { exports, require, Buffer, console, Date }, { filename: path })
    return exports as Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}
function siteExpression(path: string, functionName: string, table: string, operation: string) {
  const source = text(path), sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const found: ts.CallExpression[] = []
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      let fn: ts.Node | undefined = node.parent
      while (fn && !(ts.isFunctionDeclaration(fn) && fn.name)) fn = fn.parent
      if (fn && (fn as ts.FunctionDeclaration).name!.text === functionName) {
        if (ts.isIdentifier(node.expression) && node.expression.text === ({ select: 'tenantSelect', update: 'tenantUpdate', insert: 'tenantInsert' } as Record<string, string>)[operation] && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === table) found.push(node)
        if (operation === 'upsert' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'upsert' && node.expression.expression.getText(sf).includes('tenantDb(')) found.push(node)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  expect(found.length, path + ':' + functionName + ':' + table + ':' + operation).toBe(1)
  let result: ts.Node = found[0]
  while (result.parent && !ts.isAwaitExpression(result.parent) && !ts.isVariableDeclaration(result.parent)) result = result.parent
  return result.getText(sf)
}
function scope(companyId: string | undefined, helpers: Record<string, unknown>, service: unknown) {
  const address = { street_1: 'Storgatan 1', postal_code: '111 22', city: 'Stockholm', country: 'SE' }
  return { ...helpers, supabaseService: service, companyId, input: { companyId, current: { company_id: companyId }, address, customerId: 'customer', siteId: 'site', contractId: 'contract', switchRequestId: 'switch' },
    params: { companyId }, contractId: '00000000-0000-4000-8000-000000000001', customerId: 'customer', supplyPeriodId: 'supply', supplyPeriodIds: ['supply'], codes: ['code'], capabilities: [{ code: 'code', ready: true, blockers: [] }], checks: {}, now: '2026-10-24T12:00:00Z',
    company: { id: companyId }, facts: { updated_by: 'actor' }, patch: {}, row: { id: 'switch' }, next: {}, today: '2026-10-24', metadata: {}, address, open: [{ id: 'old' }], hash: 'abc', timing: {}, BUCKET: 'bucket', pointChunk: ['point'], bounds: { startDate: '2026-10-01', endDateExclusive: '2026-11-01' }, window: { start: 'start', end: 'end' }, PAGE: 500, from: 0, slice: [{ source_metering_value_id: 'value' }], lastDay: '2026-10-31', BILLED_SUPPLY_PERIOD_STATUSES: ['ending'], ANSWERED_PERMISSION_STATUSES: ['blocked'] }
}
async function runQuery(expression: string, environment: Record<string, unknown>) {
  const js = compile('module.exports = async function () { return await (' + expression + ') }')
  const runtimeModule = { exports: null as unknown }
  runInNewContext(js, { ...environment, module: runtimeModule, exports: {}, Date })
  return (runtimeModule.exports as () => Promise<{ data: unknown[] }>)()
}

describe('new company-bound customer, billing and operations queries', () => {
  for (const [path, fn, table, operation] of querySites) {
    it(path + ' ' + fn + ' ' + table + ' ' + operation + ' enforces the actual tenant wrapper', async () => {
      const expression = siteExpression(path, fn, table, operation)
      for (const rowCompany of ['tenant-a', 'tenant-b']) {
        const calls: Array<Record<string, unknown>> = [], service = port(rowCompany, calls), load = loader(service)
        const helpers = { ...load('lib/supabase/tenantQuery.ts'), ...load('lib/supabase/tenantDb.ts') }
        const result = await runQuery(expression, scope('tenant-a', helpers, service))
        expect(calls).toHaveLength(1)
        if (operation === 'insert' || operation === 'upsert') {
          const rows = Array.isArray(calls[0].values) ? calls[0].values as Array<Record<string, unknown>> : [calls[0].values as Record<string, unknown>]
          expect(rows.length).toBeGreaterThan(0)
          expect(rows.every(row => row.company_id === 'tenant-a')).toBe(true)
        } else {
          expect(calls[0].filters).toContainEqual(['company_id', 'tenant-a'])
          expect(result.data).toHaveLength(rowCompany === 'tenant-a' ? 1 : 0)
        }
      }
      const calls: Array<Record<string, unknown>> = [], service = port('tenant-a', calls), load = loader(service)
      const helpers = { ...load('lib/supabase/tenantQuery.ts'), ...load('lib/supabase/tenantDb.ts') }
      await expect(runQuery(expression, scope(undefined, helpers, service))).rejects.toThrow()
      expect(calls).toHaveLength(0)
    })
  }
})

for (const name of ['deriveRequestedMethodBeforeSwitch', 'deriveCustomerMasterdataBeforeSwitch', 'selectInvoiceeBeforeSwitch']) {
  const path = ({ deriveRequestedMethodBeforeSwitch: 'lib/operations/switchRequestedMethodPreparation.ts', deriveCustomerMasterdataBeforeSwitch: 'lib/operations/switchCustomerMasterdataPreparation.ts', selectInvoiceeBeforeSwitch: 'lib/operations/switchInvoiceePreparation.ts' } as Record<string, string>)[name]
  it(name + ' refuses a wrong tenant and missing company before any derivation', async () => {
    for (const companyId of ['tenant-a', undefined]) {
      const calls: Array<Record<string, unknown>> = [], base = port('tenant-b', calls), derivations: unknown[] = []
      const service = { from(table: string) {
        const q = base.from(table)
        q.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: { id: 'switch', company_id: 'tenant-b', contract_id: 'contract', customer_id: 'customer', site_id: 'site', metering_point_id: 'point' }, error: null }).then(resolve)
        return q
      } }
      const load = loader(service, {
        '@/lib/ediel/production/contractRequestedMethodSource': { deriveContractRequestedMethodFromSignedAgreement: async (value: unknown) => derivations.push(value) },
        '@/lib/operations/switchCustomerMasterdataPreparation': { deriveCustomerMasterdataBeforeSwitch: async (value: unknown) => derivations.push(value) },
        '@/lib/operations/switchInvoiceePreparation': { selectInvoiceeBeforeSwitch: async (value: unknown) => derivations.push(value) },
      })
      const work = load(path)[name]({ companyId, switchRequestId: 'switch', actorUserId: 'actor' })
      if (!companyId) await expect(work).rejects.toThrow()
      else await work
      expect(derivations).toEqual([])
      expect(calls.length).toBe(companyId ? 1 : 0)
    }
  })
}


it('the requested-method chain passes the same server company to both preparers and both lanes', async () => {
  const calls: Array<Record<string, unknown>> = [], effects: Array<Record<string, unknown>> = []
  const base = port('tenant-a', calls)
  const service = { from(table: string) {
    const q = base.from(table)
    q.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: { id: 'switch', company_id: 'tenant-a', contract_id: 'contract' }, error: null }).then(resolve)
    return q
  } }
  const capture = async (input: Record<string, unknown>) => { effects.push(input) }
  const load = loader(service, {
    '@/lib/ediel/production/contractRequestedMethodSource': { deriveContractRequestedMethodFromSignedAgreement: capture },
    '@/lib/operations/switchCustomerMasterdataPreparation': { deriveCustomerMasterdataBeforeSwitch: capture },
    '@/lib/operations/switchInvoiceePreparation': { selectInvoiceeBeforeSwitch: capture },
  })
  await load('lib/operations/switchRequestedMethodPreparation.ts').deriveRequestedMethodBeforeSwitch({ companyId: 'tenant-a', switchRequestId: 'switch', actorUserId: 'actor' })
  expect(effects).toHaveLength(4)
  expect(effects.every(effect => effect.companyId === 'tenant-a' && effect.actorUserId === 'actor')).toBe(true)
  expect(effects.slice(0, 2).map(effect => effect.environment)).toEqual(['production', 'test'])
  expect(calls[0].filters).toContainEqual(['company_id', 'tenant-a'])
})

it('both real supplier-switch entrypoints pass the company they already qualified', async () => {
  const paths = ['lib/operations/businessActions/startSupplierSwitch.ts', 'lib/operations/edielAutomation.ts']
  const values: unknown[] = []
  for (const path of paths) {
    const sf = ts.createSourceFile(path, text(path), ts.ScriptTarget.Latest, true)
    const calls: string[] = []
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'deriveRequestedMethodBeforeSwitch') calls.push(node.getText(sf))
      ts.forEachChild(node, walk)
    }
    walk(sf)
    expect(calls).toHaveLength(path.includes('businessActions') ? 1 : 2)
    for (const call of calls) await runQuery(call, {
      deriveRequestedMethodBeforeSwitch: async (input: unknown) => values.push(input),
      preflight: { companyId: 'preflight-company' }, input: { actorUserId: 'actor', switchRequestId: 'switch' },
      context: { switchRequest: { company_id: 'context-company', id: 'switch' } },
    })
  }
  expect(values).toEqual([
    { companyId: 'preflight-company', actorUserId: 'actor', switchRequestId: 'switch' },
    { companyId: 'context-company', actorUserId: 'actor', switchRequestId: 'switch' },
    { companyId: 'context-company', actorUserId: 'actor', switchRequestId: 'switch' },
  ])
})


it('settled outbound keeps its status and exact dispatch facts, and refuses a missing snapshot company before writing', async () => {
  const writes: Array<Record<string, unknown>> = []
  const service = { from(table: string) {
    const write: Record<string, unknown> = { table, filters: [] }; writes.push(write)
    const q = {
      select() { return q }, update(values: Record<string, unknown>) { write.values = values; return q },
      insert(values: Record<string, unknown>) { write.values = values; return q },
      eq(key: string, value: unknown) { (write.filters as unknown[][]).push([key, value]); return q },
      async single() { return { data: { id: 'outbound', company_id: 'tenant-a', status: 'confirmed', external_reference: 'reference' }, error: null } },
    }
    return q
  } }
  const record = loader(service)('lib/cis/db-outbound.ts').recordHeldOutboundStatusFacts
  const input = { actorUserId: 'actor', outboundRequestId: 'outbound', proposedStatus: 'acknowledged', heldStatus: 'confirmed', holdReason: 'settled', responsePayload: { ack: 'ack-id' }, now: '2026-10-24T12:00:00Z' }
  await record({ ...input, current: { company_id: 'tenant-a', status: 'confirmed' } })
  expect(writes).toHaveLength(2)
  expect(writes[0].filters).toContainEqual(['company_id', 'tenant-a'])
  expect(writes[0].values).toEqual({ updated_by: 'actor', response_payload: { ack: 'ack-id' }, acknowledged_at: input.now })
  expect(writes[1].values).toMatchObject({ event_status: 'confirmed', event_type: 'acknowledged', payload: { heldStatus: 'confirmed', holdReason: 'settled' } })
  writes.length = 0
  await expect(record({ ...input, current: { status: 'confirmed' } })).rejects.toThrow('outbound_request_company_missing')
  expect(writes).toHaveLength(0)
})


it('the actual masterdata bootstrap verifies the archived signed bytes before deriving both tenant lanes', async () => {
  const bytes = Buffer.from('signed agreement original')
  const hash = nativeRequire('node:crypto').createHash('sha256').update(bytes).digest('hex') as string
  const calls: Array<Record<string, unknown>> = [], derivations: Array<Record<string, unknown>> = []
  const base = port('tenant-a', calls)
  const service = {
    from(table: string) {
      const q = base.from(table)
      const row = table === 'supplier_switch_requests' ? { id: 'switch', company_id: 'tenant-a', contract_id: 'contract' }
        : table === 'customer_contracts' ? { id: 'contract', document_sha256: hash }
          : { storage_bucket: 'signed', storage_path: 'original.pdf' }
      q.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(resolve)
      return q
    },
    storage: { from(bucket: string) { expect(bucket).toBe('signed'); return { async download(path: string) { expect(path).toBe('original.pdf'); return { data: { async arrayBuffer() { return bytes } }, error: null } } } } },
    async rpc(name: string, input: Record<string, unknown>) { expect(name).toBe('ediel_derive_contract_customer_masterdata_v1'); derivations.push(input); return { data: { status: 'unchanged', declarationId: null }, error: null } },
  }
  await loader(service)('lib/operations/switchCustomerMasterdataPreparation.ts').deriveCustomerMasterdataBeforeSwitch({ companyId: 'tenant-a', switchRequestId: 'switch', actorUserId: 'actor' })
  expect(derivations.map(call => call.p_environment)).toEqual(['production', 'test'])
  expect(derivations.every(call => call.p_company_id === 'tenant-a' && call.p_contract_id === 'contract' && call.p_agreement_original === '\\x' + bytes.toString('hex'))).toBe(true)
  expect(calls).toHaveLength(5)
  expect(calls.every(call => (call.filters as unknown[][]).some(([key, value]) => key === 'company_id' && value === 'tenant-a'))).toBe(true)
})

it('the actual invoicee bootstrap preserves selected source facts and scopes its snapshot write', async () => {
  const calls: Array<Record<string, unknown>> = [], base = port('tenant-a', calls)
  const service = { from(table: string) {
    const q = base.from(table)
    const row = table === 'powers_of_attorney' ? { reference: 'signed-poa', status: 'signed' } : {
      id: 'switch', company_id: 'tenant-a', customer_id: 'customer', site_id: 'site', metering_point_id: 'point', contract_id: 'contract', power_of_attorney_id: 'poa', requested_start_date: '2026-11-01',
      validation_snapshot: { retained: 'retained', portalData: { existing: 'existing', dependentConditionFacts: { retainedFact: 'retained-fact' } } },
    }
    q.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(resolve)
    return q
  } }
  const load = loader(service, {
    '@/lib/ediel/production/contractRequestedMethodSource': { async readContractRequestedMethodSource() { return { status: 'authorized', pointId: 'point', identityAgency: '260' } } },
    '@/lib/cis/db-shared': { async getCustomerExportContext() { return { customerMasterdata: { id: 'declaration' } } } },
    '@/lib/ediel/prodat/customerIdentity': { resolveSwedishProdatEndUserExport() { return { identity: { qualifier: 'SE1', id: 'identity', name: 'Customer' } } } },
    '@/lib/ediel/production/contractInvoicee': { async readContractInvoicee() { return { invoicee: { name: 'Invoicee' }, fact: { source: 'signed_contract' } } } },
    '@/lib/ediel/prodat/render/dates': { prodatDate203() { return '202611010000' }, prodatMarketMinuteToUtc() { return '2026-10-31T23:00:00Z' } },
  })
  await load('lib/operations/switchInvoiceePreparation.ts').selectInvoiceeBeforeSwitch({ companyId: 'tenant-a', switchRequestId: 'switch', actorUserId: 'actor' })
  expect(calls).toHaveLength(3)
  expect(calls.every(call => (call.filters as unknown[][]).some(([key, value]) => key === 'company_id' && value === 'tenant-a'))).toBe(true)
  expect(calls[2].values).toMatchObject({ updated_by: 'actor', validation_snapshot: { retained: 'retained', portalData: { existing: 'existing', invoicee: { name: 'Invoicee' }, powerOfAttorneyReference: 'signed-poa', dependentConditionFacts: { retainedFact: 'retained-fact', invoiceeObjects: [{ source: 'signed_contract' }] } } } })
})
