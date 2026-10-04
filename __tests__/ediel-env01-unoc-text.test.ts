// masterplan: ENV-01, AT-ENV-01
import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec, type EdifactEnvelopeEncodeInput } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { encodeEdifactLatin1 } from '@/lib/ediel/core/edifactEncoding'

const input = (): EdifactEnvelopeEncodeInput => ({
  sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'INT1',
  acknowledgementRequest: true, environment: 'test', createdAt: new Date('2026-10-04T12:00:00Z'),
  messages: [{ messageReference: 'MSG1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
    businessSegments: ['BGM+Z01+DOC1+9'] }],
})

describe('ENV-01 rejects unsupported source characters without replacing or removing data', () => {
  it.each([0x00, 0x09, 0x1f, 0x7f, 0x80, 0x85, 0x9f])('rejects UNOC control U+%i before producing wire bytes', code => {
    const source = input()
    source.messages[0] = { ...source.messages[0], businessSegments: [`FTX+AAO+++PRIVATE${String.fromCharCode(code)}ID`] }
    expect(() => EdifactEnvelopeCodec.encode(source)).toThrow('edifact_character_not_unoc')
  })

  it.each(['\n', '\r', '\r\n', '\u0085', '\t'])('does not erase an invalid control inside a builder value (%j)', character => {
    const source = input()
    source.messages[0] = { ...source.messages[0], businessSegments: [`FTX+AAO+++AB${character}CD`] }
    const before = structuredClone(source)
    expect(() => EdifactEnvelopeCodec.encode(source)).toThrow('edifact_character_not_unoc')
    expect(source).toEqual(before)
  })

  it.each(['sender', 'receiver', 'interchangeReference'] as const)('validates %s before whitespace normalization', field => {
    const source = input()
    source[field] = 'ORIGINAL\u0085'
    const before = structuredClone(source)
    expect(() => EdifactEnvelopeCodec.encode(source)).toThrow('edifact_character_not_unoc')
    expect(source).toEqual(before)
  })

  it('preserves every visible Latin1 byte including NBSP and soft hyphen', () => {
    const codes = [...Array.from({ length: 95 }, (_, i) => i + 0x20), ...Array.from({ length: 96 }, (_, i) => i + 0xa0)]
    const source = codes.map(code => String.fromCharCode(code)).join('')
    expect(encodeEdifactLatin1(source)).toEqual(Buffer.from(codes))
  })
})
