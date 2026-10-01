import {beforeEach,expect,it,vi} from 'vitest'
import {buildEdielTgtRegisteredCustomerEventDraft,revalidateEdielTgtCustomerLifeEventDraft} from '@/lib/ediel/testing/tgtEdifact.part-4'
import {prepareTgtCustomerLifeEventSource,prepareTgtCustomerEventOriginal} from '@/lib/ediel/testing/tgtCustomerLifeEventSource'
import {certificationCustomerLifeEventContext,type ClassifiedCustomerEventFixtureBasis} from '@/lib/ediel/production/lifeEventCertificationSource'
import type {EdielTgtDraftBuildParams} from '@/lib/ediel/testing/tgtEdifact.part-1'
import {deathBody,deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {characteristic} from './fixtures/prodat-register'
const io=vi.hoisted(()=>({rpc:vi.fn(),subtype:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
// Named synthetic versioned case/subtype ports exercise the real original
// builder and validator. No actual case, original or grant is registered.
vi.mock('@/lib/ediel/testing/tgtRegistry',async original=>({...await original<typeof import('@/lib/ediel/testing/tgtRegistry')>(),getEdielTgtTestCaseByCode:()=>({approvalVersion:'DECLARED',expectedSteps:[{stepNo:1,actor:'gridex',direction:'outbound',family:'PRODAT',code:'Z09',required:true,title:'Declared E source',description:'Synthetic independent source boundary'}]})}))
vi.mock('@/lib/ediel/testing/tgtEdifact.part-2',async original=>({...await original<typeof import('@/lib/ediel/testing/tgtEdifact.part-2')>(),buildTgtProdatTransactionType:io.subtype}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function example(withStatus=true){
 const rawPayload=deathRaw('Z09',deathBody('E34',withStatus?characteristic('Z17','Z41'):[])),selection=deathSelection('death','Z09')
 const basis:ClassifiedCustomerEventFixtureBasis={status:'authorized',sourceKind:'independently_classified_fixture',authorizesBusinessEffect:false,companyId:'company-A',environment:'test',code:'Z09',rawPayload,declarationId:id(1),sourceVersion:'Declared',sourceDigest:'a'.repeat(64),sourceReference:'Declared independent decision',classification:'death',selection,fixtureRegistrationId:id(2),runId:id(3),expectedOutcome:withStatus?'positive':'negative',expectedDiagnosticCodes:withStatus?[]:['PRODAT_DEATH_STATUS_REQUIRED'],registeredCase:{roleCode:'supplier',suite:'PRODAT',caseCode:'DECLARED-E',revision:'DECLARED',stepNo:1}}
 const params:EdielTgtDraftBuildParams={actorUserId:id(4),testRunId:id(3),testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'DECLARED-E',stepNo:1,systemTestContext:{companyId:'company-A',testSuite:'PRODAT',actorSettingId:null,actorEdielId:'SUPPLIER',actorName:null,senderSubaddress:null,testPortalEdielId:'GRID',testPortalName:null,testPortalEmail:null,defaultReceiverSubaddress:'PRODAT',testBrpEdielId:null,testBrpName:null,settings:null}}
 return{basis,params}
}
async function prepared(withStatus=true){
 const{basis,params}=example(withStatus);io.rpc.mockResolvedValue({data:basis,error:null});const original=await prepareTgtCustomerEventOriginal({companyId:'company-A',runId:id(3),stepNo:1,actorUserId:id(4),family:'PRODAT',code:'Z09'})
 if(!original)throw Error('declared independent original missing');const d=buildEdielTgtRegisteredCustomerEventDraft(params,original);d.messageInput.communicationRouteId=id(6);return{d,basis,params,original}
}
beforeEach(()=>{vi.clearAllMocks();io.subtype.mockReturnValue('Z09E')})
it('keeps the complete registered bytes and actual refs; validates independent310 before outcome matching with null intent and real route',async()=>{
 const{d,basis}=await prepared(),other=d.validationIssues.filter(i=>!i.code.startsWith('PRODAT_DEATH_STATUS_')),raw=d.rawPayload
 expect(d.validationIssues.map(i=>i.code)).not.toContain('PRODAT_DEATH_STATUS_UNDETERMINED')
 const c=await prepareTgtCustomerLifeEventSource({draft:d,companyId:'company-A',runId:id(3),stepNo:1,actorUserId:id(4)})
 if(c?.direction!=='outbound')throw Error('source-only context missing')
 expect(c.intentId).toBeNull();expect(c.routeId).toBe(id(6));expect(d.rawPayload).toBe(raw);expect(d.rawPayload).toBe(basis.rawPayload);expect(d.messageInput.intentId).toBeUndefined()
 expect(d.messageInput.interchangeReference).toBe('I');expect(d.messageInput.externalReference).toBe('D')
 expect(d.validationIssues.filter(i=>!i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual(other)
 expect(io.rpc).toHaveBeenLastCalledWith('ediel_customer_event_certification_preparation_basis_v1',expect.not.objectContaining({p_expected_outcome:expect.anything()}))
})
it('reports the actual national310 negative and never invents status or replaces missing independent source with a negative prefix',async()=>{
 const{d}=await prepared(false),raw=d.rawPayload
 expect(d.validationIssues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_REQUIRED');expect(d.validationIssues.map(i=>i.code)).not.toContain('PRODAT_DEATH_STATUS_UNDETERMINED')
 io.rpc.mockResolvedValue({data:{status:'held',missing:['independent_classification']},error:null})
 await expect(prepareTgtCustomerLifeEventSource({draft:d,companyId:'company-A',runId:id(3),stepNo:1,actorUserId:id(4)})).rejects.toThrow('independent_classification')
 expect(d.rawPayload).toBe(raw);expect(d.rawPayload).not.toContain('CAV+Z41')
})
it('requires retained original/draft and exact null intent/route instead of copied caller authority',async()=>{
 const{d,basis,params,original}=await prepared(),c=certificationCustomerLifeEventContext({basis,companyId:'company-A',rawPayload:d.rawPayload,intentId:null,routeId:id(6)})
 expect(Object.isFrozen(original.basis.selection.objects[0].assessment)).toBe(true);expect(Object.isFrozen(original.basis.registeredCase)).toBe(true)
 expect(()=>buildEdielTgtRegisteredCustomerEventDraft(params,{...original})).toThrow('case_source_required')
 expect(()=>revalidateEdielTgtCustomerLifeEventDraft({...d},c)).toThrow('original_draft_validation_required')
 d.messageInput.intentId=id(9);expect(()=>revalidateEdielTgtCustomerLifeEventDraft(d,c)).toThrow('context_mismatch');delete d.messageInput.intentId
 d.messageInput.communicationRouteId=id(9);expect(()=>revalidateEdielTgtCustomerLifeEventDraft(d,c)).toThrow('context_mismatch')
})
it('cannot relabel an existing F/G/D step or mismatched case revision as E',async()=>{
 const{params,original}=await prepared();for(const subtype of['Z09F','Z09G','Z09D']){io.subtype.mockReturnValue(subtype);expect(()=>buildEdielTgtRegisteredCustomerEventDraft(params,original)).toThrow('versioned_customer_event_case_source_required')}
 io.subtype.mockReturnValue('Z09E');expect(()=>buildEdielTgtRegisteredCustomerEventDraft({...params,testCaseCode:'OTHER'},original)).toThrow('case_source_required')
})
