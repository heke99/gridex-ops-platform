// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-10 a rejected or answered Z13 history request is sent again every billing run)
// lib/billing/historyRequest.ts ensureHistoricalMeteringRequest, which the monthly billing engine calls for every
// segment it cannot estimate (generateBillingUnderlaysForMonth, every 6 hours via /api/cron/billing/monthly). The
// fake database answers the permission lookups by status. Synthetic ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ permissions: [] as Array<{ id: string; status: string }>,
  createDraft: vi.fn(async () => ({ id: 'perm-new' })), queueZ13: vi.fn(async () => ({})), createTask: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => {
  let statuses: string[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'limit']) builder[method] = () => builder
  builder.in = (_column: string, values: string[]) => { statuses = values; return builder }
  builder.maybeSingle = async () => ({ data: { grid_owner_id: 'go-1' }, error: null })
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: io.permissions.filter(p => statuses.includes(p.status)).slice(0, 1), error: null })
  return builder
} } }))
vi.mock('@/lib/onboarding/infoRequests', () => ({ createMeteringPermissionDraft: io.createDraft, queueMeteringPermissionForZ13: io.queueZ13 }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: io.createTask }))

import { ensureHistoricalMeteringRequest } from '@/lib/billing/historyRequest'

const input = { companyId: 'co-1', customerId: 'cu-1', siteId: 'site-1', meteringPointId: 'mp-1234567890', actorUserId: 'automation' }
beforeEach(() => { io.permissions = []; io.createDraft.mockClear(); io.queueZ13.mockClear(); io.createTask.mockClear() })

describe('Z13 history request after the grid owner or customer answered', () => {
  it.each(['rejected_active', 'rejected_passive_timeout', 'z14_received', 'blocked'])('%s: no new Z13 on the next billing run, one operator task', async status => {
    io.permissions = [{ id: 'perm-old', status }]
    // Four monthly billing runs a day.
    for (let run = 0; run < 4; run += 1) expect(await ensureHistoricalMeteringRequest(input)).toBe('answered_needs_operator')
    expect(io.createDraft).not.toHaveBeenCalled()
    expect(io.queueZ13).not.toHaveBeenCalled()
    expect(io.createTask).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co-1', meteringPointId: 'mp-1234567890', taskType: 'contact_grid_owner' }))
  })

  it('a cancelled or ended request may still be asked again automatically', async () => {
    io.permissions = [{ id: 'perm-old', status: 'cancelled' }]
    expect(await ensureHistoricalMeteringRequest(input)).toBe('requested')
    expect(io.queueZ13).toHaveBeenCalledTimes(1)
  })
})
