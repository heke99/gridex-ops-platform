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
