// reality-defects: A-B4b
// A-B4b: the grid-owner simulators decoded base64 EDIFACT attachments as UTF-8, while the platform encodes Ediel files
// in ISO 8859-1 (UNOC). 'Alingsås' became 'Alings�s', and the Z02 that echoed the Z01's address could not be
// encoded again (edifact_character_not_iso8859_1). The attachment is now decoded as ISO 8859-1.
import { expect, it } from 'vitest'
import { edifactInterchangesInMail } from '../scripts/reality/simulators/edifactMailParts'
import { z02For } from '../scripts/helpers/reality/inboundProdatWire'

const z01 = ["UNA:+.? ", 'UNB+UNOC:3+70426:ZZ+16700:ZZ+261026:2229+22C194DB0C5FFB++23-DDQ-PRODAT++1', 'UNH+1+PRODAT:D:97A:UN:E2SE6A',
  'BGM+Z01+DOC1+9+AB', 'NAD+FR+70426:160:SVK+++++++SE', 'NAD+DO+16700:160:SVK+++++++SE', 'LIN+1++735999965222451688:::9',
  'RFF+LI:AUTO-Z01-B533574B', 'NAD+UD+197606067663:SE2:260++Webbkund+Kungsgatan 1+Alingsås++441 30+SE',
  'NAD+IT+735999965222451688::9+++Kungsgatan 1+Alingsås++441 30+SE', 'UNT+10+1', 'UNZ+1+22C194DB0C5FFB'].join("'") + "'"
const mail = (file: string) => ['Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain', '', 'Ediel', '--b1',
  'Content-Type: application/edifact', 'Content-Transfer-Encoding: base64', '', Buffer.from(file, 'latin1').toString('base64'), '--b1--'].join('\r\n')

it('reads a Latin-1 attachment with å intact', () => {
  const [file] = edifactInterchangesInMail(mail(z01))
  expect(file).toBe(z01)
  expect(file).not.toContain('�')
})

it('the Z02 built from that file carries the city as the Z01 named it and stays encodable as Latin-1', () => {
  const [file] = edifactInterchangesInMail(mail(z01))
  const { raw } = z02For(file, '16700', { gridArea: 'ALS' })
  expect(raw).toContain('+Kungsgatan 1+Alingsås++441 30+SE')
  expect(Buffer.from(raw, 'latin1').toString('latin1')).toBe(raw)
})

it('a part without an interchange is skipped', () => {
  expect(edifactInterchangesInMail(['--b1', 'Content-Type: text/plain', '', 'hej', '--b1--'].join('\r\n'))).toEqual([])
})

// I-B6: the attachment a simulator sends is ISO 8859-1 bytes, never a UTF-8 string, and the round trip through the
// platform's own reading (latin1, edifactInterchangesInMail) keeps the text exactly.
import { edifactAttachment } from '../scripts/reality/simulators/edifactMailParts'
it('I-B6 an EDIFACT attachment is sent as ISO 8859-1 bytes and reads back unchanged', () => {
  const aperak = "UNA:+.? 'UNB+UNOC:3+16700:ZZ+70434:ZZ+261027:0215+A8++23-DDQ-PRODAT++1'FTX+AAO++105::260+Anläggningen kan inte identifieras'UNZ+1+A8'"
  const attachment = edifactAttachment('APERAK.edi', aperak)
  expect(attachment.content.equals(Buffer.from(aperak, 'latin1'))).toBe(true)
  expect(attachment.content.includes(Buffer.from('Ã¤', 'latin1'))).toBe(false)
  const mailText = ['--b1', 'Content-Transfer-Encoding: base64', '', attachment.content.toString('base64'), '--b1--'].join('\r\n')
  expect(edifactInterchangesInMail(mailText)).toEqual([aperak])
  expect(() => edifactAttachment('x.edi', 'UNB+€')).toThrow('edifact_attachment_not_iso8859_1:U+20AC')
})
