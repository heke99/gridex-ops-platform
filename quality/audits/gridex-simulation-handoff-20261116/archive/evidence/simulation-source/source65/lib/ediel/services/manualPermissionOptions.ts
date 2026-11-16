import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from './authorization'
export type ManualServicePermissionOption={permissionId:string;assignmentId:string;assignmentVersion:number;beneficiaryCompanyId:string;beneficiaryLabel:string|null;purpose:string;mode:'V'|'VH';status:string}
/** The option is a selector only. The submitted current version/link is read
 * again by the protected native command, even after this page was rendered. */
export async function readManualServicePermissionOptions(input:{companyId:string;actorUserId:string;permissionIds:readonly string[]}):Promise<ManualServicePermissionOption[]>{
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['metering.read','metering.write']})
 const {data,error}=await supabaseService.rpc('ediel_service_permission_manual_options_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_permission_ids:[...input.permissionIds]})
 if(error)throw error
 if(data?.companyId!==input.companyId||!Array.isArray(data.options)||data.options.some((v:ManualServicePermissionOption)=>!input.permissionIds.includes(v.permissionId)||typeof v.assignmentId!=='string'||!Number.isSafeInteger(v.assignmentVersion)||v.assignmentVersion<1||typeof v.beneficiaryCompanyId!=='string'||!(v.beneficiaryLabel===null||typeof v.beneficiaryLabel==='string')||typeof v.purpose!=='string'||!['V','VH'].includes(v.mode)))throw new Error('ediel_service_manual_options_invalid')
 return data.options
}
