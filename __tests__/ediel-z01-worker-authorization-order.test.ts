import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'

// Worker ordering unit proof. Authority, CIR refusal and worker are real code;
// database, facility resolution and publication are declared ports, not native proof.
type Row = Record<string, unknown>
type Filter = { column: string; kind: 'eq' | 'neq' | 'is' | 'in'; value: unknown }
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; filters: Filter[]; action: string; patch: Row | null }>,
  createGodr: vi.fn(), prepare: vi.fn(), environment: vi.fn(), facility: vi.fn(), operational: vi.fn(), resolver: vi.fn(), operationEvent: vi.fn(), snapshot: vi.fn(), resume: vi.fn(), onScopeRead: null as null | (() => void),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc(name: string, input: {p_request: Row; p_company_id: string; p_actor_user_id: string}) {
      if (name !== 'gridex_create_customer_info_request_v1') throw new Error(`undeclared_rpc:${name}`)
      const row = { ...request(), ...input.p_request, id: ids.request }
      state.tables.customer_info_requests.push(row)
      return Promise.resolve({data: {created: true, request: structuredClone(row)}, error: null})
    },
    from(table: string) {
      if (!(table in state.tables)) throw new Error(`undeclared_database_port:${table}`)
      const filters: Filter[] = []
      const orders: Array<{ column: string; ascending: boolean }> = []
      const orFilters: Array<(row: Row) => boolean> = []
      let action = 'select', fields = '*', patch: Row | null = null, maximum = Infinity
      let inserted: Row[] = [], result: { data: Row[]; error: null } | null = null
      const matches = (row: Row) => filters.every(filter => {
        const actual = row[filter.column]
        if (filter.kind === 'eq') return actual === filter.value
        if (filter.kind === 'neq') return actual !== filter.value
        if (filter.kind === 'is') return filter.value === null ? actual === null : actual === filter.value
        return Array.isArray(filter.value) && filter.value.includes(actual)
      }) && orFilters.every(predicate => predicate(row))
      const execute = () => {
        if (result) return result
        if (table === 'authorization_scopes' && action === 'select') state.onScopeRead?.()
        state.queries.push({ table, filters: structuredClone(filters), action, patch: structuredClone(patch) })
        let selected: Row[]
        if (action === 'insert') {
          selected = inserted.map(row => structuredClone(row))
          state.tables[table].push(...selected)
        } else {
          selected = state.tables[table].filter(matches)
          for (const order of [...orders].reverse()) selected.sort((a, b) => {
            const compared = String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? ''))
            return order.ascending ? compared : -compared
          })
          selected = selected.slice(0, maximum)
          if (action === 'update') selected.forEach(row => Object.assign(row, structuredClone(patch)))
        }
        const projected = selected.map(row => fields === '*' ? structuredClone(row)
          : Object.fromEntries(fields.split(',').map(field => [field.trim(), structuredClone(row[field.trim()])])) )
        result = { data: projected, error: null }
        return result
      }
      const builder = {
        select(value = '*') { fields = value; return builder },
        eq(column: string, value: unknown) { filters.push({ column, kind: 'eq', value }); return builder },
        neq(column: string, value: unknown) { filters.push({ column, kind: 'neq', value }); return builder },
        is(column: string, value: unknown) { filters.push({ column, kind: 'is', value }); return builder },
        in(column: string, value: unknown[]) { filters.push({ column, kind: 'in', value }); return builder },
        or(value: string) {
          const alternatives = value.split(',').map(clause => {
            const match = /^(\w+)\.eq\.([\w-]+)$/.exec(clause)
            if (!match) throw new Error(`unsupported_database_port_or:${clause}`)
            return { column: match[1], value: match[2] }
          })
          orFilters.push(row => alternatives.some(item => row[item.column] === item.value))
          return builder
        },
        order(column: string, options?: { ascending?: boolean }) { orders.push({ column, ascending: options?.ascending !== false }); return builder },
        limit(value: number) { maximum = value; return builder },
        update(value: Row) { action = 'update'; patch = value; return builder },
        insert(value: Row | Row[]) { action = 'insert'; inserted = Array.isArray(value) ? value : [value]; return builder },
        maybeSingle() {
          const value = execute()
          if (value.data.length > 1) throw new Error(`database_port_multiple_rows:${table}`)
          return Promise.resolve({ data: value.data[0] ?? null, error: null })
        },
        single() {
          const value = execute()
          if (value.data.length !== 1) throw new Error(`database_port_single_row_required:${table}`)
          return Promise.resolve({ data: value.data[0], error: null })
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject)
        },
      }
      return builder
    },
  },
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: state.operational }))
vi.mock('@/lib/cis/db-data', () => ({ createGridOwnerDataRequest: state.createGodr }))
vi.mock('@/lib/ediel/flows/prodatCustomerMasterdata', () => ({ prepareAndQueueProdatZ01FromDataRequest: state.prepare }))
vi.mock('@/lib/ediel/customerInfoEnvironmentResolver', () => ({ resolveCustomerInfoOperationEnvironment: state.environment }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({ evaluateSiteFacilityIdentity: state.facility, resumeCustomerIntake: state.resume }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: vi.fn() }))
vi.mock('@/lib/ediel/services/manualPermission', () => ({ prepareManualServicePermission: vi.fn() }))

vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: state.operationEvent }))
vi.mock('@/lib/customer-operations/automation.part-1', () => ({
  automationActorId: (id: string) => id, resolveCustomerSiteGridOwner: state.resolver,
  setOperationSnapshotRequestReference: state.snapshot, missingSchema: () => false,
  customerDataResolutionReason: () => 'grid_area_not_verified',
}))
import { processCustomerDataRequest } from '@/lib/customer-operations/automation.part-2'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
import { resolveCurrentInfoRequestScopeAuthorization } from '@/lib/onboarding/infoRequestAuthorization'
import { checkCustomerInfoRequestAuthorization } from '@/lib/onboarding/infoRequests' 

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ids = { company: uuid(1), customer: uuid(2), site: uuid(3), point: uuid(4), request: uuid(5),
  actor: uuid(6), document: uuid(7), poa: uuid(8), scope: uuid(9), grid: uuid(10), operation: uuid(11),
  godr: uuid(12), outbound: uuid(13), message: uuid(14), profile: uuid(15), foreign: uuid(30) }
const now = '2026-10-06T15:00:00.000Z'
const request = (): CustomerInfoRequestRow => ({
  id: ids.request, company_id: ids.company, customer_id: ids.customer, site_id: ids.site,
  metering_point_id: ids.point, authorization_document_id: ids.document, request_type: 'z01_customer_masterdata',
  target_party_type: 'grid_owner', target_party_name: null, grid_owner_id: ids.grid, current_supplier_name: null,
  status: 'draft', requested_data_categories: ['customer_masterdata'], verified_payload: {},
  blocker_reason: null, blocker_code: null, blocker_details: null, notes: null,
  requested_at: null, sent_at: null, received_at: null, grid_owner_data_request_id: null,
  outbound_request_id: null, ediel_message_id: null, operation_id: ids.operation,
  created_at: now, updated_at: now, created_by: ids.actor,
})
const document = (): Row => ({ id: ids.document, company_id: ids.company, customer_id: ids.customer,
  site_id: ids.site, metering_point_id: ids.point, power_of_attorney_id: ids.poa,
  customer_contract_id: null, document_type: 'power_of_attorney', status: 'active',
  file_path: 'SYNTHETIC_ONLY/approved-poa.pdf', metadata: {}, created_at: now })
const poa = (): Row => ({ id: ids.poa, company_id: ids.company, customer_id: ids.customer,
  site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point, document_id: ids.document,
  status: 'signed', signed_at: now, revoked_at: null, valid_from: '2026-10-01', valid_to: '2026-12-31',
  valid_until: '2026-12-31', scope: 'grid_owner_data', signed_scope_snapshot: ['grid_owner_data'],
  scope_summary: { scopes: ['grid_owner_data'] }, fullmakt_snapshot: {}, customer_contract_id: null })
