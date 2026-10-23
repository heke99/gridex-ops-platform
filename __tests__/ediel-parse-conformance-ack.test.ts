// reality-defects: J4, T15 parse conformance — negative APERAK (BGM 27/34, ERC/FTX per object, RFF correlation) and CONTRL (UCI/UCM/UCS/UCD)
//
// Inbound acknowledgements are built the way a grid owner builds them (scripts/helpers/reality/rejectsWire.ts and
// hand-written counterparty wire), parsed by the real mail parser, classified by the canonical ACK classifier and
// correlated to our original by the physical source correlation. Expectations come from the guides (masterplan
// ACK-01/ACK-02/ACK-03/ACK-06/ACK-10, P26.A §3.3 p93, ISO 9735 CONTRL), never from the parser's own output.
// Synthetic data only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { qualifyInboundAckSourceCandidates, readPhysicalAckSourceCorrelation } from '@/lib/ediel/ack/sourceCorrelation'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { REJECTION_CODES, contrlFor, headerRejectionAperakFor, objectRejectionAperakFor, positiveAperakFor, readReceivedRequest, replyEnvelope,
  syntaxRejectionContrlFor, type RejectionReason } from '../scripts/helpers/reality/rejectsWire'

// Our outbound Z03 (supplier 40000 -> grid owner 60000), the platform's own approved fixture.
const Z03 = readFileSync('scripts/reality/fixtures-z03-normal-switch.edi', 'utf8')
const Z03_DOCUMENT = 'Z03A83F4FC061744569861961F75A1373F7'
const Z03_INTERCHANGE = 'DCFE9CBEC2EE69'
const Z03_LI = 'LI9B13B11F12D6402A9DCF7AB03A02536C'
const Z03_FACILITY = '735123456789051435'

const outbound = (raw: string, id = 'source-1') => ({ id, company_id: 'company-1', environment: 'test', direction: 'outbound', raw_payload: raw,
  message_family: 'PRODAT', message_sent_at: '2026-10-20T12:38:00Z' })
const inbound = (raw: string, family: string) => ({ id: 'ack-1', company_id: 'company-1', environment: 'test', direction: 'inbound', raw_payload: raw, message_family: family })

/** Our Z03 with a second object (another facility, another LI), as one PRODAT message. */
const SECOND_FACILITY = '735123456789051442'
const SECOND_LI = 'LI2SECONDOBJECT0000000000000000002'
function twoObjectZ03() {
  const lines = Z03.split("'")
  const lin = lines.findIndex(s => s.startsWith('LIN+'))
  const unt = lines.findIndex(s => s.startsWith('UNT+'))
  const object = lines.slice(lin, unt)
  const second = object.map(s => s.replace('LIN+1', 'LIN+2').replace(Z03_FACILITY, SECOND_FACILITY).replace(Z03_LI, SECOND_LI))
  const body = [...lines.slice(0, unt), ...second]
  const count = body.length - body.findIndex(s => s.startsWith('UNH+')) + 1
  return [...body, `UNT+${count}+1`, ...lines.slice(unt + 1)].join("'")
}

describe('J4 APERAK — object rejection (BGM 34): every field where the guide puts it', () => {
  const facts = readReceivedRequest(Z03)
  const reasons = Object.keys(REJECTION_CODES) as RejectionReason[]
  for (const reason of reasons) {
    it(reason, () => {
      const rule = REJECTION_CODES[reason]
      const raw = objectRejectionAperakFor(Z03, reason)
      const parsed = parseEdifactPayload(raw)
      // Envelope mirrored: the grid owner is the sender.
      expect(parsed).toMatchObject({ messageFamily: 'APERAK', messageCode: 'APERAK', messageFunctionCode: '34', senderEdielId: '60000', receiverEdielId: '40000',
        applicationReference: '23-DDQ-PRODAT', messageTypeVersion: { directoryVersion: 'D', release: '96A', controllingAgency: 'UN', associationAssignedCode: 'E2SE6A' } })
      // ACK-02: ACW points at our BGM document id; the object is identified by its own RFF+Z07 and our LI.
      expect(parsed.references.ACW).toEqual([Z03_DOCUMENT])
      expect(parsed.references.LI).toEqual([Z03_LI])
      expect(parsed.references.Z07).toEqual([Z03_FACILITY])
      expect(parsed.parties).toMatchObject({ FR: ['60000'], DO: ['40000'] })
      // ERC/9321 and the national FTX/C107 code + C108 text belong to the same object.
      expect(parsed.errorCodes).toEqual([rule.erc])
      expect(parsed.freeText).toEqual([rule.text(facts)])
      expect(parsed.applicationErrors).toEqual([{ errorCode: rule.erc, freeTextCode: rule.code, text: rule.text(facts), references: { Z07: [Z03_FACILITY], LI: [Z03_LI] } }])
      expect(classifyCanonicalInboundAck(parsed)).toEqual({ family: 'APERAK', profile: 'PRODAT_16_B', outcome: 'negative', code: rule.erc, reason: null })
      // Correlation: exactly our Z03, at object level, negative for that object.
      const qualified = qualifyInboundAckSourceCandidates({ ackMessage: inbound(raw, 'APERAK'), candidates: [outbound(Z03)] })
      expect(qualified).toMatchObject({ status: 'unique', candidateIds: ['source-1'], correlation: { scope: 'object', acknowledgedReferences: [Z03_LI],
        lookupReferences: [{ type: 'BGM_REF', value: Z03_DOCUMENT }, { type: 'RFF_LI', value: Z03_LI }], scopedOutcomes: [{ reference: Z03_LI, outcome: 'negative' }] } })
      const physical = readPhysicalAckSourceCorrelation(inbound(raw, 'APERAK'), outbound(Z03))
      expect(physical.prodatObjectOutcomes).toEqual([{ objectId: Z03_FACILITY, identityAgency: '9', firstLineIndex: expect.any(Number), lineItemReference: Z03_LI, outcome: 'negative' }])
      expect(physical.wholeSourceOutcome).toBeUndefined()
    })
  }
})

