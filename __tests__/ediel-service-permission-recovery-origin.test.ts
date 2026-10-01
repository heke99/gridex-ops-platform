import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
import {loadServicePermissionRecoveryOrigin} from '@/lib/ediel/services/permissionOrigin'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={companyId:id(1),operationId:id(2),actorUserId:id(3)}
const basis={status:'authorized',companyId:id(1),assignmentId:id(4),assignmentVersion:2,scopeBasisVersion:1,code:'Z18',customer:{org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic',country:'SE'},mode:'V',terminationReason:'Z32',li:'owned-li',objects:[{point:'owned-point',permissionId:'source-permission',product:'8716867000030'}]}
const original={id:id(5),company_id:id(1),direction:'outbound',message_family:'PRODAT',message_code:'Z18',intent_id:id(6),parsed_payload:{sourcePermissionBasis:basis}}
const recovery={originalMessageId:id(5),operationId:id(2),correctedPayloadHash:'a'.repeat(64),allowedObjects:[{point:'owned-point',li:'owned-li',customerIdentity:'SYNTHETIC-CUSTOMER',reason:'Z32'}]}
beforeEach(()=>{
 vi.clearAllMocks();io.actor.mockResolvedValue(undefined)
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_prodat_recovery_operation_basis_v1'?recovery:{basis,intentId:id(6),actorUserId:id(7)},error:null}))
 io.from.mockImplementation(()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:original,error:null})};return query})
})
it('uses qualified private recovery and current original origin for Z18 without binding the new intent to the old one',async()=>{
 const result=await loadServicePermissionRecoveryOrigin(scope)
 expect(result?.basis.assignmentId).toBe(id(4));expect(result?.sourceIntentId).toBe(id(6))
 expect(io.actor).toHaveBeenCalledWith({companyId:scope.companyId,actorUserId:scope.actorUserId,permissionAnyOf:['ediel.send','communication.send']})
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
