// masterplan: AT-Z01L-SUPPLIER, AT-Z01LK-SUPPLIER
// Unapproved component candidates: real preparation -> source decoders ->
// resolver/mapper -> renderer -> source-bound finalizer -> stored wire/outbox.
// Finite synthetic table/RPC/routing IO proves consumer behavior only. Native
// custody/triggers, full R/D matrix, ACK/Z02 intake, watch and activation remain open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const ports = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), route: vi.fn(), context: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: ports.from, rpc: ports.rpc } }))
vi.mock('@/lib/routes/routeDecisionEngine', async importActual => ({
  ...await importActual<typeof import('@/lib/routes/routeDecisionEngine')>(),
  resolveEdielRoute: ports.route,
}))
vi.mock('@/lib/ediel/core/kernel', async importActual => ({
  ...await importActual<typeof import('@/lib/ediel/core/kernel')>(),
  // Current route/identity is the declared external port. Finalization stays real.
  resolveCanonicalOutboundContext: ports.context,
}))

import { prepareAndQueueProdatZ01FromDataRequest } from '@/lib/ediel/flows/prodatCustomerMasterdata'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'

const profiles = [
  { variant: 'L', reason: 'Z22', process: 'supplier_switch_existing_site', expected: 'L' },
  { variant: 'LK', reason: 'Z23', process: 'move_in', expected: 'LK' },
] as const
type Profile = typeof profiles[number]
type Row = Record<string, unknown>
type Operation = 'select' | 'insert' | 'upsert' | 'update'
type Filter = { kind: string; column: string; value: unknown }
type Trace = { table: string; operation: Operation; columns: string; filters: Filter[]; orders: Row[]; limit: number | null; rows: Row[]; values?: Row[] }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const asOf = '2026-10-05T12:00:00.000Z'
const requestedAt = '2026-10-05T12:00:00Z'
const facility = '735123456789012345'
const hash = 'a'.repeat(64)
const copy = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): Row => value as Row

// Explicit table/operation inventory. Business tables have no write port.
const businessTables = [
  'customers', 'customer_sites', 'metering_points', 'customer_contracts',
  'customer_contract_lifecycle_readiness_v', 'powers_of_attorney',
  'customer_authorization_documents', 'authorization_scopes', 'supplier_switch_requests',
  'customer_supply_periods',
] as const
const readTables = new Set<string>([
  ...businessTables, 'companies', 'company_memberships', 'user_profiles', 'customer_contacts',
  'grid_owners', 'grid_owner_contact_channels', 'platform_actor_routes', 'company_market_party_routes',
  'outbound_requests', 'grid_owner_data_requests', 'ediel_message_intents', 'ediel_messages',
])
const writeOperations: Record<string, readonly Operation[]> = {
  outbound_requests: ['update'], grid_owner_data_requests: ['update'],
  ediel_message_intents: ['upsert', 'update'], ediel_messages: ['insert', 'update'],
  ediel_business_references: ['upsert'], ediel_message_events: ['insert'],
  outbound_dispatch_events: ['insert'], ediel_outbox: ['upsert'],
}
const updateFields: Record<string, readonly string[]> = {
  outbound_requests: ['communication_route_id', 'ediel_route_profile_id', 'sender_ediel_id', 'sender_sub_address', 'receiver_ediel_id', 'receiver_sub_address', 'application_reference', 'message_family', 'message_code', 'blocking_reasons', 'required_admin_actions', 'route_decision_payload', 'updated_by', 'status', 'failure_reason', 'external_reference', 'response_payload', 'prepared_at', 'failed_at'],
  grid_owner_data_requests: ['status', 'external_reference', 'failure_reason', 'updated_by', 'last_partner_response_at', 'response_payload', 'notes'],
  ediel_message_intents: ['updated_at', 'validation_status', 'render_status', 'outbox_status', 'validation_result', 'blocking_reasons', 'ediel_message_id', 'outbound_request_id', 'updated_by'],
  ediel_messages: ['outbound_request_id', 'grid_owner_data_request_id', 'customer_id', 'site_id', 'metering_point_id', 'grid_owner_id', 'communication_route_id', 'updated_by', 'updated_at', 'intent_id', 'route_profile_id', 'operation_id', 'status', 'processing_status'],
}

class FiniteBoundary {
  rows: Record<string, Row[]> = {}
  trace: Trace[] = []
  unexpectedPorts: string[] = []
  beforeBusiness: Record<string, Row[]> = {}
  beforeSibling: Record<string, Row[]> = {}
  customerHeld = false
  witnessRaw: string | null = null
  own: ReturnType<typeof namespaces>
  sibling: ReturnType<typeof namespaces>
  profile: Profile
  registry: Row
  pack: Row
  witness: Row
  routeContext: Row

