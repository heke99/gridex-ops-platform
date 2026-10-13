// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Component regression: actual worker and evidence/identity validators; declared
// external database and successor/event ports. No native or whole-ID credit.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { MeteringPointRow } from '@/lib/masterdata/types'

const io = vi.hoisted(() => ({
  message: null as EdielMessageRow | null,
  points: [] as MeteringPointRow[],
  enqueues: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async () => structuredClone(io.message) }))
vi.mock('@/lib/operations/db', () => ({ listMeteringPointsForSite: async () => structuredClone(io.points) }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({
  emitCustomerOperationEvent: async (input: Record<string, unknown>) => { io.events.push(structuredClone(input)) },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (table !== 'grid_owner_information_requests') throw Error('undeclared_database_port')
    const query = {
      select() { return query }, eq() { return query }, in() { return query },
      order() { return query }, limit() { return query },
      maybeSingle: async () => ({ data: null, error: null }),
    }
    return query
  },
} }))
vi.mock('@/lib/customer-operations/automation.part-1', async original => {
  const actual = await original<typeof import('@/lib/customer-operations/automation.part-1')>()
  return { ...actual, enqueueSupplierSwitchAutomation: async (input: Record<string, unknown>) => {
    io.enqueues.push(structuredClone(input))
    return { id: '00000000-0000-4000-8000-000000000010', status: 'queued' }
  } }
})
import { processInboundResponse } from '@/lib/customer-operations/automation.part-2'
import { canonicalAtomicZ02JobResult } from '@/lib/customer-operations/z02AtomicEvidence'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const core = () => ({ ok: true, requestId: id(5), messageId: id(6), customerId: id(2),
  customerSiteId: id(3), meteringPointRecordId: id(4), meteringPointExternalId: '735123456789012345',
  facilityId: '735123456789012345', gridAreaCode: 'NET', priceAreaCode: 'SE3', atomicCoreApply: true })
const evidence = () => ({ z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
  z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true, z02_atomic_core: core(),
  request_evidence: { originating_message_id: id(7), source_hash: 'a'.repeat(64) } })
const job = (): JobRow => ({ id: id(8), company_id: id(1), customer_id: id(2), customer_site_id: id(3),
  metering_point_id: id(4), operation_id: id(9), created_by: id(11),
  job_type: 'apply_inbound_grid_owner_response', status: 'running', priority: 5,
  idempotency_key: `inbound-grid-owner-response:${id(6)}`, attempts: 1, max_attempts: 3,
  run_after: '2026-10-12T22:00:00Z', locked_at: '2026-10-12T22:00:00Z',
  locked_by: 'declared-worker', lock_token: id(13), last_error: null,
  payload: { customer_info_request_id: id(5), ediel_message_id: id(6) }, result: evidence() })

beforeEach(() => {
  io.enqueues = []; io.events = []
  io.message = { id: id(6), company_id: id(1), customer_id: id(2), site_id: id(3),
    related_message_id: id(7) } as EdielMessageRow
  io.points = [{ id: id(4), company_id: id(1), customer_id: id(2), site_id: id(3),
    meter_point_id: '735123456789012345', status: 'active', verification_status: 'verified',
    data_quality_status: 'verified' }] as MeteringPointRow[]
})

describe('Z02 worker retains its canonical gate receipt after finalization', () => {
  it('completed output remains readable as canonical evidence without changing the input receipt', async () => {
    const input = job(), before = structuredClone(input)
    const outcome = await processInboundResponse(input)
    expect(outcome.status).toBe('completed')
    expect(outcome.result).toMatchObject({ reason: 'z02_atomic_core_finalized',
      z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true,
      z02_atomic_core: core(), request_evidence: { originating_message_id: id(7), source_hash: 'a'.repeat(64) } })
    expect(canonicalAtomicZ02JobResult(outcome.result ?? null)).toEqual(core())
    expect(input).toEqual(before)
    expect(io.enqueues).toHaveLength(1)
    expect(io.enqueues[0]).toMatchObject({ companyId: id(1), customerId: id(2), siteId: id(3),
      meteringPointId: id(4), actorUserId: id(11), source: 'z02_market_verified' })
  })

  it.each(['z02_correlation_status', 'z02_payload_validation_status', 'z02_snapshot_freshness_status',
    'z02_atomic_core_applied', 'z02_atomic_core'] as const)('missing %s cannot finalize or enqueue a successor', async key => {
    const input = job(); delete input.result![key]
    const outcome = await processInboundResponse(input)
    expect(outcome.status).toBe('needs_review')
    expect(canonicalAtomicZ02JobResult(outcome.result ?? null)).toBeNull()
    expect(io.enqueues).toEqual([]); expect(io.events).toEqual([])
  })

  it('current wrong-tenant message still refuses a successor despite complete historical gates', async () => {
    io.message!.company_id = id(12)
    const outcome = await processInboundResponse(job())
    expect(outcome).toMatchObject({ status: 'needs_review', result: { reason: 'z02_atomic_message_link_mismatch' } })
    expect(io.enqueues).toEqual([]); expect(io.events).toEqual([])
  })

  it('current unverified point still refuses a successor despite complete historical gates', async () => {
    io.points[0].verification_status = 'unverified'
    const outcome = await processInboundResponse(job())
    expect(outcome).toMatchObject({ status: 'needs_review', result: { reason: 'z02_atomic_metering_point_not_verified' } })
    expect(io.enqueues).toEqual([]); expect(io.events).toEqual([])
  })
})
