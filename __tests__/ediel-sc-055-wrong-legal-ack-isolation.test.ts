// masterplan: SC-055
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
type Probe = { db: PGlite; company: string; actor: string; original: string; count: number }
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, candidate: null as EdielMessageRow | null,
  calls: [] as Array<{ name: string; args: Row }>, writes: [] as Array<{ table: string; value: Row }>,
  apply: null as null | ((args: Row) => Promise<unknown>),
}))

// Finite external DB transport only. The current caller, physical qualifier,
// status/event writer and customer-case consumer remain real. The positive
// receipt port executes the unchanged historical atomic SQL harness; later
// current wrappers/source-admission authority are explicitly outside this proof.
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []; one = false; maximum = Infinity
    operation = 'read'; value: Row = {}
    constructor(readonly table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    limit(value: number) { this.maximum = value; return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    insert(value: Row) { this.operation = 'insert'; this.value = value; return this }
    then(done: (result: unknown) => unknown, failed: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const table = port.tables[this.table]
        if (!table) throw Error(`Undeclared SC055 table ${this.table}`)
        let selected = table.filter(row => this.filters.every(filter => filter(row))).slice(0, this.maximum)
        if (this.operation !== 'read') {
          if (!['ediel_messages', 'ediel_message_events', 'customer_cases', 'customer_case_events', 'audit_logs'].includes(this.table)) throw Error(`Undeclared SC055 write ${this.table}`)
          port.writes.push({ table: this.table, value: structuredClone(this.value) })
          if (this.operation === 'insert') { const row = { id: `event-${port.writes.length}`, ...structuredClone(this.value) }; table.push(row); selected = [row] }
          else selected.forEach(row => Object.assign(row, structuredClone(this.value)))
        }
        if (this.one && selected.length > 1) throw Error('SC055 single-row port ambiguous')
        return { data: structuredClone(this.one ? selected[0] ?? null : selected), error: null }
      }).then(done, failed)
    }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Row) => {
      port.calls.push({ name, args: structuredClone(args) })
      const incoming = port.tables.ediel_messages.find(row => row.id === args.p_ack_message_id)!
      expect(args.p_company_id).toBe(incoming.company_id)
      expect(args.p_environment).toBe(incoming.environment)
      if (name === 'gridex_read_committed_inbound_ack_v2') {
        expect(args.p_actor_user_id).toBe(ACTOR)
        expect(args.p_ack_payload_hash).toBe(sha(String(incoming.raw_payload)))
        return { data: null, error: null } // Declared fresh protected source, no old receipt.
      }
      if (name === 'gridex_read_inbound_ack_source_v1') {
        // Protected original admission is finite. No match/verdict is supplied;
        // the actual physical TS qualifier must independently accept or refuse.
        return { data: port.candidate ? { version: 1, sourceMessage: structuredClone(port.candidate) } : null, error: null }
      }
      if (name === 'gridex_apply_inbound_ack_source_v1' && port.apply) return { data: await port.apply(args), error: null }
      throw Error(`Unexpected SC055 RPC ${name}`)
    },
  } }
})

import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'

