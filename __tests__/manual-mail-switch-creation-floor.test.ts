import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import { createSupplierSwitchRequest } from '@/lib/operations/db.part-2'

const servicePort = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: servicePort.rpc } }))

const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '10000000-0000-4000-8000-000000000002'
const siteId = '10000000-0000-4000-8000-000000000003'
const pointId = '10000000-0000-4000-8000-000000000004'
const inboundId = '10000000-0000-4000-8000-000000000005'
const sourceHash = 'a'.repeat(64)
type Row = Record<string, unknown>

function site(patch: Row = {}): CustomerSiteRow {
  return {
    id: siteId, customer_id: customerId, company_id: companyId, site_name: 'Synthetic site', facility_id: '735999100000000001',
    site_type: 'consumption', status: 'active', grid_owner_id: null, price_area_code: null, move_in_date: null,
    annual_consumption_kwh: null, current_supplier_name: 'Synthetic previous supplier', current_supplier_org_number: null,
    current_supplier_contract_end_date: null, current_supplier_notice_period: null, current_supplier_response_status: null,
    street: null, care_of: null, postal_code: null, city: null, country: 'SE', moved_from_street: null,
    moved_from_postal_code: null, moved_from_city: null, moved_from_supplier_name: null, internal_notes: null,
    created_at: '2027-01-01T00:00:00Z', updated_at: '2027-01-01T00:00:00Z', created_by: null, updated_by: null, ...patch,
  } as CustomerSiteRow
}

const point = {
  id: pointId, company_id: companyId, customer_id: customerId, site_id: siteId, customer_site_id: siteId,
  meter_point_id: '735999100000000001', site_facility_id: '735999100000000001', ediel_reference: null, status: 'active',
  measurement_type: 'consumption', reading_frequency: 'hourly', grid_owner_id: null, price_area_code: null,
  start_date: null, end_date: null, is_settlement_relevant: true,
  created_at: '2027-01-01T00:00:00Z', updated_at: '2027-01-01T00:00:00Z', created_by: null, updated_by: null,
} as MeteringPointRow

function snapshot(terms: Row = { effectiveStartDate: '2027-04-01' }, patch: Row = {}): Row {
  return { version: 1, inboundId, sourceHash, receivedAt: '2027-01-30T12:00:00.000Z', companyId, customerId, siteId, requestId: '10000000-0000-4000-8000-000000000007', terms, ...patch }
}

function database(currentSite: CustomerSiteRow | null, proofFloor: string | null = '2027-04-01', proofError: string | null = null, snapshotProof: unknown = true, snapshotProofError: string | null = null, errors: { siteRead?: string; create?: string } = {}) {
  const writes: Row[] = []
  const proofCalls: Row[] = []
  const snapshotProofCalls: Row[] = []
  const callerPrivateCalls: string[] = []
  const operations: string[] = []
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = []
  servicePort.rpc.mockReset().mockImplementation(async (name: string, args: Row) => {
    if (name === 'gridex_manual_supplier_start_floor_v1') {
      operations.push('service:floor-proof')
      proofCalls.push(args)
      return { data: proofFloor, error: proofError ? { message: proofError } : null }
    }
    if (name === 'gridex_manual_supplier_terms_verified_v1') {
      operations.push('service:snapshot-proof')
      snapshotProofCalls.push(args)
      return { data: snapshotProof, error: snapshotProofError ? { message: snapshotProofError } : null }
    }
    throw new Error(`Service port cannot perform caller operation: ${name}`)
  })
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000006' } }, error: null }) },
    from(table: string) {
      const filters: Record<string, unknown> = {}
      reads.push({ table, filters })
      const result = () => {
        if (table === 'electricity_suppliers') return { data: { id: 'own', name: 'Synthetic tenant supplier', company_id: companyId, org_number: null }, error: null }
        if (table === 'customer_sites') {
          operations.push('caller:scoped-site-read')
          return { data: errors.siteRead ? null : currentSite, error: errors.siteRead ? { code: '42501', message: errors.siteRead } : null }
        }
        if (table === 'customer_lifecycle_decisions' || table === 'customer_operation_tasks') return { data: [], error: null }
        throw new Error(`Undeclared database table: ${table}`)
      }
      const query = {
        select() { return query },
        eq(field: string, value: unknown) { filters[field] = value; return query },
        in() { return query }, order() { return query }, limit() { return query },
        maybeSingle: async () => result(),
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return query
    },
    async rpc(name: string, args: Row) {
      if (name === 'gridex_manual_supplier_start_floor_v1' || name === 'gridex_manual_supplier_terms_verified_v1') {
        callerPrivateCalls.push(name)
        return { data: null, error: { code: '42501', message: `permission denied for function ${name}` } }
      }
      if (name !== 'gridex_create_supplier_switch_v1') throw new Error(`Undeclared database RPC: ${name}`)
      operations.push('caller:canonical-create')
      if (errors.create) return { data: null, error: { code: '42501', message: errors.create } }
      writes.push(args)
      return { data: { request: { id: 'created-switch', ...(args.p_request as Row) } }, error: null }
    },
  } as unknown as SupabaseClient
  return { client, writes, reads, proofCalls, snapshotProofCalls, callerPrivateCalls, operations }
}

