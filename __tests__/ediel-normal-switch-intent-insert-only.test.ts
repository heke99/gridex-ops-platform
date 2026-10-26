import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { CreateEdielMessageIntentInput } from '@/lib/ediel/intent/types'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), gateway: vi.fn(), allocate: vi.fn(), rows: [] as Row[], writes: [] as Row[],
  firstWinner: null as Row | null, readMisses: 0, readCount: 0, barrierSize: 0, waiters: [] as Array<() => void>,
  promoteWinner: false, insertError: null as Row | null, loseWinner: false, lifecycleWrites: 0,
  switch: {} as Row, site: {} as Row, point: {} as Row, route: {} as Row,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/masterdata/db', () => ({ getGridOwnerById: async () => null,
  getCustomerSiteById: async () => io.site, getMeteringPointById: async () => io.point }))
vi.mock('@/lib/operations/db', () => ({ getSupplierSwitchRequestById: async () => io.switch, createSupplierSwitchEvent: vi.fn() }))
vi.mock('@/lib/ediel/prodat', () => ({ allocateProdatSwitchWireReferences: io.allocate }))
vi.mock('@/lib/ediel/flows/prodatSwitchCancellation', () => ({ prepareAndQueueSwitchCancellation: vi.fn() }))
vi.mock('@/lib/ediel/intent/switchRenderGateway', () => ({ renderAndQueueNormalSwitch: io.gateway }))
vi.mock('@/lib/ediel/db', () => ({ linkEdielMessage: vi.fn() }))
vi.mock('@/lib/legal/authorizationChain', () => ({ resolveAuthorizationDocumentIdForPowerOfAttorney: vi.fn() }))
vi.mock('@/lib/ediel/core/productionGuards', () => ({ isEdielPortalParty: () => false }))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({ resolveDecisionBackedOutboundContext: async () => io.route }))
vi.mock('@/lib/ediel/production/bilateralProdatSwitchPreparation', () => ({ qualifyBilateralProdatSwitchPreparation: vi.fn() }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: async () => ({
  originalVersion: '26.A', fieldMatrixVersion: '26.A', rulePackId: 'pack', messageProfileId: 'profile', profileKey: 'key',
}) }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (actor: string) => actor,
  makeServerClient: async () => ({}), findOrCreateSwitchOutbound: async () => ({ id: 'outbound' }) }))

import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const copy = <T>(value: T): T => structuredClone(value)
function input(wire = 'A'): CreateEdielMessageIntentInput & { normalSwitchInsertOnly: true } {
  return { normalSwitchInsertOnly: true, actorUserId: uid(9), companyId: uid(1), environment: 'test', market: 'electricity',
    messageFamily: 'PRODAT', messageCode: 'Z03', businessProcess: 'supplier_switch', direction: 'outbound',
    senderEdielId: '12345', receiverEdielId: '54321', applicationReference: '23-DDQ-PRODAT',
    routeProfileId: uid(10), communicationRouteId: uid(11), customerId: uid(2), customerSiteId: uid(3),
    supplierSwitchRequestId: uid(4), operationId: uid(4), facilityId: '735123456789012345', meteringPointId: '735123456789012345',
    gridAreaCode: 'TES', requestedEffectiveDate: '2027-02-01', interchangeReference: `UNB-${wire}`,
    messageReference: `UNH-${wire}`, transactionReference: `LI-${wire}`, idempotencyKey: 'same-source-operation',
    expectedRuleVersion: '26.A', expectedFieldMatrixVersion: '26.A', payload: { edielCode: 'Z03', transactionSubtype: 'L',
      actorRole: 'supplier', documentReference: `BGM-${wire}`, reasonForTransaction: 'Z22', authorization_document_id: uid(12) } }
}

