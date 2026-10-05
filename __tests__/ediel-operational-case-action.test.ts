import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  admin: { userId: 'actor', companyId: 'company-a', isPlatformAdmin: false, roles: ['operations'], permissions: ['cases.write'] },
  scope: { companyId: 'company-a', memberships: [{ companyId: 'company-a', status: 'active', companyStatus: 'active', membershipRole: 'operations' }] },
  row: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'company-a', source: 'ediel_inbound_state_machine' } as { id: string; company_id: string; source: string },
  calls: [] as string[],
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async (permissions: string[]) => { io.calls.push(`guard:${permissions.join(',')}`); return io.admin }, isPlatformAdminContext: (value: { isPlatformAdmin: boolean }) => value.isPlatformAdmin }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => io.scope }))
vi.mock('@/lib/customer-cases/db', () => ({
  getCustomerCaseById: async (id: string, companyId: string) => { io.calls.push(`read:${id}:${companyId}`); return io.row?.id === id && io.row.company_id === companyId ? io.row : null },
  updateCustomerCaseStatus: async (input: Record<string, string>) => { io.calls.push(`update:${JSON.stringify(input)}`); return io.row },
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => io.calls.push(`revalidate:${path}`) }))

function form(status = 'resolved', id = io.row.id) {
  const data = new FormData()
  data.set('case_id', id)
  data.set('status', status)
  return data
}

beforeEach(() => {
  io.admin = { userId: 'actor', companyId: 'company-a', isPlatformAdmin: false, roles: ['operations'], permissions: ['cases.write'] }
  io.scope = { companyId: 'company-a', memberships: [{ companyId: 'company-a', status: 'active', companyStatus: 'active', membershipRole: 'operations' }] }
  io.row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'company-a', source: 'ediel_inbound_state_machine' }
  io.calls = []
})

it('triages only the exact company/source with an atomic source predicate', async () => {
  const { updateEdielOperationalCaseStatusAction } = await import('@/app/admin/ediel/operational-cases/actions')
  await updateEdielOperationalCaseStatusAction(form())
  expect(io.calls).toContain(`read:${io.row.id}:company-a`)
  expect(io.calls.some((entry) => entry.startsWith('update:') && entry.includes('"expectedSource":"ediel_inbound_state_machine"') && entry.includes('"companyId":"company-a"'))).toBe(true)
  expect(io.calls).toContain('revalidate:/admin/controltower')
})

it('rejects forged cross-company and non-Ediel cases without mutating', async () => {
  const { updateEdielOperationalCaseStatusAction } = await import('@/app/admin/ediel/operational-cases/actions')
  await expect(updateEdielOperationalCaseStatusAction(form('resolved', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))).rejects.toThrow()
  io.row.source = 'tenant_support_web'
  await expect(updateEdielOperationalCaseStatusAction(form())).rejects.toThrow()
  expect(io.calls.some((entry) => entry.startsWith('update:'))).toBe(false)
})

it('rejects platform, absent cases.write, paused or mismatched selected membership, and unsupported statuses', async () => {
  const { updateEdielOperationalCaseStatusAction } = await import('@/app/admin/ediel/operational-cases/actions')
  io.admin.isPlatformAdmin = true
  await expect(updateEdielOperationalCaseStatusAction(form())).rejects.toThrow()
  io.admin.isPlatformAdmin = false
  io.admin.permissions = ['cases.read']
  await expect(updateEdielOperationalCaseStatusAction(form())).rejects.toThrow()
  io.admin.permissions = ['cases.write']
  io.scope.memberships[0].companyStatus = 'paused'
  await expect(updateEdielOperationalCaseStatusAction(form())).rejects.toThrow()
  io.scope.memberships[0].companyStatus = 'active'
  io.admin.companyId = 'company-b'
  await expect(updateEdielOperationalCaseStatusAction(form())).rejects.toThrow()
  io.admin.companyId = 'company-a'
  await expect(updateEdielOperationalCaseStatusAction(form('approved'))).rejects.toThrow()
  expect(io.calls.some((entry) => entry.startsWith('update:'))).toBe(false)
})
