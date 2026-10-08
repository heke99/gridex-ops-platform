// masterplan: SC-021
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
type Probe = { db: PGlite; id: (n: number) => string; source: string; scopes: Row[]; company: string; actor: string; effects: Row[]; checks: number }
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, calls: [] as Array<{ name: string; args: Row }>,
  writes: [] as Array<{ table: string; value: Row }>,
  read: null as null | ((name: string, args: Row) => Promise<{ data: unknown; error: unknown }>),
  source: {} as EdielMessageRow, assessment: '', finalRead: null as Row | null,
  guideFault: null as null | 'missing' | 'wrong-source-hash',
}))

// Only external DB transport is substituted. All domain/decision/ACK producers
// and consumers, source guards, event writer and outbox implementation are real.
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []; one = false; maximum = Infinity
    operation = 'read'; value: Row = {}; exact = false
    constructor(readonly table: string) {}
    select(columns = '*', options?: { count?: string }) { void columns; this.exact = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    is(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this }
    not(key: string, op: string, value: unknown) { if (op !== 'is') throw Error(`Undeclared operator ${op}`); this.filters.push(row => (row[key] ?? null) !== value); return this }
    lt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) < value); return this }
    lte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) <= value); return this }
    gte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) >= value); return this }
    gt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) > value); return this }
    contains(key: string, value: Row) { this.filters.push(row => Object.entries(value).every(([k, v]) => (row[key] as Row | undefined)?.[k] === v)); return this }
    or(expression: string) {
      const alternatives = expression.split(',').map(part => {
        const match = /^([^.]+)\.(eq|is|lt)\.(.*)$/.exec(part)
        if (!match) throw Error(`Undeclared OR ${expression}`)
        const [, key, op, value] = match
        return (row: Row) => op === 'eq' ? String(row[key] ?? '') === value : op === 'is' ? value === 'null' && row[key] == null : row[key] != null && String(row[key]) < value
      })
      this.filters.push(row => alternatives.some(filter => filter(row))); return this
    }
    order() { return this }
    limit(value: number) { this.maximum = value; return this }
    abortSignal() { return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    insert(value: Row) { this.operation = 'insert'; this.value = value; return this }
    upsert(value: Row) { this.operation = 'insert'; this.value = value; return this }
    then(done: (value: unknown) => unknown, failed: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const all = port.tables[this.table] ?? [], selected = all.filter(row => this.filters.every(filter => filter(row)))
        let rows = selected.slice(0, this.maximum)
        if (this.operation !== 'read') {
          if (!['ediel_messages', 'ediel_message_events', 'ediel_outbox', 'ediel_processing_runs', 'ediel_decision_traces', 'ediel_sla_timers', 'ediel_inbound_cases', 'audit_logs'].includes(this.table)) throw Error(`Undeclared write ${this.table}`)
          port.writes.push({ table: this.table, value: structuredClone(this.value) })
          if (this.operation === 'update') for (const row of rows) Object.assign(row, structuredClone(this.value))
          else { rows = [{ id: ownerId(800 + port.writes.length), created_at: new Date().toISOString(), ...structuredClone(this.value) }]; port.tables[this.table] = [...all, ...rows] }
        }
        if (this.one && this.operation === 'read' && rows.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'Multiple rows cannot be returned as one JSON object' }, ...(this.exact ? { count: selected.length } : {}) }
        }
        return { data: structuredClone(this.one ? rows[0] ?? null : rows), error: null, ...(this.exact ? { count: selected.length } : {}) }
      }).then(done, failed)
    }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row) => {
      port.calls.push({ name, args: structuredClone(args) })
      const pending = Promise.resolve().then(() => {
        if (!port.read) throw Error('SC021 DB port not initialized')
        return port.read(name, args)
      })
      return Object.assign(pending, { abortSignal: () => pending })
    },
  } }
})

import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { readPhysicalAckSourceCorrelation } from '@/lib/ediel/ack/sourceCorrelation'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { permissionAckMessage, permissionAckObject } from './fixtures/prodat-permission-ack'
import { OWNER, ownerId, ownerRows, ownerRulePack } from './helpers/sourceOwnerFixtures'
import { PRODAT_FIXTURE_COMPANY, prodatFixtureSourceRpc, withProdatFixtureInsertContext } from './helpers/prodatInboundSourceFixture'

