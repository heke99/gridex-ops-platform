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
