import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

const authenticatedTechnicalEvidence = new WeakSet<object>()
function freezeEvidence<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    for (const child of Object.values(value)) freezeEvidence(child, seen)
    Object.freeze(value)
  }
  return value
}

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
  const evidence = freezeEvidence(e as TechnicalSyntaxAckEvidence)
  return evidence
}

/** Pure port: only the exact immutable protected RPC result is an authority.
 * Structural copies and caller-minted objects never qualify. */
export function technicalSyntaxAckQualification(input: {
  evidence: unknown
  companyId: string
  environment: 'test' | 'production'
  sourceMessageId?: string
}): TechnicalSyntaxAckEvidence | null {
  if (!input.evidence || typeof input.evidence !== 'object' || !authenticatedTechnicalEvidence.has(input.evidence)) return null
  const e = input.evidence as TechnicalSyntaxAckEvidence
  return e.companyId === input.companyId && e.environment === input.environment
    && (input.sourceMessageId === undefined || e.sourceMessageId === input.sourceMessageId) ? e : null
}

async function technicalEvidence(action: 'capture' | 'require', companyId: string, sourceMessageId: string, execution: TechnicalExecution) {
  const { actorUserId, phase } = requireExecution(execution)
  const { data, error } = await supabaseService.rpc(`ediel_${action}_technical_syntax_ack_basis_v2`, {
    p_company_id: companyId, p_message_id: sourceMessageId, p_actor_user_id: actorUserId, p_phase: phase,
  })
  if (error) throw new Error(error.message.includes('ediel_historical_technical_ack_basis_unavailable')
    ? 'ediel_historical_technical_ack_basis_unavailable' : 'ediel_technical_ack_basis_required', { cause: error })
  const evidence = decodeTechnicalEvidence(data)
  if (evidence.companyId !== companyId || evidence.sourceMessageId !== sourceMessageId) throw new Error('ediel_technical_ack_basis_required')
  authenticatedTechnicalEvidence.add(evidence)
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
  execution: TechnicalExecution
}) {
  const { actorUserId, phase } = requireExecution(input.execution)
  const { data, error } = await supabaseService.rpc('ediel_record_technical_syntax_facet_v2', {
    p_actor_user_id: actorUserId, p_phase: phase,
    p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_source_payload_hash: input.sourceHash,
    p_facts_text: JSON.stringify({ version: 1, owner: 'canonical-runtime-syntax-v1', syntaxDecision: input.syntaxDecision, reasonCodes: input.reasonCodes }),
  })
  if (error || !data) throw new Error('ediel_technical_syntax_owner_required', { cause: error })
  return data
}

export type TechnicalExecution = { actorUserId: string; phase: 'prepare' | 'read' | 'send' }
function requireExecution(execution: TechnicalExecution | undefined): TechnicalExecution {
  if (!execution?.actorUserId || !['prepare', 'read', 'send'].includes(execution.phase)) throw new Error('ediel_technical_ack_current_actor_required')
  return execution
}
export function captureEdielTechnicalSyntaxAckEvidence(companyId: string, sourceMessageId: string, execution: TechnicalExecution) {
  return technicalEvidence('capture', companyId, sourceMessageId, execution)
}
export function requireEdielTechnicalSyntaxAckEvidence(companyId: string, sourceMessageId: string, execution: TechnicalExecution) {
  return technicalEvidence('require', companyId, sourceMessageId, execution)
}

/** Qualification of the actual persisted ACK/source pointer in one protected
 * read. The caller's related_message_id is deliberately never sent to SQL. */
export async function readPersistedEdielTechnicalContrlBasis(input: {
  companyId: string
  environment: 'test' | 'production'
  ackMessageId: string
  expectedRawPayload: string
  actorUserId: string
  phase: 'prepare' | 'read' | 'send'
}): Promise<{ ackMessage: EdielMessageRow; evidence: TechnicalSyntaxAckEvidence }> {
  if (!input.actorUserId || !['prepare','read','send'].includes(input.phase)) throw new Error('ediel_technical_ack_current_actor_required')
  const { data, error } = await supabaseService.rpc('ediel_read_persisted_technical_contrl_basis_v2', {
    p_company_id: input.companyId, p_environment: input.environment, p_ack_message_id: input.ackMessageId,
    p_actor_user_id: input.actorUserId, p_phase: input.phase,
  })
  const result = data as { version?: unknown; executionActorUserId?: unknown; executionPhase?: unknown; ackMessage?: Partial<EdielMessageRow>; technicalSyntaxAckEvidence?: unknown } | null
  const ack = result?.ackMessage
  if (error || result?.version !== 2 || result.executionActorUserId !== input.actorUserId || result.executionPhase !== input.phase || !ack || ack.id !== input.ackMessageId || ack.company_id !== input.companyId
    || ack.environment !== input.environment || ack.direction !== 'outbound' || ack.message_family !== 'CONTRL'
    || ack.raw_payload !== input.expectedRawPayload) throw new Error('ediel_technical_ack_basis_required', { cause: error })
  const evidence = decodeTechnicalEvidence(result.technicalSyntaxAckEvidence)
  if (evidence.companyId !== input.companyId || evidence.environment !== input.environment
    || evidence.sourceMessageId !== ack.related_message_id) throw new Error('ediel_technical_ack_basis_required')
  authenticatedTechnicalEvidence.add(evidence)
  return { ackMessage: ack as EdielMessageRow, evidence }
}

/** Header/endpoint projection for the technical syntax owner only. A returned
 * company never attributes legal/business tenant or authorizes customer data. */
export async function readEdielTechnicalSourceEndpoint(sourceMessageId: string, execution: TechnicalExecution) {
  const { actorUserId, phase } = requireExecution(execution)
  const { data, error } = await supabaseService.rpc('ediel_read_technical_source_endpoint_v2', { p_source_message_id: sourceMessageId, p_actor_user_id: actorUserId, p_phase: phase })
  if (error) throw new Error('ediel_technical_endpoint_unqualified', { cause: error })
  if (!data) return null
  const { executionActorUserId, executionPhase, ...result } = data as Partial<TechnicalSourceEndpoint> & { executionActorUserId?: unknown; executionPhase?: unknown }
  if (executionActorUserId !== actorUserId || executionPhase !== phase || result.kind !== 'technical_endpoint_only' || result.sourceMessageId !== sourceMessageId
    || typeof result.companyId !== 'string' || typeof result.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceHash)
    || !['test', 'production'].includes(String(result.environment)) || result.authorizesBusinessEffect !== false
    || typeof result.transportEdielId !== 'string' || !validEnvelope(result.originalUNB, result.transportEdielId)) throw new Error('ediel_technical_endpoint_unqualified')
  return Object.freeze(result as TechnicalSourceEndpoint)
}
