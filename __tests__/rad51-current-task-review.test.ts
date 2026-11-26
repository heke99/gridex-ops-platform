import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const CUSTOMER = id(501)
const OTHER_CUSTOMER = id(502)
const TASK = id(1)
const OTHER_TASK = id(2)
const DATE = '2026-11-19T12:00:00Z'
const oldText = 'Invänta slutavläsningen och fakturera perioden.'
const reviewTitle = 'Slutfaktura behöver granskas'
const uncheckedTitle = 'Slutfaktura behöver kontrolleras'
const confirmationTitle = 'Kontrollera leveransslutet inför slutfaktura'
const reviewText = 'Uppgiften gäller ett leveransslut som inte längre kan bekräftas.'
const session = 'Bearer synthetic-session'
const service = 'Bearer synthetic-service'

function task(taskId: string, company: string | null = COMPANY, customerId = CUSTOMER, status = 'open') {
  return {
    id: taskId, company_id: company, customer_id: customerId,
    task_type: 'final_invoice_pending', status, priority: 'high',
    title: 'Slutfaktura', description: oldText, created_at: DATE,
  }
}
type Task = ReturnType<typeof task>
function central(row: Task) {
  return {
    ...row, source: 'Ärende', customer_label: row.company_id === COMPANY ? 'Kund A' : 'Kund B',
    href: '/admin/customers/' + row.customer_id, action_label: 'Öppna kundkort',
  }
}
const io = vi.hoisted(() => ({
  company: null as string | null,
  platform: false,
  denied: false,
  canWrite: false,
  canReadCustomer: false,
  updateStatus: vi.fn(),
  sweep: vi.fn(),
  tasks: [] as Task[],
  summary: [] as ReturnType<typeof central>[],
  reviewedTasks: new Set<string>(),
  hideFromLocalQueue: new Set<string>(),
  fault: null as 'service' | 'foreign_company' | 'foreign_customer' | 'unrequested' | 'duplicate' | 'qualifier' | 'qualification_transport' | 'foreign_company_outage' | 'foreign_company_qualification' | 'foreign_task_list' | null,
  calls: [] as { port: string; credential: string | null; query: URLSearchParams; args: unknown }[],
}))