// Finite SDK port models the existing unique company/environment/key tuple.
// Two real engine calls both miss before either insert; the losing upsert can
// overwrite only if the real caller fails to request ON CONFLICT DO NOTHING.
// This is not a PostgreSQL locking/native/provider execution.
function query() {
  const filters: Array<[string, unknown]> = []
  let write: Row | undefined, options: Row = {}, update: Row | undefined
  const selected = () => io.rows.find(row => filters.every(([key, value]) => row[key] === value))
  async function execute() {
    if (write) {
      const inserted = write
      io.writes.push(copy(options))
      if (io.insertError) return { data: null, error: io.insertError }
      const existing = io.rows.find(row => row.company_id === inserted.company_id && row.environment === inserted.environment
        && row.idempotency_key === inserted.idempotency_key)
      if (existing && options.ignoreDuplicates === true) {
        if (io.loseWinner) io.rows = []
        return { data: null, error: null }
      }
      const row = { ...copy(write), id: existing?.id ?? uid(90) }
      if (existing) Object.assign(existing, row)
      else io.rows.push(row)
      const returned = copy(row)
      if (!io.firstWinner) {
        io.firstWinner = copy(row)
        if (io.promoteWinner) Object.assign(row, { ediel_message_id: uid(91), outbound_request_id: uid(92), render_status: 'rendered', outbox_status: 'sent' })
      }
      return { data: returned, error: null }
    }
    if (update) { io.lifecycleWrites++; const row = selected(); if (row) Object.assign(row, update); return { data: row ?? null, error: null } }
    io.readCount++
    if (io.readCount <= io.readMisses) {
      if (io.barrierSize) await new Promise<void>(resolve => {
        io.waiters.push(resolve)
        if (io.waiters.length === io.barrierSize) io.waiters.forEach(release => release())
      })
      return { data: null, error: null }
    }
    return { data: copy(selected() ?? null), error: null }
  }
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    upsert: (row: Row, opts: Row) => { write = row; options = opts; return q }, update: (row: Row) => { update = row; return q },
    maybeSingle: execute, single: execute }
  return q
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No provider calls in this finite SDK test') }))
  vi.clearAllMocks(); io.rows = []; io.writes = []; io.firstWinner = null; io.readMisses = 0; io.readCount = 0
  io.barrierSize = 0; io.waiters = []; io.promoteWinner = false; io.insertError = null; io.loseWinner = false; io.lifecycleWrites = 0
  io.from.mockImplementation((table: string) => { expect(table).toBe('ediel_message_intents'); return query() })
  io.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  io.site = { id: uid(3), company_id: uid(1), normalized_facility_id: '735123456789012345', grid_area_code: 'TES' }
  io.point = { id: uid(5), company_id: uid(1), meter_point_id: '735123456789012345' }
  io.switch = { id: uid(4), company_id: uid(1), customer_id: uid(2), site_id: uid(3), metering_point_id: uid(5),
    customer_contract_id: uid(6), authorization_document_id: uid(12), requested_start_date: '2027-02-01', request_type: 'switch', prodat_variant: 'L' }
  io.route = { environment: 'test', senderEdielId: '12345', receiverEdielId: '54321', applicationReference: '23-DDQ-PRODAT',
    route: { id: uid(11) }, routeDecision: { edielRouteProfileId: uid(10) } }
  let allocated = 0
  io.allocate.mockImplementation(() => { allocated++; return { interchangeReference: `UNB-${allocated}`, messageReference: `UNH-${allocated}`,
    transactionReference: `LI-${allocated}`, documentReference: `BGM-${allocated}` } })
  io.gateway.mockResolvedValue({message:{id:uid(91),company_id:uid(1),status:'queued'},queuedFromDraft:false})
})
afterEach(() => vi.unstubAllGlobals())

async function persisted() {
  await createEdielMessageIntent(input())
  io.writes = []; io.lifecycleWrites = 0
}

