// Execute real T3 flow/callbacks with finite service ports. Component evidence only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../scripts/simulation/track3/', import.meta.url))
const refused = () => { throw new Error('Undeclared service operation') }
function load<T>(file: string, ports: Record<string, unknown>, bridge = ''): T {
  const filename = root + file
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  runInNewContext(code + '\n' + bridge, {
    exports, Buffer, process: { env: {} }, Date, console,
    require: (name: string) => {
      if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name)
      return ports[name]
    },
  }, { filename, timeout: 5000 })
  return exports as T
}
function flowWith(result: { ok: boolean; error?: string }, thrown?: Error) {
  const calls: string[] = [], saved: Record<string, unknown> = {}
  const unit = load<{ E02Flow: new (ev: unknown, mailbox: string) => { groundAndReprocess: (ids: string[]) => Promise<unknown> } }>('lib/e02-flow.ts', {
    'node:crypto': {}, './counterparty': {}, './app': {}, './evidence': {}, './inprocess': {}, './mime': {},
    './e02-seed': {
      grantHistoryGround: (id: string) => { calls.push('grant:' + id); return 1 },
      reprocessInbound: async (id: string) => { calls.push('process:' + id); if (thrown) throw thrown; return result },
    },
    './seed.mjs': {},
  })
  const flow = new unit.E02Flow({ save: (name: string, value: unknown) => { saved[name] = value } }, 'owned-mailbox')
  return { flow, calls, saved }
}
describe('T3 E02 unknown processing outcome', () => {
  it.each(['57014: canceling statement due to statement timeout', 'statement timeout'])('stops after %s without repeating or processing the next source', async error => {
    const c = flowWith({ ok: false, error })
    await expect(c.flow.groundAndReprocess(['source-A', 'source-B'])).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.calls).toEqual(['grant:source-A', 'process:source-A'])
    expect(c.saved['reprocess-unknown-outcome.json']).toMatchObject({
      sourceMessageId: 'source-A', attempts: 1, recovery: 'observe_persistent_effects_before_retry',
    })
  })
  it('retains the ordinary business refusal and processes each declared source once', async () => {
    const c = flowWith({ ok: false, error: 'utilts_consumption_correction_not_newer' })
    await expect(c.flow.groundAndReprocess(['source-A'])).resolves.toMatchObject({
      'source-A': { attempts: 1, reprocess: { ok: false, error: 'utilts_consumption_correction_not_newer' } },
    })
    expect(c.calls).toEqual(['grant:source-A', 'process:source-A'])
  })
  it('does not retry an exception with an unknown partial outcome', async () => {
    const error = new Error('connection closed after dispatch')
    const c = flowWith({ ok: true }, error)
    await expect(c.flow.groundAndReprocess(['source-A', 'source-B'])).rejects.toBe(error)
    expect(c.calls).toEqual(['grant:source-A', 'process:source-A'])
  })
  it('preserves a successful processing result', async () => {
    const c = flowWith({ ok: true })
    await expect(c.flow.groundAndReprocess(['source-A'])).resolves.toMatchObject({ 'source-A': { attempts: 1, reprocess: { ok: true } } })
  })
})

// A plausible business failure is not enough: execute the real scenario against
// unchanged metering rows but a corrupted canonical current source after rejection.
function correction(mode: 'retained' | 'rejected-current' | 'same-quantity-wrong-source') {
  const callbacks = new Map<string, () => Promise<void>>()
  const ev = { save() {}, observe() {} }
  const fx = { companyId: 'own-company', actorUserId: 'own-actor', customerId: 'own-customer', pointId: 'own-point', meteringPoint: 'synthetic' }
  const meterA = { kwh: 500, current: true, rev: 'current', n: 1 }
  const meterB = [{ ...meterA, current: false, rev: 'replaced' }, { kwh: 600, current: true, rev: 'current', n: 2 }]
  const normalB = [{ kwh: 500, rev: 'replaced', n: 1 }, { kwh: 600, rev: 'current', n: 2 }]
  const seriesA = { tx: 'tx-A', current: false, ver: 1, upd: '202607010020', qty: '500' }
  const seriesB = { tx: 'tx-B', current: true, ver: 2, upd: '202607010040', qty: '600' }
  let phase = 0
  const state = () => phase === 1
    ? { metering: [meterA], normalized: [{ kwh: 500, rev: 'current', n: 1 }], series: [{ ...seriesA, current: true }], billing: [] }
    : { metering: meterB, normalized: normalB, billing: [], series: phase === 2
      ? [seriesA, seriesB]
      : [seriesA, { ...seriesB, current: mode !== 'rejected-current', tx: mode === 'same-quantity-wrong-source' ? 'tx-C' : 'tx-B' },
        { tx: 'tx-C', current: mode === 'rejected-current', ver: 3, upd: '202607010040', qty: '700' }] }
  const counts = () => ({ invoices: 0, meteringValues: phase === 1 ? 1 : 2, normalized: phase === 1 ? 1 : 2, billingUnderlays: 0 })
  const unit = load<{ prime: (state: unknown) => void }>('scenarios/ediel02-corr.test.ts', {
    vitest: { expect, beforeAll() {}, afterAll() {}, describe: (_: string, fn: () => void) => fn(), it: (name: string, fn: () => Promise<void>) => callbacks.set(name, fn) },
    '../lib/counterparty': { purgeInbox: async () => {}, receivedMail: refused },
    '../lib/e02-rpc': { consumeMeteringDirect: async () => ({ error: { message: 'utilts_consumption_correction_not_newer' } }) },
    '../lib/e02-edifact': { buildE02Utilts: ({ seq }: { seq: number }) => ({ raw: 'synthetic-wire-' + seq, transactionRef: seq === 31 ? 'tx-A' : seq === 32 ? 'tx-B' : 'tx-C' }) },
    '../lib/e02-flow': { lit: (x: unknown) => "'" + String(x) + "'", sql: () => '[]', deliverE02: async () => {
      phase++
      const id = ['source-A', 'source-B', 'source-C'][phase - 1]
      return { ids: [id], poll: { summary: {} }, reproc: { [id]: { reprocess: { ok: phase !== 3, error: phase === 3 ? 'utilts_consumption_correction_not_newer' : undefined } } } }
    } },
    '../lib/e02-seed': { e02MeteringPoint: () => fx.meteringPoint, seedE02Routable: () => fx, reprocessInbound: async () => ({ ok: false, error: 'utilts_consumption_correction_not_newer' }) },
    '../lib/e02-state': { e02Counts: counts, e02Quantities: state },
    '../lib/e02-setup': { setupE02: refused },
  }, 'exports.prime=s=>S=s;')
  unit.prime({ flow: { drain: async () => ({ mails: [] }) }, run: { prefix: 'owned' }, ev })
  const callback = [...callbacks].find(([name]) => name.startsWith('EDIEL02.03 '))?.[1]
  if (!callback) throw new Error('Actual correction callback missing')
  return callback
}
describe('T3 actual correction current-series oracle', () => {
  it('accepts retained accepted source with rejected history', async () => { await correction('retained')() })
  it.each(['rejected-current', 'same-quantity-wrong-source'] as const)('refuses %s despite a business rejection and unchanged metering quantities', async mode => {
    await expect(correction(mode)()).rejects.toThrow()
  })
})
