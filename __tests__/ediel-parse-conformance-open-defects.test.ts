// reality-defects: J4 open parse-conformance defects (J4-D5, J4-D6, J4-D8, J4-D12, J4-D13) — each case asserts the CORRECT behaviour
//
// These defects live in files owned by other work streams, so they are reported with a patch instead of being fixed
// here. Each case is registered with `it.fails` while its ID is in OPEN: the assertion of the correct behaviour fails
// today. When the patch for an ID lands, remove the ID from OPEN and the case must pass as a normal test.
// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { extractCanonicalEdifactPayload } from '@/lib/ediel/core/canonicalEdifactAst'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { isNegativeContrL } from '@/lib/inbound-mail/inboundStatusUpdater'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { parseMeteringObservations } from '@/lib/ediel/utilts/meteringObservationParser'
import { parseUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'

// J4_SHOW_OPEN_DEFECTS=1 runs every case as a normal test to show the actual failure of each open defect.
const OPEN = new Set(process.env.J4_SHOW_OPEN_DEFECTS ? [] : ['J4-D5', 'J4-D6', 'J4-D8', 'J4-D13'])
const defect = (id: string, name: string, fn: () => void) => (OPEN.has(id) ? it.fails : it)(`${id} ${name}`, fn)

const APERAK = ["UNA:+.? '", "UNB+UNOC:3+16700:14+40000:14+261022:1200+R1++23-DDQ-PRODAT++++1'", "UNH+M1+APERAK:D:96A:UN:E2SE6A'", "BGM+++34'",
  "RFF+ACW:DOC1'", "ERC+100::260'", "FTX+AAO+++OK'", "UNT+6+M1'", "UNZ+1+R1'"].join('')

describe('J4 open defects — payload extraction (lib/ediel/core/canonicalEdifactAst.ts extractCanonicalEdifactPayload)', () => {
  // The processor joins raw_edifact_payload and every attachment raw_text. An S/MIME mail stores the decrypted inner
  // MIME entity (base64 body) as the smime.p7m attachment text; base64 contains "unz" in any letter case by chance.
  const innerMime = 'Content-Type: application/EDIFACT\r\nContent-Transfer-Encoding: base64\r\n\r\nVU5BOisuPyAnVU5CK1VOT0M6MyunzQrMTY3MDA6MTQr\r\n'
  defect('J4-D5', 'text after the real UNZ is never part of the interchange (a later "unz" in base64 or a cover letter)', () => {
    for (const tail of [innerMime, 'Mvh Hans Kunz\nPlease unzip the archive.']) {
      const extracted = extractCanonicalEdifactPayload([APERAK, tail].join('\n\n'))
      expect(extracted).toBe(APERAK)
      expect(validateEdifactEnvelope(extracted!).ok).toBe(true)
    }
  })

  defect('J4-D6', 'the payload starts at the real UNA/UNB, not at "una" inside a word of the mail body', () => {
    const body = `Hej!\nBifogat från Kommunala Energiverket AB, Fortuna-området.\n\n${APERAK}`
    expect(extractCanonicalEdifactPayload(body)).toBe(APERAK)
  })
})

describe('J4 open defects — MIME charset (lib/inbound-mail/mimeCharset.ts edifactSyntaxCharset)', () => {
  defect('J4-D13', 'UNOC bytes with a custom UNA data separator are decoded ISO-8859-1 even when the MIME part says utf-8', () => {
    const edi = ["UNA:*.? '", "UNB*UNOC:3*16700:14*40000:14*261022:1200*R1**23-DDQ-PRODAT'", "UNH*1*PRODAT:D:97A:UN:E2SE6A'", "BGM*Z06*D1*9*AB'",
      "NAD*UD*199001011234:SE2:260**Åsa Öberg*Ängsvägen 1*Älmhult**34331*SE'", "UNT*4*1'", "UNZ*1*R1'"].join('')
    const mail = Buffer.from(`From: dso@example.invalid\r\nTo: platform@example.invalid\r\nSubject: J4\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain\r\n\r\nEdiel\r\n--b1\r\nContent-Type: application/EDIFACT; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="z06.edi"\r\n\r\n${Buffer.from(edi, 'latin1').toString('base64')}\r\n--b1--\r\n`, 'latin1')
    expect(splitMimeParts(mail).rawEdifactPayload).toBe(edi)
  })
})

describe('J4 open defects — CONTRL outcome helper (lib/inbound-mail/inboundStatusUpdater.ts isNegativeContrL)', () => {
  const contrl = (action: string) => parseEdifactPayload(["UNA:+.? '", "UNB+UNOC:3+60000:ZZ+40000:ZZ+261022:1200+C1'", "UNH+1+CONTRL:2:2:UN:EDIEL2'",
    `UCI+DCFE9CBEC2EE69+40000:ZZ+60000:ZZ+${action}'`, "UNT+3+1'", "UNZ+1+C1'"].join(''))
  defect('J4-D12', 'UCI 0083 = 4 is negative and 0083 = 7 is not (Ediel ACK-01: 1 positive, 4 negative)', () => {
    expect(isNegativeContrL(contrl('4'))).toBe(true)
    expect(isNegativeContrL(contrl('7'))).toBe(false)
    expect(isNegativeContrL(contrl('1'))).toBe(false)
  })
})

describe('J4 open defects — metering observation projection (lib/ediel/utilts/meteringObservationParser.ts)', () => {
  const raw = ["UNA:+.? '", "UNB+UNOC:3+16700:ZZ+40000:ZZ+261022:0600+R1++23-DDQ-E66-T++++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'", "BGM+E66::260+M1+9+AB'",
    "DTM+137:202610220600:203'", "DTM+735:?+0100:406'", "IDE+24+T1'", "LOC+172+735999000000000017::9'", "LOC+239+ALS:SVK:260'",
    "DTM+324:202610200000202610200030:719'", "DTM+597:202610220600:203'", "DTM+354:15:806'", "MEA+AAZ++KWH'",
    "SEQ++1'", "QTY+136:0.125'", "SEQ++2'", "QTY+136:0.25'", "STS+8+56'", "UNT+17+1'", "UNZ+1+R1'"].join('')
  defect('J4-D8', 'qualityStatus is the SG11 STS+8 quality (field 520), not the QTY qualifier 136', () => {
    expect(parseMeteringObservations(parseUtilts(raw)).map(o => [o.quantity, o.qualityStatus])).toEqual([[0.125, null], [0.25, '56']])
  })
})
