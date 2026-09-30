import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec, type EdifactEnvelopeEncodeInput } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { assertEdifactLatin1Representable, encodeEdifactLatin1 } from '@/lib/ediel/core/edifactEncoding'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

function input(overrides: Partial<EdifactEnvelopeEncodeInput> = {}): EdifactEnvelopeEncodeInput {
  return {
    sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'INT1',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    createdAt: new Date('2026-09-30T12:00:00Z'),
    messages: [{ messageReference: 'MSG1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: ['BGM+Z03+DOC1+9', "FTX+AAO+++Åäö ?+ ?: ?? ?'"] }],
    ...overrides,
  }
}

describe('source-owned envelope byte integrity', () => {
  it('encodes every ISO8859-1 byte without losing Swedish characters or substituting values', () => {
    const source = Array.from({ length: 256 }, (_, code) => String.fromCharCode(code)).join('')
    expect(encodeEdifactLatin1(source)).toEqual(Buffer.from(Array.from({ length: 256 }, (_, code) => code)))
    expect(encodeEdifactLatin1('ÅÄÖ åäö').toString('latin1')).toBe('ÅÄÖ åäö')
  })

  it('reports only offset and code point for an unrepresentable identifier', () => {
    expect(() => assertEdifactLatin1Representable('PRIVATE€ID')).toThrow('edifact_character_not_iso8859_1:7:U+20AC')
    try { encodeEdifactLatin1('PRIVATE€ID') } catch (error) { expect(String(error)).not.toContain('PRIVATE') }
  })
  it.each(['€', '東京', '😀', '\ud800'])('rejects unrepresentable source text before UNOC:3 output (%s)', value => {
    expect(() => EdifactEnvelopeCodec.encode(input({ messages: [{ messageReference: 'MSG1',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [`FTX+AAO+++${value}`] }] })))
      .toThrow('edifact_character_not_iso8859_1')
  })

  it('transcodes all structural separators and released values for an alternate UNA', () => {
    const raw = EdifactEnvelopeCodec.encode(input({ una: {
      componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~',
    } }))
    const decoded = EdifactEnvelopeCodec.decode(raw)
    expect(decoded.sender).toBe('SENDER')
    expect(decoded.interchangeReference).toBe('INT1')
    expect(decoded.applicationReference).toBe('23-DDQ-PRODAT')
    expect(decoded.testIndicator).toBe('1')
    expect(decoded.messageCount).toBe(1)
    const ftx = decoded.segments.find(segment => segment.tag === 'FTX')
    expect(segmentComposite(ftx, 4, decoded.una)).toEqual(["Åäö + : ? '"])
    expect(raw).toContain('UNH;MSG1;PRODAT*D*97A*UN*E2SE6A~')
    expect(raw).toContain('UNT;4;MSG1~UNZ;1;INT1~')
  })

  it('escapes supplied technical values without turning them into extra envelope structure', () => {
    const raw = EdifactEnvelopeCodec.encode(input({ senderSubAddress: 'SUB+X:Y?Z',
      interchangeReference: 'I+X', messages: [{ messageReference: "M'X", messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
        businessSegments: ['BGM+Z03+DOC1+9'] }] }))
    const decoded = EdifactEnvelopeCodec.decode(raw)
    expect(decoded.senderSubAddress).toBe('SUB+X:Y?Z')
    expect(decoded.interchangeReference).toBe('I+X')
    expect(decoded.segments.filter(segment => segment.tag === 'UNH')).toHaveLength(1)
    expect(segmentComposite(decoded.segments.find(segment => segment.tag === 'UNH'), 1, decoded.una)).toEqual(["M'X"])
  })

  it('rejects repeated message references rather than building an ambiguous envelope', () => {
    const first = input().messages[0]
    expect(() => EdifactEnvelopeCodec.encode(input({ messages: [first, first] })))
      .toThrow('edifact_message_reference_duplicate')
  })

  it('requires an interchange reference', () => {
    expect(() => EdifactEnvelopeCodec.encode(input({ interchangeReference: '' })))
      .toThrow('edifact_interchange_reference_required')
  })

  it('rejects a builder element that injects another terminated business segment', () => {
    expect(() => EdifactEnvelopeCodec.encode(input({ messages: [{ messageReference: 'MSG1',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: ["BGM+Z03+DOC1+9'FTX+AAO+++EXTRA"] }] })))
      .toThrow('edifact_business_segment_contains_multiple_segments')
  })

  it('preserves empty composite positions under alternate separators', () => {
    const raw = EdifactEnvelopeCodec.encode(input({ una: {
      componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~',
    }, messages: [{ messageReference: 'MSG1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: ['CCI++Z12', 'CAV+:::9:PRODUCT'] }] }))
    const parsed = tokenizeEdifact(raw)
    expect(segmentComposite(parsed.segments.find(segment => segment.tag === 'CAV'), 1, parsed.una))
      .toEqual(['', '', '', '9', 'PRODUCT'])
  })
})
