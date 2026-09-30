import { beforeEach, describe, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({
  company: '11111111-1111-4111-8111-111111111111', customer: '22222222-2222-4222-8222-222222222222',
  otherCustomer: '22222222-2222-4222-8222-222222222223', site: '33333333-3333-4333-8333-333333333333',
  otherSite: '33333333-3333-4333-8333-333333333334', secondSite: '33333333-3333-4333-8333-333333333335',
  point: '44444444-4444-4444-8444-444444444444', otherPoint: '44444444-4444-4444-8444-444444444445',
  secondPoint: '44444444-4444-4444-8444-444444444446', contract: '55555555-5555-4555-8555-555555555555',
  otherContract: '55555555-5555-4555-8555-555555555556', secondContract: '55555555-5555-4555-8555-555555555557',
  rows: {} as Record<string, Array<Record<string, unknown>>>, inserted: [] as Array<Record<string, unknown>>,
  from: vi.fn(), email: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: f.from } }))
// Only the downstream delivery boundary is observed. No actual sender or
// provider success is qualified by this controlled resource-graph regression.
vi.mock('@/lib/email/emailEvents', () => ({ triggerEmailEvent: f.email }))
import { enqueueCustomerLifecycleNotification, notifyCustomerForLifecycleEvent } from '@/lib/customer-notifications/notificationOrchestrator'

function input() {
  return { companyId: f.company, customerId: f.customer, siteId: f.site, meteringPointId: f.point,
    contractId: f.contract, eventType: 'supplier_switch.confirmed', sourceEventId: 'synthetic-source-event', payload: {} }
}
function database() {
  f.from.mockImplementation((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let ordering: { field: string; ascending: boolean } | null = null, max = Infinity
    const result = () => {
      let data = (f.rows[table] ?? []).filter(row => filters.every(filter => filter(row)))
      if (ordering) {
        const { field, ascending } = ordering
        data = [...data].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (ascending ? 1 : -1))
      }
      return data.slice(0, max)
    }
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
      or: (expression: string) => { filters.push(row => expression.split(',').some(term => {
        const [key, operator, value] = term.split('.'); if (operator !== 'eq') throw new Error('unsupported_proof_filter')
        return row[key] === value
      })); return q },
      order: (field: string, options: { ascending: boolean }) => { ordering = { field, ascending: options.ascending }; return q },
      limit: (value: number) => { max = value; return q },
      insert: (row: Record<string, unknown>) => { f.inserted.push(row); (f.rows[table] ??= []).push({ ...row, id: 'synthetic-job' }); return q },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      single: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) =>
        Promise.resolve({ data: result(), error: null }).then(resolve),
    }
    return q
  })
}

