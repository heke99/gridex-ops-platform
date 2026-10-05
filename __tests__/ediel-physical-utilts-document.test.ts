import { describe, expect, it } from 'vitest'
import { readPhysicalUtiltsDocumentIdentity } from '@/lib/ediel/core/physicalDocumentReference'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

function original(bgm: string, alternate = false) {
  return EdifactEnvelopeCodec.encode({ sender: 'NETWORK', receiver: 'SUPPLIER', interchangeReference: 'ORIGINAL',
    environment: 'test', applicationReference: '23-DDQ-E66', acknowledgementRequest: true,
    ...(alternate ? { una: { componentDataElementSeparator: '^', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
    messages: [{ messageReference: 'TECHNICAL', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A',
      businessSegments: [bgm, 'IDE+24+TRANSACTION', 'STS+7++E23::260'] }] })
}

describe('physical UTILTS document observation for prescribed replies', () => {
  it.each([false, true])('retains escaped punctuation and genuine trailing data under alternate UNA=%s', alternate => {
    expect(readPhysicalUtiltsDocumentIdentity(original('BGM+E66::260+ OWN?:A?+B??C +9+AB', alternate)))
      .toEqual({ messageCode: 'E66', reference: ' OWN:A+B?C ' })
  })
  it('preserves an absent own document value without technical or row identity substitution', () => {
    expect(readPhysicalUtiltsDocumentIdentity(original('BGM+E66::260++9+AB')))
      .toEqual({ messageCode: 'E66', reference: '' })
    expect(readPhysicalUtiltsDocumentIdentity(original('BGM+++9+AB')))
      .toEqual({ messageCode: '', reference: '' })
  })
  it('observes incoming ERR through its real UTILTS UNH family', () => {
    expect(readPhysicalUtiltsDocumentIdentity(original('BGM+ERR::260+ERR-ORIGINAL+9+AB')))
      .toEqual({ messageCode: 'ERR', reference: 'ERR-ORIGINAL' })
  })
  it.each([
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+ONE'BGM+E66::260+TWO'",
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+ONE'UNH+OTHER+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E66::260+ONE'UNH+TECH+UTILTS:D:02B:UN:E5SE5A'",
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'IDE+24+OWN'BGM+E66::260+ONE'",
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'UNT+2+TECH'BGM+E66::260+ONE'",
    "UNH+TECH+PRODAT:D:97A:UN:E2SE6A'BGM+Z01::260+ONE'",
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+ONE:TWO'",
    "UNH+TECH+UTILTS:D:02B:UN:E5SE5A'UNT+2+TECH'",
  ])('holds missing or ambiguous own physical header: %s', raw => {
    expect(readPhysicalUtiltsDocumentIdentity(raw)).toBeNull()
  })
})
