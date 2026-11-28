import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  point: [] as Record<string, string | null>[],
  sites: [] as Record<string, string | null>[],
  customers: [] as Record<string, string | null>[],
  permissions: [] as Record<string, string | null>[],
  reads: vi.fn(), draft: vi.fn(), queue: vi.fn(), task: vi.fn(),
  deniedTaskTables: new Set<string>(),
  taskRows: new Map<string, Record<string, string | null>[]>(),
  availableLock: true,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: createClient('http://127.0.0.1:54321', 'local-test', {
  auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false },
  global: { fetch: async (input, options) => {
    const url = new URL(String(input))
    if (url.origin !== 'http://127.0.0.1:54321') throw new Error('Only the inert fixture URL is permitted')
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (options?.method !== 'POST') throw new Error('Unexpected automation lock method')
      if (url.pathname.endsWith('/gridex_acquire_automation_lock')) {
        const acquired = io.availableLock
        if (acquired) io.availableLock = false
        return Response.json(acquired)
      }
      if (url.pathname.endsWith('/gridex_release_automation_lock')) {
        io.availableLock = true
        return Response.json(true)
      }
      throw new Error(`Unexpected RPC ${url.pathname}`)
    }
    const taskTable = url.pathname.split('/').at(-1) ?? ''
    const taskRows = io.taskRows.get(taskTable)
    if (taskRows && options?.method === 'POST') {
      if (io.deniedTaskTables.has(taskTable)) {
        return Response.json({ code: '42501', message: 'synthetic avslag' }, { status: 403 })
      }
      taskRows.push({ ...JSON.parse(String(options.body)), id: `${taskTable}-${taskRows.length + 1}` })
      return new Response(null, { status: 201 })
    }
    if (taskTable === 'metering_permissions' && options?.method === 'POST') {
      const persisted = { ...JSON.parse(String(options.body)), id: 'local-history-draft' }
      io.permissions.push({ permission_scope: null, source_z13_message_id: null, outbound_z13_message_id: null, ...persisted })
      return Response.json(persisted)
    }
    if (options?.method !== 'GET') throw new Error('Unexpected request method')
    io.reads(url.pathname, Object.fromEntries(url.searchParams))
    const rows = url.pathname.endsWith('/metering_points') ? io.point
      : url.pathname.endsWith('/customer_sites') ? io.sites
        : url.pathname.endsWith('/metering_permissions') ? io.permissions
          : url.pathname.endsWith('/customers') ? io.customers : taskRows
    if (!rows) throw new Error(`Unexpected fixture table ${url.pathname}`)
    const filters = [...url.searchParams].filter(([key]) => !['select', 'limit'].includes(key))
    return Response.json(rows.filter(row => filters.every(([key, predicate]) => {
      const actual = row[key]
      if (predicate.startsWith('eq.')) return actual === predicate.slice(3)
      if (predicate === 'is.null') return actual === null
      if (predicate.startsWith('in.')) return predicate.slice(4, -1).split(',').includes(String(actual))
      if (predicate.startsWith('lte.')) return actual !== null && actual <= predicate.slice(4)
      if (predicate.startsWith('gte.')) return actual !== null && actual >= predicate.slice(4)
      throw new Error(`Unexpected fixture predicate ${key}=${predicate}`)
    })).slice(0, Number(url.searchParams.get('limit') ?? rows.length)))
  } },
}) }))
vi.mock('@/lib/onboarding/infoRequests', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/onboarding/infoRequests')>(),
  createMeteringPermissionDraft: io.draft,
  queueMeteringPermissionForZ13: io.queue,
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: io.task }))

import { ensureHistoricalMeteringRequest } from '@/lib/billing/historyRequest'

