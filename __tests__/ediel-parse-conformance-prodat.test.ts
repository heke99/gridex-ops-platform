// reality-defects: J4 parse conformance — inbound PRODAT (Z04, Z05, Z06): parties, dates/ENV-08, references, CCI/CAV, multi-object
//
// Field positions come from the PRODAT 26.A field matrix (P26.A r3 §2.2/§2.6, masterplan ENV-06/ENV-08/ENV-10) and are
// written out literally below; the messages are what a grid owner sends (scripts/reality/simulators/gridOwnerWire.ts for
// Z04, hand-written wire for Z05/Z06 with a custom UNA, release characters and ÅÄÖ). Synthetic data only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseProdatMessage, parsedProdatObjects } from '@/lib/ediel/prodat/parser'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { buildZ04ForSwitchRequest } from '../scripts/reality/simulators/gridOwnerWire'

const Z03 = readFileSync('scripts/reality/fixtures-z03-normal-switch.edi', 'utf8')

describe('J4 PRODAT Z04 (confirmation of our switch) — every field from the guide position', () => {
  const z04 = buildZ04ForSwitchRequest({ request: Z03, gridOwnerEdielId: '60000' })
  const parsed = parseProdatMessage(z04.raw)
  const line = parsed.lineItems[0]

  it('header: code, document id, document date, fixed UTC+1 marker, legal parties', () => {
    const bgm = tokenizeEdifact(z04.raw).segments.find(s => s.tag === 'BGM')!.raw
    expect(parsed).toMatchObject({ messageFamily: 'PRODAT', messageCode: 'Z04', messageReference: bgm.split('+')[2], interchangeReference: z04.reference,
      timezoneOffset: '1', legalSenderId: '60000', legalReceiverId: '40000' })
    expect(parsed.messageDate).toMatch(/^\d{12}$/)
    expect(parsed.lineItems).toHaveLength(1)
  })

  const FIELDS: Array<[string, unknown]> = [
    ['lineSequenceNumber', '1'],                       // 314 LIN/1082
    ['meteringPointId', '735123456789051435'],         // 209 LIN/C212/7140 (from our Z03)
    ['identityAgency', '9'],                           // LIN/C212/3055 GS1
    ['contractStartDate', '202611150000'],             // 210 DTM+92 (our requested start)
    ['observationLength', '15'], ['observationLengthFormat', '806'], // 508 DTM+354
    ['annualConsumption', '1000'],                     // 213 QTY+31
    ['reasonForTransaction', 'Z22'],                   // 223 CCI++Z13 / CAV 7111 (normal switch L)
    ['measuringMethod', 'Z04'],                        // 217 CCI++Z04 / CAV 7111
    ['reportingFrequency', 'D'],                       // 222 CCI++Z12 / CAV 2nd 7110
    ['timeSeriesProduct', 'L639Q'],                    // 242 CCI++Z14 / CAV 2nd 7110
    ['meterNumber', 'METER-1'],                        // 224 RFF+MG
    ['gridAreaId', 'TES'],                             // 260 RFF+Z05 (from our Z03)
    ['lineItemReference', 'LI9B13B11F12D6402A9DCF7AB03A02536C'], // 226 RFF+LI (our case reference)
    ['endUserId', '199001011234'], ['endUserIdQualifier', 'SE2'], // 227 NAD+UD/C082
    ['endUserPostcode', '12345'], ['endUserCountry', 'SE'],
    ['installationId', '735123456789051435'],          // 233 NAD+IT/C082
    ['installationCity', 'Town'], ['installationPostcode', '12345'], ['installationCountry', 'SE'],
    ['balanceResponsibleId', '99876'],                 // 262 NAD+Z02 (our BRP from the Z03)
    ['contractEndDate', null], ['validityStartDate', null], ['permissionId', null],
  ]
  for (const [field, value] of FIELDS) it(`line field ${field} = ${JSON.stringify(value)}`, () => expect((line as Record<string, unknown>)[field]).toEqual(value))

  it('CCI/CAV fields outside the line projection: 254 settlement method Z32, 306 installation status Z12', () => {
    const semantic = tokenizeEdifact(z04.raw).segments
    expect(prodatCharacteristicValue('254', semantic)).toBe('Z32')
    expect(prodatCharacteristicValue('306', semantic)).toBe('Z12')
  })

  it('ENV-08: P-profile minutes are fixed UTC+1 all year (no DST)', () => {
    expect(prodatMarketMinuteToUtc(line.contractStartDate)).toBe('2026-11-14T23:00:00.000Z')
    expect(prodatMarketMinuteToUtc('202607010000')).toBe('2026-06-30T23:00:00.000Z')
  })

  it('stored mail-parser projection keeps the same object, references and every CCI/CAV code', () => {
    const stored = parseEdifactPayload(z04.raw)
    expect(stored).toMatchObject({ messageFamily: 'PRODAT', messageCode: 'Z04', senderEdielId: '60000', receiverEdielId: '40000', applicationReference: '23-DDQ-PRODAT' })
    expect(stored.lineGroups).toHaveLength(1)
    expect(stored.lineGroups[0]).toMatchObject({ lineNumber: '1', itemId: '735123456789051435',
      references: { MG: ['METER-1'], Z05: ['TES'], LI: ['LI9B13B11F12D6402A9DCF7AB03A02536C'] },
      cciCavCodes: { Z13: ['Z22'], Z04: ['Z04'], Z07: ['Z12'], Z12: ['D'], Z15: ['Z32'], Z14: ['L639Q'] } })
    expect(stored.dates).toMatchObject({ 137: [expect.stringMatching(/^\d{12}$/)], ZZZ: ['1'], 92: ['202611150000'], 354: ['15'] })
  })
})

