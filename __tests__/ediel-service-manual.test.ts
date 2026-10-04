import {beforeEach,describe,expect,it,vi} from 'vitest'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const mocks=vi.hoisted(()=>({rpc:vi.fn(),authorize:vi.fn(),z13:vi.fn(),z18:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:mocks.authorize}))
vi.mock('@/lib/ediel/flows/prodatServicePermission',()=>({prepareAndQueueServicePermissionZ13:mocks.z13,prepareAndQueueServicePermissionZ18:mocks.z18}))
import {parseManualServiceAssignmentSelection,prepareManualServicePermission} from '@/lib/ediel/services/manualPermission'
import {readManualServicePermissionOptions} from '@/lib/ediel/services/manualPermissionOptions'
const input={companyId:uid(1),actorUserId:uid(2),customerId:uid(3),selection:{code:'Z13' as const,permissionId:uid(4),assignmentId:uid(5),expectedVersion:6}}
const context={status:'authorized',companyId:uid(1),customerId:uid(3),code:'Z13',permissionId:uid(4),assignmentId:uid(5),assignmentVersion:6}
beforeEach(()=>{vi.resetAllMocks();mocks.authorize.mockResolvedValue(undefined);mocks.rpc.mockResolvedValue({data:context,error:null});mocks.z13.mockResolvedValue({status:'queued'});mocks.z18.mockResolvedValue({status:'queued'})})
describe('manual service source bridge (declared RPC boundaries, no approval evidence)',()=>{
 it('reads exact tenant/current actor/customer selectors before invoking the dedicated Z13 producer',async()=>{
  expect(await prepareManualServicePermission(input)).toEqual({status:'queued'})
  expect(mocks.authorize).toHaveBeenCalledWith({companyId:uid(1),actorUserId:uid(2),permission:'metering.write'})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_service_permission_manual_context_v1',{p_company_id:uid(1),p_actor_user_id:uid(2),p_customer_id:uid(3),p_selection:input.selection})
  expect(mocks.z13).toHaveBeenCalledWith({providerCompanyId:uid(1),actorUserId:uid(2),assignmentId:uid(5),expectedVersion:6,permissionId:uid(4)})
 })
 it('keeps a durable held command held without legacy queue or established-state mutation',async()=>{
  const held={status:'held',requestId:uid(8),missing:['source_assignment_required']};mocks.rpc.mockResolvedValue({data:held,error:null})
  expect(await prepareManualServicePermission(input)).toEqual(held);expect(mocks.z13).not.toHaveBeenCalled();expect(mocks.z18).not.toHaveBeenCalled()
 })
 for(const marketPermissionState of ['approved','pending'])it(`returns source-qualified ${marketPermissionState} reuse without wire or grant`,async()=>{
  const reused={...context,status:'reuse_permission',marketPermissionState,accessGranted:false};mocks.rpc.mockResolvedValue({data:reused,error:null})
  expect(await prepareManualServicePermission(input)).toEqual(reused);expect(mocks.z13).not.toHaveBeenCalled();expect(mocks.z18).not.toHaveBeenCalled()
 })
 it('does not interpret a reused market permission as beneficiary access',async()=>{
  mocks.rpc.mockResolvedValue({data:{...context,status:'reuse_permission',marketPermissionState:'approved',accessGranted:true},error:null})
  await expect(prepareManualServicePermission(input)).rejects.toThrow('context_invalid');expect(mocks.z13).not.toHaveBeenCalled()
 })
 for(const changes of [{companyId:uid(99)},{customerId:uid(99)},{code:'Z18'},{assignmentVersion:0},{assignmentVersion:7},{assignmentId:uid(99)},{permissionId:uid(99)}])it(`holds a returned context mismatch ${JSON.stringify(changes)}`,async()=>{
  mocks.rpc.mockResolvedValue({data:{...context,...changes},error:null});await expect(prepareManualServicePermission(input)).rejects.toThrow('context_invalid');expect(mocks.z13).not.toHaveBeenCalled()
 })
 it('uses exact Z18 selection and only its dedicated independent termination producer',async()=>{
  mocks.rpc.mockResolvedValue({data:{...context,code:'Z18'},error:null});await prepareManualServicePermission({...input,selection:{...input.selection,code:'Z18'}})
  expect(mocks.z18).toHaveBeenCalledWith({providerCompanyId:uid(1),actorUserId:uid(2),assignmentId:uid(5),expectedVersion:6,permissionId:uid(4)});expect(mocks.z13).not.toHaveBeenCalled()
 })
 it('propagates native source failures rather than falling back to portal/fullmakt data',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:new Error('private_basis_error')});await expect(prepareManualServicePermission(input)).rejects.toThrow('private_basis_error');expect(mocks.z13).not.toHaveBeenCalled()
 })
 it('rejects invalid versions/IDs before privileged native selection',async()=>{
  await expect(prepareManualServicePermission({...input,selection:{...input.selection,expectedVersion:NaN}})).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('parses one explicit current UUID/version selector and never chooses latest',()=>{
  expect(parseManualServiceAssignmentSelection(`${uid(5)}:6`)).toEqual({assignmentId:uid(5),expectedVersion:6});expect(parseManualServiceAssignmentSelection('')).toBeUndefined()
  for(const invalid of [`${uid(5)}:0`,`${uid(5)}:1:2`,'latest:3',`${uid(5)}:1.5`,`${uid(5)}:NaN`])expect(()=>parseManualServiceAssignmentSelection(invalid)).toThrow()
 })
 it('reads bounded actual links for the form, with read/write as preparation-independent selectors',async()=>{
  const options=[{permissionId:uid(4),assignmentId:uid(5),assignmentVersion:6,beneficiaryCompanyId:uid(7),beneficiaryLabel:'Actual declared beneficiary',purpose:'source declared',mode:'V',status:'active'}]
  mocks.rpc.mockResolvedValue({data:{companyId:uid(1),options},error:null});expect(await readManualServicePermissionOptions({companyId:uid(1),actorUserId:uid(2),permissionIds:[uid(4)]})).toEqual(options)
  expect(mocks.authorize).toHaveBeenCalledWith({companyId:uid(1),actorUserId:uid(2),permissionAnyOf:['metering.read','metering.write']})
 })
 it('rejects a foreign form option and does not mask missing schema errors',async()=>{
  mocks.rpc.mockResolvedValue({data:{companyId:uid(1),options:[{permissionId:uid(99),assignmentId:uid(5),assignmentVersion:1,mode:'V',purpose:'other'}]},error:null});await expect(readManualServicePermissionOptions({companyId:uid(1),actorUserId:uid(2),permissionIds:[uid(4)]})).rejects.toThrow('options_invalid')
  mocks.rpc.mockResolvedValue({data:null,error:new Error('private_schema_missing')});await expect(readManualServicePermissionOptions({companyId:uid(1),actorUserId:uid(2),permissionIds:[uid(4)]})).rejects.toThrow('private_schema_missing')
 })
})
