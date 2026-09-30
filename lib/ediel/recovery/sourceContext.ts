import { supabaseService } from '@/lib/supabase/service'

export type RecoverySourceBasis = {
  originalMessageId: string; operationId: string; sourceAckMessageId: string;
  kind: 'contrl_correction' | 'aperak_correction'; correctedPayloadHash: string;
  allowedObjects: { point: string | null; identityAgency: string | null; li?: string; customerIdentity?: string; reason?: string }[];
}
function basis(value: unknown): RecoverySourceBasis | undefined {
  if (value == null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('prodat_recovery_source_basis_invalid')
  const b = value as Record<string, unknown>
  if (![b.originalMessageId,b.operationId,b.sourceAckMessageId].every(v => typeof v === 'string' && v)
    || !['contrl_correction','aperak_correction'].includes(String(b.kind)) || typeof b.correctedPayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(b.correctedPayloadHash)
    || !Array.isArray(b.allowedObjects) || !b.allowedObjects.length || b.allowedObjects.some(o => !o || typeof o !== 'object'
      || ![null,'string'].includes(o.point === null ? null : typeof o.point) || ![null,'string'].includes(o.identityAgency === null ? null : typeof o.identityAgency))) throw new Error('prodat_recovery_source_basis_invalid')
  return b as RecoverySourceBasis
}
export async function readRecoveryOperationBasis(input: { companyId: string; operationId: string; actorUserId: string }): Promise<RecoverySourceBasis | undefined> {
  const { data, error } = await supabaseService.rpc('ediel_prodat_recovery_operation_basis_v1', { p_company_id: input.companyId, p_operation_id: input.operationId, p_actor_user_id: input.actorUserId })
  if (error) throw error
  const result = basis(data)
  if (result && result.operationId !== input.operationId) throw new Error('prodat_recovery_source_basis_scope')
  return result
}
export async function readRecoveryOriginalBasis(input: { companyId: string; messageId: string; actorUserId: string }): Promise<RecoverySourceBasis | undefined> {
  const { data, error } = await supabaseService.rpc('ediel_prodat_recovery_original_basis_v1', { p_company_id: input.companyId, p_message_id: input.messageId, p_actor_user_id: input.actorUserId })
  if (error) throw error
  return basis(data)
}
