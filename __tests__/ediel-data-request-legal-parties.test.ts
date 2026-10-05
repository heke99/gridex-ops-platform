import { describe, expect, it, vi } from 'vitest'
const read = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure', () => ({ readQualifiedCustomerStructure: read }))
import { dataRequestLegalParties } from '@/lib/ediel/sources/dataRequestLegalParties'
import { requireDataRequestStructure } from '@/lib/ediel/sources/dataRequestStructure'
import type { DecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'

const route = () => ({ companyId: 'company', environment: 'test', senderEdielId: '99001', receiverEdielId: '99002',
  actor: { legalActorEdielId: '11111', tenantIdentity: { companyId: 'company', environment: 'test', legalEdielId: '11111' } },
}) as DecisionBackedOutboundContext
const input = () => ({ companyId: 'company', environment: 'test' as const, route: route(), networkEdielId: '22222' })

describe('actual UTILTS request source selection has separate legal and transport endpoints', () => {
  it('passes the current legal tuple to the dated original reader despite distinct represented UNB endpoints', async () => {
    read.mockResolvedValue({ status: 'selected', legalSupplier: '11111', legalNetwork: '22222', fields: { measurementMethod: 'Z04' } })
    const parties = dataRequestLegalParties(input())
    expect(parties).toEqual({ legalSupplier: '11111', legalNetwork: '22222' })
    const source = await requireDataRequestStructure({ companyId: 'company', environment: 'test', actorUserId: 'actor',
      customerId: 'customer', siteId: 'site', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-10-02', ...parties })
    expect(read).toHaveBeenCalledWith(expect.objectContaining(parties))
    expect(source.legalSupplier).toBe('11111')
    expect(source.legalNetwork).toBe('22222')
  })

  it('refuses a missing legal original selector instead of substituting a configured transport endpoint', () => {
    expect(() => dataRequestLegalParties({ ...input(), networkEdielId: null })).toThrow('legal_source_scope_required')
    const foreign = input(); foreign.route.actor.tenantIdentity!.companyId = 'foreign'
    expect(() => dataRequestLegalParties(foreign)).toThrow('legal_source_scope_required')
    const absent = input(); absent.route.actor.tenantIdentity = null
    expect(() => dataRequestLegalParties(absent)).toThrow('legal_source_scope_required')
  })

  it('does not turn a current route identity into approval of a different archived source party', async () => {
    read.mockResolvedValue({ status: 'selected', legalSupplier: '99001', legalNetwork: '22222', fields: { measurementMethod: 'Z04' } })
    await expect(requireDataRequestStructure({ companyId: 'company', environment: 'test', actorUserId: 'actor',
      customerId: 'customer', siteId: 'site', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-10-02', ...dataRequestLegalParties(input()) }))
      .rejects.toThrow('legal_party_mismatch')
  })
})
