import { supabaseService } from '@/lib/supabase/service'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import type { EdielServiceAssessment } from './types'

/** The server reads scoped evidence and current actor facts. UI booleans are never authority. */
export async function assessEdielServiceAssignment(input: {
  providerCompanyId: string; assignmentId: string
}): Promise<EdielServiceAssessment> {
  const { data, error } = await supabaseService.rpc('ediel_service_assignment_assessment_v1', {
    p_provider_company_id: input.providerCompanyId, p_assignment_id: input.assignmentId,
  })
  if (error) throw error
  if (!data || !['held', 'authorized'].includes(data.status)) throw new Error('ediel_service_assessment_invalid')
  return data as EdielServiceAssessment
}

/** Shared server boundary for actual tenant actors, including service-backed jobs.
 * Global administrator permissions alone never provide a tenant membership. */
export async function assertEdielTenantActor(input: {
  companyId:string; actorUserId:string
} & ({ permission: EdielTenantActorPermission; permissionAnyOf?: never } | { permission?: never; permissionAnyOf: readonly [EdielTenantActorPermission, ...EdielTenantActorPermission[]] })):Promise<void>{
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if(!uuid.test(input.companyId)||!uuid.test(input.actorUserId))throw new Error('ediel_tenant_actor_required')
  const permissions = input.permissionAnyOf ?? [input.permission]
  if (!permissions.length || permissions.some(value => !['ediel.read','communication.read','communication.write','ediel_testing.write','ediel.send','communication.send','metering.read','metering.write','customers.write'].includes(value))) throw new Error('ediel_tenant_permission_required')
  const [membership,profile,permissionResults]=await Promise.all([
    supabaseService.from('company_memberships').select('company_id,user_id,status,is_active,accepted_at').eq('company_id',input.companyId).eq('user_id',input.actorUserId).eq('status','active').eq('is_active',true).not('accepted_at','is',null).maybeSingle(),
    supabaseService.from('user_profiles').select('id,user_status').eq('id',input.actorUserId).eq('user_status','active').maybeSingle(),
    Promise.all(permissions.map(permission => supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:input.actorUserId,p_company_id:input.companyId,p_permission:permission}))),
  ])
  // Schema/network errors remain errors, even if another permission succeeded.
  for (const result of [membership, profile, ...permissionResults]) if (result.error) throw result.error
  if(!membership.data||membership.data.company_id!==input.companyId||membership.data.user_id!==input.actorUserId||membership.data.status!=='active'||membership.data.is_active!==true||!membership.data.accepted_at||!profile.data||profile.data.id!==input.actorUserId||profile.data.user_status!=='active')throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},'ediel_tenant_actor_forbidden')
  if (!permissionResults.some(result => result.data === true)) throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'},'ediel_tenant_permission_forbidden')
}

export type EdielTenantActorPermission = 'ediel.read'|'communication.read'|'communication.write'|'ediel_testing.write'|'ediel.send'|'communication.send'|'metering.read'|'metering.write'|'customers.write'