  constructor(profile: Profile) {
    this.profile = profile
    this.own = namespaces(profile.variant === 'L' ? 1000 : 2000, profile.variant)
    this.sibling = namespaces(profile.variant === 'L' ? 1100 : 2100, `${profile.variant}-SIBLING-L`)
    const n = this.own, s = this.sibling
    for (const table of new Set([...readTables, ...Object.keys(writeOperations)])) this.rows[table] = []
    this.rows.companies = [{ id: n.company, status: 'active' }]
    this.rows.company_memberships = [{ company_id: n.company, user_id: n.actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }]
    this.rows.user_profiles = [{ id: n.actor, user_status: 'active' }]
    this.addBusiness(n, profile.process, '2026-09-01T00:00:00Z', facility, 7654321, '2027-07-15')
    // Newer same-company sibling: every omitted customer/site predicate is observable.
    this.addBusiness(s, 'supplier_switch_existing_site', '2026-10-04T00:00:00Z', '735987654321098765', 9876543, '2027-09-23')
    this.rows.grid_owners = [{ id: n.grid, platform_market_actor_id: n.registryActor, name: 'Synthetic network', owner_code: 'OWN', ediel_id: '54321', is_active: true, verified_for_customer_flow: true, technical_owner_only: false, prodat_ready_for_customer_flow: true, supplier_switch_ready: true, route_status: 'ready' }]
    this.rows.platform_actor_routes = [{ id: n.registryRoute, actor_id: n.registryActor, message_family: 'PRODAT', environment: 'test', status: 'active', is_verified: true }]
    this.rows.company_market_party_routes = [{ id: n.companyRoute, company_id: n.company, market_party_id: n.registryActor, message_family: 'PRODAT', active: true, updated_at: asOf }]
    this.rows.grid_owner_data_requests = [n, s].map(ns => ({
      id: ns.request, company_id: n.company, customer_id: ns.customer, site_id: ns.site,
      metering_point_id: ns.point, grid_owner_id: n.grid, authorization_document_id: ns.authorization,
      operation_id: ns.operation, request_scope: 'customer_masterdata', requested_at: requestedAt,
      external_reference: ns.li, status: 'pending', response_payload: {},
      request_payload: { actorRole: 'supplier', prodatVariant: 'L', reasonForTransaction: 'Z22',
        transactionReference: 'STALE-CALLER-L-LI', documentReference: 'STALE-CALLER-L-DOC',
        annualConsumption: 9999999, requested_start_date: '2030-01-01', grid_area_code: 'STALE' },
    }))
    this.rows.outbound_requests = [n, s].map(ns => ({
      id: ns.outbound, company_id: n.company, customer_id: ns.customer, site_id: ns.site,
      metering_point_id: ns.point, grid_owner_id: n.grid, operation_id: ns.operation,
      source_type: 'grid_owner_data_request', source_id: ns.request, request_type: 'customer_masterdata',
      communication_route_id: n.route, ediel_route_profile_id: n.profile, external_reference: ns.document,
      status: 'prepared', attempts_count: 0, payload: { environment: 'test' }, response_payload: {}, created_at: asOf,
    }))
    // Unrelated original is retained unchanged; own original lookup must be empty.
    this.rows.ediel_messages = [{ id: s.message, company_id: n.company, environment: 'test', direction: 'outbound',
      message_family: 'PRODAT', message_code: 'Z01', customer_id: s.customer, site_id: s.site,
      outbound_request_id: s.outbound, source_operation_id: s.operation, grid_owner_data_request_id: s.request,
      intent_id: s.intent, interchange_reference: '27071500000002', external_reference: s.document,
      transaction_reference: s.li, raw_payload: `UNB+UNOC:3+12345+54321+270715:0000+27071500000002'UNH+2+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+${s.document}+9'LIN+1++735987654321098765:::9'RFF+LI:${s.li}'UNT+5+2'UNZ+1+27071500000002'` }]
    this.registry = { status: 'source_qualified', routeId: n.registryRoute, actorId: n.registryActor, market: 'EL', sourceSha256: 'b'.repeat(64), sourceRecordSha256: 'c'.repeat(64), countryCode: 'SE', legalEdielId: '67890', legalName: 'Synthetic DSO', roles: ['grid_owner'],
      wire: { actorId: n.registryActor, market: 'EL', family: 'PRODAT', environment: 'test', subaddress: null, applicationReference: '23-DDQ-PRODAT', address: 'network@example.invalid', transport: 'smtp', partyId: '67890', interchangePartyId: '54321' } }
    const databaseProfileKey = `PRODAT:Z01:${profile.variant}:26.A:r3`
    const packProfile = { guideVersion: '26.A', guideRevision: '3', family: 'PRODAT', messageCode: 'Z01', transactionSubtype: profile.variant, canonicalDirection: 'outbound', reasonForTransaction: profile.reason }
    const originalSnapshot = { rulePack: { id: n.pack, source_hash: hash, guide_version: '26.A', guide_revision: '3' }, messageProfile: { id: n.packProfile, rule_pack_id: n.pack, profile_key: databaseProfileKey, profile: packProfile }, guideSources: [] }
    this.pack = { rule_pack_id: n.pack, message_profile_id: n.packProfile, market: 'electricity', family: 'PRODAT', guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A', valid_from: '2026-04-01', valid_to: null, source_document: 'Synthetic ordinary Z01 activation', source_hash: hash, field_matrix_version: '26A-r3', profile_key: databaseProfileKey, business_process: 'customer_masterdata', phase: null, profile: packProfile,
      parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true, original_version: '26.A:r3', original_snapshot: originalSnapshot }
    // Fixed independent response, never copied from the actual caller's evidence.
    this.witness = { version: 1, witnessId: n.witness, evidence: { rulePackId: n.pack, messageProfileId: n.packProfile, profileKey: databaseProfileKey, version: '26.A:r3', sourceHash: hash, snapshot: { ...originalSnapshot, profileKey: databaseProfileKey, profileVersionId: n.packProfile, version: '26.A:r3', checksum: hash } } }
    this.routeContext = { companyId: n.company, environment: 'test', messageStandard: 'edifact',
      route: { id: n.route }, routeRuntime: { route_profile_id: n.profile },
      senderEdielId: '12345', receiverEdielId: '54321', senderSubAddress: null, receiverSubAddress: null,
      senderName: 'Synthetic transport', receiverName: 'Synthetic DSO', receiverEmail: 'network@example.invalid', mailbox: 'synthetic',
      applicationReference: '23-DDQ-PRODAT', defaultMessageVersion: 'E2SE6A', routeDecisionReason: 'finite current routing IO',
      actor: { senderEdielId: '12345', legalActorEdielId: '23456', testFlag: 1, tenantIdentity: { companyId: n.company, environment: 'test', legalEdielId: '23456', transportEdielId: '12345' } } }
    this.snapshot()
  }

