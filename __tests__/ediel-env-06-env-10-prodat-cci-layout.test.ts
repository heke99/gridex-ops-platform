// masterplan: ENV-06, AT-ENV-06, ENV-10, AT-ENV-10
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: vi.fn(async () => ({ profileKey: 'synthetic-qualified', sourceHash: 'synthetic-evidence', messageProfileId: 'synthetic', rulePackId: 'synthetic' })) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw Error('UNEXPECTED_DB') }, rpc: () => { throw Error('UNEXPECTED_DB') } } }))
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { renderProdatDocumentHeader } from '@/lib/ediel/prodat/prodatDocumentFields'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { canonicalMessageFacts, parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { fieldRulesForMessage, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { prodatCharacteristicCodes } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import { raw, input, type Parts } from './fixtures/prodat-register'
import { own, head, source } from './fixtures/prodat-identity'

// Sources: P26.A §2.1 (BGM function), §2.6 and field 223 p.122 (CCI Z13/CAV
// reason code); U §3.9 (UTILTS CCI/C240/7037). Synthetic identifiers only.
const object = (edit: (parts: Parts[]) => Parts[] = parts => parts) => [...head(), ...edit(own('1', '735123456789012345', 'CASE-A'))]
const withReason = (value: string) => object(parts => parts.map(part => part[0] === 'CAV' && Array.isArray(part[1]) && part[1][0] === 'Z22' ? ['CAV', [value]] : part))
const decide = (body: Parts[], code = 'Z01') => resolveCanonicalRuntimeDecisionWithRegistry(source(raw(body, code), code))
const aperak = (decision: Awaited<ReturnType<typeof decide>>) => decision.responsePlan.find(plan => plan.family === 'APERAK')

describe('ENV-06 PRODAT BGM function and CCI Z13/CAV reason code', () => {
  it('accepts BGM+Z01 with CCI Z13 CAV Z22/Z23 as the Z01L/Z01LK combination', async () => {
    for (const reason of ['Z22', 'Z23']) {
      const decision = await decide(withReason(reason))
      expect(decision.syntaxDecision).toBe('accepted')
      expect(decision.applicationDecision).toBe('accepted')
      expect(decision.policy?.transactionReasonCode).toBe(reason)
      expect(decision.policy?.code).toBe('Z01')
      expect(decision.policy?.subtype).toBe(reason === 'Z22' ? 'L' : 'LK')
      expect(aperak(decision)).toBeUndefined()
    }
  })

  it('rejects a suffixed BGM+Z01L at syntax level with a negative CONTRL only', async () => {
    const decision = await decide(object(), 'Z01L')
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.policy).toBeNull()
    expect(decision.responsePlan.map(plan => `${plan.family}:${plan.outcome}`)).toEqual(['CONTRL:negative'])
  })

  it('rejects the internal subtype alias L on the wire with object-scoped ERC42 for field 223', async () => {
    const decision = await decide(withReason('L'))
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(aperak(decision)?.outcome).toBe('negative')
    expect(aperak(decision)?.applicationErrors).toMatchObject([{ ercCode: '42', fieldCode: '223', prodatOccurrence: { scope: 'object' } }])
    expect(aperak(decision)?.applicationErrors).toHaveLength(1)
  })

  it.each([
    ['Z96', 'a reason code of another BGM function (Z14N)'],
    ['ZZZ', 'an unknown reason code'],
  ])('rejects %s, %s, with ERC42 for field 223 instead of a local review hold', async reason => {
    const decision = await decide(withReason(reason))
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.policy).toBeNull()
    expect(decision.sourceRules).toContain('PRODAT26A:§2.2:Z01:223')
    expect(aperak(decision)?.outcome).toBe('negative')
    expect(aperak(decision)?.applicationErrors).toMatchObject([{ ercCode: '42', fieldCode: '223' }])
    expect(aperak(decision)?.applicationErrors).toHaveLength(1)
  })

  it('rejects an absent CCI Z13 reason with ERC41 for field 223', async () => {
    const body = object(parts => parts.filter((part, index) => !(part[0] === 'CCI' && part[2] === 'Z13') && !(part[0] === 'CAV' && parts[index - 1]?.[2] === 'Z13')))
    const decision = await decide(body)
    expect(decision.applicationDecision).toBe('rejected')
    expect(aperak(decision)?.applicationErrors).toMatchObject([{ ercCode: '41', fieldCode: '223' }])
  })

  it('keeps the bilateral-capability gate local: no national APERAK for Z03 + Z25 without evidence', async () => {
    const decision = await decide(withReason('Z25'), 'Z03')
    expect(decision.applicationDecision).toBe('manual_review')
    expect(aperak(decision)).toBeUndefined()
    expect(decision.validationReport.failureDisposition).toMatchObject({ kind: 'internal_failure' })
  })

  it('renders BGM+Z04 and CCI Z13/CAV Z22 for the L subtype, never a suffixed BGM or the alias', () => {
    const context: ProdatEngineProductionContext = {
      code: 'Z04', bgmReference: 'DOC', transactionReference: 'CASE', senderEdielId: '12345', receiverEdielId: '54321',
      meterPointId: '735123456789012345', meterPointIdAgency: '89', customerId: 'USER', customerName: 'Synthetic', customerIdAgency: '89', gridAreaId: 'TES',
      startDate: '202610010000', observationLength: '15', observationLengthFormat: '806',
    }
    const { segments } = buildProfiledProdatSegments({ context, variant: 'L', mode: 'test', generatedAt: new Date('2026-09-17T12:00:00Z') })
    const bgm = segments.filter(segment => segment.startsWith('BGM+'))
    expect(bgm).toHaveLength(1)
    expect(bgm[0]).toMatch(/^BGM\+Z04\+/)
    const cci = segments.indexOf('CCI++Z13')
    expect(cci).toBeGreaterThan(-1)
    expect(segments[cci + 1]).toBe('CAV+Z22')
    expect(segments).not.toContain('CAV+L')
  })

  it('refuses to serialize a suffixed BGM function', () => {
    expect(renderProdatDocumentHeader({ code: 'Z03', documentId: 'DOC' })).toBe('BGM+Z03+DOC+9+AB')
    expect(() => renderProdatDocumentHeader({ code: 'Z03L', documentId: 'DOC' })).toThrow('prodat_document_code_invalid')
  })

  it('blocks an outbound CAV alias L in send validation and passes the exact reason code', () => {
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L', direction: 'outbound', referenceDate: '2026-09-30', mode: 'catalog_evidence', applicationReference: '23-DDQ-PRODAT' })
    const only223 = { ...policy, fieldRules: policy.fieldRules.filter(rule => 'fieldNumber' in rule && rule.fieldNumber === '223') }
    const check = (value: string) => { const wire = input(raw(withReason(value), 'Z01'), 'Z01'); return validateCanonicalPolicyFields({ policy: only223, rawSegments: wire.rawSegments, una: wire.una }) }
    expect(check('Z22').filter(issue => issue.blocking)).toEqual([])
    expect(check('L')).toContainEqual(expect.objectContaining({ code: 'FIELD_MATRIX_CODE_LIST_INVALID', blocking: true }))
  })
})

