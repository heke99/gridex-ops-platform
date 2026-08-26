import { describe, expect, it } from 'vitest'

import { inferEdielFamilyAndCodeFromRawPayload } from '@/lib/ediel/classify'
import { classifyProductionInboundDecision } from '@/lib/ediel/inbound/productionInboundDecisionEngine'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'

function envelope(message: string, reference: string): string {
  return [
    "UNA:+.? '",
    `UNB+UNOC:3+SENDER:14+RECEIVER:14+260826:1200+${reference}`,
    message,
    `UNZ+1+${reference}`,
  ].join('')
}

describe('inbound EDIFACT parser/runtime parity audit', () => {
  it('treats CONTRL action code 4 as a negative final syntax acknowledgement', () => {
    const raw = envelope(
      "UNH+ACK1+CONTRL:D:3:UN'UCI+ORIGINAL+SENDER:14+RECEIVER:14+4'UNT+3+ACK1'",
      'CTRL4',
    )

    expect(parseRulebookMessage(raw).outcome).toBe('negative')
  })

  it('does not classify positive APERAK BGM 312 with ERC 100/OK as negative', () => {
    const raw = envelope(
      "UNH+APER1+APERAK:D:96A:UN'BGM+312+ACK-1+9'ERC+100::260'FTX+AAO+++OK'UNT+5+APER1'",
      'APER312',
    )

    expect(parseRulebookMessage(raw).outcome).toBe('positive')
  })

  it('recognizes E30 as a supported UTILTS code at raw-payload classification', () => {
    const raw = envelope(
      "UNH+U1+UTILTS:D:02B:UN:E5SE5A'BGM+E30+DOC-1+9'UNT+3+U1'",
      'E30RAW',
    )

    expect(inferEdielFamilyAndCodeFromRawPayload(raw)).toMatchObject({
      messageFamily: 'UTILTS',
      messageCode: 'E30',
      messageStandard: 'edifact',
    })
  })

  it('classifies E30 as customer metering import but not grid-area E31', () => {
    const e30 = classifyProductionInboundDecision({
      messageFamily: 'UTILTS',
      messageCode: 'E30',
      rawPayload: "UNH+U1+UTILTS:D:02B:UN:E5SE5A'BGM+E30+DOC-1+9'",
    })
    const e31 = classifyProductionInboundDecision({
      messageFamily: 'UTILTS',
      messageCode: 'E31',
      rawPayload: "UNH+U2+UTILTS:D:02B:UN:E5SE5A'BGM+E31+DOC-2+9'",
    })

    expect(e30.businessEffect).toBe('import_meter_values')
    expect(e31.businessEffect).not.toBe('import_meter_values')
  })
})