function sdk(lane: 'session' | 'service'): SupabaseClient {
  const client = createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: 'Bearer synthetic-' + lane },
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        const port = url.pathname.split('/').at(-1)!
        const credential = new Headers(init?.headers).get('authorization')
        const query = url.searchParams
        const args = init?.body ? JSON.parse(String(init.body)) : null
        io.calls.push({ port, credential, query, args })
        const failure = () => Response.json({ code: '08006', message: 'private transport detail' }, { status: 500 })
        const visible = (row: Task) => io.platform || row.company_id === io.company
        if (port === 'gridex_read_supply_end_task_review_v1') {
          expect(credential).toBe(service)
          expect(init?.method).toBe('POST')
          expect(Object.keys(args).sort()).toEqual(['p_company_id', 'p_task_ids'])
          expect(args.p_task_ids.length).toBeGreaterThan(0)
          expect(args.p_task_ids.length).toBeLessThanOrEqual(100)
          expect(new Set(args.p_task_ids).size).toBe(args.p_task_ids.length)
          const rows = io.tasks.filter(row => row.company_id === args.p_company_id && args.p_task_ids.includes(row.id))
          expect(rows.length).toBe(args.p_task_ids.length)
          const reviewed = rows.filter(row => io.reviewedTasks.has(row.id)).map(row => ({
            task_id: row.id, company_id: row.company_id, customer_id: row.customer_id,
          }))
          if (io.fault === 'service' || (io.fault === 'foreign_company_outage' && args.p_company_id === OTHER_COMPANY)) return failure()
          if (io.fault === 'foreign_company') reviewed[0].company_id = OTHER_COMPANY
          if (io.fault === 'foreign_customer') reviewed[0].customer_id = OTHER_CUSTOMER
          if (io.fault === 'unrequested') reviewed[0].task_id = id(884)
          if (io.fault === 'duplicate') reviewed.push(reviewed[0])
          return Response.json(reviewed)
        }
        expect(credential).toBe(session)
        if (port === 'gridex_get_work_queue') {
          expect(args).toEqual({ p_company_id: io.company, p_limit: 250 })
          return Response.json(io.summary.filter(visible))
        }
        if (port === 'gridex_can_write_company') {
          expect(args).toEqual({ p_company_id: io.company })
          return Response.json(io.canWrite)
        }
        expect(init?.method).toBe('GET')
        if (port === 'customers') {
          expect(query.getAll('company_id')).toEqual(io.company ? ['not.is.null', 'eq.' + io.company] : ['not.is.null'])
          return Response.json([
            { id: CUSTOMER, company_id: COMPANY, full_name: 'Kund A', status: 'active' },
            { id: OTHER_CUSTOMER, company_id: OTHER_COMPANY, full_name: 'Kund B', status: 'active' },
          ].filter(row => io.platform || row.company_id === io.company))
        }
        if (port === 'customer_operation_tasks') {
          const statusFilter = query.get('status')
          if (query.has('task_type')) {
            const companyFilter = query.get('company_id')?.slice(3)
            expect(companyFilter).toBeDefined()
            expect(io.platform ? [COMPANY, OTHER_COMPANY] : [io.company]).toContain(companyFilter)
            expect(query.get('select')).toBe('id,company_id,customer_id')
            expect(query.get('task_type')).toBe('eq.final_invoice_pending')
            expect(['in.(open,new,pending,action_required)', 'in.(open,new,pending,action_required,in_progress,blocked,pending_review)'])
              .toContain(statusFilter)
            const statuses = statusFilter!.slice(4, -1).split(',')
            const ids = query.get('id')!.slice(4, -1).split(',')
            expect(ids.length).toBeLessThanOrEqual(100)
            if (io.fault === 'qualification_transport'
              || (io.fault === 'foreign_company_qualification' && companyFilter === OTHER_COMPANY)) return failure()
            const matched = io.tasks.filter(row => visible(row) && row.company_id === companyFilter
              && ids.includes(row.id) && row.task_type === 'final_invoice_pending' && statuses.includes(row.status))
            return Response.json(matched.map(row => ({
              id: row.id, company_id: io.fault === 'qualifier' ? OTHER_COMPANY : row.company_id, customer_id: row.customer_id,
            })))
          }
          expect(query.get('company_id')).toBe(io.company ? 'eq.' + io.company : null)
          if (query.get('select') === '*') {
            expect(query.get('limit')).toBe('200')
            if (io.fault === 'foreign_task_list') return Response.json([task(OTHER_TASK, OTHER_COMPANY, OTHER_CUSTOMER)])
            return Response.json(io.tasks.filter(row => visible(row) && (!statusFilter || statusFilter === 'eq.' + row.status)))
          }
          const localStatus = ['open', 'new', 'pending', 'action_required']
          const additional = query.has('or') ? ['in_progress','blocked','pending_review'] : []
          return Response.json(io.tasks.filter(row => visible(row) && !io.hideFromLocalQueue.has(row.id)
            && (localStatus.includes(row.status) || row.task_type === 'final_invoice_pending' && additional.includes(row.status))))
        }
        return Response.json([])
      },
    },
  })
  client.auth.getUser = async () => ({
    data: { user: { id: id(900), aud: 'authenticated', created_at: DATE, app_metadata: {}, user_metadata: {} } satisfies User },
    error: null,
  })
  return client
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async (key: string) => {
    expect(key).toBe('operations.tasks')
    if (io.denied) throw new Error('Synthetic queue access denied')
    return { companyId: io.company, isPlatformAdmin: io.platform, userId: id(900), roles: [], permissions: io.canReadCustomer ? ['metering.read', 'customers.read'] : ['metering.read'] }
  },
  requireAdminActionAccess: async (permissions: string[]) => {
    expect(permissions).toEqual(['masterdata.write'])
    if (!io.canWrite) throw new Error('Forbidden')
  },
  isPlatformAdminContext: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => sdk('session') }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: sdk('service') }))
vi.mock('@/app/admin/operations/actions', () => ({
  updateOperationTaskStatusFromAdminAction: io.updateStatus, runOperationsTaskAutoResolutionSweepAction: io.sweep,
}))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h1', null, title) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
import WorkQueuePage from '@/app/admin/work-queue/page'
import OperationsTasksPage from '@/app/admin/operations/tasks/page'

