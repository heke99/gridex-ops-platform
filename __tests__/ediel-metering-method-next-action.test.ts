import { describe, expect, it } from 'vitest'
import { deriveEdielMeteringMethodProcessNextAction } from '@/lib/ediel/operations/processNextAction'
import type { EdielBusinessExpectation } from '@/lib/ediel/businessExpectations'

const message:Parameters<typeof deriveEdielMeteringMethodProcessNextAction>[0]['message']={id:'own-z09',company_id:'own',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z09',status:'sent',requires_contrl:true,contrl_status:'received',contrl_due_at:null,requires_aperak:true,aperak_status:'pending'}
const watch:EdielBusinessExpectation={id:'private-own-watch',source_message_id:message.id,expected_code:'Z06',status:'pending',due_at:'2026-11-10T23:00:00Z',metadata:{
 timerRuleId:'TM-METHOD40',timerKind:'source_validity_day_watch',anchorType:'z09_validity_day',validityDay:'2026-10-01',dueDay:'2026-11-10',
 actualAcceptedAt:'2026-09-30T12:00:00Z',remoteReceiptKnown:false,automaticResendAllowed:false,authorizesMarketEffects:false,
 observationCriterion:'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day'}}
const decide=(e=watch,m=message,evaluatedAt='2026-10-01T12:00:00Z')=>deriveEdielMeteringMethodProcessNextAction({companyId:'own',message:m,expectation:e,evaluatedAt,access:{canRead:true,canReview:true,canPrepare:true}})

describe('OPS02 actual F/G validity-day watch presentation',()=>{
 it('retains the native validity/due day and keeps actual SMTP acceptance separate',()=>{
  expect(decide()).toMatchObject({cause:'business_response_pending',waitingFor:['Z06','APERAK'],timeBasis:{anchor:'z09_validity_day',anchorAt:'2026-10-01',validityDay:'2026-10-01',dueDay:'2026-11-10',actualAcceptedAt:'2026-09-30T12:00:00.000Z',businessDueAt:'2026-11-10T23:00:00.000Z'},authorizesProviderEntry:false,automaticResendAllowed:false})
  expect(decide().summary).toContain('giltighetsdag')
  const laterSmtp={...watch,metadata:{...watch.metadata,actualAcceptedAt:'2026-10-01T11:00:00Z'}}
  expect(decide(laterSmtp).timeBasis.businessDueAt).toBe(decide().timeBasis.businessDueAt)
 })
 it('positive technical ACK does not fulfil Z06, while a qualified fulfilled outcome stops only business waiting',()=>{
  expect(decide().cause).toBe('business_response_pending')
  expect(decide({...watch,status:'fulfilled'})).toMatchObject({cause:'business_response_received',waitingFor:['APERAK']})
 })
 it('negative APERAK requires review and does not fulfil the independent Z06 watch',()=>{
  expect(decide(watch,{...message,aperak_status:'failed'})).toMatchObject({cause:'technical_rejection',waitingFor:['Z06'],blockers:['application_response_rejected'],allowedActions:['read_source','review_case']})
 })
 it('expired native day/instant creates own review without remote late rejection or automatic send',()=>{
  expect(decide(watch,message,'2026-11-10T23:00:00Z')).toMatchObject({cause:'business_watch_overdue',blockers:['business_source_validity_watch_overdue'],waitingFor:['Z06','APERAK'],authorizesProviderEntry:false,automaticResendAllowed:false})
 })
 it('each invalid/missing native clock, rule, scope or claimed authority stays held',()=>{
  for(const changed of [{validityDay:'2026-02-31'},{dueDay:null},{actualAcceptedAt:null},{timerRuleId:'caller_rule'},{anchorType:'actual_accepted_smtp_observed_at'},{remoteReceiptKnown:true},{automaticResendAllowed:true},{authorizesMarketEffects:true},{observationCriterion:'any_Z06'}])
   expect(decide({...watch,metadata:{...watch.metadata,...changed}}).cause).toBe('source_context_held')
  expect(decide(watch,message,'2026-09-29T00:00:00Z').cause).toBe('source_context_held')
  expect(decide({...watch,source_message_id:'foreign'}).cause).toBe('source_context_held')
  expect(decide(watch,{...message,company_id:'foreign'}).allowedActions).toEqual([])
  expect(decide(watch,{...message,requires_contrl:true,contrl_status:'pending',contrl_due_at:null}).cause).toBe('source_context_held')
 })
 it('actual rejected/manual-review outcomes and technical deadline remain independent',()=>{
  expect(decide({...watch,status:'rejected'})).toMatchObject({cause:'business_response_rejected',waitingFor:['APERAK']})
  expect(decide({...watch,status:'manual_review'}).cause).toBe('business_watch_overdue')
  expect(decide(watch,{...message,contrl_status:'pending',contrl_due_at:'2026-10-01T11:00:00Z'})).toMatchObject({cause:'business_response_pending',responsibility:'tenant_operator',blockers:['technical_sender_watch_overdue'],waitingFor:['Z06','CONTRL','APERAK']})
 })
})
