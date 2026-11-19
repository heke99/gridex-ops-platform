import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'company-b' as string | null,
  selectedCompanyId: 'company-b' as string | null,
  platform: true,
  permissions: ['ediel.send'],
  memberships: vi.fn(),
  process: vi.fn(),
  sendSingle: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: io.selectedCompanyId }) }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'operator' } }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      expect(name).toBe('canonical_authenticated_tenant_context')
      expect(args).toEqual({ p_selected_company_id: io.selectedCompanyId })
      return {
        data: {
          authorized: true,
          user_id: 'operator',
          is_platform_admin: io.platform,
          selected_company_id: io.companyId,
          permissions: io.permissions,
        },
        error: null,
      }
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      expect(table).toBe('company_memberships')
      const query = {
        select: () => query,
        eq(column: string, value: string) {
          if (column === 'user_id') {
            expect(value).toBe('operator')
            return query
          }
          expect([column, value]).toEqual(['status', 'active'])
          return io.memberships()
        },
      }
      return query
    },
  },
}))
vi.mock('@/lib/ediel/outbox/processEdielOutbox', () => ({ processEdielOutbox: io.process }))
vi.mock('@/lib/ediel/outbox/sendOutboxItem', () => ({ sendOutboxItem: io.sendSingle }))

import {
  processEdielOutboxAction,
  sendSingleEdielOutboxItemAction,
} from '@/app/admin/ediel/outbox/actions'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(values)) data.set(name, value)
  return data
}

function membership(companyId: string, role: string) {
  return {
    company_id: companyId,
    membership_role: role,
    status: 'active',
    companies: { id: companyId, name: companyId, status: 'active' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.companyId = 'company-b'
  io.selectedCompanyId = 'company-b'
  io.platform = true
  io.permissions = ['ediel.send']
  io.memberships.mockResolvedValue({
    data: [membership('company-a', 'owner'), membership('company-b', 'operations')],
    error: null,
  })
})

it('runs only the selected company from the ordinary form without a company field', async () => {
  await processEdielOutboxAction(form({ environment: 'test', limit: '25' }))

  expect(io.process).toHaveBeenCalledExactlyOnceWith({
    actorUserId: 'operator', companyId: 'company-b', environment: 'test', limit: 25,
  })
  expect(io.revalidate.mock.calls).toEqual([
    ['/admin/ediel/outbox'], ['/admin/ediel/automation'], ['/admin/ediel/messages'],
  ])
})

it('preserves the authorized default company, all environments and the limit cap', async () => {
  io.selectedCompanyId = null
  io.companyId = 'company-a'
  io.platform = false
  io.permissions = ['communication.send']

  await processEdielOutboxAction(form({ environment: '', limit: '500' }))

  expect(io.process).toHaveBeenCalledExactlyOnceWith({
    actorUserId: 'operator', companyId: 'company-a', environment: null, limit: 100,
  })
})

it('requires a selected company on the platform workspace before running the queue', async () => {
  io.selectedCompanyId = null
  io.companyId = null

  await expect(processEdielOutboxAction(form({}))).rejects.toThrow('Välj ett bolag')
  expect(io.process).not.toHaveBeenCalled()
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('holds conflicting authorization and view scopes before running the queue', async () => {
  io.companyId = 'company-a'

  await expect(processEdielOutboxAction(form({ limit: '10' }))).rejects.toThrow('Ladda om')
  expect(io.process).not.toHaveBeenCalled()
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('propagates an unavailable company scope before running the queue', async () => {
  const error = { code: 'PGRST000', message: 'Synthetic membership read failure' }
  io.memberships.mockResolvedValue({ data: null, error })

  await expect(processEdielOutboxAction(form({}))).rejects.toBe(error)
  expect(io.process).not.toHaveBeenCalled()
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('requires existing send authorization even when a company is selected', async () => {
  io.platform = false
  io.permissions = ['communication.read']

  await expect(processEdielOutboxAction(form({}))).rejects.toThrow('Forbidden')
  expect(io.process).not.toHaveBeenCalled()
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('preserves the separate single-item action', async () => {
  await sendSingleEdielOutboxItemAction(form({ outboxItemId: 'outbox-item' }))

  expect(io.sendSingle).toHaveBeenCalledExactlyOnceWith({ actorUserId: 'operator', outboxItemId: 'outbox-item' })
  expect(io.process).not.toHaveBeenCalled()
})
