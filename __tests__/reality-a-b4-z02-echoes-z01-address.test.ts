// reality-defects: A-B4
// A-B4: the grid-owner simulator answered every Z01 with a fixed installation address ('Kungsgatan 1', 'Alingsas'),
// so a website customer in Alingsås got a Z02 whose city differed from the site and the product's Z02 payload gate
// (gridex_gate_inbound_z02_required_payload) held the application with z02_installation_city_conflict. The Z02 now
// carries the installation address our Z01 named, raw as on the wire.
import { expect, it } from 'vitest'
import { z01InstallationAddress, z02For } from '../scripts/helpers/reality/inboundProdatWire'

const z01 = ["UNA:+.? ", 'UNB+UNOC:3+70426:ZZ+16700:ZZ+261026:2229+22C194DB0C5FFB++23-DDQ-PRODAT++1', 'UNH+1+PRODAT:D:97A:UN:E2SE6A',
  'BGM+Z01+DOC1+9+AB', 'DTM+137:202610262229:203', 'NAD+FR+70426:160:SVK+++++++SE', 'NAD+DO+16700:160:SVK+++++++SE',
  'LIN+1++735999965222451688:::9', 'RFF+LI:AUTO-Z01-B533574B',
  'NAD+UD+197606067663:SE2:260++Webbkund E2E-Statistik+Kungsgatan 1+Alingsås++441 30+SE',
  'NAD+IT+735999965222451688::9+++Storgatan 2?+4+Alingsås++441 30+SE', 'UNT+11+1', 'UNZ+1+22C194DB0C5FFB'].join("'") + "'"

it("reads the Z01's installation address, keeping escaped characters raw", () => {
  expect(z01InstallationAddress(z01)).toEqual({ street: 'Storgatan 2?+4', city: 'Alingsås', postalCode: '441 30' })
  expect(z01InstallationAddress(z01.replace(/NAD\+IT[^']*'/, ''))).toBeNull()
})

it('the Z02 answers with the address the Z01 named, in both NAD+UD and NAD+IT', () => {
  const { raw } = z02For(z01, '16700', { gridArea: 'ALS' })
  expect(raw).toContain("NAD+IT+735999965222451688::9+++Storgatan 2?+4+Alingsås++441 30+SE'")
  expect(raw).toContain('+Storgatan 2?+4+Alingsås++441 30+SE')
  expect(raw).not.toContain('Alingsas')
})

it('an explicit address still wins', () => {
  const { raw } = z02For(z01, '16700', { gridArea: 'ALS', address: { street: 'Annan väg 3', postalCode: '44131', city: 'Alingsås' } })
  expect(raw).toContain('NAD+IT+735999965222451688::9+++Annan väg 3+Alingsås++44131+SE')
})
