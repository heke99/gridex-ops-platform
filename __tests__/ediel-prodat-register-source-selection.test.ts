import { describe, expect, it } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { EdielTgtDynamicTestDataSummary } from '@/lib/ediel/testing/tgtTestDataStore'
import {
  effectiveTgtTestCaseCodeForMessageRow, fieldValuesFromTgtTestData, facilityIdsFromTgtTestData,
  findBestTgtTestDataForMessage, findExactTgtTestDataForMessage, inferTgtTestCaseCodeForInboundTestData,
  messageCodePrefixesForTgtAutoMatch, rawTextHasSourceMessageMarker, scoreTgtTestDataForMessage,
  sourceMessageMarker, textForTgtAutoMatch, tgtRawTextHasSameNewAndOldMeterNumber,
  tgtRawTextLooksLikeZ10MeterChangeButMissingConstant, tgtTestDataHasSameNewAndOldMeterNumber, tgtTestDataLooksLikeConstantMissing,
} from '@/lib/ediel/testing/tgtAutoMatcher'
import { raw, line, characteristic } from './fixtures/prodat-register'
const facility = '735999888000000017'
function source(fields: Record<string, string>, code = 'Z10'): EdielTgtCaseTestData {
  const columns = [{ name: code, index: 1, testCase: 'synthetic' }]
  const rows = Object.entries(fields).map(([fieldCode, value]) => ({ fieldCode, fieldName: fieldCode, values: { [code]: value } }))
  return { suite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'synthetic', title: 'Synthetic', sourceNote: 'Unit test, no portal approval', groups: [
    { columns, fields: rows, block: { kind: 'PRODAT', sourceWorkbook: 'test', sourceSheet: 'test', entityLabel: 'A', entityNumbers: ['1'], columns, fields: rows } },
  ] }
}
function message(code = 'Z10', extra: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return { id: 'source-a', message_family: 'PRODAT', message_code: code, direction: 'inbound', raw_payload: raw([line('1', facility),
    ...characteristic('Z02', '1', 3), ...characteristic('Z03', '6', 2), ['RFF', 'MG:NEW'], ['RFF', 'Z10:OLD']], code), ...extra } as EdielMessageRow
}
function candidate(code: string, fields: Record<string, string> = {}, extra: Partial<EdielTgtDynamicTestDataSummary> = {}): EdielTgtDynamicTestDataSummary {
  return { id: `candidate-${code}`, testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: code, title: 'Synthetic source', sourceNote: '', rawText: '',
    parsedPayload: source(fields), updatedAt: '2026-09-18T01:00:00Z', updatedBy: null, ...extra }
}

