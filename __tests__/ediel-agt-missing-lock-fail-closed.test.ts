// local/054: real preparation + installed PostgREST builder; synthetic fetch/gate/transport ports.
// No actual DB, transport, native acceptance or whole-action rollback is proved here.
import { PostgrestClient } from '@supabase/postgrest-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Phase = 'read' | 'insert' | 'bind'
type Request = { table: string; method: string; projection: string | null; accept: string | null; prefer: string | null; filters: Array<[string, string]>; payload: Row | null }
const io = vi.hoisted(() => ({
  client: null as unknown,
  events: [] as string[], rows: [] as Row[], requests: [] as Request[],
  errors: {} as Partial<Record<Phase, { code: string; message: string }>>,
  cardinality: {} as Partial<Record<'insert' | 'bind', number>>,
  existing: false, missingId: false, wrongBoundId: false,
  createFailure: false, partialCreateFailure: false, expireDuringCreate: false, releaseDuringCreate: false,
  builderFailure: false, updateFailure: false, waiting: false, unknown: false, tgt: false,
  gate: vi.fn(), certificate: vi.fn(), encrypt: vi.fn(),
}))
const definition = () => ({ suite: 'PRODAT', messageFamily: 'PRODAT', messageCode: 'Z03', approvalVersion: 'synthetic',
  scenario: io.waiting ? 'portal_sends' : 'actor_sends_and_receives_ack', title: 'Synthetic lock test', purpose: 'Unit isolation', notes: [], expectedSteps: [] })
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return io.client } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielTestRun: async () => {
  io.events.push('create')
  if (io.partialCreateFailure) { io.events.push('snapshot-persisted', 'run-persisted'); throw new Error('synthetic partial create failure') }
  if (io.createFailure) throw new Error('synthetic create failure')
  if (io.expireDuringCreate) vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
  if (io.releaseDuringCreate) io.rows.forEach(row => { row.released_at = new Date().toISOString() })
  return { id: 'run-own', company_id: 'company-own', status: 'running' }
} }))
vi.mock('@/lib/ediel/testing/agtRegistry', () => ({ getEdielAgtTestCaseByCode: () => io.unknown || io.tgt ? null : definition() }))
vi.mock('@/lib/ediel/testing/tgtRegistry', () => ({ getEdielTgtTestCaseByCode: () => io.tgt ? definition() : null }))
vi.mock('@/lib/ediel/testing/agtEngine', () => ({ createEdielSupplierAgtOutboundCommand: async () => {
  io.events.push('draft')
  if (io.builderFailure) throw new Error('synthetic builder failure')
  return { id: 'message-own', raw_payload: 'SYNTHETIC', message_standard: 'edifact', mime_type: 'text/plain', file_name: 'synthetic.edi' }
} }))
vi.mock('@/lib/ediel/core/messageBuilder', () => ({ preflightEdielPayload: () => ({ ok: true, family: 'PRODAT', code: 'Z03' }) }))
vi.mock('@/lib/ediel/transport/smime', () => ({ createSmimeEncryptedPayloadReference: io.encrypt }))
vi.mock('@/lib/ediel/security/outboundRecipientCertificate', () => ({ resolveOutboundRecipientCertificate: io.certificate, routeReceiverSubaddress: () => null }))
vi.mock('@/lib/ediel/testing/environmentGate', () => ({ assertEdielEnvironmentGate: io.gate }))
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
function fault(code: string, message = 'synthetic lock denial') {
  return response({ code, message, details: null, hint: null }, code === 'PGRST116' ? 406 : 400)
}
function matches(row: Row, filters: URLSearchParams) {
  for (const [field, expression] of filters) {
    if (['select', 'order', 'limit'].includes(field)) continue
    const dot = expression.indexOf('.'), op = expression.slice(0, dot), value = expression.slice(dot + 1)
    if (op === 'eq') { if (row[field] == null || String(row[field]) !== value) return false }
    else if (op === 'is' && value === 'null') { if (row[field] !== null) return false }
    else if (op === 'gt') { if (row[field] == null || !(String(row[field]) > value)) return false }
    else throw new Error(`Unexpected lock predicate ${field}:${expression}`)
  }
  return true
}
function client() {
  return new PostgrestClient('http://synthetic.invalid/rest/v1', { retry: false, fetch: async (input, init = {}) => {
    const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!, method = init.method ?? 'GET'
    const headers = new Headers(init.headers), payload = init.body ? JSON.parse(String(init.body)) as Row : null
    io.requests.push({ table, method, projection: url.searchParams.get('select'), accept: headers.get('accept'), prefer: headers.get('prefer'), filters: [...url.searchParams], payload })
    if (table === 'ediel_route_profiles') return response([])
    if (table === 'ediel_test_runs') {
      io.events.push('run-update')
      return io.updateFailure ? fault('42501', 'synthetic update denial') : response({ id: 'run-own', company_id: 'company-own', ...payload })
    }
    if (table !== 'ediel_test_run_locks') throw new Error(`Unexpected mocked table ${table}`)
    const phase: Phase = method === 'GET' ? 'read' : method === 'POST' ? 'insert' : 'bind'
    io.events.push(phase)
    const error = io.errors[phase]
    if (error) return fault(error.code, error.message)
    let affected: Row[]
    if (method === 'POST') {
      // Model actual SQL defaults; never interpret a JS undefined value as NULL.
      const row = { id: io.missingId ? '' : 'lock-own', active_test_run_id: null, released_at: null, ...payload }
      io.rows.push(row)
      affected = [row]
    } else {
      affected = io.rows.filter(row => matches(row, url.searchParams))
      if (method === 'PATCH') affected.forEach(row => Object.assign(row, payload))
    }
    if (method === 'GET' && url.searchParams.has('limit')) affected = affected.slice(0, Number(url.searchParams.get('limit')))
    // Deliberately anomalous return/cardinality fixtures, not claimed SQL uniqueness failures.
    if (phase !== 'read' && io.cardinality[phase] === 0) affected = []
    if (phase !== 'read' && io.cardinality[phase] === 2) affected = [{ id: 'first' }, { id: 'second' }]
    if (phase === 'bind' && io.wrongBoundId) affected = [{ ...affected[0], id: 'different-lock' }]
    if (method !== 'GET' && !headers.get('prefer')?.includes('return=representation')) return new Response(null, { status: 204 })
    const projection = url.searchParams.get('select')
    if (projection && projection !== '*') affected = affected.map(row => Object.fromEntries(projection.split(',').map(key => [key, row[key] ?? null])))
    if (headers.get('accept') === 'application/vnd.pgrst.object+json') return affected.length === 1 ? response(affected[0]) : fault('PGRST116')
    return response(affected)
  } })
}
const prepare = (change: Partial<Parameters<typeof prepareEdielTestRunTransportMetadata>[0]> = {}) => prepareEdielTestRunTransportMetadata({
  companyId: 'company-own', actorUserId: 'actor-own', testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'SYNTHETIC', environment: 'test', environmentType: 'agt_test', encryptionMode: 'none', ...change,
})
const count = (event: string) => io.events.filter(value => value === event).length
function noPreparation() { expect(count('draft')).toBe(0); expect(count('run-update')).toBe(0); expect(io.encrypt).not.toHaveBeenCalled() }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  vi.clearAllMocks(); io.events = []; io.rows = []; io.requests = []; io.errors = {}; io.cardinality = {}
  io.existing = false; io.missingId = false; io.wrongBoundId = false; io.createFailure = false; io.partialCreateFailure = false
  io.expireDuringCreate = false; io.releaseDuringCreate = false; io.builderFailure = false; io.updateFailure = false
  io.waiting = false; io.unknown = false; io.tgt = false
  io.gate.mockResolvedValue(undefined)
  io.certificate.mockResolvedValue({ publicCertificatePem: 'SYNTHETIC-NOT-A-CERT', fingerprintSha256: 'synthetic' })
  io.encrypt.mockResolvedValue({ encryptedPayloadRef: 'synthetic-ref', encryptedPayloadSha256: 'synthetic-hash', encryptedPayloadLength: 1 })
  io.client = client()
})
afterEach(() => vi.useRealTimers())

