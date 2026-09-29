import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { createUtiltsRuntimeAcks } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({ tables: new Map<string, Row[]>(), failErrReference: null as string | null,
  raceErrReference: null as string | null, raceCommitted: false }))
vi.mock('@/lib/supabase/service', () => {
  const value = (row: Row, key: string) => {
    const [base, member] = key.split('->>')
    return member ? (row[base] as Row | undefined)?.[member] : row[base]
  }
  class Query {
    private filters: ((row: Row) => boolean)[] = []
    private mode: 'read' | 'insert' | 'update' = 'read'
    private payload: Row | Row[] = {}
    private cap = Infinity
    private one = false
    constructor(private table: string) {}
    select() { return this }
    eq(key: string, expected: unknown) { this.filters.push(row => value(row, key) === expected); return this }
    is(key: string, expected: unknown) { this.filters.push(row => (value(row, key) ?? null) === expected); return this }
    in(key: string, expected: unknown[]) { this.filters.push(row => expected.includes(value(row, key))); return this }
    not(key: string, operation: string, expected: string) {
      if (operation !== 'in') throw Error(`unexpected_filter:${operation}`)
      const excluded = expected.replace(/^\(|\)$/g, '').split(',')
      this.filters.push(row => !excluded.includes(String(value(row, key))))
      return this
    }
    order() { return this }
    limit(cap: number) { this.cap = cap; return this }
    abortSignal() { return this }
    insert(payload: Row | Row[]) { this.mode = 'insert'; this.payload = payload; return this }
    update(payload: Row) { this.mode = 'update'; this.payload = payload; return this }
    upsert(payload: Row | Row[]) { return this.insert(payload) }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const rows = database.tables.get(this.table)
        if (!rows) throw Error(`unexpected_table:${this.table}`)
        let data: Row[]
        if (this.mode === 'insert') {
          const payloads = Array.isArray(this.payload) ? this.payload : [this.payload]
          if (this.table === 'ediel_messages' && payloads.some(row =>
            row.message_family === 'UTILTS_ERR' && database.failErrReference !== null &&
            (row.parsed_payload as Row)?.relatedTransactionReference === database.failErrReference)) {
            throw Error('synthetic_interruption_after_first_err')
          }
          data = payloads.map(row => ({ id: randomUUID(), created_at: new Date().toISOString(), ...row }))
          if (this.table === 'ediel_messages' && payloads.some(row => row.message_family === 'UTILTS_ERR' &&
            database.raceErrReference !== null && (row.parsed_payload as Row)?.relatedTransactionReference === database.raceErrReference)) {
            if (database.raceCommitted) rows.push(...data)
            return { data: null, error: { code: '23505', message: 'synthetic_unique_ack_insert' }, count: 0 }
          }
          rows.push(...data)
        } else {
          data = rows.filter(row => this.filters.every(filter => filter(row))).slice(0, this.cap)
          if (this.mode === 'update') data.forEach(row => Object.assign(row, this.payload))
        }
        return { data: this.one ? data[0] ?? null : data, error: null, count: data.length }
      }).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: () => { throw Error('unexpected_rpc') } } }
})

beforeEach(() => {
  database.tables.clear()
  database.failErrReference = null
  database.raceErrReference = null
  database.raceCommitted = false
  vi.stubGlobal('fetch', () => { throw Error('external_network_forbidden') })
})
afterEach(() => vi.unstubAllGlobals())