describe('J4 APERAK — whole-message rejection (BGM 27) and positive (BGM 34 / ERC 100)', () => {
  it('BGM+++27 with ERC 40 / FTX 102: whole source negative, message scope, no object', () => {
    const raw = headerRejectionAperakFor(Z03, new Date('2026-10-22T10:00:00Z'))
    const parsed = parseEdifactPayload(raw)
    expect(parsed).toMatchObject({ messageFunctionCode: '27', errorCodes: ['40'], freeText: ['Meddelandehuvudet kunde inte läsas'], references: { ACW: [Z03_DOCUMENT] } })
    expect(parsed.applicationErrors).toEqual([{ errorCode: '40', freeTextCode: '102', text: 'Meddelandehuvudet kunde inte läsas', references: {} }])
    // 10:00Z in Ediel fixed normal time +0100 (ENV-08; formerly Stockholm local 12:00, J4-H1, T15).
    expect(parsed.dates['137']).toEqual(['202610221100'])
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'negative', code: '40', profile: 'PRODAT_16_B' })
    const physical = readPhysicalAckSourceCorrelation(inbound(raw, 'APERAK'))
    expect(physical).toMatchObject({ scope: 'message', acknowledgedReferences: [], wholeSourceOutcome: 'negative' })
  })

  it('BGM 27 can never carry ERC 100 (ACK-02): invalid, not positive', () => {
    const raw = replyEnvelope(Z03, 'APERAK:D:96A:UN:E2SE6A', ['BGM+++27', `RFF+ACW:${Z03_DOCUMENT}`, 'ERC+100::260', 'FTX+AAO+++OK'])
    expect(classifyCanonicalInboundAck(parseEdifactPayload(raw))).toMatchObject({ outcome: 'invalid', reason: 'prodat_aperak_whole_message_result_conflict' })
  })

  it('positive APERAK: ERC 100 + FTX OK per object', () => {
    const parsed = parseEdifactPayload(positiveAperakFor(Z03))
    expect(parsed).toMatchObject({ messageFunctionCode: '34', errorCodes: ['100'], freeText: ['OK'] })
    expect(parsed.applicationErrors).toEqual([{ errorCode: '100', freeTextCode: null, text: 'OK', references: { Z07: [Z03_FACILITY], LI: [Z03_LI] } }])
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'positive', code: '100' })
  })

  const INVALID_FUNCTION = [
    { bgm: 'BGM+++9', reason: 'prodat_aperak_bgm_function_invalid:9' },
    { bgm: 'BGM+312', reason: 'prodat_aperak_bgm_function_invalid:missing' },
  ]
  for (const row of INVALID_FUNCTION) {
    it(`PRODAT APERAK ${row.bgm} is invalid, never read as UTILTS 312/313`, () => {
      const raw = replyEnvelope(Z03, 'APERAK:D:96A:UN:E2SE6A', [row.bgm, `RFF+ACW:${Z03_DOCUMENT}`, 'ERC+40::260'])
      expect(classifyCanonicalInboundAck(parseEdifactPayload(raw))).toMatchObject({ outcome: 'invalid', reason: row.reason })
    })
  }
})

