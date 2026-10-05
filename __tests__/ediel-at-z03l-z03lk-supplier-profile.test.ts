// masterplan: AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER
// Unapproved staged HOLD-only component candidates: actual ordinary producer ->
// persisted intent -> source consumers -> renderer -> same-draft finalizer ->
// stored original -> restricted synthetic original-bind HOLD. No native grant.
// Whole IDs remain NOT_EXECUTED: authentic source/current actor/native binding,
// complete R/D/register/windows, ACK/Z04/watch/timers and activation are unproved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const ports = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), route: vi.fn(), context: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: ports.from, rpc: ports.rpc } }))
vi.mock('@/lib/routes/routeDecisionEngine', async importActual => ({
  ...await importActual<typeof import('@/lib/routes/routeDecisionEngine')>(), resolveEdielRoute: ports.route,
}))
vi.mock('@/lib/ediel/core/kernel', async importActual => ({
  ...await importActual<typeof import('@/lib/ediel/core/kernel')>(),
  // Only current routing/identity IO is replaced; actual kernel finalization remains.
  resolveCanonicalOutboundContext: ports.context,
}))

import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'
import { selectedInvoiceeFact } from './fixtures/prodat-ud'

const profiles = [
  { variant: 'L', reason: 'Z22', requestType: 'switch' },
  { variant: 'LK', reason: 'Z23', requestType: 'move_in' },
] as const
type Profile = typeof profiles[number]
type Row = Record<string, unknown>
type Filter = { kind: 'eq' | 'in' | 'notNull'; column: string; value: unknown }
type Order = { column: string; ascending: boolean; nullsFirst: boolean }
type Operation = 'select' | 'insert' | 'upsert' | 'update'
type Trace = { table: string; operation: Operation; columns: string; filters: Filter[]; orders: Order[]; limit: number | null; values: Row[]; rows: Row[] }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const clock = '2026-10-05T10:00:00.000Z'
const startAt = '2027-06-14T23:00:00.000Z' // independent fixed UTC+1 P-profile oracle
const facility = '735123456789012345'
const customerIdentity = '5566778899'
const hash = 'a'.repeat(64)
const copy = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): Row => value as Row
const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')

function namespaces(base: number, label: string) {
  return { label, company: id(base + 1), actor: id(base + 2), customer: id(base + 3), site: id(base + 4), point: id(base + 5),
    contract: id(base + 6), switch: id(base + 7), intent: id(base + 8), outbound: id(base + 9), message: id(base + 10),
    grid: id(base + 11), route: id(base + 12), profile: id(base + 13), registryRoute: id(base + 14), registryActor: id(base + 15),
    pack: id(base + 16), packProfile: id(base + 17), witness: id(base + 18), source: id(base + 19), poa: id(base + 20),
    authorization: id(base + 21), scope: id(base + 22), supplier: id(base + 23), supply: id(base + 24),
    methodDeclaration: id(base + 25), brpDeclaration: id(base + 26), legalActor: id(base + 27),
    external: `${label}-PRELIM`, gridArea: label.includes('SIBLING') ? 'SIB' : 'OWN' }
}
type Namespace = ReturnType<typeof namespaces>
const businessTables = [
  'customers', 'customer_contacts', 'customer_sites', 'metering_points', 'customer_contracts',
  'customer_contract_lifecycle_readiness_v', 'powers_of_attorney', 'customer_authorization_documents',
  'authorization_scopes', 'supplier_switch_requests', 'customer_supply_periods',
] as const
const readTables = new Set<string>([...businessTables, 'companies', 'company_memberships', 'user_profiles',
  'grid_owners', 'outbound_requests', 'ediel_message_intents', 'ediel_messages'])
// Queue/outbox/dispatch/switch-event writes are unreachable and have NO finite write port.
const writeOperations: Record<string, readonly Operation[]> = {
  ediel_message_intents: ['upsert', 'update'], ediel_messages: ['insert'],
  ediel_business_references: ['upsert'], ediel_message_events: ['insert'],
}

class FiniteBoundary {
  readonly own: Namespace
  readonly sibling: Namespace
  readonly rows: Record<string, Row[]> = {}
  readonly trace: Trace[] = []
  readonly stages: string[] = []
  readonly unexpectedPorts: string[] = []
  readonly pack: Row
  readonly witness: Row
  readonly registry: Row
  readonly routeContext: Row
  methodSource: Row
  brpSource: Row
  witnessRaw: string | null = null
  originalBindInput: Row | null = null
  beforeBusiness: Record<string, Row[]> = {}
  beforeSibling: Record<string, Row[]> = {}
  beforeOutbound: Row[] = []

