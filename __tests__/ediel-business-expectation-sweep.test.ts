import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sweepEdielBusinessExpectations } from '@/lib/ediel/operations/businessExpectationSweep'
const io = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), expire: vi.fn(), methodRead:vi.fn(),methodExpire:vi.fn(), tenant:vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/ediel/businessExpectations', () => ({ readEdielBusinessExpectations: io.read, expireEdielBusinessExpectations: io.expire }))
vi.mock('@/lib/ediel/meteringMethodExpectations',()=>({readEdielMeteringMethodExpectations:io.methodRead,expireEdielMeteringMethodExpectations:io.methodExpire}))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: io.tenant }))
function memberships(rows: Array<{ company_id: string | null }>) {
  const query = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn() }
  for (const fn of [query.select, query.eq, query.not, query.order]) fn.mockReturnValue(query)
  query.limit.mockResolvedValue({ data: rows, error: null }); io.from.mockReturnValue(query)
  return query
}
beforeEach(() => { vi.clearAllMocks(); memberships([{ company_id: 'own-company' }]);io.read.mockResolvedValue([]);io.expire.mockResolvedValue([]);io.methodRead.mockResolvedValue([]);io.methodExpire.mockResolvedValue([]) })
describe('business watch automation scopes', () => {
  it('uses accepted active own membership and separate explicit environment/actor scope', async () => {
    const query = memberships([{ company_id: 'own-company' }, { company_id: 'own-company' }, { company_id: null }])
    io.expire.mockResolvedValue([{ id: 'own-watch', status: 'manual_review' }])
    expect(await sweepEdielBusinessExpectations({ actorUserId: 'actual-actor', limit: 1000 })).toMatchObject({ scopes: 2, observed: 2, manualReview: 2, blocked: [] })
    expect(query.eq).toHaveBeenCalledWith('user_id', 'actual-actor');expect(query.eq).toHaveBeenCalledWith('status', 'active');expect(query.eq).toHaveBeenCalledWith('is_active', true);expect(query.not).toHaveBeenCalledWith('accepted_at', 'is', null)
    expect(io.read).toHaveBeenNthCalledWith(1, { companyId: 'own-company', environment: 'test', actorUserId: 'actual-actor', limit: 100 })
    expect(io.expire).toHaveBeenNthCalledWith(2, { companyId: 'own-company', environment: 'production', actorUserId: 'actual-actor', limit: 100 })
  })
  it('cannot expire a scope whose current actor cannot read; other scopes continue', async () => {
    io.read.mockRejectedValueOnce(new Error('ediel_expectation_actor_not_authorized'))
    const result = await sweepEdielBusinessExpectations({ actorUserId: 'actual-actor' })
    expect(result.blocked).toEqual([{ companyId: 'own-company', environment: 'test', operation: 'read', reason: 'ediel_expectation_actor_not_authorized' }]);expect(io.expire).toHaveBeenCalledTimes(1);expect(io.expire.mock.calls[0][0].environment).toBe('production')
  })
  it('reports an independently rejected send-level expiry without retrying or changing outcomes', async () => {
    io.expire.mockRejectedValue({ message: 'send_permission_required' })
    io.methodExpire.mockRejectedValue({ message:'send_permission_required' })
    const result = await sweepEdielBusinessExpectations({ actorUserId: 'actual-actor' })
    expect(result.scopes).toBe(0);expect(result.blocked).toHaveLength(4);expect(result.blocked.every(row => row.operation === 'expire')).toBe(true);expect(io.expire).toHaveBeenCalledTimes(2)
  })
  it('continues the actual metering-method watch when another independent owner is unavailable',async()=>{
    io.read.mockRejectedValue(new Error('business_owner_unavailable'))
    io.methodExpire.mockResolvedValue([{id:'own-method-watch',status:'manual_review'}])
    const result=await sweepEdielBusinessExpectations({actorUserId:'actual-actor'})
    expect(result).toMatchObject({scopes:2,observed:2,manualReview:2})
    expect(result.blocked).toHaveLength(2);expect(io.expire).not.toHaveBeenCalled()
    expect(io.methodRead).toHaveBeenNthCalledWith(1,{companyId:'own-company',environment:'test',actorUserId:'actual-actor',limit:100})
    expect(io.methodExpire).toHaveBeenNthCalledWith(2,{companyId:'own-company',environment:'production',actorUserId:'actual-actor',limit:100})
  })
  it('counts an expectation once when common and dedicated projections contain the same own row',async()=>{
    io.expire.mockResolvedValue([{id:'same-watch',status:'manual_review'}]);io.methodExpire.mockResolvedValue([{id:'same-watch',status:'manual_review'}])
    expect(await sweepEdielBusinessExpectations({actorUserId:'actual-actor'})).toMatchObject({scopes:2,observed:2,manualReview:2,blocked:[]})
  })
  it('has no authority without an actor and does not silently truncate an oversized company scope', async () => {
    await expect(sweepEdielBusinessExpectations({ actorUserId: '' })).rejects.toThrow('actor_required');expect(io.from).not.toHaveBeenCalled()
    memberships(Array.from({ length: 201 }, (_, i) => ({ company_id: `company-${i}` })))
    await expect(sweepEdielBusinessExpectations({ actorUserId: 'actual-actor' })).rejects.toThrow('scope_limit');expect(io.read).not.toHaveBeenCalled();expect(io.expire).not.toHaveBeenCalled()
  })
})