// Grid owner masterdata update (Z06) with two objects, a custom UNA (component ';', element '*', decimal ',',
// release '#', terminator '!'), escaped service characters inside names and references, and ÅÄÖ.
const Z06_SEGMENTS = [
  'UNB*UNOC;3*16700;14*40000;14*261022;1200*Z06IC1**23-DDQ-PRODAT****1',
  'UNH*1*PRODAT;D;97A;UN;E2SE6A', 'BGM*Z06*Z06DOC0001*9*AB', 'DTM*137;202610221100;203', 'DTM*ZZZ;1;805',
  'NAD*FR*16700;160;SVK*******SE', 'NAD*DO*40000;160;SVK*******SE',
  'LIN*1**735999000000000017;;;9', 'DTM*157;202607010000;203', 'QTY*31;4500;KWH',
  'CCI**Z13', 'CAV*Z37', 'CCI**Z04', 'CAV*Z05', 'CCI**Z15', 'CAV*Z32', 'CCI**Z07', 'CAV*Z11', 'CCI**Z12', 'CAV*;;;D', 'CCI**Z14', 'CAV*;;;L639Q',
  'RFF*MG;MÄTARE#*1', 'RFF*Z05;ALS', 'RFF*LI;Z06LI0001',
  'NAD*UD*199001011234;SE2;260**Åsa#;s;Öberg#!*Ängsvägen 1;c/o Ärlig;Lgh 1102*Älmhult**34331*SE',
  'NAD*IT*735999000000000017;;9***Storgatan 5*Växjö**35230*SE',
  'NAD*Z02*99876;160;SVK*******SE',
  'LIN*2**735999000000000024;;;9', 'DTM*157;202612010000;203',
  'CCI**Z13', 'CAV*Z37', 'CCI**Z04', 'CAV*Z04', 'CCI**Z15', 'CAV*Z31',
  'RFF*Z05;ALS', 'RFF*LI;Z06LI0002',
  'NAD*UD*5566778899;SE1;260**Företaget ## AB****21120*SE',
  'NAD*Z02*88888;160;SVK*******SE',
]
const Z06 = 'UNA;*,# !' + [...Z06_SEGMENTS, `UNT*${Z06_SEGMENTS.length}*1`, 'UNZ*1*Z06IC1'].join('!') + '!'

