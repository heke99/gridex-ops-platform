import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from './authorization'
import {prepareAndQueueServicePermissionZ13,prepareAndQueueServicePermissionZ18} from '@/lib/ediel/flows/prodatServicePermission'
import {z} from 'zod'

export type ManualServicePermissionSelection={permissionId?:string|null;assignmentId?:string|null;expectedVersion?:number|null;code:'Z13'|'Z18';mode?:'V'|'VH'|null;fromDate?:string|null;toDate?:string|null}
export function parseManualServiceAssignmentSelection(value:string|null):{assignmentId:string;expectedVersion:number}|undefined{
 if(!value)return undefined
 const parts=value.split(':')
 if(parts.length!==2)throw new Error('ediel_service_assignment_selection_invalid')
 return {assignmentId:z.string().uuid().parse(parts[0]),expectedVersion:z.number().int().positive().safe().parse(Number(parts[1]))}
}
/** A manual selector is not a mandate. Only an exact current source assignment
 * or a unique existing permission link may enter the ordinary command service. */
export async function prepareManualServicePermission(input:{companyId:string;actorUserId:string;customerId:string;selection:ManualServicePermissionSelection}){
 const selection=z.object({permissionId:z.string().uuid().nullish(),assignmentId:z.string().uuid().nullish(),expectedVersion:z.number().int().positive().safe().nullish(),code:z.enum(['Z13','Z18']),mode:z.enum(['V','VH']).nullish(),fromDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),toDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()}).strict().parse(input.selection)
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'metering.write'})
 const {data,error}=await supabaseService.rpc('ediel_service_permission_manual_context_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_customer_id:input.customerId,p_selection:selection})
 if(error)throw error
 if(data?.status==='held'&&typeof data.requestId==='string'&&Array.isArray(data.missing))return data as {status:'held';requestId:string;missing:string[]}
 if(data?.companyId!==input.companyId||data.customerId!==input.customerId||data.code!==input.selection.code||typeof data.assignmentId!=='string'||!Number.isSafeInteger(data.assignmentVersion)||data.assignmentVersion<1||typeof data.permissionId!=='string'||selection.assignmentId&&data.assignmentId!==selection.assignmentId||selection.expectedVersion&&data.assignmentVersion!==selection.expectedVersion||selection.permissionId&&data.permissionId!==selection.permissionId)throw new Error('ediel_service_manual_context_invalid')
 if(data.status==='reuse_permission'&&(!['approved','pending'].includes(data.marketPermissionState)||data.accessGranted!==false))throw new Error('ediel_service_manual_context_invalid')
 if(data.status==='reuse_permission')return data as {status:'reuse_permission';permissionId:string;assignmentId:string;marketPermissionState:'approved'|'pending';accessGranted:false}
 if(data.status!=='authorized')throw new Error('ediel_service_manual_context_invalid')
 const command={providerCompanyId:input.companyId,assignmentId:data.assignmentId,expectedVersion:data.assignmentVersion,permissionId:data.permissionId,actorUserId:input.actorUserId}
 return input.selection.code==='Z18'?prepareAndQueueServicePermissionZ18(command):prepareAndQueueServicePermissionZ13(command)
}
