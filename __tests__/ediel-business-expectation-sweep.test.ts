import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sweepEdielBusinessExpectations } from '@/lib/ediel/operations/businessExpectationSweep'
const io = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), expire: vi.fn(), methodRead:vi.fn(),methodExpire:vi.fn(), readSources:vi.fn() }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: (companyId: string) => {
  expect(companyId).toEqual('own-company')
  return { from: () => ({ select: () => ({ in: io.readSources }) }) }
} }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/ediel/businessExpectations', () => ({ readEdielBusinessExpectations: io.read, expireEdielBusinessExpectations: io.expire }))
vi.mock('@/lib/ediel/meteringMethodExpectations',()=>({readEdielMeteringMethodExpectations:io.methodRead,expireEdielMeteringMethodExpectations:io.methodExpire}))
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

function watchRows(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const source = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const metering = index >= 100
    const metadata = metering
      ? { timerRuleId:'TM-METHOD40', timerKind:'source_validity_day_watch', anchorType:'z09_validity_day',
          validityDay:'2020-01-01', dueDay:'2999-01-01', actualAcceptedAt:'2020-01-01T00:00:00Z',
          automaticResendAllowed:false, authorizesMarketEffects:false,
          observationCriterion:'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day' }
      : { anchorAt:'2020-01-01T00:00:00Z', anchorType:'actual_accepted_smtp_observed_at', timerKind:'internal_sender_watch' }
    return { id:`watch-${source}`, source_message_id:source, expected_code:metering ? 'Z06' : 'Z14', status:'pending',
      due_at:'2999-01-01T00:00:00Z', metadata:{...metadata,remoteReceiptKnown:false} }
  })
}

function withWatchProjections(rows: ReturnType<typeof watchRows>) {
  const ordinary = rows.slice(0, 100)
  const metering = rows.slice(100)
  const readOwner = (owner: typeof rows) => async ({environment,messageId}: {environment:string;messageId?:string}) =>
    environment !== 'test' || !messageId ? [] : owner.filter(row => row.source_message_id === messageId)
  io.read.mockImplementation(readOwner(ordinary))
  io.methodRead.mockImplementation(readOwner(metering))
  io.expire.mockImplementation(async ({environment}) => environment === 'test' ? ordinary : [])
  io.methodExpire.mockImplementation(async ({environment}) => environment === 'test' ? metering : [])
  io.readSources.mockImplementation(async (_column:string, ids:string[]) => ({
    error:null,data:ids.map(id => ({id,company_id:'own-company',environment:'test',direction:'outbound',
      message_family:'PRODAT',message_code:ordinary.some(row=>row.source_message_id===id)?'Z13':'Z09',
      status:'sent',requires_contrl:false,requires_aperak:false})),
  }))
}

describe('combined source-owner watch projection', () => {
  it.each([99, 100, 101, 200])('projects all %s observed sources without crossing the per-read limit', async count => {
    const rows = watchRows(count)
    withWatchProjections(rows)
    const result = await sweepEdielBusinessExpectations({ actorUserId:'actual-actor' })
    expect(result.blocked).toEqual([])
    expect(result.observed).toBe(count)
    expect(result.nextActions.map(row=>row.decision.sourceMessageId)).toEqual(rows.map(row=>row.source_message_id))
    expect(result.nextActions.map(row=>row.decision.waitingFor)).toEqual(rows.map(row=>[row.expected_code]))
    expect(io.readSources.mock.calls.every(([, ids])=>ids.length<=100)).toBe(true)
    expect(result.nextActions.every(row=>row.environment==='test' &&
      row.decision.authorizesProviderEntry===false && row.decision.automaticResendAllowed===false)).toBe(true)
  })

  it('returns the successful group and the precise failed source IDs when one projection read fails', async () => {
    const rows = watchRows(101)
    withWatchProjections(rows)
    const query = io.readSources.getMockImplementation()!
    io.readSources.mockImplementation(async (column:string, ids:string[]) => {
      if (ids.includes(rows[0].source_message_id)) return {error:new Error('synthetic project read unavailable'),data:null}
      return query(column, ids)
    })
    const result = await sweepEdielBusinessExpectations({ actorUserId:'actual-actor' })
    expect(result).toMatchObject({ observed:101, nextActions:[{
      companyId:'own-company',environment:'test',decision:{sourceMessageId:rows[100].source_message_id},
    }], blocked:[{companyId:'own-company',environment:'test',operation:'project',reason:'synthetic project read unavailable',
      sourceMessageIds:rows.slice(0,100).map(row=>row.source_message_id),
    }] })
    withWatchProjections(rows)
    const replay = await sweepEdielBusinessExpectations({ actorUserId:'actual-actor' })
    expect(replay.blocked).toEqual([])
    expect(replay.nextActions).toHaveLength(101)
  })
})
