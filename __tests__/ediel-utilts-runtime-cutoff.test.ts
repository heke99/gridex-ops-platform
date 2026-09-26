import { describe, expect, it } from 'vitest'

import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

describe('UTILTS runtime effective-date cutoff', () => {
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
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain(`FTX+AAO++${fieldCode}::260`)
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
      expect(buildAperakDraft({ sourceMessage: message, outcome: 'negative', applicationErrors: plan.applicationErrors }).rawPayload)
        .toContain('FTX+AAO++206::260')
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
    lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.length - 2}+1'`
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
    expect(valid.ackPlan.utiltsErrCodes).toContain('E19')
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
      expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '502', ercCode: phase ? '42' : '41' }),
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
    const missing = runUtiltsRuntimeForMessage({ ...control, raw_payload: control.raw_payload!.replace('MKS+23+E02::260\'\n', '') }, { referenceDate: '2026-09-30' })
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
    const afterCutoff = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })

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
})
