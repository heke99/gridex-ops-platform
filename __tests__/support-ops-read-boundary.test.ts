import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ readGate: vi.fn(), cases: vi.fn(), customers: vi.fn(), messages: vi.fn(), publications: vi.fn(), heads: vi.fn(), attachments: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageAccess: async () => ({ userId: '20000000-0000-4000-8000-000000000001', companyId: '10000000-0000-4000-8000-000000000001', permissions: ['cases.read'], roles: ['viewer'] }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: '10000000-0000-4000-8000-000000000001', isPlatformAdmin: false }) }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: '10000000-0000-4000-8000-000000000001', memberships: [] }) }))
vi.mock('@/lib/tenant/lifecycle', () => ({ isCompanyWritableInTenantWorkspace: () => false }))
vi.mock('@/lib/customer-cases/support', () => ({ listTenantSupportCases: io.cases, listTenantSupportCustomerOptions: io.customers, listTenantSupportMessages: io.messages }))
vi.mock('@/lib/customer-cases/publication', () => ({ listCurrentCasePublications: io.publications, listCasePublicationHeads: io.heads }))
vi.mock('@/lib/customer-cases/attachments', () => ({ readSupportAttachments: io.attachments }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ requireCurrentOpsSupportReadSession: io.readGate, currentSupportSession: vi.fn() }))
vi.mock('@/lib/customer-cases/SupportActionForm', () => ({ default: () => null }))
vi.mock('@/app/admin/customer-cases/actions', () => ({}))
beforeEach(() => {
  for (const spy of Object.values(io)) spy.mockReset()
  io.cases.mockResolvedValue([]); io.customers.mockResolvedValue([]); io.publications.mockResolvedValue([]); io.heads.mockResolvedValue(new Map())
})

it('stops all privileged support list and customer option reads when the current session is denied', async () => {
  const { default: Page } = await import('@/app/admin/customer-cases/page')
  const denied = Object.assign(new Error('support_actor_forbidden'), { code: 'support_actor_forbidden' })
  io.readGate.mockRejectedValue(denied)
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(denied)
  for (const spy of [io.cases, io.customers, io.messages, io.publications, io.heads, io.attachments]) expect(spy).not.toHaveBeenCalled()
})