const company = PRODAT_FIXTURE_COMPANY, actor = ownerId(2)
const hash = (value: unknown) => createHash('sha256').update(String(value), 'utf8').digest('hex')
let probe: Probe, execution: Promise<unknown> | undefined, release: (() => void) | undefined, directory: string
let caseNumber = 0

function currentFunction(file: string, name: string) {
  const source = readFileSync(resolve('supabase/migrations', file), 'utf8')
  const start = source.indexOf(`CREATE FUNCTION ${name}(`), end = source.indexOf('END $$;', start)
  if (start < 0 || end < start) throw Error(`Current SQL definition missing: ${name}`)
  return source.slice(start, end + 'END $$;'.length)
}

function ruleRow() {
  const row = ownerRulePack(), profileKey = 'PRODAT:Z14:N:26.A:r3'
  const profile = { ...row.profile, messageCode: 'Z14', transactionSubtype: 'N', reasonForTransaction: 'Z96', canonicalDirection: 'inbound' }
  return { ...row, profile_key: profileKey, business_process: 'metering_permission', profile,
    original_snapshot: { ...row.original_snapshot, rulePack: { ...row.original_snapshot.rulePack, family: 'PRODAT' },
      messageProfile: { ...row.original_snapshot.messageProfile, profile_key: profileKey, profile } } }
}

async function executeSql(sql: string, values: unknown[]) {
  await probe.db.exec('SET ROLE service_role')
  try { return (await probe.db.query<{ result: unknown }>(sql, values)).rows[0].result }
  finally { await probe.db.exec('RESET ROLE') }
}

async function captureActualFacets(args: Row) {
  const source = port.source, facts = String(args.p_facts_text), application = String(args.p_application_facts_text), responses = String(args.p_response_facts_text)
  expect(args).toMatchObject({ p_company_id: company, p_source_message_id: source.id, p_environment: 'test', p_source_payload_hash: hash(source.raw_payload) })
  await probe.db.query(`INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6)`, [port.assessment, source.id, company, hash(source.raw_payload), facts, hash(facts)])
  for (const [table, prefix, value] of [['prodat_application_facets', 'application', application], ['prodat_response_facets', 'response', responses]]) {
    await probe.db.query(`INSERT INTO gridex_received_sources.${table}(assessment_id,source_message_id,company_id,environment,source_payload_hash,${prefix}_facts_text,${prefix}_facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6)`, [port.assessment, source.id, company, hash(source.raw_payload), value, hash(value)])
  }
  await probe.db.query('INSERT INTO application_fixture VALUES($1,$2)', [source.id, { ...JSON.parse(application), assessmentId: port.assessment }])
  await probe.db.query('INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES($1,$2,$3,$4,$5,$6)', [source.id, 'national', company, 'test', hash(source.raw_payload),
    (await probe.db.query<{ source_version: string }>('SELECT source_version FROM gridex_ediel_ack_guide.synthetic_original_guide')).rows[0].source_version])
}