  constructor(readonly profile: Profile) {
    const base = profile.variant === 'L' ? 3000 : 4000
    this.own = namespaces(base, `Z03${profile.variant}`)
    this.sibling = namespaces(base + 100, `Z03${profile.variant}-SIBLING`)
    const n = this.own, s = this.sibling
    for (const table of new Set([...readTables, ...Object.keys(writeOperations)])) this.rows[table] = []
    this.rows.companies = [{ id: n.company, status: 'active' }, { id: s.company, status: 'active' }]
    this.rows.company_memberships = [{ company_id: n.company, user_id: n.actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }]
    this.rows.user_profiles = [{ id: n.actor, user_status: 'active' }]
    this.addBusiness(n, profile, facility, '2027-06-15', 7654321)
    this.addBusiness(s, { variant: 'L', reason: 'Z22', requestType: 'switch' }, '735987654321098765', '2027-07-03', 9876543)
    this.rows.grid_owners = [{ id: n.grid, company_id: n.company, platform_market_actor_id: n.registryActor,
      name: 'Synthetic network', owner_code: n.gridArea, ediel_id: '54321', is_active: true }]
    this.rows.outbound_requests = [n, s].map(ns => ({ id: ns.outbound, company_id: ns.company,
      customer_id: ns.customer, site_id: ns.site, metering_point_id: ns.point, grid_owner_id: ns.grid,
      source_type: 'supplier_switch_request', source_id: ns.switch, request_type: 'supplier_switch', operation_id: ns.switch,
      communication_route_id: ns.route, ediel_route_profile_id: ns.profile, external_reference: ns.external,
      status: 'prepared', attempts_count: 0, payload: { environment: 'test' }, response_payload: {}, created_at: clock }))
    this.rows.ediel_messages = [{ id: s.message, company_id: s.company, environment: 'test', direction: 'outbound',
      message_family: 'PRODAT', message_code: 'Z03', customer_id: s.customer, site_id: s.site,
      outbound_request_id: s.outbound, switch_request_id: s.switch, source_operation_id: s.switch, intent_id: s.intent,
      transaction_reference: 'SIBLING-ORIGINAL-LI', raw_payload: "UNB+UNOC:3+12345+54321+270703:0000+27070300000002'UNH+2+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+SIBLING-ORIGINAL-DOC+9'LIN+1++735987654321098765:::9'RFF+LI:SIBLING-ORIGINAL-LI'UNT+5+2'UNZ+1+27070300000002'" }]
    const commonSource = { status: 'authorized', companyId: n.company, environment: 'test', contractId: n.contract,
      customerId: n.customer, siteId: n.site, meteringPointId: n.point, pointId: facility, identityAgency: '9',
      legalActorId: n.legalActor, legalSenderId: '23456', legalReceiverId: '67890', gridArea: n.gridArea }
    this.methodSource = { ...commonSource, declarationId: n.methodDeclaration, contractRevision: `${n.label}-signed-v1`,
      protectedContractHash: 'b'.repeat(64), agreementSha256: 'c'.repeat(64), requestedMethod: 'Z04',
      sourceReference: `${n.label}-SIGNED-METHOD`, sourceVersion: 'v1', sourceDigest: 'd'.repeat(64) }
    this.brpSource = { ...commonSource, sourceKind: 'signed_contract_brp_declaration', declarationId: n.brpDeclaration,
      at: startAt, supplyPeriodId: null, brpEdielId: '11111' }
    this.registry = { status: 'source_qualified', routeId: n.registryRoute, actorId: n.registryActor,
      market: 'EL', sourceSha256: 'e'.repeat(64), sourceRecordSha256: 'f'.repeat(64), countryCode: 'SE',
      legalEdielId: '67890', legalName: 'Synthetic DSO', roles: ['grid_owner'],
      wire: { actorId: n.registryActor, market: 'EL', family: 'PRODAT', environment: 'test', subaddress: null,
        applicationReference: '23-DDQ-PRODAT', address: 'network@example.invalid', transport: 'smtp', partyId: '67890', interchangePartyId: '54321' } }
    const databaseProfileKey = `PRODAT:Z03:${profile.variant}:26.A:r3`
    const packProfile = { guideVersion: '26.A', guideRevision: '3', family: 'PRODAT', messageCode: 'Z03',
      transactionSubtype: profile.variant, canonicalDirection: 'outbound', reasonForTransaction: profile.reason }
    const originalSnapshot = { rulePack: { id: n.pack, source_hash: hash, guide_version: '26.A', guide_revision: '3' },
      messageProfile: { id: n.packProfile, rule_pack_id: n.pack, profile_key: databaseProfileKey, profile: packProfile }, guideSources: [] }
    this.pack = { rule_pack_id: n.pack, message_profile_id: n.packProfile, market: 'electricity', family: 'PRODAT',
      guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A', valid_from: '2026-04-01', valid_to: null,
      source_document: 'Synthetic staged Z03 activation IO', source_hash: hash, field_matrix_version: '26A-r3',
      profile_key: databaseProfileKey, business_process: 'supplier_switch', phase: null, profile: packProfile,
      parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
      original_version: '26.A:r3', original_snapshot: originalSnapshot }
    // Fixed independent evidence; never echo the requested witness/evidence as a reply.
    this.witness = { version: 1, witnessId: n.witness, evidence: { rulePackId: n.pack, messageProfileId: n.packProfile,
      profileKey: databaseProfileKey, version: '26.A:r3', sourceHash: hash,
      snapshot: { ...originalSnapshot, profileKey: databaseProfileKey, profileVersionId: n.packProfile, version: '26.A:r3', checksum: hash } } }
    this.routeContext = { companyId: n.company, environment: 'test', messageStandard: 'edifact', route: { id: n.route },
      routeRuntime: { route_profile_id: n.profile }, senderEdielId: '12345', receiverEdielId: '54321',
      senderSubAddress: null, receiverSubAddress: null, senderName: 'Synthetic transport', receiverName: 'Synthetic DSO',
      receiverEmail: 'network@example.invalid', mailbox: 'synthetic', applicationReference: '23-DDQ-PRODAT',
      defaultMessageVersion: 'E2SE6A', routeDecisionReason: 'finite current routing IO',
      actor: { senderEdielId: '12345', legalActorEdielId: '23456', testFlag: 1,
        tenantIdentity: { companyId: n.company, environment: 'test', legalEdielId: '23456', transportEdielId: '12345' } } }
    this.snapshot()
  }

