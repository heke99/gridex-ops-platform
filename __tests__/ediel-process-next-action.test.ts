import { describe, expect, it } from 'vitest'
import { deriveEdielProcessNextAction, deriveEdielReviewProcessDecision, readPersistedEdielReviewProcessDecision } from '@/lib/ediel/operations/processNextAction'
import type { EdielBusinessExpectation } from '@/lib/ediel/businessExpectations'
const now = '2026-10-01T12:20:00Z'
const message:Parameters<typeof deriveEdielProcessNextAction>[0]['message'] = {id:'actual-source',company_id:'own',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z01',
  requires_contrl:true,contrl_status:'pending',contrl_due_at:'2026-10-01T12:30:00Z',requires_aperak:false,aperak_status:'not_required',status:'sent'}
const watch = (extra:Partial<EdielBusinessExpectation>={}):EdielBusinessExpectation => ({id:'own-watch',source_message_id:message.id,expected_code:'Z02',
  status:'pending',due_at:'2026-10-01T12:30:00Z',metadata:{anchorType:'actual_accepted_smtp_observed_at',anchorAt:'2026-10-01T12:00:00Z',
    timerKind:'internal_sender_watch',remoteReceiptKnown:false,automaticResendAllowed:false,preparedPolicy:{guideRevision:'26-A',referenceDate:'2026-10-01'}},...extra})
const access = {canRead:true,canReview:true,canPrepare:true}
const decide = (w=watch(),m=message,at=now) => deriveEdielProcessNextAction({companyId:'own',message:m,expectation:w,evaluatedAt:at,access})
describe('OPS02 actual process outcome and independent timer projection',()=>{
  it('waits for business response and watches CONTRL in parallel with actual source clock and responsibility',()=>{
    expect(decide()).toMatchObject({cause:'business_response_pending',responsibility:'counterparty',waitingFor:['Z02_or_negative_APERAK','CONTRL'],
      timeBasis:{anchor:'actual_accepted_smtp_observed_at',anchorAt:'2026-10-01T12:00:00.000Z',businessDueAt:'2026-10-01T12:30:00.000Z',remoteReceiptKnown:false},
      blockers:[],allowedActions:['read_source'],authorizesProviderEntry:false,automaticResendAllowed:false})
  })
  it('a technical ACK cannot satisfy or serialize the business watch',()=>{
    const d=decide(watch(),{...message,contrl_status:'received'})
    expect(d.cause).toBe('business_response_pending');expect(d.waitingFor).toEqual(['Z02_or_negative_APERAK'])
  })
  it('an actual fulfilled business outcome stops business waiting even if technical ACK is pending',()=>{
    const d=decide(watch({status:'fulfilled'}));expect(d.cause).toBe('business_response_received')
    expect(d.waitingFor).toEqual(['CONTRL']);expect(d.allowedActions).toEqual(['read_source'])
  })
  it('actual rejected business result requires own review; a positive technical ACK cannot promote it',()=>{
    expect(decide(watch({status:'rejected'}),{...message,contrl_status:'received'})).toMatchObject({cause:'business_response_rejected',responsibility:'tenant_operator',
      waitingFor:[],blockers:['business_response_rejected'],allowedActions:['read_source','review_case']})
  })
  it('expired own sender watch becomes review, never fabricated remote late rejection or resend',()=>{
    const d=decide(watch(),message,'2026-10-01T12:30:00Z')
    expect(d).toMatchObject({cause:'business_watch_overdue',responsibility:'tenant_operator',blockers:['business_sender_watch_overdue','technical_sender_watch_overdue'],
      allowedActions:['read_source','review_case'],automaticResendAllowed:false,authorizesProviderEntry:false})
    expect(d.summary).not.toContain('motparten har brutit')
  })
  it('persisted manual-review outcome stays a review even if a later caller clock is earlier',()=>{
    expect(decide(watch({status:'manual_review'}))).toMatchObject({cause:'business_watch_overdue',allowedActions:['read_source','review_case']})
  })
  it('Z18/Z15 has no invented deadline while the independent technical watch remains',()=>{
    const w=watch({expected_code:'Z15',due_at:null,metadata:{...watch().metadata,timerKind:'untimed_business_response'}})
    expect(decide(w,{...message,message_code:'Z18'})).toMatchObject({cause:'business_response_pending',waitingFor:['Z15','CONTRL'],timeBasis:{businessDueAt:null}})
  })
  it('bad own clock/scope/source mapping is held, never repaired from caller labels',()=>{
    for(const w of [watch({source_message_id:'foreign'}),watch({expected_code:'Z14'}),watch({metadata:{}}),watch({due_at:'2026-09-30T00:00:00Z'}),watch({status:'public_ready'})])
      expect(decide(w)).toMatchObject({cause:'source_context_held',allowedActions:['read_source','review_case'],authorizesProviderEntry:false})
    expect(decide(watch(),{...message,company_id:'foreign'}).allowedActions).toEqual([])
    expect(decide(watch(),message,'not-a-clock').cause).toBe('source_context_held')
  })
  it('current UI permission controls only visibility and never grants native operation authority',()=>{
    const d=deriveEdielProcessNextAction({companyId:'own',message,expectation:watch({status:'rejected'}),evaluatedAt:now,access:{canRead:true,canReview:false,canPrepare:true}})
    expect(d.allowedActions).toEqual(['read_source']);expect(d.authorizesProviderEntry).toBe(false)
    const denied=deriveEdielProcessNextAction({companyId:'own',message,expectation:watch(),evaluatedAt:now,access:{canRead:false,canReview:true,canPrepare:true}})
    expect(denied.allowedActions).toEqual([])
  })
  it('actual inbound review retains admission clock separately and cannot inherit the current wall or document clock',()=>{
    const d=deriveEdielReviewProcessDecision({message:{id:'inbound-source',message_received_at:'2026-10-01T10:00:00Z'},reviewIntent:'meter_change_review',nextAction:'Granska faktisk mätarhändelse.'})
    expect(d).toMatchObject({cause:'meter_change_review',responsibility:'tenant_operator',timeBasis:{anchor:'actual_inbound_admission',admittedAt:'2026-10-01T10:00:00.000Z',protocolDeadline:null},authorizesProviderEntry:false})
    expect(Object.isFrozen(d)).toBe(true)
    const held=deriveEdielReviewProcessDecision({message:{id:'inbound-source',message_received_at:null},reviewIntent:'public_ready',nextAction:'Skicka direkt'})
    expect(held).toMatchObject({cause:'source_business_review',blockers:['actual_admission_time_required'],timeBasis:{admittedAt:null}})
    expect(held.summary).not.toBe('Skicka direkt')
  })
  it('persisted review metadata cannot substitute another source, clock or action authority',()=>{
    const input={message:{id:'inbound-source',message_received_at:'2026-10-01T10:00:00Z'},reviewIntent:'meter_change_review',nextAction:'Granska faktisk mätarhändelse.'}
    const decision=deriveEdielReviewProcessDecision(input)
    expect(readPersistedEdielReviewProcessDecision(decision,input)).toEqual(decision)
    for(const mutated of [{...decision,sourceMessageId:'foreign'},{...decision,authorizesProviderEntry:true},
      {...decision,timeBasis:{...decision.timeBasis,admittedAt:'2026-10-01T11:00:00.000Z'}},
      {...decision,candidateActions:['send_now']},{...decision,summary:'Skicka direkt'}])
      expect(readPersistedEdielReviewProcessDecision(mutated,input)).toBeNull()
    expect(readPersistedEdielReviewProcessDecision(decision,{...input,message:{...input.message,message_received_at:null}})).toBeNull()
  })
})