const uuid = (n: number) => `4810000${n}-0000-4000-8000-00000000000${n}`
const input = { companyId: uuid(1), customerId: uuid(2), siteId: uuid(3), meteringPointId: uuid(4), actorUserId: uuid(5) }
const ownedDraft = {
  id: 'local-history-draft', company_id: input.companyId, customer_id: input.customerId, site_id: input.siteId,
  metering_point_id: input.meteringPointId, grid_owner_id: uuid(6), status: 'draft', permission_scope: null,
  case_reference: 'HIST-48100004', requested_start_date: '2025-11-19', requested_end_date: '2026-11-19',
  source_z13_message_id: null, outbound_z13_message_id: null,
}
const market = { ...ownedDraft, id: 'market', status: 'active', permission_scope: 'VH', source_z13_message_id: 'market-original', outbound_z13_message_id: 'market-original' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'))
  io.availableLock = true
  io.deniedTaskTables.clear()
  io.taskRows = new Map([['customer_data_tasks', []], ['customer_operation_tasks', []]])
  io.permissions = []
  io.point = [{ id: input.meteringPointId, company_id: input.companyId, customer_id: input.customerId, site_id: input.siteId, customer_site_id: null, grid_owner_id: uuid(6) }]
  io.customers = [{ id: input.customerId, company_id: input.companyId }]
  io.sites = [{ id: input.siteId, company_id: input.companyId, customer_id: input.customerId, grid_owner_id: uuid(6) }]
  io.draft.mockImplementation(async () => (io.permissions.push(ownedDraft), { id: ownedDraft.id }))
  io.queue.mockResolvedValue({ outboundRequestId: 'unqualified-outbound' })
  io.task.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

function expectLocalWork() {
  expect(io.draft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    companyId: input.companyId, customerId: input.customerId, siteId: input.siteId,
    meteringPointId: input.meteringPointId, gridOwnerId: uuid(6), caseReference: 'HIST-48100004',
    requestedStartDate: '2025-11-19', requestedEndDate: '2026-11-19',
  }))
  expect(io.queue).not.toHaveBeenCalled()
  expect(io.task).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('driftmiljö') }))
}

