import { supabaseService } from '@/lib/supabase/service'

export type ServicePermissionOriginInput = {
  providerCompanyId: string; assignmentId: string; actorUserId: string;
  expectedVersion: number; permissionId: string; code: 'Z13' | 'Z18'
}
export type ServicePermissionOriginBasis = {
  status: 'authorized'; companyId: string; assignmentId: string; assignmentVersion: number; scopeBasisVersion:number;
  permissionId: string; permissionStateVersion: number; code: 'Z13' | 'Z18'; environment: 'test' | 'production';
  providerActorId: string; dsoActorId: string; legalSenderId: string; legalReceiverId: string;
  customerId: string; customer: Record<string, unknown>; mode: 'V' | 'VH';
  purposeCode: string | null; frequency: string | null; terminationReason: string | null;
  evidenceId: string; evidenceSha256: string; evidenceVersion: string; li: string | null;
  reportingTerm: 'bounded' | 'indefinite' | null; customerClassification: 'private' | 'nonprivate' | null;
  objects: { point: string | null; permissionId: string | null; product: string;
    reportStart?: string; reportEnd?: string | null; gridArea?: string | null; permissionEnd?: string }[]
}
export type HeldPermissionOrigin = { status: 'held'; missing: string[] }

function args(input: ServicePermissionOriginInput) {
  return { p_company_id: input.providerCompanyId, p_assignment_id: input.assignmentId,
    p_actor_user_id: input.actorUserId, p_expected_version: input.expectedVersion,
    p_permission_id: input.permissionId, p_code: input.code }
}
export async function readServicePermissionOrigin(input: ServicePermissionOriginInput): Promise<ServicePermissionOriginBasis | HeldPermissionOrigin> {
  const { data, error } = await supabaseService.rpc('ediel_service_permission_origin_v1', args(input))
  if (error) throw error
  if (!data || !['authorized', 'held'].includes(data.status)) throw new Error('ediel_permission_origin_result_invalid')
  return data
}
export async function reserveServicePermissionOrigin(input: ServicePermissionOriginInput & { intentId: string }): Promise<{ status: 'reserved'; messageId: string | null } | HeldPermissionOrigin> {
  const { data, error } = await supabaseService.rpc('ediel_reserve_service_permission_origin_v1', { ...args(input), p_intent_id: input.intentId })
  if (error) throw error
  if (!data || !['reserved', 'held'].includes(data.status)) throw new Error('ediel_permission_origin_reservation_invalid')
  return data
}