  addBusiness(ns: Namespace, profile: Profile, pointId: string, day: string, annual: number) {
    const scope = { company_id: ns.company, customer_id: ns.customer }
    this.rows.customers.push({ ...scope, id: ns.customer, name: 'MUTABLE FALLBACK', org_number: customerIdentity,
      street: 'Fallback street', postal_code: '99999', city: 'Fallback city', country: 'SE', activated_at: null,
      current_supplier_id: ns.supplier, source_version: 7 })
    this.rows.customer_contacts.push({ ...scope, id: id(Number(ns.customer.slice(-12)) + 70), is_primary: true, created_at: clock })
    this.rows.customer_sites.push({ ...scope, id: ns.site, facility_id: pointId, normalized_facility_id: pointId,
      grid_owner_id: ns.grid, grid_area_code: ns.gridArea, current_supplier_id: ns.supplier, current_supplier_unknown: false,
      annual_consumption_kwh: annual, move_in_date: '2027-07-03', street: `${ns.label} installation`, postal_code: '12345', city: 'Installation City', country: 'SE' })
    this.rows.metering_points.push({ ...scope, id: ns.point, site_id: ns.site, customer_site_id: ns.site,
      ediel_reference: pointId, ediel_metering_point_id: pointId, meter_point_id: pointId,
      grid_area_code: ns.gridArea, grid_owner_id: ns.grid, status: 'active', annual_consumption_kwh: annual + 1, source_version: 9 })
    this.rows.customer_contracts.push({ ...scope, id: ns.contract, customer_site_id: ns.site, site_id: ns.site,
      status: 'signed', signed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
      requested_start_date: day, starts_at: `${day}T00:00:00Z`, version: 1, signature_status: 'signed',
      protected_contract_hash: 'b'.repeat(64), agreement_sha256: 'c'.repeat(64) })
    this.rows.customer_contract_lifecycle_readiness_v.push({ ...scope, customer_site_id: ns.site, customer_contract_id: ns.contract,
      agreement_ready: true, agreement_signed: true, active: false, lifecycle_stage: 'signed', blockers: [] })
    this.rows.powers_of_attorney.push({ ...scope, id: ns.poa, customer_site_id: ns.site, site_id: ns.site,
      customer_contract_id: ns.contract, status: 'signed', signed_at: clock, valid_from: '2026-01-01', valid_to: null,
      revoked_at: null, document_id: ns.authorization, signed_scope_snapshot: { supplier_switch: true } })
    this.rows.customer_authorization_documents.push({ ...scope, id: ns.authorization, site_id: ns.site,
      power_of_attorney_id: ns.poa, customer_contract_id: ns.contract, status: 'active' })
    this.rows.authorization_scopes.push({ ...scope, id: ns.scope, authorization_document_id: ns.authorization,
      status: 'active', revoked_at: null, valid_from: '2026-01-01', valid_to: null, covers_current_supplier_contract: true })
    const invoicee = selectedInvoiceeFact(pointId, ns.company, '9', customerIdentity,
      ['Source street', 'Unit 2'], 'SE1', '54321', 'Source City', 'SE')
    this.rows.supplier_switch_requests.push({ ...scope, id: ns.switch, site_id: ns.site, customer_site_id: ns.site,
      metering_point_id: ns.point, grid_owner_id: ns.grid, customer_contract_id: ns.contract, contract_id: ns.contract,
      power_of_attorney_id: ns.poa, authorization_document_id: ns.authorization, request_type: profile.requestType,
      prodat_variant: profile.variant, prodat_reason: profile.reason, requested_start_date: day, external_reference: ns.external,
      status: 'draft', lifecycle_blocked: false, confirmed_start_date: null, outbound_z03_message_id: null,
      inbound_z04_message_id: null, source_version: 11,
      validation_snapshot: { portalData: { reasonForTransaction: profile.reason, powerOfAttorneyReference: `${ns.label}-POA`,
        customerId: 'STALE-PREVIEW-IDENTITY', customerName: 'STALE-PREVIEW-NAME', customerAddress: 'STALE-PREVIEW-STREET',
        facilityId: '735999999999999999', meteringMethod: 'Z03', balanceResponsibleId: '22222', agreementStartDateTime: '202707030000',
        testCaseOverrides: { meteringMethod: 'Z03', balanceResponsibleId: '22222', agreementStartDateTime: '202707030000' },
        registers: [], dependentConditionFacts: { market: 'electricity', invoiceeObjects: [invoicee] } } } })
    this.rows.customer_supply_periods.push({ ...scope, id: ns.supply, customer_contract_id: ns.contract, metering_point_id: ns.point,
      status: 'draft', start_date: '2031-01-01', actual_start_date: null, market_start_at: null, market_state_version: 17,
      source_message_id: null, activated_at: null })
  }