async function create(db: ReturnType<typeof database>, callerSite = site(), requestType: 'switch' | 'move_in' = 'switch') {
  return createSupplierSwitchRequest(db.client, {
    companyId, site: callerSite, meteringPoint: point, requestType, requestedStartDate: '2027-02-01',
    readiness: { customerId, siteId, siteName: 'Synthetic site', candidateMeteringPointId: pointId, latestPowerOfAttorneyId: null, isReady: true, issues: [] },
  })
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-31T12:00:00.000Z')) })
afterEach(() => vi.useRealTimers())

describe('supplier-mail floors at actual switch creation', () => {
  it('loads the current scoped site before creating a switch from a stale job', async () => {
    const db = database(site({ metadata: { manual_supplier_terms: snapshot() } }))
    const result = await create(db)
    expect(result.requested_start_date).toBe('2027-04-01')
    expect(db.reads.find((read) => read.table === 'customer_sites')?.filters).toEqual({ id: siteId, company_id: companyId, customer_id: customerId })
    expect(db.proofCalls).toEqual([{ p_company_id: companyId, p_customer_id: customerId, p_site_id: siteId }])
    expect(db.snapshotProofCalls).toHaveLength(0)
    expect(db.callerPrivateCalls).toEqual([])
    expect(db.operations).toEqual(['caller:scoped-site-read', 'service:floor-proof', 'caller:canonical-create'])
    expect(db.writes[0]).toMatchObject({
      p_company_id: companyId,
      p_request: {
        company_id: companyId, customer_id: customerId, site_id: siteId, requested_start_date: '2027-04-01',
        validation_snapshot: {
          startDateCalculation: { floors: expect.arrayContaining([{ source: 'supplier_confirmed_start', date: '2027-04-01' }]) },
          manualSupplierTerms: { version: 1, inboundId, sourceHash, receivedAt: '2027-01-30T12:00:00.000Z' },
        },
      },
    })
  })

  it('accepts an explicit confirmed earliest start without restarting a fulfilled notice period', async () => {
    const accepted = snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' })
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: accepted },
    }), '2027-02-15')
    expect((await create(db)).requested_start_date).toBe('2027-02-15')
    expect(db.snapshotProofCalls).toEqual([{ p_company_id: companyId, p_customer_id: customerId, p_site_id: siteId, p_snapshot: accepted }])
    expect(db.callerPrivateCalls).toEqual([])
    expect(db.operations).toEqual(['caller:scoped-site-read', 'service:floor-proof', 'service:snapshot-proof', 'caller:canonical-create'])
  })

  it.each(['received', null])('retains the current notice countdown without free-to-switch status: %s', async (status) => {
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: status,
      metadata: { manual_supplier_terms: snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' }) },
    }), '2027-02-15')
    expect((await create(db)).requested_start_date).toBe('2027-04-30')
  })

  it('retains notice when the stored start was derived only from contract end', async () => {
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: snapshot({ effectiveStartDate: '2027-02-15' }) },
    }), '2027-02-15')
    expect((await create(db)).requested_start_date).toBe('2027-04-30')
  })

  it.each([
    { version: 2 }, { inboundId: '' }, { sourceHash: 'wrong' }, { receivedAt: 'yesterday' },
    { terms: { earliestStartDate: '2027-02-29', effectiveStartDate: '2027-02-29' } },
  ])('does not bypass notice using an unverified snapshot: %j', async (invalid) => {
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' }, invalid) },
    }), null)
    expect((await create(db)).requested_start_date).toBe('2027-04-30')
  })

  it('does not consume caller-only metadata when it is absent from the loaded site', async () => {
    const db = database(site({ current_supplier_notice_period: '3 månader' }), null)
    const stale = site({ current_supplier_response_status: 'free_to_switch', metadata: { manual_supplier_terms: snapshot({ earliestStartDate: '2027-02-15' }) } })
    expect((await create(db, stale)).requested_start_date).toBe('2027-04-30')
  })

  it.each([null, site({ company_id: 'other-tenant' }), site({ customer_id: 'other-customer' }), site({ id: 'other-site' })])
  ('does not create a request when the reloaded site no longer matches its scope', async (currentSite) => {
    const db = database(currentSite)
    await expect(create(db)).rejects.toThrow('supplier_switch_site_scope_mismatch')
    expect(db.writes).toHaveLength(0)
    expect(db.proofCalls).toEqual([])
    expect(db.snapshotProofCalls).toEqual([])
    expect(db.callerPrivateCalls).toEqual([])
    expect(db.operations).toEqual(['caller:scoped-site-read'])
  })

  it('never calls private service proofs after a denied caller site read', async () => {
    const db = database(site(), '2027-04-01', null, true, null, { siteRead: 'caller cannot read this site' })
    await expect(create(db)).rejects.toMatchObject({ code: '42501', message: 'caller cannot read this site' })
    expect(db.operations).toEqual(['caller:scoped-site-read'])
    expect(db.proofCalls).toEqual([])
    expect(db.snapshotProofCalls).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('preserves caller authorization for canonical creation after private read-only proofs', async () => {
    const db = database(site(), '2027-04-01', null, true, null, { create: 'caller cannot create this switch' })
    await expect(create(db)).rejects.toMatchObject({ code: '42501', message: 'caller cannot create this switch' })
    expect(db.operations).toEqual(['caller:scoped-site-read', 'service:floor-proof', 'caller:canonical-create'])
    expect(db.callerPrivateCalls).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('preserves move-in behavior without importing an old supplier floor', async () => {
    const caller = site({ move_in_date: '2027-02-01', metadata: { manual_supplier_terms: snapshot() } })
    const db = database(caller)
    expect((await create(db, caller, 'move_in')).requested_start_date).toBe('2027-02-01')
    expect(db.proofCalls).toHaveLength(0)
    expect(db.snapshotProofCalls).toHaveLength(0)
  })

  it('does not waive notice when valid-looking metadata lacks applied inbound proof', async () => {
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' }) },
    }), null)
    expect((await create(db)).requested_start_date).toBe('2027-04-30')
  })

  it('fails closed when the authoritative supplier-floor query fails', async () => {
    const db = database(site(), null, 'source proof unavailable')
    await expect(create(db)).rejects.toMatchObject({ message: 'source proof unavailable' })
    expect(db.writes).toHaveLength(0)
  })

  it.each([false, null, 'true', 1, {}])('does not waive notice for a forged earliest date matching a real floor when snapshot proof is %j', async (snapshotProof) => {
    const forged = snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' })
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: forged },
    }), '2027-02-15', null, snapshotProof)
    const result = await create(db)
    expect(result.requested_start_date).toBe('2027-04-30')
    expect(db.snapshotProofCalls).toEqual([{ p_company_id: companyId, p_customer_id: customerId, p_site_id: siteId, p_snapshot: forged }])
  })

  it('fails closed before creation when complete supplier snapshot verification fails', async () => {
    const db = database(site({
      current_supplier_notice_period: '3 månader', current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: snapshot({ earliestStartDate: '2027-02-15', effectiveStartDate: '2027-02-15' }) },
    }), '2027-02-15', null, null, 'snapshot proof unavailable')
    await expect(create(db)).rejects.toMatchObject({ message: 'snapshot proof unavailable' })
    expect(db.writes).toHaveLength(0)
  })
})