describe('J4 PRODAT Z06 (masterdata, two objects, custom UNA) — no field leaks between objects', () => {
  const parsed = parseProdatMessage(Z06)
  it('header', () => {
    expect(parsed).toMatchObject({ messageCode: 'Z06', messageReference: 'Z06DOC0001', interchangeReference: 'Z06IC1', messageDate: '202610221100',
      timezoneOffset: '1', legalSenderId: '16700', legalReceiverId: '40000' })
    expect(parsed.lineItems).toHaveLength(2)
    expect(parsedProdatObjects(parsed).map(o => o.meteringPointId)).toEqual(['735999000000000017', '735999000000000024'])
  })

  const EXPECTED: Array<Record<string, unknown>> = [
    { lineSequenceNumber: '1', meteringPointId: '735999000000000017', identityAgency: '9', validityStartDate: '202607010000', annualConsumption: '4500',
      reasonForTransaction: 'Z37', measuringMethod: 'Z05', reportingFrequency: 'D', timeSeriesProduct: 'L639Q', meterNumber: 'MÄTARE*1',
      gridAreaId: 'ALS', lineItemReference: 'Z06LI0001', endUserId: '199001011234', endUserIdQualifier: 'SE2',
      endUserNameLines: ['Åsa;s', 'Öberg!'], endUserName: 'Åsa;s\nÖberg!',
      endUserAddressLines: ['Ängsvägen 1', 'c/o Ärlig', 'Lgh 1102'], endUserAddress: 'Ängsvägen 1\nc/o Ärlig\nLgh 1102',
      endUserCity: 'Älmhult', endUserPostcode: '34331', endUserCountry: 'SE',
      installationId: '735999000000000017', installationAddress: 'Storgatan 5', installationCity: 'Växjö', installationPostcode: '35230', installationCountry: 'SE',
      balanceResponsibleId: '99876', contractStartDate: null, contractEndDate: null },
    { lineSequenceNumber: '2', meteringPointId: '735999000000000024', identityAgency: '9', validityStartDate: '202612010000', annualConsumption: null,
      reasonForTransaction: 'Z37', measuringMethod: 'Z04', reportingFrequency: null, timeSeriesProduct: null, meterNumber: null,
      gridAreaId: 'ALS', lineItemReference: 'Z06LI0002', endUserId: '5566778899', endUserIdQualifier: 'SE1',
      endUserName: 'Företaget # AB', endUserAddress: null, endUserCity: null, endUserPostcode: '21120', endUserCountry: 'SE',
      installationId: null, installationAddress: null, balanceResponsibleId: '88888' },
  ]
  EXPECTED.forEach((expected, index) => {
    it(`object ${index + 1}`, () => expect(parsed.lineItems[index]).toMatchObject(expected))
  })

  it('254/306 per object, and validity starts converted with the fixed UTC+1 offset', () => {
    const wire = tokenizeEdifact(Z06)
    const lin = wire.segments.flatMap((s, i) => s.tag === 'LIN' ? [i] : [])
    const first = wire.segments.slice(lin[0], lin[1]), second = wire.segments.slice(lin[1])
    expect([prodatCharacteristicValue('254', first, wire.una), prodatCharacteristicValue('254', second, wire.una)]).toEqual(['Z32', 'Z31'])
    expect([prodatCharacteristicValue('306', first, wire.una), prodatCharacteristicValue('306', second, wire.una)]).toEqual(['Z11', null])
    expect(prodatMarketMinuteToUtc(parsed.lineItems[0].validityStartDate)).toBe('2026-06-30T23:00:00.000Z')
    expect(prodatMarketMinuteToUtc(parsed.lineItems[1].validityStartDate)).toBe('2026-11-30T23:00:00.000Z')
  })

  it('stored mail-parser projection: custom UNA header and per-object groups', () => {
    const stored = parseEdifactPayload(Z06)
    expect(stored).toMatchObject({ messageFamily: 'PRODAT', messageCode: 'Z06', bgmReference: 'Z06DOC0001', senderEdielId: '16700', receiverEdielId: '40000',
      interchangeReference: 'Z06IC1', applicationReference: '23-DDQ-PRODAT', messageTypeVersion: { syntaxIdentifier: 'UNOC', associationAssignedCode: 'E2SE6A' } })
    expect(stored.parties).toMatchObject({ FR: ['16700'], DO: ['40000'], UD: ['199001011234', '5566778899'], Z02: ['99876', '88888'], IT: ['735999000000000017'] })
    expect(stored.lineGroups.map(g => [g.itemId, g.references, g.cciCavCodes])).toEqual([
      ['735999000000000017', { MG: ['MÄTARE*1'], Z05: ['ALS'], LI: ['Z06LI0001'] }, { Z13: ['Z37'], Z04: ['Z05'], Z07: ['Z11'], Z12: ['D'], Z15: ['Z32'], Z14: ['L639Q'] }],
      ['735999000000000024', { Z05: ['ALS'], LI: ['Z06LI0002'] }, { Z13: ['Z37'], Z04: ['Z04'], Z15: ['Z31'] }],
    ])
    expect(stored.quantities).toEqual([{ qualifier: '31', rawValue: '4500', value: 4500, unit: 'KWH' }])
  })
})