describe('J4 APERAK — two objects in one message: each ERC group keeps its own result', () => {
  it('object 1 accepted (ERC 100), object 2 rejected (ERC 42 / field 210) with escaped text', () => {
    const source = twoObjectZ03()
    const text = "Felaktigt Avtal, startdatum 20261115: välj 1:a vardag? Ring 'kundtjänst' +46"
    const escaped = text.replace(/([?:+'])/g, '?$1')
    const raw = replyEnvelope(source, 'APERAK:D:96A:UN:E2SE6A', ['BGM+++34', 'DTM+137:202610221200:203', `RFF+ACW:${Z03_DOCUMENT}`,
      'NAD+FR+60000:160:SVK+++++++SE', 'NAD+DO+40000:160:SVK+++++++SE',
      'ERC+100::260', 'FTX+AAO+++OK', `RFF+Z07:${Z03_FACILITY}`, `RFF+LI:${Z03_LI}`,
      'ERC+42::260', `FTX+AAO++210::260+${escaped}`, `RFF+Z07:${SECOND_FACILITY}`, `RFF+LI:${SECOND_LI}`])
    const parsed = parseEdifactPayload(raw)
    expect(parsed.errorCodes).toEqual(['100', '42'])
    expect(parsed.freeText).toEqual(['OK', text])
    expect(parsed.applicationErrors).toEqual([
      { errorCode: '100', freeTextCode: null, text: 'OK', references: { Z07: [Z03_FACILITY], LI: [Z03_LI] } },
      { errorCode: '42', freeTextCode: '210', text, references: { Z07: [SECOND_FACILITY], LI: [SECOND_LI] } },
    ])
    // Whole-message classification: processed message with one rejected object.
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'negative', code: '100,42' })
    const physical = readPhysicalAckSourceCorrelation(inbound(raw, 'APERAK'), outbound(source))
    expect(physical.scopedOutcomes).toEqual([{ reference: Z03_LI, outcome: 'positive' }, { reference: SECOND_LI, outcome: 'negative' }])
    expect(physical.prodatObjectOutcomes?.map(o => [o.objectId, o.lineItemReference, o.outcome])).toEqual([
      [Z03_FACILITY, Z03_LI, 'positive'], [SECOND_FACILITY, SECOND_LI, 'negative']])
  })

  it('an APERAK naming an LI we never sent does not correlate to our Z03', () => {
    const raw = replyEnvelope(Z03, 'APERAK:D:96A:UN:E2SE6A', ['BGM+++34', `RFF+ACW:${Z03_DOCUMENT}`, 'NAD+FR+60000:160:SVK+++++++SE', 'NAD+DO+40000:160:SVK+++++++SE',
      'ERC+40::260', 'FTX+AAO++105::260+Anläggningen kan inte identifieras', `RFF+Z07:${Z03_FACILITY}`, 'RFF+LI:LI-NOT-OURS'])
    expect(qualifyInboundAckSourceCandidates({ ackMessage: inbound(raw, 'APERAK'), candidates: [outbound(Z03)] })).toMatchObject({ status: 'unresolved', candidateIds: [] })
  })
})

describe('J4 CONTRL — action codes and error positions', () => {
  it('positive CONTRL (UCI 0083 = 1) refers to our interchange and both parties', () => {
    const parsed = parseEdifactPayload(contrlFor(Z03, 'positive'))
    expect(parsed).toMatchObject({ messageFamily: 'CONTRL', messageCode: 'CONTRL', senderEdielId: '60000', receiverEdielId: '40000',
      references: { UCI: [Z03_INTERCHANGE], UCI_ACTION: ['1'] }, errorCodes: [] })
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ family: 'CONTRL', outcome: 'positive', code: '1' })
  })

  it('negative CONTRL (UCI 0083 = 4) from the national CONTRL engine correlates at interchange level', () => {
    const raw = syntaxRejectionContrlFor(Z03)
    const parsed = parseEdifactPayload(raw)
    expect(parsed.references).toMatchObject({ UCI: [Z03_INTERCHANGE], UCI_ACTION: ['4'] })
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'negative', code: '4' })
    expect(qualifyInboundAckSourceCandidates({ ackMessage: inbound(raw, 'CONTRL'), candidates: [outbound(Z03)] })).toMatchObject({
      status: 'unique', correlation: { scope: 'interchange', acknowledgedReferences: [Z03_INTERCHANGE], wholeSourceOutcome: 'negative' } })
  })

  it('message, segment and data-element errors keep their level, action and positions (J4-D3/J4-D4, fixed)', () => {
    const raw = replyEnvelope(Z03, 'CONTRL:2:2:UN:EDIEL2', [
      `UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+4`,
      'UCM+1+PRODAT:D:97A:UN:E2SE6A+4+13',
      'UCS+9', 'UCD+12+2:1',
      'UCS+17+35',
    ])
    const parsed = parseEdifactPayload(raw)
    expect(parsed.references).toMatchObject({ UCI: [Z03_INTERCHANGE], UCI_ACTION: ['4'], UCM: ['1'], UCM_ACTION: ['4'] })
    // 0085 codes only; a segment position (UCS 9) is never an error code.
    expect(parsed.errorCodes).toEqual(['13', '12', '35'])
    expect(parsed.contrlErrors).toEqual([
      { level: 'message', code: '13', messageReference: '1', segmentPosition: null, elementPosition: null, componentPosition: null },
      { level: 'segment', code: null, messageReference: '1', segmentPosition: '9', elementPosition: null, componentPosition: null },
      { level: 'data_element', code: '12', messageReference: '1', segmentPosition: '9', elementPosition: '2', componentPosition: '1' },
      { level: 'segment', code: '35', messageReference: '1', segmentPosition: '17', elementPosition: null, componentPosition: null },
    ])
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'negative', code: '4' })
  })

  it('interchange-level syntax error (UCI 0085) is stored as an interchange error', () => {
    const parsed = parseEdifactPayload(replyEnvelope(Z03, 'CONTRL:2:2:UN:EDIEL2', [`UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+4+18`]))
    expect(parsed.errorCodes).toEqual(['18'])
    expect(parsed.contrlErrors).toEqual([{ level: 'interchange', code: '18', messageReference: null, segmentPosition: null, elementPosition: null, componentPosition: null }])
  })

  // ACK-01: Ediel CONTRL uses 0083 = 1 or 4 only. ISO codes 7 (acknowledged unless rejected) and 8 (received) are
  // not Ediel results and must go to manual review, never become positive or negative silently.
  const INVALID = [
    { uci: `UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+7`, reason: 'contrl_uci_action_invalid:7' },
    { uci: `UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+8`, reason: 'contrl_uci_action_invalid:8' },
    { uci: `UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ`, reason: 'contrl_uci_action_missing' },
  ]
  for (const row of INVALID) {
    it(`${row.uci.split('+').slice(4).join('+') || 'no action'} -> invalid (${row.reason})`, () => {
      expect(classifyCanonicalInboundAck(parseEdifactPayload(replyEnvelope(Z03, 'CONTRL:2:2:UN:EDIEL2', [row.uci])))).toMatchObject({ outcome: 'invalid', reason: row.reason })
    })
  }

  it('two UCI with conflicting actions -> invalid', () => {
    const parsed = parseEdifactPayload(replyEnvelope(Z03, 'CONTRL:2:2:UN:EDIEL2', [`UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+1`, `UCI+${Z03_INTERCHANGE}+40000:ZZ+60000:ZZ+4`]))
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ outcome: 'invalid', reason: 'contrl_uci_action_conflicting' })
  })
})