function seed(transactions: Parameters<typeof utiltsErrGatewayFixture>[0]['transactions'], date: '2026-09-30' | '2026-10-01' = '2026-10-01') {
  const company = randomUUID(), actor = randomUUID(), route = randomUUID(), profile = randomUUID()
  const source = {
    ...utiltsErrGatewayFixture({ company, transactions, date }), id: randomUUID(),
    canonical_rule_pack_id: randomUUID(), rule_profile_key: 'synthetic-utilts-e66',
    rule_profile_version_id: randomUUID(), rule_profile_version: 'E5SE5A-r3', rule_pack_checksum: 'a'.repeat(64),
  } as EdielMessageRow
  const runtime = runUtiltsRuntimeForMessage(source)
  const reservations: Row[] = runtime.transactionDispositions.map(row => ({
    id: randomUUID(), company_id: company, environment: 'test', source_message_id: source.id,
    source_transaction_id: row.transactionId, planned_response_type: row.responseType, finalized_at: null,
  }))
  for (const [table, rows] of Object.entries({
    ediel_messages: [source], ediel_message_events: [], ediel_ack_transaction_results: reservations,
    ediel_actor_settings: [{ id: actor, company_id: company, environment: 'test', is_active: true, ediel_id: '21660', sender_subaddress: 'DDQ' }],
    tenant_ediel_profiles: [{ id: randomUUID(), company_id: company, environment: 'test', market: 'electricity', is_enabled: true }],
    tenant_actor_identifiers: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, identifier_type: 'EdielId', identifier_value: '21660' }],
    tenant_actor_roles: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, role_code: 'DDQ' }],
    tenant_counterparty_relations: [],
    communication_routes: [{ id: route, company_id: company, route_name: 'Synthetic local route', is_active: true, route_scope: 'ediel_ack', environment_type: 'bilateral_test', grid_owner_id: null, target_system: 'synthetic-local-only' }],
    ediel_route_runtime_v: [{ communication_route_id: route, company_id: company, route_profile_id: profile, environment: 'test' }],
  })) database.tables.set(table, rows as Row[])
  const finalize = () => createUtiltsRuntimeAcks({ actorUserId: actor, sourceMessage: source,
    ackPlan: runtime.ackPlan, transactionDispositions: runtime.transactionDispositions })
  const acks = () => database.tables.get('ediel_messages')!.filter(row => row.direction === 'outbound')
  return { source, runtime, actor, finalize, acks, reservations }
}

it.each([
  ['2026-09-30', 'E19'], ['2026-10-01', 'E87'],
] as const)('real %s functional rejection reaches the canonical ERR gateway and finalizes its own IDE', async (date, code) => {
  const reference = 'ERR-OWN-IDE-1'
  const f = seed([{ reference, outcome: 'processability_rejected' }], date)
  expect(f.runtime.transactionDispositions.map(row => row.disposition)).toEqual(['processability_rejected'])
  expect(f.runtime.ackPlan.utiltsErrDetails.map(row => row.code)).toEqual([code])
  await f.finalize()
  const errs = f.acks().filter(row => row.message_family === 'UTILTS_ERR')
  expect(errs).toHaveLength(1)
  expect(errs[0].process_type).toBe('functional_rejection')
  expect(errs[0].raw_payload).toContain(`RFF+TN:${reference}'`)
  expect(f.reservations[0]).toMatchObject({ final_response_type: 'utilts_err', response_message_id: errs[0].id })
  const before = structuredClone({ errs, reservation: f.reservations[0] })
  await f.finalize()
  expect({ errs: f.acks().filter(row => row.message_family === 'UTILTS_ERR'), reservation: f.reservations[0] }).toEqual(before)
})

it('canonically qualified same-code ERR drafts keep full IDE identity and immutable retry', async () => {
  const references = ['ERR-SHARED-PREFIX-LONG-IDE-A', 'ERR-SHARED-PREFIX-LONG-IDE-B']
  const f = seed(references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS_ERR', messageCode: 'ERR', direction: 'outbound',
    referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', mode: 'catalog_evidence' })
  const create = async (reference: string, code = 'E87') => {
    const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: code, relatedTransactionReference: reference })
    // Isolate duplicate identity while retaining real policy qualification.
    // The ordinary finalizer tests above separately require the builder fix.
    draft.processType = policy.processGroup
    return createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
  }
  const first = await create(references[0]), second = await create(references[1])
  expect(second.id).not.toBe(first.id)
  expect([first, second].map(row => row.parsed_payload?.relatedTransactionReference)).toEqual(references)
  for (const [index, row] of [first, second].entries()) {
    expect(row.source_operation_id).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:${references[index]}`)
    expect(row.raw_payload).toContain(`RFF+TN:${references[index]}'`)
  }
  expect(await create(references[0], 'E10')).toEqual(first)
  expect(await create(references[1])).toEqual(second)
  expect(f.acks()).toHaveLength(2)
})

