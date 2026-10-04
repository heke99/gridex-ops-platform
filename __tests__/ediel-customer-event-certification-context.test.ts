import {beforeEach,expect,it,vi} from 'vitest'
import {prepareCustomerLifeEventCertificationContext,certificationCustomerLifeEventContext,type ClassifiedCustomerEventFixtureBasis} from '@/lib/ediel/production/lifeEventCertificationSource'
import {deathStatusSendIssue,isQualifiedDeathStatusContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {deathBody,deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {characteristic} from './fixtures/prodat-register'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function example(){
 const rawPayload=deathRaw('Z09',deathBody('E34',characteristic('Z17','Z41')))
 const basis:ClassifiedCustomerEventFixtureBasis={status:'authorized',sourceKind:'independently_classified_fixture',authorizesBusinessEffect:false,companyId:'company-A',environment:'test',code:'Z09',rawPayload,
  declarationId:id(1),sourceVersion:'CLASSIFICATION-R1',sourceDigest:'a'.repeat(64),sourceReference:'DECLARED-TEST-ONLY',classification:'death',selection:deathSelection('death','Z09'),fixtureRegistrationId:id(2),runId:id(3),expectedOutcome:'positive',expectedDiagnosticCodes:[]}
 const input={companyId:basis.companyId,actorUserId:id(4),rawPayload,runId:basis.runId,stepNo:1,expectedOutcome:'positive' as const,intentId:id(5),routeId:id(6)}
 const row={direction:'outbound',company_id:basis.companyId,environment:'test',message_family:'PRODAT',message_code:'Z09',raw_payload:rawPayload,intent_id:input.intentId,communication_route_id:input.routeId}
 return{basis,input,row}
}
beforeEach(()=>vi.clearAllMocks())
it('uses exact registered selectors and returns only a native independently classified source-only context',async()=>{
 const{basis,input,row}=example();io.rpc.mockResolvedValue({data:basis,error:null})
 const result=await prepareCustomerLifeEventCertificationContext(input)
 expect(io.rpc).toHaveBeenCalledWith('ediel_customer_event_certification_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_run_id:input.runId,p_step_no:input.stepNo,p_raw_payload:input.rawPayload,p_expected_outcome:'positive'})
 expect(isQualifiedDeathStatusContext(result)).toBe(true)
 if(!isQualifiedDeathStatusContext(result))throw Error('declared source port did not return context')
 expect(result.certification?.authorizesBusinessEffect).toBe(false);expect(deathStatusSendIssue(row,result)).toBeNull()
 expect(isQualifiedDeathStatusContext(JSON.parse(JSON.stringify(result)))).toBe(false)
 expect(deathStatusSendIssue({...row,environment:'production'},result)?.code).toBe('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})
it('keeps missing independent classification held and does not infer it from valid Z41',async()=>{
 const{input}=example();io.rpc.mockResolvedValue({data:{status:'held',missing:['independent_authentic_certification_customer_event_classification']},error:null})
 expect(await prepareCustomerLifeEventCertificationContext(input)).toEqual({status:'held',missing:['independent_authentic_certification_customer_event_classification']})
 io.rpc.mockResolvedValue({data:null,error:null});expect(await prepareCustomerLifeEventCertificationContext(input)).toBeUndefined()
 io.rpc.mockResolvedValue({data:null,error:Error('actual source unavailable')});await expect(prepareCustomerLifeEventCertificationContext(input)).rejects.toThrow('actual source unavailable')
})
it('rejects mismatched native run/outcome/raw/business grant and cannot restore a credential',async()=>{
 const{basis,input}=example()
 for(const bad of[{...basis,runId:id(99)},{...basis,expectedOutcome:'negative'},{...basis,rawPayload:basis.rawPayload+'x'},{...basis,authorizesBusinessEffect:true}]){
  io.rpc.mockResolvedValue({data:bad,error:null});await expect(prepareCustomerLifeEventCertificationContext(input)).rejects.toThrow('basis_invalid')
 }
})
it('allows only its expected national310 negative through the source send boundary; canonical fixture admission remains separate',()=>{
 const{basis,input,row}=example(),rawPayload=deathRaw('Z09',deathBody('E34'))
 const native={...basis,rawPayload,expectedOutcome:'negative' as const,expectedDiagnosticCodes:['PRODAT_DEATH_STATUS_REQUIRED']}
 const context=certificationCustomerLifeEventContext({basis:native,companyId:input.companyId,rawPayload,intentId:input.intentId,routeId:input.routeId})
 expect(deathStatusSendIssue({...row,raw_payload:rawPayload},context)).toBeNull()
 const mismatch=certificationCustomerLifeEventContext({basis:{...native,expectedDiagnosticCodes:['UNRELATED']},companyId:input.companyId,rawPayload,intentId:input.intentId,routeId:input.routeId})
 expect(deathStatusSendIssue({...row,raw_payload:rawPayload},mismatch)?.code).toBe('PRODAT_DEATH_STATUS_REQUIRED')
})