describe('J4 PRODAT Z05 (old supplier informed of supply end) — end date, reason and identity', () => {
  const segments = [
    "UNB+UNOC:3+16700:14+40000:14+261022:1200+Z05IC1++23-DDQ-PRODAT++++1", 'UNH+1+PRODAT:D:97A:UN:E2SE6A', 'BGM+Z05+Z05DOC0001+9+AB',
    'DTM+137:202610221100:203', 'DTM+ZZZ:1:805', 'NAD+FR+16700:160:SVK+++++++SE', 'NAD+DO+40000:160:SVK+++++++SE',
    'LIN+1++735999000000000031:::9', 'DTM+93:202608010000:203', 'CCI++Z13', 'CAV+E03', 'RFF+Z05:ALS', 'RFF+LI:Z05LI0001',
    "NAD+UD+194512241234:SE2:260++Göran O?'Hara:d.y.+Kvarngränd 2?+3+Åre++83013+SE", 'NAD+Z02+99876:160:SVK+++++++SE',
  ]
  const raw = "UNA:+.? '" + [...segments, `UNT+${segments.length}+1`, 'UNZ+1+Z05IC1'].join("'") + "'"
  it('every field', () => {
    const parsed = parseProdatMessage(raw)
    expect(parsed).toMatchObject({ messageCode: 'Z05', messageReference: 'Z05DOC0001', legalSenderId: '16700', legalReceiverId: '40000' })
    expect(parsed.lineItems).toHaveLength(1)
    expect(parsed.lineItems[0]).toMatchObject({ meteringPointId: '735999000000000031', contractEndDate: '202608010000', contractStartDate: null,
      reasonForTransaction: 'E03', gridAreaId: 'ALS', lineItemReference: 'Z05LI0001', endUserId: '194512241234',
      endUserNameLines: ["Göran O'Hara", 'd.y.'], endUserAddressLines: ['Kvarngränd 2+3'], endUserCity: 'Åre', endUserPostcode: '83013', balanceResponsibleId: '99876' })
    // Supply ends at 00:00 UTC+1 on 1 August, i.e. 31 July 23:00Z (01:00 CEST): never 22:00Z.
    expect(prodatMarketMinuteToUtc(parsed.lineItems[0].contractEndDate)).toBe('2026-07-31T23:00:00.000Z')
  })
})
