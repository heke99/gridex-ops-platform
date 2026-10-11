// masterplan: SC-012
// Coupled component behavior evidence; native authority remains separate.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
type Reply = { data: unknown; error: unknown }
type Fixture = { db: PGlite; schemaHash: string; definitions: Record<string, string>; tables: string[] }
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, calls: [] as Array<{ name: string; args: Row }>, writes: [] as Array<{ table: string; value: Row }>,
  read: null as null | ((name: string, args: Row) => Promise<Reply>), source: {} as EdielMessageRow,
  facts: {} as Record<string, Row>, results: {} as Record<string, Row>, assessment: '',
  ownSourceReadings:null as ProdatOwnSourceReadingSdk|null,
}))

// Finite Supabase transport only. Runtime, legal selection, coordinator,
// source owner, domain adapters, SQL effects, ACK builder/kernel and writer run.
vi.mock('@/lib/supabase/service', async () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []; one = false; maximum = Infinity; operation = 'read'; value: Row = {}; exact = false
    constructor(readonly table: string) {}
    select(columns = '*', options?: { count?: string }) { void columns; this.exact = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    is(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this }
    not(key: string, operator: string, value: unknown) { if (operator !== 'is') throw Error(`Undeclared operator ${operator}`); this.filters.push(row => (row[key] ?? null) !== value); return this }
    lt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) < value); return this }
    lte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) <= value); return this }
    gt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) > value); return this }
    gte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) >= value); return this }
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
          port.writes.push({ table: this.table, value: structuredClone(this.value) })
          if (!['ediel_messages', 'ediel_message_events', 'ediel_outbox', 'ediel_processing_runs', 'ediel_decision_traces', 'ediel_sla_timers', 'ediel_inbound_cases', 'audit_logs'].includes(this.table)) throw Error(`SC012 undeclared direct business write ${this.table}`)
          if (this.operation === 'update') for (const row of rows) Object.assign(row, structuredClone(this.value))
          else { rows = [{ id: `00000000-0000-4000-8000-${String(8000 + port.writes.length).padStart(12, '0')}`, created_at: new Date().toISOString(), ...structuredClone(this.value) }]; port.tables[this.table] = [...all, ...rows] }
        }
        return { data: structuredClone(this.one ? rows[0] ?? null : rows), error: null, ...(this.exact ? { count: selected.length } : {}) }
      }).then(done, failed)
    }
  }
  return { supabaseService:(await import('./helpers/prodatOwnSourceReadingAdapter')).prodatOwnSourceReadingAdapter(()=>port.ownSourceReadings,{
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row) => {
      port.calls.push({ name, args: structuredClone(args) })
      const pending = Promise.resolve().then(() => { if (!port.read) throw Error('SC012 database not initialized'); return port.read(name, args) })
      return Object.assign(pending, { abortSignal: () => pending })
    },
  }) }
})

import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { permissionAckMessage, permissionAckObject } from './fixtures/prodat-permission-ack'
import { OWNER, ownerId, ownerRows, ownerRulePack, ownerSourceWithInstallationStatus as ownerSource } from './helpers/sourceOwnerFixtures'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import { PRODAT_FIXTURE_COMPANY, prodatFixtureSourceRpc, withProdatFixtureInsertContext } from './helpers/prodatInboundSourceFixture'

const company = PRODAT_FIXTURE_COMPANY, actor = ownerId(2), foreignCompany = ownerId(200)
const permissionId = ownerId(210), foreignPermission = ownerId(211), originalZ13 = ownerId(212), originalZ03 = ownerId(213)
const z14Id = ownerId(214), z04Id = ownerId(215)
const hash = (value: unknown) => createHash('sha256').update(String(value), 'utf8').digest('hex')
const permissionTables = ['public.metering_permissions', 'public.metering_permission_sites', 'gridex_received_sources.permission_transitions', 'gridex_received_sources.permission_partition_receipts', 'gridex_received_sources.permission_effect_receipts', 'public.ediel_business_expectations']
const supplyTables = ['public.supplier_switch_requests', 'public.customer_supply_periods', 'gridex_received_sources.supply_source_transitions', 'gridex_received_sources.supply_object_partitions', 'gridex_received_sources.supply_object_effect_receipts', 'gridex_received_sources.normal_switch_confirmations']
const protectedTables = ['public.customers', 'public.customer_sites', 'public.metering_points', 'public.customer_contracts', 'public.tenant_ediel_profiles', 'public.tenant_actor_roles', 'public.tenant_actor_identifiers', 'public.ediel_service_assignments', 'public.ediel_service_evidence', 'public.ediel_data_access_grants', 'public.ediel_assignment_permission_links', 'public.sc012_actor_port']
let fixture: Fixture

