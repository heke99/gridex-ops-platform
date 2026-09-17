import { describe, expect, it } from 'vitest'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { inferEdielFamilyAndCodeFromRawPayload } from '@/lib/ediel/classify'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'

const parentFields = ['END_USER_GROUP', '227', '228', '316', 'INSTALLATION_GROUP', '233', '234', '235', '236', '237']
function parentPolicy(subtype: string, direction: 'inbound' | 'outbound' = 'inbound') {
  return {
    family: 'PRODAT', code: 'Z14', subtype, direction,
    fieldRules: canonicalProdat26AFieldRules('Z14').filter(rule => parentFields.includes(rule.fieldNumber!)),
    prodatDependentConditions: evaluateProdatDependentConditions({ messageCode: 'Z14', facts: { canonicalSubtype: subtype } }),
  } as unknown as CanonicalEdielPolicy
}

describe('masterplan PRODAT parent applicability', () => {
  it('omits Z14N parent groups at construction even when customer and site data are populated', () => {
    const context = {
      code: 'Z14' as const, bgmReference: 'MESSAGE', transactionReference: 'CASE',
      senderEdielId: '12345', receiverEdielId: '54321', customerName: 'TEST CUSTOMER',
      customerId: 'CUSTOMER', meterPointId: 'OBJECT', siteAddress: 'TEST STREET',
    }
    const rejected = buildProfiledProdatSegments({ context, variant: 'N', mode: 'test', generatedAt: new Date('2026-09-15T12:00:00Z') })
    expect(rejected.segments.some(segment => segment.startsWith('NAD+UD+') || segment.startsWith('NAD+IT+'))).toBe(false)
    const positive = buildProfiledProdatSegments({ context, variant: 'V', mode: 'test', generatedAt: new Date('2026-09-15T12:00:00Z') })
    expect(positive.segments.some(segment => segment.startsWith('NAD+UD+'))).toBe(true)
    expect(positive.segments.some(segment => segment.startsWith('NAD+IT+'))).toBe(true)
  })
  it('accepts omitted Z14N groups without requiring their children or unrelated business facts', () => {
    expect(validateCanonicalPolicyFields({ policy: parentPolicy('N'), rawSegments: [] })).toEqual([])
  })
  it('does not require business facts for inapplicable Z14N parent D cells', () => {
    const evaluations = evaluateProdatDependentConditions({ messageCode: 'Z14', facts: { canonicalSubtype: 'N' } })
    for (const field of ['END_USER_GROUP', '227', '228', 'INSTALLATION_GROUP']) {
      expect(evaluations.find(row => row.fieldNumber === field)?.status).toBe('not_required')
    }
  })
  it('retains mandatory children for positive Z14', () => {
    const issues = validateCanonicalPolicyFields({ policy: parentPolicy('V'), rawSegments: [] })
    expect(issues.some(issue => issue.title === 'installation_id saknas')).toBe(true)
    expect(issues.some(issue => issue.title === 'end_user_country saknas')).toBe(true)
  })
  it('ignores incoming inapplicable groups but blocks their outgoing construction', () => {
    const rawSegments = ['NAD+IT+OBJECT+++STREET', 'NAD+UD+CUSTOMER++NAME+++++SE']
    expect(validateCanonicalPolicyFields({ policy: parentPolicy('N'), rawSegments })).toEqual([])
    expect(validateCanonicalPolicyFields({ policy: parentPolicy('N', 'outbound'), rawSegments })
      .some(issue => issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT')).toBe(true)
  })
})

describe('masterplan UTILTS ERR acknowledgement profile', () => {
  const source = {
    id: 'audit-source', direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS_ERR', message_code: 'ERR', environment: 'test', test_flag: true,
    sender_ediel_id: '12345', receiver_ediel_id: '54321', application_reference: '23-DDQ-E66-T',
    external_reference: 'ORIGINAL', transaction_reference: 'SOURCE-TX',
    raw_payload: "UNB+UNOC:3+12345:14+54321:14+260910:1200+I'UNH+M+UTILTS:D:02B:UN:E5SE5A'BGM+ERR+ORIGINAL+9'IDE+24+SOURCE-TX'UNT+4+M'UNZ+1+I'",
  } as unknown as EdielMessageRow
  it.each(['positive', 'negative'] as const)('validates %s stored-ERR acknowledgement through the outbound runtime gate', outcome => {
    const inferred = inferEdielFamilyAndCodeFromRawPayload(source.raw_payload!)
    expect(inferred.messageCode).toBe('UTILTS_ERR')
    const draft = buildAckDraftForSource({
      sourceMessage: { ...source, message_code: inferred.messageCode! }, ackFamily: 'APERAK', outcome,
      applicationErrors: outcome === 'negative' ? [{ ercCode: '41', fieldCode: '209', text: 'MISSING' }] : null,
    })
    const result = validateRulebookMessage({
      family: 'APERAK', code: 'APERAK', direction: 'outbound', mode: 'send', environment: 'test',
      businessDate: '2026-09-15', version: draft.messageVersion, rawPayload: draft.rawPayload!,
      applicationReference: draft.applicationReference,
      parsedPayload: { ...draft.parsedPayload, canonicalSourceMessageFamily: 'UTILTS_ERR' },
    })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(draft.rawPayload).toContain('DOC+ERR:SVK:260+ORIGINAL')
    expect(draft.rawPayload).not.toContain('DOC+UTILTS_ERR')
    expect(draft.rawPayload).toContain(outcome === 'positive' ? 'BGM+312+' : 'BGM+313+')
  })
  it('renders U-APERAK for the stored UTILTS_ERR alias, including original DOC', () => {
    const result = buildAckDraftForSource({ sourceMessage: source, ackFamily: 'APERAK', outcome: 'positive' })
    expect(result.rawPayload).toContain('APERAK:D:04A:UN:E5SE5A')
    expect(result.rawPayload).toContain('BGM+312+')
    expect(result.rawPayload).toContain('DOC+ERR:SVK:260+ORIGINAL')
    expect(result.rawPayload).not.toContain('BGM+++34')
    expect(result.messageVersion).toBe('E5SE5A')
  })
  it('retains P-APERAK for PRODAT and rejects an ERR reply loop', () => {
    // A P-family row must contain a P-family wire, not the UTILTS ERR wire
    // from the shared fixture. Keep the original document and actor identities.
    const prodatSource = { ...source, message_family: 'PRODAT', message_code: 'Z01',
      raw_payload: "UNB+UNOC:3+12345:14+54321:14+260910:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+ORIGINAL+9+AB'UNT+3+M'UNZ+1+I'",
    } as EdielMessageRow
    const result = buildAckDraftForSource({ sourceMessage: prodatSource, ackFamily: 'APERAK' })
    expect(result.rawPayload).toContain('APERAK:D:96A:UN:E2SE6A')
    expect(result.rawPayload).toContain('BGM+++34')
    expect(result.rawPayload).toContain('RFF+ACW:ORIGINAL')
    expect(() => buildAckDraftForSource({ sourceMessage: { ...source, message_family: 'PRODAT', message_code: 'Z01' }, ackFamily: 'APERAK' }))
      .toThrow('aperak_prodat_document_reference_required')
    expect(() => buildAckDraftForSource({ sourceMessage: source, ackFamily: 'UTILTS_ERR' })).toThrow()
  })
})
