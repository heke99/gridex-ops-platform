import { describe, expect, it } from 'vitest'

import { runUtiltsRuntimeForMessage as runActualUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import type {EdielMessageRow} from '@/lib/ediel/types'

// These cases exercise the selected October guide. Automatic admission during
// Oct 1–14 may legitimately select the complete preceding guide instead.
function runOctoberGuide(message:EdielMessageRow) {
  const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:message.message_code!,direction:'inbound',
    referenceDate:'2026-10-01',applicationReference:message.application_reference,mode:'parse'})
  return runUtiltsRuntimeForMessage(message,{canonicalPolicy})
}

// These assertions concern one explicitly selected source guide. Shared
// admission's complete previous-guide grace is proved separately below.
const runUtiltsRuntimeForMessage: typeof runActualUtiltsRuntimeForMessage = (message, options) => {
  if (!options?.referenceDate || options.canonicalPolicy) return runActualUtiltsRuntimeForMessage(message, options)
  const canonical=parseCanonicalMessageRow(message)
  const referenceDate=options.referenceDate instanceof Date ? options.referenceDate.toISOString().slice(0,10) : options.referenceDate
  const canonicalPolicy = resolveCanonicalEdielPolicy({family:'UTILTS', messageCode:canonical.messageCode!, direction:message.direction, referenceDate, applicationReference:canonical.applicationReference, mode:'parse'})
  return runActualUtiltsRuntimeForMessage(message, {...options,canonicalPolicy})
}

