// reality-defects: J1-01, J1-02, J1-03
// Owner decisions 35 (J1-01: ERC 42 field 210), 36 (J1-02: ERC 42 field 226; 40/105 and 40/107 kept apart) and 37
// (J1-03 / ACK-09: case duplicate 40/104). The native normal-Z04 owner's own hold reasons become the grid owner's
// negative APERAK through the real projection (normalZ04HoldAnswer) and the real P34 renderer (buildAckDraftForSource);
// every other hold keeps the existing hold-for-review path without a reply. Codes verified against
// docs/ediel/masterplan-v2/annex/source_tables.json (P26.A pp90–93) and annex/B_PRODAT_falt_och_villkor.md.
// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import { isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import { normalZ04HoldAnswer, NORMAL_Z04_HOLD_RESPONSES } from '@/lib/ediel/flows/normalZ04HoldResponse'
import type { SupplyObjectPartition } from '@/lib/ediel/flows/supplyMarketTransition'
import type { EdielMessageRow } from '@/lib/ediel/types'

const POINT = '735999000000000123', OTHER = '735999000000000456', LI = 'LICASE0001', LI2 = 'LICASE0002'
function object(point: string, li: string, line: number, start = '202612040000') {
  return [`LIN+${line}++${point}:::9`, `DTM+92:${start}:203`, 'DTM+354:15:806', 'QTY+31:1000:KWH', 'CCI++Z13', 'CAV+Z22', 'CCI++Z04', 'CAV+Z04',
    'CCI++Z07', 'CAV+Z12', 'CCI++Z12', 'CAV+:::D', 'CCI++Z15', 'CAV+Z32', 'CCI++Z14', 'CAV+:::L639Q', 'CCI++Z02', 'CAV+:::1', 'CCI++Z05', 'CAV+:::6',
    'CCI++Z16', 'CAV+:::101', 'RFF+MG:METER-1', 'RFF+Z05:TES', `RFF+LI:${li}`, 'NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE',
    `NAD+IT+${point}::9+++Street+Town++12345+SE`, 'NAD+Z02+99876:160:SVK+++++++SE']
}
function z04(objects: string[][], code = 'Z04') {
  const body = ['UNH+MSG1+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOC0001+9+AB`, 'DTM+137:202609171200:203', 'DTM+ZZZ:1:805',
    'NAD+FR+60109:160:SVK+++++++SE', 'NAD+DO+40110:160:SVK+++++++SE', ...objects.flat()]
  return `UNA:+.? 'UNB+UNOC:3+60109:ZZ+40110:ZZ+261028:1701+ICREF1++23-DDQ-PRODAT++1++1'${[...body, `UNT+${body.length + 1}+MSG1`].join("'")}'UNZ+1+ICREF1'`
}
const held = (point: string, line: number, segmentIndex: number, reason: string): SupplyObjectPartition => ({ disposition: 'held', reason,
  object: { messageIndex: 0, messageReference: 'MSG1', objectId: point, identityAgency: '9', registers: [{ lineIndex: line, segmentIndex, lineNumber: String(line + 1), registerIndex: null, registerPosition: 1 }] } })
const one = z04([object(POINT, LI, 1)])
const row = (raw: string, code = 'Z04') => ({ id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002', environment: 'test',
  direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: code, raw_payload: raw, sender_ediel_id: '60109', receiver_ediel_id: '40110',
  external_reference: 'ICREF1', message_received_at: '2026-10-28T16:01:17.000Z', created_at: '2026-10-28T16:01:17.000Z', parsed_payload: {} }) as unknown as EdielMessageRow
const aperakWire = (raw: string, answer: NonNullable<ReturnType<typeof normalZ04HoldAnswer>>) =>
  String(buildAckDraftForSource({ sourceMessage: row(raw), ackFamily: 'APERAK', outcome: 'negative', applicationErrors: answer.applicationErrors }).rawPayload).split("'")