describe('source selection around actual PRODAT register cases', () => {
  it('accepts a registered multi-register Z04 step even when its case falls outside old prefix heuristics', () => {
    const msg = message('Z04', { direction: 'outbound' })
    const registered = candidate('1.2.5', { '209': facility }, { parsedPayload: source({ '209': facility }, 'Z04') })
    expect(scoreTgtTestDataForMessage(msg, registered)).toBeGreaterThanOrEqual(0)
    expect(findBestTgtTestDataForMessage(msg, [registered])).toBe(registered)
  })
  it('keeps another message family and an unrelated case out of the candidate list', () => {
    expect(findBestTgtTestDataForMessage(message(), [candidate('2.1.1'), candidate('2.3.1', {}, { testSuite: 'UTILTS' })])).toBeNull()
    expect(scoreTgtTestDataForMessage({ ...message(), message_family: 'CONTRL' }, candidate('2.3.1'))).toBe(-1)
  })
  it('ranks matching installation data ahead of unrelated data and uses recency only as tie-breaker', () => {
    const same = candidate('2.3.1', { '209': facility, '214': '1', '224': 'NEW', '225': 'OLD' })
    const other = candidate('2.3.1', { '209': '735999888000000024', '214': '1', '224': 'NEW', '225': 'OLD' }, { id: 'other', updatedAt: '2026-09-20' })
    expect(scoreTgtTestDataForMessage(message(), same)).toBeGreaterThan(scoreTgtTestDataForMessage(message(), other))
    expect(findBestTgtTestDataForMessage(message(), [other, same])).toBe(same)
    const recent = { ...same, id: 'recent', updatedAt: '2026-09-21' }
    const input = [same, recent]
    expect(findBestTgtTestDataForMessage(message(), input)).toBe(recent)
    expect(input).toEqual([same, recent])
  })
  it('requires an exact source marker, not another identifier with this ID as a prefix', () => {
    expect(rawTextHasSourceMessageMarker(sourceMessageMarker('source-a-extra'), 'source-a')).toBe(false)
  })
  it.each(['GRIDCORE_SOURCE_MESSAGE_ID:', 'GridCore source_message_id=', 'source_message_id='])('recognizes %s markers without broadening exact-match search to unmarked rows', prefix => {
    const marked = candidate('2.3.1', { '209': facility }, { rawText: `${prefix}source-a\nother source text` })
    const unmarked = { ...marked, id: 'unmarked', rawText: '', updatedAt: '2026-09-22' }
    expect(findExactTgtTestDataForMessage(message(), [unmarked, marked])).toBe(marked)
    expect(findExactTgtTestDataForMessage(message(), [unmarked])).toBeNull()
    expect(rawTextHasSourceMessageMarker(null, 'source-a')).toBe(false)
    expect(rawTextHasSourceMessageMarker(marked.rawText, 'source-b')).toBe(false)
  })
  it('matches source-note markers and rejects marked data for the wrong message function', () => {
    const wrong = candidate('2.1.1', {}, { sourceNote: sourceMessageMarker('source-a') })
    const right = candidate('2.3.1', {}, { sourceNote: sourceMessageMarker('source-a') })
    expect(findExactTgtTestDataForMessage(message(), [wrong, right])).toBe(right)
    expect(findExactTgtTestDataForMessage(message(), [wrong])).toBeNull()
  })
  it('extracts all requested field values without converting non-GS1 identity text into GS1 identifiers', () => {
    const td = source({ '209': facility, '233': ` ${facility} `, '224': 'M-1' })
    expect(fieldValuesFromTgtTestData(td, ['209', '233'])).toEqual([facility])
    expect(facilityIdsFromTgtTestData(td)).toEqual([facility])
    expect(facilityIdsFromTgtTestData(source({ '209': 'local:A' }))).toEqual([])
    expect(fieldValuesFromTgtTestData(undefined, ['209'])).toEqual([])
    expect(fieldValuesFromTgtTestData(td, ['missing'])).toEqual([])
  })
  it('preserves metadata only as search text, not a passing register-validation decision', () => {
    const text = textForTgtAutoMatch(message('Z04', { external_reference: 'external', transaction_reference: 'transaction',
      interchange_reference: 'interchange', original_transaction_id: 'original', original_message_code: 'Z03',
      parsed_payload: { reference: 'parsed' }, validation_report: { note: 'diagnostic' } }))
    for (const value of ['EXTERNAL', 'TRANSACTION', 'INTERCHANGE', 'ORIGINAL', 'Z03', 'PARSED', 'DIAGNOSTIC']) expect(text).toContain(value)
  })
  it.each([
    ['Z03', ['1.2', '1.3']], ['Z04', ['1.4', '1.5']], ['Z06', ['2.1', '2.2']], ['Z10', ['2.3', '2.4']],
    ['Z09', ['2.5']], ['Z05', ['3.1', '3.2']], ['Z13', ['8.1']], ['Z14', ['8.1', '8.2']], ['Z15', ['9.1', '9.2']], ['Z18', ['9.1']], ['Z99', []],
  ])('retains %s coarse search hints without using them to reject registered steps', (code, prefixes) => {
    expect(messageCodePrefixesForTgtAutoMatch(message(code as string))).toEqual(prefixes)
  })
  it.each([['Z13', 'E3'], ['Z14', 'E5'], ['Z15', 'E7'], ['Z18', 'E8']])('keeps DGI hints for %s in the permission flow', (code, prefix) => {
    expect(messageCodePrefixesForTgtAutoMatch(message(code, { application_reference: 'ignored', raw_payload: '23-DGI-PRODAT' }))).toContain(prefix)
  })
  it.each([['Z09F', '2.5.1'], ['Z09G', '2.5.2'], ['Z09D', '2.5.3']])('uses explicit %s source context for suggestion only', (text, code) => {
    expect(effectiveTgtTestCaseCodeForMessageRow(message('Z09'), candidate('AUTO', {}, { rawText: text }))).toBe(code)
    expect(inferTgtTestCaseCodeForInboundTestData({ message: message('Z09'), rawText: text })).toBe(code)
  })
  it('honors compatible explicit case text/fallback and ignores unrelated fallback case', () => {
    expect(inferTgtTestCaseCodeForInboundTestData({ message: message(), rawText: '', fallback: '2.3.2' })).toBe('2.3.2')
    expect(inferTgtTestCaseCodeForInboundTestData({ message: message(), rawText: 'Case 2.3.2', fallback: 'AUTO' })).toBe('2.3.2')
    expect(inferTgtTestCaseCodeForInboundTestData({ message: message(), rawText: '', fallback: '2.1.1' })).toBe('2.3.1')
    expect(effectiveTgtTestCaseCodeForMessageRow(message(), candidate('AUTO', {}, { rawText: 'Case 2.3.2' }))).toBe('2.3.2')
  })
  it('distinguishes new and old meter numbers within one source column', () => {
    expect(tgtTestDataHasSameNewAndOldMeterNumber(source({ '224': 'NEW', '225': 'OLD' }))).toBe(false)
    expect(tgtTestDataHasSameNewAndOldMeterNumber(source({ '224': 'M-1', '225': 'M-1 (old)' }))).toBe(true)
    expect(tgtTestDataHasSameNewAndOldMeterNumber(null)).toBe(false)
    expect(tgtTestDataHasSameNewAndOldMeterNumber(source({ '224': 'NEW' }))).toBe(false)
    expect(tgtRawTextHasSameNewAndOldMeterNumber('224\tM-1\n225\tM-1')).toBe(true)
    expect(tgtRawTextHasSameNewAndOldMeterNumber('224\tM-1\n225\tM-2')).toBe(false)
    expect(tgtRawTextHasSameNewAndOldMeterNumber(undefined)).toBe(false)
  })
  it('distinguishes missing-constant source hints from an explicit constant', () => {
    expect(tgtTestDataLooksLikeConstantMissing(null)).toBe(false)
    expect(tgtTestDataLooksLikeConstantMissing(source({ '224': 'M-1' }))).toBe(true)
    expect(tgtTestDataLooksLikeConstantMissing(source({ '224': 'M-1', '214': '1' }))).toBe(false)
    expect(tgtRawTextLooksLikeZ10MeterChangeButMissingConstant('224\tM-1')).toBe(true)
    expect(tgtRawTextLooksLikeZ10MeterChangeButMissingConstant('224\tM-1\n214\t1')).toBe(false)
    expect(tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(undefined)).toBe(false)
  })
  it('prioritizes explicit same-meter and constant-missing diagnostics over a positive-case suggestion', () => {
    for (const [rawText, expected] of [['Samma mätarnummer', '2.4.1'], ['Konstant saknas', '2.4.2']]) {
      const row = candidate('2.3.1', {}, { rawText })
      expect(effectiveTgtTestCaseCodeForMessageRow(message(), row)).toBe(expected)
      expect(inferTgtTestCaseCodeForInboundTestData({ message: message(), rawText, fallback: '2.3.1' })).toBe(expected)
      expect(scoreTgtTestDataForMessage(message(), row)).toBeGreaterThan(0)
    }
  })
  it('uses expected field233 rather than the deliberately wrong209 for Z05 source matching', () => {
    const td = source({ '209': facility, '233': '735999888000000024' }, 'Z05')
    const row = candidate('3.1.1', {}, { parsedPayload: td })
    expect(effectiveTgtTestCaseCodeForMessageRow(message('Z05'), row)).toBe('3.2.1')
    expect(scoreTgtTestDataForMessage(message('Z05'), row)).toBeGreaterThan(0)
    expect(effectiveTgtTestCaseCodeForMessageRow(message('Z05'), candidate('AUTO', {}, { rawText: 'Z05LK' }))).toBe('3.1.2')
  })
})
