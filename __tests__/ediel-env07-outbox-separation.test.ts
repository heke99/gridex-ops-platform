// masterplan: ENV-07, AT-ENV-07
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'

// Real queue claim, queue iteration and sendOutboxItem control flow; database,
// current permission/readiness and final transport ports are substituted.
// This proves separate message dispatch and tenant refusal, not native/RLS/SMTP.
const port = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(), messages: new Map<string, EdielMessageRow>(),
  submitted: [] as Array<{ company: string | null; raw: string | null }>, messageReads: [] as Array<[string, string]>,
  rpc: vi.fn(), from: vi.fn(), get: vi.fn(), send: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: port.rpc, from: port.from } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: port.get }))
vi.mock('@/lib/ediel/transport', () => ({ sendEdielMessageViaSmtp: port.send }))
vi.mock('@/lib/ediel/transport/acceptedProjection', () => ({ readAcceptedEdielTransportProjection: async () => null }))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: async () => null }))
vi.mock('@/lib/ediel/outbox/routeContract', () => ({ evaluateEdielRouteContract: async () => ({ ok: true, fingerprint: 'fixture-route' }) }))
vi.mock('@/lib/ediel/outbox/projectSentSources', () => ({ projectSentEdielSourceState: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: true }) }))

import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'

beforeEach(() => {
  vi.clearAllMocks()
  port.rows.clear(); port.messages.clear(); port.submitted.length = 0; port.messageReads.length = 0
  port.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'claim_ediel_outbox_items') throw new Error(`Unexpected RPC: ${name}`)
    const rows = [...port.rows.values()].filter(row => (!args.p_company_id || args.p_company_id === row.company_id)
      && (!args.p_environment || args.p_environment === row.environment)).slice(0, Number(args.p_limit))
    // A real claim sets locked_at = now(); the send consumer verifies that lease.
    const claimedAt = new Date().toISOString()
    rows.forEach(row => { row.status = 'sending'; row.locked_by = args.p_worker_id; row.locked_at = claimedAt })
    return { data: rows.map(row => ({ ...row })), error: null }
  })
  port.from.mockImplementation((table: string) => {
    if (!['ediel_outbox', 'ediel_send_locks'].includes(table)) throw new Error(`Unexpected table: ${table}`)
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const result = () => {
      if (table === 'ediel_send_locks') return { data: [], error: null }
      const row = [...port.rows.values()].find(row => filters.every(([field, value]) => row[field] === value))
      if (row && patch) Object.assign(row, patch)
      return { data: row ? { ...row } : null, error: null }
    }
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
      update: (value: Record<string, unknown>) => { patch = value; return query },
      limit: async () => result(), maybeSingle: async () => result(),
    }
    return query
  })
  port.get.mockImplementation(async (id: string, scope: { companyId: string }) => {
    port.messageReads.push([id, scope.companyId])
    // Deliberately permit a foreign row: the real send consumer must refuse it.
    return port.messages.get(id) ?? null
  })
  port.send.mockImplementation(async (message: EdielMessageRow) => {
    port.submitted.push({ company: message.company_id ?? null, raw: message.raw_payload ?? null })
    const observed = '2026-10-04T20:00:00Z'
    port.messages.set(message.id, { ...message, status: 'sent', message_sent_at: observed })
    return { messageId: `<${message.id}@example.test>`, dispatchObservedAt: observed }
  })
})

function enqueue(id: string, company: string, code: string, patch: Partial<EdielMessageRow> = {}) {
  const raw = EdifactEnvelopeCodec.encode({
    sender: '11111', receiver: '22222', interchangeReference: `I-${id}`, applicationReference: '23-DDQ-PRODAT',
    acknowledgementRequest: true, environment: 'test', messages: [{ messageReference: id,
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [`BGM+${code}+DOC-${id}+9+AB`,
        'NAD+FR+11111:160:SVK', 'NAD+DO+22222:160:SVK', `LIN+1++POINT-${id}:::89`] }],
  })
  port.messages.set(id, { id, company_id: company, environment: 'test', direction: 'outbound', status: 'prepared',
    message_family: 'PRODAT', message_code: code, raw_payload: raw, ...patch } as EdielMessageRow)
  port.rows.set(id, { id, company_id: company, environment: 'test', ediel_message_id: id,
    status: 'queued', current_send_attempt_id: `attempt-${id}` })
}

describe('ENV-07 actual queue-message separation', () => {
  it('dispatches incompatible functions and tenants as separate immutable interchanges even with identical wire actors', async () => {
    enqueue('A', 'tenant-A', 'Z03'); enqueue('B', 'tenant-A', 'Z08'); enqueue('C', 'tenant-B', 'Z03')
    const originals = [...port.messages.values()].map(row => row.raw_payload)
    expect(await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })).toMatchObject({ processed: 3, sent: 3, failed: 0 })
    expect(port.submitted).toEqual([
      { company: 'tenant-A', raw: originals[0] }, { company: 'tenant-A', raw: originals[1] }, { company: 'tenant-B', raw: originals[2] },
    ])
    expect(port.messageReads).toEqual([['A', 'tenant-A'], ['A', 'tenant-A'], ['B', 'tenant-A'], ['B', 'tenant-A'], ['C', 'tenant-B'], ['C', 'tenant-B']])
    const wires = port.submitted.map(({ raw }) => tokenizeEdifact(raw))
    expect(wires.map(tokens => tokens.segments.filter(s => s.tag === 'UNB').length)).toEqual([1, 1, 1])
    expect(wires.map(tokens => tokens.segments.filter(s => s.tag === 'UNH').length)).toEqual([1, 1, 1])
    expect(wires.map(tokens => tokens.segments.filter(s => s.tag === 'BGM').map(s => segmentComposite(s, 1, tokens.una)[0]))).toEqual([['Z03'], ['Z08'], ['Z03']])
    expect(wires.map(tokens => segmentComposite(tokens.segments.find(s => s.tag === 'UNZ'), 1, tokens.una)[0])).toEqual(['1', '1', '1'])
    expect([...port.rows.values()].map(row => row.status)).toEqual(['sent', 'sent', 'sent'])
  })

  it.each([
    ['foreign tenant', { company_id: 'tenant-B' }],
    ['foreign environment', { environment: 'production' }],
  ] as const)('refuses %s returned by a row-read port before any final transport submission', async (_label, patch) => {
    enqueue('A', 'tenant-A', 'Z03', patch)
    expect(await processEdielOutbox({ actorUserId: 'worker-actor', companyId: 'tenant-A', environment: 'test' })).toMatchObject({ processed: 1, sent: 0, failed: 1,
      results: [{ id: 'A', status: 'failed', error: 'ediel_outbox_message_scope_mismatch' }] })
    expect(port.submitted).toEqual([])
    expect(port.rows.get('A')).toMatchObject({ status: 'failed', last_error: 'ediel_outbox_message_scope_mismatch' })
  })
})
