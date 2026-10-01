import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ command: vi.fn(), guard: vi.fn(), update: vi.fn(), audit: vi.fn(), session: vi.fn(), actor: '11111111-1111-4111-8111-111111111111', company: '22222222-2222-4222-8222-222222222222', customer: '33333333-3333-4333-8333-333333333333' }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: fixture.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fixture.actor } } }) } }) }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async () => fixture.company }))
vi.mock('@/lib/customer-contracts/db', () => ({ addCustomerContractEvent: vi.fn() }))
vi.mock('@/lib/tenant/emailTemplates', () => ({ queueTenantTemplateEmail: vi.fn() }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: fixture.audit, logUsageEvent: vi.fn() }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: fixture.session }))
vi.mock('@/lib/customer-operations/legalProfileCommand', () => ({
  changeCustomerLegalProfile: fixture.command,
  LegalProfileCommandError: class LegalProfileCommandError extends Error { constructor(readonly code: string, readonly status: number) { super(code) } },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  if (table !== 'customers') throw new Error('unexpected legacy writer')
  const row = { id: fixture.customer, company_id: fixture.company, customer_type: 'private', status: 'active', legal_profile_revision: 4, first_name: 'Before', last_name: 'Customer' }
  const query = { select: () => query, eq: () => query, single: async () => ({ data: row, error: null }), update: (payload: unknown) => { fixture.update(payload); return query } }
  return query
} } }))
import { saveCustomerProfileImpl } from '@/app/admin/customers/[id]/profile-actions.part-1'
function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customer_id: fixture.customer, customer_type: 'private', first_name: 'After', last_name: 'Customer', status: 'active', expected_legal_profile_revision: '4', idempotency_key: 'legal-action-current-key' })) data.set(key, value)
  return data
}
describe('OPS legal profile action actual writer boundary', () => {
  beforeEach(() => {
    fixture.command.mockReset(); fixture.update.mockReset(); fixture.audit.mockReset(); fixture.session.mockReset()
    fixture.guard.mockReset().mockResolvedValue({ userId: fixture.actor, companyId: fixture.company, isPlatformAdmin: false })
    fixture.session.mockResolvedValue({ kind: 'ops', userId: fixture.actor, sessionId: '44444444-4444-4444-8444-444444444444' })
    fixture.command.mockResolvedValue({ revision: 5, changed: true, replayed: false })
  })
  it('uses the canonical legal command with saved revision, current server session and persisted tenant', async () => {
    const result = await saveCustomerProfileImpl(form())
    expect(result).toMatchObject({ status: 'success', revision: 5, changed: true, replayed: false })
    expect(fixture.session).toHaveBeenCalledWith('ops', fixture.actor)
    expect(fixture.guard).toHaveBeenCalledWith(['customers.write'])
    expect(fixture.command).toHaveBeenCalledWith(expect.objectContaining({ companyId: fixture.company, customerId: fixture.customer, expectedRevision: 4, idempotencyKey: 'legal-action-current-key', actor: { kind: 'ops', userId: fixture.actor, sessionId: '44444444-4444-4444-8444-444444444444', reason: 'OPS legal customer profile' } }))
    expect(fixture.command.mock.calls[0][0].changes).not.toHaveProperty('status')
    expect(fixture.update).not.toHaveBeenCalled(); expect(fixture.audit).not.toHaveBeenCalled()
  })
  it('does not execute lifecycle transitions through the legal editor', async () => {
    const data = form(); data.set('status', 'terminated')
    await expect(saveCustomerProfileImpl(data)).rejects.toMatchObject({ code: 'legal_lifecycle_command_required' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.update).not.toHaveBeenCalled()
  })
  it.each(['expected_legal_profile_revision', 'idempotency_key'])('requires %s and does not invent a default', async (field) => {
    const data = form(); data.delete(field)
    await expect(saveCustomerProfileImpl(data)).rejects.toMatchObject({ code: 'invalid_legal_profile_command' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.update).not.toHaveBeenCalled()
  })
  it('rejects forged actor/tenant controls and keeps contact fields on their own command', async () => {
    const data = form(); data.set('actorUserId', '55555555-5555-4555-8555-555555555555')
    await expect(saveCustomerProfileImpl(data)).rejects.toMatchObject({ code: 'invalid_legal_profile_command' })
    const contact = form(); contact.set('email', 'untrusted@example.invalid')
    await expect(saveCustomerProfileImpl(contact)).rejects.toMatchObject({ code: 'contact_command_required' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.update).not.toHaveBeenCalled()
  })
  it('denies selected-tenant changes before executing the legal command', async () => {
    fixture.guard.mockResolvedValue({ userId: fixture.actor, companyId: '55555555-5555-4555-8555-555555555555', isPlatformAdmin: false })
    await expect(saveCustomerProfileImpl(form())).rejects.toMatchObject({ code: 'forbidden' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.update).not.toHaveBeenCalled()
  })
})
