import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ guard: vi.fn(), session: vi.fn(), company: vi.fn(), graph: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: fixture.guard }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: fixture.company, getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: fixture.session }))
vi.mock('@/lib/ediel/portalTestCustomer', () => ({ createEdielPortalTestCustomerGraph: fixture.graph }))
vi.mock('@/lib/ediel/flows/shared', () => ({ makeServerClient: async () => ({ marker: 'service-only-graph' }) }))
vi.mock('@/app/admin/ediel/actions.part-1', () => ({
  formString: (v: unknown) => typeof v === 'string' ? v.trim() || null : null,
  formNumber: vi.fn(), parseEdielTestSuite: (v: unknown) => v,
  parseEdielTestRoleCode: (v: unknown) => v, revalidateEdiel: vi.fn(), revalidateRelatedMessage: vi.fn(),
}))

import { createEdielPortalTestCustomerAction } from '@/app/admin/ediel/actions.part-4'

const actor = '33333333-3333-4333-8333-333333333333'
const session = '44444444-4444-4444-8444-444444444444'
const selectedCompany = '22222222-2222-4222-8222-222222222222'
function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ companyId: selectedCompany, testSuite: 'PRODAT',
    roleCode: 'supplier', testCaseCode: '1.1.1', actorUserId: 'FORGED-ACTOR', actorSessionId: 'FORGED-SESSION' })) data.set(key, value)
  return data
}

describe('Ediel portal graph action current server identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixture.guard.mockResolvedValue({ userId: actor, companyId: '11111111-1111-4111-8111-111111111111' })
    fixture.session.mockResolvedValue({ kind: 'ops', userId: actor, sessionId: session })
    fixture.company.mockResolvedValue(selectedCompany)
    fixture.graph.mockResolvedValue({ customerId: 'customer', switchRequestId: 'switch' })
  })

  it('passes the selected resource company and verified current session, ignoring forged actor controls', async () => {
    await createEdielPortalTestCustomerAction(form())
    expect(fixture.session).toHaveBeenCalledExactlyOnceWith('ops', actor)
    expect(fixture.graph).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: actor, actorSessionId: session, companyId: selectedCompany,
    }))
  })

  it('rejects a missing or revoked auth session before graph writes', async () => {
    fixture.session.mockRejectedValueOnce(new Error('support_session_revoked'))
    await expect(createEdielPortalTestCustomerAction(form())).rejects.toThrow('support_session_revoked')
    expect(fixture.graph).not.toHaveBeenCalled()
  })

  it('allows an A-reader/B-writer to select authorized B without borrowing or requiring A write permissions', async () => {
    fixture.guard.mockImplementation(async requirement => {
      if (requirement?.allOf?.length) throw new Error('ambient_company_is_read_only')
      return { userId: actor, companyId: '11111111-1111-4111-8111-111111111111',
        permissions: ['customers.read'], isAdmin: true }
    })
    await createEdielPortalTestCustomerAction(form())
    expect(fixture.graph).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId: selectedCompany, actorUserId: actor, actorSessionId: session,
    }))
  })
})