describe('actual lifecycle notification resource graph', () => {
  beforeEach(() => {
    f.from.mockReset(); f.email.mockReset().mockResolvedValue([{ ok: true }]); f.inserted = []
    const base = { company_id: f.company, customer_id: f.customer }
    f.rows = {
      customers: [{ id: f.customer, company_id: f.company, email: 'synthetic@example.invalid', full_name: 'Synthetic Customer', customer_number: 'SYN-1' }],
      companies: [{ id: f.company, name: 'Synthetic company', support_email: 'support@example.invalid' }],
      customer_sites: [{ ...base, id: f.site, facility_id: 'OWN-FACILITY' },
        { ...base, id: f.secondSite, facility_id: 'SECOND-FACILITY' },
        { ...base, customer_id: f.otherCustomer, id: f.otherSite, facility_id: 'FOREIGN-FACILITY' }],
      metering_points: [{ ...base, id: f.point, site_id: f.site, metering_point_id: 'OWN-POINT' },
        { ...base, id: f.secondPoint, site_id: f.secondSite, metering_point_id: 'SECOND-POINT' },
        { ...base, customer_id: f.otherCustomer, id: f.otherPoint, site_id: f.otherSite, metering_point_id: 'FOREIGN-POINT' }],
      customer_contracts: [{ ...base, id: f.contract, site_id: f.site, customer_site_id: f.site, metering_point_id: f.point,
        contract_name: 'Own contract', starts_at: '2026-10-01', created_at: '2026-09-01' },
      { ...base, id: f.secondContract, site_id: f.secondSite, customer_site_id: f.secondSite, metering_point_id: f.secondPoint,
        contract_name: 'Second contract', starts_at: '2026-12-01', created_at: '2026-09-02' },
      { ...base, customer_id: f.otherCustomer, id: f.otherContract, site_id: f.otherSite, customer_site_id: f.otherSite,
        metering_point_id: f.otherPoint, contract_name: 'Foreign contract', starts_at: '2027-01-01', created_at: '2026-09-03' }],
      customer_supply_periods: [{ ...base, id: 'own-period', metering_point_id: f.point, contract_id: f.contract, customer_contract_id: f.contract, start_date: '2026-10-02' },
        { ...base, id: 'second-period', metering_point_id: f.secondPoint, contract_id: f.secondContract, customer_contract_id: f.secondContract, start_date: '2027-12-01' }],
      customer_operation_jobs: [],
    }
    database()
  })

  it.each([
    { siteId: f.otherSite }, { meteringPointId: f.otherPoint }, { contractId: f.otherContract },
    { meteringPointId: f.secondPoint }, { contractId: f.secondContract }, { siteId: 'missing-site' },
  ])('blocks supplied foreign/missing resource %j before delivery or durable enqueue', async patch => {
    const forged = { ...input(), ...patch }
    await expect(notifyCustomerForLifecycleEvent(forged)).resolves.toMatchObject({ queued: false, skippedReason: 'notification_resource_scope_mismatch' })
    expect(f.email).not.toHaveBeenCalled()
    await expect(enqueueCustomerLifecycleNotification(forged)).resolves.toMatchObject({ queued: false, skippedReason: 'notification_resource_scope_mismatch' })
    expect(f.inserted).toHaveLength(0)
  })

  it('uses the linked point/contract period instead of a newer period from the same customer second site', async () => {
    await expect(notifyCustomerForLifecycleEvent(input())).resolves.toMatchObject({ queued: true })
    expect(f.email).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      variables: expect.objectContaining({ start_date: '2026-10-02', facility_id: 'OWN-FACILITY', metering_point_id: 'OWN-POINT', contract_name: 'Own contract' }),
      metadata: expect.objectContaining({ contract_id: f.contract, supply_period_id: 'own-period' }),
    }))
  })

  it('resolves an omitted contract within the supplied site instead of the latest other-site contract', async () => {
    await notifyCustomerForLifecycleEvent({ ...input(), contractId: null })
    expect(f.email).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      variables: expect.objectContaining({ contract_name: 'Own contract' }),
      metadata: expect.objectContaining({ contract_id: f.contract }),
    }))
  })

  it('does not let payload metadata forge canonical resource attribution', async () => {
    await notifyCustomerForLifecycleEvent({ ...input(), payload: { contract_id: f.otherContract, supply_period_id: 'foreign-period',
      source_event_id: 'forged-source', source_event_type: 'forged-type' } })
    expect(f.email).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ metadata: expect.objectContaining({
      contract_id: f.contract, supply_period_id: 'own-period', source_event_id: input().sourceEventId, source_event_type: input().eventType,
    }) }))
  })

  it('rechecks the resource graph before accepting an existing permanent job as replay', async () => {
    f.rows.customer_operation_jobs.push({ id: 'prior-job', company_id: f.company, customer_id: f.customer,
      customer_site_id: f.otherSite, metering_point_id: f.otherPoint, job_type: 'dispatch_lifecycle_notification', status: 'completed',
      idempotency_key: `lifecycle_notification:${input().sourceEventId}:switch.confirmed` })
    await expect(enqueueCustomerLifecycleNotification({ ...input(), siteId: f.otherSite, meteringPointId: f.otherPoint }))
      .resolves.toMatchObject({ queued: false, skippedReason: 'notification_resource_scope_mismatch' })
    expect(f.inserted).toHaveLength(0)
  })

  it('preserves one durable same-payload intent, including terminal replay', async () => {
    const first = { ...input(), payload: { message: 'Approved event', nested: { a: 1, b: 2 } } }
    await expect(enqueueCustomerLifecycleNotification(first)).resolves.toMatchObject({ queued: true, jobId: 'synthetic-job' })
    f.rows.customer_operation_jobs[0].status = 'completed'
    await expect(enqueueCustomerLifecycleNotification({ ...first, payload: { nested: { b: 2, a: 1 }, message: 'Approved event' } }))
      .resolves.toMatchObject({ queued: true, jobId: 'synthetic-job' })
    expect(f.inserted).toHaveLength(1)
    expect(f.rows.customer_operation_jobs[0].status).toBe('completed')
  })

  it.each([
    { payload: { message: 'Changed approved event' } },
    { siteId: f.secondSite, meteringPointId: f.secondPoint, contractId: f.secondContract },
  ])('rejects same permanent event key with changed valid payload or resource graph %j', async patch => {
    await enqueueCustomerLifecycleNotification(input())
    const before = structuredClone(f.rows.customer_operation_jobs)
    await expect(enqueueCustomerLifecycleNotification({ ...input(), ...patch }))
      .resolves.toMatchObject({ queued: false, skippedReason: 'notification_idempotency_conflict' })
    expect(f.rows.customer_operation_jobs).toEqual(before)
    expect(f.inserted).toHaveLength(1)
  })
})