it('real mixed accepted, guide-negative and two same-code functional-negative IDEs finalize separately after interruption', async () => {
  const transactions = [
    { reference: 'ACK-OK', outcome: 'accepted' as const },
    { reference: 'ACK-GUIDE', outcome: 'guide_rejected' as const },
    { reference: 'ACK-ERR-A', outcome: 'processability_rejected' as const },
    { reference: 'ACK-ERR-B', outcome: 'processability_rejected' as const },
  ]
  const f = seed(transactions)
  expect(f.runtime.transactionDispositions.map(row => row.disposition)).toEqual(transactions.map(row => row.outcome))
  database.failErrReference = 'ACK-ERR-B'
  await expect(f.finalize()).rejects.toThrow('synthetic_interruption_after_first_err')
  expect(f.reservations.map(row => row.final_response_type ?? null)).toEqual(['positive_aperak', 'negative_aperak', 'utilts_err', null])
  const firstErr = structuredClone(f.acks().find(row => row.message_family === 'UTILTS_ERR'))
  database.failErrReference = null
  await f.finalize()
  expect(f.reservations.map(row => row.final_response_type)).toEqual(['positive_aperak', 'negative_aperak', 'utilts_err', 'utilts_err'])
  expect(f.acks().filter(row => row.message_family === 'UTILTS_ERR')).toHaveLength(2)
  expect(f.acks().find(row => row.id === firstErr?.id)).toEqual(firstErr)
  const before = structuredClone({ acks: f.acks(), reservations: f.reservations })
  await f.finalize()
  expect({ acks: f.acks(), reservations: f.reservations }).toEqual(before)
})

it('legacy message-scoped ERRs retain code sequencing and identical retry', async () => {
  const f = seed([{ reference: 'LEGACY-ERR-IDE', outcome: 'processability_rejected' }])
  const create = async (code: string) => {
    const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: code })
    const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS_ERR', messageCode: 'ERR', direction: 'outbound',
      referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', mode: 'catalog_evidence' })
    draft.processType = policy.processGroup
    return createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
  }
  const first = await create('E87'), second = await create('E10')
  expect(second.id).not.toBe(first.id)
  expect(first.source_operation_id).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:E87`)
  expect(second.source_operation_id).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:E10`)
  expect(await create('E87')).toEqual(first)
  expect(await create('E10')).toEqual(second)
  expect(f.acks()).toHaveLength(2)
})

it.each([true, false])('a unique insert failure recovers only the same IDE ERR when committed=%s', async committed => {
  const references = ['UNIQUE-ERR-IDE-A', 'UNIQUE-ERR-IDE-B']
  const f = seed(references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const create = (reference: string) => createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source,
    ackFamily: 'UTILTS_ERR', outcome: 'negative', draft: buildUtiltsErrDraft({ actorUserId: f.actor,
      sourceMessage: f.source, messageText: 'E87', relatedTransactionReference: reference }) })
  const first = await create(references[0])
  database.raceErrReference = references[1]
  database.raceCommitted = committed
  if (committed) {
    const own = await create(references[1])
    expect(own.id).not.toBe(first.id)
    expect(own.parsed_payload?.relatedTransactionReference).toBe(references[1])
    expect(own.raw_payload).toContain(`RFF+TN:${references[1]}'`)
    expect(f.acks()).toHaveLength(2)
  } else {
    await expect(create(references[1])).rejects.toMatchObject({ code: '23505' })
    expect(f.acks()).toEqual([first])
  }
})
