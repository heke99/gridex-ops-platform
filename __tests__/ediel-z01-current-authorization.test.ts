import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'

// Queue prerequisite unit proof only. Database rows are declared upstream inputs;
// GODR, environment, facility and outbound ports are isolated, not native/publication proof.
type Row = Record<string, unknown>
type Filter = { column: string; kind: 'eq' | 'neq' | 'is' | 'in'; value: unknown }
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; filters: Filter[]; action: string; patch: Row | null }>,
  createGodr: vi.fn(), prepare: vi.fn(), environment: vi.fn(), facility: vi.fn(), operational: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
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
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({ evaluateSiteFacilityIdentity: state.facility }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: vi.fn() }))
vi.mock('@/lib/ediel/services/manualPermission', () => ({ prepareManualServicePermission: vi.fn() }))

import { queueCustomerInfoRequestForDispatch } from '@/lib/onboarding/infoRequests'

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
  state.tables = {
    customers: [{ id: ids.customer, company_id: ids.company }], customer_info_requests: [request()],
    customer_info_request_events: [], authorization_scopes: [scope()], customer_authorization_documents: [document()],
    powers_of_attorney: [poa()], grid_owner_data_requests: [], customer_contracts: [],
    customer_sites: [{ id: ids.site, company_id: ids.company, customer_id: ids.customer }],
    metering_points: [{ id: ids.point, company_id: ids.company, customer_id: ids.customer, site_id: ids.site }],
    ediel_messages: [], outbound_requests: [],
  }
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

const queue = () => queueCustomerInfoRequestForDispatch({ companyId: ids.company, actorUserId: ids.actor, requestId: ids.request })
async function expectAuthorizationRefusal() {
  const result = await queue()
  expect(result.status).toBe('missing_authorization')
  expect(result.blockerCode).toBe('missing_power_of_attorney')
  expect(result.gridOwnerDataRequestId).toBeNull()
  expect(result.outboundRequestId).toBeNull()
  expect(state.tables.customer_info_requests[0]).toMatchObject({
    status: 'missing_authorization', blocker_code: 'missing_power_of_attorney', ediel_message_id: null,
    grid_owner_data_request_id: null, outbound_request_id: null,
  })
  expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
    company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
    event_type: 'blocked_missing_authorization', created_by: ids.actor,
    payload: expect.objectContaining({ blocker_code: 'missing_power_of_attorney' }),
  })])
  expect(state.createGodr).not.toHaveBeenCalled()
  expect(state.prepare).not.toHaveBeenCalled()
  expect(state.environment).not.toHaveBeenCalled()
  expect(state.facility).not.toHaveBeenCalled()
  expect(state.tables.grid_owner_data_requests).toEqual([])
  expect(state.tables.ediel_messages).toEqual([])
  expect(state.tables.outbound_requests).toEqual([])
}

async function expectAdmittedWithDocument(documentId = ids.document, priorOriginal = false) {
  const originalRows = structuredClone({ messages: state.tables.ediel_messages, outbounds: state.tables.outbound_requests })
  const result = await queue()
  expect(result.status).toBe('z01_prepared')
  expect(result.blockerCode).toBeNull()
  expect(result.customerInfoRequest.authorization_document_id).toBe(documentId)
  expect(state.tables.customer_info_requests[0]).toMatchObject({
    authorization_document_id: documentId, grid_owner_data_request_id: ids.godr,
  })
  expect(state.createGodr).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point,
    authorizationDocumentId: documentId,
    requestPayload: expect.objectContaining({ authorization_document_id: documentId, customer_info_request_id: ids.request }),
  }))
  expect(state.tables.grid_owner_data_requests).toEqual([expect.objectContaining({
    id: ids.godr, company_id: ids.company, authorization_document_id: documentId,
    request_payload: expect.objectContaining({ authorization_document_id: documentId }),
  })])
  expect(state.prepare).toHaveBeenCalledExactlyOnceWith({ actorUserId: ids.actor, gridOwnerDataRequestId: ids.godr,
    environment: 'test', operationId: ids.operation })
  expect(state.environment).toHaveBeenCalledTimes(1)
  expect(state.facility).toHaveBeenCalledTimes(1)
  expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
    company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
    event_type: 'z01_prepared_for_dispatch',
  })])
  // The mocked external prepare result is an admission observation, not physical publication.
  expect(state.tables.ediel_messages).toEqual(priorOriginal ? originalRows.messages : [])
  expect(state.tables.outbound_requests).toEqual(priorOriginal ? originalRows.outbounds : [])
}