describe('billing historical metering review', () => {
  it.each([
    ['active ongoing V', { ...market, permission_scope: 'V', requested_end_date: null }],
    ['older VH', { ...market, requested_end_date: '2026-01-30' }],
    ['fully overlapping VH without qualified billing environment', market],
    ['another customer', { ...ownedDraft, customer_id: 'other' }],
    ['another site at the same metering point', { ...ownedDraft, site_id: 'other' }],
    ['another network at the same site', { ...ownedDraft, grid_owner_id: 'other' }],
    ['an older unlinked local draft', { ...ownedDraft, requested_end_date: '2026-02-01' }],
  ])('holds the actual need when the visible row is %s', async (_case, row) => {
    io.permissions = [row]
    expect(await ensureHistoricalMeteringRequest(input)).toBe('draft_for_operator')
    expectLocalWork()
  })

  it('reuses the own covering draft and repairs a failed task on a subsequent call', async () => {
    io.task.mockRejectedValueOnce(new Error('synthetic task store failure'))
    await expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('synthetic task store failure')
    expect(await ensureHistoricalMeteringRequest(input)).toBe('draft_for_operator')
    expectLocalWork()
    expect(io.task).toHaveBeenCalledTimes(2)
  })

  it('reports an unsaved task and repairs it on retry while keeping the same draft', async () => {
    const { createCustomerDataTask } = await vi.importActual<typeof import('@/lib/customers/dataTasks')>('@/lib/customers/dataTasks')
    io.task.mockImplementation(createCustomerDataTask)
    io.deniedTaskTables = new Set(io.taskRows.keys())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('Handläggningsuppgiften kunde inte sparas.')
      expect(io.permissions).toEqual([ownedDraft])
      expect([...io.taskRows.values()].flat()).toEqual([])

      io.deniedTaskTables.delete('customer_operation_tasks')
      await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
      await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
      expect(io.taskRows.get('customer_operation_tasks')).toEqual([expect.objectContaining({
        company_id: input.companyId, customer_id: input.customerId, site_id: input.siteId,
        metering_point_id: input.meteringPointId, task_type: 'contact_grid_owner',
      })])
      expect(io.taskRows.get('customer_data_tasks')).toEqual([])
      expect(io.draft).toHaveBeenCalledOnce()
      expect(io.queue).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it.each(['customer_data_tasks', 'customer_operation_tasks'] as const)(
    'deduplicates the exact history instructions in %s', async table => {
      const { createCustomerDataTask } = await vi.importActual<typeof import('@/lib/customers/dataTasks')>('@/lib/customers/dataTasks')
      io.task.mockImplementation(createCustomerDataTask)
      if (table === 'customer_operation_tasks') io.deniedTaskTables.add('customer_data_tasks')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const scope = {
        companyId: input.companyId, customerId: input.customerId, customerSiteId: input.siteId,
        meteringPointId: input.meteringPointId, taskType: 'contact_grid_owner' as const,
      }
      const otherDescription = 'Avtalet kräver timvärden men mätpunkten rapporteras per månad. Kontrollera avtalstypen eller begär intervallavläsning hos nätägaren.'
      const legacyHistory = 'Mätvärden och förbrukningshistorik saknas, så fakturan kan inte uppskattas. Skicka historikbegäran (Z13) till nätägaren från mätvärdestillståndet.'
      const historyDescription = 'Mätvärdeshistorik saknas. Verifiera historikens period, driftmiljö och aktuellt VH-uppdrag för mätpunkten före sändning.'

      try {
        await createCustomerDataTask({ ...scope, description: otherDescription })
        const unrelated = io.taskRows.get(table)![0]
        // An earlier instruction can coexist with the ordinary unrelated task.
        const legacy = {...unrelated, id: 'legacy-history-work', description: legacyHistory}
        if (table === 'customer_operation_tasks') Object.assign(legacy, { title: legacyHistory.slice(0, 140) })
        io.taskRows.get(table)!.push(legacy)

        await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
        await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
        expect(io.permissions).toEqual([ownedDraft])
        expect(io.taskRows.get(table)).toEqual([unrelated, legacy, expect.objectContaining({
          task_type: 'contact_grid_owner', description: historyDescription,
          ...(table === 'customer_operation_tasks' ? {title: historyDescription} : {}),
        })])
        expect([...io.taskRows.values()].flat()).toHaveLength(3)
        expect(io.queue).not.toHaveBeenCalled()

        // Other callers still deduplicate by their established type and scope.
        await createCustomerDataTask({ ...scope, description: 'Annan instruktion från befintlig uppgiftsägare' })
        expect([...io.taskRows.values()].flat()).toHaveLength(3)
      } finally {
        warn.mockRestore()
      }
    },
  )

  it('preserves best-effort behavior for existing task callers', async () => {
    const { createCustomerDataTask } = await vi.importActual<typeof import('@/lib/customers/dataTasks')>('@/lib/customers/dataTasks')
    io.deniedTaskTables = new Set(io.taskRows.keys())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(createCustomerDataTask({ ...input, taskType: 'contact_customer', description: 'Synthetic task' })).resolves.toBeUndefined()
      expect([...io.taskRows.values()].flat()).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps one draft when admin and automation identify the same request concurrently', async () => {
    const results = await Promise.all([ensureHistoricalMeteringRequest(input), ensureHistoricalMeteringRequest({ ...input, actorUserId: null })])
    expect(results.sort()).toEqual(['draft_for_operator', 'work_in_progress'])
    expectLocalWork()
    expect(io.task).toHaveBeenCalledOnce()
  })

  it('reports a concurrent attempt as in progress while the owning task write can still fail', async () => {
    const { createCustomerDataTask } = await vi.importActual<typeof import('@/lib/customers/dataTasks')>('@/lib/customers/dataTasks')
    io.deniedTaskTables = new Set(io.taskRows.keys())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let taskStarted!: () => void
    const started = new Promise<void>(resolve => { taskStarted = resolve })
    let continueTask!: () => void
    const allowed = new Promise<void>(resolve => { continueTask = resolve })
    io.task.mockImplementationOnce(async task => {
      taskStarted()
      await allowed
      await createCustomerDataTask(task)
    })
    const owner = expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('Handläggningsuppgiften kunde inte sparas.')
    try {
      await started
      expect(io.permissions).toEqual([ownedDraft])
      expect([...io.taskRows.values()].flat()).toEqual([])
      await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('work_in_progress')
      expect(io.task).toHaveBeenCalledOnce()
    } finally {
      continueTask()
      await owner
      warn.mockRestore()
    }
    expect([...io.taskRows.values()].flat()).toEqual([])
    io.deniedTaskTables.clear()
    io.task.mockImplementation(createCustomerDataTask)
    await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
    expect(io.permissions).toEqual([ownedDraft])
    expect([...io.taskRows.values()].flat()).toHaveLength(1)
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('reuses an inferred site network when the meter has no direct owner', async () => {
    io.point[0].grid_owner_id = null
    expect(await ensureHistoricalMeteringRequest({ ...input, siteId: null })).toBe('draft_for_operator')
    expect(await ensureHistoricalMeteringRequest(input)).toBe('draft_for_operator')
    expectLocalWork()
  })

  it('accepts an owned customer_site_id-only point through the real draft writer and reuses its draft', async () => {
    io.point[0] = { ...io.point[0], site_id: null, customer_site_id: input.siteId }
    const { createMeteringPermissionDraft } = await vi.importActual<typeof import('@/lib/onboarding/infoRequests')>('@/lib/onboarding/infoRequests')
    io.draft.mockImplementation(createMeteringPermissionDraft)
    await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
    await expect(ensureHistoricalMeteringRequest(input)).resolves.toBe('draft_for_operator')
    expect(io.permissions).toEqual([expect.objectContaining({
      company_id: input.companyId, customer_id: input.customerId, site_id: input.siteId,
      metering_point_id: input.meteringPointId, grid_owner_id: uuid(6), status: 'draft',
      source_z13_message_id: null, outbound_z13_message_id: null,
    })])
    expect(io.draft).toHaveBeenCalledOnce()
    expect(io.task).toHaveBeenCalledTimes(2)
    expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([
    ['contradicting aliases', 'customer_site_id', uuid(7)],
    ['foreign point customer', 'customer_id', uuid(7)],
    ['foreign point company', 'company_id', uuid(7)],
    ['foreign point id', 'id', uuid(7)],
    ['missing site anchors', 'site_id', null],
  ])('holds %s before a draft or task write', async (_case, key, value) => {
    io.point[0][key] = value
    await expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('billing_history_metering_point_scope_mismatch')
    expect(io.draft).not.toHaveBeenCalled()
    expect(io.task).not.toHaveBeenCalled()
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('holds an unowned site resolved from the correct point before a draft or task write', async () => {
    io.sites[0].customer_id = uuid(7)
    await expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('billing_history_customer_site_scope_mismatch')
    expect(io.draft).not.toHaveBeenCalled()
    expect(io.task).not.toHaveBeenCalled()
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('stops before customer history effects when the point belongs to a different site', async () => {
    io.point[0].site_id = uuid(7)
    await expect(ensureHistoricalMeteringRequest(input)).rejects.toThrow('billing_history_metering_point_scope_mismatch')
    expect(io.draft).not.toHaveBeenCalled()
    expect(io.queue).not.toHaveBeenCalled()
    expect(io.task).not.toHaveBeenCalled()
  })
})

describe('billing estimate history uses the requested estimation window', () => {
  const scope = (start: string, end: string) => ({ ...input,
    estimationWindows: [{ start: Date.parse(start), end: Date.parse(end) }],
  })
  const oldMonth = scope('2024-12-31T23:00:00Z', '2025-01-31T23:00:00Z')

  it('does not reuse today’s rolling draft for the same meter and captures the actual 52-week reference', async () => {
    io.permissions = [ownedDraft]
    io.draft.mockImplementationOnce(async (input: { requestedStartDate: string; requestedEndDate: string }) => {
      io.permissions.push({ ...ownedDraft, id: 'scoped', requested_start_date: input.requestedStartDate, requested_end_date: input.requestedEndDate })
      return { id: 'scoped' }
    })
    await expect(ensureHistoricalMeteringRequest(oldMonth)).resolves.toBe('draft_for_operator')
    await expect(ensureHistoricalMeteringRequest(oldMonth)).resolves.toBe('draft_for_operator')
    expect(io.draft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestedStartDate: '2024-01-03', requestedEndDate: '2024-02-02',
    }))
    expect(io.queue).not.toHaveBeenCalled()
  })

  it('reuses only a local eligible draft fully covering the chosen reference', async () => {
    io.permissions = [{ ...ownedDraft, requested_start_date: '2024-01-01', requested_end_date: '2024-02-03' }]
    await expect(ensureHistoricalMeteringRequest(oldMonth)).resolves.toBe('draft_for_operator')
    expect(io.draft).not.toHaveBeenCalled()
    expect(io.task).toHaveBeenCalledTimes(1)
  })

  it('uses the estimator’s recent four-week fallback when the 52-week reference is outside the VH horizon', async () => {
    await expect(ensureHistoricalMeteringRequest(scope('2023-12-31T23:00:00Z', '2024-01-31T23:00:00Z')))
      .resolves.toBe('draft_for_operator')
    expect(io.draft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestedStartDate: '2023-12-04', requestedEndDate: '2023-12-31',
    }))
    expect(io.queue).not.toHaveBeenCalled()
  })

  it.each([
    ['future', '2028-01-01T00:00:00Z', '2028-02-01T00:00:00Z'],
    ['beyond both historical windows', '2023-11-01T00:00:00Z', '2023-11-15T00:00:00Z'],
    ['invalid', '2025-01-02T00:00:00Z', '2025-01-01T00:00:00Z'],
  ] as const)('leaves %s for review without saving a different local draft', async (_label, start, end) => {
    await expect(ensureHistoricalMeteringRequest(scope(start, end))).rejects.toThrow('billing_history_reference_period_unavailable')
    expect(io.draft).not.toHaveBeenCalled()
    expect(io.task).not.toHaveBeenCalled()
    expect(io.queue).not.toHaveBeenCalled()
  })
})