const COMPANY = '11111111-1111-1111-1111-111111111111'
const FOREIGN = '99999999-9999-4999-8999-999999999999'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = '12345678-1111-4111-8111-111111111111'
const FOREIGN_SOURCE = '12345678-2222-4222-8222-222222222222'
const ACK = '12345678-3333-4333-8333-333333333333'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function wire(family: string, body: string[], reverse = false) {
  return EdifactEnvelopeCodec.encode({
    sender: reverse ? '99111' : '21660', receiver: reverse ? '21660' : '99111',
    senderSubAddress: reverse ? 'R' : 'S', receiverSubAddress: reverse ? 'S' : 'R',
    environment: 'test', applicationReference: '23-DDQ-E66-T', acknowledgementRequest: false,
    interchangeReference: reverse ? 'SC055-ACK-I' : 'SC055-SOURCE-I',
    messages: [{ messageReference: '1', messageTypeToken: family, businessSegments: body }],
  })
}
function sourceRaw(document = 'SC055-SOURCE-D', sender = '12345', receiver = '54321') {
  return wire('UTILTS:D:02B:UN:E5SE5A', [`BGM+E66::260+${document}+9+AB`, `NAD+MS+${sender}:SVK:260`, `NAD+MR+${receiver}:SVK:260`, 'IDE+24+SC055-FIRST', 'IDE+24+SC055-SECOND'])
}
function ackRaw(document = 'SC055-SOURCE-D', sender = '54321', receiver = '12345') {
  return wire('APERAK:D:04A:UN:E5SE5A', ['BGM+312+SC055-ACK-D+9', `DOC+E66:SVK:260+${document}`, `NAD+MS+${sender}:SVK:260`, `NAD+MR+${receiver}:SVK:260`, 'ERC+100::260', 'FTX+AAO+++OK', 'RFF+DM:SC055-ACK-T', 'RFF+ACW:SC055-FIRST', 'RFF+ACW:SC055-SECOND'], true)
}
function message(id: string, company: string, direction: 'inbound' | 'outbound', raw: string): EdielMessageRow {
  return {
    id, company_id: company, direction, environment: 'test', message_standard: 'edifact',
    message_family: direction === 'inbound' ? 'APERAK' : 'UTILTS', message_code: direction === 'inbound' ? '312' : 'E66',
    status: direction === 'inbound' ? 'received' : 'sent', raw_payload: raw,
    parsed_payload: {}, validation_report: {}, outbound_request_id: null, switch_request_id: null,
    grid_owner_data_request_id: null, partner_export_id: null, related_message_id: null,
    customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null, communication_route_id: null,
    external_reference: null, transaction_reference: null, correlation_reference: null, original_message_id: null,
    original_transaction_id: null, original_message_code: null, interchange_reference: null,
    message_sent_at: direction === 'outbound' ? '2026-09-30T11:00:00Z' : null,
    message_received_at: direction === 'inbound' ? '2026-09-30T12:00:00Z' : null,
    requires_contrl: false, requires_aperak: true, contrl_status: 'not_required', aperak_status: 'pending',
    utilts_err_status: 'not_required', failure_reason: null, acknowledged_at: null, failed_at: null,
  } as EdielMessageRow
}

const originalScript = resolve('scripts/ediel-ack-source-sql-regression.mjs')
const originalBytes = readFileSync(originalScript, 'utf8')
const originalHash = sha(originalBytes)
const captureKey = Symbol.for('gridex.sc055.ackSqlProbe')
const globals = globalThis as typeof globalThis & { [captureKey]?: (probe: Probe) => Promise<void> }
let runner: Promise<unknown> | undefined
let release: (() => void) | undefined