const renderTasks = async (params: { status?: string; q?: string } = {}) =>
  renderToStaticMarkup(await OperationsTasksPage({ searchParams: Promise.resolve(params) }))
const render = async () => renderToStaticMarkup(await WorkQueuePage())
const privateCalls = () => io.calls.filter(call => call.credential === service)
function rowFor(html: string, label: string) {
  return (html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []).find(row => row.includes(label)) ?? ''
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  io.company = COMPANY
  io.platform = false
  io.denied = false
  io.canWrite = false
  io.canReadCustomer = false
  io.updateStatus.mockReset()
  io.sweep.mockReset()
  io.tasks = [task(TASK)]
  io.summary = io.tasks.map(central)
  io.reviewedTasks = new Set([TASK])
  io.hideFromLocalQueue.clear()
  io.fault = null
  io.calls = []
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })


it('presents a verified same-task review once in the work queue and keeps its status and enabled destination', async () => {
  io.canReadCustomer = true
  const html = await render()
  const row = rowFor(html, reviewTitle)
  expect(html.split(reviewTitle)).toHaveLength(2)
  expect(row).toContain('Öppen')
  expect(row).toContain('Blockerad för granskning')
  expect(row).toContain(reviewText)
  expect(row).toContain('/admin/customers/' + CUSTOMER)
  expect(row).not.toContain(oldText)
  expect(privateCalls().map(call => call.args)).toEqual([{ p_company_id: COMPANY, p_task_ids: [TASK] }])
  expect(io.tasks[0].status).toBe('open')
})

it('shows separate review in the operations task table and priority pane while preserving authorized controls', async () => {
  io.canReadCustomer = true
  io.canWrite = true
  const html = await renderTasks()
  const row = rowFor(html, reviewTitle)
  expect(html.split(reviewTitle)).toHaveLength(3)
  expect(html.split('Blockerad för granskning')).toHaveLength(3)
  expect(row).toContain('Öppen')
  expect(row).toContain('Hantera uppgift')
  expect(row).toContain('Markera uppgiften som klar')
  expect(row).toContain('/admin/customers/' + CUSTOMER)
  expect([...row.matchAll(/name="status" value="([^"]+)"/g)].map(match => match[1])).toEqual(['in_progress', 'blocked', 'done'])
  expect(io.updateStatus).not.toHaveBeenCalled()
  expect(io.sweep).not.toHaveBeenCalled()
  expect(io.tasks[0].status).toBe('open')
})

it('keeps an in-progress final task in the work queue only when verified review needs action', async () => {
  io.tasks = [task(TASK,COMPANY,CUSTOMER,'in_progress')]
  io.summary = []
  const row = rowFor(await render(), reviewTitle)
  expect(row).toContain('Pågår')
  expect(row).toContain('Blockerad för granskning')
  io.reviewedTasks.clear()
  expect(await render()).not.toContain(reviewTitle)
})

it.each(['service','foreign_customer','duplicate'] as const)('holds the final task for comparison when the private reply is %s', async fault => {
  io.fault = fault
  for (const renderPage of [render, renderTasks]) {
    const html = await renderPage()
    expect(html).toContain(uncheckedTitle)
    expect(html).toContain('Öppen')
    expect(html).not.toContain('Blockerad för granskning')
    expect(html).not.toContain('private transport detail')
  }
})

it('keeps an unverified older source and completed task as separate safe outcomes', async () => {
  io.reviewedTasks.clear()
  io.tasks.push(task(OTHER_TASK, COMPANY, CUSTOMER, 'done'))
  const html = await renderTasks()
  expect(html).toContain(confirmationTitle)
  expect(html).toContain(oldText)
  expect(html).not.toContain('Blockerad för granskning')
  expect(privateCalls().map(call => call.args)).toEqual([{ p_company_id: COMPANY, p_task_ids: [TASK] }])
})

it('never reaches the private task review after page denial or for another selected tenant', async () => {
  io.denied = true
  await expect(render()).rejects.toThrow('Synthetic queue access denied')
  expect(privateCalls()).toEqual([])
  io.denied = false
  io.company = OTHER_COMPANY
  expect(await render()).not.toContain(reviewTitle)
  expect(privateCalls()).toEqual([])
})