describe('normal switch insert-only intent source', () => {
  it.each([['L', 'Z22'], ['LK', 'Z23'], ['H', 'Z25']])
  ('preserves the concurrent %s winner and its advanced lifecycle after two initial read misses', async (variant, reason) => {
    io.readMisses = 2; io.barrierSize = 2; io.promoteWinner = true
    const candidate = (wire: string) => { const value = input(wire); value.payload = { ...value.payload, transactionSubtype: variant, reasonForTransaction: reason }; return value }
    const results = await Promise.all([createEdielMessageIntent(candidate('A')), createEdielMessageIntent(candidate('B'))])
    expect(io.rows).toHaveLength(1)
    const winner = io.firstWinner!
    expect(io.rows[0]).toMatchObject({ interchange_reference: winner.interchange_reference, message_reference: winner.message_reference,
      transaction_reference: winner.transaction_reference, payload: winner.payload, ediel_message_id: uid(91), outbound_request_id: uid(92),
      render_status: 'rendered', outbox_status: 'sent' })
    expect(results.map(result => result.interchangeReference)).toEqual([winner.interchange_reference, winner.interchange_reference])
    expect(results.map(result => result.id)).toEqual([uid(90), uid(90)])
    expect(io.lifecycleWrites).toBe(0)
  })

  it('selects insert-only semantics from the real normal-switch producer, not just a direct engine caller', async () => {
    io.readMisses = 2; io.barrierSize = 2; io.promoteWinner = true
    const messages=await Promise.all([prepareAndQueueEdielZ03({ actorUserId: uid(9), switchRequestId: uid(4) }),
      prepareAndQueueEdielZ03({ actorUserId: uid(9), switchRequestId: uid(4) })])
    expect(messages).toEqual([{id:uid(91),company_id:uid(1),status:'queued'},{id:uid(91),company_id:uid(1),status:'queued'}])
    expect(io.rows).toHaveLength(1)
    expect(io.rows[0]).toMatchObject({ interchange_reference: io.firstWinner!.interchange_reference,
      payload: io.firstWinner!.payload, ediel_message_id: uid(91), outbox_status: 'sent' })
    expect(io.gateway.mock.calls.map(([arg]) => arg.intentId)).toEqual([uid(90), uid(90)])
  })

  it('reuses a stored original despite newly allocated candidate wire references', async () => {
    await persisted(); Object.assign(io.rows[0], { ediel_message_id: uid(91), render_status: 'rendered', outbox_status: 'sent' })
    const before = copy(io.rows[0]), result = await createEdielMessageIntent(input('B'))
    expect(result).toMatchObject({ interchangeReference: 'UNB-A', messageReference: 'UNH-A', transactionReference: 'LI-A', outboxStatus: 'sent' })
    expect(result.payload.documentReference).toBe('BGM-A'); expect(io.rows[0]).toEqual(before)
    expect(io.writes).toEqual([]); expect(io.lifecycleWrites).toBe(0)
  })

  it('uses the installed SDK ignore-conflict request and empty-result reread without any network', async () => {
    await persisted()
    const winner = { ...copy(io.rows[0]), ediel_message_id: uid(91), outbox_status: 'sent', render_status: 'rendered' }
    const methods: string[] = []
    const client = createClient('https://owned-unit.invalid', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url, init) => {
        const request = new Request(url, init), target = new URL(request.url)
        expect(target.origin).toBe('https://owned-unit.invalid'); methods.push(request.method)
        if (request.method === 'POST') {
          expect(request.headers.get('prefer')).toContain('resolution=ignore-duplicates')
          expect(target.searchParams.get('on_conflict')).toBe('company_id,environment,idempotency_key')
        } else {
          expect(target.searchParams.get('company_id')).toBe(`eq.${uid(1)}`)
          expect(target.searchParams.get('environment')).toBe('eq.test')
          expect(target.searchParams.get('idempotency_key')).toBe('eq.same-source-operation')
        }
        return new Response(JSON.stringify(methods.length === 3 ? [winner] : []), { headers: { 'Content-Type': 'application/json' } })
      } },
    })
    io.from.mockImplementation((table: string) => client.from(table))
    const result = await createEdielMessageIntent(input('B'))
    expect(methods).toEqual(['GET', 'POST', 'GET'])
    expect(result).toMatchObject({ id: uid(90), interchangeReference: 'UNB-A', outboxStatus: 'sent', edielMessageId: uid(91) })
    expect(result.payload.documentReference).toBe('BGM-A')
    expect(io.lifecycleWrites).toBe(0)
  })

  it.each(['customer_id', 'customer_site_id', 'supplier_switch_request_id', 'operation_id', 'facility_id',
    'metering_point_id', 'requested_effective_date', 'communication_route_id', 'expected_rule_version', 'sender_ediel_id', 'receiver_ediel_id'])
  ('holds an existing same-key intent with changed %s before any mutation', async field => {
    await persisted(); io.rows[0][field] = 'different-source'; const before = copy(io.rows[0])
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_source_conflict')
    expect(io.rows[0]).toEqual(before); expect(io.writes).toEqual([]); expect(io.lifecycleWrites).toBe(0)
  })

  it.each(['transactionSubtype', 'authorization_document_id', 'reasonForTransaction'])
  ('holds a changed source payload field %s without overwriting the winner', async field => {
    await persisted(); (io.rows[0].payload as Row)[field] = 'different-source'; const before = copy(io.rows[0])
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_source_conflict')
    expect(io.rows[0]).toEqual(before); expect(io.writes).toEqual([])
  })

  it('also checks a conflicting winner discovered only after losing the insert race', async () => {
    await persisted(); io.rows[0].customer_site_id = uid(88); io.readMisses = io.readCount + 1
    const before = copy(io.rows[0])
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_source_conflict')
    expect(io.rows[0]).toEqual(before)
  })

  it('does not report success when an ignored insert cannot reread its winner', async () => {
    await persisted(); io.readMisses = io.readCount + 1; io.loseWinner = true
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_winner_missing')
  })

  it('keeps identical keys isolated by company and environment', async () => {
    await persisted()
    await createEdielMessageIntent({ ...input('B'), companyId: uid(30) })
    await createEdielMessageIntent({ ...input('C'), environment: 'production' })
    expect(io.rows).toHaveLength(3)
    expect(io.rows.map(row => [row.company_id, row.environment, row.interchange_reference])).toEqual([
      [uid(1), 'test', 'UNB-A'], [uid(30), 'test', 'UNB-B'], [uid(1), 'production', 'UNB-C'],
    ])
  })

  it('propagates a failed insert without blind mutation retry or false success', async () => {
    io.insertError = { code: '40001', message: 'synthetic SDK boundary failure' }
    await expect(createEdielMessageIntent(input())).rejects.toEqual(io.insertError)
    expect(io.rows).toEqual([]); expect(io.writes).toHaveLength(1)
  })

  it('does not permit another producer to opt into the normal-switch path', async () => {
    await expect(createEdielMessageIntent({ ...input(), messageCode: 'Z02', businessProcess: 'facility_lookup' }))
      .rejects.toThrow('normal_switch_intent_source_required')
    expect(io.from).not.toHaveBeenCalled()
  })

  it('keeps cancellation on its separate original/source owner', async () => {
    const cancellation = input(); cancellation.payload = { ...cancellation.payload, transactionSubtype: 'C', reasonForTransaction: 'Z24' }
    await expect(createEdielMessageIntent(cancellation)).rejects.toThrow('normal_switch_intent_source_required')
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each(['interchange_reference', 'message_reference', 'transaction_reference'])
  ('holds a stored winner missing its original %s', async field => {
    await persisted(); io.rows[0][field] = null
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_winner_invalid')
    expect(io.writes).toEqual([])
  })

  it('holds a stored winner without its original document reference', async () => {
    await persisted(); delete (io.rows[0].payload as Row).documentReference
    await expect(createEdielMessageIntent(input('B'))).rejects.toThrow('normal_switch_intent_winner_invalid')
    expect(io.writes).toEqual([])
  })

  it('does not persist a normal intent without an exact source customer/site/switch binding', async () => {
    await expect(createEdielMessageIntent({ ...input(), customerSiteId: null })).rejects.toThrow('normal_switch_intent_source_required')
    await expect(createEdielMessageIntent({ ...input(), operationId: uid(80) })).rejects.toThrow('normal_switch_intent_source_required')
    expect(io.from).not.toHaveBeenCalled()
  })

  it('preserves the existing default API for producers that did not opt in', async () => {
    const other: CreateEdielMessageIntentInput & { normalSwitchInsertOnly?: true } = { ...input() }
    delete other.normalSwitchInsertOnly
    await createEdielMessageIntent(other)
    expect(io.writes).toEqual([{ onConflict: 'company_id,environment,idempotency_key' }])
    expect(io.rows).toHaveLength(1)
  })
})