async function captureExistingSqlRunner(): Promise<Probe> {
  const urlAnchor = 'import.meta.url'
  const finalAnchor = 'console.log(`Focused PostgreSQL ACK compile/source/atomic/immutable/ACL checks: ${count} PASS`)\n}finally{await db.close()}'
  expect(originalBytes.split(urlAnchor)).toHaveLength(2)
  expect(originalBytes.split(finalAnchor)).toHaveLength(2)
  const originalUrl = JSON.stringify(pathToFileURL(originalScript).href)
  const capture = "\nawait globalThis[Symbol.for('gridex.sc055.ackSqlProbe')]({db,company,actor,original,count})"
  const transformed = originalBytes.replace(urlAnchor, originalUrl).replace(finalAnchor, finalAnchor.replace('\n}finally', `${capture}\n}finally`))
  expect(transformed.replace(capture, '').replace(originalUrl, urlAnchor)).toBe(originalBytes)
  let arrived!: (probe: Probe) => void
  const ready = new Promise<Probe>(done => { arrived = done })
  const held = new Promise<void>(done => { release = done })
  globals[captureKey] = async probe => { arrived(probe); await held }
  vi.stubEnv('EDIEL_PGLITE_MODULE', resolve('node_modules/@electric-sql/pglite/dist/index.js'))
  const scriptUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`
  runner = import(/* @vite-ignore */ scriptUrl)
  return Promise.race([ready, runner.then(() => { throw Error('SC055 original runner finished without capture') })])
}

afterAll(async () => {
  release?.()
  try { await runner } finally {
    delete globals[captureKey]
    vi.unstubAllEnvs()
    expect(sha(readFileSync(originalScript, 'utf8'))).toBe(originalHash)
  }
})

beforeEach(() => {
  const ownSource = message(SOURCE, COMPANY, 'outbound', sourceRaw())
  const foreignSource = message(FOREIGN_SOURCE, FOREIGN, 'outbound', sourceRaw('SC055-SOURCE-D-SIMILAR', '55555', '66666'))
  port.tables = {
    ediel_messages: [ownSource as unknown as Row, foreignSource as unknown as Row, message(ACK, COMPANY, 'inbound', ackRaw()) as unknown as Row],
    // Declared already-bound case inputs exercise the actual downstream table
    // consumer only. The E66 original is not a source-qualified Z08 cancellation;
    // this fixture establishes no cancellation/supply/business source authority.
    customer_cases: [
      { id: 'own-case', company_id: COMPANY, customer_id: 'own-customer', cancellation_ediel_message_id: SOURCE, status: 'awaiting_external_response', cancellation_status: 'sent', billing_blocked: true, metadata: { preserved: 'own-case-history' } },
      { id: 'foreign-case', company_id: FOREIGN, customer_id: 'foreign-customer', cancellation_ediel_message_id: FOREIGN_SOURCE, status: 'awaiting_external_response', cancellation_status: 'sent', billing_blocked: true, metadata: { preserved: 'foreign-case-history' } },
    ],
    metering_permissions: [{ id: 'own-permission', company_id: COMPANY, status: 'active', source_message_id: SOURCE }, { id: 'foreign-permission', company_id: FOREIGN, status: 'active', source_message_id: FOREIGN_SOURCE }],
    permission_sites: [{ id: 'own-site', company_id: COMPANY, permission_id: 'own-permission' }, { id: 'foreign-site', company_id: FOREIGN, permission_id: 'foreign-permission' }],
    outbound_requests: [{ id: 'own-request', company_id: COMPANY, status: 'sent' }, { id: 'foreign-request', company_id: FOREIGN, status: 'sent' }],
    customer_supply_periods: [{ id: 'foreign-supply', company_id: FOREIGN, status: 'active' }],
    ediel_message_events: [], customer_case_events: [], audit_logs: [],
  }
  port.candidate = structuredClone(ownSource)
  port.calls = []; port.writes = []; port.apply = null
})

function incoming() { return port.tables.ediel_messages.find(row => row.id === ACK)! as unknown as EdielMessageRow }
function protectedSnapshot() {
  return structuredClone({
    sources: port.tables.ediel_messages.filter(row => row.id !== ACK), cases: port.tables.customer_cases,
    permissions: port.tables.metering_permissions, sites: port.tables.permission_sites,
    requests: port.tables.outbound_requests, supply: port.tables.customer_supply_periods,
    caseEvents: port.tables.customer_case_events, audit: port.tables.audit_logs,
  })
}

async function assertSafeRefusal() {
  const before = protectedSnapshot(), raw = incoming().raw_payload
  const result = await processInboundAckMessage({ actorUserId: ACTOR, message: incoming() })
  expect(result).toMatchObject({ sourceMessage: null, outcome: 'positive', finalAckReached: false, sourceAccepted: false, wholeSourceRejected: false, outboundRequestId: null, switchRequestId: null, gridOwnerDataRequestId: null })
  expect(protectedSnapshot()).toEqual(before)
  expect(incoming()).toMatchObject({ raw_payload: raw, company_id: COMPANY, related_message_id: null, status: 'validated', validation_report: { unmatchedInboundAck: true, ackOutcome: 'positive' } })
  expect(port.calls.map(call => call.name)).toEqual(['gridex_read_committed_inbound_ack_v2', 'gridex_read_inbound_ack_source_v1'])
  expect(port.writes.every(write => ['ediel_messages', 'ediel_message_events'].includes(write.table))).toBe(true)
  const warnings = port.tables.ediel_message_events.filter(row => row.event_status === 'warning')
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toMatchObject({ company_id: COMPANY, ediel_message_id: ACK, event_type: 'manual_note', created_by: ACTOR, payload: { ackFamily: 'APERAK', ackOutcome: 'positive' } })
  expect(warnings[0].message).toContain('Kräver manuell kontroll')
  expect((warnings[0].payload as Row).referenceCandidates).toEqual(expect.arrayContaining(['SC055-FIRST', 'SC055-SECOND']))
  expect(port.tables.ediel_message_events.every(row => row.company_id === COMPANY && row.ediel_message_id === ACK)).toBe(true)
}

describe('SC-055 wrong legal APERAK cannot mutate a targeted case or another tenant', () => {
  it('refuses wrong legal NAD despite exact reverse technical actors, document and transaction references', async () => {
    incoming().raw_payload = ackRaw('SC055-SOURCE-D', '54321', '99999')
    await assertSafeRefusal()
  })

  it('refuses a similar document reference and wrong legal counterparty without targeting the own case', async () => {
    incoming().raw_payload = ackRaw('SC055-SOURCE-D-SIMILAR', '66666', '99999')
    await assertSafeRefusal()
  })

  it('refuses a physically matching foreign original with a similar reference in the own incoming tenant', async () => {
    port.candidate = structuredClone(port.tables.ediel_messages.find(row => row.id === FOREIGN_SOURCE)!) as unknown as EdielMessageRow
    incoming().raw_payload = ackRaw('SC055-SOURCE-D-SIMILAR', '66666', '55555')
    await assertSafeRefusal()
  })

  it('accepts the own legal tuple with a finite original-SQL receipt and already-bound case input', async () => {
    const probe = await captureExistingSqlRunner()
    expect(probe.company).toBe(COMPANY); expect(probe.actor).toBe(ACTOR)
    // Actual unchanged runner receipt: ten direct and eight rejection checks.
    expect(probe.count).toBe(18)
    const { db } = probe
    await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','UTILTS','E66',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`, [SOURCE, COMPANY, sourceRaw()])
    await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,status) values($1,$2,'test','inbound','APERAK','312',$3,'2026-09-30T12:00:00Z','received')`, [ACK, COMPANY, ackRaw()])
    // Canonical original admission/acceptance is an explicit finite setup port,
    // as in the original harness. This is not a native guide-admission claim.
    await db.query(`insert into gridex_received_sources.validation_assessments select $1,id,company_id,environment,immutable_payload_hash,'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from public.ediel_messages where id=$1`, [ACK])
    port.apply = async args => {
      expect(args.p_source_message_id).toBe(SOURCE); expect(args.p_actor_user_id).toBe(ACTOR)
      await db.exec('set role service_role')
      try {
        const receipt = (await db.query<{ result: Row }>('select public.gridex_apply_inbound_ack_source_v1($1,$2,$3,$4,$5) result', [args.p_company_id, args.p_environment, args.p_ack_message_id, args.p_source_message_id, args.p_actor_user_id])).rows[0].result
        Object.assign(port.tables.ediel_messages.find(row => row.id === SOURCE)!, receipt.sourceMessage)
        return receipt
      } finally { await db.exec('reset role') }
    }
    const before = protectedSnapshot(), raw = incoming().raw_payload
    const result = await processInboundAckMessage({ actorUserId: ACTOR, message: incoming() })
    expect(result).toMatchObject({ outcome: 'positive', finalAckReached: true, sourceAccepted: true, wholeSourceRejected: false, sourceMessage: { id: SOURCE, company_id: COMPANY, aperak_status: 'received', status: 'acknowledged' } })
    expect(port.calls.map(call => call.name)).toEqual(['gridex_read_committed_inbound_ack_v2', 'gridex_read_inbound_ack_source_v1', 'gridex_apply_inbound_ack_source_v1'])
    expect(incoming()).toMatchObject({ raw_payload: raw, related_message_id: SOURCE, validation_report: { matchedOutboundEdielMessageId: SOURCE, sourceAccepted: true } })
    expect(port.tables.customer_cases[0]).toMatchObject({ status: 'resolved', cancellation_status: 'accepted', billing_blocked: true, metadata: { preserved: 'own-case-history', cancellationAck: { ackMessageId: ACK, outcome: 'positive', finalAckReached: true } } })
    expect(port.tables.customer_case_events).toEqual([expect.objectContaining({ company_id: COMPANY, customer_case_id: 'own-case', event_type: 'cancellation_ack_accepted' })])
    expect(port.tables.audit_logs).toEqual([expect.objectContaining({ company_id: COMPANY, entity_id: 'own-case', action: 'cancellation_ack_accepted' })])
    const after = protectedSnapshot()
    expect(after.sources.find(row => row.id === FOREIGN_SOURCE)).toEqual(before.sources.find(row => row.id === FOREIGN_SOURCE))
    expect(after.cases[1]).toEqual(before.cases[1])
    expect({ permissions: after.permissions, sites: after.sites, requests: after.requests, supply: after.supply }).toEqual({ permissions: before.permissions, sites: before.sites, requests: before.requests, supply: before.supply })
    const native = (await db.query<{ row: Row }>('select row_to_json(m) row from public.ediel_messages m where id=$1', [SOURCE])).rows[0].row
    expect(native).toMatchObject({ raw_payload: sourceRaw(), aperak_status: 'received', status: 'acknowledged' })
    expect((await db.query<{ n: number }>('select count(*)::integer n from gridex_ack_authority.source_correlations where ack_message_id=$1 and source_message_id=$2', [ACK, SOURCE])).rows[0].n).toBe(1)
  }, 60_000)
})