function addAlternateGrant() {
  const alternateDocument = uuid(20), alternatePoa = uuid(21)
  state.tables.customer_authorization_documents.push({ ...document(), id: alternateDocument, power_of_attorney_id: alternatePoa })
  state.tables.powers_of_attorney.push({ ...poa(), id: alternatePoa, document_id: alternateDocument })
  state.tables.authorization_scopes.push({ ...scope(), id: uuid(22), authorization_document_id: alternateDocument, created_at: '2026-10-06T16:00:00.000Z' })
  return alternateDocument
}

function bindPriorGodr(documentId: string | null) {
  Object.assign(state.tables.customer_info_requests[0], { authorization_document_id: documentId,
    grid_owner_data_request_id: ids.godr, outbound_request_id: ids.outbound, ediel_message_id: ids.message })
  state.tables.grid_owner_data_requests.push({ id: ids.godr, company_id: ids.company, customer_id: ids.customer,
    site_id: ids.site, metering_point_id: ids.point, authorization_document_id: documentId,
    operation_id: ids.operation, request_payload: { authorization_document_id: documentId }, status: 'sent' })
  state.tables.ediel_messages.push({ id: ids.message, company_id: ids.company, customer_id: ids.customer,
    customer_site_id: ids.site, outbound_request_id: ids.outbound, message_code: 'Z01',
    raw_payload: 'DECLARED_UNIT_PRIOR_ORIGINAL_BYTES', operation_id: ids.operation })
  state.tables.outbound_requests.push({ id: ids.outbound, company_id: ids.company,
    customer_id: ids.customer, authorization_document_id: documentId, status: 'sent' })
}

async function expectBoundRefusal() {
  const previous = structuredClone({ godrs: state.tables.grid_owner_data_requests,
    messages: state.tables.ediel_messages, outbounds: state.tables.outbound_requests })
  const binding = Object.fromEntries(['authorization_document_id', 'grid_owner_data_request_id', 'outbound_request_id', 'ediel_message_id']
    .map(key => [key, state.tables.customer_info_requests[0][key]]))
  const result = await queue()
  expect(result.status).toBe('missing_authorization')
  expect(result.blockerCode).toBe('missing_power_of_attorney')
  expect(result.gridOwnerDataRequestId).toBe(binding.grid_owner_data_request_id)
  expect(result.outboundRequestId).toBe(binding.outbound_request_id)
  expect(state.tables.customer_info_requests[0]).toMatchObject(binding)
  expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
    company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
    event_type: 'blocked_missing_authorization', payload: expect.objectContaining({ blocker_code: 'missing_power_of_attorney' }),
  })])
  for (const port of [state.createGodr, state.prepare, state.environment, state.facility]) expect(port).not.toHaveBeenCalled()
  expect({ godrs: state.tables.grid_owner_data_requests, messages: state.tables.ediel_messages,
    outbounds: state.tables.outbound_requests }).toEqual(previous)
}

