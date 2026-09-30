import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ command: vi.fn(), guard: vi.fn(), session: vi.fn(), mutations: vi.fn(),
  actor: '11111111-1111-4111-8111-111111111111', company: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333', selectedCompany: '22222222-2222-4222-8222-222222222222',
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: fixture.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fixture.actor } } }) } }) }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async () => fixture.company }))
vi.mock('@/lib/customer-contracts/db', () => ({ addCustomerContractEvent: fixture.mutations }))
vi.mock('@/lib/tenant/emailTemplates', () => ({ queueTenantTemplateEmail: fixture.mutations }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: fixture.mutations, logUsageEvent: fixture.mutations }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: fixture.session }))
vi.mock('@/lib/customer-operations/lifecycleCommand', () => ({
  closeCustomerLifecycle: fixture.command,
  CustomerLifecycleCommandError: class CustomerLifecycleCommandError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code) }
  },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  if (table !== 'customers') throw new Error('Lifecycle action invoked a separate domain writer')
  const query = { select: () => query, eq: () => query,
    single: async () => ({ data: { id: fixture.customer, company_id: fixture.company, status: 'active', lifecycle_revision: 4 }, error: null }),
    update: () => { fixture.mutations(); return query }, insert: () => { fixture.mutations(); return query },
  }
  return query
} } }))

import { closeCustomerLifecycleImpl } from '@/app/admin/customers/[id]/profile-actions.part-1'

function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customer_id: fixture.customer, confirm_close: 'AVSLUTA',
    lifecycle_mode: 'move_out', move_out_date: '2026-09-30', reason: 'Verified customer request',
    create_follow_up_task: 'on', expected_lifecycle_revision: '4', idempotency_key: 'lifecycle-action-retry-key' })) data.set(key, value)
  return data
}

describe('OPS lifecycle action actual writer boundary', () => {
  beforeEach(() => {
    fixture.command.mockReset(); fixture.guard.mockReset(); fixture.session.mockReset(); fixture.mutations.mockReset()
    fixture.selectedCompany = fixture.company
    fixture.guard.mockImplementation(async () => ({ userId: fixture.actor, companyId: fixture.selectedCompany, isPlatformAdmin: false }))
    fixture.session.mockResolvedValue({ kind: 'ops', userId: fixture.actor, sessionId: '44444444-4444-4444-8444-444444444444' })
    fixture.command.mockResolvedValue({ revision: 5, changed: true, replayed: false })
  })

  it('uses customers.write, current session and the persisted tenant for one domain command', async () => {
    expect(await closeCustomerLifecycleImpl(form())).toMatchObject({ status: 'success', revision: 5, changed: true, replayed: false })
    expect(fixture.guard).toHaveBeenCalledWith(['customers.write'])
    expect(fixture.session).toHaveBeenCalledWith('ops', fixture.actor)
    expect(fixture.command).toHaveBeenCalledExactlyOnceWith({ companyId: fixture.company, customerId: fixture.customer,
      actor: { kind: 'ops', userId: fixture.actor, sessionId: '44444444-4444-4444-8444-444444444444' },
      expectedRevision: 4, idempotencyKey: 'lifecycle-action-retry-key', mode: 'move_out', moveOutDate: '2026-09-30',
      reason: 'Verified customer request', createFollowUpTask: true,
    })
    expect(fixture.mutations).not.toHaveBeenCalled()
  })

  it.each(['expected_lifecycle_revision', 'idempotency_key', 'move_out_date', 'lifecycle_mode', 'reason'])
    ('rejects absent %s without defaulting or writing', async (key) => {
      const data = form(); data.delete(key)
      await expect(closeCustomerLifecycleImpl(data)).rejects.toMatchObject({ code: 'invalid_lifecycle_command' })
      expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.mutations).not.toHaveBeenCalled()
    })

  it('preserves the explicit unchecked follow-up preference and committed replay', async () => {
    fixture.command.mockResolvedValue({ revision: 5, changed: true, replayed: true })
    const data = form(); data.delete('create_follow_up_task')
    expect(await closeCustomerLifecycleImpl(data)).toMatchObject({ status: 'success', revision: 5, replayed: true })
    expect(fixture.command.mock.calls[0][0].createFollowUpTask).toBe(false)
    expect(fixture.mutations).not.toHaveBeenCalled()
  })

  it('denies tenant switching and forged actor fields before the command', async () => {
    fixture.selectedCompany = '55555555-5555-4555-8555-555555555555'
    await expect(closeCustomerLifecycleImpl(form())).rejects.toMatchObject({ code: 'forbidden' })
    fixture.selectedCompany = fixture.company
    const data = form(); data.set('actorUserId', '55555555-5555-4555-8555-555555555555')
    await expect(closeCustomerLifecycleImpl(data)).rejects.toMatchObject({ code: 'invalid_lifecycle_command' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.mutations).not.toHaveBeenCalled()
  })
})
