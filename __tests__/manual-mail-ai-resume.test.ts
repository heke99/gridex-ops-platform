import { beforeEach, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'

const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => io.db.client.from(table) } }))
import { recordManualMailAiReading } from '@/lib/inbound-mail/manualMailAiRecording'

const input = { inboundId: 'mail-a', companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a',
  authoredText: 'Kunden kan börja hos er den 1 april 2027.', senderCredible: true }
const response = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: [],
    fields: [{ field: 'earliest_start', value: '1 april 2027', source: 0 }] }) }] }] }))

beforeEach(() => {
  io.db = createFakeDb({ manual_inbound_messages: [{ id: input.inboundId, company_id: input.companyId, customer_id: input.customerId,
    request_id: input.requestId, resolution_status: 'matched', extracted_payload: { sender_credible: true } }] })
})

it('returns a persisted reading to the automatic adapter and reuses it after an application retry', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; return response() }
  const first = await recordManualMailAiReading(input, { enabled: true, apiKey: 'synthetic' }, fetcher)
  expect(first).toMatchObject({ status: 'completed', fields: [{ field: 'earliest_start', value: '1 april 2027', quote: input.authoredText }] })
  const second = await recordManualMailAiReading(input, { enabled: false }, fetcher)
  expect(second).toMatchObject({ status: 'completed', fields: [{ field: 'earliest_start', value: '1 april 2027' }] })
  expect(calls).toBe(1)
})

it('does not reuse a reading bound to another source body or changed tenant context', async () => {
  await recordManualMailAiReading(input, { enabled: true, apiKey: 'synthetic' }, async () => response())
  expect(await recordManualMailAiReading({ ...input, authoredText: 'Kunden kan inte börja den 1 april 2027.' }, { enabled: false })).toBeUndefined()
  const row = io.db.tables.manual_inbound_messages[0]
  row.company_id = 'tenant-b'
  expect(await recordManualMailAiReading({ ...input, companyId: 'tenant-b' }, { enabled: false })).toBeUndefined()
})

it('rejects altered stored field meanings whose quote does not match the saved input', async () => {
  await recordManualMailAiReading(input, { enabled: true, apiKey: 'synthetic' }, async () => response())
  const payload = io.db.tables.manual_inbound_messages[0].extracted_payload as Record<string, unknown>
  const reading = payload.ai_read_only as Record<string, unknown>
  reading.fields = [{ field: 'earliest_start', value: '2027-01-01', quote: input.authoredText }]
  expect(await recordManualMailAiReading(input, { enabled: false })).toBeUndefined()
})