  snapshot() {
    this.beforeBusiness = Object.fromEntries(businessTables.map(table => [table, copy(this.rows[table])]))
    this.beforeSibling = Object.fromEntries(Object.entries(this.rows).map(([table, rows]) => [table,
      copy(rows.filter(row => row.company_id === this.sibling.company || row.id === this.sibling.company))]))
    this.beforeOutbound = copy(this.rows.outbound_requests)
  }
  deny(port: string): never { this.unexpectedPorts.push(port); throw new Error(`unexpected_finite_port:${port}`) }
  from(table: string) {
    if (!readTables.has(table) && !writeOperations[table]) this.deny(`table:${table}`)
    return new FiniteQuery(this, table)
  }
  async rpc(name: string, args: Row) {
    const n = this.own
    this.stages.push(name)
    switch (name) {
      case 'gridex_assert_supplier_switch_ready':
        expect(args).toEqual({ p_company_id: n.company, p_contract_id: n.contract })
        return { data: { ready: true }, error: null }
      case 'gridex_actor_has_company_permission':
        expect(Object.keys(args).sort()).toEqual(['p_actor_user_id', 'p_company_id', 'p_permission'])
        expect(args).toMatchObject({ p_actor_user_id: n.actor, p_company_id: n.company })
        if (!['communication.write', 'ediel_testing.write'].includes(String(args.p_permission))) this.deny(`permission:${String(args.p_permission)}`)
        return { data: true, error: null }
      case 'ediel_customer_life_event_export_at_v1':
        expect(args).toEqual({ p_company_id: n.company, p_customer_id: n.customer, p_actor_user_id: n.actor, p_as_of: startAt })
        return { data: { status: 'not_applicable' }, error: null }
      case 'ediel_prepare_customer_masterdata_v1':
        expect(args).toEqual({ p_company_id: n.company, p_customer_id: n.customer, p_actor_user_id: n.actor, p_as_of: startAt, p_environment: 'test' })
        return { data: { status: 'authorized', companyId: n.company, customerId: n.customer, environment: 'test', asOf: startAt,
          sourceKind: 'registered_customer_address', sourceReference: `${n.label}-QUALIFIED-ADDRESS`, sourceDigest: 'd'.repeat(64), sourceContextId: n.source,
          customerIdentity: { id: customerIdentity, qualifier: 'SE1', agency: '260' },
          endUserMasterdata: { nameParts: [`${n.label} Qualified`, 'Second'], streetParts: ['Source street', 'Unit 2'], postalCode: '54321', city: 'Source City', country: 'SE' } }, error: null }
      case 'ediel_contract_metering_request_source_v1':
        expect(args).toEqual({ p_company_id: n.company, p_contract_id: n.contract, p_actor_user_id: n.actor, p_environment: 'test' })
        return { data: copy(this.methodSource), error: null }
      case 'ediel_brp_field_source_v1':
        expect(args).toEqual({ p_company_id: n.company, p_contract_id: n.contract, p_actor_user_id: n.actor, p_environment: 'test',
          p_customer_id: n.customer, p_site_id: n.site, p_point_id: n.point, p_at: startAt, p_period_id: null })
        return { data: copy(this.brpSource), error: null }
      case 'resolve_canonical_ediel_rule_pack_with_witness_v1':
        expect(args).toEqual({ p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z03',
          p_transaction_subtype: this.profile.variant, p_direction: 'outbound', p_business_date: '2026-10-05' })
        return { data: [copy(this.pack)], error: null }
      case 'ediel_registry_route_source_v1':
        expect(args).toEqual({ p_route_id: n.registryRoute })
        return { data: copy(this.registry), error: null }
      case 'ediel_registry_dispatch_source_v1':
        expect(args).toEqual({ p_company_id: n.company, p_communication_route_id: n.route, p_route_profile_id: n.profile,
          p_environment: 'test', p_message_family: 'PRODAT', p_application_reference: '23-DDQ-PRODAT' })
        return { data: { ...copy(this.registry), companyId: n.company, communicationRouteId: n.route, routeProfileId: n.profile,
          selectedApplicationReference: '23-DDQ-PRODAT' }, error: null }
      case 'ediel_prepare_outbound_owner_witness_v1': {
        expect(Object.keys(args)).toEqual(['p_input'])
        const input = object(args.p_input)
        expect(Object.keys(input).sort()).toEqual(['actorUserId', 'companyId', 'environment', 'rawPayload', 'rulePackEvidence'])
        expect(input).toMatchObject({ companyId: n.company, actorUserId: n.actor, environment: 'test' })
        expect(input.rulePackEvidence).toEqual(this.witness.evidence)
        this.assertPhysical(String(input.rawPayload))
        this.witnessRaw = String(input.rawPayload)
        return { data: copy(this.witness), error: null }
      }
      case 'ediel_bind_switch_original_v1': {
        expect(args).toEqual({ p_company_id: n.company, p_switch_id: n.switch, p_message_id: n.message, p_actor_user_id: n.actor })
        const stored = this.rows.ediel_messages.find(row => row.id === n.message)!
        const intent = this.rows.ediel_message_intents.find(row => row.id === n.intent)!
        expect(stored).toMatchObject({ company_id: n.company, intent_id: n.intent, outbound_request_id: n.outbound,
          switch_request_id: n.switch, source_operation_id: n.switch, status: 'draft', customer_id: n.customer, site_id: n.site, metering_point_id: n.point })
        expect(intent).toMatchObject({ company_id: n.company, supplier_switch_request_id: n.switch, operation_id: n.switch,
          validation_status: 'validated', render_status: 'rendered', outbox_status: 'not_queued', ediel_message_id: n.message, outbound_request_id: n.outbound })
        expect(this.witnessRaw).not.toBeNull()
        expect(stored.raw_payload).toBe(this.witnessRaw)
        expect(digest(String(stored.raw_payload))).toBe(digest(this.witnessRaw!))
        this.assertPhysical(String(stored.raw_payload))
        expect(this.stages.indexOf('ediel_prepare_customer_masterdata_v1')).toBeLessThan(this.stages.indexOf('ediel_contract_metering_request_source_v1'))
        expect(this.stages.indexOf('ediel_contract_metering_request_source_v1')).toBeLessThan(this.stages.indexOf('ediel_brp_field_source_v1'))
        expect(this.stages.indexOf('ediel_brp_field_source_v1')).toBeLessThan(this.stages.indexOf('ediel_prepare_outbound_owner_witness_v1'))
        expect(this.stages.indexOf('ediel_prepare_outbound_owner_witness_v1')).toBeLessThan(this.stages.indexOf('insert:ediel_messages'))
        expect(this.stages.indexOf('insert:ediel_messages')).toBeLessThan(this.stages.indexOf('rendered:ediel_message_intents'))
        expect(this.stages.indexOf('rendered:ediel_message_intents')).toBeLessThan(this.stages.indexOf(name))
        this.originalBindInput = copy(args)
        // Deliberately fixed scoped HOLD. No private native issuer/source grant.
        return { data: { status: 'held' }, error: null }
      }
      default: return this.deny(`rpc:${name}`)
    }
  }

