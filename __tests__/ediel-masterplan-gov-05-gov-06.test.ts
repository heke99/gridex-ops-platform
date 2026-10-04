// masterplan: GOV-05, AT-GOV-05, GOV-06, AT-GOV-06
import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalAckGuide } from '@/lib/ediel/rulebook/ackGuidePolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

const copy = ['LOC+172+POINT::9', 'LOC+239+AAA:SVK:260', 'NAD+DDK+52102:SVK:260', 'NAD+DDQ+52101:SVK:260', 'PIA+1+V1:PT:SVK:260', 'DTM+324:202609290000202609300000:719', 'STS+7++E03::260']
function errWire(code: string) {
  return EdifactEnvelopeCodec.encode({ sender: 'SUPPLIER', receiver: 'GRID', interchangeReference: 'ERR-I', environment: 'test', applicationReference: '23-DDQ-E66-T', acknowledgementRequest: true,
    messages: [{ messageReference: 'ERR-M', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+ERR::260+ERR-D+9+AB', 'DTM+137:202609301200:203', 'DTM+735:?+0100:406', 'MKS+23+E02::260', 'NAD+MS+52101:SVK:260', 'NAD+MR+52100:SVK:260', 'NAD+DDQ', 'IDE+24+ERR-T', ...copy, `STS+E01::260+41+${code}::260`, 'RFF+TN:ORIGINAL-T', 'RFF+E66:ORIGINAL-D'] }] })
}
function aperakWire(text: string) {
  return EdifactEnvelopeCodec.encode({ sender: 'TRANSPORT_R', receiver: 'TRANSPORT_S', interchangeReference: 'ACKI', environment: 'test', applicationReference: '23-DDQ-E66-T', acknowledgementRequest: true,
    messages: [{ messageReference: 'ACKM', messageTypeToken: 'APERAK:D:04A:UN:E5SE5A', businessSegments: ['BGM+312+ACKDOC+9', 'DTM+137:202609301200:203', 'DTM+735:?+0100:406', 'DOC+E66::260+SOURCEDOC', 'NAD+MS+LEGAL_R:SVK:260', 'NAD+MR+LEGAL_S:SVK:260', 'NAD+DDQ', 'ERC+100::260', `FTX+AAO+++${text}`, 'RFF+DM:ACKT', 'RFF+ACW:T1'] }] })
}
function row(raw: string, family: 'UTILTS_ERR' | 'APERAK', receivedAt: string): EdielMessageRow {
  return { id: '20000000-0000-4000-8000-000000000001', company_id: '10000000-0000-4000-8000-000000000001', environment: 'test', direction: 'inbound', message_standard: 'edifact',
    message_family: family, message_code: family === 'APERAK' ? 'APERAK' : 'ERR', raw_payload: raw, message_received_at: receivedAt, created_at: receivedAt } as unknown as EdielMessageRow
}
const errRow = (code: string, receivedAt: string) => row(errWire(code), 'UTILTS_ERR', receivedAt)
const guideFindings = (message: EdielMessageRow, policy: ReturnType<typeof resolveCanonicalMessagePolicy>) => {
  const wire = tokenizeEdifact(message.raw_payload!)
  return validateCanonicalAckGuide({ policy: policy!, rawPayload: message.raw_payload, rawSegments: wire.segments.map(t => t.raw), una: wire.una })
    .filter(finding => finding.blocking || finding.severity === 'error')
}

describe('GOV-05 preceding guide during the two-week transition (Mottagning)', () => {
  it.each(['2026-10-01T10:00:00Z', '2026-10-14T10:00:00Z'])('tries inbound UTILTS_ERR against 25-A-3 and selects that whole package (%s)', receivedAt => {
    // E19 exists only in 25-A-3 field 531; both revisions share E5SE5A.
    const message = errRow('E19', receivedAt)
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-3')
    expect(selected.associationAssignedCode).toBe('E5SE5A')
    expect(selected.guideSelection).toEqual({ selectedGuideRevision: '25-A-3', basis: 'previous_guide_grace',
      evaluated: [{ guideRevision: '25-A-4', passed: false }, { guideRevision: '25-A-3', passed: true }] })
    // One complete compatible package: identical to the explicit 25-A-3 candidate, not a blend.
    const complete = resolveCanonicalEdielPolicy({ selectedGuideRevision: '25-A-3', family: 'UTILTS_ERR', messageCode: 'ERR', subtypeOrReasonCode: selected.subtype, direction: 'inbound',
      referenceDate: selected.referenceDate, associationAssignedCode: 'E5SE5A', applicationReference: '23-DDQ-E66-T', mode: 'parse' })
    expect(selected.guide).toEqual(complete.guide)
    expect(selected.ackRule).toEqual(complete.ackRule)
    expect(selected.fieldRules).toEqual(complete.fieldRules)
    expect(guideFindings(message, selected)).toEqual([])
    // Superior context: the decision keeps the actual admission date, not the old guide's date.
    expect(selected.referenceDate).toBe(receivedAt.slice(0, 10))
    expect(selected.timeAnchors?.admissionDate).toBe(receivedAt.slice(0, 10))
  })

  it('logs the chosen interpretation in the runtime decision', () => {
    const decision = resolveCanonicalRuntimeDecision(errRow('E19', '2026-10-02T10:00:00Z'))
    expect(decision.validationReport.canonicalPolicy).toMatchObject({ guide: { guideRevision: '25-A-3' }, guideSelection: { selectedGuideRevision: '25-A-3', basis: 'previous_guide_grace' } })
    expect(decision.decisionTrace.some(line => line.includes('Anvisningsval: 25-A-3 (previous_guide_grace') && line.includes('25-A-4=underkänd') && line.includes('25-A-3=godkänd'))).toBe(true)
  })

  it('keeps the current guide when it passes as a whole and records that choice', () => {
    const selected = resolveCanonicalMessagePolicy(errRow('E51', '2026-10-02T10:00:00Z'))!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(selected.guideSelection).toEqual({ selectedGuideRevision: '25-A-4', basis: 'current_guide', evaluated: [{ guideRevision: '25-A-4', passed: true }] })
  })

  it('tries inbound APERAK on E5SE5A against the preceding guide too, without mixing diagnostics', () => {
    const message = row(aperakWire('NOT OK'), 'APERAK', '2026-10-02T10:00:00Z')
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guideSelection?.evaluated.map(entry => entry.guideRevision)).toEqual(['25-A-4', '25-A-3'])
    expect(selected.guideSelection?.basis).toBe('current_guide_no_candidate_passed')
    // Fails both whole guides → the current package and only its own findings are retained.
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(guideFindings(message, selected).length).toBeGreaterThan(0)
  })

  it('does not pick single favourable checks: an E5SE5A code is not revision evidence after the window', () => {
    const message = errRow('E19', '2026-10-15T10:00:00Z')
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(selected.previousGuideGraceActive).toBe(false)
    expect(selected.guideSelection).toEqual({ selectedGuideRevision: '25-A-4', basis: 'current_only', evaluated: [] })
    expect(guideFindings(message, selected).map(finding => finding.code)).toContain('ACK_UTILTS_ERR_ORIGINAL_REASON_SCOPE_REQUIRED')
  })

  it('never falls back for outbound traffic', () => {
    const message = { ...errRow('E19', '2026-10-02T10:00:00Z'), direction: 'outbound' as const }
    const selected = resolveCanonicalMessagePolicy(message, undefined, { admissionAt: '2026-10-02T10:00:00Z' })!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(selected.guideSelection?.basis).toBe('current_only')
  })

  it('does not switch to older semantics because of a functional failure', () => {
    const message = { ...energyHandoffMessage('2026-10-01'), metering_point_id: null, business_match_status: 'unmatched' }
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(selected.guideSelection?.basis).toBe('current_guide')
  })
})

describe('GOV-06 explicit version decision to utiltsEngine', () => {
  it('carries format/transition time, document date, delivery period and replay time as separate concepts', () => {
    const source = energyHandoffMessage('2026-09-30')
    const message = { ...source, message_received_at: '2026-10-20T10:00:00Z' }
    const selected = resolveCanonicalMessagePolicy(message, undefined, { replayAt: '2027-01-05T08:00:00Z' })!
    const anchors = selected.timeAnchors!
    expect(anchors.admissionDate).toBe('2026-10-20')
    expect(anchors.replayAt).toBe('2027-01-05T08:00:00.000Z')
    expect(anchors.documentDate).not.toBe(anchors.admissionDate)
    expect(anchors.measurementPeriods.length).toBeGreaterThan(0)
    // Guide follows the admission/transition time only; document date and replay time do not reselect it.
    expect(selected.referenceDate).toBe('2026-10-20')
    expect(selected.guide.guideRevision).toBe('25-A-4')
  })

  it('runs utiltsEngine on the explicit decision it is given (no reselection)', () => {
    const source = energyHandoffMessage('2026-09-30')
    const message = { ...source, message_received_at: '2026-10-01T10:00:00Z', raw_payload: source.raw_payload!.replace('735999260731000007::9', '735999260731000008::9') }
    const explicit = resolveCanonicalMessagePolicy(message)!
    expect(explicit.guide.guideRevision).toBe('25-A-3')
    const withExplicit = runUtiltsRuntimeForMessage(message, { canonicalPolicy: explicit })
    expect(withExplicit.validation.issues.some(issue => issue.code === 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(false)
  })

  it('has no implicit now(): outbound without an explicit decision or time anchor is refused', () => {
    const outbound = { ...energyHandoffMessage('2026-10-01'), direction: 'outbound' as const, message_received_at: null }
    expect(() => runUtiltsRuntimeForMessage(outbound)).toThrow(/^ediel_admission_time_missing:utilts_explicit_decision_required$/)
    // With an explicit anchor the time gate is satisfied; any further refusal is the outbound guide's own rule.
    let error: unknown = null
    try { runUtiltsRuntimeForMessage(outbound, { referenceDate: '2026-10-02' }) } catch (caught) { error = caught }
    expect(String(error)).not.toMatch(/ediel_admission_time/)
  })

  it('rejects a locally incoherent decision before any runtime result exists', () => {
    const message = energyHandoffMessage('2026-10-01')
    const explicit = resolveCanonicalMessagePolicy(message)!
    expect(() => runUtiltsRuntimeForMessage(message, { canonicalPolicy: explicit, referenceDate: '2026-11-20' })).toThrow(/^ediel_admission_time_incoherent:/)
    const tampered = { ...explicit, referenceDate: '2026-09-15' }
    expect(() => runUtiltsRuntimeForMessage(message, { canonicalPolicy: tampered })).toThrow(/^ediel_admission_time_incoherent:/)
    expect(() => runUtiltsRuntimeForMessage(message, { canonicalPolicy: explicit, referenceDate: explicit.referenceDate })).not.toThrow()
  })

  it('classifies own-time-context failure as local review, never an external field error', () => {
    const decision = resolveCanonicalRuntimeDecision(energyHandoffMessage('2026-10-01'), { admissionAt: 'not-a-time' })
    expect(decision.applicationDecision).toBe('manual_review')
    expect(decision.sourceRules).toContain('GOV-06:LOCAL_CONTEXT')
    expect(decision.responsePlan.some(response => response.outcome === 'negative')).toBe(false)
  })
})
