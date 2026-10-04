import { supabaseService } from '@/lib/supabase/service'

export type EdielSourceLegalContext = Readonly<{
  basisKind: 'observed_source_persistence' | 'prescribed_outbound_ack' | 'qualified_outbound_original_ack'
  companyId: string
  environment: 'test' | 'production'
  direction: 'inbound' | 'outbound'
  legalActorId: string
  legalEdielId: string
  actorRole: string
  transportActorId: string
  transportEdielId: string
  applicationReference: string
  observedAt: string
  sourceReceivedAt: string | null
}>

/** Reads genuine immutable first-persistence basis; never reconstructs a prior
 * identity from today's mutable rows or assigns a national protocol error. */
export async function requireEdielInboundLegalContext(companyId: string, messageId: string): Promise<EdielSourceLegalContext> {
  if (!companyId || !messageId) throw new Error('ediel_inbound_legal_context_required')
  const { data, error } = await supabaseService.rpc('ediel_require_inbound_legal_context_v1', {
    p_company_id: companyId, p_message_id: messageId,
  })
  if (error) {
    const code = error.message.includes('ediel_historical_identity_basis_unavailable')
      ? 'ediel_historical_identity_basis_unavailable' : 'ediel_inbound_legal_context_required'
    throw new Error(code, { cause: error })
  }
  const context = data as Partial<EdielSourceLegalContext> | null
  if (!context || context.companyId !== companyId || !context.legalActorId || !context.legalEdielId
    || !context.transportActorId || !context.transportEdielId || !context.actorRole || !context.observedAt
    || !['test', 'production'].includes(context.environment ?? '') || !['inbound', 'outbound'].includes(context.direction ?? '')) {
    throw new Error('ediel_inbound_legal_context_required')
  }
  return Object.freeze(context as EdielSourceLegalContext)
}
