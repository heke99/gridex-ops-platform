// Inbound files for reality scenario J4 (parse conformance): realistic counterparty wire with the EDIFACT mechanics a
// parser must get exactly right — custom UNA, release characters, ÅÄÖ in ISO-8859-1 (UNOC), decimal comma, signed and
// quality-flagged quantities, two metering points or objects per message, negative APERAK with ERC/FTX per object,
// CONTRL with UCM/UCS/UCD positions. Every builder also returns the EXPECTED parse, written from the guide positions
// (masterplan ENV-01/02/08, ACK-01/02/10, U §3.7, P26.A field matrix), never taken from the platform's parser.
// Pure functions, no database, no network. Synthetic data only (example.invalid, E2E names).
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { originalAckLegalNadSegment, originalAckPartyIdentities } from '@/lib/ediel/core/originalAckPartyIdentities'
import { escapeEdifactData } from '@/lib/ediel/core/una'
import { readReceivedRequest, replyEnvelope } from './rejectsWire'

export type J4File = {
  key: string
  /** The interchange text and the exact bytes on the wire (ISO-8859-1 for UNOC). */
  edifact: string
  bytes: Buffer
  /** MIME Content-Type of the attachment, as the counterparty labels it (possibly wrongly). */
  contentType: string
  interchangeReference: string
  /** What inbound_ediel_parse_results.parsed_payload must contain (subset match). */
  expectedParse: Record<string, unknown>
  /** Open defect that makes this file fail until its patch lands (reported, not hidden). */
  openDefect?: string
}

/** The e-mail a grid owner sends for one file: one attachment, exactly `file.bytes`, base64, labelled with `file.contentType`. */
export function j4MailOptions(input: { from: string; to: string; file: J4File; run: string }) {
  return { from: input.from, to: input.to, subject: `J4 ${input.file.key} ${input.file.interchangeReference}`, text: 'Ediel',
    messageId: `<j4-${input.run}-${input.file.key.toLowerCase()}@example.invalid>`,
    attachments: [{ filename: `${input.file.key}.edi`, content: input.file.bytes, contentType: input.file.contentType, contentTransferEncoding: 'base64' as const }] }
}

/** P-profile document time: fixed UTC+1 all year (ENV-08). */
export function prodatMinuteNow(now = new Date()) {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 16).replace(/[-T:]/g, '')
}

const latin1 = (text: string) => Buffer.from(text, 'latin1')

/**
 * The interchange's lane. 'test' (the default) carries the UNB test indicator 0035=1; 'production' omits it, as
 * live-chain-wire dailyE66 does. A tenant live in production receives production files (FINDINGS T7). The
 * correlated answers below copy the lane of our own original (replyEnvelope), so they take no option.
 */
export type J4Lane = 'production' | 'test'
const isTest = (environment: J4Lane | undefined) => environment !== 'production'

/**
 * UTILTS E66 with UNA component ';', element '*', decimal ',', release '#', terminator '!': two metering points (two
 * IDE), quarter-hour and hourly, values with decimal comma, a negative value, quality 56 (estimated) and 46, MWH.
 */
