// masterplan: ENV-01, AT-ENV-01
import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec, type EdifactEnvelopeEncodeInput } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { assertEdifactUnocSyntax3, encodeEdifactUnoc } from '@/lib/ediel/core/edifactEncoding'
import { prodatCustomerNadSegment } from '@/lib/ediel/prodat/render/segments'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

const input = (): EdifactEnvelopeEncodeInput => ({
  sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'INT1',
  acknowledgementRequest: true, environment: 'test', createdAt: new Date('2026-10-04T12:00:00Z'),
  messages: [{ messageReference: 'MSG1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
    businessSegments: ['BGM+Z01+DOC1+9'] }],
})

describe('ENV-01 rejects unsupported source characters without replacing or removing data', () => {
  it.each([0x00, 0x09, 0x1f, 0x7f, 0x80, 0x85, 0x9f])('rejects UNOC control U+%i before producing wire bytes', code => {
    const source = input()
    source.messages = [{ ...source.messages[0], businessSegments: [`FTX+AAO+++PRIVATE${String.fromCharCode(code)}ID`] }]
    expect(() => EdifactEnvelopeCodec.encode(source)).toThrow('edifact_character_not_unoc')
  })

  it.each(['\n', '\r', '\r\n', '\u0085', '\t'])('does not erase an invalid control inside a builder value (%j)', character => {
    const source = input()
    source.messages = [{ ...source.messages[0], businessSegments: [`FTX+AAO+++AB${character}CD`] }]
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
    expect(encodeEdifactUnoc(source)).toEqual(Buffer.from(codes))
  })

  it('preserves a full customer ID and escapes its separators before combining NAD components', () => {
    const customerId = `${'A'.repeat(30)}+:?'Å`
    expect(customerId).toHaveLength(35)
    const raw = prodatCustomerNadSegment({ customerId, idAgency: '89', customerName: 'Åsa Ängström' })
    const tokenized = tokenizeEdifact(`${raw}'`)
    expect(segmentComposite(tokenized.segments[0], 2, tokenized.una)).toEqual([customerId, '', '89'])
    expect(raw).toContain('Åsa Ängström')
    expect(() => prodatCustomerNadSegment({ customerId: `${customerId}X`, idAgency: '89', customerName: 'Åsa' }))
      .toThrow('prodat_party_field_invalid')
  })

  it.each(['\n', '\t', '\u0085', '\u009f'])('does not trim invalid controls out of original customer identity (%j)', character => {
    const source = { customerId: `${character}ORIGINAL${character}`, idAgency: '89' as const, customerName: 'Åsa' }
    const before = structuredClone(source)
    expect(() => prodatCustomerNadSegment(source)).toThrow('prodat_party_field_invalid')
    expect(source).toEqual(before)
  })

  it.each(['customerName', 'address', 'city', 'postalCode'] as const)('rejects C1 in original customer %s', field => {
    expect(() => prodatCustomerNadSegment({ customerName: 'Åsa', [field]: 'ORIGINAL\u0085' })).toThrow('prodat_party_field_invalid')
  })

  it('rejects repeated UNB instead of choosing a valid-looking first syntax', () => {
    expect(() => assertEdifactUnocSyntax3("UNB+UNOC:3+S+R+261004:1200+I'UNB+UNOB:2+S+R+261004:1200+I'"))
      .toThrow('edifact_unoc_syntax_3_required')
  })

  it('rejects a control in the active portal customer ID before its upstream trim', () => {
    const portalSnapshot = { customerId: '\tORIGINAL\n', customerIdCodeListQualifier: '1', customerName: 'Åsa' }
    const before = structuredClone(portalSnapshot)
    expect(() => buildProfiledProdatSegments({ context: { code: 'Z01', customerId: 'ORIGINAL', customerName: 'Åsa',
      meterPointId: '735123456789012345', bgmReference: 'DOC1', transactionReference: 'TX1',
      senderEdielId: '12345', receiverEdielId: '54321' }, portalSnapshot, mode: 'test', variant: 'L' }))
      .toThrow('edifact_character_not_unoc')
    expect(portalSnapshot).toEqual(before)
  })
})
