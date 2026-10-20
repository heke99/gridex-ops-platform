import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureManualSupplierInformationForSite } from '@/lib/customer-operations/ensureManualSupplierInformation'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, reads: [] as Array<{ table: string; filters: Row }>,
  create: vi.fn(), queue: vi.fn(), proof: vi.fn(), beforeSiteUpdate: null as null | (() => void),
}))
const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '10000000-0000-4000-8000-000000000002'
const siteId = '10000000-0000-4000-8000-000000000003'
const supplierId = '10000000-0000-4000-8000-000000000004'
const actorId = '10000000-0000-4000-8000-000000000005'
const cirId = '10000000-0000-4000-8000-000000000006'
const goirId = '10000000-0000-4000-8000-000000000007'
const input = { companyId, customerId, siteId }
const automationKey = `manual-supplier:${companyId}:${siteId}:${supplierId}`
const path = (row: Row, key: string): unknown => key.split(/->>?/).reduce<unknown>((value, field) => value && typeof value === 'object' ? (value as Row)[field] : undefined, row)

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Row = {}
    predicates: Array<(row: Row) => boolean> = []
    patch: Row | null = null
    maximum = Infinity
    constructor(private table: string) { io.reads.push({ table, filters: this.filters }) }
    select() { return this }
    eq(field: string, value: unknown) { this.filters[field] = value; this.predicates.push((row) => typeof value === 'string' && ['verified_payload', 'metadata'].includes(field) ? JSON.stringify(row[field]) === value : path(row, field) === value); return this }
    is(field: string, value: unknown) { this.filters[field] = value; this.predicates.push((row) => (path(row, field) ?? null) === value); return this }
    in(field: string, values: unknown[]) { this.filters[field] = values; this.predicates.push((row) => values.includes(path(row, field))); return this }
    or(value: string) {
      const tenant = value.match(/company_id\.eq\.([^,)]+)/)?.[1]
      if (!tenant) throw new Error('Unexpected filter: ' + value)
      this.predicates.push((row) => row.company_id == null || row.company_id === tenant)
      return this
    }
    limit(value: number) { this.maximum = value; return this }
    order() { return this }
    update(patch: Row) { this.patch = patch; return this }
    run() {
      if (this.patch && this.table === 'customer_sites' && io.beforeSiteUpdate) {
        const hook = io.beforeSiteUpdate; io.beforeSiteUpdate = null; hook()
      }
      const rows = (io.tables[this.table] ?? []).filter((row) => this.predicates.every((predicate) => predicate(row))).slice(0, this.maximum)
      if (this.patch) rows.forEach((row) => Object.assign(row, this.patch))
      return { data: rows.map((row) => ({ ...row })), error: null }
    }
    async maybeSingle() { const result = this.run(); return { ...result, data: result.data[0] ?? null } }
    then(resolve: (value: ReturnType<Query['run']>) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject) }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: io.proof } }
})
vi.mock('@/lib/onboarding/infoRequests', () => ({ createCustomerInfoRequest: io.create }))
vi.mock('@/lib/customer-operations/manualSupplierInformationRequest', () => ({ queueManualSupplierInformationRequest: io.queue }))

function cir(patch: Row = {}): Row {
  return { id: cirId, company_id: companyId, customer_id: customerId, site_id: siteId, current_supplier_name: 'Synthetic supplier AB',
    request_type: 'current_supplier_contract_info', target_party_type: 'current_supplier', status: 'draft', automation_key: automationKey,
    automation_origin: 'manual_facility_reply', verified_payload: { supplier_id: supplierId }, ...patch }
}
function goir(patch: Row = {}): Row {
  return { id: goirId, company_id: companyId, customer_id: customerId, customer_site_id: siteId,
    request_type: 'current_supplier_contract_information_request', status: 'waiting_manual_response',
    metadata: { supplier_id: supplierId, customer_info_request_id: cirId }, ...patch }
}

