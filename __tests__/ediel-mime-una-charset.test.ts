import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assertEdifactUnocText } from '@/lib/ediel/core/edifactEncoding'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { decodeTextBytes, edifactSyntaxCharset } from '@/lib/inbound-mail/mimeCharset'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'

const externalIo = vi.hoisted(() => vi.fn(() => { throw new Error('External I/O is outside this MIME fixture') }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: externalIo, rpc: externalIo } }))

beforeEach(() => vi.stubGlobal('fetch', externalIo))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const source = energyHandoffMessage('2026-11-18')
const defaultWire = source.raw_payload!
  .replace("++23-DDQ-E66-T++1'", "++23-DDQ-E66-T++1++1'")
  .replace('GRIDEX2607E66MSG001', 'ÅÄÖ-E66-TEST')
const delimiters: Record<string, string> = { ':': ';', '+': '*', "'": '!' }
const customWire = 'UNA;*.? !' + defaultWire.slice(9).trimStart()
  .replace(/\?.|[:+']/g, token => token.startsWith('?') ? token : delimiters[token])
const customTerminatorWire = defaultWire.replaceAll(/(?<!\?)'/g, '!').replace('!\nUNB', '!UNB')

function readAttachment(payload: string, encoding: 'utf8' | 'latin1', mimeCharset: string, transfer = '8bit') {
  const mimeHeader = [
    'From: synthetic@example.test',
    'Content-Type: multipart/mixed; boundary="case-boundary"', '',
    '--case-boundary', 'Content-Type: text/plain; charset=utf-8', '', 'Se bifogad fil',
    '--case-boundary', 'Content-Type: application/edifact; charset=' + mimeCharset,
    'Content-Disposition: attachment; filename="synthetic.edi"',
    'Content-Transfer-Encoding: ' + transfer, '', '',
  ].join('\r\n')
  const bytes = Buffer.from(payload, encoding)
  const body = transfer === 'base64' ? Buffer.from(bytes.toString('base64'), 'ascii') : bytes
  const rawEmail = Buffer.concat([Buffer.from(mimeHeader, 'ascii'), body, Buffer.from('\r\n--case-boundary--\r\n', 'ascii')])
  const mime = splitMimeParts(rawEmail)
  expect(mime.attachments[0].sizeBytes).toBe(bytes.length)
  return parseInboundEmailContent({ attachmentText: mime.rawEdifactPayload, bodyText: mime.bodyText })
}

it.each([
  ['default UNA', defaultWire],
  ['custom component, element and segment delimiters', customWire],
  ['custom adjacent segment terminator alone', customTerminatorWire],
])('preserves the original UNOC reference through MIME and Ediel planning with %s', (_name, wire) => {
  const inbound = readAttachment(wire, 'latin1', 'utf-8')
  expect(inbound?.rawPayload).toBe(wire)
  expect(() => assertEdifactUnocText(inbound!.rawPayload.replaceAll('\n', ''))).not.toThrow()
  expect(resolveCanonicalRuntimeDecision({ ...source, raw_payload: inbound!.rawPayload })).toMatchObject({
    syntaxDecision: 'accepted',
    responsePlan: [{ family: 'CONTRL', outcome: 'positive' }, { family: 'APERAK', outcome: 'positive' }],
  })
  expect(externalIo).not.toHaveBeenCalled()
})

it('keeps custom UNOW UTF-8 after base64 transfer decoding despite the MIME charset', () => {
  const wire = customWire.replace('UNOC;3', 'UNOW;3')
  expect(readAttachment(wire, 'utf8', 'iso-8859-1', 'base64')?.rawPayload).toBe(wire)
})

it('keeps a genuine out-of-repertoire byte available to the existing character guard', () => {
  const wire = customWire.replace('ÅÄÖ', 'Å\u0080Ö')
  const inbound = readAttachment(wire, 'latin1', 'utf-8')
  expect(inbound?.rawPayload).toBe(wire)
  expect(() => assertEdifactUnocText(inbound!.rawPayload.replaceAll('\n', ''))).toThrow(/U\+0080/)
})

it('retains MIME fallback for prose, a partial UNB and unknown charset declarations', () => {
  const prose = 'UNA;*.? !UNB*UNOC;3!\nEn skiss från Västerås.'
  expect(decodeTextBytes(Buffer.from(prose, 'utf8'), 'utf-8')).toBe(prose)
  expect(edifactSyntaxCharset(Buffer.from('UNA;*.? !UNB*UNOC;3', 'ascii'))).toBeNull()

  const unsupported = customWire.replace('UNOC;3', 'UNOZ;3')
  expect(edifactSyntaxCharset(Buffer.from(unsupported, 'utf8'))).toBeNull()
  expect(readAttachment(unsupported, 'utf8', 'utf-8')?.rawPayload).toBe(unsupported)
})

it.each([true, false])('uses MIME decoding for contradictory physical headers with UNOC first=%s', (unocFirst) => {
  const unoc = Buffer.from(defaultWire, 'latin1')
  const unow = Buffer.from(customWire.replace('UNOC;3', 'UNOW;3'), 'utf8')
  const frames = unocFirst ? [unoc, unow] : [unow, unoc]
  const mixed = Buffer.concat([frames[0], Buffer.from('\r\n'), frames[1]])

  expect(edifactSyntaxCharset(mixed)).toBeNull()
  const decoded = decodeTextBytes(mixed, 'iso-8859-1')
  expect(decoded).toBe(mixed.toString('latin1'))
  expect(resolveCanonicalRuntimeDecision({ ...source, raw_payload: decoded }).syntaxDecision).toBe('rejected')
})

it('does not choose a charset from contradictory UNB headers before the trailer', () => {
  const lines = defaultWire.split('\n')
  lines.splice(2, 0, lines[1].replace('UNOC:3', 'UNOW:3'))
  expect(edifactSyntaxCharset(Buffer.from(lines.join('\n'), 'latin1'))).toBeNull()
})

it('limits physical header discovery to the existing 4 KiB prefix', () => {
  const outside = Buffer.from('x'.repeat(4096) + '\n' + customWire, 'latin1')
  expect(edifactSyntaxCharset(outside)).toBeNull()
})
