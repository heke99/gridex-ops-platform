import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requireAdminActionAccess,
  requireCompanyScopedActionAccess,
  requireCompanyScopedAdminAccess,
} from '@/lib/admin/guards'
import { markWebhookDeliveryIgnoredAction } from '@/app/admin/webhooks/actions'
import { inviteCompanyUserAction, removeUserFromCompanyAction, setCompanyUserRoleAction } from '@/app/admin/companies/actions'

type Membership = { companyId: string; companyStatus: string | null; membershipRole: string | null }
type Mutation = { table: string; values: Record<string, unknown>; filters: Record<string, unknown> }
const io = vi.hoisted(() => ({
  cookie: 'A' as string | null,
  selected: 'A' as string | null,
  platform: false,
  roles: ['custom_role'],
  permissions: {} as Record<string, string[]>,
  memberships: [] as Membership[],
  mutations: [] as Mutation[],
  rpc: vi.fn(),
  from: vi.fn(),
  revalidate: vi.fn(),
  serviceRpc: vi.fn(),
  invite: vi.fn(),
}))

// Each call represents a request. Request-cache integration is a separate gate.
vi.mock('react', () => ({ cache: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => io.cookie ? { value: io.cookie } : undefined }) }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: io.rpc,
  }),
}))
vi.mock('@/lib/tenant/scope', () => ({ listOperationalCompaniesForUser: async () => io.memberships }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.serviceRpc } }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: vi.fn() }))
vi.mock('@/lib/integrations/webhooks', () => ({
  dispatchDueWebhookDeliveries: vi.fn(), enqueueWebhookDeliveriesForEvent: vi.fn(),
}))

vi.mock('@/lib/auth/companyInvitationFlow', () => ({ provisionCompanyInvitation: io.invite }))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: vi.fn(), getCompanyDeleteBlockers: vi.fn(),
  logTenantGovernanceEvent: vi.fn(), normalizeCompanyStatus: vi.fn(),
  requireCompanyOperationalForWrites: vi.fn(),
}))
vi.mock('@/lib/email/bootstrap', () => ({ seedDefaultCompanyEmailConfiguration: vi.fn() }))
vi.mock('@/lib/onboarding/companyReadiness', () => ({ seedCompanyOnboardingTasks: vi.fn() }))

const requirement = { anyOf: ['integrations.write'] }
function membership(companyId: string, companyStatus: string | null = 'active', membershipRole: string | null = 'admin'): Membership {
  return { companyId, companyStatus, membershipRole }
}
function webhook(companyId: string) {
  const form = new FormData()
  form.set('company_id', companyId)
  form.set('delivery_id', `delivery-${companyId}`)
  return markWebhookDeliveryIgnoredAction(form)
}