  addBusiness(ns: ReturnType<typeof namespaces>, process: string, created: string, external: string, annual: number, requested: string) {
    const n = this.own, scope = { company_id: n.company, customer_id: ns.customer }
    const metadata = { process_type: process }
    this.rows.customers.push({ ...scope, id: ns.customer, name: 'MUTABLE FALLBACK', org_number: '1111111111', street: 'Fallback street', postal_code: '99999', city: 'Fallback city', country: 'SE', email: 'fallback@example.invalid', activated_at: null })
    this.rows.customer_sites.push({ ...scope, id: ns.site, facility_id: external, normalized_facility_id: external, grid_owner_id: n.grid, grid_area_code: ns.gridArea, current_supplier_id: ns.supplier, current_supplier_unknown: false, annual_consumption_kwh: annual, move_in_date: '2027-07-17', metadata, street: `${ns.label} installation`, postal_code: '12345', city: 'Installation City', country: 'SE' })
    this.rows.metering_points.push({ ...scope, id: ns.point, site_id: ns.site, customer_site_id: ns.site, ediel_reference: external, meter_point_id: external, grid_area_code: ns.gridArea, grid_owner_id: n.grid, status: 'active', annual_consumption_kwh: annual + 1, created_at: created })
    this.rows.customer_contracts.push({ ...scope, id: ns.contract, customer_site_id: ns.site, site_id: ns.site, status: 'signed', signed_at: created, created_at: created, metadata, requested_start_date: '2027-07-16', starts_at: '2027-07-16T00:00:00Z' })
    this.rows.customer_contract_lifecycle_readiness_v.push({ ...scope, customer_site_id: ns.site, customer_contract_id: ns.contract, agreement_ready: true, agreement_signed: true, active: false, lifecycle_stage: 'signed', blockers: [] })
    this.rows.powers_of_attorney.push({ ...scope, id: ns.poa, site_id: ns.site, customer_site_id: ns.site, customer_contract_id: ns.contract, scope: 'supplier_switch', status: 'signed', signed_at: created, valid_from: '2026-01-01', valid_to: null, valid_until: null, revoked_at: null, document_id: ns.authorization, signed_scope_snapshot: { supplier_switch: true }, created_at: created })
    this.rows.customer_authorization_documents.push({ ...scope, id: ns.authorization, site_id: ns.site, power_of_attorney_id: ns.poa, customer_contract_id: ns.contract, status: 'active' })
    this.rows.authorization_scopes.push({ ...scope, id: ns.scope, authorization_document_id: ns.authorization, status: 'active', revoked_at: null, valid_from: '2026-01-01', valid_to: null, covers_grid_owner_data: true, covers_current_supplier_contract: true, covers_metering_data: false })
    this.rows.supplier_switch_requests.push({ ...scope, id: ns.switch, site_id: ns.site, customer_site_id: ns.site, metering_point_id: ns.point, request_type: process === 'move_in' ? 'move_in' : 'switch', metadata, requested_start_date: requested, status: 'draft', confirmed_start_date: null, created_at: created })
    this.rows.customer_supply_periods.push({ ...scope, id: ns.supply, customer_contract_id: ns.contract, metering_point_id: ns.point, status: 'draft', start_date: '2031-01-01', actual_start_date: null, market_start_at: null, market_state_version: 0, source_message_id: null })
  }