describe('UTILTS runtime selected-guide effective-date cutoff', () => {
  it('does not borrow SG11 meter-reading DTM+597 when SG5 field 512 is absent', () => {
    const source = energyHandoffMessage('2026-10-01', 'tenant-missing-512')
    const raw_payload = recountEdifactUnt(source.raw_payload!.replace("DTM+597:202607010020:203'\n", ''))
    const runtime = runOctoberGuide({ ...source, raw_payload })
    expect(runtime.facts.transactions[0].registrationTime).toBeNull()
    expect(runtime.facts.registrationTime).toBeNull()
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '512', ercCode: '41', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  })

  it('reports supplied E66 LOC+172 identity defects as field 209 before function', () => {
    const control = observationHandoffMessage('2026-10-01', 'tenant-point209')
    for (const [replacement, ercCode] of [
      ['LOC+172+::9', '41'],
      ['LOC+172+735999260731000008::9', '42'],
      ['LOC+172+73599926073100007::9', '42'],
      ['LOC+172+735999260731000007::260', '42'],
    ] as const) {
      const raw_payload = control.raw_payload!.replace('LOC+172+735999260731000007::9', replacement)
      const runtime = runOctoberGuide({ ...control, raw_payload })
      expect(runtime.ackPlan.aperakApplicationErrors, replacement).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '209', ercCode, referenceNumber: 'GRIDEX2607E66001' }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes, replacement).toEqual([])
    }
  })
  it('does not apply October field 209 GS1 evidence to the source-unverified 25-A-3 profile', () => {
    const prior = observationHandoffMessage('2026-09-30', 'tenant-prior-point209')
    const raw_payload = prior.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000008::9')
    const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
      referenceDate: '2026-09-30', applicationReference: prior.application_reference, mode: 'parse' })
    expect(policy.guide.guideRevision).toBe('25-A-3')
    for (const options of [{ referenceDate: '2026-09-30' }, { canonicalPolicy: policy }]) {
      const runtime = runUtiltsRuntimeForMessage({ ...prior, raw_payload }, options)
      expect(runtime.validation.issues).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID' }),
      ]))
    }
  })
  it.each(['E30', 'S07'] as const)('validates a supplied %s LOC+172 at field 209 in the October guide', code => {
    const source = observationHandoffMessage('2026-10-01', `tenant-${code}-point209`)
    const rawBase = source.raw_payload!.replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : 'BGM+E30::260')
      .replace('23-DDQ-E66-S', code === 'E30' ? '23-MDR-E30-S' : '23-DDQ-S07-S')
    const raw=code==='E30' ? recountEdifactUnt(rawBase.replace("MEA+AAZ++KWH'\n",'')) : rawBase
    const message = { ...source, message_code: code,
      application_reference: code === 'E30' ? '23-MDR-E30-S' : '23-DDQ-S07-S', raw_payload: raw }
    expect(runOctoberGuide(message).validation.issues
      .some(issue => issue.aperakFieldCode === '209')).toBe(false)
    const invalid = { ...message, raw_payload: raw.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000008::9') }
    const runtime = runOctoberGuide(invalid)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '209', ercCode: '42', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  })
  it('reports a supplied invalid S01 regulating-object identity at field 533 in the October guide', () => {
    const source = observationHandoffMessage('2026-10-01', 'tenant-s01-object533')
    const raw_payload = source.raw_payload!
      .replace('BGM+E66::260', 'BGM+S01:SVK:260')
      .replace('23-DDQ-E66-S', '23-DDK-S01-S')
      .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')
    const message = { ...source, message_code: 'S01', application_reference: '23-DDK-S01-S', raw_payload }
    const runtime = runOctoberGuide(message)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '533', ercCode: '42', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  })
  it('keeps S01 field 533 scoped to the selected October guide and permits a supplied national object ID', () => {
    const source = observationHandoffMessage('2026-10-01', 'tenant-s01-object533-boundary')
    const raw = source.raw_payload!
      .replace('BGM+E66::260', 'BGM+S01:SVK:260')
      .replace('23-DDQ-E66-S', '23-DDK-S01-S')
      .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')
    const message = { ...source, message_code: 'S01', application_reference: '23-DDK-S01-S', raw_payload: raw }
    const prior = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(prior.validation.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UTILTS_REGULATING_OBJECT_GS1_CHECK_DIGIT_INVALID' }),
    ]))
    const national = runOctoberGuide({ ...message,
      raw_payload: raw.replace('LOC+175+735999260731000008::9', 'LOC+175+NATIONALOBJECT::89'),
    })
    expect(national.validation.issues.some(issue => issue.aperakFieldCode === '533')).toBe(false)
  })
  it.each([
    ['E72', '23-MDR-E30-S', 'LOC+172', '209'],
    ['E73', '23-DDQ-E66-S', 'LOC+175', '533'],
    ['S06', '23-DDK-S01-S', 'LOC+175', '533'],
  ] as const)('reports malformed supplied %s request identity per IDE', (code, applicationReference, location, fieldCode) => {
    const source = observationHandoffMessage('2026-10-01', `tenant-${code}-request-identity`)
    const raw_payload = source.raw_payload!
      .replace('BGM+E66::260', `BGM+${code}${code === 'S06' ? ':SVK' : ':'}:260`)
      .replace('23-DDQ-E66-S', applicationReference)
      .replace('LOC+172+735999260731000007::9', `${location}+735999260731000008::9`)
    const message = { ...source, message_code: code, application_reference: applicationReference, raw_payload }
    const runtime = runOctoberGuide(message)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode, ercCode: '42', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  })
  it.each([
    ['E72', '23-MDR-E30-S', 'LOC+172', '209'],
    ['E73', '23-DDQ-E66-S', 'LOC+175', '533'],
    ['S06', '23-DDK-S01-S', 'LOC+175', '533'],
  ] as const)('keeps %s supplied identity check in October and accepts national agency 89', (code, applicationReference, location, fieldCode) => {
    const source = observationHandoffMessage('2026-10-01', `tenant-${code}-request-boundary`)
    const raw = source.raw_payload!
      .replace('BGM+E66::260', `BGM+${code}${code === 'S06' ? ':SVK' : ':'}:260`)
      .replace('23-DDQ-E66-S', applicationReference)
      .replace('LOC+172+735999260731000007::9', `${location}+735999260731000008::9`)
    const message = { ...source, message_code: code, application_reference: applicationReference, raw_payload: raw }
    const prior = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(prior.validation.issues.some(issue => issue.aperakFieldCode === fieldCode && issue.code.endsWith('GS1_CHECK_DIGIT_INVALID'))).toBe(false)
    const national = runOctoberGuide({ ...message,
      raw_payload: raw.replace(`${location}+735999260731000008::9`, `${location}+NATIONALOBJECT::89`),
    })
    expect(national.validation.issues.some(issue => issue.aperakFieldCode === fieldCode)).toBe(false)
  })
  it('requires E72 LOC+172 on its own October IDE and does not borrow a sibling point', () => {
    const source = observationHandoffMessage('2026-10-01', 'tenant-e72-missing209')
    const raw = source.raw_payload!
      .replace('BGM+E66::260', 'BGM+E72::260')
      .replace('23-DDQ-E66-S', '23-MDR-E30-S')
    const lines = raw.split('\n'), start = lines.findIndex(line => line.startsWith('IDE+24+')),
      end = lines.findIndex(line => line.startsWith('UNT+'))
    const first = lines.slice(start, end).filter(line => !line.startsWith('LOC+172'))
    const second = lines.slice(start, end).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
    const joined = [...lines.slice(0, start), ...first, ...second, ...lines.slice(end)]
    joined[joined.findIndex(line => line.startsWith('UNT+'))] = `UNT+${joined.findIndex(line => line.startsWith('UNT+')) - joined.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    const message = { ...source, message_code: 'E72', application_reference: '23-MDR-E30-S', raw_payload: joined.join('\n') }
    const runtime = runOctoberGuide(message)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '209', ercCode: '41', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
    expect(runtime.ackPlan.aperakApplicationErrors.some(error => error.fieldCode === '209' && error.referenceNumber === 'GRIDEX2607E66002')).toBe(false)
  })
  it.each(['E30', 'S07'] as const)('requires %s LOC+172 on its own IDE without borrowing a sibling', code => {
    const source = observationHandoffMessage('2026-10-01', `tenant-${code}-missing209`)
    const rawBase = source.raw_payload!.replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : 'BGM+E30::260')
      .replace('23-DDQ-E66-S', code === 'E30' ? '23-MDR-E30-S' : '23-DDQ-S07-S')
    const raw=code==='E30' ? recountEdifactUnt(rawBase.replace("MEA+AAZ++KWH'\n",'')) : rawBase
    const lines = raw.split('\n'), start = lines.findIndex(line => line.startsWith('IDE+24+')),
      end = lines.findIndex(line => line.startsWith('UNT+'))
    const first = lines.slice(start, end).filter(line => !line.startsWith('LOC+172'))
    const second = lines.slice(start, end).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
    const joined = [...lines.slice(0, start), ...first, ...second, ...lines.slice(end)]
    joined[joined.findIndex(line => line.startsWith('UNT+'))] = `UNT+${joined.findIndex(line => line.startsWith('UNT+')) - joined.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    const message = { ...source, message_code: code,
      application_reference: code === 'E30' ? '23-MDR-E30-S' : '23-DDQ-S07-S', raw_payload: joined.join('\n') }
    const runtime = runOctoberGuide(message)
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '209', ercCode: '41', referenceNumber: 'GRIDEX2607E66001' }),
    ]))
    expect(runtime.ackPlan.aperakApplicationErrors.filter(issue => issue.referenceNumber === 'GRIDEX2607E66001')
      .map(issue => issue.fieldCode)).toEqual(['209'])
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
    expect(runtime.transactionDispositions[1].disposition).not.toBe('guide_rejected')
  })
  it('checks supplied per-IDE grid-area composite at 260a/b/c before E66 function', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-grid-area-guide')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    for (const [location, value, fieldCode, ercCode] of [
      ['239', 'ABCD:SVK:260', '260a', '42'], ['239', ':SVK:260', '260a', '41'],
      ['239', 'TES:BAD:260', '260a', '42'], ['239', 'TES:SVK:999', '260a', '42'],
      ['232', 'ABCD:SVK:260', '260b', '42'], ['233', 'ABCD:SVK:260', '260c', '42'],
    ] as const) {
      const raw_payload = recountEdifactUnt(location === '239'
        ? control.raw_payload!.replace('LOC+239+TES:SVK:260', `LOC+239+${value}`)
        : control.raw_payload!.replace("LOC+239+TES:SVK:260'", `LOC+239+TES:SVK:260'\nLOC+${location}+${value}'`))
      const runtime = runUtiltsRuntimeForMessage({ ...control, raw_payload }, { referenceDate: '2026-09-30' })
      expect(runtime.ackPlan.aperakApplicationErrors, `${location}/${value}`).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode, ercCode, referenceNumber: 'GRIDEX2607E66001' }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    }
  })
  it('requires LOC+232 and LOC+233 together within the same physical IDE', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-grid-area-pair')
    const withAreas = (...areas: string[]) => {
      // Own exchange areas replace the ordinary grid area (source field 260).
      const lines = control.raw_payload!.replace("LOC+239+TES:SVK:260'", areas.join('\n')).split('\n')
      lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
      return lines.join('\n')
    }
    for (const [present, missing] of [['232', '260c'], ['233', '260b']] as const) {
      const raw_payload = withAreas(`LOC+${present}+ABC:SVK:260'`)
      const runtime = runUtiltsRuntimeForMessage({ ...control, raw_payload }, { referenceDate: '2026-09-30' })
      expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
      expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: missing, ercCode: '41', referenceNumber: 'GRIDEX2607E66001' }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    }
    const paired = recountEdifactUnt(withAreas("LOC+232+ABC:SVK:260'", "LOC+233+DEF:SVK:260'").replace("LOC+239+TES:SVK:260'\n",''))
    const valid = runUtiltsRuntimeForMessage({ ...control, raw_payload: paired }, { referenceDate: '2026-09-30' })
    expect(valid.ackPlan.aperakApplicationErrors.some(issue => issue.fieldCode === '260b' || issue.fieldCode === '260c')).toBe(false)
    expect(valid.ackPlan.utiltsErrCodes,JSON.stringify(valid.validation.issues)).toContain('E19')

    const lines = withAreas("LOC+232+ABC:SVK:260'").split('\n')
    const firstIde = lines.findIndex(line => line.startsWith('IDE+24+'))
    const end = lines.findIndex(line => line.startsWith('UNT+'))
    const secondIde = lines.slice(firstIde, end).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002')
      .replace("LOC+232+ABC:SVK:260'", "LOC+233+DEF:SVK:260'"))
    lines.splice(end, 0, ...secondIde)
    lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    const separated = runUtiltsRuntimeForMessage({ ...control, raw_payload: lines.join('\n') }, { referenceDate: '2026-09-30' })
    expect(separated.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak', 'negative_aperak'])
    expect(separated.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '260c', referenceNumber: 'GRIDEX2607E66001' }),
      expect.objectContaining({ fieldCode: '260b', referenceNumber: 'GRIDEX2607E66002' }),
    ]))
    expect(separated.ackPlan.utiltsErrCodes).toEqual([])

    const planning = { ...control, message_code: 'S02', raw_payload: withAreas("LOC+232+ABC:SVK:260'")
      .replace('BGM+E66', 'BGM+S02').replace('23-DDQ-E66-S', '23-DDQ-S02-S') }
    expect(runUtiltsRuntimeForMessage(planning, { referenceDate: '2026-09-30' }).validation.issues
      .some(issue => issue.code === 'UTILTS_GRID_AREA_PAIR_MISSING')).toBe(false)
  })
  it('rejects a supplied non-24 IDE qualifier as field 505 before E66 function', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-ide505')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    const message = { ...control, raw_payload: control.raw_payload!.replace('IDE+24+', 'IDE+25+') }
    const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(runtime.validation.classification).toBe('application_rejected')
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '505', ercCode: '42' }),
    ]))
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  })
  it('rejects an omitted mandatory UNSM IDE qualifier before national field505 or application effects', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-ide505-missing')
    const message = { ...control, raw_payload: control.raw_payload!.replace('IDE+24+', 'IDE++') }
    const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(runtime.validation.syntaxOk).toBe(false)
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'syntax_rejected', responseType: 'negative_contrl' }])
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
  })
  it('keeps an invalid IDE+25 separate from a valid IDE+24 sibling', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-ide-mixed')
    const lines = control.raw_payload!.split('\n')
    const start = lines.findIndex(line => line.startsWith('IDE+24+'))
    const close = lines.findIndex(line => line.startsWith('UNT+'))
    const invalid = lines.slice(start, close).map(line => line.replace('IDE+24+GRIDEX2607E66001', 'IDE+25+GRIDEX2607E66002'))
    lines.splice(close, 0, ...invalid)
    lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    const runtime = runUtiltsRuntimeForMessage({ ...control, raw_payload: lines.join('\n') }, { referenceDate: '2026-09-30' })
    expect(runtime.facts.transactions.map(item => item.transactionId)).toEqual(['GRIDEX2607E66001', 'GRIDEX2607E66002'])
    expect(runtime.transactionDispositions.map(item => [item.transactionId, item.responseType])).toEqual([
      ['GRIDEX2607E66001', 'utilts_err'], ['GRIDEX2607E66002', 'negative_aperak'],
    ])
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '505', ercCode: '42', referenceNumber: 'GRIDEX2607E66002' }),
    ]))
  })
  it('rejects unknown subordinate header NAD role as field 509 before E66 E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-nad-role')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
      raw_payload: control.raw_payload!.replace("NAD+DDQ'", "NAD+BAD'") }
    const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '509', ercCode: '42' }),
    ]))
    expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    const plan = resolveCanonicalRuntimeDecision(message).responsePlan.find(item => item.family === 'APERAK')!
    expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
      .toContain('FTX+AAO++509::260')
    for (const role of ['DDK', 'DDQ', 'DDX', 'DEA', 'DEC', 'DER', 'DGG', 'DGI', 'EZ', 'MDR', 'PQ']) {
      const allowed = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace("NAD+DDQ'", `NAD+${role}'`) }, { referenceDate: '2026-09-30' })
      expect(allowed.ackPlan.aperakApplicationErrors.some(issue => issue.fieldCode === '509'), role).toBe(false)
    }
  })
  it('requires exactly five decimal digits for NAD MS/MR 3039 when 1131 is SVK before E66 function', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-nad-identity')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    for (const [original, replacement, fieldCode, ercCode] of [
      ['NAD+MS+91100:SVK:260', 'NAD+MS+9110A:SVK:260', '207', '42'],
      ['NAD+MR+21660:SVK:260', 'NAD+MR+216600:SVK:260', '208', '42'],
      ['NAD+MS+91100:SVK:260', 'NAD+MS+:SVK:260', '207', '41'],
    ] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace(original, replacement) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      if (ercCode === '41') {
        expect(runtime.validation.syntaxOk).toBe(false)
        expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_contrl'])
        expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
        expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
        continue
      }
      expect(runtime.transactionDispositions.map(item => item.responseType), replacement).toEqual(['negative_aperak'])
      expect(runtime.ackPlan.aperakApplicationErrors, replacement).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode, ercCode }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes, replacement).toEqual([])
    }
  })
  it('checks the GLN digit for header MS/MR with agency 9 or 305 before E66 function', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-nad-gln')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    for (const [role, agency, value, ercCode] of [
      ['MS', '9', '7359990000014', '42'],
      ['MR', '305', '7359990000014', '42'],
      ['MS', '9', '735999000001', '42'],
      ['MR', '305', '', '41'],
    ] as const) {
      const original = role === 'MS' ? 'NAD+MS+91100:SVK:260' : 'NAD+MR+21660:SVK:260'
      const message = { ...control, raw_payload: control.raw_payload!.replace(original, `NAD+${role}+${value}::${agency}`) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      if (!value) {
        expect(runtime.validation.syntaxOk).toBe(false)
        expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_contrl'])
        expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
        expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
        continue
      }
      expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: role === 'MS' ? '207' : '208', ercCode }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
    }
    for (const agency of ['9', '305']) {
      const message = { ...control, raw_payload: control.raw_payload!.replace('NAD+MS+91100:SVK:260', `NAD+MS+7359990000013::${agency}`) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(runtime.ackPlan.aperakApplicationErrors.some(item => item.fieldCode === '207')).toBe(false)
      expect(runtime.ackPlan.utiltsErrCodes).toContain('E19')
    }
  })
  it('rejects NAD MS/MR agency and conditional SVK qualifier at own field before E66 function', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-nad-guide')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    for (const [original, replacement, fieldCode, ercCode] of [
      ['NAD+MS+91100:SVK:260', 'NAD+MS+91100::260', '207', '41'],
      ['NAD+MS+91100:SVK:260', 'NAD+MS+91100:BAD:260', '207', '42'],
      ['NAD+MR+21660:SVK:260', 'NAD+MR+21660:SVK:999', '208', '42'],
      ['NAD+MR+21660:SVK:260', 'NAD+MR+21660:SVK:', '208', '41'],
    ] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace(original, replacement) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(runtime.transactionDispositions.map(item => item.responseType), replacement).toEqual(['negative_aperak'])
      expect(runtime.ackPlan.aperakApplicationErrors, replacement).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode, ercCode }),
      ]))
      expect(runtime.ackPlan.utiltsErrCodes, replacement).toEqual([])
      const plan = resolveCanonicalRuntimeDecision(message).responsePlan.find(item => item.family === 'APERAK')!
      // The fault stays source-qualified, but malformed legal actor identity
      // cannot be replaced with the row's technical sender/receiver identity.
      expect(() => buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }))
        .toThrow(/ACK_APERAK_LEGAL_PARTY_INVALID/)
    }
  })
  it('requires BGM document qualifier SVK for S07 at field 202', () => {
    const source = observationHandoffMessage('2026-09-30', 'tenant-s07-qualifier')
    const raw = source.raw_payload!.replace('BGM+E66::260', 'BGM+S07:SVK:260')
      .replace('23-DDQ-E66-S', '23-DDQ-S07-S')
    const control = { ...source, message_code: 'S07', application_reference: '23-DDQ-S07-S', raw_payload: raw }
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).validation.issues
      .some(issue => issue.aperakFieldCode === '202')).toBe(false)
    for (const [qualifier, ercCode] of [['', '41'], ['XXX', '42']] as const) {
      const message = { ...control, raw_payload: raw.replace('BGM+S07:SVK:260', `BGM+S07:${qualifier}:260`) }
      const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '202', ercCode }),
      ]))
      expect(result.transactionDispositions.every(item => item.responseType === 'negative_aperak')).toBe(true)
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
    }
  })
  it('rejects missing or invalid BGM document agency 202 before a real E66 E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-document-agency')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    for (const [agency, ercCode] of [['', '41'], ['999', '42']] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace('BGM+E66::260', `BGM+E66::${agency}`) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(runtime.validation.classification).toBe('application_rejected')
      expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '202', ercCode }),
      ]))
      expect(runtime.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected' })
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain('FTX+AAO++202::260')
    }
  })
  it('rejects a blank BGM document identifier as field 203 before a real E66 E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-document-id')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
      raw_payload: control.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', '+9+AB') }
    const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    expect(runtime.validation.classification).toBe('application_rejected')
    expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '203', ercCode: '41' }),
    ]))
    expect(runtime.ackPlan.utiltsErrDetails).toEqual([])
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected' })
    expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
    expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
      .toContain('FTX+AAO++203::260')
  })
  it('rejects missing or invalid BGM function 204 before a real E66 E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-bgm-function')
    expect(runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' }).ackPlan.utiltsErrCodes).toContain('E19')
    const allowedFive = runUtiltsRuntimeForMessage({ ...control,
      raw_payload: control.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+5+AB'),
    }, { referenceDate: '2026-09-30' })
    expect(allowedFive.validation.issues.some(issue => issue.aperakFieldCode === '204')).toBe(false)
    for (const [functionCode, ercCode] of [['', '41'], ['XX', '42']] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', `GRIDEX2607E66MSG001+${functionCode}+AB`) }
      const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(runtime.validation.classification).toBe('application_rejected')
      expect(runtime.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(runtime.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '204', ercCode }),
      ]))
      expect(runtime.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected' })
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(plan.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ fieldCode: '204', ercCode })]))
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain('FTX+AAO++204::260')
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    }
  })
  it('rejects missing, malformed or future message date 205 before E66 E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-message-date')
    const baseline = runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' })
    expect(baseline.ackPlan.utiltsErrCodes).toContain('E19')
    expect(baseline.validation.issues.some(issue => issue.aperakFieldCode === '205')).toBe(false)

    for (const [segment, ercCode] of [
      ['', '41'], ["DTM+137:202602301811:203'", '42'],
      ["DTM+137:202609301811:204'", '42'], ["DTM+137:202610011811:203'", '42'],
    ] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace("DTM+137:202609301811:203'", segment)
          .replace('UNT+35+1', segment ? 'UNT+35+1' : 'UNT+34+1') }
      const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(result.validation.classification).toBe('application_rejected')
      expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '205', ercCode }),
      ]))
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected' })
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(plan.applicationErrors, segment).toEqual(expect.arrayContaining([expect.objectContaining({ fieldCode: '205', ercCode })]))
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain('FTX+AAO++205::260')
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    }
  })
  it('rejects missing or invalid header timezone 206 before an E66 E19 finding', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-timezone')
    const baseline = runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' })
    expect(baseline.ackPlan.utiltsErrCodes).toContain('E19')
    expect(baseline.validation.issues.some(issue => issue.aperakFieldCode === '206')).toBe(false)

    for (const [segment, ercCode] of [
      ['', '41'], ["DTM+735:?+2560:406'", '42'], ["DTM+735:?+0200:405'", '42'],
    ] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace("DTM+735:?+0200:406'", segment)
          .replace('UNT+35+1', segment ? 'UNT+35+1' : 'UNT+34+1') }
      const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(result.validation.syntaxOk).toBe(true)
      expect(result.validation.classification).toBe('application_rejected')
      expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '206', ercCode }),
      ]))
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ applicationDecision: 'rejected', functionalDecision: 'accepted' })
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(plan.utiltsHeaderRejected).toBe(true)
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain('FTX+AAO++206::260')
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors,
        utiltsHeaderRejected: plan.utiltsHeaderRejected }).rawPayload).not.toContain('RFF+ACW:')
    }
  })
  it('keeps a guide-rejected E66 IDE separate from its functional sibling', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-two-ide')
    const lines = control.raw_payload!.split('\n')
    const start = lines.findIndex(line => line.startsWith('IDE+24+'))
    const close = lines.findIndex(line => line.startsWith('UNT+'))
    const group = lines.slice(start, close)
    const first = group.map(line => line.startsWith('IDE+24+') ? "IDE+24'" : line)
    const second = group.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
    lines.splice(start, close - start, ...first, ...second)
    lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    const message = { ...control, raw_payload: lines.join('\n') }
    const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })

    expect(result.validation.syntaxOk).toBe(true)
    expect(result.transactionDispositions.map(item => [item.transactionId, item.responseType])).toEqual([
      ['transaction-1', 'negative_aperak'], ['GRIDEX2607E66002', 'utilts_err'],
    ])
    expect(result.validation.issues.filter(issue => issue.kind === 'functional' && issue.severity === 'error')
      .map(issue => issue.referenceNumber)).toEqual(expect.arrayContaining(['GRIDEX2607E66002']))
    expect(result.validation.issues.some(issue => issue.kind === 'functional' && issue.referenceNumber === 'transaction-1')).toBe(false)
    expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineItemReference: 'transaction-1' }),
    ]))
    expect(result.ackPlan.utiltsErrDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceNumber: 'GRIDEX2607E66002', code: 'E19' }),
    ]))
  })
  it('rejects invalid or missing acknowledgement request 313 before E19', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-ack-request')
    const noPositiveRequest = runUtiltsRuntimeForMessage({ ...control,
      raw_payload: control.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+9+NA'),
    }, { referenceDate: '2026-09-30' })
    expect(noPositiveRequest.validation.issues.some(issue => issue.aperakFieldCode === '313')).toBe(false)
    for (const [request, ercCode] of [['XX', '42'], ['', '41']] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', `GRIDEX2607E66MSG001+9+${request}`) }
      const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(result.validation.classification).toBe('application_rejected')
      expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '313', ercCode }),
      ]))
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'accepted' })
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(plan).toMatchObject({ outcome: 'negative', applicationErrors: [{ fieldCode: '313', ercCode }] })
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload).toContain('FTX+AAO++313::260')
    }
  })
  it('requires agency 260 for phase field 502 before a real E19 mismatch', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-phase-agency')
    const valid = runUtiltsRuntimeForMessage(control, { referenceDate: '2026-09-30' })
    expect(valid.ackPlan.utiltsErrCodes,JSON.stringify(valid.validation.issues)).toContain('E19')
    for (const [agency, ercCode] of [['999', '42'], ['', '41']] as const) {
      const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
        raw_payload: control.raw_payload!.replace('MKS+23+E02::260', `MKS+23+E02::${agency}`) }
      const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
      expect(result.validation.classification).toBe('application_rejected')
      expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '502', ercCode }),
      ]))
      expect(result.validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: agency ? 'UTILTS_PHASE_AGENCY_INVALID' : 'UTILTS_PHASE_AGENCY_MISSING',
          description: expect.stringContaining('MKS/C332/3055') }),
      ]))
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
      const decision = resolveCanonicalRuntimeDecision(message)
      expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'accepted' })
      expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
      const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
      expect(plan).toMatchObject({ outcome: 'negative', applicationErrors: [{ fieldCode: '502', ercCode }] })
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload).toContain('FTX+AAO++502::260')
    }
  })
  it('rejects a bad E66 phase header as field 502 guide error before an E19 mismatch', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-phase')
    const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
      raw_payload: control.raw_payload!.replace('MKS+23+E02::260', 'MKS+23+E99::260') }
    const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })

    expect(result.validation.classification).toBe('application_rejected')
    expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
    expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '502', ercCode: '42' }),
    ]))
    expect(result.ackPlan.utiltsErrDetails).toEqual([])
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'accepted' })
    expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
    expect(plan).toMatchObject({ outcome: 'negative', applicationErrors: [{ fieldCode: '502', ercCode: '42' }] })
    expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload).toContain('FTX+AAO++502::260')
  })
  it('uses the 25-A-3 E02/E03/E04 phase list and requires field 502', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-phase-list')
    for (const phase of ['E03', 'E04']) {
      const result = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace('MKS+23+E02::260', `MKS+23+${phase}::260`) }, { referenceDate: '2026-09-30' })
      expect(result.validation.issues.some(issue => issue.aperakFieldCode === '502')).toBe(false)
    }
    for (const phase of ['E05', '']) {
      const result = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace('MKS+23+E02::260', `MKS+23+${phase}::260`) }, { referenceDate: '2026-09-30' })
      if (!phase) {
        expect(result.validation.syntaxOk).toBe(false)
        expect(result.transactionDispositions.every(row => row.disposition === 'syntax_rejected' && row.responseType === 'negative_contrl')).toBe(true)
        expect(result.ackPlan.aperakApplicationErrors).toEqual([])
      } else expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '502', ercCode: '42' }),
      ]))
      expect(result.ackPlan.utiltsErrDetails).toEqual([])
    }
    const both = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace('MKS+23+E02::260', 'MKS+99+E99::260') }, { referenceDate: '2026-09-30' })
    expect(both.ackPlan.aperakApplicationErrors.map(error => error.fieldCode)).toEqual(['501', '502'])
    expect(both.ackPlan.utiltsErrDetails).toEqual([])
    const custom = control.raw_payload!.split('\n').map((segment, index) => index === 0
      ? 'UNA*;.? ~'
      : segment.replaceAll('+', ';').replaceAll(':', '*').replaceAll("'", '~')).join('\n')
    const customInvalid = runUtiltsRuntimeForMessage({ ...control, raw_payload: custom.replace('MKS;23;E02', 'MKS;23;E99') }, { referenceDate: '2026-09-30' })
    expect(customInvalid.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UTILTS_PHASE_INVALID', aperakFieldCode: '502' })]))
  })
  it('rejects an invalid E66 market header as guide error before a real E19 mismatch', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-header')
    const message = { ...control, sender_ediel_id: '91100', receiver_ediel_id: '21660',
      raw_payload: control.raw_payload!.replace('MKS+23+E02::260', 'MKS+99+E02::260') }
    const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })

    expect(result.validation.classification).toBe('application_rejected')
    expect(result.transactionDispositions.map(item => item.responseType)).toEqual(['negative_aperak'])
    expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '501' }),
    ]))
    expect(result.ackPlan.utiltsErrDetails).toEqual([])
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'accepted' })
    expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR')).toBe(false)
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')!
    expect(plan).toMatchObject({ outcome: 'negative', applicationErrors: [{ fieldCode: '501', ercCode: '42' }] })
    expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload).toContain('FTX+AAO++501::260')
  })
  it('keeps field 501 required and reads its value with the declared UNA', () => {
    const control = observationHandoffMessage('2026-09-30', 'tenant-una')
    const missing = runUtiltsRuntimeForMessage({ ...control, raw_payload: recountEdifactUnt(control.raw_payload!.replace('MKS+23+E02::260\'\n', '')) }, { referenceDate: '2026-09-30' })
    expect(missing.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ fieldCode: '501', ercCode: '41' })]))
    expect(missing.ackPlan.utiltsErrDetails).toEqual([])

    const custom = control.raw_payload!.split('\n').map((segment, index) => index === 0
      ? 'UNA*;.? ~'
      : segment.replaceAll('+', ';').replaceAll(':', '*').replaceAll("'", '~')).join('\n')
    const valid = runUtiltsRuntimeForMessage({ ...control, raw_payload: custom }, { referenceDate: '2026-09-30' })
    expect(valid.validation.issues.some(issue => issue.code === 'UTILTS_MARKET_INVALID' || issue.code === 'MKS_MISSING')).toBe(false)
    const invalid = runUtiltsRuntimeForMessage({ ...control, raw_payload: custom.replace('MKS;23;', 'MKS;99;') }, { referenceDate: '2026-09-30' })
    expect(invalid.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UTILTS_MARKET_INVALID', aperakFieldCode: '501' })]))
  })
  it('keeps E19 through 25-A-3 and removes the same processability rejection from 25-A-4', () => {
    // The complete monthly original has a real 1000/500 reading-energy
    // mismatch. The old minimal wire also lacked mandatory guide fields,
    // so its E19 was never an eligible functional rejection.
    const message = observationHandoffMessage('2026-09-30', 'tenant-cutoff')
    const beforeCutoff = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-09-30' })
    const afterCutoff = runOctoberGuide(message)

    expect(beforeCutoff.validation.issues.some((issue) => issue.kind === 'application' && issue.severity === 'error')).toBe(false)

    expect(
      beforeCutoff.validation.issues.some(
        (issue) =>
          issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH' &&
          issue.utiltsErrCode === 'E19',
      ),
    ).toBe(true)
    expect(beforeCutoff.ackPlan.utiltsErrCodes).toContain('E19')

    expect(
      afterCutoff.validation.issues.some(
        (issue) =>
          issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH' ||
          issue.utiltsErrCode === 'E19',
      ),
    ).toBe(false)
    expect(afterCutoff.ackPlan.utiltsErrCodes).not.toContain('E19')
  })
  it.each([
    ['negative', "QTY+136:500'", "QTY+136:-500'", 'E98'],
    ['missing-status', "STS+7++21::260'", "STS+7++46::260'", 'E90'],
  ])('removes October individual E66 %s rejection while preserving the prior rule', (_kind, before, after, error) => {
    const source = energyHandoffMessage('2026-09-30')
    const message = {...source, raw_payload:source.raw_payload!.replace(before, after)}
    const prior = runUtiltsRuntimeForMessage(message, {referenceDate:'2026-09-30'})
    const current = runUtiltsRuntimeForMessage(message, {referenceDate:'2026-10-01'})
    expect(prior.ackPlan.utiltsErrCodes).toContain(error)
    expect(current.ackPlan.utiltsErrCodes).not.toContain(error)
  })

})

it('shared October grace admits a complete prior guide without blending new identity diagnostics', () => {
 const source=observationHandoffMessage('2026-10-01','tenant-guide-grace')
 const raw_payload=source.raw_payload!.replace('LOC+172+735999260731000007::9','LOC+172+735999260731000008::9')
 const runtime=runActualUtiltsRuntimeForMessage({...source,raw_payload},{referenceDate:'2026-10-01'})
 expect(runtime.validation.issues.some(issue=>issue.code==='UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(false)
 expect(runtime.ackPlan.aperakApplicationErrors).toEqual([])
 expect(runtime.ackPlan.utiltsErrCodes).toContain('E19')
})
