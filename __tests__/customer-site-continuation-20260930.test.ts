import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'

const fixture = vi.hoisted(() => ({
  company: '11111111-1111-4111-8111-111111111111', customer: '22222222-2222-4222-8222-222222222222',
  site: '33333333-3333-4333-8333-333333333333', actor: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555', request: '66666666-6666-4666-8666-666666666666',
  owner: '77777777-7777-4777-8777-777777777777', operation: '88888888-8888-4888-8888-888888888888',
  rows: [] as Array<Record<string, unknown>>, from: vi.fn(), dispatch: vi.fn(), resolve: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: fixture.from } }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({
  evaluateSiteFacilityIdentity: vi.fn().mockResolvedValue({ siteExists: true, facilityReady: true }),
  resumeCustomerIntake: vi.fn(),
}))
vi.mock('@/lib/onboarding/infoRequests', () => ({ createCustomerInfoRequest: vi.fn(), queueCustomerInfoRequestForDispatch: fixture.dispatch }))
vi.mock('@/lib/customer-operations/automation.part-1', async (load) => ({
  ...await load<typeof import('@/lib/customer-operations/automation.part-1')>(),
  resolveCustomerSiteGridOwner: fixture.resolve,
  setOperationSnapshotRequestReference: vi.fn().mockResolvedValue(null),
}))
import { processCustomerDataRequest } from '@/lib/customer-operations/automation.part-2'

function job(): JobRow {
  return { id: fixture.job, company_id: fixture.company, customer_id: fixture.customer, customer_site_id: fixture.site,
    metering_point_id: null, operation_id: fixture.operation, job_type: 'request_customer_data', status: 'running',
    priority: 20, idempotency_key: `customer-data:${fixture.customer}:${fixture.site}`, payload: { requestedFrom: 'customer_site_command' },
    result: {}, attempts: 1, max_attempts: 5, run_after: '2026-09-30T12:00:00Z', locked_at: null, locked_by: null,
    last_error: null, created_by: fixture.actor }
}

describe('site customer-data intent consumer reports the actual readiness boundary', () => {
  beforeEach(() => {
    fixture.rows = []
    fixture.from.mockReset().mockImplementation((table: string) => {
      const result = { data: table === 'customer_info_requests' ? { id: fixture.request } : null, error: null }
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => result, update: () => query,
        insert: async (row: Record<string, unknown>) => {
          if (table !== 'customer_operation_events') throw new Error(`unexpected_insert:${table}`)
          fixture.rows.push(row)
          return { data: null, error: null }
        },
        then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
      }
      return query
    })
    fixture.resolve.mockReset().mockResolvedValue({ state: 'verified', result: { gridOwnerId: fixture.owner } })
    fixture.dispatch.mockReset().mockResolvedValue({ status: 'z01_prepared', gridOwnerDataRequestId: null,
      outboundRequestId: null, routeProfileId: null, blockerCode: null, blockerDetails: null })
  })

  it('persists needs_review for prepared Z01 until the independent send guard permits dispatch', async () => {
    const outcome = await processCustomerDataRequest(job())
    expect(outcome).toMatchObject({ status: 'needs_review', result: { reason: 'z01_prepared_pending_send_guard' } })
    expect(fixture.rows).toHaveLength(1)
    expect(fixture.rows[0]).toMatchObject({ company_id: fixture.company, customer_id: fixture.customer,
      customer_site_id: fixture.site, customer_operation_job_id: fixture.job,
      event_code: 'customer_data.z01_prepared', status: 'needs_review', action_required: true, severity: 'warning' })
  })

  it.each(['sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'])(
    'reports waiting_response only after actual %s dispatch outcome', async (status) => {
      fixture.dispatch.mockResolvedValue({ status, gridOwnerDataRequestId: null, outboundRequestId: null,
        routeProfileId: null, blockerCode: null, blockerDetails: null })
      await expect(processCustomerDataRequest(job())).resolves.toMatchObject({ status: 'waiting_response' })
      expect(fixture.rows[0]).toMatchObject({ status: 'waiting_response', action_required: false })
    },
  )

  it('retains the exact tenant/site blocker when the consumer cannot pass the dispatch gate', async () => {
    fixture.dispatch.mockResolvedValue({ status: 'route_missing', gridOwnerDataRequestId: null, outboundRequestId: null,
      routeProfileId: null, blockerCode: 'operational_route_missing', blockerDetails: null })
    await expect(processCustomerDataRequest(job())).resolves.toMatchObject({ status: 'needs_review',
      result: { reason: 'operational_route_missing' } })
    expect(fixture.rows[0]).toMatchObject({ customer_site_id: fixture.site, event_code: 'customer_data.needs_review',
      status: 'needs_review', action_required: true })
  })
})
