// Actual resumer + actual tenantDb, with finite storage/recovery/processor ports.
// No Supabase/native qualification and no customer sends.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Row = Record<string, unknown>
type Result = { exhausted: number; resumed: number; errors: string[] }
type Target = { companyId: string; sourceMessageId: string }
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`
const target = (n = 1, companyId = B): Target => ({ companyId, sourceMessageId: id(n) })
function load<T>(file: string, ports: Row): T {
  const source = fs.readFileSync(path.resolve(file), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, require: (name: string) => {
    if (!(name in ports)) throw new Error(`unexpected dependency ${name}`)
    return ports[name]
  }, Date, Map, Set, Array, Object, Number, String, Math, JSON, Error, performance, AbortSignal, console })
  return exports as T
}
function event(t: Target, companyId = t.companyId, extra: Row = {}): Row {
  return { company_id: companyId, ediel_message_id: t.sourceMessageId, event_type: 'manual_note', created_at: new Date().toISOString(),
    payload: { resume: 'held_utilts_resume', kind: 'attempt', fingerprint: 'issuer:qualified' }, ...extra }
}
async function run(targets: Target[], events: Row[], options: { ignorePairPredicate?: boolean; historyError?: boolean; wrongSourceCompany?: boolean } = {}) {
  let processed = 0, authorizations = 0
  const reads: Array<{ table: string; limit: number; pairs: string | null; company: string | null }> = []
  const old = new Date(Date.now() - 600000).toISOString()
  const tables: Record<string, Row[]> = {
    ediel_message_events: events,
    ediel_ack_transaction_results: targets.map(t => ({ company_id: t.companyId, source_message_id: t.sourceMessageId, environment: 'production', source_transaction_id: 'TX',
      disposition: 'internal_review', issue_codes: ['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'], created_at: old, updated_at: old })),
    ediel_messages: targets.map(t => ({ id: t.sourceMessageId, company_id: options.wrongSourceCompany ? A : t.companyId, environment: 'production', direction: 'inbound', message_family: 'UTILTS', status: 'validated', parsed_payload: {} })),
  }
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let max = Infinity, single = false, pairs: string | null = null, company: string | null = null
    const value = (row: Row, key: string) => {
      const [column, member] = key.split('->>')
      return member ? (row[column] as Row)?.[member] : row[column]
    }
    const q = {
      select: () => q,
      eq: (key: string, val: unknown) => { if (key === 'company_id') company = String(val); filters.push(r => value(r, key) === val); return q },
      in: (key: string, vals: unknown[]) => { expect(vals.length).toBeLessThanOrEqual(50); filters.push(r => vals.includes(value(r, key))); return q },
      or: (filter: string) => {
        pairs = filter
        // Exact emitted PostgREST grammar, including JSON-quoted escaped values.
        const terms = [...filter.matchAll(/and\(company_id\.eq\.("(?:[^"\\]|\\.)*"),ediel_message_id\.eq\.("(?:[^"\\]|\\.)*")\)/g)]
        expect(terms.map(term => term[0]).join(',')).toBe(filter)
        expect(terms.length).toBeLessThanOrEqual(50)
        if (!options.ignorePairPredicate) filters.push(r => terms.some(term => r.company_id === JSON.parse(term[1]) && r.ediel_message_id === JSON.parse(term[2])))
        return q
      },
      limit: (n: number) => { max = n; return q },
      order: () => q,
      abortSignal: (signal: AbortSignal) => { expect(signal).toBeInstanceOf(AbortSignal); return q },
      maybeSingle: () => { single = true; return q },
      then: <T, U>(resolve: (v: { data: Row[] | Row | null; error: Error | null }) => T | PromiseLike<T>, reject?: (e: unknown) => U | PromiseLike<U>) => {
        reads.push({ table, limit: max, pairs, company })
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(0, max)
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: options.historyError && table === 'ediel_message_events' ? new Error('history unavailable') : null }).then(resolve, reject)
      },
    }
    return q
  }
  const service = { from: query, rpc: (_name: string, args: Row) => ({ abortSignal: async () => ({ error: null, data: {
    companyId: args.p_company_id, sourceMessageId: args.p_message_id, environment: 'production', status: 'qualified', authorityVersionId: 'fixture-current', namespaceEpoch: 1,
  } }) }) }
  const tenant = load<{ tenantDb: (company: string | null) => unknown }>('lib/supabase/tenantDb.ts', { '@/lib/supabase/service': { supabaseService: service } })
  const subject = load<{ resumeHeldInboundUtilts: (input: Row) => Promise<Result> }>('lib/ediel/utilts/heldUtiltsResume.ts', {
    'node:crypto': crypto,
    '@/lib/supabase/service': { supabaseService: service }, '@/lib/supabase/tenantDb': tenant,
    '@/lib/inbound-mail/edielRecoveryWork': { claimRecoveryWork: async () => ({ claimed: targets.map(t => ({ ...t, attempt: 1, maxAttempts: 6, recovery: { token: 'fixture', deadline: performance.now() + 45000 } })) }),
      runRecoveryBatch: async (work: Target[], action: (t: Target) => Promise<unknown>) => { for (const item of work) await action(item) }, releaseRecoveryWork: async () => {} },
    '@/lib/ediel/db': { createEdielMessageEvent: async () => ({}) },
    '@/lib/ediel/services/authorization': { assertEdielTenantActor: async () => { authorizations++ } },
    '@/lib/ediel/flows/utiltsDataRequest.part-1': { resolveUtiltsRuntimeTestCaseCode: async () => null },
    '@/lib/ediel/utilts/utiltsRuntimeReplyDispatch': { resolveUtiltsRuntimeReplyDispatch: () => ({ dispatch: 'operational_outbox' }) },
    '@/lib/ediel/utilts/utiltsHeldSourceResumption': { resumeInboundUtiltsSourceFromOriginal: async () => { processed++; return { status: 'processed', stillHeldTransactionIds: [] } } },
  })
  try {
    const result = await subject.resumeHeldInboundUtilts({ actorUserId: id(999), workerId: 'fixture', environment: 'production', limit: 200 })
    return { result, processed, authorizations, reads, error: null }
  } catch (error) { return { result: null, processed, authorizations, reads, error } }
}

describe('held UTILTS history belongs to its leased company/message pair', () => {
  it('resumes a clean eligible source through the existing engine', async () => {
    const outcome = await run([target()], [])
    expect(outcome.result?.resumed).toBe(1); expect(outcome.processed).toBe(1); expect(outcome.authorizations).toBe(2)
  })
  it.each([6, 201])('foreign company %i notes cannot exhaust the source or fill its cap', async n => {
    const t = target(), outcome = await run([t], Array.from({ length: n }, () => event(t, A)))
    expect(outcome.result?.exhausted).toBe(0); expect(outcome.processed).toBe(1)
  })
  it('defensively ignores a foreign row even if a storage port returns it', async () => {
    const t = target(), outcome = await run([t], Array.from({ length: 6 }, () => event(t, A)), { ignorePairPredicate: true })
    expect(outcome.processed).toBe(1)
  })
  it('retains the own-company attempt budget', async () => {
    const t = target(), outcome = await run([t], Array.from({ length: 6 }, () => event(t)))
    expect(outcome.result?.exhausted).toBe(1); expect(outcome.processed).toBe(0)
  })
  it('keeps an incomplete own history closed at the unchanged 201-row cap', async () => {
    const t = target(), outcome = await run([t], Array.from({ length: 201 }, () => event(t, B, { payload: { resume: 'held_utilts_resume', kind: 'result' } })))
    expect(outcome.result?.exhausted).toBe(1); expect(outcome.processed).toBe(0)
    expect(outcome.reads.find(r => r.table === 'ediel_message_events')?.limit).toBe(201)
  })
  it('matches pairs rather than an independent company/source cross product', async () => {
    const a = target(1, A), b = target(2, B)
    const outcome = await run([a, b], [...Array.from({ length: 6 }, () => event(a, B)), ...Array.from({ length: 6 }, () => event(b, A))])
    expect(outcome.processed).toBe(2); expect(outcome.result?.exhausted).toBe(0)
    expect(outcome.reads.filter(r => r.table === 'ediel_message_events')).toHaveLength(1)
  })
  it('retains one history query per50 targets and the original source-read tenant', async () => {
    const targets = Array.from({ length: 51 }, (_, n) => target(n + 1, n % 2 ? A : B))
    const outcome = await run(targets, [])
    // Existing per-run source cap remains50 even when history covers51 leased targets.
    expect(outcome.processed).toBe(50)
    expect(outcome.reads.filter(r => r.table === 'ediel_message_events')).toHaveLength(2)
    expect(outcome.reads.filter(r => r.table !== 'ediel_message_events').every(r => r.company === A || r.company === B)).toBe(true)
  })
  it('does not process a source in another tenant', async () => {
    const outcome = await run([target()], [], { wrongSourceCompany: true })
    expect(outcome.processed).toBe(0)
  })
  it('does not resume when history cannot be read', async () => {
    const outcome = await run([target()], [], { historyError: true })
    expect(outcome.error).toBeInstanceOf(Error); expect(outcome.processed).toBe(0)
  })
})