  snapshot() {
    this.beforeBusiness = Object.fromEntries(businessTables.map(table => [table, copy(this.rows[table])]))
    this.beforeSibling = Object.fromEntries(Object.entries(this.rows).map(([table, rows]) => [table, copy(rows.filter(row => row.customer_id === this.sibling.customer))]))
  }
  deny(description: string): never {
    this.unexpectedPorts.push(description)
    throw new Error(`unexpected_finite_port:${description}`)
  }
  from(table: string) {
    if (!readTables.has(table) && !writeOperations[table]) this.deny(`table:${table}`)
    return new FiniteQuery(this, table)
  }
  async rpc(name: string, args: Row) {
    const n = this.own
    switch (name) {
      case 'gridex_actor_has_company_permission':
        expect(args).toMatchObject({ p_actor_user_id: n.actor, p_company_id: n.company })
        if (!['communication.read', 'communication.write', 'metering.read', 'ediel_testing.write'].includes(String(args.p_permission))) this.deny(`permission:${String(args.p_permission)}`)
        return { data: true, error: null }
      case 'ediel_customer_life_event_export_projection_v1':
        expect(args).toEqual({ p_company_id: n.company, p_customer_id: n.customer, p_actor_user_id: n.actor })
        return { data: { status: 'not_applicable' }, error: null }
      case 'ediel_prepare_customer_masterdata_v1':
        expect(args).toEqual({ p_company_id: n.company, p_customer_id: n.customer, p_actor_user_id: n.actor, p_as_of: asOf, p_environment: 'test' })
        return { data: this.customerHeld ? { status: 'held', missing: ['end_user_address'] } : {
          status: 'authorized', companyId: n.company, customerId: n.customer, environment: 'test', asOf,
          sourceKind: 'registered_customer_address', sourceReference: `${n.label}-QUALIFIED-ADDRESS`, sourceDigest: 'd'.repeat(64), sourceContextId: n.source,
          customerIdentity: { id: '5566778899', qualifier: 'SE1', agency: '260' },
          endUserMasterdata: { nameParts: [`${n.label} Qualified`, 'Second'], streetParts: ['Source street', 'Unit 2'], postalCode: '54321', city: 'Source City', country: 'SE' },
        }, error: null }
      case 'ediel_registry_route_source_v1':
        expect(args).toEqual({ p_route_id: n.registryRoute })
        return { data: copy(this.registry), error: null }
      case 'ediel_registry_dispatch_source_v1':
        expect(args).toEqual({ p_company_id: n.company, p_communication_route_id: n.route, p_route_profile_id: n.profile, p_environment: 'test', p_message_family: 'PRODAT', p_application_reference: '23-DDQ-PRODAT' })
        return { data: { ...copy(this.registry), companyId: n.company, communicationRouteId: n.route, routeProfileId: n.profile, selectedApplicationReference: '23-DDQ-PRODAT' }, error: null }
      case 'resolve_canonical_ediel_rule_pack_with_witness_v1':
        expect(args).toEqual({ p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z01', p_transaction_subtype: this.profile.variant, p_direction: 'outbound', p_business_date: '2026-10-05' })
        return { data: [copy(this.pack)], error: null }
      case 'ediel_prepare_outbound_owner_witness_v1': {
        const input = object(args.p_input)
        expect(Object.keys(args)).toEqual(['p_input'])
        expect(Object.keys(input).sort()).toEqual(['actorUserId', 'companyId', 'environment', 'rawPayload', 'rulePackEvidence'])
        expect(input).toMatchObject({ companyId: n.company, actorUserId: n.actor, environment: 'test' })
        expect(input.rulePackEvidence).toEqual(this.witness.evidence)
        const tokens = tokenizeEdifact(String(input.rawPayload)).segments.map(segment => segment.raw)
        expect(tokens).toContain(`BGM+Z01+${n.document}+9+AB`)
        expect(tokens).toContain(`RFF+LI:${n.li}`)
        expect(tokens).toContain(`CAV+${this.profile.reason}`)
        expect(tokens).toContain(`LIN+1++${facility}:::9`)
        this.witnessRaw = String(input.rawPayload)
        return { data: copy(this.witness), error: null }
      }
      default: return this.deny(`rpc:${name}`)
    }
  }
  assertNonEffects() {
    expect(Object.fromEntries(businessTables.map(table => [table, this.rows[table]]))).toEqual(this.beforeBusiness)
    expect(Object.fromEntries(Object.entries(this.rows).map(([table, rows]) => [table, rows.filter(row => row.customer_id === this.sibling.customer)]))).toEqual(this.beforeSibling)
    expect(this.unexpectedPorts).toEqual([])
    expect(this.trace.filter(call => businessTables.includes(call.table as typeof businessTables[number]) && call.operation !== 'select')).toEqual([])
    expect(this.trace.flatMap(call => call.values ?? []).filter(row => ['Z03', 'Z04'].includes(String(row.message_code)))).toEqual([])
  }
}

function namespaces(base: number, label: string) {
  return { label, company: id(base + 1), actor: id(base + 2), customer: id(base + 3), site: id(base + 4), point: id(base + 5), contract: id(base + 6), switch: id(base + 7), request: id(base + 8), operation: id(base + 9), intent: id(base + 10), outbound: id(base + 11), message: id(base + 12), grid: id(base + 13), route: id(base + 14), profile: id(base + 15), registryRoute: id(base + 16), registryActor: id(base + 17), companyRoute: id(base + 18), pack: id(base + 19), packProfile: id(base + 20), witness: id(base + 21), source: id(base + 22), poa: id(base + 23), authorization: id(base + 24), scope: id(base + 25), supplier: id(base + 26), supply: id(base + 27), activation: id(base + 28), document: `${label}-OWN-DOC`, li: `${label}-OWN-LI`, gridArea: label.includes('SIBLING') ? 'SIB' : 'OWN' }
}

// A bounded PostgREST adapter, not table-name canned results. Project columns,
// apply all filters, preserve chained order/null ordering, then limit and cardinality.
class FiniteQuery {
  operation: Operation = 'select'
  filters: Filter[] = []
  orders: Row[] = []
  maximum: number | null = null
  columns = '*'
  values: Row[] = []
  options: Row = {}
  constructor(readonly boundary: FiniteBoundary, readonly table: string) {}
  select(columns = '*') { this.columns = columns.split(',').map(column => column.trim()).join(','); return this }
  eq(column: string, value: unknown) { this.filters.push({ kind: 'eq', column, value }); return this }
  is(column: string, value: unknown) { this.filters.push({ kind: 'is', column, value }); return this }
  in(column: string, value: unknown[]) { this.filters.push({ kind: 'in', column, value }); return this }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) this.boundary.deny(`not:${operator}`)
    this.filters.push({ kind: 'notNull', column, value }); return this
  }
  or(expression: string) {
    if (!/^(customer_site_id|site_id)\.eq\.[a-f0-9-]+,(customer_site_id|site_id)\.eq\.[a-f0-9-]+$/i.test(expression)) this.boundary.deny(`or:${expression}`)
    this.filters.push({ kind: 'or', column: '', value: expression }); return this
  }
  order(column: string, options: Row = {}) {
    const ascending = options.ascending !== false
    this.orders.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending }); return this
  }
  limit(maximum: number) { this.maximum = maximum; return this }
  insert(values: Row | Row[]) { this.operation = 'insert'; this.values = copy(Array.isArray(values) ? values : [values]); return this }
  upsert(values: Row | Row[], options: Row = {}) { this.operation = 'upsert'; this.values = copy(Array.isArray(values) ? values : [values]); this.options = options; return this }
  update(value: Row) { this.operation = 'update'; this.values = [copy(value)]; return this }
  matches(row: Row) {
    return this.filters.every(filter => {
      if (filter.kind === 'eq') return row[filter.column] === filter.value
      if (filter.kind === 'is') return (row[filter.column] ?? null) === filter.value
      if (filter.kind === 'notNull') return row[filter.column] != null
      if (filter.kind === 'in') return (filter.value as unknown[]).includes(row[filter.column])
      if (filter.kind === 'or') return String(filter.value).split(',').some(part => { const [column, , value] = part.split('.'); return row[column] === value })
      return this.boundary.deny(`filter:${filter.kind}`)
    })
  }
  async execute(single = false, optional = false): Promise<{ data: Row | Row[] | null; error: null }> {
    const b = this.boundary, n = b.own
    if (this.operation === 'select' && !readTables.has(this.table)) b.deny(`read:${this.table}`)
    if (this.operation !== 'select' && !writeOperations[this.table]?.includes(this.operation)) b.deny(`${this.operation}:${this.table}`)
    let selected = b.rows[this.table].filter(row => this.matches(row))
    if (this.operation === 'update') {
      // An exact existing own identity is required; no implicit success rows.
      if (!this.filters.some(filter => filter.kind === 'eq' && filter.column === 'id') || selected.length !== 1) b.deny(`update_scope:${this.table}`)
      const target = selected[0]
      for (const field of Object.keys(this.values[0])) if (!updateFields[this.table]?.includes(field)) b.deny(`update_field:${this.table}:${field}`)
      const expectedId = this.table === 'ediel_messages' ? n.message : this.table === 'ediel_message_intents' ? n.intent : this.table === 'grid_owner_data_requests' ? n.request : n.outbound
      if (target.id !== expectedId || target.company_id !== n.company) b.deny(`foreign_update:${this.table}`)
      Object.assign(target, this.values[0])
    } else if (this.operation === 'insert' || this.operation === 'upsert') {
      selected = this.values.map((value, index) => {
        if (value.company_id !== undefined && value.company_id !== n.company) b.deny(`foreign_insert:${this.table}`)
        if (this.table === 'ediel_message_intents') expect(value).toMatchObject({ customer_id: n.customer, customer_site_id: n.site, operation_id: n.operation, message_family: 'PRODAT', message_code: 'Z01', direction: 'outbound' })
        if (this.table === 'ediel_messages') {
          expect(value).toMatchObject({ customer_id: n.customer, site_id: n.site, direction: 'outbound', message_family: 'PRODAT', message_code: 'Z01', intent_id: n.intent, source_operation_id: n.operation })
        }
        if (this.table === 'ediel_outbox') expect(value).toMatchObject({ ediel_message_id: n.message, intent_id: n.intent, status: 'queued', message_family: 'PRODAT', message_code: 'Z01' })
        if (this.table === 'outbound_dispatch_events' && value.outbound_request_id !== n.outbound) b.deny('foreign_dispatch_event')
        if (this.table === 'ediel_message_events' && value.ediel_message_id !== n.message) b.deny('foreign_message_event')
        if (this.table === 'ediel_business_references' && (value.source_message_id !== n.message || value.customer_id !== n.customer)) b.deny('foreign_reference')
        const conflict = String(this.options.onConflict ?? '').split(',').filter(Boolean)
        const prior = this.operation === 'upsert' && conflict.length ? b.rows[this.table].find(row => conflict.every(key => row[key] === value[key])) : undefined
        if (prior) { if (this.options.ignoreDuplicates !== true) Object.assign(prior, value); return prior }
        const row = { created_at: asOf, ...copy(value), id: this.table === 'ediel_message_intents' ? n.intent : this.table === 'ediel_messages' ? n.message : id(9000 + b.trace.length * 10 + index) }
        b.rows[this.table].push(row)
        return row
      })
    }
    selected = [...selected].sort((left, right) => {
      for (const order of this.orders) {
        const a = left[String(order.column)], c = right[String(order.column)]
        if (a === c) continue
        if (a == null || c == null) return a == null ? (order.nullsFirst ? -1 : 1) : (order.nullsFirst ? 1 : -1)
        const comparison = String(a).localeCompare(String(c))
        if (comparison) return order.ascending ? comparison : -comparison
      }
      return 0
    })
    if (this.maximum !== null) selected = selected.slice(0, this.maximum)
    if (this.columns !== '*') {
      if (!/^[a-z_0-9,]+$/i.test(this.columns)) b.deny(`columns:${this.columns}`)
      selected = selected.map(row => Object.fromEntries(this.columns.split(',').map(column => [column, row[column] ?? null])))
    }
    b.trace.push({ table: this.table, operation: this.operation, columns: this.columns, filters: copy(this.filters), orders: copy(this.orders), limit: this.maximum, rows: copy(selected), ...(this.operation !== 'select' ? { values: copy(this.values) } : {}) })
    if (single && (selected.length > 1 || (!optional && !selected.length))) b.deny(`cardinality:${this.table}:${selected.length}`)
    return { data: copy(single ? selected[0] ?? null : selected), error: null }
  }
  single() { return this.execute(true) }
  maybeSingle() { return this.execute(true, true) }
  then<TResult1 = { data: Row | Row[] | null; error: null }, TResult2 = never>(
    resolve?: ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) { return this.execute().then(resolve, reject) }
}

