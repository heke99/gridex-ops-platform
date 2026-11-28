import { createHash } from 'node:crypto'
import { captureEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision, technicalSyntaxAckQualification } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { prepareSourceAckDraft } from '@/lib/ediel/ack/prepareSourceAckDraft'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** Native transport authority over the retained bytes confers no business authority. */
export async function captureOwnedE66TechnicalSyntax(
  message: EdielMessageRow,
  actorUserId: string,
  decision: { syntaxDecision: 'accepted' | 'rejected'; reasonCodes: string[] } = {
    syntaxDecision: 'accepted', reasonCodes: [],
  },
) {
  const execution = { actorUserId, phase: 'prepare' as const }
  const endpoint = await readEdielTechnicalSourceEndpoint(message.id, execution)
  const hash = createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex')
  if (!endpoint || endpoint.companyId !== message.company_id || endpoint.environment !== message.environment ||
      endpoint.sourceHash !== hash) {
    throw new Error('technical_source_wire_scope_mismatch')
  }
  const companyId = endpoint.companyId
  await assertEdielTenantActor({ companyId, actorUserId, permission: 'communication.write' })
  await recordEdielTechnicalSyntaxDecision({
    companyId, sourceMessageId: message.id, sourceHash: hash, execution, ...decision,
  })
  const evidence = await captureEdielTechnicalSyntaxAckEvidence(companyId, message.id, execution)
  return { evidence, hash }
}

export async function prepareDurableE66TechnicalRejection(input: {
  message: EdielMessageRow
  actorUserId: string
  companyId: string
  environment: 'test' | 'production'
  sourceId: string
}): Promise<string | null> {
  const { message, actorUserId, companyId, environment, sourceId } = input
  if (message.id !== sourceId || message.company_id !== companyId || message.environment !== environment ||
      message.direction !== 'inbound' || message.message_standard !== 'edifact' ||
      message.message_family !== 'UTILTS' || message.message_code !== 'E66' || !message.raw_payload) {
    throw new Error('e66_technical_rejection_source_scope_changed')
  }
  const syntax = validateEdifactSyntax({
    ...message, status: 'received', syntax_check_status: 'not_checked', validation_report: {}, failure_reason: null,
  })
  if (syntax.ok || syntax.grammarQualification === 'unavailable') return null
  const reasonCodes = syntax.issues.filter(issue => issue.severity === 'error').map(issue => issue.code)
  if (!reasonCodes.includes('unt_count_mismatch')) return null
  const wire = tokenizeEdifact(message.raw_payload)
  const headings = wire.segments.filter(segment => segment.tag === 'UNH')
  const trailers = wire.segments.filter(segment => segment.tag === 'UNT')
  if (headings.length !== 1 || trailers.length !== 1 ||
      segmentComposite(headings[0], 2, wire.una)[0] !== 'UTILTS') return null
  const count = segmentComposite(trailers[0], 1, wire.una)[0]
  if (!/^[0-9]{1,6}$/.test(count ?? '')) return null

  const captured = await captureOwnedE66TechnicalSyntax(message, actorUserId, {
    syntaxDecision: 'rejected', reasonCodes,
  })
  const evidence = technicalSyntaxAckQualification({
    evidence: captured.evidence, companyId, environment, sourceMessageId: sourceId,
  })
  const { hash } = captured
  if (evidence?.syntaxDecision !== 'rejected' || evidence.sourceHash !== hash) {
    throw new Error('e66_technical_rejection_evidence_unqualified')
  }
  const reply = { actorUserId, sourceMessage: message, ackFamily: 'CONTRL' as const, outcome: 'negative' as const }
  const prepared = await prepareSourceAckDraft(reply)
  // The retained draft is the technical receipt. No dispatch or outbox work
  // is delegated by the durable qualification owner.
  const ack = prepared.kind === 'existing' ? prepared.message : await createCanonicalAckMessage({ ...reply, draft: prepared.draft })
  if (ack.company_id !== companyId || ack.environment !== environment || ack.direction !== 'outbound' ||
      ack.message_family !== 'CONTRL' || ack.ack_outcome !== 'negative' || ack.related_message_id !== sourceId || !ack.raw_payload) {
    throw new Error('e66_technical_rejection_ack_unqualified')
  }
  return ack.id
}