beforeEach(() => {
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', actorId)
  io.tables = {
    customers: [{ id: customerId, company_id: companyId, protected_identity: false }],
    customer_sites: [{ id: siteId, company_id: companyId, customer_id: customerId, current_supplier_id: supplierId,
      current_supplier_name: 'Untrusted display alias', current_supplier_response_status: null, metadata: {}, protected_identity: false, is_active: true }],
    electricity_suppliers: [{ id: supplierId, company_id: null, name: 'Synthetic supplier AB', is_active: true }],
    customer_info_requests: [], grid_owner_information_requests: [], supplier_switch_requests: [],
  }
  io.reads = []; io.beforeSiteUpdate = null
  io.proof.mockReset().mockResolvedValue({ data: true, error: null })
  io.create.mockReset().mockImplementation(async (args: Row) => {
    const existing = io.tables.customer_info_requests.find((row) => row.automation_key === args.automationKey)
    if (existing) return { ...existing }
    const row = cir({ verified_payload: {} })
    io.tables.customer_info_requests.push(row)
    return { ...row }
  })
  io.queue.mockReset().mockImplementation(async () => {
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('waiting_response')
    if (!io.tables.grid_owner_information_requests.length) io.tables.grid_owner_information_requests.push(goir())
    return { status: 'queued', requestId: goirId, blockerCode: null }
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('post-facility supplier inquiry continuation', () => {
  it('holds the site and creates a canonical separate supplier request using the registry identity', async () => {
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'waiting_response', requestId: goirId })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('waiting_response')
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ ...input, actorUserId: actorId,
      requestType: 'current_supplier_contract_info', targetPartyType: 'current_supplier', currentSupplierName: 'Synthetic supplier AB',
      requestedDataCategories: ['current_supplier_contract_information'], automationKey, automationOrigin: 'manual_facility_reply' }))
    expect(io.queue).toHaveBeenCalledWith({ ...input, customerInfoRequestId: cirId, actorUserId: actorId })
    expect(io.tables.customer_info_requests[0].verified_payload).toMatchObject({ supplier_id: supplierId })
    expect(io.reads.find((read) => read.table === 'customer_sites')?.filters).toMatchObject({ id: siteId, company_id: companyId, customer_id: customerId })
    expect(io.reads.find((read) => read.table === 'customers')?.filters).toMatchObject({ id: customerId, company_id: companyId })
  })

  it('reuses the exact supplier-bound CIR and GOIR on retry without creating a second inquiry', async () => {
    await ensureManualSupplierInformationForSite(input)
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'waiting_response', requestId: goirId })
    expect(io.create).toHaveBeenCalledTimes(1)
    expect(io.queue).toHaveBeenLastCalledWith({ ...input, customerInfoRequestId: cirId, actorUserId: actorId })
    expect(io.tables.customer_info_requests).toHaveLength(1)
  })

  it('reuses an existing manually created exact CIR only through its supplier-bound conversation', async () => {
    io.tables.customer_info_requests.push(cir({ automation_key: null }))
    io.tables.grid_owner_information_requests.push(goir())
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('waiting_response')
    expect(io.create).not.toHaveBeenCalled()
    expect(io.queue).toHaveBeenCalledWith({ ...input, customerInfoRequestId: cirId, actorUserId: actorId })
  })

  it('does not guess a supplier registry ID from a display name', async () => {
    io.tables.customer_sites[0].current_supplier_id = null
    const result = await ensureManualSupplierInformationForSite(input)
    expect(result).toEqual({ status: 'needs_review', blockerCode: 'supplier_identity_missing' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([{ company_id: 'other-tenant' }, { is_active: false }])('does not use a foreign or inactive supplier %j', async (patch) => {
    Object.assign(io.tables.electricity_suppliers[0], patch)
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('keeps an absent automation actor visible and never invents a user', async () => {
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', undefined)
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'needs_review', blockerCode: 'missing_automation_user' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it.each(['manual_review', 'blocked', 'rejected', 'commercial_blocked', 'requires_review'])('preserves an existing %s hold without queueing', async (status) => {
    io.tables.customer_sites[0].current_supplier_response_status = status
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe(status)
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('allows a verified complete free-to-switch snapshot without another inquiry', async () => {
    const snapshot = { version: 1, companyId, customerId, siteId, terms: { earliestStartDate: '2027-04-01' } }
    Object.assign(io.tables.customer_sites[0], { current_supplier_response_status: 'free_to_switch', metadata: { manual_supplier_terms: snapshot } })
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'ready' })
    expect(io.proof).toHaveBeenCalledWith('gridex_manual_supplier_terms_verified_v1', { p_company_id: companyId, p_customer_id: customerId, p_site_id: siteId, p_snapshot: snapshot })
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([false, null, 'true', 1])('does not trust editable free-to-switch metadata when proof is %j', async (proof) => {
    Object.assign(io.tables.customer_sites[0], { current_supplier_response_status: 'free_to_switch', metadata: { manual_supplier_terms: { version: 1 } } })
    io.proof.mockResolvedValue({ data: proof, error: null })
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('uses the canonical new-request move rule and skips the previous supplier inquiry', async () => {
    io.tables.customer_sites[0].move_in_date = '2027-04-01'
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'not_applicable' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBeNull()
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled(); expect(io.proof).not.toHaveBeenCalled()
    expect(io.reads.find((read) => read.table === 'supplier_switch_requests')?.filters).toMatchObject({ company_id: companyId, customer_id: customerId, site_id: siteId })
  })

  it('does not require a previous supplier identity for a new move-in', async () => {
    Object.assign(io.tables.customer_sites[0], { move_in_date: '2027-04-01', current_supplier_id: null, current_supplier_name: null })
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'not_applicable' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBeNull()
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([
    { request_type: 'move_in' }, { request_type: 'move_out_takeover' },
    { request_type: 'switch', prodat_variant: 'LK' }, { request_type: 'switch', prodat_variant: 'Z03LK' },
    { request_type: 'switch', prodat_variant: 'C' }, { request_type: 'switch', status: 'cancellation_requested' },
  ])('uses the existing durable move/cancellation flow instead of requesting old terms: %j', async (flow) => {
    io.tables.supplier_switch_requests.push({ id: 'existing-switch', company_id: companyId, customer_id: customerId, site_id: siteId,
      status: 'queued', prodat_variant: 'L', ...flow })
    io.tables.customer_sites[0].current_supplier_id = null
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'not_applicable' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBeNull()
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('keeps the supplier inquiry for an existing normal switch even when the site has a move date', async () => {
    io.tables.customer_sites[0].move_in_date = '2027-04-01'
    io.tables.supplier_switch_requests.push({ id: 'existing-switch', company_id: companyId, customer_id: customerId, site_id: siteId,
      request_type: 'switch', status: 'queued', prodat_variant: 'L' })
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('waiting_response')
    expect(io.queue).toHaveBeenCalledOnce()
  })

  it('rejects a conversation bound to another supplier rather than choosing its CIR', async () => {
    io.tables.grid_owner_information_requests.push(goir({ metadata: { supplier_id: 'other-supplier', customer_info_request_id: cirId } }))
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong-site CIR instead of queueing another request', async () => {
    io.tables.grid_owner_information_requests.push(goir())
    io.tables.customer_info_requests.push(cir({ site_id: 'other-site' }))
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([
    { customer_id: 'other-customer' }, { site_id: 'other-site' }, { company_id: 'other-company' },
    { automation_key: 'unrelated-request' }, { verified_payload: { supplier_id: 'other-supplier' } }, { status: 'completed' },
  ])('does not queue a canonical idempotency result with incompatible binding %j', async (patch) => {
    io.create.mockResolvedValue(cir(patch))
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('holds ambiguous active supplier conversations instead of choosing a latest row', async () => {
    io.tables.grid_owner_information_requests.push(goir(), goir({ id: 'another-request' }))
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('stops before queueing if the current supplier changes during canonical CIR creation', async () => {
    io.create.mockImplementation(async () => {
      io.tables.customer_sites[0].current_supplier_id = 'changed-supplier'
      return cir()
    })
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'needs_review', blockerCode: 'supplier_site_changed' })
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('does not call supplier ports for a tenant/customer/site mismatch', async () => {
    io.tables.customer_sites[0].customer_id = 'other-customer'
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled(); expect(io.proof).not.toHaveBeenCalled()
  })

  it('keeps a supplier queue rejection as an explicit site hold', async () => {
    io.queue.mockResolvedValue({ status: 'needs_review', requestId: goirId, blockerCode: 'supplier_contact_not_verified' })
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'needs_review', requestId: goirId, blockerCode: 'supplier_contact_not_verified' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
  })

  it('does not overwrite a concurrently changed site status or queue after its CAS fails', async () => {
    io.beforeSiteUpdate = () => { io.tables.customer_sites[0].current_supplier_response_status = 'blocked' }
    expect((await ensureManualSupplierInformationForSite(input)).status).toBe('needs_review')
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBe('blocked')
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('does not put a site on a supplier hold if it becomes a move-in before the hold CAS', async () => {
    io.beforeSiteUpdate = () => { io.tables.customer_sites[0].move_in_date = '2027-04-01' }
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'needs_review', blockerCode: 'supplier_site_changed' })
    expect(io.tables.customer_sites[0].current_supplier_response_status).toBeNull()
    expect(io.create).not.toHaveBeenCalled(); expect(io.queue).not.toHaveBeenCalled()
  })

  it('stops before queueing if the site becomes a move-in while its CIR is created', async () => {
    io.create.mockImplementation(async () => { io.tables.customer_sites[0].move_in_date = '2027-04-01'; return cir() })
    expect(await ensureManualSupplierInformationForSite(input)).toEqual({ status: 'needs_review', blockerCode: 'supplier_site_changed' })
    expect(io.queue).not.toHaveBeenCalled()
  })
})