let boundary: FiniteBoundary
function setup(profile: Profile) {
  boundary = new FiniteBoundary(profile)
  const n = boundary.own
  ports.from.mockImplementation(table => boundary.from(table))
  ports.rpc.mockImplementation((name, args) => boundary.rpc(name, args))
  ports.context.mockImplementation(async input => {
    expect(input).toMatchObject({ companyId: n.company, environment: 'test', preferredRouteId: n.route, requestType: 'customer_masterdata', messageStandard: 'edifact' })
    return copy(boundary.routeContext)
  })
  ports.route.mockImplementation(async input => {
    expect(input).toMatchObject({ companyId: n.company, actorUserId: n.actor, environment: 'test', messageFamily: 'PRODAT', messageCode: 'Z01' })
    expect(input.dataRequestId).toBe(n.request)
    return { decisionStatus: 'ready', communicationRouteId: n.route, edielRouteProfileId: n.profile, senderEdielId: '12345', receiverEdielId: '54321', senderSubAddress: null, receiverSubAddress: null, applicationReference: '23-DDQ-PRODAT', messageVersion: 'OBSOLETE-ROUTE-VERSION', blockingReasons: [], requiredAdminActions: [], receiverSource: 'finite immutable registry', payload: {} }
  })
  return boundary
}
function run() {
  const n = boundary.own
  return prepareAndQueueProdatZ01FromDataRequest({ actorUserId: n.actor, gridOwnerDataRequestId: n.request, communicationRouteId: n.route, environment: 'test', operationId: n.operation })
}
function assertNoPhysicalEffects() {
  expect(boundary.trace.filter(call => ['ediel_messages', 'ediel_business_references', 'ediel_message_events', 'ediel_outbox'].includes(call.table) && call.operation !== 'select')).toEqual([])
  expect(boundary.rows.ediel_messages).toHaveLength(1) // retained sibling only
  expect(boundary.rows.ediel_outbox).toEqual([])
  expect(ports.rpc.mock.calls.some(([name]) => name === 'ediel_prepare_outbound_owner_witness_v1')).toBe(false)
  boundary.assertNonEffects()
}
function assertProcessReads() {
  const n = boundary.own
  const ownSite = boundary.trace.find(call => call.table === 'customer_sites' && call.filters.some(filter => filter.column === 'customer_id'))
  expect(ownSite?.filters).toEqual([{ kind: 'eq', column: 'id', value: n.site }, { kind: 'eq', column: 'company_id', value: n.company }, { kind: 'eq', column: 'customer_id', value: n.customer }])
  const selectedSwitch = boundary.trace.find(call => call.table === 'supplier_switch_requests')
  expect(selectedSwitch).toMatchObject({ orders: [{ column: 'created_at', ascending: false, nullsFirst: true }], limit: 1, rows: [{ id: n.switch, requested_start_date: '2027-07-15' }] })
  expect(selectedSwitch?.filters).toEqual([
    { kind: 'eq', column: 'company_id', value: n.company }, { kind: 'eq', column: 'customer_id', value: n.customer },
    { kind: 'or', column: '', value: `site_id.eq.${n.site},customer_site_id.eq.${n.site}` },
    { kind: 'in', column: 'status', value: ['draft', 'queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response', 'manual_followup_required'] },
  ])
  const pointRead = boundary.trace.find(call => call.table === 'metering_points' && call.limit === 20 && call.filters.some(filter => filter.kind === 'or'))
  expect(pointRead?.rows.map(row => row.id)).toEqual([n.point])
  const contractRead = boundary.trace.find(call => call.table === 'customer_contracts' && call.filters.some(filter => filter.kind === 'in'))
  expect(contractRead).toMatchObject({ limit: 1, orders: [{ column: 'signed_at', ascending: false, nullsFirst: false }], rows: [{ id: n.contract }] })
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(asOf)) })
afterEach(() => { vi.useRealTimers() })

