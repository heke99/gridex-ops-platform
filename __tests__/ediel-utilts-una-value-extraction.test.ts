import { describe, expect, it } from 'vitest'

import { parseInboundUtilts } from '@/lib/ediel/utilts'

const CUSTOM_UNA_UTILTS_WITH_COMMA_DECIMAL = [
  'UNA;*,? !',
  'UNB*UNOC;3*SENDER;;14*RECEIVER;;14*260829;0145*REF-VAL**23-DDQ-E66-T!',
  'UNH*1*UTILTS;D;96A;UN;E5SE5A!',
  'BGM*E66*DOC-VAL*9!',
  'DTM*137;20260829;102!',
  'DTM*597;202608291430;203!',
  'LOC*172*735999123456789001;;9!',
  'RFF*TN;TX-VAL!',
  'QTY*31;12,5;KWH!',
  'UNT*8*1!',
  'UNZ*1*REF-VAL!',
].join('')

describe('UTILTS UNA-aware structured value extraction', () => {
  it('extracts dates, quantity and identities through the active UNA separators', () => {
    const parsed = parseInboundUtilts(CUSTOM_UNA_UTILTS_WITH_COMMA_DECIMAL)

    expect(parsed.messageFamily).toBe('UTILTS')
    expect(parsed.messageCode).toBe('E66')
    expect(parsed.senderEdielId).toBe('SENDER')
    expect(parsed.receiverEdielId).toBe('RECEIVER')
    expect(parsed.transactionReference).toBe('TX-VAL')
    expect(parsed.applicationReference).toBe('23-DDQ-E66-T')
    expect(parsed.parsedPayload).toMatchObject({
      meterPointId: '735999123456789001',
      meteringPointId: '735999123456789001',
      periodStart: '2026-08-29',
      registrationTime: '2026-08-29',
      quantity: 12.5,
      inferredFamily: 'UTILTS',
      inferredCode: 'E66',
      hasUtiltsErrPattern: false,
    })
  })
})