export function e66TwoPoints(input: { issuer: string; receiver: string; reference: string; meters: [string, string]; gridArea: string; environment?: J4Lane }): J4File {
  const [a, b] = input.meters
  const segments = [
    `UNB*UNOC;3*${input.issuer};ZZ*${input.receiver};ZZ*261022;0600*${input.reference}**23-DDQ-E66-T${isTest(input.environment) ? '****1' : ''}`,
    'UNH*1*UTILTS;D;02B;UN;E5SE5A', `BGM*E66;;260*M${input.reference}*9*AB`, 'DTM*137;202610220600;203', 'DTM*735;#+0100;406', 'MKS*23*E02;;260',
    `NAD*MS*${input.issuer};SVK;260`, `NAD*MR*${input.receiver};SVK;260`,
    `IDE*24*TA${input.reference}`, `LOC*172*${a};;9`, `LOC*239*${input.gridArea};SVK;260`, 'LIN***8716867000030;;;9',
    'DTM*324;202610200000202610200100;719', 'DTM*597;202610220600;203', 'DTM*354;15;806', 'STS*7**E88;;260', 'MEA*AAZ**KWH',
    'SEQ**1', 'QTY*136;0,125', 'SEQ**2', 'QTY*136;-1,5', 'STS*8*56', 'SEQ**3', 'QTY*136;12', 'STS*8*46', 'SEQ**4', 'QTY*136;0,0010',
    `IDE*24*TB${input.reference}`, `LOC*172*${b};;9`, `LOC*239*${input.gridArea};SVK;260`, 'LIN***8716867000030;;;9',
    'DTM*324;202610200000202610200100;719', 'DTM*597;202610220600;203', 'DTM*354;60;806', 'STS*7**E88;;260', 'MEA*AAZ**MWH',
    'SEQ**1', 'QTY*136;1,000001',
  ]
  const count = segments.length - 1 + 1
  const edifact = 'UNA;*,# !' + [...segments, `UNT*${count}*1`, `UNZ*1*${input.reference}`].join('!') + '!'
  return { key: 'U-E66-two-points', edifact, bytes: latin1(edifact), contentType: 'application/EDIFACT', interchangeReference: input.reference,
    expectedParse: {
      messageFamily: 'UTILTS', messageCode: 'E66', bgmReference: `M${input.reference}`, messageFunctionCode: '9', acknowledgementRequestCode: 'AB',
      senderEdielId: input.issuer, receiverEdielId: input.receiver, interchangeReference: input.reference, applicationReference: '23-DDQ-E66-T',
      messageTypeVersion: { syntaxIdentifier: 'UNOC', directoryVersion: 'D', release: '02B', controllingAgency: 'UN', associationAssignedCode: 'E5SE5A' },
      quantities: [
        { qualifier: '136', rawValue: '0,125', value: 0.125, unit: null }, { qualifier: '136', rawValue: '-1,5', value: -1.5, unit: null },
        { qualifier: '136', rawValue: '12', value: 12, unit: null }, { qualifier: '136', rawValue: '0,0010', value: 0.001, unit: null },
        { qualifier: '136', rawValue: '1,000001', value: 1.000001, unit: null }],
      dates: { 137: ['202610220600'], 735: ['+0100'], 324: ['202610200000202610200100', '202610200000202610200100'], 597: ['202610220600', '202610220600'], 354: ['15', '60'] },
      locations: { 172: [a, b], 239: [input.gridArea, input.gridArea] },
    } }
}

const OBJ1_NAME = ['Åsa;s', 'Öberg!'] as const
const OBJ1_STREET = ['Ängsvägen 1', 'c/o Ärlig', 'Lgh 1102'] as const

/**
 * PRODAT Z06 (grid-owner masterdata) with two objects. `una: 'custom'` uses UNA ;*,# ! (escaped ';', '!' and '*' inside
 * names/references); `una: 'default'` the standard advice. ÅÄÖ are ISO-8859-1 bytes (UNOC).
 */
