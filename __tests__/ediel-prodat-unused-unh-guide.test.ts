import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))
// Only the external original/registry read boundary is modeled. The physical
// tokenizer, shared guide, field owner and admission below are real consumers.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { EDIFACT_UNUSED_HEADER_CONSTRAINTS, edifactUnusedHeaderObservations } from '@/lib/ediel/core/edifactHeaderConstraints'
import { validateEdifactHeaderGuide } from '@/lib/ediel/rulebook/edifactHeaderGuide'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateRulebookMessage, validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { resolveCanonicalRuntimeDecision, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import type { EdielMessageRow } from '@/lib/ediel/types'

const company = '10000000-0000-4000-8000-000000000001'
const profile = 'APERAK:D:96A:UN:E2SE6A'
function encoded(type = profile) {
  return EdifactEnvelopeCodec.encode({ sender: 'GRID', receiver: 'SUPPLIER', interchangeReference: 'OWN-P-ACK', environment: 'test',
    applicationReference: 'PRODAT', acknowledgementRequest: false,
    messages: [{ messageReference: 'OWN-AP', messageTypeToken: type, businessSegments: [
      'BGM+++27', 'DTM+137:202609301200:203', 'NAD+FR+52100:160:SVK+++++++SE', 'NAD+DO+52101:160:SVK+++++++SE',
      'RFF+ACW:ORIGINAL-P', 'ERC+41::260', 'FTX+AAO++209::260+Anläggnings-id saknas',
    ] }] })
}
function changed(type = profile, extra = '+COMMON+1:1') { return encoded(type).replace(`UNH+OWN-AP+${type}'`, `UNH+OWN-AP+${type}${extra}'`) }
function check(raw: string, direction: 'inbound' | 'outbound') {
  const wire = tokenizeEdifact(raw)
  return validateEdifactHeaderGuide({ rawPayload: raw, rawSegments: wire.segments.map(segment => segment.raw), una: wire.una, direction })
}
const input = (rawPayload: string) => ({ family: 'APERAK', code: 'APERAK', direction: 'inbound' as const, environment: 'test' as const,
  companyId: company, rawPayload, mode: 'parse' as const, admissionAt: '2026-09-30T12:00:00Z' })
const row = (raw_payload: string) => ({ id: '20000000-0000-4000-8000-000000000001', company_id: company, environment: 'test',
  direction: 'inbound', message_standard: 'edifact', message_family: 'APERAK', message_code: 'APERAK', raw_payload,
  message_received_at: '2026-09-30T12:00:00Z', created_at: '2026-09-30T12:00:00Z', parsed_payload: {} }) as unknown as EdielMessageRow
beforeEach(() => io.rpc.mockReset())

describe('P40/41/96/97 unused UNH0068 and S010, with P119 incoming PRODAT exception', () => {
  it.each(EDIFACT_UNUSED_HEADER_CONSTRAINTS.profiles.map(item => item.technicalProfile.join(':')))('uses the exact P profile %s', type => {
    expect(check(encoded(type), 'outbound')).toEqual([])
    const raw = changed(type)
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    expect(check(raw, 'outbound').map(issue => [issue.fieldPath, issue.blocking])).toEqual([['UNH/0068', true], ['UNH/S010', true]])
    expect(check(raw, 'inbound').every(issue => issue.blocking === !type.startsWith('PRODAT:'))).toBe(true)
  })
  it.each(['+:COMMON', '++:1', '+ ', '++ '])('checks every actual decoded component and data-space in %s', extra => {
    expect(check(changed(profile, extra), 'outbound')).toHaveLength(1)
  })
  it('keeps empty placeholders valid', () => { expect(check(changed(profile, '++:'), 'outbound')).toEqual([]) })
  it('uses actual alternative UNA and preserves released values', () => {
    const raw = `UNA*;.! ~UNB;UNOC*3;GRID;SUPPLIER;260930*1200;OWN;;PRODAT;;;;1~UNH;1;${profile.replaceAll(':', '*')};!+;*1~BGM;;;27~UNT;3;1~UNZ;1;OWN~`
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    expect(check(raw, 'inbound')).toHaveLength(2)
  })
  it('does not infer UNUSED guidance for U or CONTRL from P', () => {
    for (const type of ['APERAK:D:04A:UN:E5SE5A', 'UTILTS:D:02B:UN:E5SE5A', 'CONTRL:2:2:UN:EDIEL2']) expect(check(changed(type), 'outbound')).toEqual([])
  })
  it('observes each physical UNH separately without borrowing another profile', () => {
    const raw = changed('PRODAT:D:97A:UN:E2SE6A').replace("UNZ+1+OWN-P-ACK'", `UNH+SECOND+${profile}+COMMON'BGM+++27'UNT+3+SECOND'UNZ+2+OWN-P-ACK'`)
    const facts = edifactUnusedHeaderObservations(raw, 'inbound')
    expect(facts.map(fact => fact.ignored)).toEqual([true, true, false])
  })
  it('preserves incoming PRODAT X as nonblocking observations in the actual field owner', () => {
    const type = 'PRODAT:D:97A:UN:E2SE6A', raw = changed(type), wire = tokenizeEdifact(raw)
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode:'L', direction: 'inbound', referenceDate: '2026-09-30', associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse' })
    const issues = validateCanonicalPolicyFields({ policy, rawSegments: wire.segments.map(segment => segment.raw), una: wire.una }).filter(issue => issue.code === 'EDIEL_UNH_UNUSED_ELEMENT')
    expect(issues).toHaveLength(2)
    expect(issues.every(issue => issue.severity === 'warning' && !issue.blocking && !issue.prodatDiagnostic)).toBe(true)
  })
  it('reaches actual manual/API and registry admission before external original reads', async () => {
    const raw = changed()
    for (const result of [validateRulebookMessage(input(raw)), await validateRulebookMessageWithRegistry(input(raw))]) {
      expect(result.ok).toBe(false)
      expect(result.issues.filter(issue => issue.code === 'EDIEL_UNH_UNUSED_ELEMENT' && issue.blocking)).toHaveLength(2)
    }
    const base = resolveCanonicalRuntimeDecision(row(raw)), qualified = await resolveCanonicalRuntimeDecisionWithRegistry(row(raw))
    for (const decision of [base, qualified]) {
      expect(decision.syntaxDecision).toBe('accepted')
      expect(decision.applicationDecision).toBe('rejected')
      expect(decision.responsePlan.some(item => item.family === 'APERAK' || item.family === 'UTILTS_ERR')).toBe(false)
    }
    expect(io.rpc).not.toHaveBeenCalled()
  })
  it.each(['+ ', '++ '])('keeps the actual untrimmed source in runtime/manual/API for %s', async extra => {
    const raw = changed(profile, extra)
    for (const result of [validateRulebookMessage(input(raw)), await validateRulebookMessageWithRegistry(input(raw))]) {
      expect(result.issues.filter(issue => issue.code === 'EDIEL_UNH_UNUSED_ELEMENT' && issue.blocking)).toHaveLength(1)
    }
    const decision = resolveCanonicalRuntimeDecision(row(raw))
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.issues.some(issue => issue.code === 'EDIEL_UNH_UNUSED_ELEMENT')).toBe(true)
  })
})
