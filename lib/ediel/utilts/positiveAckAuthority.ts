import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'

const STORAGE_REQUIRED = 'utilts_positive_ack_storage_unavailable'

function positiveUtiltsWire(raw: string | null | undefined, required = false): { transactionIds: string[] } | null {
  if (!raw) { if (required) throw new Error(STORAGE_REQUIRED); return null }
  const { segments, una } = tokenizeEdifact(raw)
  const bgms = segments.filter(s => s.tag === 'BGM')
  const physicalPositive = bgms.some(s => segmentComposite(s, 1, una)[0] === '312')
  if (!physicalPositive) { if (required) throw new Error(STORAGE_REQUIRED); return null }
  const unhs = segments.filter(s => s.tag === 'UNH')
  const type = unhs.length === 1 ? segmentComposite(unhs[0], 2, una) : []
  if (bgms.length !== 1 || type[0] !== 'APERAK' || type[2] !== '04A' || type[4] !== 'E5SE5A') throw new Error(STORAGE_REQUIRED)
  const acw = segments.filter(s => s.tag === 'RFF').map(s => segmentComposite(s, 1, una)).filter(c => c[0] === 'ACW')
  const ids = acw.map(c => c[1])
  if (!ids.length || ids.some(id => !id || id !== id.trim()) || new Set(ids).size !== ids.length) throw new Error(STORAGE_REQUIRED)
  return { transactionIds: ids }
}

async function requireAuthority(input: {
  companyId: string | null | undefined
  environment: string | null | undefined
  sourceMessageId: string | null | undefined
  transactionId: string
  ackMessageId?: string | null
  ackRawPayload?: string | null
  sourceRawPayload?: string | null
}) {
  if (!input.companyId || !input.sourceMessageId || !['test', 'production'].includes(input.environment ?? '')) throw new Error(STORAGE_REQUIRED)
  // This new RPC is generated into public types only by authentic migration replay.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('gridex_require_utilts_positive_ack_authority_v1', {
    p_company_id: input.companyId, p_environment: input.environment, p_source_message_id: input.sourceMessageId,
    p_transaction_id: input.transactionId, p_ack_message_id: input.ackMessageId ?? null, p_ack_raw_payload: input.ackRawPayload ?? null,
  })
  if (error) throw new Error(STORAGE_REQUIRED, { cause: error })
  const result = data as Record<string, unknown> | null
  if (!result || result.authorityVersion !== 1 || result.companyId !== input.companyId || result.environment !== input.environment ||
      result.sourceMessageId !== input.sourceMessageId || result.transactionId !== input.transactionId ||
      result.ackMessageId !== (input.ackMessageId ?? null) || typeof result.sourceRawHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceRawHash) ||
      (input.sourceRawPayload && result.sourceRawHash !== createHash('sha256').update(input.sourceRawPayload, 'utf8').digest('hex')) ||
      (input.ackMessageId && result.ackRawHash !== createHash('sha256').update(input.ackRawPayload ?? '', 'utf8').digest('hex'))) throw new Error(STORAGE_REQUIRED)
}

/** CREATE needs committed accepted storage. Final ACK binding follows creation,
 * avoiding a circular requirement for ordinary consumer finalization. */
export async function assertUtiltsPositiveAckSourceAuthority(input: { sourceMessage: EdielMessageRow; draft: CreateEdielMessageInput }) {
  const required = input.sourceMessage.message_family === 'UTILTS' && input.draft.messageFamily === 'APERAK' &&
    (input.draft.ackOutcome === 'positive' || input.draft.parsedPayload?.ackOutcome === 'positive')
  const wire = positiveUtiltsWire(input.draft.rawPayload, required)
  if (!wire) return
  if (input.sourceMessage.message_family !== 'UTILTS' || input.sourceMessage.direction !== 'inbound' ||
      (input.draft.companyId != null && input.draft.companyId !== input.sourceMessage.company_id) || input.draft.environment !== input.sourceMessage.environment ||
      (input.draft.parsedPayload?.relatedTransactionReference && (wire.transactionIds.length !== 1 || input.draft.parsedPayload.relatedTransactionReference !== wire.transactionIds[0]))) throw new Error(STORAGE_REQUIRED)
  for (const transactionId of wire.transactionIds) await requireAuthority({ companyId: input.sourceMessage.company_id, environment: input.sourceMessage.environment,
    sourceMessageId: input.sourceMessage.id, transactionId, sourceRawPayload: input.sourceMessage.raw_payload })
}

/** SEND re-reads durable authority and requires the immutable final reservation
 * to name this exact ACK and source. JSON flags never authorize transmission. */
export async function assertUtiltsPositiveAckAuthorityForSend(message: EdielMessageRow) {
  const wire = positiveUtiltsWire(message.raw_payload, message.message_family === 'APERAK' && message.message_version === 'E5SE5A' && message.ack_outcome === 'positive')
  if (!wire) return
  if (message.direction !== 'outbound' || message.message_family !== 'APERAK') throw new Error(STORAGE_REQUIRED)
  for (const transactionId of wire.transactionIds) await requireAuthority({ companyId: message.company_id, environment: message.environment, sourceMessageId: message.related_message_id,
    transactionId, ackMessageId: message.id, ackRawPayload: message.raw_payload })
}
