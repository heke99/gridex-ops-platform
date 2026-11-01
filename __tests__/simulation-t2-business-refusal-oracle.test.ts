// Component controls: execute the real registered scenario callbacks with controlled ports.
// No database, network, fixture creation or scenario PASS is produced by these tests.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as oracle from '../scripts/simulation/track2/lib/term-oracle'
import * as data from '../scripts/simulation/track2/lib/term02-data'

const root = fileURLToPath(new URL('../scripts/simulation/track2/', import.meta.url))
const terms = { markupOrePerKwh: '4', monthlyFeeSek: '49', invoiceFeeSek: '19', vatPercent: 25 }
const refuseIO = () => { throw new Error('Uncontrolled service or filesystem access refused') }

function evaluate(filename: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const output = { exports: {} as Record<string, unknown> }
  const source = readFileSync(filename, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    exports: output.exports,
    require: (name: string) => {
      if (!Object.hasOwn(imports, name)) throw new Error('Uncontrolled import refused: ' + name)
      return imports[name]
    },
    ...globals,
  }, { filename, timeout: 5000 })
  return output.exports
}

// Use the real comparison/arithmetic functions; only their service ports are replaced.
const billing = evaluate(path.join(root, 'lib/term-billing.ts'), {
  'node:crypto': crypto,
  './db': { psql: refuseIO, psqlRows: refuseIO, serviceClient: refuseIO },
  './term-oracle': oracle,
})

type Options = {
  group?: 'monthly' | 'overlap'
  status?: number
  invalidData?: unknown
  setupError?: Error
  setupStage?: 'contract' | 'supply'
  wrong?: 'source-count' | 'missing' | 'quantity' | 'coverage' | 'base' | 'fee' | 'vat' | 'total'
  overlap?: 'none' | 'wrong-status' | 'double-billed' | 'no-underlays'
  generateStatus?: number
}

function registeredCallback(options: Options = {}) {
  const monthly = options.group !== 'overlap'
  const tests: Array<{ name: string; run: () => Promise<void> }> = []
  const calls = { contract: 0, supply: 0, generate: 0, preview: 0, observations: [] as string[] }
  const contract = { companyId: 'component-company', customerId: 'component-customer', siteId: 'component-site', meteringPointId: 'component-point', gsrn: 'component-gsrn' }
  const tenant = { companyId: contract.companyId, admin: { email: 'component@example.invalid', password: 'synthetic-component', userId: 'component-user' } }
  const points = monthly
    ? data.quartersOnHourlyPrices(data.term0204QuarterWh, data.term0204HourlyPrices('2026-08'), '2026-08')
    : data.term0203Hourly('2026-09').map(p => ({ ...p, wh: data.hourlyShapeWh(p.slot.startMs) }))
  const intervals = data.toOracle(points)
  const expected = oracle.oracleInvoice({ intervals, terms }, 'half_away')
  const quantity = oracle.decToString(oracle.sumKwh(intervals))
  const preview = {
    status: 'success', errors: [], warnings: [],
    totalExVat: Number(expected.totalExVatOre) / 100,
    vatAmount: Number(expected.totalVatOre) / 100,
    totalIncVat: Number(expected.totalIncVatOre) / 100,
    lines: expected.lines.map(line => ({
      lineType: line.code === 'spot' ? 'base_price' : 'component', description: line.code,
      amountExVat: Number(line.exVatOre) / 100, vatAmount: Number(line.vatOre) / 100,
      amountIncVat: Number(line.incVatOre) / 100,
      metadata: line.code === 'spot'
        ? { source_type: 'spot', source_price_sek_per_kwh: oracle.weightedPrice(intervals).weightedAsNumber }
        : { component_code: line.code === 'markup' ? 'spot_markup' : line.code },
    })),
  }
  if (options.wrong === 'base') preview.lines[0].amountExVat += 1
  if (options.wrong === 'fee') preview.lines.find(line => line.description === 'monthly_fee')!.amountExVat += 1
  if (options.wrong === 'vat') preview.lines[0].vatAmount += 1
  if (options.wrong === 'total') preview.totalIncVat += 1
  const row = {
    ...contract, id: 'component-underlay', metering_point_id: contract.meteringPointId,
    status: 'validated', readiness_status: 'ready', total_kwh: options.wrong === 'quantity' ? '1' : quantity,
    source_meter_value_count: points.length - (options.wrong === 'source-count' ? 1 : 0),
    missing_values_count: options.wrong === 'missing' ? 1 : 0,
  }
  const result = {
    underlayId: row.id, status: options.overlap === 'wrong-status' || monthly ? 'ready_for_pricing' : 'needs_review',
    sourceRows: points.length,
    warnings: monthly ? (options.wrong === 'coverage' ? ['Lucka i mätvärden'] : [])
      : (options.overlap === 'none' ? [] : ['Överlappande leveransperioder']),
  }
  const fakeBilling = {
    ...billing,
    disableConsumptionEstimates: () => {},
    spotImportFootprint: () => ({ runs: 0, jobs: 0 }),
    insertSpotIntervals: () => {}, prepareAndLockSpotMonth: async () => ({}), insertMeteringValues: () => ({}),
    readContractTerms: () => terms,
    createSupplyPeriod: () => {
      calls.supply++
      if (options.setupError && options.setupStage === 'supply' && calls.supply === (monthly ? 1 : 2)) throw options.setupError
      return 'component-supply-' + calls.supply
    },
    generateUnderlay: async () => { calls.generate++; return { status: options.generateStatus ?? 200, data: { results: [result] } } },
    readUnderlaysForMonth: () => options.overlap === 'no-underlays' ? [] : [{ ...row,
      total_kwh: options.overlap === 'double-billed' ? oracle.decToString(oracle.decMul(oracle.dec(quantity), oracle.dec(2))) : row.total_kwh,
    }],
    pricePreview: async () => {
      calls.preview++
      return { status: options.status ?? 200, data: Object.hasOwn(options, 'invalidData') ? options.invalidData : preview, text: 'controlled response' }
    },
  }
  evaluate(path.join(root, 'scenarios', monthly ? 'term02.test.ts' : 'term03.test.ts'), {
    'node:fs': { mkdirSync: refuseIO, writeFileSync: refuseIO }, 'node:path': path,
    vitest: { describe: (_name: string, callback: () => void) => callback(),
      it: (name: string, run: () => Promise<void>) => tests.push({ name, run }), beforeAll: () => {}, afterAll: () => {}, expect },
    '../lib': { loginSession: async () => ({}), removeAdminFixtureUser: refuseIO, SIM_HOME: 'component-private-home',
      psqlRows: () => [{ n: 1 }], psql: refuseIO },
    '../lib/term-fixture': {
      createTermTenant: async () => tenant,
      createSignedContract: async () => {
        calls.contract++
        if (options.setupError && options.setupStage === 'contract' && calls.contract === (monthly ? 1 : 2)) throw options.setupError
        return { ...contract, contractId: 'component-contract-' + calls.contract }
      },
    },
    '../lib/term-billing': fakeBilling, '../lib/term-oracle': oracle, '../lib/term02-data': data,
    '../lib/server-action': { callServerAction: refuseIO }, '../lib/term-page': { readContractPage: refuseIO },
  }, { process: { env: {} }, console: { info: (...args: unknown[]) => calls.observations.push(args.join(' ')) } })
  const prefix = monthly ? 'TERM02.04 f) månadsavtal + kvartsmätning:' : 'TERM03.05b appen flaggar överlapp'
  const registered = tests.filter(test => test.name.startsWith(prefix))
  expect(registered).toHaveLength(1)
  return { run: registered[0].run, calls }
}