  assertPhysical(raw: string) {
    const n = this.own, intent = this.rows.ediel_message_intents.find(row => row.id === n.intent)!
    const segments = tokenizeEdifact(raw).segments.map(segment => segment.raw)
    const unb = segments.find(segment => segment.startsWith('UNB+'))!.split('+')
    expect(unb[2]).toBe('12345:ZZ'); expect(unb[3]).toBe('54321:ZZ')
    expect(unb[5]).toBe(intent.interchange_reference); expect(unb[7]).toBe('23-DDQ-PRODAT')
    expect(unb[9]).toBe('1'); expect(unb[11]).toBe('1')
    expect(segments).toContain(`UNH+${String(intent.message_reference)}+PRODAT:D:97A:UN:E2SE6A`)
    expect(segments).toContain(`BGM+Z03+${String(object(intent.payload).documentReference)}+9+AB`)
    expect(segments).toContain('DTM+ZZZ:1:805')
    const lines = segments.flatMap((segment, index) => segment.startsWith('LIN+') ? [index] : [])
    expect(lines).toHaveLength(1)
    const ownLine = segments.slice(lines[0], segments.findIndex(segment => segment.startsWith('UNT+')))
    expect(ownLine[0]).toBe(`LIN+1++${facility}:::9`)
    expect(ownLine.filter(segment => segment.startsWith('DTM+92:'))).toEqual(['DTM+92:202706150000:203'])
    expect(prodatMarketMinuteToUtc('202706150000')).toBe(startAt)
    expect(ownLine.slice(ownLine.indexOf('CCI++Z13'), ownLine.indexOf('CCI++Z13') + 2)).toEqual(['CCI++Z13', `CAV+${this.profile.reason}`])
    expect(ownLine.slice(ownLine.indexOf('CCI++Z04'), ownLine.indexOf('CCI++Z04') + 2)).toEqual(['CCI++Z04', 'CAV+Z04'])
    expect(ownLine).toContain(`RFF+LI:${String(intent.transaction_reference)}`)
    expect(ownLine).toContain(`RFF+Z05:${n.gridArea}`)
    expect(ownLine).toContain(`RFF+ANJ:${n.label}-POA`)
    expect(segments).toContain('NAD+FR+23456:160:SVK+++++++SE')
    expect(segments).toContain('NAD+DO+67890:160:SVK+++++++SE')
    const ud = ownLine.find(segment => segment.startsWith('NAD+UD+'))!
    expect(ud).toBe(`NAD+UD+${customerIdentity}:SE1:260++${n.label} Qualified:Second+Source street:Unit 2+Source City++54321+SE`)
    const it = ownLine.find(segment => segment.startsWith('NAD+IT+'))!
    expect(it).toBe(`NAD+IT+${facility}::9+++${n.label} installation+Installation City++12345+SE`)
    expect(ownLine).toContain('NAD+Z02+11111:160:SVK')
    // This fixture has no selected annual basis. QTY31 is OPTIONAL for Z03;
    // absence here cannot be generalized into the Z01 prohibition.
    expect(ownLine.filter(segment => segment.startsWith('QTY+31:'))).toEqual([])
    // Independently equal invoicee/end-user identity and postal tuple makes IV
    // inapplicable for this row. It is not omission inferred from rendered wire.
    expect(ownLine.some(segment => segment.startsWith('NAD+IV+'))).toBe(false)
    for (const stale of ['STALE-PREVIEW', 'MUTABLE FALLBACK', 'Fallback street', '735999999999999999',
      '735987654321098765', 'SIBLING-ORIGINAL', '202707030000', '9876543', '7654321']) expect(raw).not.toContain(stale)
    expect(intent).toMatchObject({ operation_id: n.switch, customer_id: n.customer, customer_site_id: n.site,
      facility_id: facility, metering_point_id: facility, requested_effective_date: '2027-06-15',
      payload: { transactionSubtype: this.profile.variant, reasonForTransaction: this.profile.reason, actorRole: 'supplier' } })
    expect(intent.transaction_reference).toEqual(expect.any(String))
    expect(String(intent.transaction_reference).length).toBeGreaterThan(0)
    expect(intent.transaction_reference).not.toBe(this.sibling.external)
    expect(this.rows.customers[0].org_number).toBe(customerIdentity)
    expect(this.rows.metering_points[0].ediel_metering_point_id).toBe(facility)
    expect(this.methodSource).toMatchObject({ pointId: facility, requestedMethod: 'Z04', legalSenderId: '23456', legalReceiverId: '67890', gridArea: n.gridArea })
    expect(this.brpSource).toMatchObject({ pointId: facility, brpEdielId: '11111', at: startAt, supplyPeriodId: null,
      legalActorId: n.legalActor, legalSenderId: '23456', legalReceiverId: '67890', gridArea: n.gridArea })
  }