describe('J4 UTILTS APERAK (ACK-03) — BGM/1001 312 positive, 313 negative', () => {
  const utiltsAperak = (code: string, erc: string, text: string) => [
    "UNA:+.? '", 'UNB+UNOC:3+16700:14+40000:14+261022:1200+UA1++23-DDQ-E66-T++++1\'', 'UNH+1+APERAK:D:04A:UN:E5SE5A\'',
    `BGM+${code}+APK1+9'`, 'DTM+137:202610221200:203\'', 'DOC+E66+M260901000001\'', 'RFF+ACW:T260901000001\'',
    `ERC+${erc}::260'`, `FTX+AAO+++${text}'`, 'UNT+8+1\'', 'UNZ+1+UA1\'',
  ].join('')
  it('313 with ERC 42 INCORRECT DATA: negative, DOC and ACW kept', () => {
    const parsed = parseEdifactPayload(utiltsAperak('313', '42', 'INCORRECT DATA 516'))
    expect(parsed).toMatchObject({ messageCode: '313', bgmReference: 'APK1', errorCodes: ['42'], freeText: ['INCORRECT DATA 516'],
      references: { DOC_E66: ['M260901000001'], ACW: ['T260901000001'] } })
    expect(classifyCanonicalInboundAck(parsed)).toMatchObject({ profile: 'UTILTS_25_A', outcome: 'negative', code: '313' })
  })
  it('312 with ERC 100 OK: positive', () => {
    expect(classifyCanonicalInboundAck(parseEdifactPayload(utiltsAperak('312', '100', 'OK')))).toMatchObject({ profile: 'UTILTS_25_A', outcome: 'positive', code: '312' })
  })
})