function seedProjection(total: number) {
  const businessCount = Math.ceil(total / 2)
  const ownerRows = Array.from({ length: total }, (_, index) => {
    const method = index >= businessCount
    return {
      id: `watch-${index}`,
      source_message_id: `source-${index}`,
      expected_code: method ? 'Z06' : 'Z02',
      status: 'pending',
      due_at: '2099-01-01T23:00:00Z',
      metadata: method ? {
        timerRuleId: 'TM-METHOD40',
        timerKind: 'source_validity_day_watch',
        anchorType: 'z09_validity_day',
        validityDay: '2025-01-01',
        dueDay: '2099-01-01',
        actualAcceptedAt: '2025-01-01T12:00:00Z',
        remoteReceiptKnown: false,
        automaticResendAllowed: false,
        authorizesMarketEffects: false,
        observationCriterion: 'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day',
      } : {
        anchorType: 'actual_accepted_smtp_observed_at',
        anchorAt: '2025-01-01T12:00:00Z',
        timerKind: 'internal_sender_watch',
        remoteReceiptKnown: false,
      },
    }
  })
  const businessRows = ownerRows.slice(0, businessCount)
  const methodRows = ownerRows.slice(businessCount)
  const scopedRead = (rows: typeof ownerRows) => async ({ environment, messageId }: {
    environment: string
    messageId?: string
  }) => environment === 'test' ? rows.filter(row => !messageId || row.source_message_id === messageId) : []
  io.read.mockImplementation(scopedRead(businessRows))
  io.expire.mockImplementation(scopedRead(businessRows))
  io.methodRead.mockImplementation(scopedRead(methodRows))
  io.methodExpire.mockImplementation(scopedRead(methodRows))

  const sources = ownerRows.map(row => ({
    id: row.source_message_id,
    company_id: 'own-company',
    environment: 'test',
    direction: 'outbound',
    message_family: 'PRODAT',
    message_code: row.expected_code === 'Z06' ? 'Z09' : 'Z01',
    status: 'sent',
    requires_contrl: true,
    contrl_status: 'received',
    contrl_due_at: null,
    requires_aperak: false,
    aperak_status: 'not_required',
  }))
  const sourceRead = vi.fn(async (_column: string, ids: string[]) => ({
    data: sources.filter(source => ids.includes(source.id)),
    error: null as Error | null,
  }))
  io.tenant.mockReturnValue({ from: () => ({ select: () => ({ in: sourceRead }) }) })
  return { sources, sourceRead }
}

describe('EDIEL-BEV-02 combined business watch projection', () => {
  it.each([99, 100, 101, 200])('projects every source from %i observations in bounded batches', async total => {
    const { sources, sourceRead } = seedProjection(total)

    const result = await sweepEdielBusinessExpectations({ actorUserId: 'actual-actor' })

    expect(result.observed).toBe(total)
    expect(result.blocked).toEqual([])
    expect(result.nextActions.map(action => action.decision.sourceMessageId)).toEqual(sources.map(source => source.id))
    expect(sourceRead.mock.calls.map(([, ids]) => ids.length)).toEqual(total > 100 ? [100, total - 100] : [total])
    expect(result.nextActions.every(action =>
      action.companyId === 'own-company'
      && action.environment === 'test'
      && action.decision.cause === 'business_response_pending'
      && !action.decision.authorizesProviderEntry
    )).toBe(true)
  })

  it('projects the following batch when the first batch is unavailable', async () => {
    const { sources, sourceRead } = seedProjection(101)
    sourceRead.mockResolvedValueOnce({ data: [], error: new Error('temporary projection read failure') })

    const result = await sweepEdielBusinessExpectations({ actorUserId: 'actual-actor' })

    expect(result.observed).toBe(101)
    expect(result.blocked).toEqual([
      {
        companyId: 'own-company',
        environment: 'test',
        operation: 'project',
        reason: 'temporary projection read failure',
        sourceMessageIds: sources.slice(0, 100).map(source => source.id),
      },
    ])
    expect(result.nextActions.map(action => action.decision.sourceMessageId)).toEqual(['source-100'])
  })
})