async function rpc(name: string, args: Row): Promise<{ data: unknown; error: unknown }> {
  const source = port.source
  if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return { data: [ruleRow()], error: null }
  if (name === 'gridex_actor_has_company_permission') return { data: args.p_company_id === company && args.p_actor_user_id === actor && ['communication.read', 'communication.write', 'communication.send', 'ediel_testing.write'].includes(String(args.p_permission)), error: null }
  if (name === 'ediel_read_outbound_ack_replay_v1' || name === 'ediel_read_outbound_ack_scope_replay_v2') return { data: null, error: null }
  if (name === 'ediel_require_source_bytes_available_v1') {
    expect(args).toEqual({ p_company_id: company, p_source_message_id: source.id })
    expect(source.raw_payload).toBeTruthy()
    return { data: null, error: null }
  }
  if (name === 'ediel_apply_permission_source_v1') {
    return { data: await executeSql('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) result', [args.p_company_id, args.p_source_message_id, args.p_actor_user_id, args.p_expected_permission_id]), error: null }
  }
  if (name === 'ediel_read_prodat_structural_final_response_v1') {
    // Faults alter only the declared guide IO; the actual current SQL guard
    // decides whether that original can qualify its real committed receipt.
    if (port.guideFault === 'missing') await probe.db.query('DELETE FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=$1', [source.id])
    if (port.guideFault === 'wrong-source-hash') await probe.db.query('UPDATE gridex_ediel_ack_guide.source_bindings SET payload_sha256=$1 WHERE source_message_id=$2', ['f'.repeat(64), source.id])
    const data = await executeSql('SELECT public.ediel_read_prodat_structural_final_response_v1($1,$2,$3::integer[]) result', [args.p_company_id, args.p_source_message_id, args.p_object_line_indices])
    port.finalRead = structuredClone(data) as Row
    return { data, error: null }
  }
  if (name === 'ediel_create_outbound_ack_atomic_v1' || name === 'ediel_create_outbound_ack_scope_atomic_v2') {
    // Declared atomic transport port, populated ONLY from the actual preceding
    // kernel/builder output. It does not prove native ACK transaction durability.
    const draft = args.p_draft as Row
    const mapped = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key.replace(/[A-Z]/g, character => '_' + character.toLowerCase()), value]))
    const ack = { ...mapped, id: ownerId(600 + port.tables.ediel_messages.length), company_id: company, environment: 'test', direction: 'outbound', raw_payload: String(draft.rawPayload), message_standard: 'edifact', message_family: String(args.p_ack_family), message_code: args.p_ack_family, related_message_id: source.id, ack_outcome: args.p_outcome, status: 'draft', created_at: new Date().toISOString(), parsed_payload: draft.parsedPayload ?? {} }
    port.tables.ediel_messages.push(ack)
    const own = readPhysicalAckSourceCorrelation(ack, source).prodatObjectOutcomes
    const scopes = own?.map(value => ({ scope: 'object', reference: String(value.firstLineIndex), physicalReference: { lineIndex: value.firstLineIndex, id: value.objectId, li: value.lineItemReference }, outcome: value.outcome }))
    return { data: { version: name.endsWith('v2') ? 2 : 1, sourceMessage: structuredClone(source), ackMessage: structuredClone(ack), requestedPayloadHash: hash(draft.rawPayload), requestedScopes: scopes, ackScopes: scopes }, error: null }
  }
  if (name === 'gridex_read_outbound_acks_for_source_v2') return { data: { version: 2, executionActorUserId: actor, executionPhase: args.p_phase, sourceMessageId: source.id, companyId: company, environment: 'test', sourcePayloadHash: hash(source.raw_payload),
    originals: port.tables.ediel_messages.filter(row => row.direction === 'outbound' && row.related_message_id === source.id && row.message_family === args.p_ack_family).map(row => ({ status: 'qualified', message: structuredClone(row), payloadHash: hash(row.raw_payload) })) }, error: null }
  if (name === 'ediel_list_business_acks_for_source_v1') return { data: { version: 1, companyId: company, environment: 'test', sourceMessageId: source.id, ackFamily: args.p_ack_family ?? null, messages: port.tables.ediel_messages.filter(row => row.direction === 'outbound' && row.related_message_id === source.id && row.message_family === 'APERAK') }, error: null }
  const reply = await prodatFixtureSourceRpc(name, args)
  if (name === 'gridex_record_prodat_source_validation_v6') await captureActualFacets(args)
  const data = reply.data as Row
  if (['gridex_record_prodat_source_validation_v6', 'ediel_read_prodat_application_objects_v1'].includes(name)) return { data: { ...data, assessmentId: port.assessment }, error: reply.error }
  return reply
}