const utilts = (characteristic: string) => "UNA:+.? 'UNB+UNOC:3+11111:14+22222:14+260801:1200+I++23-DDQ-UTILTS'" +
  ['UNH+M+UTILTS:D:02B:UN:E5SE5A', 'BGM+S03+DOC+9+AB', 'IDE+24+T1', 'LIN+1', characteristic, 'CAV+E02::260', 'UNT+7+M', 'UNZ+1+I'].join("'") + "'"

describe('ENV-10 CCI layout is bound to the family segment definition', () => {
  it('reads the PRODAT Z-property only from CCI/C502/6313, never from the UTILTS C240 slot', async () => {
    const wire = (cci: string) => tokenizeEdifact(raw([...head(), ['LIN', '1', '', ['735123456789012345', '', '', '9']], ['CCI', ...cci.split('+').slice(1)], ['CAV', ['Z22']]], 'Z01'))
    expect(prodatCharacteristicCodes(wire('CCI++Z13').segments, wire('CCI++Z13').una).Z13).toEqual(['Z22'])
    expect(prodatCharacteristicCodes(wire('CCI+++Z13').segments, wire('CCI+++Z13').una).Z13).toBeUndefined()
    // The real inbound consumer treats the moved property as missing field 223.
    const decision = await decide(object(parts => parts.map(part => part[0] === 'CCI' && part[2] === 'Z13' ? ['CCI', '', '', 'Z13'] : part)))
    expect(decision.policy).toBeNull()
    expect(aperak(decision)?.applicationErrors).toMatchObject([{ ercCode: '41', fieldCode: '223' }])
  })

  it('reads a UTILTS characteristic only from CCI/C240/7037 in the canonical AST', () => {
    expect(canonicalMessageFacts(utilts('CCI+++E02')).cciCavCodes.E02).toEqual(['E02'])
    expect(canonicalMessageFacts(utilts('CCI++E02')).cciCavCodes.E02).toBeUndefined()
    const lines = (payload: string) => parseCanonicalEdifactAst(payload).messages[0]!.lineGroups.map(group => group.cciCavCodes)
    expect(lines(utilts('CCI+++E02'))).toEqual([{ E02: ['E02'] }])
    expect(lines(utilts('CCI++E02'))).toEqual([{}])
  })

  it('locates UTILTS planning field 254 at C240/7037 and does not accept the PRODAT position', () => {
    const rule = fieldRulesForMessage('UTILTS', 'S03').find(entry => entry.fieldNumber === '254')!
    expect(rule.segmentPath).toBe('CCI+++E02/CAV')
    const issues = (characteristic: string, code = 'S03') => validateFieldMatrixPayload({ family: 'UTILTS', code, rawSegments: ['BGM+' + code + '+DOC+9+AB', 'IDE+24+T1', characteristic, 'CAV+E02::260'], mode: 'parse' }, fieldRulesForMessage('UTILTS', code).filter(entry => entry.fieldNumber === '254')).map(entry => entry.code)
    expect(issues('CCI+++E02')).toEqual([])
    expect(issues('CCI++E02')).toEqual(['UTILTS_FIELD_254_MISSING'])
    expect(issues('CCI+++E02', 'S02')).toEqual(['UTILTS_FIELD_254_FORBIDDEN'])
    expect(issues('CCI++E02', 'S02')).toEqual([])
  })

  it('keeps PRODAT field-matrix CCI paths on C502 after the UTILTS change', () => {
    const rule = fieldRulesForMessage('PRODAT', 'Z13').find(entry => entry.fieldKey === 'reporting_frequency')!
    expect(rule.segmentPath).toBe('CCI++Z12/CAV')
    const check = (cci: string) => validateFieldMatrixPayload({ family: 'PRODAT', code: 'Z13', rawSegments: [cci, 'CAV+:::D'], mode: 'parse' }, [rule]).map(entry => entry.code)
    expect(check('CCI++Z12')).toEqual([])
    expect(check('CCI+++Z12')).toEqual(['REPORTING_FREQUENCY_MISSING'])
  })
})