describe('the native owner\'s own Z04 holds become the prescribed negative APERAK', () => {
  it('J1-01 a start-date conflict is ERC 42 on field 210 (Avtal, startdatum) for that object, with its Z07 and LI', () => {
    const answer = normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_start_date_conflict')] })!
    expect(answer.applicationErrors).toEqual([expect.objectContaining({ ercCode: '42', fieldCode: '210', text: 'Felaktigt Avtal, startdatum 202612040000',
      referenceQualifier: 'Z07', referenceNumber: POINT, lineItemReference: LI })])
    expect(answer.applicationErrors.every(isQualifiedProdatApplicationError)).toBe(true)
    expect(answer.holds).toEqual([{ reason: 'normal_z04_start_date_conflict', objectId: POINT, lineItemReference: LI, followUp: 'start_date_conflict' }])
    const wire = aperakWire(one, answer)
    expect(wire).toEqual(expect.arrayContaining(['BGM+++34', 'ERC+42::260', 'FTX+AAO++210::260+Felaktigt Avtal, startdatum 202612040000', `RFF+Z07:${POINT}`, `RFF+LI:${LI}`]))
    expect(wire.some(segment => segment.startsWith('ERC+100'))).toBe(false)
  })

  it('J1-02 a Z04 without an own Z03 is ERC 42 on field 226 only (never also 209)', () => {
    const answer = normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_own_z03_missing')] })!
    expect(answer.applicationErrors.map(e => [e.ercCode, e.fieldCode, e.text])).toEqual([['42', '226', `Felaktigt Ärendereferens ${LI}`]])
    expect(answer.holds[0].followUp).toBe('without_own_z03')
    const wire = aperakWire(one, answer)
    expect(wire.filter(segment => segment.startsWith('FTX+AAO'))).toEqual([`FTX+AAO++226::260+Felaktigt Ärendereferens ${LI}`])
    expect(wire.some(segment => segment.includes('209::260'))).toBe(false)
  })

  for (const [reason, code, text] of [['normal_z04_object_not_identified', '105', 'Anläggningen kan inte identifieras'],
    ['normal_z04_actor_not_related', '107', 'Aktören är inte knuten till aktuell anläggning'],
    ['normal_z04_case_duplicate', '104', 'Liknande meddelande mottaget tidigare']] as const) {
    it(`${reason} is ERC 40 with national code ${code}, kept apart from the others`, () => {
      const answer = normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(POINT, 0, 7, reason)] })!
      expect(answer.applicationErrors).toEqual([expect.objectContaining({ ercCode: '40', fieldCode: code, text, referenceNumber: POINT, lineItemReference: LI })])
      expect(answer.applicationErrors.every(isQualifiedProdatApplicationError)).toBe(true)
      const wire = aperakWire(one, answer)
      expect(wire).toEqual(expect.arrayContaining(['ERC+40::260', `FTX+AAO++${code}::260+${text}`, `RFF+Z07:${POINT}`, `RFF+LI:${LI}`]))
      expect(answer.holds[0].followUp).toBe(reason === 'normal_z04_case_duplicate' ? null : 'without_own_z03')
    })
  }

  it('two objects with their own holds get one error each, each on its own object', () => {
    const two = z04([object(POINT, LI, 1), object(OTHER, LI2, 2, '202612050000')])
    const answer = normalZ04HoldAnswer({ rawPayload: two, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_start_date_conflict'), held(OTHER, 1, 35, 'normal_z04_own_z03_missing')] })!
    expect(answer.applicationErrors.map(e => [e.fieldCode, e.referenceNumber, e.lineItemReference])).toEqual([['210', POINT, LI], ['226', OTHER, LI2]])
    const wire = aperakWire(two, answer)
    expect(wire.filter(segment => segment.startsWith('RFF+LI:'))).toEqual([`RFF+LI:${LI}`, `RFF+LI:${LI2}`])
  })
})

describe('every other hold keeps the hold-for-review path (no reply invented)', () => {
  for (const reason of ['normal_z04_exact_sent_original_required', 'normal_z04_locked_original_scope_required', 'normal_z04_owned_signed_contract_scope_required',
    'supply_original_cohort_changed', 'own_application_not_accepted',
    // Z04A (Z26) for a verified assignment has its own owner and holds; the own-Z03 requirement never applies to it.
    'regulated_supply_current_ground_required', 'regulated_supply_authentic_ground_required'])
    it(`${reason}: no answer`, () => {
      expect(Object.hasOwn(NORMAL_Z04_HOLD_RESPONSES, reason)).toBe(false)
      expect(normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(POINT, 0, 7, reason)] })).toBeNull()
    })

  it('a partly applied or partly otherwise held source gets no owner-hold answer', () => {
    const two = z04([object(POINT, LI, 1), object(OTHER, LI2, 2)])
    const applied: SupplyObjectPartition = { ...held(OTHER, 1, 35, 'x'), disposition: 'applied', effectReceiptId: '00000000-0000-4000-8000-000000000009', effectFactsHash: 'a'.repeat(64) } as SupplyObjectPartition
    expect(normalZ04HoldAnswer({ rawPayload: two, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_start_date_conflict'), applied] })).toBeNull()
    expect(normalZ04HoldAnswer({ rawPayload: two, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_start_date_conflict'), held(OTHER, 1, 35, 'normal_z04_exact_sent_original_required')] })).toBeNull()
  })

  it('a held object that is not exactly the original\'s object, another message code or no partition gets no answer', () => {
    expect(normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(OTHER, 0, 7, 'normal_z04_start_date_conflict')] })).toBeNull()
    expect(normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [held(POINT, 1, 7, 'normal_z04_start_date_conflict')] })).toBeNull()
    expect(normalZ04HoldAnswer({ rawPayload: z04([object(POINT, LI, 1)], 'Z05'), messageCode: 'Z05', partition: [held(POINT, 0, 7, 'normal_z04_start_date_conflict')] })).toBeNull()
    expect(normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: null })).toBeNull()
    expect(normalZ04HoldAnswer({ rawPayload: one, messageCode: 'Z04', partition: [] })).toBeNull()
  })

  it('a text the national field cannot carry (over 70 characters) is held instead of truncated', () => {
    const long = 'LI' + 'X'.repeat(48)
    const raw = z04([object(POINT, long, 1)])
    expect(normalZ04HoldAnswer({ rawPayload: raw, messageCode: 'Z04', partition: [held(POINT, 0, 7, 'normal_z04_own_z03_missing')] })).toBeNull()
  })
})