function explicitWire(code: string, reason: string, status: string | null, sourceNumber: number, outbound = false) {
  const fixture = permissionAckMessage(code, reason, status, null, undefined, permissionAckObject(code, reason, status, null, '1', `SC021-CASE-${caseNumber}`))
  const original = tokenizeEdifact(fixture.raw_payload!)
  const body = original.segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => outbound && segment.tag === 'NAD'
    ? segment.raw.replace('NAD+FR+12345', 'NAD+FR+54321').replace('NAD+DO+54321', 'NAD+DO+12345') : segment.raw)
  const raw = EdifactEnvelopeCodec.encode({ sender: outbound ? '54321' : '12345', receiver: outbound ? '12345' : '54321', senderQualifier: '14', receiverQualifier: '14', environment: 'test', applicationReference: '23-DGI-PRODAT', interchangeReference: `SC021-${sourceNumber}`, acknowledgementRequest: true,
    messages: [{ messageReference: 'M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
  return { ...fixture, id: ownerId(sourceNumber), raw_payload: raw, sender_ediel_id: outbound ? '54321' : '12345', receiver_ediel_id: outbound ? '12345' : '54321' }
}

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'gridex-sc021-'))
  const hook = resolve(directory, 'probe.mjs')
  writeFileSync(hook, 'export default context => globalThis[Symbol.for("gridex.sc021.sqlProbe")](context)\n')
  let arrive!: (value: Probe) => void
  const arrived = new Promise<Probe>(done => { arrive = done }), finished = new Promise<void>(done => { release = done })
  Reflect.set(globalThis, Symbol.for('gridex.sc021.sqlProbe'), async (value: Probe) => { arrive(value); await finished })
  vi.stubEnv('EDIEL_PGLITE_MODULE', resolve('node_modules/@electric-sql/pglite/dist/index.js'))
  vi.stubEnv('EDIEL_PERMISSION_PROBE_MODULE', hook)
  for (const [key, value] of Object.entries({ EDIEL_SMTP_FROM: 'configured@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_USER: 'synthetic-user', EDIEL_SMTP_PASS: 'synthetic-unused-fixture-password', EDIEL_SMTP_PORT: '465' })) vi.stubEnv(key, value)
  execution = import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-partial-permission-source-sql-regression.mjs')).href)
  probe = await Promise.race([arrived, execution.then(() => { throw Error('Existing SQL script did not invoke its probe hook') })])
  // Reuse the declared external guide/read ports and ACTUAL final materializer.
  const composition = await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-prodat-permission-final-response-composition.mjs')).href)
  await composition.default(probe)
  await probe.db.exec(`ALTER TABLE ediel_messages ADD COLUMN message_standard text DEFAULT 'edifact';
    INSERT INTO companies VALUES('${company}');INSERT INTO auth.users VALUES('${actor}');INSERT INTO user_profiles VALUES('${actor}','active');
    INSERT INTO company_memberships(company_id,user_id,status,is_active,accepted_at) VALUES('${company}','${actor}','active',true,now());
    INSERT INTO permission_fixture VALUES('${actor}','${company}','metering.write');`)
  await probe.db.exec(currentFunction('20261001013700_ediel_prodat_structural_final_response_receipts.sql', 'public.ediel_read_prodat_structural_final_response_v1'))
  await probe.db.exec('REVOKE ALL ON FUNCTION public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[]) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[]) TO service_role;')
  port.read = rpc
}, 30_000)

afterAll(async () => {
  release?.()
  try { await execution }
  finally { Reflect.deleteProperty(globalThis, Symbol.for('gridex.sc021.sqlProbe')); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }) }
})

beforeEach(() => {
  caseNumber += 1; port.calls = []; port.writes = []; port.assessment = ownerId(1000 + caseNumber); port.finalRead = null; port.guideFault = null
  port.tables = ownerRows()
  port.tables.company_memberships = [{ company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }]
  port.tables.user_profiles = [{ id: actor, user_status: 'active' }]
  port.tables.tenant_actor_roles = [{ ...port.tables.tenant_actor_roles[0], role_code: 'energy_service_company' }]
  port.tables.ediel_actor_settings = [{ id: ownerId(700), company_id: company, environment: 'test', is_active: true, actor_role: 'energy_service_company', ediel_id: '54321', actor_ediel_id: '54321', mailbox: 'configured@example.invalid', smtp_from_email: 'configured@example.invalid' }]
  port.tables.communication_routes = [{ id: ownerId(701), company_id: company, route_scope: 'ediel_ack', grid_owner_id: null, is_active: true, environment_type: 'bilateral_test', target_system: 'synthetic-counterparty', route_type: 'ediel_partner', target_email: 'counterparty@example.invalid' }]
  // External configuration is prospective and scoped to the original APP.
  // A generic NULL/NULL profile is eligible, but every competitor must count.
  port.tables.ediel_route_profiles = [{ id: ownerId(702), communication_route_id: ownerId(701), company_id: company,
    environment: 'test', is_enabled: true, is_active: true, application_reference: '23-DGI-PRODAT', message_family: null, business_code: null }]
  port.tables.ediel_route_runtime_v = [{ route_profile_id: ownerId(702), communication_route_id: ownerId(701), company_id: company, environment: 'test', is_enabled: true, transport_type: 'smtp', message_standard: 'edifact', payload_format: 'edifact', receiver_ediel_id: '12345', application_reference: '23-DGI-PRODAT', message_family: null, business_code: null, ack_mode: 'default' }]
  port.tables.grid_owners[0].company_id = company
  port.tables.ediel_messages = []; port.tables.ediel_message_events = []; port.tables.ediel_outbox = []
})

