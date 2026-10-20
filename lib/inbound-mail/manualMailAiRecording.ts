import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { supabaseService } from '@/lib/supabase/service'
import { manualMailAiConfig, prepareManualMailAiInput, readManualMailWithAi, restoreManualMailAiReading, type ManualMailAiConfig, type ManualMailAiResult } from '@/lib/inbound-mail/manualMailAiReader'
import { isManualMailSourceCorpus, type ManualMailSourceCorpus } from '@/lib/inbound-mail/manualMailEvidenceSources'

type Input = {
  inboundId: string; companyId: string; customerId: string; requestId: string; authoredText: string; senderCredible: boolean
  multiSite?: boolean
  sourceCorpus?: ManualMailSourceCorpus
}

/** Tool-free extraction, scoped independently of AI. Business adapters validate its candidates. */
export async function recordManualMailAiReading(
  input: Input, config: ManualMailAiConfig = manualMailAiConfig(), fetcher: typeof fetch = fetch,
): Promise<ManualMailAiResult | undefined> {
  if (!input.senderCredible) return
  const corpus = input.sourceCorpus
  if (corpus !== undefined && (!isManualMailSourceCorpus(corpus) || input.authoredText !== corpus.text)) return
  const options = { ...(corpus ? { documentSources: true } : {}), ...(input.multiSite ? { multiSite: true } : {}) }
  const prepared = prepareManualMailAiInput(input.authoredText, options)
  const scope = () => supabaseService.from('manual_inbound_messages')
  try {
    const row = await scope().select('extracted_payload')
      .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
      .eq('request_id', input.requestId).eq('resolution_status', 'matched')
      .eq('extracted_payload->>sender_credible', 'true').maybeSingle()
    if (row.error || !row.data) return
    const previous = row.data.extracted_payload as Record<string, unknown>
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return
    const sourceHash = corpus?.sourceHash ?? createHash('sha256').update(input.authoredText).digest('hex')
    if (previous.ai_read_only) {
      const saved = previous.ai_read_only as Record<string, unknown>
      const context = saved.context as Record<string, unknown> | undefined
      if (saved.source_hash !== sourceHash || context?.company_id !== input.companyId
        || context?.customer_id !== input.customerId || context?.request_id !== input.requestId) return
      if (saved.scope_mode !== (input.multiSite ? 'multiple_facilities' : undefined)) return
      if (corpus ? saved.source_version !== 2 || saved.manifest_hash !== corpus.manifestHash
        || !isDeepStrictEqual(saved.catalog, corpus.catalog) : saved.source_version !== undefined) return
      return restoreManualMailAiReading(saved, input.authoredText, options)
    }
    if (!config.enabled || !config.apiKey) return
    const attempt = {
      version: 1, attempt_id: randomUUID(), status: 'processing', mode: 'read_only', review_required: true,
      started_at: new Date().toISOString(),
      source_hash: sourceHash,
      ...(input.multiSite ? { scope_mode: 'multiple_facilities' } : {}),
      ...(corpus ? { source_version: corpus.sourceVersion, manifest_hash: corpus.manifestHash, catalog: corpus.catalog } : {}),
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
    const result = prepared.status === 'skipped' ? prepared : await readManualMailWithAi(input.authoredText, config, fetcher, options)
    const reading = { ...attempt, ...result, completed_at: new Date().toISOString() }
    // Document OCR and inbox bookkeeping share extracted_payload. Re-read and
    // merge their latest siblings, retaining an exact attempt/payload CAS.
    // These bounded storage retries never repeat the paid provider request.
    for (let mergeAttempt = 0; mergeAttempt < 3; mergeAttempt++) {
      const fresh = await scope().select('extracted_payload')
        .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
        .eq('request_id', input.requestId).eq('resolution_status', 'matched').eq('extracted_payload->>sender_credible', 'true')
        .eq('extracted_payload->ai_read_only', JSON.stringify(attempt)).maybeSingle()
      if (fresh.error || !fresh.data) return
      const current = fresh.data.extracted_payload as Record<string, unknown>
      if (!current || typeof current !== 'object' || Array.isArray(current) || !isDeepStrictEqual(current.ai_read_only, attempt)) return
      const saved = await scope().update({ extracted_payload: { ...current, ai_read_only: reading } }).select('id')
        .eq('id', input.inboundId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
        .eq('request_id', input.requestId).eq('resolution_status', 'matched').eq('extracted_payload->>sender_credible', 'true')
        .eq('extracted_payload', JSON.stringify(current)).maybeSingle()
      if (saved.error) return
      if (saved.data) return result
    }
  } catch {
    // Optional analysis must not stop the inbox, follow-up holds or raw storage.
    // Never log provider errors, mail text or credentials.
  }
}