const scope = (): Row => ({ id: ids.scope, company_id: ids.company, customer_id: ids.customer,
  authorization_document_id: ids.document, scope_type: 'customer_onboarding', status: 'active',
  covers_grid_owner_data: true, covers_current_supplier_contract: false, covers_metering_data: false,
  valid_from: '2026-10-01', valid_to: '2026-12-31', revoked_at: null,
  signed_scope_snapshot: ['grid_owner_data'], evidence_note: null, created_at: now })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  vi.clearAllMocks()
  state.queries = []
  state.onScopeRead = null
  state.tables = {
    customers: [{ id: ids.customer, company_id: ids.company }], customer_info_requests: [],
    customer_info_request_events: [], authorization_scopes: [scope()], customer_authorization_documents: [document()],
    powers_of_attorney: [poa()], grid_owner_data_requests: [], customer_contracts: [],
    customer_sites: [{ id: ids.site, company_id: ids.company, customer_id: ids.customer, grid_owner_id: ids.grid, data_quality_status: 'incomplete', resolution_confidence: null }],
    metering_points: [{ id: ids.point, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, grid_owner_id: ids.grid }],
    ediel_messages: [], outbound_requests: [],
  }
  state.resolver.mockImplementation(async () => {
    state.tables.customer_sites[0].data_quality_status = 'complete'
    state.tables.customer_sites[0].resolution_confidence = 1
    state.tables.customers[0].process_summary = {refreshed_at: now}
    return {state: 'verified', result: {gridOwnerId: ids.grid}}
  })
  state.resume.mockResolvedValue({nextAction: 'wait_for_grid_owner', state: 'waiting', customerMessage: 'manual', references: {}, blockers: []})
  state.operational.mockResolvedValue(undefined)
  state.environment.mockResolvedValue({ status: 'resolved', environment: 'test', evidence: { source: 'DECLARED_UNIT_PORT' } })
  state.facility.mockResolvedValue({ siteExists: true, facilityReady: true })
  state.createGodr.mockImplementation(async (input: Row) => {
    const existingId = state.tables.customer_info_requests[0].grid_owner_data_request_id
    const existing = state.tables.grid_owner_data_requests.find(row => row.id === existingId ||
      (row.automation_key === input.automationKey && ['pending', 'sent'].includes(String(row.status))))
    if (existing) return structuredClone(existing)
    const created = { id: ids.godr, company_id: ids.company, customer_id: input.customerId, site_id: input.siteId,
      metering_point_id: input.meteringPointId, authorization_document_id: input.authorizationDocumentId,
      operation_id: input.operationId, request_payload: structuredClone(input.requestPayload), status: 'pending' }
    state.tables.grid_owner_data_requests.push(created)
    return structuredClone(created)
  })
  state.prepare.mockResolvedValue({ prepared: true, dataRequest: { id: ids.godr },
    outbound: { id: ids.outbound, ediel_route_profile_id: ids.profile, communication_route_id: null },
    message: { id: ids.message, interchange_reference: 'SYNTHETIC', transaction_reference: 'SYNTHETIC',
      correlation_reference: 'SYNTHETIC', external_reference: 'SYNTHETIC' },
    blockerReason: null, blockerCode: null, blockerDetails: null })
})
afterEach(() => vi.useRealTimers())


const job = () => ({id: uuid(40), company_id: ids.company, customer_id: ids.customer,
  customer_site_id: ids.site, metering_point_id: ids.point, created_by: ids.actor,
  operation_id: ids.operation} as JobRow)
const domain = () => structuredClone({customers: state.tables.customers, sites: state.tables.customer_sites,
  meters: state.tables.metering_points})

async function expectBlockedWithoutResolution() {
  const before = domain()
  const result = await processCustomerDataRequest(job())
  expect(domain()).toEqual(before)
  expect(state.resolver).not.toHaveBeenCalled()
  expect(result).toMatchObject({status: 'needs_review', result: {reason: 'missing_power_of_attorney',
    customer_info_request_id: ids.request, grid_owner_data_request_id: null, outbound_request_id: null}})
  expect(state.tables.customer_info_requests).toEqual([expect.objectContaining({id: ids.request,
    company_id: ids.company, customer_id: ids.customer, site_id: ids.site, operation_id: ids.operation,
    status: 'missing_authorization', blocker_code: 'missing_power_of_attorney',
    grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null})])
  expect(state.tables.customer_info_request_events).toContainEqual(expect.objectContaining({
    customer_info_request_id: ids.request, event_type: 'blocked_missing_authorization'}))
  expect(state.operationEvent).toHaveBeenCalledWith(expect.objectContaining({
    companyId: ids.company, customerId: ids.customer, operationId: ids.operation,
    eventType: 'customer_data.needs_review', payload: expect.objectContaining({customer_info_request_id: ids.request})}))
  expect(state.snapshot).toHaveBeenCalledWith(expect.objectContaining({requestReference: ids.request}))
  expect(state.createGodr).not.toHaveBeenCalled()
  expect(state.prepare).not.toHaveBeenCalled()
  expect(state.tables.grid_owner_data_requests).toEqual([])
  expect(state.tables.outbound_requests).toEqual([])
  expect(state.tables.ediel_messages).toEqual([])
}