async function insert(table: string, row: Row) {
  const keys = Object.keys(row)
  await fixture.db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
}
async function snapshot(tables: string[]) {
  const results: Record<string, Row[]> = {}
  for (const table of tables) results[table] = (await fixture.db.query<Row>(`SELECT * FROM ${table} ORDER BY to_jsonb(${table.split('.')[1]})::text`)).rows
  return results
}
async function refreshBusiness() {
  const rows = await snapshot([...permissionTables.slice(0, 2), ...supplyTables.slice(0, 2), ...protectedTables.filter(table => !table.startsWith('public.sc012'))])
  // Supabase JSON encodes timestamps as strings; PGlite returns Date objects.
  for (const [table, values] of Object.entries(rows)) port.tables[table.split('.')[1]] = JSON.parse(JSON.stringify(values))
}

function wire(code: 'Z13' | 'Z14' | 'Z03' | 'Z04', id: string): EdielMessageRow {
  const permission = code === 'Z13' || code === 'Z14', outbound = code === 'Z13' || code === 'Z03'
  const base = permission ? permissionAckMessage(code, 'S17', code === 'Z14' ? 'A74' : null, null, undefined, permissionAckObject(code, 'S17', code === 'Z14' ? 'A74' : null, null, '1', 'SC012-DGI')) : code==='Z04'?ownerSource('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}}):ownerSource('Z12')
  const body = tokenizeEdifact(base.raw_payload!).segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => {
    let raw = segment.raw
    if (!permission) raw = raw.replace('BGM+Z04', `BGM+${code}`).replace('RFF+LI:CASE-1', 'RFF+LI:SC012-DDQ').replace('NAD+UD+CUSTOMER-1', 'NAD+UD+001')
    if (outbound) raw = raw.replace('NAD+FR+12345', 'NAD+FR+54321').replace('NAD+DO+54321', 'NAD+DO+12345')
    return raw
  })
  const raw = EdifactEnvelopeCodec.encode({ sender: outbound ? '54321' : '12345', receiver: outbound ? '12345' : '54321', senderQualifier: '14', receiverQualifier: '14', environment: 'test', applicationReference: permission ? '23-DGI-PRODAT' : '23-DDQ-PRODAT', interchangeReference: `SC012-${code}`, acknowledgementRequest: true,
    messages: [{ messageReference: 'M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
  return { ...base, id, company_id: company, customer_id: OWNER.customer, metering_point_id: OWNER.point, site_id: OWNER.site, message_code: code, raw_payload: raw, direction: outbound ? 'outbound' : 'inbound', sender_ediel_id: outbound ? '54321' : '12345', receiver_ediel_id: outbound ? '12345' : '54321', application_reference: permission ? '23-DGI-PRODAT' : '23-DDQ-PRODAT', status: outbound ? 'sent' : 'received', requires_contrl: true, requires_aperak: true }
}

function registryRow() {
  const row = ownerRulePack(), permission = port.source.message_code === 'Z14'
  const profileKey = permission ? 'PRODAT:Z14:V:26.A:r3' : row.profile_key
  const profile = permission ? { ...row.profile, messageCode: 'Z14', transactionSubtype: 'V', reasonForTransaction: 'S17', canonicalDirection: 'inbound' } : row.profile
  return { ...row, profile_key: profileKey, business_process: permission ? 'metering_permission' : row.business_process, profile,
    original_snapshot: { ...row.original_snapshot, messageProfile: { ...row.original_snapshot.messageProfile, profile_key: profileKey, profile } } }
}

async function capture(args: Row) {
  const source = port.source, facts = String(args.p_facts_text), application = String(args.p_application_facts_text), response = String(args.p_response_facts_text)
  expect(args).toMatchObject({ p_company_id: company, p_source_message_id: source.id, p_environment: 'test', p_source_payload_hash: hash(source.raw_payload) })
  port.facts[source.id] = JSON.parse(facts)
  await insert('gridex_received_sources.validation_assessments', { id: port.assessment, source_message_id: source.id, company_id: company, environment: 'test', source_payload_hash: hash(source.raw_payload), facts_text: facts, facts_hash: hash(facts) })
  for (const [table, prefix, value] of [['prodat_application_facets', 'application', application], ['prodat_response_facets', 'response', response]]) await insert(`gridex_received_sources.${table}`, { assessment_id: port.assessment, source_message_id: source.id, company_id: company, environment: 'test', source_payload_hash: hash(source.raw_payload), [`${prefix}_facts_text`]: value, [`${prefix}_facts_hash`]: hash(value) })
  // Exact actual canonical evidence is delivered through a declared protected
  // rule read port. No acceptance is manufactured by a status boolean.
  await insert('public.sc012_rule_port', { source_id: source.id, company_id: company, payload_hash: hash(source.raw_payload), basis: JSON.parse(facts).rulePackEvidence })
  expect(args.p_source_function_facts_text ?? null).toBeNull() // Z06-only facet is out of this literal.
}

async function rpc(name: string, args: Row): Promise<Reply> {
  const source = port.source
  if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return { data: [registryRow()], error: null }
  if (name === 'gridex_actor_has_company_permission') return { data: args.p_company_id === company && args.p_actor_user_id === actor && ['communication.read', 'communication.write', 'communication.send', 'ediel_testing.write', 'metering.write'].includes(String(args.p_permission)), error: null }
  if (name === 'ediel_apply_permission_source_v1' || name === 'ediel_apply_supply_source_v1') {
    expect(args).toMatchObject({ p_company_id: company, p_source_message_id: source.id, p_actor_user_id: actor })
    await fixture.db.exec('SET ROLE service_role')
    let data: Row
    try {
      const permission = name === 'ediel_apply_permission_source_v1'
      data = (await fixture.db.query<{ result: Row }>(`SELECT public.${name}($1,$2,$3${permission ? ',$4' : ''}) result`, permission ? [company, source.id, actor, args.p_expected_permission_id] : [company, source.id, actor])).rows[0].result
    } finally { await fixture.db.exec('RESET ROLE') }
    port.results[source.id] = structuredClone(data)
    await refreshBusiness()
    return { data, error: null }
  }
  if (name === 'ediel_read_outbound_ack_replay_v1' || name === 'ediel_read_outbound_ack_scope_replay_v2') return { data: null, error: null }
  if (name === 'ediel_require_source_bytes_available_v1') return { data: null, error: null }
  if (name === 'ediel_read_prodat_structural_final_response_v1') return { data: null, error: null } // Declared final-ACK IO held; no invented business ACK.
  if (name === 'ediel_project_supply_end_followup_v1') return { data: { status: 'not_applicable', effectReceiptId: args.p_effect_receipt_id, sourceMessageId: source.id }, error: null }
  if (name === 'ediel_create_outbound_ack_atomic_v1' || name === 'ediel_create_outbound_ack_scope_atomic_v2') {
    // Transport receipt is finite and comes only from the REAL builder/kernel
    // draft. It grants no permission/supply or native ACK persistence authority.
    const draft = args.p_draft as Row
    expect(args.p_ack_family).toBe('CONTRL')
    const mapped = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), value]))
    const ack = { ...mapped, id: ownerId(6000 + port.tables.ediel_messages.length), company_id: company, environment: 'test', direction: 'outbound', raw_payload: String(draft.rawPayload), message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL', related_message_id: source.id, ack_outcome: args.p_outcome, status: 'draft', parsed_payload: draft.parsedPayload ?? {} }
    port.tables.ediel_messages.push(ack)
    return { data: { version: 1, sourceMessage: structuredClone(source), ackMessage: structuredClone(ack), requestedPayloadHash: hash(draft.rawPayload) }, error: null }
  }
  if (name === 'gridex_read_outbound_acks_for_source_v2') return { data: { version: 2, executionActorUserId: actor, executionPhase: args.p_phase, sourceMessageId: source.id, companyId: company, environment: 'test', sourcePayloadHash: hash(source.raw_payload), originals: port.tables.ediel_messages.filter(row => row.direction === 'outbound' && row.related_message_id === source.id && row.message_family === args.p_ack_family).map(message => ({ status: 'qualified', message: structuredClone(message), payloadHash: hash(message.raw_payload) })) }, error: null }
  if (name === 'ediel_list_business_acks_for_source_v1') return { data: { version: 1, companyId: company, environment: 'test', sourceMessageId: source.id, ackFamily: args.p_ack_family ?? null, messages: [] }, error: null }
  const response = await prodatFixtureSourceRpc(name, args)
  if (name === 'gridex_record_prodat_source_validation_v6') await capture(args)
  if (name === 'gridex_record_prodat_source_validation_v6' || name === 'ediel_read_prodat_application_objects_v1') return { data: { ...(response.data as Row), assessmentId: port.assessment }, error: response.error }
  return response
}

beforeAll(async () => {
  const scenarioModule = await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-sc-012-dual-role-state-sql-regression.mjs')).href)
  fixture = await scenarioModule.createDualRoleDatabase() as Fixture
  for (const [key, value] of Object.entries({ EDIEL_SMTP_FROM: 'configured@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_USER: 'synthetic-user', EDIEL_SMTP_PASS: 'synthetic-unused-fixture-password', EDIEL_SMTP_PORT: '465' })) vi.stubEnv(key, value)
  port.tables = ownerRows()
  port.tables.company_memberships = [{ company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }]
  port.tables.user_profiles = [{ id: actor, user_status: 'active' }]
  port.tables.tenant_actor_roles.push({ ...port.tables.tenant_actor_roles[0], id: ownerId(220), role_code: 'energy_service_company' })
  port.tables.ediel_actor_settings = [{ id: ownerId(221), company_id: company, environment: 'test', is_active: true, actor_role: 'electricity_supplier', ediel_id: '54321', actor_ediel_id: '54321', mailbox: 'configured@example.invalid', smtp_from_email: 'configured@example.invalid' }]
  port.tables.communication_routes = [{ id: ownerId(222), company_id: company, route_scope: 'ediel_ack', grid_owner_id: null, is_active: true, environment_type: 'bilateral_test', target_system: 'synthetic-counterparty', route_type: 'ediel_partner', target_email: 'counterparty@example.invalid' }]
  port.tables.ediel_route_runtime_v = [{ route_profile_id: ownerId(223), communication_route_id: ownerId(222), company_id: company, environment: 'test', is_enabled: true, transport_type: 'smtp', message_standard: 'edifact', payload_format: 'edifact', receiver_ediel_id: '12345', application_reference: '23-DDQ-PRODAT', ack_mode: 'default' }]
  port.tables.grid_owners[0].company_id = company
  port.tables.ediel_messages = []; port.tables.ediel_message_events = []; port.tables.ediel_outbox = []
  await insert('public.companies', { id: company, name: 'Synthetic dual-role tenant' })
  await insert('public.companies', { id: foreignCompany, name: 'Synthetic foreign tenant' })
  await insert('auth.users', { id: actor }); await insert('public.user_profiles', { id: actor, user_status: 'active' })
  await insert('public.company_memberships', { company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' })
  await insert('public.sc012_actor_port', { actor_id: actor, company_id: company, permission: 'metering.write' })
  for (const table of ['tenant_ediel_profiles', 'tenant_actor_roles', 'tenant_actor_identifiers']) for (const row of port.tables[table]) await insert(`public.${table}`, row)
  await insert('public.customers', { id: OWNER.customer, company_id: company, personal_number: '001' })
  await insert('public.customers', { id: ownerId(230), company_id: foreignCompany, personal_number: '001' })
  await insert('public.customer_sites', { id: OWNER.site, company_id: company, customer_id: OWNER.customer, facility_id: OWNER.external, grid_owner_id: OWNER.grid })
  await insert('public.metering_points', { id: OWNER.point, company_id: company, customer_id: OWNER.customer, site_id: OWNER.site, customer_site_id: OWNER.site, meter_point_id: OWNER.external, ediel_metering_point_id: OWNER.external, grid_owner_id: OWNER.grid, grid_owner_ediel_id: '12345', grid_area_code: 'NET-1' })
  const contractId = ownerId(224)
  await insert('public.customer_contracts', { id: contractId, company_id: company, customer_id: OWNER.customer, metering_point_id: OWNER.point, status: 'signed', signed_at: '2026-09-01T00:00:00Z', contract_version: '1', signed_version: '1' })
  await insert('public.customer_sites', { id: ownerId(234), company_id: foreignCompany, customer_id: ownerId(230), facility_id: OWNER.external, grid_owner_id: OWNER.grid })
  await insert('public.metering_points', { id: ownerId(232), company_id: foreignCompany, customer_id: ownerId(230), site_id: ownerId(234), customer_site_id: ownerId(234), meter_point_id: OWNER.external, ediel_metering_point_id: OWNER.external, grid_owner_id: OWNER.grid, grid_owner_ediel_id: '12345', grid_area_code: 'NET-1' })
  await insert('public.customer_contracts', { id: ownerId(235), company_id: foreignCompany, customer_id: ownerId(230), metering_point_id: ownerId(232), status: 'signed', signed_at: '2026-09-01T00:00:00Z', contract_version: '2', signed_version: '2' })
  for (const original of [wire('Z13', originalZ13), wire('Z03', originalZ03)]) {
    await insert('public.ediel_messages', { id: original.id, company_id: company, environment: 'test', direction: 'outbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: original.message_code, raw_payload: original.raw_payload, application_reference: original.application_reference, status: 'sent', customer_id: OWNER.customer, metering_point_id: OWNER.point, message_sent_at: '2026-09-19T00:00:00Z', immutable_rendered_at: '2026-09-19T00:00:00Z', immutable_payload_hash: hash(original.raw_payload) })
    await insert('public.sc012_provider_port', { source_id: original.id, payload_hash: hash(original.raw_payload) })
    // A real, populated foreign graph has the SAME physical actors/references;
    // only namespace differs. It cannot hide behind missing source/contract IO.
    const foreignId = original.message_code === 'Z13' ? ownerId(236) : ownerId(237)
    await insert('public.ediel_messages', { id: foreignId, company_id: foreignCompany, environment: 'test', direction: 'outbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: original.message_code, raw_payload: original.raw_payload, application_reference: original.application_reference, status: 'sent', customer_id: ownerId(230), metering_point_id: ownerId(232), message_sent_at: '2026-09-19T00:00:00Z', immutable_rendered_at: '2026-09-19T00:00:00Z', immutable_payload_hash: hash(original.raw_payload) })
    await insert('public.sc012_provider_port', { source_id: foreignId, payload_hash: hash(original.raw_payload) })
  }
  await insert('public.metering_permissions', { id: permissionId, company_id: company, customer_id: OWNER.customer, status: 'z13_sent', source_z13_message_id: originalZ13, outbound_z13_message_id: originalZ13, rff_li_reference: 'SC012-DGI', grid_owner_ediel_id: '12345' })
  await insert('public.metering_permissions', { id: ownerId(242), company_id: company, customer_id: OWNER.customer, status: 'z13_sent', rff_li_reference: 'SC012-DGI-OTHER', grid_owner_ediel_id: '12345' })
  await insert('public.metering_permissions', { id: foreignPermission, company_id: foreignCompany, customer_id: ownerId(230), status: 'active', source_z13_message_id: ownerId(236), outbound_z13_message_id: ownerId(236), rff_li_reference: 'SC012-DGI', grid_owner_ediel_id: '12345', permission_id: 'FOREIGN-ACCESS', market_state_version: 7 })
  await insert('public.metering_permission_sites', { id: ownerId(238), company_id: foreignCompany, metering_permission_id: foreignPermission, customer_id: ownerId(230), facility_id: OWNER.external, grid_area_code: 'NET-1', status: 'approved', start_date: '2026-01-01', start_at: '2025-12-31T23:00:00Z', metadata: { permissionId: 'FOREIGN-ACCESS', source: 'declared_foreign_fixture' } })
  await insert('public.supplier_switch_requests', { id: OWNER.switch, company_id: company, customer_id: OWNER.customer, metering_point_id: OWNER.point, site_id: OWNER.site, customer_site_id: OWNER.site, contract_id: contractId, customer_contract_id: contractId, outbound_z03_message_id: originalZ03, rff_li_reference: 'SC012-DDQ', status: 'sent', lifecycle_blocked: false })
  await insert('public.supplier_switch_requests', { id: ownerId(231), company_id: foreignCompany, customer_id: ownerId(230), metering_point_id: ownerId(232), site_id: ownerId(234), customer_site_id: ownerId(234), contract_id: ownerId(235), customer_contract_id: ownerId(235), outbound_z03_message_id: ownerId(237), rff_li_reference: 'SC012-DDQ', status: 'waiting_for_z04' })
  await insert('public.customer_supply_periods', { id: ownerId(233), company_id: foreignCompany, customer_id: ownerId(230), metering_point_id: ownerId(232), start_date: '2026-01-01', status: 'active', market_state_version: 8 })
  await refreshBusiness()
  port.read = rpc
}, 30_000)

afterAll(async () => { try { await fixture?.db.close() } finally { vi.unstubAllEnvs() } })

async function receive(code: 'Z14' | 'Z04', id: string) {
  port.assessment = ownerId(code === 'Z14' ? 240 : 241)
  port.source = withProdatFixtureInsertContext(wire(code, id))
  port.ownSourceReadings=null
  if(code==='Z04'){port.ownSourceReadings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(port.ownSourceReadings)
    installProdatOwnSourceReadingFixture(port.ownSourceReadings,port.source,'L',{actorUserId:actor,receivedAt:port.source.message_received_at!,mailId:port.source.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:OWNER.actor})}
  port.tables.ediel_messages.push(structuredClone(port.source) as unknown as Row)
  await insert('public.ediel_messages', { id, company_id: company, environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: code, raw_payload: port.source.raw_payload, application_reference: port.source.application_reference, status: 'received', customer_id: OWNER.customer, metering_point_id: OWNER.point, message_received_at: port.source.message_received_at, execution_context_snapshot: port.source.execution_context_snapshot })
  await insert('public.sc012_legal_port', { source_id: id, company_id: company, payload_hash: hash(port.source.raw_payload), basis: { companyId: company, legalActorId: OWNER.actor, legalEdielId: '54321', actorRole: code === 'Z14' ? 'energy_service_company' : 'electricity_supplier', environment: 'test', family: 'PRODAT', code } })
  await processInboundEdielMessage({ actorUserId: actor, edielMessageId: id })
  return port.tables.ediel_messages.find(row => row.id === id)!
}

describe('SC012 same legal actor keeps DGI permission and DDQ supply independent', () => {
  it('positive Z14 then positive Z04 changes only each own durable state machine in one DB', async () => {
    const beforeSupply = await snapshot(supplyTables), beforeProtected = await snapshot(protectedTables)
    const beforePermissions = await snapshot(permissionTables)
    const originalRows = (await fixture.db.query<Row>("SELECT * FROM public.ediel_messages WHERE direction='outbound' ORDER BY id")).rows
    const foreignBefore = (await fixture.db.query<Row>('SELECT * FROM public.metering_permissions WHERE company_id=$1', [foreignCompany])).rows
    const ownRoles = beforeProtected['public.tenant_actor_roles']
    expect(ownRoles.map(row => [row.company_id, row.actor_id, row.role_code])).toEqual(expect.arrayContaining([[company, OWNER.actor, 'electricity_supplier'], [company, OWNER.actor, 'energy_service_company']]))

    const z14 = await receive('Z14', z14Id)
    expect(port.facts[z14Id]).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
    expect(port.results[z14Id]).toMatchObject({ applied: true, permissionResults: [{ applied: true, permissionId, status: 'active' }] })
    const afterPermission = await snapshot(permissionTables)
    expect(afterPermission['public.metering_permissions'].find(row => row.id === permissionId)).toMatchObject({ status: 'active', permission_id: 'PERMISSION', source_z14_message_id: z14Id, market_state_version: 1 })
    expect(afterPermission['public.metering_permission_sites'].filter(row => row.company_id === company)).toEqual([expect.objectContaining({ company_id: company, metering_permission_id: permissionId, customer_id: OWNER.customer, facility_id: OWNER.external, status: 'approved', metadata: expect.objectContaining({ edielMessageId: z14Id }) })])
    expect(afterPermission['public.metering_permissions'].filter(row => row.id !== permissionId)).toEqual(beforePermissions['public.metering_permissions'].filter(row => row.id !== permissionId))
    expect(afterPermission['public.metering_permission_sites'].filter(row => row.company_id === foreignCompany)).toEqual(beforePermissions['public.metering_permission_sites'].filter(row => row.company_id === foreignCompany))
    expect(await snapshot(supplyTables)).toEqual(beforeSupply)
    expect(await snapshot(protectedTables)).toEqual(beforeProtected)
    expect(port.calls.filter(call => call.name === 'ediel_apply_supply_source_v1')).toEqual([])

    const z04 = await receive('Z04', z04Id)
    expect(port.facts[z04Id]).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
    expect(port.results[z04Id]).toMatchObject({ applied: true, partition: [{ disposition: 'applied' }] })
    // The actual selected SQL normal owner confirms a market period; activation
    // is a separate command/sweep. The source was received before its requested
    // start, which is mature at this real SQL execution clock (no fake timers).
    const clock = (await fixture.db.query<{ received: Date; requested: Date; now: Date }>('SELECT m.message_received_at received,gridex_received_sources.permission_time_v1($2) requested,clock_timestamp() now FROM public.ediel_messages m WHERE m.id=$1', [z04Id, '202610010000'])).rows[0]
    expect(clock.received.getTime()).toBeLessThan(clock.requested.getTime())
    expect(clock.requested.getTime()).toBeLessThan(clock.now.getTime())
    const afterSupply = await snapshot(supplyTables)
    expect(afterSupply['public.supplier_switch_requests'].find(row => row.id === OWNER.switch)).toMatchObject({ status: 'accepted', inbound_z04_message_id: z04Id, outbound_z03_message_id: originalZ03 })
    expect(afterSupply['public.customer_supply_periods'].filter(row => row.company_id === company)).toEqual([expect.objectContaining({ customer_id: OWNER.customer, metering_point_id: OWNER.point, source_message_id: z04Id, source_switch_request_id: OWNER.switch, status: 'confirmed_by_grid_owner', market_state_version: 1 })])
    expect(afterSupply['public.customer_supply_periods'].find(row => row.company_id === company)?.market_start_at).toEqual(clock.requested)
    expect(afterSupply['gridex_received_sources.supply_object_effect_receipts']).toEqual([expect.objectContaining({ company_id: company, source_message_id: z04Id, payload_hash: hash(z04.raw_payload) })])
    expect(await snapshot(permissionTables)).toEqual(afterPermission)
    expect(await snapshot(protectedTables)).toEqual(beforeProtected)
    for (const table of supplyTables.slice(0, 2)) expect(afterSupply[table].filter(row => row.company_id === foreignCompany)).toEqual(beforeSupply[table].filter(row => row.company_id === foreignCompany))
    expect((await fixture.db.query<Row>('SELECT * FROM public.metering_permissions WHERE company_id=$1', [foreignCompany])).rows).toEqual(foreignBefore)
    expect((await fixture.db.query<Row>("SELECT * FROM public.ediel_messages WHERE direction='outbound' ORDER BY id")).rows).toEqual(originalRows)
    expect(port.calls.filter(call => call.name === 'ediel_apply_permission_source_v1').map(call => call.args.p_source_message_id)).toEqual([z14Id])
    expect(port.calls.filter(call => call.name === 'ediel_apply_supply_source_v1').map(call => call.args.p_source_message_id)).toEqual([z04Id])
    expect(port.writes.filter(write => [...permissionTables, ...supplyTables, ...protectedTables].includes(`public.${write.table}`))).toEqual([])
    for (const message of [z14, z04]) {
      const resolution = (message.validation_report as Row).tenantResolution as Row
      expect(resolution).toMatchObject({ companyId: company, marketActorEdielId: '54321', receiverEdielId: '54321' })
      expect(resolution.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'verified_legal_identity', details: expect.objectContaining({ legalActorId: OWNER.actor, roleCodes: expect.arrayContaining(['electricity_supplier', 'energy_service_company']) }) })]))
    }
    expect(z14.raw_payload).toContain('23-DGI-PRODAT'); expect(z04.raw_payload).toContain('23-DDQ-PRODAT')
    for (const [id, incoming] of [[z14Id, z14], [z04Id, z04]] as const) expect((await fixture.db.query<Row>('SELECT raw_payload FROM public.ediel_messages WHERE id=$1', [id])).rows[0].raw_payload).toBe(incoming.raw_payload)
  }, 30_000)
})