describe.each(profiles)('ordinary supplier Z01$variant finite coupled producer', profile => {
  it('stores its own physical tuple and queues the same source-bound message without business effects', async () => {
    setup(profile)
    const result = await run()
    expect(result.prepared, JSON.stringify(result)).toBe(true)
    const n = boundary.own, s = boundary.sibling
    const inserts = boundary.trace.filter(call => call.table === 'ediel_messages' && call.operation === 'insert')
    expect(inserts).toHaveLength(1)
    const stored = boundary.rows.ediel_messages.find(row => row.id === n.message)!
    const intent = boundary.rows.ediel_message_intents.find(row => row.id === n.intent)!
    const raw = String(inserts[0].values?.[0].raw_payload)
    expect(raw).toBe(stored.raw_payload)
    expect(raw).toBe(boundary.witnessRaw)
    expect(createHash('sha256').update(raw).digest('hex')).toBe(createHash('sha256').update(boundary.witnessRaw!).digest('hex'))
    const tokens = tokenizeEdifact(raw), segments = tokens.segments.map(segment => segment.raw)
    const unb = segments.find(segment => segment.startsWith('UNB+'))!
    expect(unb.split('+')[2]).toBe('12345:ZZ')
    expect(unb.split('+')[3]).toBe('54321:ZZ')
    expect(unb.split('+')[5]).toBe(intent.interchange_reference)
    expect(unb.split('+')[7]).toBe('23-DDQ-PRODAT')
    expect(unb.split('+')[9]).toBe('1')
    expect(unb.split('+')[11]).toBe('1')
    expect(intent.interchange_reference).not.toBe('27071500000002')
    expect(segments).toContain(`UNH+${String(intent.message_reference)}+PRODAT:D:97A:UN:E2SE6A`)
    expect(segments).toContain(`BGM+Z01+${n.document}+9+AB`)
    expect(segments).toContain('DTM+ZZZ:1:805')
    const lineStarts = segments.flatMap((segment, index) => segment.startsWith('LIN+') ? [index] : [])
    expect(lineStarts).toHaveLength(1)
    const ownLine = segments.slice(lineStarts[0], segments.findIndex(segment => segment.startsWith('UNT+')))
    expect(ownLine[0]).toBe(`LIN+1++${facility}:::9`)
    expect(ownLine.filter(segment => segment.startsWith('DTM+92:'))).toEqual(['DTM+92:202707150000:203'])
    expect(prodatMarketMinuteToUtc(ownLine.find(segment => segment.startsWith('DTM+92:'))!.split(':')[1])).toBe('2027-07-14T23:00:00.000Z')
    expect(ownLine.slice(ownLine.indexOf('CCI++Z13'), ownLine.indexOf('CCI++Z13') + 2)).toEqual(['CCI++Z13', `CAV+${profile.reason}`])
    expect(ownLine).toContain(`RFF+LI:${n.li}`)
    expect(ownLine).toContain(`RFF+Z05:${n.gridArea}`)
    expect(ownLine).toContain(`RFF+ANJ:${n.li}`)
    expect(segments.find(segment => segment.startsWith('NAD+FR+'))).toBe('NAD+FR+23456:160:SVK+++++++SE')
    expect(segments.find(segment => segment.startsWith('NAD+DO+'))).toBe('NAD+DO+67890:160:SVK+++++++SE')
    const ud = ownLine.find(segment => segment.startsWith('NAD+UD+'))!
    expect(ud).toContain('5566778899:SE1:260')
    for (const expected of [`${n.label} Qualified`, 'Second', 'Source street', 'Unit 2', '54321', 'Source City', 'SE']) expect(ud).toContain(expected)
    const it = ownLine.find(segment => segment.startsWith('NAD+IT+'))!
    for (const expected of [facility, `${n.label} installation`, '12345', 'Installation City', 'SE']) expect(it).toContain(expected)
    expect(segments.some(segment => segment.startsWith('QTY+31:'))).toBe(false)
    for (const excluded of ['MUTABLE FALLBACK', 'Fallback street', 'STALE-CALLER-L-LI', 'STALE-CALLER-L-DOC', s.li, s.document, '735987654321098765', '9876543', '9999999']) expect(raw).not.toContain(excluded)
    expect(stored).toMatchObject({ id: n.message, company_id: n.company, environment: 'test', message_code: 'Z01', message_version: '26A', customer_id: n.customer, site_id: n.site, intent_id: n.intent, outbound_request_id: n.outbound, source_operation_id: n.operation, grid_owner_data_request_id: n.request,
      requires_contrl: true, requires_aperak: false, contrl_status: 'pending', aperak_status: 'not_required',
      ack_due_at: '2026-10-05T12:30:00.000Z', utilts_err_status: 'not_required',
      validation_report: { status: 'ready', canonicalProcessType: profile.process, prodatVariant: profile.variant, expectedZ02Variant: profile.expected },
      parsed_payload: { prodatVariant: profile.variant, reasonForTransaction: profile.reason, expectedZ02Variant: profile.expected, canonicalProcessType: profile.process } })
    expect(intent).toMatchObject({ ediel_message_id: n.message, outbound_request_id: n.outbound, render_status: 'rendered', outbox_status: 'queued', payload: { documentReference: n.document }, transaction_reference: n.li })
    expect(result.message?.id).toBe(n.message)
    expect(boundary.rows.ediel_outbox).toHaveLength(1)
    expect(boundary.rows.ediel_outbox[0]).toMatchObject({ ediel_message_id: n.message, intent_id: n.intent, company_id: n.company, route_profile_id: n.profile, status: 'queued', payload: { processVariant: profile.variant, expectedZ02Variant: profile.expected, operationId: n.operation, intentId: n.intent, gridOwnerDataRequestId: n.request } })
    expect(object(boundary.rows.grid_owner_data_requests[0].response_payload)).toMatchObject({ edielMessageId: n.message, intentId: n.intent, outboundRequestId: n.outbound })
    expect(object(boundary.rows.outbound_requests[0].response_payload)).toMatchObject({ edielMessageId: n.message })
    expect(boundary.rows.ediel_business_references.length).toBeGreaterThan(0)
    expect(boundary.rows.ediel_message_events.some(row => row.event_type === 'queued')).toBe(true)
    expect(ports.rpc.mock.calls.filter(([name]) => name === 'ediel_prepare_outbound_owner_witness_v1')).toHaveLength(1)
    assertProcessReads()
    boundary.assertNonEffects()
  })

  it('reaches the strict renderer facility gate after valid source/process reads', async () => {
    setup(profile)
    boundary.rows.metering_points[0].ediel_reference = '73512345678901234'
    boundary.snapshot()
    const result = await run()
    expect(result).toMatchObject({ prepared: false, message: null, blockerCode: 'render_failed' })
    expect(result.blockerReason).toContain('PRODAT Z01 kan inte byggas utan anläggnings-id/mätpunkt.')
    expect(ports.rpc.mock.calls.some(([name]) => name === 'ediel_prepare_customer_masterdata_v1')).toBe(true)
    expect(boundary.rows.ediel_message_intents[0]).toMatchObject({ validation_status: 'validated', render_status: 'failed', outbox_status: 'not_queued' })
    assertProcessReads()
    assertNoPhysicalEffects()
  })

  it('propagates held end-user-address from the actual customer-source decoder', async () => {
    setup(profile)
    boundary.customerHeld = true
    const result = await run()
    expect(result).toMatchObject({ prepared: false, message: null, blockerCode: 'render_failed' })
    expect(result.blockerReason).toContain('customer_masterdata_source_held:end_user_address')
    expect(boundary.trace.some(call => call.table === 'supplier_switch_requests')).toBe(false)
    expect(boundary.rows.ediel_message_intents[0]).toMatchObject({ render_status: 'failed', outbox_status: 'not_queued' })
    assertNoPhysicalEffects()
  })

  it('refuses the request ESCO role at the actual pre-render intent gate', async () => {
    setup(profile)
    object(boundary.rows.grid_owner_data_requests[0].request_payload).actorRole = 'energy_service_company'
    const result = await run()
    expect(result).toMatchObject({ prepared: false, message: null, blockerCode: 'prodat_actor_role_not_allowed' })
    expect(boundary.rows.ediel_message_intents[0]).toMatchObject({ validation_status: 'blocked', render_status: 'failed', outbox_status: 'failed' })
    expect(ports.rpc.mock.calls.some(([name]) => name === 'ediel_prepare_customer_masterdata_v1')).toBe(false)
    assertNoPhysicalEffects()
  })
})

it('holds own LK customer with the sibling L site at the genuine earlier prerequisite gate', async () => {
  setup(profiles[1])
  boundary.rows.grid_owner_data_requests[0].site_id = boundary.sibling.site
  boundary.snapshot()
  const result = await run()
  expect(result).toMatchObject({ prepared: false, message: null, blockerCode: 'facility_or_metering_point_missing' })
  const details = object(result.blockerDetails)
  expect(object(details.prerequisite_evidence)).toMatchObject({ site_customer_matches: false, blocker_code: 'request_site_customer_mismatch', site_id: boundary.sibling.site })
  expect(boundary.rows.ediel_message_intents).toEqual([])
  expect(ports.rpc.mock.calls.some(([name]) => name === 'ediel_prepare_customer_masterdata_v1')).toBe(false)
  expect(boundary.trace.some(call => call.table === 'supplier_switch_requests')).toBe(false)
  assertNoPhysicalEffects()
})
