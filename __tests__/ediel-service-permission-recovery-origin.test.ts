import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
import {loadServicePermissionRecoveryOrigin} from '@/lib/ediel/services/permissionOrigin'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={companyId:id(1),operationId:id(2),actorUserId:id(3)}
const basis={status:'authorized',companyId:id(1),assignmentId:id(4),assignmentVersion:2,scopeBasisVersion:1,code:'Z18',environment:'test',customerId:id(8),customer:{org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic',country:'SE'},mode:'V',terminationReason:'Z32',li:'owned-li',objects:[{point:'owned-point',permissionId:'source-permission',product:'8716867000030'}]}
const original={id:id(5),company_id:id(1),direction:'outbound',message_family:'PRODAT',message_code:'Z18',environment:'test',customer_id:id(8),intent_id:id(6),parsed_payload:{sourcePermissionBasis:basis}}
const recovery={originalMessageId:id(5),sourceOriginMessageId:id(5),operationId:id(2),correctedPayloadHash:'a'.repeat(64),allowedObjects:[{point:'owned-point',li:'owned-li',customerIdentity:'SYNTHETIC-CUSTOMER',reason:'Z32'}]}
beforeEach(()=>{
 vi.clearAllMocks();io.actor.mockResolvedValue(undefined)
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_prodat_recovery_operation_basis_v1'?recovery:{basis,intentId:id(6),actorUserId:id(7)},error:null}))
 io.from.mockImplementation(()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:original,error:null})};return query})
})
it('uses qualified private recovery and current original origin for Z18 without binding the new intent to the old one',async()=>{
 const result=await loadServicePermissionRecoveryOrigin(scope)
 expect(result?.basis.assignmentId).toBe(id(4));expect(result?.sourceIntentId).toBe(id(6))
 expect(io.actor).toHaveBeenCalledWith({companyId:scope.companyId,actorUserId:scope.actorUserId,permission:'communication.write'})
 expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_message_basis_v1',{p_company_id:scope.companyId,p_message_id:original.id,p_actor_user_id:scope.actorUserId,p_phase:'prepare'})
})
it('does not follow public original selectors when private recovery qualification is absent',async()=>{
 io.rpc.mockResolvedValue({data:null,error:null});expect(await loadServicePermissionRecoveryOrigin(scope)).toBeUndefined();expect(io.from).not.toHaveBeenCalled()
})
it('holds foreign failed object, wrong LI and changed current source basis',async()=>{
 for(const allowedObjects of [[{...recovery.allowedObjects[0],point:'foreign-point'}],[{...recovery.allowedObjects[0],li:'foreign-li'}]]){
  io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_prodat_recovery_operation_basis_v1'?{...recovery,allowedObjects}:{basis,intentId:id(6),actorUserId:id(7)},error:null}))
  await expect(loadServicePermissionRecoveryOrigin(scope)).rejects.toThrow('object_scope_invalid')
 }
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_prodat_recovery_operation_basis_v1'?recovery:{basis:{...basis,assignmentVersion:99},intentId:id(6),actorUserId:id(7)},error:null}))
 await expect(loadServicePermissionRecoveryOrigin(scope)).rejects.toThrow('origin_stale')
})
it('does no source read after current tenant actor revocation',async()=>{
 io.actor.mockRejectedValue(Error('forbidden'));await expect(loadServicePermissionRecoveryOrigin(scope)).rejects.toThrow('forbidden');expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})

it('send follows the same qualified source with a separate current send grant',async()=>{
 await loadServicePermissionRecoveryOrigin({...scope,phase:'send'})
 expect(io.actor).toHaveBeenCalledWith({companyId:scope.companyId,actorUserId:scope.actorUserId,permission:'communication.send'})
 expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_message_basis_v1',{p_company_id:scope.companyId,p_message_id:original.id,p_actor_user_id:scope.actorUserId,p_phase:'send'})
})
it('uses the privately qualified terminal service origin while retaining the immediate failed original',async()=>{
 const source={...original,id:id(20)},immediate={...original,id:id(5),intent_id:id(21),parsed_payload:{sourcePermissionBasis:{forged:true}}}
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_prodat_recovery_operation_basis_v1'?{...recovery,sourceOriginMessageId:source.id}:{basis,intentId:source.intent_id,actorUserId:id(7)},error:null}))
 io.from.mockImplementation(()=>{let selected:string;const query={select:()=>query,eq:(key:string,value:string)=>{if(key==='id')selected=value;return query},maybeSingle:async()=>({data:selected===source.id?source:immediate,error:null})};return query})
 const result=await loadServicePermissionRecoveryOrigin({...scope,phase:'send'})
 expect(result?.originalMessage.id).toBe(immediate.id);expect(result?.sourceMessage.id).toBe(source.id)
 expect(result?.sourceIntentId).toBe(source.intent_id)
 expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_message_basis_v1',{p_company_id:scope.companyId,p_message_id:source.id,p_actor_user_id:scope.actorUserId,p_phase:'send'})
})