describe('Z01 worker authorizes before mutable facility resolution', () => {
  it('refuses revoked POA with exact CIR/event/operation and unchanged domain state', async () => {
    state.tables.powers_of_attorney[0].revoked_at = now
    await expectBlockedWithoutResolution()
  })
  it('refuses archived source document without resolving or mutating customer/site', async () => {
    state.tables.customer_authorization_documents[0].status = 'archived'
    await expectBlockedWithoutResolution()
  })
  it('executes original resolver and freshly bound queue for a current grant', async () => {
    const result = await processCustomerDataRequest(job())
    expect(state.resolver).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({companyId: ids.company, siteId: ids.site}))
    expect(state.createGodr).toHaveBeenCalledTimes(1)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(result.result?.reason).toBe('z01_prepared_pending_send_guard')
    expect(state.tables.customer_sites[0].data_quality_status).toBe('complete')
  })
  it('retains the manual missing-facility gate ahead of authorization and resolution', async () => {
    state.facility.mockResolvedValue({siteExists: true, facilityReady: false})
    const result = await processCustomerDataRequest(job())
    expect(result.result?.redirect).toBe('manual_facility_information_request')
    expect(state.resume).toHaveBeenCalledTimes(1)
    expect(state.resolver).not.toHaveBeenCalled()
    expect(state.tables.customer_info_requests).toEqual([])
    expect(state.queries.filter(q => q.table === 'authorization_scopes')).toEqual([])
  })
  it('runs the lawful resolver when a grant becomes live after a denied preflight', async () => {
    state.tables.powers_of_attorney[0].revoked_at = now
    let reads = 0
    state.onScopeRead = () => {if (++reads === 2) state.tables.powers_of_attorney[0].revoked_at = null}
    const result = await processCustomerDataRequest(job())
    expect(state.resolver).toHaveBeenCalledTimes(1)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(result.result?.reason).toBe('z01_prepared_pending_send_guard')
  })
  it('freshly refuses a grant revoked by the resolver before queue publication', async () => {
    state.resolver.mockImplementation(async () => {
      state.tables.powers_of_attorney[0].revoked_at = now
      return {state: 'verified', result: {gridOwnerId: ids.grid}}
    })
    const result = await processCustomerDataRequest(job())
    expect(state.resolver).toHaveBeenCalledTimes(1)
    expect(result.result?.reason).toBe('missing_power_of_attorney')
    expect(state.prepare).not.toHaveBeenCalled()
    expect(state.createGodr).not.toHaveBeenCalled()
  })
  it('retains the unverified-resolution branch without creating a CIR or dispatch', async () => {
    state.resolver.mockResolvedValue({state: 'needs_review', result: {gridOwnerId: null}})
    const result = await processCustomerDataRequest(job())
    expect(result.status).toBe('needs_review')
    expect(result.result?.reason).toBe('grid_area_not_verified')
    expect(state.tables.customer_info_requests).toEqual([])
    expect(state.prepare).not.toHaveBeenCalled()
  })
  it('admits a current complete agreement without inventing a POA', async () => {
    Object.assign(state.tables.customer_authorization_documents[0], {document_type: 'complete_agreement', power_of_attorney_id: null})
    state.tables.powers_of_attorney = []
    const result = await processCustomerDataRequest(job())
    expect(state.resolver).toHaveBeenCalledTimes(1)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(result.result?.reason).toBe('z01_prepared_pending_send_guard')
  })
  it('does not use a different-grid CIR to qualify or relabel the live source', async () => {
    state.tables.customer_info_requests.push({...request(), id: uuid(60), grid_owner_id: ids.foreign})
    const before = structuredClone(state.tables.customer_info_requests[0])
    await processCustomerDataRequest(job())
    expect(state.tables.customer_info_requests[0]).toEqual(before)
    expect(state.tables.customer_info_requests).toHaveLength(2)
    expect(state.createGodr).toHaveBeenCalledWith(expect.objectContaining({gridOwnerId: ids.grid}))
  })
  it.each([ids.operation, uuid(81)])('does not borrow a live same-site CIR for a different unauthorized metering point (operation %s)', async (existingOperationId) => {
    const otherPoint = uuid(80)
    state.tables.metering_points.push({...state.tables.metering_points[0], id: otherPoint})
    state.tables.customer_info_requests.push({...request(), id: uuid(60), operation_id: existingOperationId})
    const original = structuredClone(state.tables.customer_info_requests[0])
    const before = domain()
    const result = await processCustomerDataRequest({...job(), metering_point_id: otherPoint})
    expect(domain()).toEqual(before)
    expect(state.resolver).not.toHaveBeenCalled()
    expect(result.result?.reason).toBe('missing_power_of_attorney')
    expect(state.tables.customer_info_requests[0]).toEqual(original)
    expect(state.tables.customer_info_requests).toHaveLength(2)
    expect(state.tables.customer_info_requests[1]).toMatchObject({id: ids.request,
      metering_point_id: otherPoint, status: 'missing_authorization'})
    expect(state.createGodr).not.toHaveBeenCalled()
    expect(state.prepare).not.toHaveBeenCalled()
  })
  it.each([ids.operation, uuid(81)])('keeps a different-point CIR unchanged while dispatching an authorized job point (operation %s)', async (existingOperationId) => {
    const otherPoint = uuid(80)
    state.tables.metering_points.push({...state.tables.metering_points[0], id: otherPoint})
    state.tables.customer_info_requests.push({...request(), id: uuid(60), operation_id: existingOperationId})
    const original = structuredClone(state.tables.customer_info_requests[0])
    state.tables.customer_authorization_documents[0].metering_point_id = otherPoint
    state.tables.powers_of_attorney[0].metering_point_id = otherPoint
    const result = await processCustomerDataRequest({...job(), metering_point_id: otherPoint})
    expect(state.tables.customer_info_requests[0]).toEqual(original)
    expect(state.tables.customer_info_requests).toHaveLength(2)
    expect(state.tables.customer_info_requests[1]).toMatchObject({id: ids.request, metering_point_id: otherPoint})
    expect(state.resolver).toHaveBeenCalledTimes(1)
    expect(state.createGodr).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({meteringPointId: otherPoint}))
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(result.result?.reason).toBe('z01_prepared_pending_send_guard')
  })
  it('does not borrow a point-specific CIR when the job has an explicit null point', async () => {
    state.tables.customer_info_requests.push({...request(), id: uuid(60)})
    const original = structuredClone(state.tables.customer_info_requests[0])
    const before = domain()
    const result = await processCustomerDataRequest({...job(), metering_point_id: null})
    expect(domain()).toEqual(before)
    expect(state.resolver).not.toHaveBeenCalled()
    expect(state.tables.customer_info_requests[0]).toEqual(original)
    expect(state.tables.customer_info_requests).toHaveLength(2)
    expect(state.tables.customer_info_requests[1]).toMatchObject({metering_point_id: null,
      status: 'missing_authorization'})
    expect(result.result?.reason).toBe('missing_power_of_attorney')
    expect(state.createGodr).not.toHaveBeenCalled()
    expect(state.prepare).not.toHaveBeenCalled()
  })
  it('unbound qualification applies current immutable signed scope and contract ownership', async () => {
    state.tables.powers_of_attorney[0].signed_scope_snapshot = ['current_supplier_contract']
    state.tables.powers_of_attorney[0].scope_summary = {scopes: ['grid_owner_data']}
    let result = await resolveCurrentInfoRequestScopeAuthorization({company_id: ids.company,
      customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point})
    expect(result.gridOwnerDocumentId).toBeNull()
    state.tables.powers_of_attorney[0].signed_scope_snapshot = ['grid_owner_data']
    state.tables.powers_of_attorney[0].customer_contract_id = uuid(70)
    state.tables.customer_contracts = [{id: uuid(70), company_id: ids.foreign, customer_id: ids.customer}]
    result = await resolveCurrentInfoRequestScopeAuthorization({company_id: ids.company,
      customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point})
    expect(result.gridOwnerDocumentId).toBeNull()
    expect(state.queries.some(q => q.table === 'grid_owner_data_requests')).toBe(false)
  })
  it('unbound scope qualification never queries a GODR or creates evidence', async () => {
    const before = structuredClone(state.tables)
    const result = await resolveCurrentInfoRequestScopeAuthorization({company_id: ids.company,
      customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point})
    expect(result.gridOwnerDocumentId).toBe(ids.document)
    expect(state.tables).toEqual(before)
    expect(state.queries.some(q => q.table === 'grid_owner_data_requests')).toBe(false)
  })
  it('public refusal-only check cannot create GODR/outbound when source is live', async () => {
    state.tables.customer_info_requests.push(request())
    const result = await checkCustomerInfoRequestAuthorization({companyId: ids.company,
      actorUserId: ids.actor, requestId: ids.request})
    expect(result.refusal).toBeNull()
    expect(state.createGodr).not.toHaveBeenCalled()
    expect(state.prepare).not.toHaveBeenCalled()
  })
})
