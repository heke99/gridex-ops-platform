import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/** Finite proof of the supplied-data intake clause only. The three core
 * consumers, authorization, grid, lifecycle and S/MIME profile evaluators are
 * actual source. SDK rows and the recipient-certificate resolver result are
 * declared synthetic ports, not native custody, PKIX or production approval.
 * No selected switch means no scheduler-window, wire or activation proof. */
type Row = Record<string, unknown>
type Filter = {kind: 'eq' | 'is' | 'in' | 'or'; column: string; value: unknown}
type Call = {table: string; operation: string; filters: Filter[]; selected: number; payload?: Row; changed?: string[]; reaffirmed?: string[]}
const ports = vi.hoisted(() => ({from: vi.fn(), rpc: vi.fn(), certificate: vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: ports.from, rpc: ports.rpc}}))
vi.mock('@/lib/ediel/security/outboundRecipientCertificate', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ediel/security/outboundRecipientCertificate')>(),
  resolveOutboundRecipientCertificate: ports.certificate,
}))
import {evaluateCustomerIntake} from '@/lib/customer-operations/customerIntakeOrchestrator'
import {resolveCustomerSiteProcessContext} from '@/lib/customer-operations/customerSiteProcessContext'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = {company: id(1), customer: id(2), site: id(3), point: id(4), contract: id(5), poa: id(6), document: id(7), scope: id(8), grid: id(9), route: id(10), profile: id(11), certificate: id(12)}
const neighbor = {company: id(21), customer: id(22), site: id(23), point: id(24)}
const NOW = '2026-10-13T12:00:00.000Z'
const START = '2026-11-12'
const copy = <T>(value: T): T => structuredClone(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const reads = [
  'customer_sites', 'metering_points', 'customer_contracts', 'customer_contract_lifecycle_readiness_v',
  'powers_of_attorney', 'customer_authorization_documents', 'authorization_scopes', 'grid_owners',
  'grid_owner_contact_channels', 'grid_owner_information_requests', 'supplier_switch_requests',
  'customer_lifecycle_decisions', 'customer_operation_tasks', 'gridex_verified_grid_owners_v',
  'gridex_company_route_readiness_v', 'ediel_route_profiles', 'communication_routes',
] as const
// Empty relations still expose only the columns the actual consumers request.
const schemaExtras: Record<string, string[]> = {
  customer_contracts: ['starts_at', 'legal_readiness_status'],
  customer_contract_lifecycle_readiness_v: ['active', 'lifecycle_stage'],
  powers_of_attorney: ['customer_contract_id', 'scope_summary', 'signed_scope_snapshot', 'fullmakt_snapshot', 'valid_until'],
  authorization_scopes: ['covers_metering_data'],
  grid_owners: ['route_status'],
  grid_owner_contact_channels: ['id', 'grid_owner_id', 'channel_type', 'is_enabled', 'is_verified'],
  grid_owner_information_requests: ['id', 'company_id', 'customer_id', 'customer_site_id', 'request_type', 'created_at'],
  supplier_switch_requests: ['id', 'company_id', 'customer_id', 'site_id', 'customer_site_id', 'status', 'request_type', 'requested_start_date', 'metadata', 'communication_route_id', 'ediel_route_profile_id', 'created_at'],
  customer_lifecycle_decisions: ['id', 'company_id', 'customer_id', 'decision_type', 'scope_type', 'scope_id', 'reason', 'created_at'],
  customer_operation_tasks: ['id', 'company_id', 'customer_id', 'site_id', 'metering_point_id', 'task_type', 'title', 'description', 'metadata', 'created_at', 'status'],
  gridex_verified_grid_owners_v: ['name', 'ediel_id', 'org_number', 'certificate_status', 'route_count', 'prodat_route_count', 'utilts_route_count', 'duplicate_count', 'verification_reasons', 'next_action', 'prodat_subaddress_status', 'utilts_subaddress_status', 'prodat_subaddress_source', 'utilts_subaddress_source', 'can_use_for_utilts'],
}
const certificateRaw: Row = {id: own.certificate, company_id: own.company, status: 'active', encryption_status: 'approved',
  owner_ediel_id: '27700', owner_subaddress: 'PRODAT', message_family: 'PRODAT', environment: 'production',
  usage: 'outbound_recipient', purpose: 'encryption', fingerprint_sha256: 'a'.repeat(64), valid_to: '2027-01-01T00:00:00Z'}
const certificateMetadata: Row = {receiver_certificate_status: 'approved', receiver_certificate_id: own.certificate,
  receiver_certificate_fingerprint: 'a'.repeat(64), receiver_certificate_owner_ediel_id: '27700',
  receiver_certificate_valid_to: '2027-01-01T00:00:00Z', receiver_certificate_source: 'ediel_certificates',
  receiver_certificate_usage: 'outbound_recipient', receiver_certificate_purpose: 'encryption'}

class Boundary {
  rows: Record<string, Row[]> = Object.fromEntries(reads.map(table => [table, []]))
  calls: Call[] = []
  denied: string[] = []
  before: Record<string, Row[]>
  schemaFailure: string | null = null
  missingCertificate = false
  columns: Record<string, Set<string>>
  constructor(process: 'supplier_switch_existing_site' | 'move_in') {
    this.rows.customer_sites = [{id: own.site, company_id: own.company, customer_id: own.customer, site_name: 'Own supplied site',
      facility_id: '735123456789012345', grid_owner_id: own.grid, grid_area_code: 'OWN', price_area_code: 'SE3',
      current_supplier_name: 'Declared current supplier', current_supplier_unknown: false, move_in_date: START,
      metadata: {process_type: process}},
    {id: neighbor.site, company_id: neighbor.company, customer_id: neighbor.customer, facility_id: '735123456789012346',
      grid_owner_id: own.grid, grid_area_code: 'FOREIGN', price_area_code: 'SE4', metadata: {process_type: 'move_in'}}]
    this.rows.metering_points = [{id: own.point, company_id: own.company, customer_id: own.customer, site_id: own.site,
      customer_site_id: own.site, status: 'active', meter_point_id: '735123456789012345', metering_point_id: '735123456789012345',
      verification_status: 'verified', grid_owner_id: own.grid, grid_area_code: 'OWN', price_area_code: 'SE3', created_at: NOW},
    {id: neighbor.point, company_id: neighbor.company, customer_id: neighbor.customer, site_id: neighbor.site,
      status: 'active', meter_point_id: '735123456789012346', metering_point_id: '735123456789012346', grid_owner_id: own.grid,
      grid_area_code: 'FOREIGN', price_area_code: 'SE4', created_at: '2026-10-13T13:00:00Z'}]
    this.rows.customer_contracts = [{id: own.contract, company_id: own.company, customer_id: own.customer,
      site_id: own.site, customer_site_id: own.site, status: 'signed', signed_at: '2026-10-01T00:00:00Z', requested_start_date: START,
      starts_at: START, legal_readiness_status: 'ready', metadata: {process_type: process}}]
    this.rows.customer_contract_lifecycle_readiness_v = [{company_id: own.company, customer_id: own.customer,
      customer_site_id: own.site, customer_contract_id: own.contract, agreement_ready: true, agreement_signed: true,
      switch_ready: true, accepted_document_count: 5, blockers: []}]
    this.rows.powers_of_attorney = [{id: own.poa, company_id: own.company, customer_id: own.customer, site_id: own.site,
      customer_site_id: own.site, contract_id: own.contract, status: 'signed', signed_at: '2026-10-01T00:00:00Z',
      scope: 'supplier_switch', valid_from: '2026-01-01T00:00:00Z', valid_to: '2027-01-01T00:00:00Z', revoked_at: null,
      document_id: own.document, created_at: NOW}]
    this.rows.customer_authorization_documents = [{id: own.document, company_id: own.company, customer_id: own.customer,
      site_id: own.site, customer_contract_id: own.contract, power_of_attorney_id: own.poa, status: 'active'}]
    this.rows.authorization_scopes = [{id: own.scope, company_id: own.company, customer_id: own.customer,
      authorization_document_id: own.document, status: 'active', revoked_at: null, valid_from: '2026-01-01T00:00:00Z',
      valid_to: '2027-01-01T00:00:00Z', covers_current_supplier_contract: true, covers_grid_owner_data: true}]
    this.rows.grid_owners = [{id: own.grid, verified_for_customer_flow: true, technical_owner_only: false,
      verification_status: 'verified', prodat_ready_for_customer_flow: true, supplier_switch_ready: true}]
    this.rows.gridex_verified_grid_owners_v = [{grid_owner_id: own.grid, verification_status: 'verified',
      verified_for_customer_flow: true, can_start_supplier_switch: true, can_use_for_prodat: true}]
    this.rows.gridex_company_route_readiness_v = [{company_id: own.company, grid_owner_id: own.grid,
      grid_owner_name: 'Declared electricity network', grid_owner_ediel_id: '27700', message_family: 'PRODAT', message_code: 'Z03',
      environment: 'production', send_ready: true, operational_route_ready: true, blocker_code: null,
      communication_route_id: own.route, ediel_route_profile_id: own.profile}]
    this.rows.ediel_route_profiles = [{id: own.profile, company_id: own.company, communication_route_id: own.route,
      is_enabled: true, is_active: true, is_production_ready: true, production_mode: 'live', environment: 'production',
      message_family: 'PRODAT', message_code: 'Z03', transport_mode: 'smtp', sender_ediel_id: '12345', own_ediel_id: '12345',
      receiver_ediel_id: '27700', receiver_subaddress: 'PRODAT', smtp_to: 'declared@example.invalid', receiver_email: 'declared@example.invalid',
      application_reference: '23-DDQ-PRODAT', encryption_mode: 'smime', allow_unencrypted_production: false,
      certificate_required: true, receiver_certificate_id: own.certificate, security_policy_status: 'approved',
      metadata: {production_send_lock_status: 'approved', ...certificateMetadata}}]
    this.rows.communication_routes = [{id: own.route, company_id: own.company, is_active: true, environment: 'production',
      counterparty_ediel_id: '27700', target_email: 'declared@example.invalid'}]
    this.columns = Object.fromEntries(reads.map(table => [table, new Set([...this.rows[table].flatMap(row => Object.keys(row)), ...(schemaExtras[table] ?? [])])]))
    this.before = copy(this.rows)
  }
  seal() { this.before = copy(this.rows) }
  deny(reason: string): never { this.denied.push(reason); throw new Error(`closed_intake_port:${reason}`) }
  from(table: string) {
    if (!reads.includes(table as typeof reads[number])) return this.deny(`table:${table}`)
    return new Query(this, table)
  }
  column(table: string, column: string) { if (!this.columns[table].has(column)) this.deny(`column:${table}:${column}`) }
  certificate(args: Row) {
    expect(args).toEqual({companyId: own.company, routeProfileId: own.profile, certificateId: own.certificate,
      receiverEdielId: '27700', receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z03',
      environment: 'production', certificateEnvironment: 'production', smtpTo: 'declared@example.invalid', ownEdielId: '12345'})
    if (this.missingCertificate) throw new Error('declared_recipient_certificate_unavailable')
    return {raw: copy(certificateRaw), fingerprintSha256: 'a'.repeat(64)}
  }
  profileUpdate(row: Row, patch: Row): {changed: string[]; reaffirmed: string[]} {
    if (row.id !== own.profile || row.company_id !== own.company) return this.deny('foreign_profile_update')
    const changed: string[] = [], reaffirmed: string[] = []
    const priorMeta = row.metadata as Row, nextMeta = patch.metadata as Row
    const readControls = new Set(['receiver_email_source', 'production_readiness_checked_at', 'production_readiness_source', 'production_readiness_blockers'])
    for (const [key, value] of Object.entries(patch)) {
      if (!['metadata', 'updated_at', 'certificate_required', 'receiver_certificate_id', 'security_policy_status', 'is_production_ready', 'production_mode'].includes(key)) this.deny(`profile_unknown_field:${key}`)
      if (key === 'metadata') {
        for (const priorKey of Object.keys(priorMeta)) if (!(priorKey in nextMeta)) this.deny(`metadata_removed:${priorKey}`)
        for (const [field, nested] of Object.entries(nextMeta)) {
          const path = `metadata.${field}`
          if (same(nested, priorMeta[field])) { reaffirmed.push(path); continue }
          const downgrade = (field === 'receiver_certificate_status' && nested === 'blocked') ||
            (['receiver_certificate_id', 'receiver_certificate_fingerprint'].includes(field) && nested === null)
          if (!readControls.has(field) && !downgrade) this.deny(`metadata_upgrade_or_unknown:${field}`)
          if (field === 'receiver_email_source' && nested !== 'route_profile') this.deny('receiver_source_changed')
          if (field.endsWith('_at') && nested !== NOW) this.deny('unexpected_control_clock')
          if (field === 'production_readiness_source' && nested !== 'route_profile_production_readiness_engine') this.deny('unexpected_control_source')
          changed.push(path)
        }
      } else if (same(value, row[key])) { reaffirmed.push(key) }
      else {
        if (!((key === 'updated_at' && value === NOW) || (key === 'is_production_ready' && value === false) ||
          (key === 'production_mode' && value === 'disabled') || (key === 'security_policy_status' && value === 'blocked'))) this.deny(`profile_upgrade_or_unknown:${key}`)
        changed.push(key)
      }
    }
    Object.assign(row, copy(patch))
    return {changed, reaffirmed}
  }
  assertNoBusinessEffects() {
    expect(this.denied).toEqual([])
    for (const table of reads.filter(table => table !== 'ediel_route_profiles')) expect(this.rows[table], table).toEqual(this.before[table])
    expect(this.calls.filter(call => call.operation !== 'select').every(call => call.table === 'ediel_route_profiles')).toBe(true)
    expect(ports.rpc).not.toHaveBeenCalled()
    expect(this.calls.some(call => call.table.startsWith('ediel_') && call.table !== 'ediel_route_profiles')).toBe(false)
    // Readiness refresh cannot introduce any production approval or namespace.
    const original = this.before.ediel_route_profiles[0], current = this.rows.ediel_route_profiles[0]
    expect(current.receiver_certificate_id).toBe(original.receiver_certificate_id)
    for (const key of ['company_id', 'communication_route_id', 'encryption_mode', 'allow_unencrypted_production', 'receiver_ediel_id', 'smtp_to', 'application_reference']) expect(current[key]).toEqual(original[key])
    expect((current.metadata as Row).production_send_lock_status).toBe((original.metadata as Row).production_send_lock_status)
  }
}

class Query {
  filters: Filter[] = []
  orders: {column: string; ascending: boolean; nullsFirst: boolean}[] = []
  columns = '*'
  maximum: number | null = null
  patch: Row | null = null
  constructor(readonly boundary: Boundary, readonly table: string) {}
  select(columns = '*') {
    if (!/^(\*|[a-z_ ,]+)$/.test(columns)) this.boundary.deny('unsupported_projection')
    if (columns !== '*') columns.split(',').forEach(column => this.boundary.column(this.table, column.trim()))
    this.columns = columns; return this
  }
  eq(column: string, value: unknown) { this.boundary.column(this.table, column); this.filters.push({kind: 'eq', column, value}); return this }
  is(column: string, value: unknown) { this.boundary.column(this.table, column); this.filters.push({kind: 'is', column, value}); return this }
  in(column: string, value: unknown[]) { this.boundary.column(this.table, column); this.filters.push({kind: 'in', column, value}); return this }
  or(value: string) {
    if (!/^(site_id|customer_site_id)\.eq\.[a-f0-9-]+,(site_id|customer_site_id)\.eq\.[a-f0-9-]+$/i.test(value)) this.boundary.deny(`unsupported_or:${value}`)
    value.split(',').forEach(clause => this.boundary.column(this.table, clause.split('.')[0]))
    this.filters.push({kind: 'or', column: '', value}); return this
  }
  order(column: string, options: {ascending?: boolean; nullsFirst?: boolean} = {}) {
    this.boundary.column(this.table, column)
    const ascending = options.ascending !== false
    this.orders.push({column, ascending, nullsFirst: options.nullsFirst ?? !ascending}); return this
  }
  limit(n: number) { if (!Number.isInteger(n) || n < 0) this.boundary.deny('unsupported_limit'); this.maximum = n; return this }
  update(patch: Row) { if (this.table !== 'ediel_route_profiles') this.boundary.deny(`update:${this.table}`); this.patch = copy(patch); return this }
  insert() { return this.boundary.deny(`insert:${this.table}`) }
  upsert() { return this.boundary.deny(`upsert:${this.table}`) }
  delete() { return this.boundary.deny(`delete:${this.table}`) }
  execute(single = false) {
    const b = this.boundary
    let selected = b.rows[this.table].filter(row => this.filters.every(f => f.kind === 'eq' ? row[f.column] === f.value :
      f.kind === 'is' ? (row[f.column] ?? null) === f.value : f.kind === 'in' ? (f.value as unknown[]).includes(row[f.column]) :
        String(f.value).split(',').some(clause => {const [column, , value] = clause.split('.'); return row[column] === value})))
    for (const order of [...this.orders].reverse()) selected.sort((a, c) => {
      const left = a[order.column], right = c[order.column]
      if (left == null && right == null) return 0
      if (left == null) return order.nullsFirst ? -1 : 1
      if (right == null) return order.nullsFirst ? 1 : -1
      const comparison = String(left).localeCompare(String(right)); return order.ascending ? comparison : -comparison
    })
    if (this.maximum !== null) selected = selected.slice(0, this.maximum)
    const call: Call = {table: this.table, operation: this.patch ? 'update' : 'select', filters: copy(this.filters), selected: selected.length}
    b.calls.push(call)
    if (b.schemaFailure === this.table) return {data: null, error: {code: '42P01', message: 'declared missing relation'}}
    if (this.patch) {
      if (selected.length !== 1 || !this.filters.some(f => f.kind === 'eq' && f.column === 'id' && f.value === own.profile)) b.deny('profile_update_cardinality_or_scope')
      call.payload = copy(this.patch); Object.assign(call, b.profileUpdate(selected[0], this.patch))
    }
    if (single && selected.length > 1) b.deny(`singleton:${this.table}`)
    const projected = selected.map(row => this.columns === '*' ? copy(row) : Object.fromEntries(this.columns.split(',').map(key => [key.trim(), copy(row[key.trim()] ?? null)])))
    return {data: single ? projected[0] ?? null : projected, error: null}
  }
  maybeSingle() { return Promise.resolve(this.execute(true)) }
  then(resolve: (result: ReturnType<Query['execute']>) => unknown) { return Promise.resolve(this.execute()).then(resolve) }
}

let b: Boundary
const input = () => ({companyId: own.company, customerId: own.customer, siteId: own.site, contractId: own.contract, apply: false, autoEnsureFacilityLookup: false})
function install(process: 'supplier_switch_existing_site' | 'move_in' = 'supplier_switch_existing_site') {
  b = new Boundary(process)
  ports.from.mockImplementation(table => b.from(table))
  ports.rpc.mockImplementation(name => b.deny(`rpc:${name}`))
  ports.certificate.mockImplementation(args => b.certificate(args))
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.stubGlobal('fetch', vi.fn(() => b.deny('network_fetch')))
  install()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('existing correct data intake: finite SDK/certificate boundaries, actual consumers', () => {
  it.each([
    ['supplier_switch_existing_site', false], ['supplier_switch_existing_site', true],
    ['move_in', false], ['move_in', true],
  ] as const)('does not force Z01 before ordinary readiness for %s, automatic lookup=%s', async (process, autoEnsureFacilityLookup) => {
    install(process)
    const context = await resolveCustomerSiteProcessContext(input())
    expect(context).toMatchObject({processType: process, contractReady: true, authorizationReady: true, facilityReady: true,
      gridOwnerReady: true, meteringPointId: own.point, gridAreaCode: 'OWN', priceAreaCode: 'SE3', requestedStartDate: START,
      evidence: {process_variant: {z01Variant: process === 'move_in' ? 'LK' : 'L', z01Reason: process === 'move_in' ? 'Z23' : 'Z22'}}})
    const result = await evaluateCustomerIntake({...input(), autoEnsureFacilityLookup})
    expect(result).toMatchObject({state: 'ready_for_supplier_switch', nextAction: 'start_supplier_switch', blockers: [],
      references: {customerId: own.customer, siteId: own.site, contractId: own.contract, meteringPointId: own.point,
        gridOwnerInformationRequestId: null, supplierSwitchRequestId: null, communicationRouteId: null, edielRouteProfileId: null}})
    // Intake currently reads top-level IDs; actual readiness nests them under
    // route_readiness. This criterion needs readiness, not a new ID projection.
    // Bind real route/profile use through SDK queries and certificate arguments.
    expect(b.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({table: 'ediel_route_profiles', operation: 'select', selected: 1,
        filters: [{kind: 'eq', column: 'id', value: own.profile}]}),
      expect.objectContaining({table: 'communication_routes', operation: 'select', selected: 1,
        filters: [{kind: 'eq', column: 'id', value: own.route}]}),
    ]))
    expect(ports.certificate).toHaveBeenCalledTimes(1)
    const writes = b.calls.filter(call => call.operation === 'update')
    expect(writes).toHaveLength(1)
    expect(writes[0].reaffirmed).toEqual(expect.arrayContaining(['certificate_required', 'receiver_certificate_id', 'security_policy_status']))
    expect(writes[0].changed).toEqual(['metadata.receiver_email_source', 'metadata.production_readiness_checked_at', 'metadata.production_readiness_source', 'updated_at'])
    b.assertNoBusinessEffects()
    console.info('Z01_EXISTING_DATA_COMPONENT', JSON.stringify({process, autoEnsureFacilityLookup, calls: b.calls, certificateArguments: ports.certificate.mock.calls, result, ports: 'SYNTHETIC_SDK_AND_CERTIFICATE_RESULT_ONLY'}))
  })

  const refusals: {name: string; change: (boundary: Boundary) => void; state: string; action: string; code?: string}[] = [
    {name: 'missing own facility cannot borrow the newer foreign point', change: x => {delete x.rows.customer_sites[0].facility_id; x.rows.metering_points = x.rows.metering_points.filter(r => r.id !== own.point)}, state: 'needs_facility_lookup', action: 'request_facility_data'},
    {name: 'missing own facility cannot borrow another site of the same customer', change: x => {delete x.rows.customer_sites[0].facility_id; x.rows.metering_points = x.rows.metering_points.filter(r => r.id !== own.point); x.rows.metering_points[0].company_id = own.company; x.rows.metering_points[0].customer_id = own.customer}, state: 'needs_facility_lookup', action: 'request_facility_data'},
    {name: 'provisional unverified Ediel identity cannot satisfy actual site readiness', change: x => {delete x.rows.customer_sites[0].facility_id; delete x.rows.metering_points[0].meter_point_id; delete x.rows.metering_points[0].metering_point_id; x.rows.metering_points[0].ediel_reference = '735123456789012345'; x.rows.metering_points[0].verification_status = 'pending'}, state: 'needs_admin_review', action: 'review_blocker', code: 'meter_point_id_missing'},
    {name: 'provisional selected grid owner is not canonical owner authority', change: x => {x.rows.customer_sites[0].selected_grid_owner_id = own.grid; delete x.rows.customer_sites[0].grid_owner_id; delete x.rows.metering_points[0].grid_owner_id}, state: 'needs_grid_owner_resolution', action: 'resolve_grid_owner', code: 'grid_owner_missing'},
    {name: 'unverified own grid cannot progress', change: x => {x.rows.grid_owners[0].verified_for_customer_flow = false}, state: 'needs_admin_review', action: 'review_blocker', code: 'grid_owner_not_verified'},
    {name: 'missing own POA', change: x => {x.rows.powers_of_attorney = []}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'valid_site_authorization_missing'},
    {name: 'neighbor POA cannot authorize own site', change: x => {x.rows.powers_of_attorney[0].site_id = neighbor.site; x.rows.powers_of_attorney[0].customer_site_id = neighbor.site}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'valid_site_authorization_missing'},
    {name: 'expired own POA', change: x => {x.rows.powers_of_attorney[0].valid_to = '2026-10-12T00:00:00Z'}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'valid_site_authorization_missing'},
    {name: 'missing materialized own document', change: x => {x.rows.customer_authorization_documents = []}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'authorization_document_missing_for_site'},
    {name: 'neighbor document cannot authorize own site', change: x => {x.rows.customer_authorization_documents[0].site_id = neighbor.site}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'authorization_document_missing_for_site'},
    {name: 'expired materialized own scope', change: x => {x.rows.authorization_scopes[0].valid_to = '2026-10-12T00:00:00Z'}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'authorization_scope_missing'},
    {name: 'foreign scope cannot authorize own document', change: x => {x.rows.authorization_scopes[0].company_id = neighbor.company}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'authorization_scope_missing'},
    {name: 'unsigned contract', change: x => {x.rows.customer_contracts[0].signed_at = null}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'contract_signature_missing'},
    {name: 'unready canonical agreement', change: x => {x.rows.customer_contract_lifecycle_readiness_v[0].agreement_ready = false}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'agreement_not_operationally_ready'},
    {name: 'missing contract readiness schema', change: x => {x.schemaFailure = 'customer_contract_lifecycle_readiness_v'}, state: 'needs_contract_or_poa', action: 'review_blocker', code: 'contract_readiness_unavailable'},
    {name: 'unavailable production route', change: x => {x.rows.gridex_company_route_readiness_v = []}, state: 'needs_admin_review', action: 'review_blocker', code: 'route_readiness_missing'},
    {name: 'held production send lock', change: x => {(x.rows.ediel_route_profiles[0].metadata as Row).production_send_lock_status = 'held'}, state: 'needs_admin_review', action: 'review_blocker', code: 'production_send_locked'},
    {name: 'missing scoped S/MIME recipient certificate', change: x => {x.missingCertificate = true}, state: 'needs_admin_review', action: 'review_blocker', code: 'receiver_certificate_missing'},
    {name: 'already open own switch is reused by waiting', change: x => {x.rows.supplier_switch_requests = [{id: id(30), company_id: own.company, customer_id: own.customer, site_id: own.site, status: 'waiting_response', created_at: NOW}]}, state: 'supplier_switch_waiting_response', action: 'wait_for_switch_ack'},
  ]
  it.each(refusals)('$name', async ({change, state, action, code}) => {
    change(b); b.seal()
    const result = await evaluateCustomerIntake(input())
    expect(result.state).toBe(state); expect(result.nextAction).toBe(action)
    if (code) expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({code})]))
    expect(result.nextAction).not.toBe('start_supplier_switch')
    b.assertNoBusinessEffects()
    if (code === 'production_send_locked' || code === 'receiver_certificate_missing') {
      expect(b.rows.ediel_route_profiles[0]).toMatchObject({is_production_ready: false, production_mode: 'disabled'})
      expect(b.calls.filter(call => call.operation === 'update')).toHaveLength(1)
    }
    console.info('Z01_EXISTING_DATA_COMPONENT_REFUSAL', JSON.stringify({name: refusals.find(item => item.change === change)?.name, result, calls: b.calls, certificateArguments: ports.certificate.mock.calls}))
  })

  it('rejects a foreign input site rather than choosing an own or neighbor fallback', async () => {
    const result = await evaluateCustomerIntake({...input(), siteId: neighbor.site})
    expect(result).toMatchObject({state: 'needs_admin_review', nextAction: 'review_blocker', blockers: [{code: 'customer_site_context_failed', message: 'customer_site_not_found_or_wrong_scope', source: 'customer_intake_orchestrator'}]})
    expect(ports.certificate).not.toHaveBeenCalled(); b.assertNoBusinessEffects()
  })
})
