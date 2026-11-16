import { supabaseService } from '@/lib/supabase/service'

/** Coordinate internal assignments without originating a second market request per beneficiary. */
export async function coordinateEdielServicePermission(input: {
  providerCompanyId: string; assignmentId: string; actorUserId: string; expectedVersion: number;
  command: 'request_access' | 'end_assignment'
}): Promise<{ status: 'held' | 'reuse_permission' | 'permission_required' | 'assignment_ended' | 'market_termination_required'; permissionId: string | null; missing?: string[] }> {
  const { data, error } = await supabaseService.rpc('ediel_coordinate_service_permission_v1', {
    p_provider_company_id: input.providerCompanyId, p_assignment_id: input.assignmentId,
    p_actor_user_id: input.actorUserId, p_expected_version: input.expectedVersion, p_command: input.command,
  })
  if (error) throw error
  if (!data || !['held', 'reuse_permission', 'permission_required', 'assignment_ended', 'market_termination_required'].includes(data.status)) throw new Error('ediel_service_command_invalid')
  return data
}

/** The protected owner distinguishes compatible reuse from an unfinished own
 * first request. Reuse grants no beneficiary access and never originates wire. */
export async function resolveEdielServicePermissionCommand(input:{providerCompanyId:string;assignmentId:string;actorUserId:string;expectedVersion:number;permissionId:string}):Promise<{status:'held';missing:string[]}|{status:'permission_required';permissionId:string;messageId?:string;intentId?:string;outboundRequestId?:string}|{status:'reuse_permission';permissionId:string;marketPermissionState:'approved'|'pending';accessGranted:false;messageId?:string}>{
 const {data,error}=await supabaseService.rpc('ediel_resolve_service_permission_command_v1',{p_company_id:input.providerCompanyId,p_assignment_id:input.assignmentId,p_actor_user_id:input.actorUserId,p_expected_version:input.expectedVersion,p_permission_id:input.permissionId})
 if(error)throw error
 if(data?.status==='held'&&Array.isArray(data.missing))return data
 if(data?.status==='permission_required'&&data.messageId!==undefined&&(![data.messageId,data.intentId,data.outboundRequestId].every(value=>typeof value==='string')))throw new Error('ediel_service_permission_resolution_invalid')
 if(data?.permissionId!==input.permissionId||!['permission_required','reuse_permission'].includes(data.status)||data.status==='reuse_permission'&&(!['approved','pending'].includes(data.marketPermissionState)||data.accessGranted!==false))throw new Error('ediel_service_permission_resolution_invalid')
 return data
}
