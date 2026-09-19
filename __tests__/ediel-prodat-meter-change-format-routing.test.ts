import { expect, it } from 'vitest'
import { preflightEdielPayload, preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { meterChangeSendIssue } from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { changeRaw, changeBody } from './fixtures/prodat-meter-change'
import { alphabets } from './fixtures/prodat-register'
const row = (raw: string, standard: 'xml' | 'ai_list', code?: string) => ({ raw_payload: raw, message_standard: standard, message_family: standard === 'xml' ? 'NBS_XML' : 'AI_LIST', message_code: code, direction: 'outbound', environment: 'test', parsed_payload: {} } as EdielMessageRow)

it.each([
  ['ai_list', 'Ver20140401;A;B\n1;2;3?'],
  ['ai_list', 'A;B\n1;2;3?'],
  ['xml', '<Document><Text>literal?</Text></Document>'],
] as const)('preserves actual %s raw/row/guards despite EDIFACT service characters', (messageStandard, rawPayload) => {
  const parse = preflightEdielPayload({ rawPayload, messageStandard, mode: 'parse' })
  const send = preflightEdielPayload({ rawPayload, messageStandard, mode: 'send' })
  expect(send).toEqual(parse)
  const message = row(rawPayload, messageStandard)
  expect(preflightEdielMessageRow(message).blocking).toBe(false)
  expect(meterChangeSendIssue(message)).toBeNull()
  expect(() => assertRulebookAllowsSend(message)).not.toThrow()
  expect(() => assertEdielSendLock(message)).not.toThrow()
})
it('row Z10 remains authoritative even with alternate-format content', () => {
  const message = row('Ver20140401;A;B\n1;2;3?', 'ai_list', 'Z10')
  expect(meterChangeSendIssue(message)?.code).toBe('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(() => assertRulebookAllowsSend(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(() => assertEdielSendLock(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
})
it.each(alphabets)('real raw Z10 and syntax failures cannot be hidden by metadata (%s)', (...alphabet) => {
  for (const messageStandard of ['xml', 'ai_list'] as const) {
    const rawPayload = changeRaw(changeBody(), alphabet)
    expect(preflightEdielPayload({ rawPayload, messageStandard, mode: 'send' }).issues.map(i => i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
    // Preserve the existing tokenizer's malformed-EDIFACT exception, not a ready alternate route.
    expect(() => preflightEdielPayload({ rawPayload: rawPayload + alphabet[2], messageStandard, mode: 'send' })).toThrow('edifact_dangling_release_character')
  }
})
it('leading malformed text cannot hide actual default-UNA Z10 behind XML metadata', () => {
  expect(() => preflightEdielPayload({ rawPayload: 'unexpected-prefix' + changeRaw(), messageStandard: 'xml', mode: 'send' })).toThrow('edifact_dangling_release_character')
})
it.each(['UNH;A;B\n1;2;3?', "Ver20140401;A;B\n1;?'UNH+literal;3?"])('does not classify list header/tag-like data as actual EDIFACT: %s', rawPayload => {
  expect(preflightEdielPayload({ rawPayload, messageStandard: 'ai_list', mode: 'send' })).toEqual(preflightEdielPayload({ rawPayload, messageStandard: 'ai_list', mode: 'parse' }))
  expect(meterChangeSendIssue(row(rawPayload, 'ai_list'))).toBeNull()
})