beforeEach(() => {
  vi.clearAllMocks()
  io.cookie = 'A'
  io.selected = 'A'
  io.platform = false
  io.roles = ['custom_role']
  io.permissions = { A: ['integrations.write'], B: ['customers.read'] }
  io.memberships = [membership('A'), membership('B')]
  io.mutations = []
  io.rpc.mockImplementation(async () => ({ data: {
    authorized: true, user_id: 'actor', selected_company_id: io.selected,
    is_platform_admin: io.platform, roles: io.roles,
    permissions: io.permissions[io.selected ?? ''] ?? ['integrations.write'],
  } }))
  io.serviceRpc.mockResolvedValue({ data: { ok: true }, error: null })
  io.from.mockImplementation((table: string) => ({
    select: () => {
      const chain = { eq: () => chain, limit: async () => ({ data: [], error: null }) }
      return chain
    },
    update: (values: Record<string, unknown>) => {
      const mutation: Mutation = { table, values, filters: {} }
      const chain = {
        eq: (key: string, value: unknown) => { mutation.filters[key] = value; return chain },
        then: (resolve: (result: { error: null }) => unknown) => {
          io.mutations.push(mutation)
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return chain
    },
    insert: async (values: Record<string, unknown>) => {
      io.mutations.push({ table, values, filters: {} })
      return { error: null }
    },
  }))
})

describe('company permission binding uses the real guards and webhook action', () => {
  it.each([['A', 'B'], ['B', 'A']])('selected %s permissions cannot authorize %s', async (allowed, denied) => {
    io.cookie = io.selected = allowed
    io.permissions = { [allowed]: ['integrations.write'], [denied]: ['customers.read'] }
    await expect(requireCompanyScopedActionAccess(allowed, requirement)).resolves.toMatchObject({ companyId: allowed })
    await expect(requireCompanyScopedAdminAccess(allowed, requirement)).resolves.toMatchObject({ companyId: allowed })
    await expect(requireCompanyScopedActionAccess(denied, requirement)).rejects.toThrow(/behörighet/)
    await expect(requireCompanyScopedAdminAccess(denied, requirement)).rejects.toThrow('redirect:/admin')
    await expect(webhook(denied)).rejects.toThrow(/behörighet/)
    expect(io.from).not.toHaveBeenCalled()
    expect(io.revalidate).not.toHaveBeenCalled()

    await expect(webhook(allowed)).rejects.toThrow(/redirect:.*success=/)
    expect(io.mutations).toHaveLength(2)
    expect(io.mutations[0]).toMatchObject({
      table: 'webhook_deliveries', values: { status: 'skipped' },
      filters: { company_id: allowed, id: `delivery-${allowed}` },
    })
    expect(io.mutations[1]).toMatchObject({ table: 'audit_logs', values: { company_id: allowed, actor_user_id: 'actor' } })
    for (const call of io.rpc.mock.calls) {
      expect(call).toEqual(['canonical_authenticated_tenant_context', { p_selected_company_id: allowed }])
    }
  })

  it.each([['A', 'B'], ['B', 'A']])('selecting denied %s never borrows %s permissions', async (denied, allowed) => {
    io.cookie = io.selected = denied
    io.permissions = { [allowed]: ['integrations.write'], [denied]: ['customers.read'] }
    await expect(requireCompanyScopedActionAccess(denied, requirement)).rejects.toThrow('Forbidden')
    await expect(requireCompanyScopedAdminAccess(denied, requirement)).rejects.toThrow('redirect:/admin')
    await expect(webhook(denied)).rejects.toThrow('Forbidden')
    expect(io.from).not.toHaveBeenCalled()
  })

  it('requires deliberate selection even when both companies grant the permission', async () => {
    io.permissions.B = ['integrations.write']
    await expect(webhook('B')).rejects.toThrow(/behörighet/)
    expect(io.from).not.toHaveBeenCalled()
    io.cookie = io.selected = 'B'
    await expect(webhook('B')).rejects.toThrow(/redirect:.*success=/)
    expect(io.mutations[0].filters.company_id).toBe('B')
  })

  it('accepts the canonical default company when the cookie is absent', async () => {
    io.cookie = null
    await expect(requireCompanyScopedActionAccess('A', requirement)).resolves.toMatchObject({ companyId: 'A' })
    expect(io.rpc).toHaveBeenCalledWith('canonical_authenticated_tenant_context', { p_selected_company_id: null })
  })

  it('binds to the canonical returned company, not the untrusted cookie value', async () => {
    io.cookie = 'B'
    await expect(webhook('B')).rejects.toThrow(/behörighet/)
    expect(io.rpc).toHaveBeenCalledWith('canonical_authenticated_tenant_context', { p_selected_company_id: 'B' })
    expect(io.from).not.toHaveBeenCalled()
    await expect(requireCompanyScopedActionAccess('A', requirement)).resolves.toMatchObject({ companyId: 'A' })
  })

  it.each(['paused', 'suspended', 'archived', 'closed', null])('active A cannot enable actions in selected B with status %s', async status => {
    io.cookie = io.selected = 'B'
    io.permissions.B = ['integrations.write']
    io.memberships = [membership('A'), membership('B', status)]
    await expect(requireAdminActionAccess(requirement)).rejects.toThrow(/pausat/)
    await expect(requireCompanyScopedActionAccess('B', requirement)).rejects.toThrow(/pausat/)
    await expect(webhook('B')).rejects.toThrow(/pausat/)
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each([{ memberships: [] }, { memberships: [membership('B')] }])('denies a selected company without its own active membership: %j', async ({ memberships }) => {
    io.memberships = memberships
    await expect(requireAdminActionAccess(requirement)).rejects.toThrow(/pausat/)
    await expect(requireCompanyScopedAdminAccess('A', requirement)).rejects.toThrow(/redirect:/)
    await expect(webhook('A')).rejects.toThrow(/pausat/)
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each([null, ''])('denies a canonical context with no company: %s', async selected => {
    io.selected = selected
    await expect(requireAdminActionAccess(requirement)).rejects.toThrow(/pausat/)
    await expect(requireCompanyScopedAdminAccess('A', requirement)).rejects.toThrow('redirect:/admin')
    await expect(webhook('A')).rejects.toThrow(/pausat/)
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each(['viewer', null])('does not turn membership role %s into write authority', async role => {
    io.memberships = [membership('A', 'active', role)]
    await expect(webhook('A')).rejects.toThrow(/behörighet/)
    expect(io.from).not.toHaveBeenCalled()
  })

  it.each(['active', 'onboarding'])('permits selected %s while another company is paused', async status => {
    io.memberships = [membership('A', status), membership('B', 'paused')]
    await expect(requireAdminActionAccess(requirement)).resolves.toMatchObject({ companyId: 'A' })
  })

  it('preserves paused-company page reads', async () => {
    io.memberships = [membership('A', 'paused')]
    await expect(requireCompanyScopedAdminAccess('A', requirement)).resolves.toMatchObject({ companyId: 'A' })
  })

  it.each(['A', null])('preserves authoritative global platform authority with selected %s', async selected => {
    io.platform = true
    io.selected = selected
    io.roles = ['super_admin']
    io.permissions = { A: [], '': [] }
    io.memberships = []
    await expect(requireCompanyScopedAdminAccess('B', requirement)).resolves.toMatchObject({ isPlatformAdmin: true })
    await expect(requireAdminActionAccess(requirement)).resolves.toMatchObject({ isPlatformAdmin: true })
    await expect(webhook('B')).rejects.toThrow(/redirect:.*success=/)
    expect(io.mutations[0].filters.company_id).toBe('B')
  })

  it('does not grant global authority from a company-scoped platform role name', async () => {
    io.roles = ['super_admin']
    await expect(webhook('B')).rejects.toThrow(/behörighet/)
    expect(io.from).not.toHaveBeenCalled()
  })
})


function companyUserForm(companyId: string) {
  const form = new FormData()
  form.set('company_id', companyId)
  form.set('user_id', 'target-user')
  form.set('email', 'synthetic@example.test')
  form.set('role_key', 'company_admin')
  return form
}
const emptyActionState = { ok: false, message: '' }

describe('company-user consumers retain the same permission company', () => {
  it.each([
    { name: 'invite', action: inviteCompanyUserAction },
    { name: 'remove', action: removeUserFromCompanyAction },
    { name: 'role change', action: setCompanyUserRoleAction },
  ])('$name rejects a different target before service access', async ({ action }) => {
    io.permissions.A = ['users.write']
    const result = await action(emptyActionState, companyUserForm('B'))
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toMatch(/behörighet/)
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.invite).not.toHaveBeenCalled()
  })

  it.each([['A', 'B'], ['B', 'A']])('real remove-user wrapper can call %s RPC only after its own permission check', async (allowed, denied) => {
    io.cookie = io.selected = allowed
    io.permissions = { [allowed]: ['users.write'], [denied]: ['customers.read'] }
    expect((await removeUserFromCompanyAction(emptyActionState, companyUserForm(denied))).ok).toBe(false)
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect((await removeUserFromCompanyAction(emptyActionState, companyUserForm(allowed))).ok).toBe(true)
    expect(io.serviceRpc).toHaveBeenCalledExactlyOnceWith('canonical_change_tenant_user_access', {
      p_command: expect.objectContaining({ company_id: allowed, actor_user_id: 'actor', user_id: 'target-user', action: 'remove' }),
    })
    expect(io.mutations[0]).toMatchObject({ table: 'company_invitations', filters: { company_id: allowed } })
  })

  it.each(['owner', 'admin', 'company_admin', 'tenant_admin', 'company_owner', 'viewer'])('preserves the narrower existing company-user role check: %s', async role => {
    io.permissions.A = ['users.write']
    io.memberships = [membership('A', 'active', role)]
    const allowed = ['owner', 'admin', 'company_admin'].includes(role)
    expect((await removeUserFromCompanyAction(emptyActionState, companyUserForm('A'))).ok).toBe(allowed)
    expect(io.serviceRpc).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('preserves global platform user-management authority', async () => {
    io.platform = true
    io.roles = ['super_admin']
    io.permissions.A = []
    io.memberships = []
    expect((await removeUserFromCompanyAction(emptyActionState, companyUserForm('B'))).ok).toBe(true)
    expect(io.serviceRpc).toHaveBeenCalledWith('canonical_change_tenant_user_access', {
      p_command: expect.objectContaining({ company_id: 'B', actor_user_id: 'actor' }),
    })
  })
})
