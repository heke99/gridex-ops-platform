// reality-defects: J1 / J4-D12 (fixed in lib/inbound-mail/inboundStatusUpdater.ts isNegativeContrL) — scenario J1 inbound PRODAT
// Ediel ACK-01: CONTRL:2:2 carries action 0083 = 1 (accepted) or 4 (rejected), on UCI (interchange) and UCM (message).
// The legacy intake helper read UCI action 7 as negative and never 4. Calls the real helper on the real parser output.
// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { isNegativeContrL } from '@/lib/inbound-mail/inboundStatusUpdater'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'

const contrl = (uci: string, ucm?: string) => parseEdifactPayload(["UNA:+.? '", "UNB+UNOC:3+60000:ZZ+40000:ZZ+261022:1200+C1'", "UNH+1+CONTRL:2:2:UN:EDIEL2'",
  `UCI+DCFE9CBEC2EE69+40000:ZZ+60000:ZZ+${uci}'`, ...(ucm ? [`UCM+M1+PRODAT:D:97A:UN:E2SE6A+${ucm}'`] : []), `UNT+${ucm ? 4 : 3}+1'`, "UNZ+1+C1'"].join(''))

describe('J1 CONTRL outcome at the mail intake (isNegativeContrL)', () => {
  it('UCI action 4 (interchange rejected) is negative', () => {
    expect(isNegativeContrL(contrl('4'))).toBe(true)
  })
  it('UCI action 1 (accepted) is not negative', () => {
    expect(isNegativeContrL(contrl('1'))).toBe(false)
  })
  it('UCI action 7 (not an Ediel CONTRL action) is not read as a rejection', () => {
    expect(isNegativeContrL(contrl('7'))).toBe(false)
  })
  it('a message-level rejection (UCM action 4) under an accepted interchange is negative', () => {
    expect(isNegativeContrL(contrl('1', '4'))).toBe(true)
    expect(isNegativeContrL(contrl('1', '1'))).toBe(false)
  })
  it('only CONTRL is classified: an APERAK is never a negative CONTRL', () => {
    const aperak = parseEdifactPayload(["UNA:+.? '", "UNB+UNOC:3+60000:ZZ+40000:ZZ+261022:1200+A1++23-DDQ-PRODAT'", "UNH+1+APERAK:D:96A:UN:E2SE6A'",
      "BGM+++27'", "UCI+X+40000:ZZ+60000:ZZ+4'", "UNT+4+1'", "UNZ+1+A1'"].join(''))
    expect(isNegativeContrL(aperak)).toBe(false)
  })
})
