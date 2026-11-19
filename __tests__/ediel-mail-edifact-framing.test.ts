import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { extractCanonicalEdifactPayload } from '@/lib/ediel/core/canonicalEdifactAst'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'

const externalIo = vi.hoisted(() => vi.fn(() => {
  throw new Error('External I/O is outside this synthetic MIME fixture')
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: externalIo, rpc: externalIo } }))

beforeEach(() => vi.stubGlobal('fetch', externalIo))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const framings = [
  { name: 'default UNA', advice: true, separator: '+', terminator: "'" },
  { name: 'implicit delimiters', advice: false, separator: '+', terminator: "'" },
  { name: 'non-default UNA', advice: true, separator: '*', terminator: '~' },
]

function original({ advice, separator, terminator }: typeof framings[number]) {
  const message = energyHandoffMessage('2026-11-18')
  let raw = message.raw_payload!.replace("++23-DDQ-E66-T++1'", "++23-DDQ-E66-T++1++1'")
  if (!advice) raw = raw.slice(9).trimStart()
  return { ...message, raw_payload: raw.replaceAll(/(?<!\?)\+/g, separator).replaceAll(/(?<!\?)'/g, terminator) }
}

function readBody(body: string) {
  const rawEmail = `Subject: synthetic E66\nContent-Type: text/plain; charset=utf-8\n\n${body}`
  const mime = splitMimeParts(rawEmail)
  const inbound = parseInboundEmailContent({
    rawEmail, bodyText: mime.bodyText, attachmentText: mime.rawEdifactPayload,
  })
  return { mime, inbound }
}

it.each(framings)('accepts the complete E66 original using $name', (framing) => {
  const message = original(framing)
  const { inbound } = readBody(message.raw_payload)
  expect(inbound?.rawPayload).toBe(message.raw_payload)
  expect(resolveCanonicalRuntimeDecision(message)).toMatchObject({
    syntaxDecision: 'accepted',
    responsePlan: [
      { family: 'CONTRL', outcome: 'positive' },
      { family: 'APERAK', outcome: 'positive' },
    ],
  })
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(framings)('keeps a real $name header after ordinary text mentioning UNA', (framing) => {
  const message = original(framing)
  const preamble = 'Se originalets UNA-rad i nätägarens svar.'
  const { mime, inbound } = readBody(preamble + '\n\n' + message.raw_payload)
  expect(mime.bodyText).toContain(preamble)
  expect(inbound?.rawPayload).toBe(message.raw_payload)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: inbound!.rawPayload }).syntaxDecision).toBe('accepted')
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(framings)('uses the physical $name trailer before ordinary text mentioning UNZ', (framing) => {
  const message = original(framing)
  const postamble = 'Om ni har frågor om UNZ, kontakta vår ordinarie support.'
  const { mime, inbound } = readBody(message.raw_payload + '\r\n\r\n' + postamble)
  expect(mime.bodyText).toContain(postamble)
  expect(inbound?.rawPayload).toBe(message.raw_payload)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: inbound!.rawPayload }).syntaxDecision).toBe('accepted')
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(framings)('retains the incomplete original using $name for syntax handling', (framing) => {
  const incomplete = original(framing).raw_payload.slice(0, -1)
  expect(readBody(incomplete + '\r\n\t ').inbound?.rawPayload).toBe(incomplete)
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(['complete', 'partial'] as const)('keeps a second %s interchange for the existing syntax rejection', (kind) => {
  const message = original(framings[0])
  const second = kind === 'complete' ? message.raw_payload : message.raw_payload.split('\n').slice(0, 3).join('\n')
  const twoOriginals = message.raw_payload + '\n' + second
  expect(extractCanonicalEdifactPayload(twoOriginals)).toBe(twoOriginals)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: twoOriginals }).syntaxDecision).toBe('rejected')
  expect(externalIo).not.toHaveBeenCalled()
})

it('retains actual UNA advice for syntax rejection when the header contradicts it', () => {
  const message = original(framings[0])
  const badAdvice = message.raw_payload.replace('UNA:+.?', 'UNA:*.?')
  expect(extractCanonicalEdifactPayload(badAdvice)).toBe(badAdvice)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: badAdvice }).syntaxDecision).toBe('rejected')
})

it('treats a padded UNA label as prose before a physical implicit UNB', () => {
  const message = original(framings[1])
  const preamble = 'UNA      \r\n'
  const postamble = '\r\n\t \r\nVid frågor, hänvisa till UNB.'
  const { mime, inbound } = readBody(preamble + message.raw_payload + postamble)
  expect(mime.bodyText).toContain('Vid frågor, hänvisa till UNB.')
  expect(inbound?.rawPayload).toBe(message.raw_payload)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: inbound!.rawPayload }).syntaxDecision).toBe('accepted')
  expect(externalIo).not.toHaveBeenCalled()
})

it('accepts an original with custom component, element, decimal, release and segment characters', () => {
  const message = original(framings[0])
  const separators: Record<string, string> = { ':': ';', '+': '*', "'": '~' }
  const raw = 'UNA;*,! ~' + message.raw_payload.slice(9)
    .replace(/\?.|[:+']/g, (token) => token.startsWith('?') ? '!' + token[1] : separators[token])
  const { inbound } = readBody('Avser UNA i förra mejlet.\n' + raw + '\nHänvisa till UNZ vid frågor.')
  expect(inbound?.rawPayload).toBe(raw)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: raw }).syntaxDecision).toBe('accepted')
  expect(externalIo).not.toHaveBeenCalled()
})

it.each([
  ['truncated default tag', 'UNB+'],
  ['truncated default syntax composite', 'UNB+UNOC:3'],
  ['explicit contradictory UNA', 'UNA:*.? ~\nUNB+UNOC:3+91100:ZZ+21660:ZZ'],
  ['non-default element separator with no UNA', 'UNB*UNOC:3*91100:ZZ*21660:ZZ*261118:0900'],
  ['truncated non-default syntax composite with no UNA', 'UNB*UNOC:3'],
])('keeps a following %s for syntax rejection', (_name, following) => {
  const message = original(framings[0])
  const raw = message.raw_payload + '\r\n\r\n' + following
  const { inbound } = readBody(raw)
  expect(inbound?.rawPayload).toBe(raw)
  expect(resolveCanonicalRuntimeDecision({ ...message, raw_payload: inbound!.rawPayload })).toMatchObject({
    syntaxDecision: 'rejected',
    applicationDecision: 'not_applicable',
    functionalDecision: 'not_applicable',
  })
  expect(externalIo).not.toHaveBeenCalled()
})
