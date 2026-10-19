import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'

const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb>, beforeQuery: undefined as undefined | (() => void) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => { io.beforeQuery?.(); return io.db.client.from(table) } } }))
import { recordManualMailAiReading } from '@/lib/inbound-mail/manualMailAiRecording'
import { createManualMailSourceCorpus } from '@/lib/inbound-mail/manualMailEvidenceSources'

const input = { inboundId: 'inbound-a', companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a', authoredText: 'Avtalet löper till 2027-03-31.', senderCredible: true }
const config = { enabled: true, apiKey: 'synthetic-secret' }
const payload = { sender_credible: true, facility_id: 'synthetic-facility' }
const completed = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: [], fields: [{ field: 'contract_end', value: '2027-03-31', source: 0 }] }) }] }], usage: { input_tokens: 200, output_tokens: 100 } }))

beforeEach(() => {
  io.beforeQuery = undefined
  io.db = createFakeDb({ manual_inbound_messages: [{ id: 'inbound-a', company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a', resolution_status: 'matched', extracted_payload: payload }], customers: [{ id: 'customer-a', contract_end: null }], manual_email_outbox: [] })
})

describe('persisting read-only AI suggestions', () => {
  it('binds a document reading to original file hashes even when the transcribed text is unchanged', async () => {
    const manifest = (sha256: string) => [{ attachmentId: `part:1:${sha256}`, mimePart: 1, sha256,
      mimeType: 'text/plain', filename: 'reply.txt', sizeBytes: 100, sourceRole: 'attachment' as const }]
    const corpus = (sha256: string) => {
      const entries = manifest(sha256)
      const result = createManualMailSourceCorpus('', [{ attachmentId: entries[0].attachmentId, sha256,
        origin: 'text', locator: 'text:1', text: input.authoredText }], entries)
      if (!result.ok) throw new Error(result.reasons.join(','))
      return result
    }
    const sourceCorpus = corpus('a'.repeat(64))
    let calls = 0
    const fetcher: typeof fetch = async () => { calls++; return completed() }
    const result = await recordManualMailAiReading({ ...input, authoredText: sourceCorpus.text, sourceCorpus }, config, fetcher)
    expect(result).toMatchObject({ status: 'completed' })
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ ai_read_only: {
      source_hash: sourceCorpus.sourceHash, source_version: 2, manifest_hash: sourceCorpus.manifestHash,
    } })
    const changed = corpus('b'.repeat(64))
    expect(await recordManualMailAiReading({ ...input, authoredText: changed.text, sourceCorpus: changed }, config, fetcher)).toBeUndefined()
    expect(calls).toBe(1)
  })
  it('atomically reserves one inference even when two workers race', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => { calls += 1; await Promise.resolve(); return completed() }
    await Promise.all([recordManualMailAiReading(input, config, fetcher), recordManualMailAiReading(input, config, fetcher)])
    expect(calls).toBe(1)
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ ...payload,
      ai_read_only: { status: 'completed', mode: 'read_only', context: { company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a' }, fields: [{ field: 'contract_end', value: '2027-03-31', quote: input.authoredText }] },
    })
    expect(io.db.writes.every((write) => write.table === 'manual_inbound_messages' && write.op === 'update')).toBe(true)
    expect(io.db.tables.customers[0].contract_end).toBeNull()
    expect(io.db.tables.manual_email_outbox).toEqual([])
    await recordManualMailAiReading(input, config, fetcher)
    expect(calls).toBe(1)
  })

  it('persists the one paid result while preserving a sibling document update during inference', async () => {
    let release!: () => void
    const providerPending = new Promise<void>(resolve => { release = resolve })
    let providerStarted!: () => void
    const started = new Promise<void>(resolve => { providerStarted = resolve })
    let calls = 0
    const pending = recordManualMailAiReading(input, config, async () => {
      calls++; providerStarted(); await providerPending; return completed()
    })
    await started
    const row = io.db.tables.manual_inbound_messages[0]
    const documentReading = { status: 'completed', attempt_id: 'document-attempt', source_hash: 'a'.repeat(64) }
    row.extracted_payload = { ...row.extracted_payload as Record<string, unknown>,
      manual_automation: { documentReading, unrelated: 'retained' }, independent_fact: 'retained' }
    release()
    expect(await pending).toMatchObject({ status: 'completed' })
    expect(row.extracted_payload).toMatchObject({ ai_read_only: { status: 'completed' },
      manual_automation: { documentReading, unrelated: 'retained' }, independent_fact: 'retained' })
    expect(await recordManualMailAiReading(input, { enabled: false }, async () => { throw new Error('no second bill') })).toMatchObject({ status: 'completed' })
    expect(calls).toBe(1)
  })

  it('retries a final storage CAS after a newer sibling update without repeating inference', async () => {
    let queries = 0, calls = 0
    io.beforeQuery = () => {
      if (++queries !== 4) return
      const row = io.db.tables.manual_inbound_messages[0]
      row.extracted_payload = { ...row.extracted_payload as Record<string, unknown>,
        manual_automation: { documentReading: { status: 'completed', source_hash: 'newer-sibling' } } }
    }
    expect(await recordManualMailAiReading(input, config, async () => { calls++; return completed() })).toMatchObject({ status: 'completed' })
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({
      ai_read_only: { status: 'completed' }, manual_automation: { documentReading: { source_hash: 'newer-sibling' } },
    })
    expect(calls).toBe(1)
  })

  it.each(['attempt', 'sender'] as const)('does not finalize after %s authority changes while the provider is pending', async (changed) => {
    let calls = 0
    const result = await recordManualMailAiReading(input, config, async () => {
      calls++
      const row = io.db.tables.manual_inbound_messages[0]
      const current = row.extracted_payload as Record<string, unknown>
      row.extracted_payload = changed === 'sender' ? { ...current, sender_credible: false }
        : { ...current, ai_read_only: { ...current.ai_read_only as Record<string, unknown>, attempt_id: 'newer-attempt' } }
      return completed()
    })
    expect(result).toBeUndefined()
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject(changed === 'sender'
      ? { sender_credible: false, ai_read_only: { status: 'processing' } }
      : { sender_credible: true, ai_read_only: { status: 'processing', attempt_id: 'newer-attempt' } })
    expect(calls).toBe(1)
  })

  it('rejects spoofed corpus objects and text that differs from the immutable factory result', async () => {
    const sourceCorpus = createManualMailSourceCorpus(input.authoredText, [], [])
    if (!sourceCorpus.ok) throw new Error(sourceCorpus.reasons.join(','))
    const fetcher: typeof fetch = async () => { throw new Error('unproven source must not be sent') }
    expect(await recordManualMailAiReading({ ...input, sourceCorpus: { ...sourceCorpus } }, config, fetcher)).toBeUndefined()
    expect(await recordManualMailAiReading({ ...input, sourceCorpus, authoredText: 'changed text' }, config, fetcher)).toBeUndefined()
    expect(io.db.writes).toEqual([])
  })

  it.each([
    { companyId: 'tenant-b' }, { customerId: 'customer-b' }, { requestId: 'request-b' }, { senderCredible: false },
  ])('does not call AI for mismatched or untrusted input %#', async (patch) => {
    await recordManualMailAiReading({ ...input, ...patch }, config, async () => { throw new Error('must not call') })
    expect(io.db.writes).toEqual([])
  })

  it('does not retry a failed paid attempt or leak provider error text', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => { calls += 1; throw new Error('secret mail data') }
    await recordManualMailAiReading(input, config, fetcher)
    await recordManualMailAiReading(input, config, fetcher)
    expect(calls).toBe(1)
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ ai_read_only: { status: 'failed', reason: 'transport_error' } })
    expect(JSON.stringify(io.db.tables)).not.toContain('secret mail data')
  })

  it('does not call or reserve when disabled or unconfigured', async () => {
    await recordManualMailAiReading(input, { enabled: false }, async () => { throw new Error('must not call') })
    await recordManualMailAiReading(input, { enabled: true }, async () => { throw new Error('must not call') })
    expect(io.db.writes).toEqual([])
  })

  it('leaves the core mail flow unaffected if diagnostic storage is unavailable', async () => {
    io.db.hooks.push(() => ({ code: 'XX000', message: 'storage unavailable' }))
    await expect(recordManualMailAiReading(input, config, async () => { throw new Error('must not call') })).resolves.toBeUndefined()
    expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toEqual(payload)
  })
})