  assertNonEffects() {
    expect(Object.fromEntries(businessTables.map(table => [table, this.rows[table]]))).toEqual(this.beforeBusiness)
    expect(Object.fromEntries(Object.entries(this.rows).map(([table, rows]) => [table,
      rows.filter(row => row.company_id === this.sibling.company || row.id === this.sibling.company)]))).toEqual(this.beforeSibling)
    expect(this.rows.outbound_requests).toEqual(this.beforeOutbound)
    expect(this.unexpectedPorts).toEqual([])
    expect(this.trace.filter(call => businessTables.includes(call.table as typeof businessTables[number]) && call.operation !== 'select')).toEqual([])
    expect(this.trace.filter(call => ['ediel_outbox', 'outbound_dispatch_events', 'supplier_switch_events'].includes(call.table))).toEqual([])
    expect(this.rows.ediel_message_events.every(row => row.event_type === 'created')).toBe(true)
    expect(this.rows.ediel_messages.filter(row => row.id === this.own.message).every(row => row.status === 'draft' && row.processing_status === 'draft')).toBe(true)
  }
}

// Only the actual finite selectors below are executable: no arbitrary database
// simulator, schema/trigger imitation, queue port or implicit success row.
class FiniteQuery {
  operation: Operation = 'select'
  filters: Filter[] = []
  orders: Order[] = []
  maximum: number | null = null
  columns = '*'
  values: Row[] = []
  options: Row = {}
  constructor(readonly boundary: FiniteBoundary, readonly table: string) {}
  select(columns = '*') { this.columns = columns.split(',').map(column => column.trim()).join(','); return this }
  eq(column: string, value: unknown) { this.filters.push({ kind: 'eq', column, value }); return this }
  in(column: string, value: unknown[]) { this.filters.push({ kind: 'in', column, value }); return this }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) this.boundary.deny(`not:${column}:${operator}`)
    this.filters.push({ kind: 'notNull', column, value }); return this
  }
  order(column: string, options: Row = {}) {
    const ascending = options.ascending !== false
    this.orders.push({ column, ascending, nullsFirst: Boolean(options.nullsFirst ?? !ascending) }); return this
  }
  limit(maximum: number) { this.maximum = maximum; return this }
  insert(value: Row | Row[]) { this.operation = 'insert'; this.values = copy(Array.isArray(value) ? value : [value]); return this }
  upsert(value: Row | Row[], options: Row = {}) { this.operation = 'upsert'; this.values = copy(Array.isArray(value) ? value : [value]); this.options = options; return this }
  update(value: Row) { this.operation = 'update'; this.values = [copy(value)]; return this }

  assertSelector() {
    const n = this.boundary.own, p = this.boundary.profile
    const eq = (column: string, value: unknown): Filter => ({ kind: 'eq', column, value })
    const inside = (column: string, value: unknown[]): Filter => ({ kind: 'in', column, value })
    const descending = (column: string): Order => ({ column, ascending: false, nullsFirst: true })
    type Selector = { columns: string; filters: Filter[]; orders: Order[]; limit: number | null }
    const shape = (filters: Filter[], orders: Order[] = [], limit: number | null = null, columns = '*'): Selector => ({ columns, filters, orders, limit })
    const selectors: Record<string, Selector[]> = {
      supplier_switch_requests: [shape([eq('id', n.switch)])],
      grid_owners: [shape([eq('id', n.grid)])],
      customer_sites: [shape([eq('id', n.site)]), shape([eq('id', n.site), eq('company_id', n.company)])],
      metering_points: [shape([eq('id', n.point)]), shape([eq('id', n.point), eq('company_id', n.company)])],
      customers: [shape([eq('id', n.customer), eq('company_id', n.company)])],
      customer_contacts: [shape([eq('customer_id', n.customer), eq('company_id', n.company)], [descending('is_primary'), descending('created_at')], 20)],
      customer_contracts: [shape([eq('customer_id', n.customer), eq('site_id', n.site), eq('company_id', n.company)], [descending('created_at')], 1)],
      company_memberships: [shape([eq('company_id', n.company), eq('user_id', n.actor), eq('status', 'active'), eq('is_active', true),
        { kind: 'notNull', column: 'accepted_at', value: null }], [], null, 'company_id,user_id,status,is_active,accepted_at')],
      user_profiles: [shape([eq('id', n.actor), eq('user_status', 'active')], [], null, 'id,user_status')],
      outbound_requests: [
        shape([eq('source_type', 'supplier_switch_request'), eq('source_id', n.switch), eq('request_type', 'supplier_switch'),
          inside('status', ['queued', 'prepared', 'sent', 'acknowledged'])], [descending('created_at')], 1),
        shape([eq('company_id', n.company), eq('id', n.outbound)], [], 1),
      ],
      ediel_message_intents: [shape([eq('company_id', n.company), eq('environment', 'test'),
        eq('idempotency_key', `prodat-Z03:${p.variant}:${n.switch}:${n.external}`)]), shape([eq('id', n.intent)])],
      ediel_messages: [shape([eq('id', n.message)]), shape([eq('company_id', n.company), eq('environment', 'test'),
        eq('direction', 'outbound'), eq('message_family', 'PRODAT'), eq('message_code', 'Z03'),
        eq('source_operation_id', n.switch), eq('receiver_ediel_id', '54321'), inside('outbound_request_id', [n.outbound])], [descending('created_at')], 20)],
    }
    const actual = shape(this.filters, this.orders, this.maximum, this.columns)
    if (!selectors[this.table]?.some(selector => JSON.stringify(selector) === JSON.stringify(actual))) this.boundary.deny(`selector:${this.table}:${JSON.stringify(actual)}`)
  }

  assertWrite() {
    const b = this.boundary, n = b.own
    if (!writeOperations[this.table]?.includes(this.operation)) b.deny(`${this.operation}:${this.table}`)
    expect(this.orders).toEqual([]); expect(this.maximum).toBeNull()
    if (this.operation === 'update') {
      expect(this.table).toBe('ediel_message_intents')
      expect(this.filters).toEqual([{ kind: 'eq', column: 'id', value: n.intent }])
      expect(this.columns).toBe('*')
      expect(this.values).toEqual([{ updated_at: clock, render_status: 'rendered', ediel_message_id: n.message,
        outbound_request_id: n.outbound, updated_by: n.actor }])
      return
    }
    expect(this.filters).toEqual([])
    if (this.table === 'ediel_message_intents') {
      expect(this.options).toEqual({ onConflict: 'company_id,environment,idempotency_key' })
      expect(this.values).toHaveLength(1)
      expect(this.values[0]).toMatchObject({ company_id: n.company, customer_id: n.customer, customer_site_id: n.site,
        operation_id: n.switch, supplier_switch_request_id: n.switch, message_family: 'PRODAT', message_code: 'Z03',
        direction: 'outbound', validation_status: 'validated', render_status: 'not_rendered', outbox_status: 'not_queued' })
    } else if (this.table === 'ediel_messages') {
      expect(this.options).toEqual({})
      expect(this.values).toHaveLength(1)
      expect(this.values[0]).toMatchObject({ company_id: n.company, customer_id: n.customer, site_id: n.site,
        direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', intent_id: n.intent,
        outbound_request_id: n.outbound, switch_request_id: n.switch, source_operation_id: n.switch, status: 'draft' })
      expect(this.values[0].raw_payload).toBe(b.witnessRaw)
    } else if (this.table === 'ediel_business_references') {
      expect(this.options).toEqual({ onConflict: 'company_id,reference_type,reference_value,business_object_type,business_object_id', ignoreDuplicates: true })
      expect(this.values.length).toBeGreaterThan(0)
      for (const value of this.values) expect(value).toMatchObject({ company_id: n.company, source_message_id: n.message,
        customer_id: n.customer, customer_site_id: n.site, metering_point_id: n.point,
        business_object_type: 'supplier_switch_request', business_object_id: n.switch, message_code: 'Z03' })
    } else if (this.table === 'ediel_message_events') {
      expect(this.options).toEqual({})
      expect(this.values).toHaveLength(1)
      expect(this.values[0]).toMatchObject({ company_id: n.company, ediel_message_id: n.message, message_id: n.message,
        event_type: 'created', event_status: 'info', created_by: n.actor })
    }
  }

  async execute(single = false, optional = false): Promise<{ data: Row | Row[] | null; error: null }> {
    const b = this.boundary, n = b.own
    if (this.operation === 'select') this.assertSelector()
    else this.assertWrite()
    let selected = b.rows[this.table].filter(row => this.filters.every(filter =>
      filter.kind === 'eq' ? row[filter.column] === filter.value : filter.kind === 'notNull'
        ? row[filter.column] != null : (filter.value as unknown[]).includes(row[filter.column])))
    if (this.operation === 'update') {
      if (selected.length !== 1 || selected[0].company_id !== n.company) b.deny('intent_update_scope')
      Object.assign(selected[0], copy(this.values[0])); b.stages.push('rendered:ediel_message_intents')
    } else if (this.operation !== 'select') {
      selected = this.values.map((value, index) => {
        const row = { created_at: clock, ...copy(value), id: this.table === 'ediel_message_intents' ? n.intent
          : this.table === 'ediel_messages' ? n.message : id(8000 + b.trace.length * 10 + index) }
        if (b.rows[this.table].some(existing => existing.id === row.id)) b.deny(`duplicate_insert:${this.table}`)
        b.rows[this.table].push(row); return row
      })
      b.stages.push(`${this.operation}:${this.table}`)
    }
    selected = [...selected].sort((left, right) => {
      for (const order of this.orders) {
        const a = left[order.column], c = right[order.column]
        if (a === c) continue
        if (a == null || c == null) return a == null ? (order.nullsFirst ? -1 : 1) : (order.nullsFirst ? 1 : -1)
        const comparison = String(a).localeCompare(String(c))
        if (comparison) return order.ascending ? comparison : -comparison
      }
      return 0
    })
    if (this.maximum !== null) selected = selected.slice(0, this.maximum)
    if (this.columns !== '*') selected = selected.map(row => Object.fromEntries(this.columns.split(',').map(column => [column, row[column] ?? null])))
    b.trace.push({ table: this.table, operation: this.operation, columns: this.columns, filters: copy(this.filters),
      orders: copy(this.orders), limit: this.maximum, values: copy(this.values), rows: copy(selected) })
    if (single && (selected.length > 1 || (!optional && selected.length !== 1))) b.deny(`cardinality:${this.table}`)
    // Copy is essential: a later persisted update must not mutate an earlier
    // returned message/intent object and change actual gateway control flow.
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
    expect(input).toEqual({ companyId: n.company, environment: 'test', preferredRouteId: n.route,
      requestType: 'supplier_switch', messageStandard: 'edifact', gridOwner: boundary.rows.grid_owners[0] })
    return copy(boundary.routeContext)
  })
  ports.route.mockImplementation(async input => {
    expect(input).toEqual({ companyId: n.company, actorUserId: n.actor, environment: 'test',
      customerId: n.customer, siteId: n.site, meteringPointId: n.point, supplierSwitchRequestId: n.switch,
      businessProcess: 'supplier_switch', messageFamily: 'PRODAT', messageCode: 'Z03', preferredRouteId: n.route,
      gridOwnerId: n.grid, dataRequestId: null, outboundRequestId: null, inboundMessageId: null,
      payload: { requestType: profile.requestType, cancellation_requested: false, move_in: profile.variant === 'LK',
        actorRole: 'supplier', transactionSubtype: profile.variant, reasonForTransaction: profile.reason,
        canonicalRulePackId: n.pack, canonicalProfileId: n.packProfile } })
    return { decisionStatus: 'ready', communicationRouteId: n.route, edielRouteProfileId: n.profile,
      senderEdielId: '12345', receiverEdielId: '54321', senderSubAddress: null, receiverSubAddress: null,
      applicationReference: '23-DDQ-PRODAT', messageVersion: 'OBSOLETE-ROUTE-VERSION', blockingReasons: [],
      requiredAdminActions: [], receiverSource: 'finite immutable registry', payload: {} }
  })
}
function run() {
  const n = boundary.own
  return prepareAndQueueEdielZ03({ actorUserId: n.actor, switchRequestId: n.switch, communicationRouteId: n.route, environment: 'test' })
}
function assertEarlyRefusal(brpReached: boolean) {
  const n = boundary.own
  expect(boundary.rows.ediel_message_intents).toHaveLength(1)
  expect(boundary.rows.ediel_message_intents[0]).toMatchObject({ id: n.intent, operation_id: n.switch,
    validation_status: 'validated', render_status: 'not_rendered', outbox_status: 'not_queued' })
  expect(boundary.stages).toContain('ediel_contract_metering_request_source_v1')
  expect(boundary.stages.includes('ediel_brp_field_source_v1')).toBe(brpReached)
  expect(boundary.stages.at(-1)).toBe(brpReached ? 'ediel_brp_field_source_v1' : 'ediel_contract_metering_request_source_v1')
  expect(boundary.rows.ediel_messages).toHaveLength(1) // retained sibling only
  expect(boundary.trace.filter(call => call.operation !== 'select').map(call => `${call.operation}:${call.table}`)).toEqual(['upsert:ediel_message_intents'])
  for (const name of ['ediel_prepare_outbound_owner_witness_v1', 'ediel_bind_switch_original_v1']) expect(boundary.stages).not.toContain(name)
  expect(boundary.witnessRaw).toBeNull(); expect(boundary.originalBindInput).toBeNull()
  boundary.assertNonEffects()
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(clock)) })
afterEach(() => { vi.useRealTimers() })

