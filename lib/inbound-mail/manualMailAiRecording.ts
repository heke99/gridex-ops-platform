import { createHash, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { manualMailAiConfig, prepareManualMailAiInput, readManualMailWithAi, type ManualMailAiConfig } from '@/lib/inbound-mail/manualMailAiReader'

type Input = {
  inboundId: string; companyId: string; customerId: string; requestId: string; authoredText: string; senderCredible: boolean
}

/** Diagnostic-only write. Never supplies input to correlation or market commands. */
export async function recordManualMailAiReading(
  input: Input, config: ManualMailAiConfig = manualMailAiConfig(), fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!config.enabled || !config.apiKey || !input.senderCredible) return
  const prepared = prepareManualMailAiInput(input.authoredText)
  const scope = () => supabaseService.from('manual_inbound_messages')
  try {
    const row = await scope().select('extracted_payload')
      .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
      .eq('request_id', input.requestId).eq('resolution_status', 'matched')
      .eq('extracted_payload->>sender_credible', 'true').is('extracted_payload->ai_read_only', null).maybeSingle()
    if (row.error || !row.data) return
    const previous = row.data.extracted_payload as Record<string, unknown>
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return
    const attempt = {
      version: 1, attempt_id: randomUUID(), status: 'processing', mode: 'read_only', review_required: true,
      started_at: new Date().toISOString(),
      source_hash: createHash('sha256').update(input.authoredText).digest('hex'),
      context: { company_id: input.companyId, customer_id: input.customerId, request_id: input.requestId },
    }
    const reserved = { ...previous, ai_read_only: attempt }
    const claim = await scope().update({ extracted_payload: reserved }).select('id')
      .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
      .eq('request_id', input.requestId).eq('resolution_status', 'matched').eq('extracted_payload->>sender_credible', 'true')
      .eq('extracted_payload', JSON.stringify(previous)).is('extracted_payload->ai_read_only', null).maybeSingle()
    if (claim.error || !claim.data) return
    // A reservation is never automatically cleared, including a timeout/crash:
    // at-most-once charging is preferable to blind retries of a paid request.
    const result = prepared.status === 'skipped' ? prepared : await readManualMailWithAi(input.authoredText, config, fetcher)
    await scope().update({ extracted_payload: {
      ...previous, ai_read_only: { ...attempt, ...result, completed_at: new Date().toISOString() },
    } }).select('id')
      .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
      .eq('request_id', input.requestId).eq('resolution_status', 'matched').eq('extracted_payload->>sender_credible', 'true')
      .eq('extracted_payload', JSON.stringify(reserved)).maybeSingle()
  } catch {
    // Optional analysis must not stop the inbox, follow-up holds or raw storage.
    // Never log provider errors, mail text or credentials.
  }
}
