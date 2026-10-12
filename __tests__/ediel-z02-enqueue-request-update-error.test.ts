// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Real parser/linker with finite SDK, actor, worker and event ports.
// Proves failed review persistence handling, not SQL/native/whole acceptance.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'
import { head, source } from './fixtures/prodat-identity'

const io = vi.hoisted(() => ({
  from: vi.fn(), enqueue: vi.fn(), authorize: vi.fn(), event: vi.fn(), tenantFrom: vi.fn(),
  updateError: null as { code: string; message: string } | null,
  order: [] as string[],
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ({ from: io.tenantFrom }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueInboundGridOwnerResponseAutomation: io.enqueue }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.authorize }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: vi.fn() }))

import { applyInboundProdatZ02ToCustomerInfoRequest } from '@/lib/onboarding/inboundEdielLinking'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), request: id(3), customer: id(4), site: id(5),
  point: id(6), message: id(7), operation: id(8), original: id(20), gridRequest: id(21) }
const enqueueError = new Error('DECLARED_ENQUEUE_FAILURE')

function message(variant: 'Z22' | 'Z23') {
  const pointId = '735123456789012345'
  const parts: Parts[] = [...head(), line('1', pointId, undefined, '9'), ...characteristic('Z04', 'Z03'),
    ...characteristic('Z13', variant), ['RFF', ['Z05', 'NET']], ['RFF', ['LI', 'OWN-Z01-LI']],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Fixture Person', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [pointId, '', '9'], '', '', 'Street', 'City', '', '12345', 'SE']]
  return { ...source(raw(parts, 'Z02').replace('+S+R+', '+12345:14+54321:14+'), 'Z02'),
    id: own.message, company_id: own.company, grid_owner_data_request_id: own.gridRequest,
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point }
}

let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
beforeEach(() => {
  vi.resetAllMocks(); io.order.length = 0; io.updateError = null
  tables = { customer_info_requests: [{ id: own.request, company_id: own.company,
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point, operation_id: own.operation,
    grid_owner_data_request_id: own.gridRequest, external_reference: 'OWN-Z01-LI', ediel_message_id: own.original,
    status: 'z01_sent', verified_payload: { protected: true } },
  { id: id(91), company_id: id(90), grid_owner_data_request_id: own.gridRequest,
    status: 'z01_sent', customer_id: id(92), site_id: id(93), verified_payload: { foreign: true } }] }
  const errors: Record<string, { code?: string; message?: string }> = {}
  db = createFakeSupabase({ tables, errorsByTable: errors })
  io.from.mockImplementation((table: string) => {
    if (table !== 'customer_info_requests') throw new Error(`undeclared_table:${table}`)
    const query = db.client.from(table), update = query.update.bind(query)
    query.update = patch => {
      io.order.push('review-update')
      if (io.updateError) errors[table] = io.updateError
      return update(patch)
    }
    return query
  })
  io.authorize.mockImplementation(async () => { io.order.push('actor') })
  io.event.mockImplementation(async (event: { eventStatus?: string }) => { io.order.push(`event:${event.eventStatus}`) })
  io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw enqueueError })
})

describe.each(['Z22', 'Z23'] as const)('Z02 %s returned review-update error', variant => {
  it.each(['42501', '57014', '42P01'])('propagates the actual returned %s before normal catch completion', async code => {
    const failure = Object.freeze({ code, message: 'PRIVATE_UPDATE_MESSAGE', details: 'PRIVATE_UPDATE_DETAILS' })
    io.updateError = failure
    const before = structuredClone(tables)
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(variant) }))
      .rejects.toBe(failure)
    expect(tables).toEqual(before)
    expect(io.order).toEqual(['actor', 'event:info', 'enqueue', 'review-update'])
    expect(io.authorize).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, actorUserId: own.actor, permission: 'metering.write' })
    expect(io.enqueue).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, customerId: own.customer,
      siteId: own.site, meteringPointId: own.point, requestId: own.request, edielMessageId: own.message,
      actorUserId: own.actor, operationId: own.operation })
    const writes = db.calls.filter(call => call.operation !== 'select')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ table: 'customer_info_requests', operation: 'update',
      filters: [{ method: 'eq', column: 'company_id', value: own.company }, { method: 'eq', column: 'id', value: own.request }],
      payload: { status: 'manual_review_required', blocker_code: 'z02_processing_enqueue_failed',
        blocker_reason: 'DECLARED_ENQUEUE_FAILURE', updated_by: own.actor } })
    expect(io.event).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(io.event.mock.calls)).not.toContain('PRIVATE_UPDATE_')
    expect(io.tenantFrom).not.toHaveBeenCalled()
  })

  it('retains normal catch result and diagnostics after the review update actually succeeds', async () => {
    const foreign = structuredClone(tables.customer_info_requests[1])
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(variant) }))
      .toEqual({ applied: false, targetId: own.request, reason: 'z02_processing_enqueue_failed' })
    expect(tables.customer_info_requests[0]).toMatchObject({ status: 'manual_review_required',
      blocker_code: 'z02_processing_enqueue_failed', verified_payload: { protected: true }, ediel_message_id: own.original })
    expect(tables.customer_info_requests[1]).toEqual(foreign)
    expect(io.order).toEqual(['actor', 'event:info', 'enqueue', 'review-update', 'event:error'])
    expect(io.event.mock.calls[1][0]).toMatchObject({ eventStatus: 'error', payload: {
      enqueueFailureClassification: { schemaVersion: 1, sqlState: 'unknown', publicLabel: 'unknown' },
      enqueueFailurePortEvidence: { schemaVersion: 1, operationPort: 'unavailable' },
    } })
  })
})
