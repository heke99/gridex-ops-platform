import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'

const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => io.db.client.from(table) } }))
import { recordManualMailAiReading } from '@/lib/inbound-mail/manualMailAiRecording'

const input = { inboundId: 'inbound-a', companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a', authoredText: 'Avtalet löper till 2027-03-31.', senderCredible: true }
const config = { enabled: true, apiKey: 'synthetic-secret' }
const payload = { sender_credible: true, facility_id: 'synthetic-facility' }
const completed = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: [], fields: [{ field: 'contract_end', value: '2027-03-31', source: 0 }] }) }] }], usage: { input_tokens: 200, output_tokens: 100 } }))

beforeEach(() => {
  io.db = createFakeDb({ manual_inbound_messages: [{ id: 'inbound-a', company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a', resolution_status: 'matched', extracted_payload: payload }], customers: [{ id: 'customer-a', contract_end: null }], manual_email_outbox: [] })
})

describe('persisting read-only AI suggestions', () => {
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