describe.each(['read', 'insert', 'bind'] as const)('AGT lock %s failures', phase => {
  it.each(['42P01', '42703', 'PGRST204', 'PGRST205', '42501', '23505'])('propagates %s before continuation', async code => {
    io.errors[phase] = { code, message: `synthetic ${phase} failure` }
    await expect(prepare({ encryptionMode: 'smime' })).rejects.toMatchObject({ code })
    expect(count('create')).toBe(phase === 'bind' ? 1 : 0)
    if (phase === 'read') expect(count('insert')).toBe(0)
    noPreparation()
  })
})
it('preserves existing scoped active-lock denial before run creation', async () => {
  io.rows.push({ id: 'existing-lock', company_id: 'company-own', actor_role: 'supplier', message_family: 'PRODAT', environment_type: 'agt_test', released_at: null, expires_at: '2099-01-01T00:00:00Z' })
  await expect(prepare()).rejects.toThrow('redan aktivt'); expect(count('insert')).toBe(0); expect(count('create')).toBe(0); noPreparation()
})
it.each(['insert', 'bind'] as const)('rejects zero returned rows at %s', async phase => {
  io.cardinality[phase] = 0; await expect(prepare()).rejects.toMatchObject({ code: 'PGRST116' }); expect(count('create')).toBe(phase === 'bind' ? 1 : 0); noPreparation()
})
it.each(['insert', 'bind'] as const)('rejects multiple returned rows at %s', async phase => {
  io.cardinality[phase] = 2; await expect(prepare()).rejects.toMatchObject({ code: 'PGRST116' }); expect(count('create')).toBe(phase === 'bind' ? 1 : 0); noPreparation()
})
it('rejects missing acquisition identity before creating a run', async () => {
  io.missingId = true; await expect(prepare()).rejects.toThrow(); expect(count('create')).toBe(0); noPreparation()
})
it('rejects a mismatched returned binding identity after creating only the run', async () => {
  io.wrongBoundId = true; await expect(prepare()).rejects.toThrow(); expect(count('create')).toBe(1); noPreparation()
})
it.each(['expireDuringCreate', 'releaseDuringCreate'] as const)('rejects a lock changed by %s before drafting', async condition => {
  io[condition] = true; await expect(prepare()).rejects.toMatchObject({ code: 'PGRST116' }); expect(count('create')).toBe(1); noPreparation()
})
it('verifies exact ID-only acquisition and scoped binding before draft/encryption', async () => {
  const run = await prepare({ encryptionMode: 'smime' })
  expect(run.id).toBe('run-own'); expect(io.events).toEqual(['read', 'insert', 'create', 'bind', 'draft', 'run-update'])
  expect(io.encrypt).toHaveBeenCalledOnce()
  for (const method of ['POST', 'PATCH']) {
    const request = io.requests.find(value => value.table === 'ediel_test_run_locks' && value.method === method)!
    expect(request.projection).toBe('id'); expect(request.accept).toBe('application/vnd.pgrst.object+json'); expect(request.prefer).toContain('return=representation')
  }
  const bind = io.requests.find(value => value.table === 'ediel_test_run_locks' && value.method === 'PATCH')!
  expect(Object.fromEntries(bind.filters)).toEqual({ select: 'id', id: 'eq.lock-own', company_id: 'eq.company-own', actor_role: 'eq.supplier', message_family: 'eq.PRODAT', environment_type: 'eq.agt_test', released_at: 'is.null', expires_at: `gt.${new Date().toISOString()}` })
  expect(bind.payload).toEqual({ active_test_run_id: 'run-own', updated_at: new Date().toISOString() })
})
it('binds the acquired lock before the inbound/waiting run metadata update', async () => {
  io.waiting = true; await prepare(); expect(io.events).toEqual(['read', 'insert', 'create', 'bind', 'run-update'])
})
it.each(['createFailure', 'partialCreateFailure'] as const)('retains lock evidence on %s without fake rollback', async condition => {
  io[condition] = true; await expect(prepare()).rejects.toThrow('create failure'); expect(count('bind')).toBe(0); noPreparation(); expect(io.rows).toHaveLength(1)
  if (condition === 'partialCreateFailure') expect(io.events).toContain('run-persisted')
})
it('retains bound lock on later builder failure', async () => {
  io.builderFailure = true; await expect(prepare()).rejects.toThrow('builder failure'); expect(io.rows[0].active_test_run_id).toBe('run-own'); expect(count('run-update')).toBe(0)
})
it('retains bound lock on later metadata failure', async () => {
  io.updateFailure = true; await expect(prepare()).rejects.toMatchObject({ code: '42501' }); expect(io.rows[0].active_test_run_id).toBe('run-own')
})
it.each(['tgt_test', 'bilateral_test', 'production'] as const)('preserves %s without AGT lock IO', async environmentType => {
  io.tgt = environmentType === 'tgt_test'; const run = await prepare({ environmentType, environment: environmentType === 'production' ? 'production' : 'test' }); expect(run.environment_type).toBe(environmentType); expect(io.requests.filter(value => value.table === 'ediel_test_run_locks')).toEqual([])
})
it.each(['test', 'production-like test'])('preserves legacy %s as TGT without AGT locking', async environmentType => {
  io.tgt = true; const run = await prepare({ environmentType }); expect(run.environment_type).toBe('tgt_test'); expect(io.requests.filter(value => value.table === 'ediel_test_run_locks')).toEqual([])
})
it('keeps environment denial before acquisition or creation', async () => {
  io.gate.mockRejectedValue(new Error('synthetic gate denial')); await expect(prepare()).rejects.toThrow('gate denial'); expect(count('read')).toBe(0); expect(count('create')).toBe(0)
})
it('keeps recipient rejection before acquisition or creation', async () => {
  io.certificate.mockRejectedValue(new Error('synthetic recipient denial')); await expect(prepare({ encryptionMode: 'smime' })).rejects.toThrow('recipient denial'); expect(count('read')).toBe(0); expect(count('create')).toBe(0)
})
it('keeps unknown registry case denial before all lock IO', async () => {
  io.unknown = true; await expect(prepare()).rejects.toThrow('Okänt'); expect(io.gate).not.toHaveBeenCalled(); expect(count('read')).toBe(0); expect(count('create')).toBe(0)
})