export function z06TwoObjects(input: { issuer: string; receiver: string; reference: string; meters: [string, string]; gridArea: string; una: 'custom' | 'default';
  contentType?: string; key?: string; openDefect?: string; environment?: J4Lane }): J4File {
  const custom = input.una === 'custom'
  const c = custom ? ';' : ':', e = custom ? '*' : '+', t = custom ? '!' : "'", r = custom ? '#' : '?'
  const esc = (value: string) => value.replace(new RegExp(`[${[c, e, t, r].map(x => `\\${x}`).join('')}]`, 'g'), m => r + m)
  const [a, b] = input.meters
  const segments = [
    ['UNB', `UNOC${c}3`, `${input.issuer}${c}ZZ`, `${input.receiver}${c}ZZ`, `261022${c}1200`, input.reference, '', '23-DDQ-PRODAT', ...(isTest(input.environment) ? ['', '', '', '1'] : [])],
    ['UNH', '1', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A'].join(c)], ['BGM', 'Z06', `D${input.reference}`, '9', 'AB'],
    ['DTM', `137${c}202610221100${c}203`], ['DTM', `ZZZ${c}1${c}805`],
    ['NAD', 'FR', `${input.issuer}${c}160${c}SVK`, '', '', '', '', '', '', 'SE'], ['NAD', 'DO', `${input.receiver}${c}160${c}SVK`, '', '', '', '', '', '', 'SE'],
    ['LIN', '1', '', `${a}${c}${c}${c}9`], ['DTM', `157${c}202607010000${c}203`], ['QTY', `31${c}4500${c}KWH`],
    ['CCI', '', 'Z13'], ['CAV', 'E34'], ['CCI', '', 'Z04'], ['CAV', 'Z05'], ['CCI', '', 'Z15'], ['CAV', 'Z32'], ['CCI', '', 'Z12'], ['CAV', `${c}${c}${c}D`],
    ['RFF', `MG${c}${esc('MÄTARE*1;!')}`], ['RFF', `Z05${c}${input.gridArea}`], ['RFF', `LI${c}LI1${input.reference}`],
    ['NAD', 'UD', `199001011234${c}SE2${c}260`, '', OBJ1_NAME.map(esc).join(c), OBJ1_STREET.map(esc).join(c), 'Älmhult', '', '34331', 'SE'],
    ['NAD', 'Z02', `99876${c}160${c}SVK`, '', '', '', '', '', '', 'SE'],
    ['LIN', '2', '', `${b}${c}${c}${c}9`], ['DTM', `157${c}202612010000${c}203`],
    ['CCI', '', 'Z13'], ['CAV', 'E34'], ['CCI', '', 'Z04'], ['CAV', 'Z04'], ['CCI', '', 'Z15'], ['CAV', 'Z31'],
    ['RFF', `Z05${c}${input.gridArea}`], ['RFF', `LI${c}LI2${input.reference}`],
    ['NAD', 'UD', `5566778899${c}SE1${c}260`, '', esc('Företaget #?+ AB'), '', '', '', '21120', 'SE'],
    ['NAD', 'Z02', `88888${c}160${c}SVK`, '', '', '', '', '', '', 'SE'],
  ].map(parts => parts.join(e))
  const body = [...segments, ['UNT', String(segments.length - 1 + 1), '1'].join(e), ['UNZ', '1', input.reference].join(e)]
  const edifact = (custom ? `UNA${c}${e},${r} ${t}` : "UNA:+.? '") + body.join(t) + t
  return { key: input.key ?? `P-Z06-${input.una}`, edifact, bytes: latin1(edifact), contentType: input.contentType ?? 'application/EDIFACT',
    interchangeReference: input.reference, openDefect: input.openDefect,
    expectedParse: {
      messageFamily: 'PRODAT', messageCode: 'Z06', bgmReference: `D${input.reference}`, senderEdielId: input.issuer, receiverEdielId: input.receiver,
      interchangeReference: input.reference, applicationReference: '23-DDQ-PRODAT',
      parties: { FR: [input.issuer], DO: [input.receiver], UD: ['199001011234', '5566778899'], Z02: ['99876', '88888'] },
      lineGroups: [
        { lineNumber: '1', itemId: a, references: { MG: ['MÄTARE*1;!'], Z05: [input.gridArea], LI: [`LI1${input.reference}`] },
          cciCavCodes: { Z13: ['E34'], Z04: ['Z05'], Z12: ['D'], Z15: ['Z32'] } },
        { lineNumber: '2', itemId: b, references: { Z05: [input.gridArea], LI: [`LI2${input.reference}`] }, cciCavCodes: { Z13: ['E34'], Z04: ['Z04'], Z15: ['Z31'] } },
      ],
      dates: { 137: ['202610221100'], ZZZ: ['1'], 157: ['202607010000', '202612010000'] },
    } }
}

/** The decoded names/addresses of Z06 object 1, for comparing the stored raw text and the PRODAT projection. */
export const Z06_OBJECT1 = { nameLines: [...OBJ1_NAME], addressLines: [...OBJ1_STREET], city: 'Älmhult', business: 'Företaget #?+ AB' }

/** Whole-message rejection of a document we never sent (unlinked), FTX ending in an escaped release character. */
export function unlinkedHeaderAperak(input: { issuer: string; receiver: string; reference: string; acknowledgedDocument: string; environment?: J4Lane }): J4File & { text: string } {
  const text = "Meddelandehuvudet kunde inte läsas: UNB?+UNH, kontakta 'driften' på +46 8 000 00 00?"
  const segments = [
    `UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+261022:1200+${input.reference}++23-DDQ-PRODAT${isTest(input.environment) ? '++++1' : ''}`,
    'UNH+1+APERAK:D:96A:UN:E2SE6A', 'BGM+++27', `DTM+137:${prodatMinuteNow()}:203`, `RFF+ACW:${escapeEdifactData(input.acknowledgedDocument)}`,
    `NAD+FR+${input.issuer}:160:SVK+++++++SE`, `NAD+DO+${input.receiver}:160:SVK+++++++SE`, 'ERC+40::260', `FTX+AAO++102::260+${escapeEdifactData(text)}`,
  ]
  const edifact = "UNA:+.? '" + [...segments, `UNT+${segments.length}+1`, `UNZ+1+${input.reference}`].join("'") + "'"
  return { key: 'A-APERAK-27-unlinked', text, edifact, bytes: latin1(edifact), contentType: 'application/EDIFACT', interchangeReference: input.reference,
    expectedParse: { messageFamily: 'APERAK', messageCode: 'APERAK', messageFunctionCode: '27', senderEdielId: input.issuer, receiverEdielId: input.receiver,
      interchangeReference: input.reference, errorCodes: ['40'], freeText: [text], references: { ACW: [input.acknowledgedDocument] },
      applicationErrors: [{ errorCode: '40', freeTextCode: '102', text, references: {} }],
      canonicalAck: { family: 'APERAK', profile: 'PRODAT_16_B', outcome: 'negative', code: '40', reason: null } } }
}

/** CONTRL with ISO action 8 ("received"): not an Ediel result (ACK-01: 1 or 4), must go to manual review as invalid. */
export function contrlAction8(input: { issuer: string; receiver: string; reference: string; acknowledgedInterchange: string; environment?: J4Lane }): J4File {
  const segments = [`UNB+UNOC:3+${input.issuer}:ZZ+${input.receiver}:ZZ+261022:1200+${input.reference}${isTest(input.environment) ? '++++++1' : ''}`, 'UNH+1+CONTRL:2:2:UN:EDIEL2',
    `UCI+${input.acknowledgedInterchange}+${input.receiver}:ZZ+${input.issuer}:ZZ+8`]
  const edifact = "UNA:+.? '" + [...segments, `UNT+${segments.length}+1`, `UNZ+1+${input.reference}`].join("'") + "'"
  return { key: 'C-CONTRL-8-unlinked', edifact, bytes: latin1(edifact), contentType: 'application/EDIFACT', interchangeReference: input.reference,
    expectedParse: { messageFamily: 'CONTRL', messageCode: 'CONTRL', interchangeReference: input.reference,
      references: { UCI: [input.acknowledgedInterchange], UCI_ACTION: ['8'] }, errorCodes: [],
      canonicalAck: { family: 'CONTRL', outcome: 'invalid', code: '8', reason: 'contrl_uci_action_invalid:8' } } }
}

/** Facts of OUR sent PRODAT (Z01/Z03) as the grid owner reads them. */
export function ourOriginal(raw: string) {
  const facts = readReceivedRequest(raw)
  const wire = tokenizeEdifact(raw)
  const unb = wire.segments.find(s => s.tag === 'UNB')!, unh = wire.segments.find(s => s.tag === 'UNH')!
  return { ...facts, unbSender: segmentComposite(unb, 2, wire.una), unbReceiver: segmentComposite(unb, 3, wire.una),
    messageReference: segmentComposite(unh, 1, wire.una)[0], messageType: segmentComposite(unh, 2, wire.una) }
}

/**
 * The free text of the correlated object rejection: every UNOC service character plus ÅÄÖ, ending in '?'. It keeps
 * the guide's ERC 42 form "Felaktigt <field name> <received content>" (a colon right after the field name was refused
 * by the platform's guide check ACK_PRODAT_INVALID_TEXT_INVALID, FINDINGS T41).
 */
export const OBJECT_REJECTION_TEXT = "Felaktigt Kund-id 'Åsa Öberg' (Ä): 19XX? + fel postnr?"

/** Object rejection (BGM 34, ERC 42 / field 227) of our own sent PRODAT, with the text above correctly escaped. */
export function correlatedObjectRejection(raw: string): J4File {
  const o = ourOriginal(raw)
  if (!o.lineItemReference) throw Error('j4_original_line_item_reference_missing')
  const parties = originalAckPartyIdentities({ rawPayload: raw, expectedFamily: 'PRODAT' })
  const edifact = replyEnvelope(raw, 'APERAK:D:96A:UN:E2SE6A', ['BGM+++34', `DTM+137:${prodatMinuteNow()}:203`, `RFF+ACW:${escapeEdifactData(o.document)}`,
    originalAckLegalNadSegment('FR', parties.legalReceiver), originalAckLegalNadSegment('DO', parties.legalSender),
    'ERC+42::260', `FTX+AAO++227::260+${escapeEdifactData(OBJECT_REJECTION_TEXT)}`,
    ...(o.facility ? [`RFF+Z07:${escapeEdifactData(o.facility)}`] : []), `RFF+LI:${escapeEdifactData(o.lineItemReference)}`])
  const reference = EdifactEnvelopeCodec.decode(edifact).interchangeReference!
  return { key: 'A-APERAK-34-correlated', edifact, bytes: latin1(edifact), contentType: 'application/EDIFACT', interchangeReference: reference,
    expectedParse: { messageFamily: 'APERAK', messageFunctionCode: '34', senderEdielId: o.gridOwner, receiverEdielId: o.supplier, errorCodes: ['42'],
      freeText: [OBJECT_REJECTION_TEXT], references: { ACW: [o.document], LI: [o.lineItemReference], ...(o.facility ? { Z07: [o.facility] } : {}) },
      applicationErrors: [{ errorCode: '42', freeTextCode: '227', text: OBJECT_REJECTION_TEXT,
        references: { ...(o.facility ? { Z07: [o.facility] } : {}), LI: [o.lineItemReference] } }],
      canonicalAck: { family: 'APERAK', profile: 'PRODAT_16_B', outcome: 'negative', code: '42', reason: null } } }
}

/** Negative CONTRL of our own sent PRODAT at message level with a segment and a data-element error. */
export function correlatedDetailedContrl(raw: string): J4File {
  const o = ourOriginal(raw)
  const edifact = replyEnvelope(raw, 'CONTRL:2:2:UN:EDIEL2', [
    `UCI+${escapeEdifactData(o.interchange.slice(0, 14))}+${o.unbSender.map(v => escapeEdifactData(v)).join(':')}+${o.unbReceiver.map(v => escapeEdifactData(v)).join(':')}+4`,
    `UCM+${escapeEdifactData(o.messageReference)}+${o.messageType.join(':')}+4+13`, 'UCS+5', 'UCD+12+2:1'])
  const reference = EdifactEnvelopeCodec.decode(edifact).interchangeReference!
  return { key: 'C-CONTRL-4-correlated', edifact, bytes: latin1(edifact), contentType: 'application/EDIFACT', interchangeReference: reference,
    expectedParse: { messageFamily: 'CONTRL', messageCode: 'CONTRL', senderEdielId: o.gridOwner, receiverEdielId: o.supplier,
      references: { UCI: [o.interchange.slice(0, 14)], UCI_ACTION: ['4'], UCM: [o.messageReference], UCM_ACTION: ['4'] }, errorCodes: ['13', '12'],
      contrlErrors: [
        { level: 'message', code: '13', messageReference: o.messageReference, segmentPosition: null, elementPosition: null, componentPosition: null },
        { level: 'segment', code: null, messageReference: o.messageReference, segmentPosition: '5', elementPosition: null, componentPosition: null },
        { level: 'data_element', code: '12', messageReference: o.messageReference, segmentPosition: '5', elementPosition: '2', componentPosition: '1' }],
      canonicalAck: { family: 'CONTRL', outcome: 'negative', code: '4', reason: null } } }
}