describe.each(profiles)('ordinary supplier Z03$variant staged finite consumer', profile => {
  it('persists its own rendered original, then propagates the restricted original-bind HOLD before queue', async () => {
    setup(profile)
    await expect(run()).rejects.toThrow('switch_original_native_binding_required')
    const n = boundary.own
    const insert = boundary.trace.filter(call => call.table === 'ediel_messages' && call.operation === 'insert')
    expect(insert).toHaveLength(1)
    const stored = boundary.rows.ediel_messages.find(row => row.id === n.message)!
    boundary.assertPhysical(String(stored.raw_payload))
    expect(insert[0].values[0].raw_payload).toBe(stored.raw_payload)
    expect(stored.raw_payload).toBe(boundary.witnessRaw)
    expect(stored).toMatchObject({ id: n.message, company_id: n.company, environment: 'test', message_code: 'Z03',
      message_version: '26A', intent_id: n.intent, outbound_request_id: n.outbound, switch_request_id: n.switch,
      source_operation_id: n.switch, status: 'draft', processing_status: 'draft', requires_contrl: true, requires_aperak: true,
      contrl_status: 'pending', aperak_status: 'pending', utilts_err_status: 'not_required', ack_due_at: '2026-10-05T10:30:00.000Z',
      parsed_payload: { customerMasterdataSourceContextId: n.source, prodatVariant: profile.variant, reasonForTransaction: profile.reason } })
    expect(boundary.rows.ediel_message_intents[0]).toMatchObject({ id: n.intent, ediel_message_id: n.message,
      render_status: 'rendered', outbox_status: 'not_queued', operation_id: n.switch })
    expect(boundary.originalBindInput).toEqual({ p_company_id: n.company, p_switch_id: n.switch, p_message_id: n.message, p_actor_user_id: n.actor })
    expect(boundary.stages.filter(stage => stage === 'ediel_bind_switch_original_v1')).toHaveLength(1)
    expect(boundary.rows.ediel_business_references.length).toBeGreaterThan(0)
    expect(boundary.rows.ediel_message_events).toHaveLength(1)
    expect(boundary.rows.ediel_message_events[0]).toMatchObject({ ediel_message_id: n.message, event_type: 'created' })
    expect(boundary.trace.filter(call => call.operation !== 'select').map(call => `${call.operation}:${call.table}`)).toEqual([
      'upsert:ediel_message_intents', 'insert:ediel_messages', 'upsert:ediel_business_references', 'insert:ediel_message_events', 'update:ediel_message_intents',
    ])
    boundary.assertNonEffects()
  })

  it('propagates held signed method source before rendering, witness, binding or queue', async () => {
    setup(profile)
    boundary.methodSource = { status: 'held', missing: ['unique_authentic_new_agreement_requested_method_declaration'] }
    await expect(run()).rejects.toThrow('prodat_new_agreement_requested_method_held:unique_authentic_new_agreement_requested_method_declaration')
    assertEarlyRefusal(false)
  })

  it('rejects an otherwise valid method DTO changing only the selected siteId', async () => {
    setup(profile)
    boundary.methodSource = { ...boundary.methodSource, siteId: boundary.sibling.site }
    await expect(run()).rejects.toThrow('contract_requested_method_selected_scope_mismatch')
    assertEarlyRefusal(false)
  })

  it('rejects otherwise valid BRP source changing only its legal receiver against the method source', async () => {
    setup(profile)
    boundary.brpSource = { ...boundary.brpSource, legalReceiverId: '78901' }
    await expect(run()).rejects.toThrow('prodat_new_agreement_brp_source_scope_mismatch')
    assertEarlyRefusal(true)
  })
})