describe('TERM02 monthly-quarterly actual callback requires a successful pricing decision', () => {
  it.each([400, 401, 403, 404, 409, 500, 503])('rejects HTTP %i, never calls it a business refusal', async status => {
    const test = registeredCallback({ status, invalidData: null })
    await expect(test.run()).rejects.toThrow()
  })
  it.each([null, {}, { status: 'failed', errors: ['generic failure'] }, { status: 'needs_review', errors: ['no decision'] }])('rejects empty, malformed or unsuccessful data: %j', async invalidData => {
    await expect(registeredCallback({ invalidData }).run()).rejects.toThrow()
  })
  it.each(['source-count', 'missing', 'quantity', 'coverage', 'base', 'fee', 'vat', 'total'] as const)('checks actual coverage and money after successful pricing: %s', async wrong => {
    await expect(registeredCallback({ wrong }).run()).rejects.toThrow()
  })
  it('accepts supported pricing only after real coverage and arithmetic assertions', async () => {
    const test = registeredCallback()
    await expect(test.run()).resolves.toBeUndefined()
    expect(test.calls).toMatchObject({ contract: 1, supply: 1, generate: 1, preview: 2 })
    expect(test.calls.observations.some(line => line.includes('ÖPPEN ORAKELFRÅGA'))).toBe(true)
  })
  it.each(['contract', 'supply'] as const)('propagates setup failure from %s unchanged', async setupStage => {
    const error = new Error('component setup failed; no business decision')
    const test = registeredCallback({ setupStage, setupError: error })
    await expect(test.run()).rejects.toBe(error)
    expect(test.calls.preview).toBe(0)
  })
  it('rejects failed generate-underlay setup', async () => {
    await expect(registeredCallback({ generateStatus: 500 }).run()).rejects.toThrow()
  })
})

describe('TERM03 overlap actual callback must reach real overlap and no-double-billing checks', () => {
  it.each([
    ['contract', 'createContractFromOfferAction: server action misslyckades (HTTP 500, kastade=true, redirect=-)'],
    ['contract', 'createContractFromOfferAction: server action misslyckades (HTTP 401, kastade=true, redirect=-)'],
    ['contract', 'createContractFromOfferAction: skapade 0 nya avtal'],
    ['contract', 'unrelated fixture infrastructure error'],
    ['supply', 'SQL timeout; no database response; outcome unknown'],
    ['supply', 'connection lost; outcome unknown'],
    ['supply', 'arbitrary constraint error without qualified domain evidence'],
  ] as const)('propagates %s failure without inventing business refusal: %s', async (setupStage, message) => {
    const error = Object.assign(new Error(message), { stderr: message })
    const test = registeredCallback({ group: 'overlap', setupStage, setupError: error })
    await expect(test.run()).rejects.toBe(error)
    expect(test.calls.generate).toBe(0)
  })
  it.each(['none', 'wrong-status', 'double-billed', 'no-underlays'] as const)('rejects incomplete or wrong overlap behavior: %s', async overlap => {
    await expect(registeredCallback({ group: 'overlap', overlap }).run()).rejects.toThrow()
  })
  it('accepts actual overlap warnings and one physical measured total after both setups succeed', async () => {
    const test = registeredCallback({ group: 'overlap' })
    await expect(test.run()).resolves.toBeUndefined()
    expect(test.calls).toMatchObject({ contract: 2, supply: 2, generate: 1, preview: 0 })
  })
})
