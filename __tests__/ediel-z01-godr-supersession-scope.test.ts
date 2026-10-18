import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'

// masterplan: AT-Z01L-SUPPLIER, AT-Z01LK-SUPPLIER
// Unapproved component regression: actual public queue and current authority checks.
// Stateful finite database IO and declared GODR/environment/facility/preparation
// ports prove same-source supersession only; no native, wire, transport or whole approval.
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
        const [column, jsonKey] = filter.column.split('->>')
        const value = jsonKey ? (row[column] as Row | null)?.[jsonKey] : row[column]
        const actual = value ?? null
        if (filter.kind === 'eq') return actual !== null && filter.value !== null && actual === filter.value
        if (filter.kind === 'neq') return actual !== null && filter.value !== null && actual !== filter.value
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

const godr = (rowId: string, changes: Row = {}): Row => ({
  id: rowId, company_id: ids.company, customer_id: ids.customer,
  site_id: ids.site, metering_point_id: ids.point, operation_id: ids.operation,
  grid_owner_id: ids.grid, request_scope: 'customer_masterdata', status: 'pending',
  authorization_document_id: ids.document,
  automation_key: rowId === ids.godr ? `customer-info-request:${ids.request}:z01` : `legacy:${rowId}`,
  request_payload: { authorization_document_id: ids.document, customer_info_request_id: ids.request },
  response_payload: {}, created_at: now, ...changes,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  vi.clearAllMocks()
  state.queries = []
  state.tables = {
    customers: [{ id: ids.customer, company_id: ids.company }], customer_info_requests: [request()],
    customer_info_request_events: [], authorization_scopes: [scope()], customer_authorization_documents: [document()],
    powers_of_attorney: [poa()], grid_owner_data_requests: [godr(ids.godr)], customer_contracts: [],
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
    if (!existing) throw new Error('declared_exact_key_GODR_reuse_required')
    return structuredClone(existing)
  })
  state.prepare.mockResolvedValue({ prepared: true, dataRequest: { id: ids.godr },
    outbound: { id: ids.outbound, ediel_route_profile_id: ids.profile, communication_route_id: null },
    message: { id: ids.message, interchange_reference: 'SYNTHETIC', transaction_reference: 'SYNTHETIC',
      correlation_reference: 'SYNTHETIC', external_reference: 'SYNTHETIC' },
    blockerReason: null, blockerCode: null, blockerDetails: null })
})
afterEach(() => vi.useRealTimers())

const queue = () => queueCustomerInfoRequestForDispatch({ companyId: ids.company, actorUserId: ids.actor, requestId: ids.request })
const byId = (rowId: string) => state.tables.grid_owner_data_requests.find(row => row.id === rowId)

async function dispatchWithRetainedRows(retained: Row[]) {
  const before = structuredClone(retained)
  const selected = structuredClone(byId(ids.godr))
  const businessState = () => Object.fromEntries(Object.entries(state.tables)
    .filter(([table]) => !['customer_info_requests', 'customer_info_request_events', 'grid_owner_data_requests'].includes(table)))
  const businessBefore = structuredClone(businessState())
  const result = await queue()
  expect(result.status).toBe('z01_prepared')
  expect(result.customerInfoRequest).toMatchObject({ id: ids.request, grid_owner_data_request_id: ids.godr,
    outbound_request_id: ids.outbound, ediel_message_id: ids.message })
  expect(retained.map(row => byId(String(row.id)))).toEqual(before)
  expect(byId(ids.godr)).toEqual(selected)
  expect(businessState()).toEqual(businessBefore)
}

describe('public Z01 queue keeps supersession within the exact information request', () => {
  it('preserves independent requests while superseding the same CIR and complete object/operation tuple', async () => {
    // Removing any production scope predicate must change a retained row here.
    // A different CIR on the same object/operation is independently legitimate.
    const retained = [
      godr(uuid(40), { site_id: uuid(90) }),
      godr(uuid(41), { metering_point_id: uuid(91) }),
      godr(uuid(42), { operation_id: uuid(92) }),
      godr(uuid(43), { request_payload: { authorization_document_id: ids.document, customer_info_request_id: uuid(93) } }),
      godr(uuid(44), { request_payload: { authorization_document_id: ids.document } }),
      godr(uuid(45), { company_id: ids.foreign }),
      godr(uuid(46), { customer_id: ids.foreign }),
      godr(uuid(47), { grid_owner_id: ids.foreign }),
      godr(uuid(48), { request_scope: 'meter_values' }),
      godr(uuid(49), { status: 'sent' }),
      godr(uuid(50), { status: 'failed' }),
    ]
    const superseded = godr(uuid(60))
    state.tables.grid_owner_data_requests.push(...retained, superseded)
    await dispatchWithRetainedRows(retained)
    expect(byId(uuid(60))).toMatchObject({ status: 'failed', updated_by: ids.actor, failed_at: now })
    expect(state.tables.customer_info_request_events).toEqual([expect.objectContaining({
      customer_info_request_id: ids.request, event_type: 'z01_prepared_for_dispatch',
    })])
  })

  it.each(['site_id', 'metering_point_id', 'operation_id'] as const)
  ('matches an explicit null %s without superseding a populated sibling', async column => {
    state.tables.customer_info_requests[0][column] = null
    state.tables.grid_owner_data_requests[0][column] = null
    if (column !== 'operation_id') {
      state.tables.customer_authorization_documents[0][column] = null
      state.tables.powers_of_attorney[0][column] = null
      if (column === 'site_id') state.tables.powers_of_attorney[0].customer_site_id = null
    }
    const retained = [godr(uuid(40))]
    const superseded = godr(uuid(60), { [column]: null })
    state.tables.grid_owner_data_requests.push(...retained, superseded)
    await dispatchWithRetainedRows(retained)
    expect(byId(uuid(60))).toMatchObject({ status: 'failed', failed_at: now })
  })

  it.each(['outboundRequestId', 'edielMessageId', 'ediel_message_id', 'intentId'] as const)
  ('preserves a same-source pending request carrying a known %s', async selector => {
    const retained = [godr(uuid(40), { response_payload: { [selector]: uuid(90) } })]
    const superseded = godr(uuid(60), { response_payload: { outboundRequestId: null, edielMessageId: null, intentId: null } })
    state.tables.grid_owner_data_requests.push(...retained, superseded)
    await dispatchWithRetainedRows(retained)
    expect(byId(uuid(60))).toMatchObject({ status: 'failed', failed_at: now })
  })
})
