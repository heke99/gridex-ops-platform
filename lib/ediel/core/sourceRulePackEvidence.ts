import { supabaseService } from '@/lib/supabase/service'

export type EdielSourceRulePackEvidence = Readonly<{
  rulePackId: string
  messageProfileId: string
  profileKey: string
  version: string
  sourceHash: string
  snapshot: Record<string, unknown>
}>

function decodeEvidence(value: unknown): EdielSourceRulePackEvidence {
  const evidence = value as Partial<EdielSourceRulePackEvidence> | null
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  if (!evidence || !uuid.test(evidence.rulePackId ?? '') || !uuid.test(evidence.messageProfileId ?? '')
    || !evidence.profileKey || !evidence.version || !/^[a-f0-9]{64}$/.test(evidence.sourceHash ?? '')
    || !evidence.snapshot || typeof evidence.snapshot !== 'object' || Array.isArray(evidence.snapshot)
    || evidence.snapshot.profileKey !== evidence.profileKey || evidence.snapshot.profileVersionId !== evidence.messageProfileId
    || evidence.snapshot.version !== evidence.version || evidence.snapshot.checksum !== evidence.sourceHash) {
    throw new Error('ediel_source_rule_pack_basis_required')
  }
  return Object.freeze(evidence as EdielSourceRulePackEvidence)
}

async function sourceEvidence(action: 'capture' | 'require', companyId: string, messageId: string): Promise<EdielSourceRulePackEvidence> {
  if (!companyId || !messageId) throw new Error('ediel_source_rule_pack_basis_required')
  const { data, error } = await supabaseService.rpc(`ediel_${action}_source_rule_pack_basis_v1`, {
    p_company_id: companyId, p_message_id: messageId,
  })
  if (error) {
    const code = error.message.includes('ediel_historical_rule_pack_basis_unavailable')
      ? 'ediel_historical_rule_pack_basis_unavailable' : 'ediel_source_rule_pack_basis_required'
    throw new Error(code, { cause: error })
  }
  return decodeEvidence(data)
}

/** Actual first-effect/prepare only, after named canonical admission is stored.
 * This cannot manufacture an old sent original's missing historical evidence. */
export function captureEdielSourceRulePackEvidence(companyId: string, messageId: string) {
  return sourceEvidence('capture', companyId, messageId)
}

/** Read protected original evidence; never select a current/latest rule pack. */
export function requireEdielSourceRulePackEvidence(companyId: string, messageId: string) {
  return sourceEvidence('require', companyId, messageId)
}

/** Read-only historical classification lets each native owner inspect its own
 * already committed outcome before a fresh-source guard. Historical status
 * grants no new effect, send or ACK authority. Fresh capture errors propagate. */
export async function captureFreshEdielSourceRulePackEvidence(companyId: string, messageId: string): Promise<
  { status: 'captured'; evidence: EdielSourceRulePackEvidence } | { status: 'historical' }
> {
  if (!companyId || !messageId) throw new Error('ediel_source_rule_pack_basis_required')
  const { data, error } = await supabaseService.rpc('ediel_probe_source_rule_pack_capture_v1', {
    p_company_id: companyId, p_message_id: messageId,
  })
  if (error) throw new Error('ediel_source_rule_pack_basis_required', { cause: error })
  const result = data as { status?: unknown; evidence?: unknown } | null
  if (result?.status === 'historical') return { status: 'historical' }
  if (result?.status !== 'captured') throw new Error('ediel_source_rule_pack_basis_required')
  return { status: 'captured', evidence: decodeEvidence(result.evidence) }
}
