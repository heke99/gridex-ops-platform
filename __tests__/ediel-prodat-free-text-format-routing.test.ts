import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertProdatFreeTextSendBoundary, prodatFreeTextSendIssues } from '@/lib/ediel/prodat/prodatFreeText'
import { alphabets, line, raw, type Parts } from './fixtures/prodat-register'
import { head } from './fixtures/prodat-identity'

const io = vi.hoisted(() => ({ effects: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => { io.effects.push('db'); throw new Error('UNEXPECTED_DATABASE_BOUNDARY') },
  rpc: () => { io.effects.push('rpc'); throw new Error('UNEXPECTED_RPC_BOUNDARY') },
} }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: () => {
  io.effects.push('provider'); throw new Error('UNEXPECTED_PROVIDER_BOUNDARY')
} }))
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'

beforeEach(() => { io.effects = [] })

// Preserve the two existing regression suites unchanged. Exercise their actual
// FTX entry point as well: a tag-looking list column is not an EDIFACT header.
const listPayloads = [
  ...['UNB', 'UNH', 'BGM', 'LIN', 'FTX'].map(tag => `${tag};A;B\n1;2;3?`),
  "Ver20140401;A;B\n1;?'UNH+literal;3?",
  'Ver20140401;A;B\n1;2;3?',
]
it.each(listPayloads)('FTX preserves list data without decoding release characters: %s', rawPayload => {
  const message = { raw_payload: rawPayload, message_family: 'AI_LIST', message_code: 'LIST' }
  expect(prodatFreeTextSendIssues(message)).toEqual([])
  expect(() => assertProdatFreeTextSendBoundary(message)).not.toThrow()
  // Row labels do not change the actual format in either direction.
  expect(prodatFreeTextSendIssues({ ...message, message_family: 'PRODAT', message_code: 'Z01' })).toEqual([])
  expect(preflightEdielPayload({ rawPayload, messageStandard: 'ai_list', mode: 'send' }))
    .toEqual(preflightEdielPayload({ rawPayload, messageStandard: 'ai_list', mode: 'parse' }))
  expect(message.raw_payload).toBe(rawPayload)
  expect(io.effects).toEqual([])
})
it('FTX preserves XML literal question marks and tag-like text', () => {
  const rawPayload = '<Document><Text>UNH;A;B? FTX+literal?</Text></Document>'
  expect(prodatFreeTextSendIssues({ raw_payload: rawPayload, message_family: 'NBS_XML' })).toEqual([])
  expect(preflightEdielPayload({ rawPayload, messageStandard: 'xml', mode: 'send' }))
    .toEqual(preflightEdielPayload({ rawPayload, messageStandard: 'xml', mode: 'parse' }))
  expect(io.effects).toEqual([])
})

function message(rawPayload: string, standard: 'xml' | 'ai_list'): EdielMessageRow {
  return {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    direction: 'outbound', environment: 'test', message_standard: standard,
    message_family: standard === 'xml' ? 'NBS_XML' : 'AI_LIST', message_code: 'LIST',
    receiver_email: 'synthetic@example.invalid', communication_route_id: '00000000-0000-4000-8000-000000000003',
    raw_payload: rawPayload, parsed_payload: { rulebookAllowInvalidSend: true },
  } as unknown as EdielMessageRow
}
const actorUserId = '00000000-0000-4000-8000-000000000004'
const invalidText: Parts[] = [...head(), line('1', '735123456789012345', undefined, '9'), ['FTX', 'ACB', '', '', ['X'.repeat(71)]]]
for (const alphabet of alphabets) for (const standard of ['xml', 'ai_list'] as const) {
  it(`actual PRODAT retains FTX preflight and pre-I/O SMTP hold despite ${standard}/${alphabet.join('')}`, async () => {
    const rawPayload = raw(invalidText, 'Z01', alphabet)
    const row = message(rawPayload, standard)
    expect(prodatFreeTextSendIssues(row).map(issue => issue.code)).toContain('PRODAT_FTX_SEND_CONFORMANCE')
    expect(() => assertProdatFreeTextSendBoundary(row)).toThrow('PRODAT_FTX_SEND_CONFORMANCE')
    const result = preflightEdielPayload({ rawPayload, messageStandard: standard, mode: 'send', parsedPayload: row.parsed_payload })
    expect(result.blocking).toBe(true)
    expect(result.issues.some(issue => issue.code.includes('PRODAT_FTX_SEND_CONFORMANCE'))).toBe(true)
    await expect(sendEdielMessageViaSmtp(row, { actorUserId })).rejects.toThrow('PRODAT_FTX_SEND_CONFORMANCE')
    expect(io.effects).toEqual([])
    expect(row.raw_payload).toBe(rawPayload)
  })
  it(`malformed actual EDIFACT is not a ready ${standard} fallback: ${alphabet.join('')}`, async () => {
    const rawPayload = raw(invalidText, 'Z01', alphabet) + alphabet[2]
    const row = message(rawPayload, standard)
    expect(() => prodatFreeTextSendIssues(row)).toThrow('edifact_dangling_release_character')
    expect(() => preflightEdielPayload({ rawPayload, messageStandard: standard, mode: 'send' })).toThrow('edifact_dangling_release_character')
    await expect(sendEdielMessageViaSmtp(row, { actorUserId })).rejects.toThrow('edifact_dangling_release_character')
    expect(io.effects).toEqual([])
    expect(row.raw_payload).toBe(rawPayload)
  })
}
for (const standard of ['xml', 'ai_list'] as const) it(`default EDIFACT without UNA cannot hide invalid FTX behind ${standard}`, async () => {
  const rawPayload = raw(invalidText, 'Z01').slice(9)
  expect(rawPayload.startsWith('UNB+')).toBe(true)
  const row = message(rawPayload, standard)
  expect(prodatFreeTextSendIssues(row).map(issue => issue.code)).toContain('PRODAT_FTX_SEND_CONFORMANCE')
  await expect(sendEdielMessageViaSmtp(row, { actorUserId })).rejects.toThrow('PRODAT_FTX_SEND_CONFORMANCE')
  expect(io.effects).toEqual([])
  expect(row.raw_payload).toBe(rawPayload)
})
