// masterplan: SC-006
// The actual public caller executes; coordinator/actor/transport ports below
// are substituted. Real shared-permission effects are separately proved by
// the source-qualified genuine #497 literal SC005/006 native case.
import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn(),z13:vi.fn(),z18:vi.fn(),coordinate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:mocks.actor}))
vi.mock('@/lib/ediel/services/commands',()=>({coordinateEdielServicePermission:mocks.coordinate}))
vi.mock('@/lib/ediel/flows/prodatServicePermission',()=>({prepareAndQueueServicePermissionZ13:mocks.z13,prepareAndQueueServicePermissionZ18:mocks.z18}))
import {executeEdielServiceAdministration,edielServiceCommandSchema} from '@/lib/ediel/services/administration'
import {EDIEL_SERVICE_PURPOSE_MAX_LENGTH} from '@/lib/ediel/services/limits'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const own={companyId:uid(1),actorUserId:uid(2)}
beforeEach(()=>{vi.clearAllMocks();mocks.actor.mockResolvedValue(undefined);mocks.rpc.mockResolvedValue({data:{status:'pending',approvalGranted:false},error:null})})
describe('actual service administration boundary',()=>{
 const pending={action:'stage_evidence',commandId:uid(3),assignmentId:uid(4),expectedVersion:1,fields:{kind:'end_user_contract',source_reference:'SYNTHETIC claim',source_sha256:'a'.repeat(64),source_version:'fixture',valid_from:'2026-01-01T00:00:00Z',valid_to:null}}
 it('stages source claims only after current selected tenant authority',async()=>{
  await expect(executeEdielServiceAdministration({...own,command:pending})).resolves.toMatchObject({status:'pending',approvalGranted:false})
  expect(mocks.actor).toHaveBeenCalledWith({...own,permission:'metering.write'})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_service_administration_command_v1',{p_company_id:own.companyId,p_actor_user_id:own.actorUserId,p_input:pending})
 })
 it('rejects client-supplied approval and foreign authority without private mutation',async()=>{
  for(const command of [{...pending,companyId:uid(9)},{...pending,fields:{...pending.fields,status:'verified'}},{...pending,fields:{...pending.fields,approved_by:uid(2)}}])await expect(executeEdielServiceAdministration({...own,command})).rejects.toThrow()
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('propagates actual tenant revocation before a source or grant write',async()=>{
  mocks.actor.mockRejectedValue(new Error('membership revoked'))
  await expect(executeEdielServiceAdministration({...own,command:pending})).rejects.toThrow('membership revoked');expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('requires explicit grant CAS and delegates source access to its canonical dedicated flow',async()=>{
  expect(()=>edielServiceCommandSchema.parse({action:'publish_grant',commandId:uid(3),assignmentId:uid(4),expectedVersion:1,grantId:uid(5)})).toThrow()
  mocks.z13.mockResolvedValue({status:'held',missing:['actual owner approvals']})
  await executeEdielServiceAdministration({...own,command:{action:'request_access',assignmentId:uid(4),expectedVersion:1}})
  expect(mocks.z13).toHaveBeenCalledWith({action:'request_access',assignmentId:uid(4),expectedVersion:1,providerCompanyId:own.companyId,actorUserId:own.actorUserId});expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('uses the same purpose bound for a held assignment producer as the beneficiary read API',async()=>{
  const purpose='a'.repeat(EDIEL_SERVICE_PURPOSE_MAX_LENGTH)
  const command={action:'create_assignment',commandId:uid(3),fields:{beneficiary_company_id:uid(5),provider_actor_id:uid(6),actor_profile_id:uid(7),customer_id:uid(8),dso_actor_id:uid(9),environment:'test',mode:'V',purpose,object_ids:['735999999999999991'],product_ids:['8716867000030'],field_sets:['quantity'],data_start:'2026-01-01T00:00:00Z',data_end:null,valid_from:'2026-01-01T00:00:00Z',valid_to:null}}
  await executeEdielServiceAdministration({...own,command})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_service_administration_command_v1',expect.objectContaining({p_input:command}))
  vi.clearAllMocks()
  await expect(executeEdielServiceAdministration({...own,command:{...command,fields:{...command.fields,purpose:purpose+'a'}}})).rejects.toThrow()
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it.each(['assignment_ended','market_termination_required'] as const)('ends only the selected internal assignment through the actual caller (%s), without automatically originating Z18',async status=>{
  const command={action:'end_assignment',assignmentId:uid(4),expectedVersion:3}
  const result={status,permissionId:uid(5)}
  mocks.coordinate.mockResolvedValue(result)
  await expect(executeEdielServiceAdministration({...own,command})).resolves.toBe(result)
  expect(mocks.actor).toHaveBeenCalledWith({...own,permission:'metering.write'})
  expect(mocks.coordinate).toHaveBeenCalledExactlyOnceWith({...command,providerCompanyId:own.companyId,actorUserId:own.actorUserId,command:'end_assignment'})
  expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.coordinate.mock.invocationCallOrder[0])
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.z13).not.toHaveBeenCalled();expect(mocks.z18).not.toHaveBeenCalled()
 })
 it('denies a revoked actor before ending an assignment or originating a market termination',async()=>{
  mocks.actor.mockRejectedValue(new Error('membership revoked'))
  await expect(executeEdielServiceAdministration({...own,command:{action:'end_assignment',assignmentId:uid(4),expectedVersion:3}})).rejects.toThrow('membership revoked')
  expect(mocks.coordinate).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.z13).not.toHaveBeenCalled();expect(mocks.z18).not.toHaveBeenCalled()
 })
 it('preserves a current coordinator denial instead of converting it into an automatic Z18',async()=>{
  mocks.coordinate.mockRejectedValue(new Error('ediel_assignment_version_stale'))
  await expect(executeEdielServiceAdministration({...own,command:{action:'end_assignment',assignmentId:uid(4),expectedVersion:3}})).rejects.toThrow('ediel_assignment_version_stale')
  expect(mocks.coordinate).toHaveBeenCalledOnce();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.z13).not.toHaveBeenCalled();expect(mocks.z18).not.toHaveBeenCalled()
 })
})