async function receive(status: 'A13' | 'A76') {
  const incoming = explicitWire('Z14', 'Z96', status, 100 + caseNumber)
  port.source = withProdatFixtureInsertContext({ ...incoming, status: 'received', requires_contrl: true, requires_aperak: true, parsed_payload: {} } as EdielMessageRow)
  port.tables.ediel_messages.push(port.source as unknown as Row)
  const outbound = explicitWire('Z13', 'S17', null, 200 + caseNumber, true), permission = ownerId(300 + caseNumber)
  for (const [m, direction] of [[port.source, 'inbound'], [outbound, 'outbound']] as const) await probe.db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id,message_sent_at,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'test',$3,'PRODAT',$4,$5,$6,$7,CASE WHEN $3='outbound' THEN now() END,CASE WHEN $3='outbound' THEN now() END,CASE WHEN $3='outbound' THEN $8 END)`, [m.id, company, direction, m.message_code, m.raw_payload, direction === 'outbound' ? 'sent' : 'received', OWNER.customer, hash(m.raw_payload)])
  await probe.db.query('INSERT INTO accepted_source_fixture VALUES($1,$2)', [outbound.id, hash(outbound.raw_payload)])
  await probe.db.query(`INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'z13_sent',$4,$4,$5,'12345',0,'{}')`, [permission, company, OWNER.customer, outbound.id, `SC021-CASE-${caseNumber}`])
  await probe.db.query('INSERT INTO legal_fixture VALUES($1,$2)', [port.source.id, { actorRole: 'energy_service_company', legalEdielId: '54321', environment: 'test', family: 'PRODAT', code: 'Z14' }])
  const before = port.source.raw_payload
  const originals = (await probe.db.query<Row>('SELECT * FROM ediel_messages ORDER BY id')).rows
  const otherPermissions = (await probe.db.query<Row>('SELECT * FROM metering_permissions WHERE id<>$1 ORDER BY id', [permission])).rows
  const existingSites = (await probe.db.query<Row>('SELECT * FROM metering_permission_sites ORDER BY id')).rows
  const business = Object.fromEntries(['metering_points', 'customer_sites', 'customer_supply_periods', 'supplier_switch_requests'].map(table => [table, structuredClone(port.tables[table])]))
  await processInboundEdielMessage({ actorUserId: actor, edielMessageId: port.source.id })
  const stored = port.tables.ediel_messages.find(row => row.id === port.source.id)!
  const durable = (await probe.db.query<Row>('SELECT * FROM metering_permissions WHERE id=$1', [permission])).rows[0]
  expect((await probe.db.query<Row>('SELECT * FROM ediel_messages ORDER BY id')).rows).toEqual(originals)
  expect((await probe.db.query<Row>('SELECT * FROM metering_permissions WHERE id<>$1 ORDER BY id', [permission])).rows).toEqual(otherPermissions)
  expect((await probe.db.query<Row>('SELECT * FROM metering_permission_sites ORDER BY id')).rows).toEqual(existingSites)
  for (const [table, rows] of Object.entries(business)) expect(port.tables[table]).toEqual(rows)
  return { stored, durable, before, permission, acks: port.tables.ediel_messages.filter(row => row.direction === 'outbound') }
}

describe('SC-021 durable denial reaches prescribed processing ACKs', () => {
  it.each(['wrong-APP', 'ambiguous'] as const)('holds %s ACK configuration while preserving durable denial and no-access effects', async fault => {
    const profiles = port.tables.ediel_route_profiles
    if (fault === 'wrong-APP') profiles[0].application_reference = '23-DGI-E66-T'
    else profiles.push({ ...profiles[0], id: ownerId(703) })
    const result = await receive('A13')
    expect(result.durable).toMatchObject({ status: 'rejected_active', approved_start_at: null, approved_end_at: null, inbound_z14_message_id: port.source.id })
    expect(result.acks.map(ack => [ack.message_family, ack.ack_outcome])).toEqual([['CONTRL', 'positive']])
    expect(port.calls.filter(call => call.name === 'ediel_create_outbound_ack_scope_atomic_v2')).toEqual([])
    expect(port.tables.ediel_outbox.map(row => row.message_family)).toEqual(['CONTRL'])
    const reason = fault === 'wrong-APP' ? 'ediel_ack_route_profile_required' : 'Multiple rows cannot be returned as one JSON object'
    expect(port.tables.ediel_message_events.some(event => String(event.message).includes(reason))).toBe(true)
  })

  it.each([['A13', 'rejected_active'], ['A76', 'rejected_passive_timeout']] as const)('%s persists %s and acknowledges accepted processing without access', async (status, expected) => {
    const result = await receive(status)
    expect(result.stored.raw_payload).toBe(result.before)
    expect(result.stored.validation_report).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted' })
    expect(result.durable.status).toBe(expected)
    expect(result.durable).toMatchObject({ approved_start_at: null, approved_end_at: null, inbound_z14_message_id: port.source.id })
    expect((await probe.db.query<{ n: number }>('SELECT count(*)::int n FROM metering_permission_sites WHERE metering_permission_id=$1', [result.permission])).rows[0].n).toBe(0)
    expect(port.calls.filter(call => call.name === 'ediel_apply_permission_source_v1')).toHaveLength(1)
    expect(result.acks.map(ack => [ack.message_family, ack.ack_outcome]), JSON.stringify(port.tables.ediel_message_events.filter(event => event.event_type === 'manual_note').map(event => event.message))).toEqual([['CONTRL', 'positive'], ['APERAK', 'positive']])
    const ack = result.acks.find(ack => ack.message_family === 'APERAK')!, aperak = String(ack.raw_payload)
    expect(aperak).toContain('ERC+100::260')
    expect(aperak).not.toContain('ERC+42')
    const physical = readPhysicalAckSourceCorrelation({ id: String(ack.id), company_id: String(ack.company_id), environment: String(ack.environment), direction: String(ack.direction), raw_payload: aperak }, port.source)
    expect(physical.prodatObjectOutcomes).toMatchObject([{ objectId: null, lineItemReference: `SC021-CASE-${caseNumber}`, outcome: 'positive' }])
    const final = port.finalRead!, facet = final.responseFacet as Row
    expect(final.sourceMessage).toMatchObject({ id: port.source.id, company_id: company, environment: 'test', raw_payload: result.before })
    expect(facet).toMatchObject({ sourcePayloadHash: hash(result.before), objects: [{ id: null, li: `SC021-CASE-${caseNumber}`, outcome: 'positive' }] })
    const effects = (await probe.db.query<{ effects: Row[] }>('SELECT gridex_received_sources.committed_permission_effects_v1($1,$2,NULL) effects', [company, port.source.id])).rows[0].effects
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ sourcePayloadHash: hash(result.before), canonicalAssessmentId: port.assessment, effectKind: 'metering_permission' })
    expect(facet.effectScopes).toMatchObject(effects.map(effect => ({ effectReceiptId: effect.receiptId, effectFactsHash: effect.effectFactsHash, canonicalAssessmentId: port.assessment, effectKind: 'metering_permission' })))
    expect(port.tables.ediel_outbox.map(row => row.message_family)).toEqual(['CONTRL', 'APERAK'])
    expect(port.tables.ediel_outbox.find(row => row.message_family === 'APERAK')).toMatchObject({ ediel_message_id: ack.id })
  })

  it.each(['missing', 'wrong-source-hash'] as const)('holds a %s original-guide port without inventing a negative processing ACK', async fault => {
    port.guideFault = fault
    const result = await receive('A13')
    expect(result.stored.validation_report).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted' })
    expect(result.durable.status).toBe('rejected_active')
    expect(result.acks.map(ack => [ack.message_family, ack.ack_outcome])).toEqual([['CONTRL', 'positive']])
    expect(port.calls.filter(call => call.name === 'ediel_apply_permission_source_v1')).toHaveLength(1)
    expect(port.calls.filter(call => call.name === 'ediel_read_prodat_structural_final_response_v1')).toHaveLength(1)
    expect(port.calls.filter(call => call.name === 'ediel_create_outbound_ack_scope_atomic_v2')).toHaveLength(0)
    expect(port.finalRead).toBeNull()
    expect(port.tables.ediel_outbox.map(row => row.message_family)).toEqual(['CONTRL'])
    expect(port.tables.ediel_message_events.some(event => String(event.message).includes('prodat_domain_response_original_guide_unavailable'))).toBe(true)
  })
})