describe('controlled fetch fidelity with actual PostgREST query builder', () => {
  const db = () => io.client as ReturnType<typeof client>
  it('does not return representation for an unselected mutation; SQL omitted fields default NULL', async () => {
    const result = await db().from('ediel_test_run_locks').insert({ company_id: 'company-own' }); expect(result.data).toBeNull(); expect(io.rows[0].active_test_run_id).toBeNull(); expect(io.rows[0].released_at).toBeNull()
  })
  it('returns exactly selected ID for single-row insert', async () => {
    const result = await db().from('ediel_test_run_locks').insert({ company_id: 'company-own' }).select('id').single(); expect(result.error).toBeNull(); expect(result.data).toEqual({ id: 'lock-own' })
  })
  it('distinguishes single-zero error from maybeSingle-zero success', async () => {
    expect((await db().from('ediel_test_run_locks').select('id').single()).error?.code).toBe('PGRST116'); expect(await db().from('ediel_test_run_locks').select('id').maybeSingle()).toMatchObject({ data: null, error: null })
  })
  it.each(['single', 'maybeSingle'] as const)('%s rejects multiple rows', async cardinality => {
    io.rows.push({ id: 'a' }, { id: 'b' }); expect((await db().from('ediel_test_run_locks').select('id')[cardinality]()).error?.code).toBe('PGRST116')
  })
})
