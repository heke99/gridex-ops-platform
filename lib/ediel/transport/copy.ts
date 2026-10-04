import { supabaseService } from '@/lib/supabase/service'

export type EdielTransportCopy = {
  attemptId: string; lane: 'generic_journal' | 'sealed_z08'; companyId: string; messageId: string;
  environment: 'test' | 'production'; mimeArchiveRef: string; mimeSha256: string; mimeLength: number;
  rfcMessageId: string; mimePayloadSnapshotId: string; enteredAt: string; observedAt: string | null;
  smtpClassification: string | null; archiveReadbackRequired: true
}
export async function readEdielTransportCopies(input: { companyId: string; actorUserId: string; messageId: string }): Promise<{
  status: 'available' | 'held' | 'unavailable'; companyId: string; messageId: string; environment: 'test' | 'production';
  copies: EdielTransportCopy[]; blocker: string | null; authorizesResend: false; deliveryProven: false
}> {
  const { data, error } = await supabaseService.rpc('gridex_ediel_transport_copy_v1', {
    p_company_id: input.companyId, p_actor_user_id: input.actorUserId, p_message_id: input.messageId,
  })
  if (error) throw error
  if (!data || !['available','held','unavailable'].includes(data.status) || !Array.isArray(data.copies) || data.companyId !== input.companyId || data.messageId !== input.messageId || data.authorizesResend !== false || data.deliveryProven !== false) throw new Error('ediel_transport_copy_invalid')
  return data
}
