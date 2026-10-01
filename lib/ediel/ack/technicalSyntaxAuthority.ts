import { supabaseService } from '@/lib/supabase/service'

export type TechnicalSyntaxAckEvidence = Readonly<{
  kind: 'technical_syntax_ack'
  version: 1
  companyId: string
  environment: 'test' | 'production'
  sourceMessageId: string
  sourceHash: string
  observedAt: string
  syntaxAssessmentId: string
  syntaxDecision: 'accepted' | 'rejected'
  transportActorId: string
  transportEdielId: string
  originalUNB: {
    sender: string[]
    receiver: string[]
    interchangeReference: string
    uciReference: string
    applicationReference: string
    testIndicator: '' | '1'
  }
}>

export type TechnicalSourceEndpoint = Readonly<{
  kind: 'technical_endpoint_only'
  companyId: string
  environment: 'test' | 'production'
  sourceMessageId: string
  sourceHash: string
  transportEdielId: string
  originalUNB: TechnicalSyntaxAckEvidence['originalUNB']
  authorizesBusinessEffect: false
}>

function validEnvelope(e: TechnicalSyntaxAckEvidence['originalUNB'] | undefined, endpoint: string | undefined) {
  return Boolean(e && Array.isArray(e.sender) && Array.isArray(e.receiver)
    && e.sender.every(v => typeof v === 'string') && e.receiver.every(v => typeof v === 'string')
    && e.sender[0] && e.receiver[0] === endpoint
    && typeof e.interchangeReference === 'string' && e.interchangeReference.length > 0
    && e.uciReference === e.interchangeReference.slice(0, 14)
    && typeof e.applicationReference === 'string' && (e.testIndicator === '' || e.testIndicator === '1'))
}

function decodeTechnicalEvidence(value: unknown): TechnicalSyntaxAckEvidence {
  const e = value as Partial<TechnicalSyntaxAckEvidence> | null
  if (!e || e.kind !== 'technical_syntax_ack' || e.version !== 1 || !e.companyId || !e.sourceMessageId
    || !e.syntaxAssessmentId || !e.transportActorId || !e.transportEdielId || !e.observedAt
    || !['test', 'production'].includes(e.environment ?? '') || !['accepted', 'rejected'].includes(e.syntaxDecision ?? '')
    || !/^[a-f0-9]{64}$/.test(e.sourceHash ?? '') || !validEnvelope(e.originalUNB, e.transportEdielId)) throw new Error('ediel_technical_ack_basis_required')
  return Object.freeze(e as TechnicalSyntaxAckEvidence)
}

async function technicalEvidence(action: 'capture' | 'require', companyId: string, sourceMessageId: string) {
  const { data, error } = await supabaseService.rpc(`ediel_${action}_technical_syntax_ack_basis_v1`, {
    p_company_id: companyId, p_message_id: sourceMessageId,
  })
  if (error) throw new Error(error.message.includes('ediel_historical_technical_ack_basis_unavailable')
    ? 'ediel_historical_technical_ack_basis_unavailable' : 'ediel_technical_ack_basis_required', { cause: error })
  const evidence = decodeTechnicalEvidence(data)
  if (evidence.companyId !== companyId || evidence.sourceMessageId !== sourceMessageId) throw new Error('ediel_technical_ack_basis_required')
  return evidence
}

/** Only the actual common canonical syntax owner emits this immutable facet.
 * It makes no legal tenant, market-role, business-function or customer decision. */
export async function recordEdielTechnicalSyntaxDecision(input: {
  companyId: string
  sourceMessageId: string
  sourceHash: string
  syntaxDecision: 'accepted' | 'rejected'
  reasonCodes: string[]
}) {
  const { data, error } = await supabaseService.rpc('ediel_record_technical_syntax_facet_v1', {
    p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_source_payload_hash: input.sourceHash,
    p_facts_text: JSON.stringify({ version: 1, owner: 'canonical-runtime-syntax-v1', syntaxDecision: input.syntaxDecision, reasonCodes: input.reasonCodes }),
  })
  if (error || !data) throw new Error('ediel_technical_syntax_owner_required', { cause: error })
  return data
}

export function captureEdielTechnicalSyntaxAckEvidence(companyId: string, sourceMessageId: string) {
  return technicalEvidence('capture', companyId, sourceMessageId)
}
export function requireEdielTechnicalSyntaxAckEvidence(companyId: string, sourceMessageId: string) {
  return technicalEvidence('require', companyId, sourceMessageId)
}

/** Header/endpoint projection for the technical syntax owner only. A returned
 * company never attributes legal/business tenant or authorizes customer data. */
export async function readEdielTechnicalSourceEndpoint(sourceMessageId: string) {
  const { data, error } = await supabaseService.rpc('ediel_read_technical_source_endpoint_v1', { p_source_message_id: sourceMessageId })
  if (error) throw new Error('ediel_technical_endpoint_unqualified', { cause: error })
  if (!data) return null
  const result = data as Partial<TechnicalSourceEndpoint>
  if (result.kind !== 'technical_endpoint_only' || result.sourceMessageId !== sourceMessageId
    || typeof result.companyId !== 'string' || typeof result.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceHash)
    || !['test', 'production'].includes(String(result.environment)) || result.authorizesBusinessEffect !== false
    || typeof result.transportEdielId !== 'string' || !validEnvelope(result.originalUNB, result.transportEdielId)) throw new Error('ediel_technical_endpoint_unqualified')
  return Object.freeze(result as TechnicalSourceEndpoint)
}
