// The database's exact private lineage/service source and current actor are
// declared external IO boundaries. Actual adapters/reporting copier are real;
// no authenticated original, approval, history or activation is seeded here.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),actor:vi.fn(),route:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:io.route}))
import {loadServicePermissionRecoveryOrigin,loadServicePermissionMessageOrigin,type ServicePermissionOriginBasis} from '@/lib/ediel/services/permissionOrigin'
import {buildServiceReportingContext,loadServiceReportingRecoveryContext,loadServiceReportingValidationContext} from '@/lib/ediel/services/reporting'
import {copyReportingSelection} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),operationId:id(2),actorUserId:id(3)}
const route={companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(4)},legalActorEdielId:'21660'},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',route:{id:id(10)},routeRuntime:{route_profile_id:id(9)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
function message(n:number,code:'Z13'|'Z18'):EdielMessageRow{return{
 id:id(n),company_id:id(1),direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:code,message_version:'26.A',process_type:'metering_access',environment:'test',test_flag:1,status:'sent',
 transport_type:'smtp',mailbox:null,mailbox_message_id:null,sender_ediel_id:'99111',sender_name:null,sender_sub_address:null,receiver_ediel_id:'54321',receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:'dso@example.invalid',subject:null,file_name:null,mime_type:null,
 interchange_reference:`UNB-${n}`,external_reference:`BGM-${n}`,correlation_reference:null,transaction_reference:'OWN-LI',application_reference:'23-DDQ-PRODAT',original_message_id:null,original_transaction_id:null,original_message_code:null,related_message_id:null,
 communication_route_id:id(10),route_profile_id:id(9),outbound_request_id:id(n+100),intent_id:id(n+200),switch_request_id:null,grid_owner_data_request_id:null,partner_export_id:null,customer_id:id(6),site_id:null,metering_point_id:null,grid_owner_id:null,
 raw_payload:`DECLARED-PRIVATE-RAW-${n}`,parsed_payload:{},validation_report:{},requires_contrl:true,requires_aperak:true,contrl_status:'received',aperak_status:'received',utilts_err_status:null,ack_outcome:'negative',syntax_check_status:'accepted',functional_check_status:'accepted',failure_reason:null,
 message_created_at:null,message_received_at:null,message_sent_at:'2026-10-01T12:00:00Z',parsed_at:null,validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z',created_by:id(7),updated_by:null}}
let basis:ServicePermissionOriginBasis,root:EdielMessageRow,immediate:EdielMessageRow,next:EdielMessageRow,recovery:Record<string,unknown>
let rows:Map<string,EdielMessageRow>
function fixture(code:'Z13'|'Z18'='Z13'){
 basis={status:'authorized',companyId:id(1),assignmentId:id(20),assignmentVersion:2,scopeBasisVersion:1,permissionId:id(21),permissionStateVersion:3,code,environment:'test',providerActorId:id(4),dsoActorId:id(5),legalSenderId:'21660',legalReceiverId:'54321',customerId:id(6),customer:{org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic Customer',country:'SE'},mode:'V',agreementReference:'SOURCE-ANJ',requestedMethod:'Z04',purposeCode:'B72',frequency:'D',reportingTerm:'bounded',customerClassification:'nonprivate',terminationReason:'Z32',evidenceId:id(22),evidenceSha256:'a'.repeat(64),evidenceVersion:'DECLARED-EXTERNAL-SERVICE-SOURCE',li:code==='Z18'?'OWN-LI':null,objects:[{point:code==='Z13'?null:'OWN-POINT',permissionId:code==='Z18'?'OWN-PERMISSION':null,product:'8716867000030',gridArea:'TES',reportStart:'2026-09-01T00:00:00+01:00',reportEnd:'2027-01-01T00:00:00+01:00'}]}
 root=message(30,code);root.parsed_payload={sourcePermissionBasis:basis}
 immediate=message(31,code);immediate.source_operation_id=id(50);immediate.original_message_id=root.id
 next=message(32,code);next.source_operation_id=input.operationId;next.original_message_id=immediate.id
 recovery={operationId:input.operationId,originalMessageId:immediate.id,sourceOriginMessageId:root.id,correctedPayloadHash:createHash('sha256').update(next.raw_payload!).digest('hex'),allowedObjects:[{point:basis.objects[0].point,li:'OWN-LI',customerIdentity:'SYNTHETIC-CUSTOMER',reason:code==='Z13'?'S17':'Z32'}]}
 const payload={sourcePermissionBasis:basis,authorizationReference:'SOURCE-ANJ'}
 if(code==='Z13'){
  const context=buildServiceReportingContext(basis,{id:root.intent_id!,routeProfileId:id(9),transactionReference:'OWN-LI',payload},route,id(7))
  const reportingPermission=copyReportingSelection({source:context.source,objects:context.objects})
  root.parsed_payload.prodatEngine={registerEvidence:{facts:{reportingPermission}}}
  next.parsed_payload.prodatEngine={registerEvidence:{facts:{reportingPermission}}}
 }
 rows=new Map([[root.id,root],[immediate.id,immediate],[next.id,next]])
 io.rpc.mockImplementation(async(name:string)=>({data:name.startsWith('ediel_prodat_recovery_')?recovery:{basis,intentId:root.intent_id,actorUserId:id(7)},error:null}))
 io.from.mockImplementation((table:string)=>{let selectedId='';const query={select:()=>query,eq:(field:string,value:string)=>{if(field==='id')selectedId=value;return query},maybeSingle:async()=>({data:table==='ediel_message_intents'?{id:root.intent_id,company_id:id(1),payload,route_profile_id:id(9),transaction_reference:'OWN-LI'}:rows.get(selectedId),error:null})};return query})
}
beforeEach(()=>{vi.clearAllMocks();io.actor.mockResolvedValue(undefined);io.route.mockResolvedValue(route);fixture()})
it('loads the native terminal source and preserves the immediate failed original/new intent for a second correction',async()=>{
 const result=await loadServicePermissionRecoveryOrigin(input)
 expect(result?.originalMessage.id).toBe(immediate.id);expect(result?.sourceMessage.id).toBe(root.id)
 expect(result?.sourceIntentId).toBe(root.intent_id);expect(next.intent_id).not.toBe(root.intent_id)
 expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_message_basis_v1',{p_company_id:id(1),p_message_id:root.id,p_actor_user_id:id(3),p_phase:'prepare'})
 expect(io.actor.mock.calls.every(([call])=>call.actorUserId===id(3)&&call.permission==='communication.write')).toBe(true)
})
it('uses only SEND for the actual sender after exact new-message/hash qualification',async()=>{
 const result=await loadServicePermissionMessageOrigin(next,id(3));expect(result?.originalMessage.id).toBe(immediate.id)
 expect(io.actor.mock.calls.every(([call])=>call.permissionAnyOf?.join(',')==='ediel.send,communication.send')).toBe(true)
 expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_message_basis_v1',{p_company_id:id(1),p_message_id:root.id,p_actor_user_id:id(3),p_phase:'send'})
})
it('does not discover aliases from parsed claims or guess a missing terminal selector',async()=>{
 delete recovery.sourceOriginMessageId;immediate.parsed_payload.sourcePermissionBasis=basis
 await expect(loadServicePermissionRecoveryOrigin(input)).rejects.toThrow('operation_unqualified');expect(io.from).not.toHaveBeenCalled()
})
it('holds revoked private service grounds instead of falling back to TGT/parsed facts',async()=>{
 io.rpc.mockImplementation(async(name:string)=>name==='ediel_service_permission_message_basis_v1'?{data:null,error:Error('source_revoked')}:{data:recovery,error:null})
 await expect(loadServiceReportingRecoveryContext(input)).rejects.toThrow('source_revoked')
})
it('uses a qualified NULL service binding for an ordinary fixture despite forged parsed claims',async()=>{
 immediate.parsed_payload.sourcePermissionBasis=basis;io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_service_permission_message_basis_v1'?null:recovery,error:null}))
 expect(await loadServicePermissionRecoveryOrigin(input)).toBeUndefined()
})
it('holds missing or changed immutable original source snapshots after the private read',async()=>{
 root.parsed_payload={};await expect(loadServicePermissionRecoveryOrigin(input)).rejects.toThrow('origin_stale')
})
it.each(['point','li','customerIdentity','reason'] as const)('rejects widening the newest failed own %s',async(field)=>{
 recovery.allowedObjects=[{...(recovery.allowedObjects as Record<string,unknown>[])[0],[field]:'FOREIGN'}]
 await expect(loadServicePermissionRecoveryOrigin(input)).rejects.toThrow('object_scope_invalid')
})
it.each(['environment','message_code','company_id','customer_id'] as const)('holds a changed terminal %s',async(field)=>{
 rows.set(root.id,{...root,[field]:field==='environment'?'production':field==='message_code'?'Z18':id(99)})
 await expect(loadServicePermissionRecoveryOrigin(input)).rejects.toThrow(/scope_invalid|not_owned/)
})
it('builds real reporting context from the terminal private service intent while returning the immediate original',async()=>{
 const result=await loadServiceReportingRecoveryContext(input)
 expect(result?.originalMessage.id).toBe(immediate.id);expect(result?.context.source.kind).toBe('service_permission')
 if(result?.context.source.kind==='service_permission')expect(result.context.source.intentId).toBe(root.intent_id)
 expect(result?.context.objects[0].li).toBe('OWN-LI');expect(io.route).toHaveBeenCalledOnce()
})
it('revalidates a second correction with the same source proof and SEND-only phase',async()=>{
 const result=await loadServiceReportingValidationContext(next,id(3));expect(result?.objects[0].li).toBe('OWN-LI')
 expect(io.actor.mock.calls.every(([call])=>call.permissionAnyOf?.join(',')==='ediel.send,communication.send')).toBe(true)
})
it('holds changed protected reporting evidence and stale actual correction bytes',async()=>{
 next.parsed_payload.prodatEngine={registerEvidence:{facts:{reportingPermission:{forged:true}}}}
 await expect(loadServiceReportingValidationContext(next,id(3))).rejects.toThrow()
 next.raw_payload='CHANGED';await expect(loadServicePermissionMessageOrigin(next,id(3))).rejects.toThrow('message_unqualified')
})
it('keeps Z18 newest failed object limits and authentic permission LI without new service bindings',async()=>{
 fixture('Z18');const result=await loadServicePermissionRecoveryOrigin(input)
 expect(result?.basis.code).toBe('Z18');expect(result?.originalMessage.id).toBe(immediate.id)
 expect(result?.allowedObjects).toHaveLength(1);expect(io.rpc.mock.calls.some(([name])=>String(name).includes('reserve'))).toBe(false)
})
it('performs no private/tenant source read when the actual executor is denied',async()=>{
 io.actor.mockRejectedValue(Error('actual_actor_denied'));await expect(loadServiceReportingRecoveryContext(input)).rejects.toThrow('actual_actor_denied')
 expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})
