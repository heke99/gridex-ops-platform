import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as { table: string; patch: Record<string, unknown> }[],
  complete: vi.fn(),
  emit: vi.fn(),
}))

// The external database port models persisted rows so an unguarded adapter
// update is observable even when the canonical completion later rejects it.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: [string, unknown][] = []
  let patch: Record<string, unknown> | null = null
  const execute = () => {
    const rows = (io.rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
    if (patch) {
      io.writes.push({ table, patch: structuredClone(patch) })
      for (const row of rows) Object.assign(row, patch)
    }
    return rows
  }
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    update: (value: Record<string, unknown>) => { patch = value; return query },
    limit: async (count: number) => ({ data: execute().slice(0, count), error: null }),
    maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
  }
  return query
} } }))
vi.mock('@/lib/customer-operations/facilityResponseOrchestrator', () => ({ completeFacilityLookupAndRunNextSteps: io.complete }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: io.emit }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: vi.fn(), emitFacilityLookupCompletedEvent: vi.fn() }))
vi.mock('@/lib/customer-operations/customerProcessNextStepEngine', () => ({ evaluateAndRunNextCustomerStep: vi.fn() }))

import { applyManualFacilityResponse } from '@/lib/customer-operations/manualFacilityResponseParser'
import { FacilityLookupPostCommitError } from '@/lib/facility/facilityLookupWorkflow'

type Input = Parameters<typeof applyManualFacilityResponse>[0]

function input(): Input {
  return {
    companyId: 'tenant-a',
    request: structuredClone(io.rows.grid_owner_information_requests[0]),
    extracted: { facility_id: '735999100000000001', metering_point_id: '735999100000000002', grid_area_code: 'LKR', price_area_code: 'SE4', annual_consumption: '12 500 kWh' },
    rawPayload: { provider_message_id: 'provider-a', source: 'authenticated-email' },
    senderCredible: true,
    automaticInbound: { inboundId: 'mail-a', sourceHash: 'a'.repeat(64), facts: { annualConsumptionKwh: 12500, meteringMethod: 'hourly' } },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.writes = []
  io.rows = {
    customer_sites: [{ id: 'site-a', company_id: 'tenant-a', customer_id: 'customer-a', facility_id: null, grid_area_code: 'LKR', price_area_code: 'SE4', grid_owner_id: 'owner-a', protected_identity: false }],
    platform_grid_areas: [{ id: 'area-a', grid_area_code: 'LKR', grid_owner_id: 'owner-a', price_area: 'SE4', is_active: true }],
    grid_owner_information_requests: [{ id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', grid_owner_id: 'owner-a', status: 'waiting_manual_response', parsed_payload: { prior_evidence: true }, metadata: {} }],
  }
  io.complete.mockResolvedValue({ ok: true, requestId: 'request-a', status: 'completed', intakeDecision: { state: 'ready_for_supplier_switch' }, supplierSwitchResult: { decision: 'prepare_supplier_switch' } })
})

describe('automatic facility reply adapter', () => {
  it('hands source identity, normalized facts and raw evidence to one canonical completion without separate request writes', async () => {
    const result = await applyManualFacilityResponse(input())

    expect(result).toMatchObject({ outcome: 'applied', reasons: [], nextStepDecision: 'prepare_supplier_switch' })
    expect(io.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      companyId: 'tenant-a', requestId: 'request-a', facilityId: '735999100000000001', meteringPointId: '735999100000000002', gridAreaCode: 'LKR', priceAreaCode: 'SE4',
      automaticInbound: { inboundId: 'mail-a', sourceHash: 'a'.repeat(64), facts: { annualConsumptionKwh: 12500, meteringMethod: 'hourly' } },
      rawPayload: { provider_message_id: 'provider-a', source: 'authenticated-email', extracted: { facility_id: '735999100000000001', metering_point_id: '735999100000000002', grid_area_code: 'LKR', price_area_code: 'SE4', annual_consumption: '12 500 kWh' } },
    }))
    expect(io.writes).toEqual([])
    expect(io.emit).not.toHaveBeenCalled()
  })

  it.each([
    ['needs_review', 'reply_on_hold'],
    ['completed', 'request_already_completed'],
  ])('preserves %s and its existing evidence when the locked source-aware command denies the reply', async (status, blockerCode) => {
    Object.assign(io.rows.grid_owner_information_requests[0], { status, metadata: { counterparty_reply: { hold: true } } })
    const before = structuredClone(io.rows.grid_owner_information_requests[0])
    io.complete.mockResolvedValue({ ok: false, blockerCode, intakeDecision: null, supplierSwitchResult: null })

    const result = await applyManualFacilityResponse(input())

    expect(result).toMatchObject({ outcome: 'needs_review', reasons: [blockerCode] })
    expect(io.rows.grid_owner_information_requests[0]).toEqual(before)
    expect(io.writes).toEqual([])
    expect(io.emit).not.toHaveBeenCalled()
  })

  it.each([
    ['protected identity', 'protected_identity', { protected_identity: true }],
    ['different customer', 'request_site_customer_mismatch', { customer_id: 'customer-b' }],
    ['conflicting facility', 'facility_id_conflict', { facility_id: '735999100000000009' }],
  ])('returns review without request writes or completion for %s', async (_name, reason, sitePatch) => {
    Object.assign(io.rows.customer_sites[0], sitePatch)
    const before = structuredClone(io.rows.grid_owner_information_requests[0])

    const result = await applyManualFacilityResponse(input())

    expect(result.outcome).toBe('needs_review')
    expect(result.reasons).toContain(reason)
    expect(io.complete).not.toHaveBeenCalled()
    expect(io.rows.grid_owner_information_requests[0]).toEqual(before)
    expect(io.writes).toEqual([])
    expect(io.emit).not.toHaveBeenCalled()
  })

  it('keeps a foreign tenant site out of automatic completion', async () => {
    io.rows.customer_sites[0].company_id = 'tenant-b'

    const result = await applyManualFacilityResponse(input())

    expect(result).toMatchObject({ outcome: 'needs_review', reasons: expect.arrayContaining(['site_not_found']) })
    expect(io.complete).not.toHaveBeenCalled()
    expect(io.writes).toEqual([])
  })

  it('propagates a committed completion continuation failure without erasing committed proof or turning it into terminal review', async () => {
    const failure = new FacilityLookupPostCommitError('tenant-a', 'request-a', {
      ok: true, requestId: 'request-a', status: 'completed', facilityId: '735999100000000001', meteringPointId: null,
      meteringPointRecordId: 'meter-a', customerId: 'customer-a', customerSiteId: 'site-a', operationId: 'operation-a', nextStep: null,
    }, new Error('temporary continuation failure'))
    io.complete.mockRejectedValue(failure)
    const before = structuredClone(io.rows.grid_owner_information_requests[0])

    await expect(applyManualFacilityResponse(input())).rejects.toBe(failure)

    expect(io.rows.grid_owner_information_requests[0]).toEqual(before)
    expect(io.writes).toEqual([])
    expect(io.emit).not.toHaveBeenCalled()
  })

  it('propagates a transient completion exception so ingestion can retry rather than downgrade the request', async () => {
    const failure = new Error('temporary database transport failure')
    io.complete.mockRejectedValue(failure)

    await expect(applyManualFacilityResponse(input())).rejects.toBe(failure)

    expect(io.writes).toEqual([])
    expect(io.emit).not.toHaveBeenCalled()
  })
})