describe('[AT-Z01L-SUPPLIER] [AT-Z01LK-SUPPLIER] Z01 queue current authorization admission only', () => {
  it('refuses an archived document and revoked POA despite its stale active legacy scope before any GODR', async () => {
    // These states are the actual public archive/revoke producer's documented result;
    // the independently active legacy scope is retained, not invented current authority.
    state.tables.customer_authorization_documents[0].status = 'archived'
    state.tables.powers_of_attorney[0].status = 'revoked'
    state.tables.powers_of_attorney[0].revoked_at = now
    await expectAuthorizationRefusal()
  })

  it.each<[string, () => void]>([
    ['archived document alone', () => { state.tables.customer_authorization_documents[0].status = 'archived' }],
    ['missing document', () => { state.tables.customer_authorization_documents = [] }],
    ['uploaded unapproved document', () => { state.tables.customer_authorization_documents[0].status = 'uploaded' }],
    ['invoice suggested as authority', () => { state.tables.customer_authorization_documents[0].document_type = 'grid_invoice_suggested' }],
    ['foreign company document', () => { state.tables.customer_authorization_documents[0].company_id = ids.foreign }],
    ['foreign customer document', () => { state.tables.customer_authorization_documents[0].customer_id = ids.foreign }],
    ['other site document', () => { state.tables.customer_authorization_documents[0].site_id = ids.foreign }],
    ['other point document', () => { state.tables.customer_authorization_documents[0].metering_point_id = ids.foreign }],
    ['revoked POA status', () => { state.tables.powers_of_attorney[0].status = 'revoked' }],
    ['revoked POA timestamp', () => { state.tables.powers_of_attorney[0].revoked_at = now }],
    ['missing linked POA', () => { state.tables.powers_of_attorney = [] }],
    ['POA document without linked POA ID', () => { state.tables.customer_authorization_documents[0].power_of_attorney_id = null }],
    ['foreign company POA', () => { state.tables.powers_of_attorney[0].company_id = ids.foreign }],
    ['foreign customer POA', () => { state.tables.powers_of_attorney[0].customer_id = ids.foreign }],
    ['other site POA', () => { Object.assign(state.tables.powers_of_attorney[0], { site_id: ids.foreign, customer_site_id: ids.foreign }) }],
    ['other point POA', () => { state.tables.powers_of_attorney[0].metering_point_id = ids.foreign }],
    ['POA points at another document', () => { state.tables.powers_of_attorney[0].document_id = ids.foreign }],
    ['future POA', () => { state.tables.powers_of_attorney[0].valid_from = '2026-10-07' }],
    ['expired POA valid_to', () => { state.tables.powers_of_attorney[0].valid_to = '2026-10-05' }],
    ['expired POA valid_until', () => { state.tables.powers_of_attorney[0].valid_until = '2026-10-05' }],
    ['future scope', () => { state.tables.authorization_scopes[0].valid_from = '2026-10-07' }],
    ['expired scope', () => { state.tables.authorization_scopes[0].valid_to = '2026-10-05' }],
    ['revoked scope', () => { state.tables.authorization_scopes[0].revoked_at = now }],
    ['inactive scope', () => { state.tables.authorization_scopes[0].status = 'revoked' }],
    ['foreign company scope', () => { state.tables.authorization_scopes[0].company_id = ids.foreign }],
    ['foreign customer scope', () => { state.tables.authorization_scopes[0].customer_id = ids.foreign }],
    ['scope without document', () => { state.tables.authorization_scopes[0].authorization_document_id = null }],
    ['scope does not cover grid data', () => { state.tables.authorization_scopes[0].covers_grid_owner_data = false }],
    ['immutable signed scope excludes grid despite legacy summary', () => { state.tables.powers_of_attorney[0].signed_scope_snapshot = ['metering_data'] }],
    ['invalid nonempty signed snapshot cannot fall back to legacy summary', () => { state.tables.powers_of_attorney[0].signed_scope_snapshot = [''] }],
    ['malformed POA date', () => { state.tables.powers_of_attorney[0].valid_from = '2026/10/06' }],
    ['nonexistent POA calendar date', () => { state.tables.powers_of_attorney[0].valid_to = '2026-02-30' }],
    ['malformed scope date', () => { state.tables.authorization_scopes[0].valid_to = '2026/12/31' }],
  ])('refuses %s before any GODR', async (_label, mutate) => {
    mutate()
    await expectAuthorizationRefusal()
  })

  it('admits the live signed POA and binds its document through the actual queue', async () => {
    await expectAdmittedWithDocument()
  })

  it('admits inclusive current UTC date endpoints for the POA and scope', async () => {
    for (const row of [state.tables.powers_of_attorney[0], state.tables.authorization_scopes[0]]) {
      Object.assign(row, { valid_from: '2026-10-06', valid_to: '2026-10-06' })
    }
    state.tables.powers_of_attorney[0].valid_until = '2026-10-06'
    await expectAdmittedWithDocument()
  })

  it('admits a site-wide live document and POA when their point restrictions are absent', async () => {
    state.tables.customer_authorization_documents[0].metering_point_id = null
    state.tables.powers_of_attorney[0].metering_point_id = null
    await expectAdmittedWithDocument()
  })

  it.each(['supplier_switch', 'facility_information_lookup'])('preserves admitted signed scope %s', async signedScope => {
    state.tables.powers_of_attorney[0].signed_scope_snapshot = [signedScope]
    await expectAdmittedWithDocument()
  })

  it('preserves the existing legacy signed-scope summary fallback when immutable snapshot is empty', async () => {
    state.tables.powers_of_attorney[0].signed_scope_snapshot = []
    await expectAdmittedWithDocument()
  })

  it('admits the approved complete agreement for requests without inventing a POA requirement', async () => {
    // Declared upstream approved document input admitted by fullmaktAutomation;
    // this does not exercise the legal document upload/approval producer or supplier-switch admission.
    Object.assign(state.tables.customer_authorization_documents[0], { document_type: 'complete_agreement',
      power_of_attorney_id: null, metadata: { source: 'customer_intake', documentRole: 'signed_agreement' } })
    state.tables.powers_of_attorney = []
    await expectAdmittedWithDocument()
  })

  it('chooses the actual live alternate grant and replaces only the fresh request stale document pointer', async () => {
    state.tables.customer_authorization_documents[0].status = 'archived'
    state.tables.powers_of_attorney[0].status = 'revoked'
    const alternateDocument = addAlternateGrant()
    await expectAdmittedWithDocument(alternateDocument)
    expect(state.tables.customer_authorization_documents[0].status).toBe('archived')
    expect(state.tables.powers_of_attorney[0].status).toBe('revoked')
  })

  it('fills a fresh request null pointer from an actual eligible document rather than customer-wide flags', async () => {
    state.tables.customer_info_requests[0].authorization_document_id = null
    await expectAdmittedWithDocument()
  })

  it('preserves independent live grid-owner and supplier grants instead of requiring one document for both', async () => {
    state.tables.customer_info_requests[0].requested_data_categories = ['customer_masterdata', 'binding_period']
    const supplierDocument = addAlternateGrant()
    Object.assign(state.tables.authorization_scopes[1], { covers_grid_owner_data: false, covers_current_supplier_contract: true })
    Object.assign(state.tables.powers_of_attorney[1], { scope: 'current_supplier_contract', signed_scope_snapshot: ['current_supplier_contract'],
      scope_summary: { scopes: ['current_supplier_contract'] } })
    await expectAdmittedWithDocument()
    expect(state.tables.authorization_scopes[1].authorization_document_id).toBe(supplierDocument)
  })

  it('does not borrow a scope from another tenant even when that scope alone would authorize the request', async () => {
    const ownScope = state.tables.authorization_scopes[0]
    ownScope.covers_grid_owner_data = false
    state.tables.authorization_scopes.push({ ...scope(), id: ids.foreign, company_id: ids.foreign })
    const foreignBefore = structuredClone(state.tables.authorization_scopes[1])
    await expectAuthorizationRefusal()
    expect(state.tables.authorization_scopes[1]).toEqual(foreignBefore)
  })

  it('preserves unrelated foreign rows while writing the exact own refusal and event', async () => {
    const foreign = { ...request(), id: uuid(31), company_id: ids.foreign, customer_id: ids.foreign }
    state.tables.customer_info_requests.push(foreign)
    const before = structuredClone(foreign)
    state.tables.customer_authorization_documents[0].status = 'archived'
    await expectAuthorizationRefusal()
    expect(state.tables.customer_info_requests[1]).toEqual(before)
  })

  it('preserves supplier-only manual review without a GODR, environment, facility or outbound preparation', async () => {
    Object.assign(state.tables.customer_info_requests[0], { request_type: 'binding_period', target_party_type: 'current_supplier',
      requested_data_categories: ['binding_period'] })
    Object.assign(state.tables.authorization_scopes[0], { covers_grid_owner_data: false, covers_current_supplier_contract: true })
    Object.assign(state.tables.powers_of_attorney[0], { signed_scope_snapshot: ['current_supplier_contract'],
      scope_summary: { scopes: ['current_supplier_contract'] } })
    const result = await queue()
    expect(result.status).toBe('manual_review_required')
    expect(result.blockerCode).toBeNull()
    expect(state.tables.customer_info_requests[0].authorization_document_id).toBe(ids.document)
    expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
      company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
      event_type: 'manual_supplier_contract_check',
    })])
    for (const port of [state.createGodr, state.prepare, state.environment, state.facility]) expect(port).not.toHaveBeenCalled()
    expect(state.queries.some(query => query.table === 'grid_owner_data_requests')).toBe(false)
    expect(state.tables.grid_owner_data_requests).toEqual([])
  })

  it('checks an optional contract reference identity while authority remains the document and signed scope', async () => {
    state.tables.customer_authorization_documents[0].customer_contract_id = uuid(45)
    state.tables.customer_contracts.push({ id: uuid(45), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point })
    await expectAdmittedWithDocument()
  })

  it.each(['company_id', 'customer_id', 'site_id', 'customer_site_id', 'metering_point_id'])('refuses a document-linked contract with wrong %s', async column => {
    state.tables.customer_authorization_documents[0].customer_contract_id = uuid(45)
    state.tables.customer_contracts.push({ id: uuid(45), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point, [column]: ids.foreign })
    await expectAuthorizationRefusal()
  })

  it('refuses a missing document-linked contract reference', async () => {
    state.tables.customer_authorization_documents[0].customer_contract_id = uuid(45)
    await expectAuthorizationRefusal()
  })

  it.each(['contract_id', 'customer_contract_id'].flatMap(reference =>
    ['company_id', 'customer_id', 'site_id', 'customer_site_id', 'metering_point_id'].map(column => [reference, column])
  ))('refuses POA contract lineage %s referencing wrong %s', async (reference, column) => {
    state.tables.powers_of_attorney[0][reference] = uuid(45)
    state.tables.customer_contracts.push({ id: uuid(45), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point, [column]: ids.foreign })
    await expectAuthorizationRefusal()
  })

  it.each(['contract_id', 'customer_contract_id'])('refuses a missing POA %s reference', async reference => {
    state.tables.powers_of_attorney[0][reference] = uuid(45)
    await expectAuthorizationRefusal()
  })

  it('preserves own POA contract lineage without deriving permission from contract lifecycle or supply dates', async () => {
    Object.assign(state.tables.powers_of_attorney[0], { contract_id: uuid(45), customer_contract_id: uuid(45) })
    state.tables.customer_contracts.push({ id: uuid(45), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point,
      status: 'cancelled', signed_at: null, starts_at: '2026-01-01', ends_at: '2026-02-01' })
    await expectAdmittedWithDocument()
  })

  it('admits one consistent contract identity across the document and both POA reference columns', async () => {
    state.tables.customer_authorization_documents[0].customer_contract_id = uuid(45)
    Object.assign(state.tables.powers_of_attorney[0], { contract_id: uuid(45), customer_contract_id: uuid(45) })
    state.tables.customer_contracts.push({ id: uuid(45), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point })
    await expectAdmittedWithDocument()
  })

  it('refuses contradictory populated POA contract lineage IDs even when both rows belong to the customer', async () => {
    Object.assign(state.tables.powers_of_attorney[0], { contract_id: uuid(45), customer_contract_id: uuid(46) })
    state.tables.customer_contracts.push(...[45, 46].map(number => ({ id: uuid(number), company_id: ids.company,
      customer_id: ids.customer, site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point })))
    await expectAuthorizationRefusal()
  })

  it('refuses a POA contract lineage ID contradicting its document contract binding', async () => {
    state.tables.customer_authorization_documents[0].customer_contract_id = uuid(45)
    state.tables.powers_of_attorney[0].contract_id = uuid(46)
    state.tables.customer_contracts.push(...[45, 46].map(number => ({ id: uuid(number), company_id: ids.company,
      customer_id: ids.customer, site_id: ids.site, customer_site_id: ids.site, metering_point_id: ids.point })))
    await expectAuthorizationRefusal()
  })

  it('does not relabel a prior GODR and original with a live alternate after their original grant is archived', async () => {
    bindPriorGodr(ids.document)
    state.tables.customer_authorization_documents[0].status = 'archived'
    state.tables.powers_of_attorney[0].status = 'revoked'
    addAlternateGrant()
    await expectBoundRefusal()
  })

  it('admits a still-live prior binding without changing its GODR or original document authority', async () => {
    bindPriorGodr(ids.document)
    const previous = structuredClone(state.tables.grid_owner_data_requests)
    await expectAdmittedWithDocument(ids.document, true)
    expect(state.tables.grid_owner_data_requests).toEqual(previous)
    expect(state.tables.customer_info_requests[0]).toMatchObject({ authorization_document_id: ids.document,
      grid_owner_data_request_id: ids.godr, ediel_message_id: ids.message, outbound_request_id: ids.outbound })
  })

  it('does not backfill an authorization onto a prior bound NULL GODR/original', async () => {
    bindPriorGodr(null)
    await expectBoundRefusal()
  })

  it('does not relabel a prior born-but-unlinked GODR found by the actual automation key', async () => {
    bindPriorGodr(ids.document)
    Object.assign(state.tables.customer_info_requests[0], { grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null })
    Object.assign(state.tables.grid_owner_data_requests[0], { status: 'pending', automation_key: `customer-info-request:${ids.request}:z01` })
    state.tables.customer_authorization_documents[0].status = 'archived'
    state.tables.powers_of_attorney[0].status = 'revoked'
    addAlternateGrant()
    await expectBoundRefusal()
  })

  it('does not change a prior GODR whose document differs from the stored CIR binding', async () => {
    const alternate = addAlternateGrant()
    bindPriorGodr(ids.document)
    state.tables.grid_owner_data_requests[0].authorization_document_id = alternate
    await expectBoundRefusal()
  })

  it('does not overwrite historical original-only bindings with a new live document', async () => {
    bindPriorGodr(ids.document)
    state.tables.customer_info_requests[0].grid_owner_data_request_id = null
    state.tables.grid_owner_data_requests = []
    state.tables.customer_authorization_documents[0].status = 'archived'
    state.tables.powers_of_attorney[0].status = 'revoked'
    addAlternateGrant()
    await expectBoundRefusal()
  })

  it('refuses a returned operation-deduplicated GODR with a different authorization before CIR link or prepare', async () => {
    const alternate = addAlternateGrant()
    const existing = { id: uuid(40), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, metering_point_id: ids.point, operation_id: ids.operation,
      request_scope: 'customer_masterdata', automation_key: 'DECLARED_OTHER_REQUEST_SAME_OPERATION',
      authorization_document_id: alternate, request_payload: { authorization_document_id: alternate }, status: 'pending' }
    state.tables.grid_owner_data_requests.push(existing)
    const previous = structuredClone(existing)
    // Declared real RPC operation-dedupe output: its automation-key pre-read misses this row.
    // This models the port boundary, not an executed SQL transaction or concurrency proof.
    state.createGodr.mockResolvedValueOnce(structuredClone(existing))
    const result = await queue()
    expect(result.status).toBe('missing_authorization')
    expect(result.blockerCode).toBe('missing_power_of_attorney')
    expect(state.tables.customer_info_requests[0]).toMatchObject({ authorization_document_id: ids.document,
      grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null })
    expect(state.prepare).not.toHaveBeenCalled()
    expect(state.createGodr).toHaveBeenCalledTimes(1)
    expect(state.tables.grid_owner_data_requests).toEqual([previous])
    expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
      company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
      event_type: 'blocked_missing_authorization', payload: expect.objectContaining({ blocker_code: 'missing_power_of_attorney' }),
    })])
    expect(state.tables.ediel_messages).toEqual([])
    expect(state.tables.outbound_requests).toEqual([])
  })

  it.each(['company_id', 'customer_id', 'site_id', 'metering_point_id', 'request_payload'])
  ('refuses an existing returned GODR with wrong %s before CIR link or prepare', async column => {
    const existing = { id: uuid(40), company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, metering_point_id: ids.point, operation_id: ids.operation,
      request_scope: 'customer_masterdata', authorization_document_id: ids.document,
      request_payload: { authorization_document_id: ids.document }, status: 'pending',
      [column]: column === 'request_payload' ? { authorization_document_id: uuid(20) } : ids.foreign }
    state.tables.grid_owner_data_requests.push(existing)
    const before = structuredClone(existing)
    state.createGodr.mockResolvedValueOnce(structuredClone(existing))
    const result = await queue()
    expect(result.status).toBe('missing_authorization')
    expect(result.blockerCode).toBe('missing_power_of_attorney')
    expect(state.tables.customer_info_requests[0]).toMatchObject({ authorization_document_id: ids.document,
      grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null })
    expect(state.prepare).not.toHaveBeenCalled()
    expect(state.createGodr).toHaveBeenCalledTimes(1)
    expect(state.tables.grid_owner_data_requests).toEqual([before])
    expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
      company_id: ids.company, customer_id: ids.customer, customer_info_request_id: ids.request,
      event_type: 'blocked_missing_authorization', payload: expect.objectContaining({ blocker_code: 'missing_power_of_attorney' }),
    })])
    expect(state.tables.ediel_messages).toEqual([])
    expect(state.tables.outbound_requests).toEqual([])
  })
})
