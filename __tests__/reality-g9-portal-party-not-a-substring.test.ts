// reality-defects: G-9
// G-9 (reality F run 32): 22 of 123 production E66 were never resumed by the held-UTILTS cron; every one of them was
// classified as an Ediel-portal test message (TGT) and skipped as notOperational. isEdielPortalUtiltsE66TgtMessage
// looked for the portal's party id 91100 anywhere in the message text, and found it inside quarter-hour timestamps
// (202609091100, 202609110000). With the E66 application reference 23-DDQ-E66-T the production file counted as TGT.
// 0 of the 101 stored files contained the substring; 22 of 22 unstored ones did.
import { describe, expect, it } from 'vitest'
import { isEdielPortalUtiltsE66TgtMessage } from '@/lib/ediel/ack'
import { resolveUtiltsRuntimeReplyDispatch } from '@/lib/ediel/utilts/utiltsRuntimeReplyDispatch'
import type { EdielMessageRow } from '@/lib/ediel/types'

const wire = (sender: string, receiver: string, nad = '') => [
  `UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+260910:0700+260909239840++23-DDQ-E66-T`,
  'UNH+1+UTILTS:D:02B:UN:E5SE5A', 'BGM+E66::260+M260909239840+9+AB',
  'DTM+137:202609100700:203', 'DTM+324:202609090000202609100000:719',
  ...(nad ? [`NAD+MS+${nad}::260`] : []),
  'DTM+163:202609091100:203', 'QTY+136:0.312', 'DTM+163:202609110000:203', 'QTY+136:0.288',
  'UNT+10+1', 'UNZ+1+260909239840',
].join("'") + "'"

const message = (extra: Partial<EdielMessageRow>): EdielMessageRow => ({
  id: 'e66', company_id: 'co', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', environment: 'production', test_flag: 0,
  sender_ediel_id: '16700', receiver_ediel_id: '70006', application_reference: '23-DDQ-E66-T',
  raw_payload: wire('16700', '70006'), parsed_payload: { dates: { 163: ['202609091100', '202609110000'] } }, ...extra,
} as EdielMessageRow)

describe('G-9 the Ediel portal party is a party, never a substring of the message', () => {
  it('a production grid-owner E66 whose timestamps contain 91100 is not a portal TGT and is resumed operationally', () => {
    const source = message({})
    expect(isEdielPortalUtiltsE66TgtMessage(source)).toBe(false)
    expect(resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source })).toEqual({ dispatch: 'operational_outbox', reason: 'production_lane' })
  })

  it('a message from or to the portal party is still a TGT reference', () => {
    expect(isEdielPortalUtiltsE66TgtMessage(message({ sender_ediel_id: '91100', raw_payload: wire('91100', '70006') }))).toBe(true)
    expect(isEdielPortalUtiltsE66TgtMessage(message({ receiver_ediel_id: '91100' }))).toBe(true)
    expect(isEdielPortalUtiltsE66TgtMessage(message({ sender_ediel_id: null, raw_payload: wire('91100', '70006') } as never))).toBe(true)
    expect(isEdielPortalUtiltsE66TgtMessage(message({ raw_payload: wire('16700', '70006', '91100') }))).toBe(true)
    expect(isEdielPortalUtiltsE66TgtMessage(message({ environment: 'test', test_flag: 1, sender_ediel_id: '91100' }))).toBe(true)
  })

  it('without the TGT application reference the portal party alone is not a TGT', () => {
    expect(isEdielPortalUtiltsE66TgtMessage(message({ sender_ediel_id: '91100', application_reference: '23-DDQ-E66', raw_payload: wire('91100', '70006').replace('23-DDQ-E66-T', '23-DDQ-E66'), parsed_payload: {} }))).toBe(false)
  })
})
