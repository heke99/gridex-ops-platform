import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { validateFieldMatrixPayload, type ProdatIgnoredField } from '@/lib/ediel/rulebook/fieldMatrix'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { raw, line, characteristic, input, type Parts } from './fixtures/prodat-register'
import { own, head, source } from './fixtures/prodat-identity'

// Original P26.A r3 p119: incoming X and established false D extra information
// must not cause negative APERAK, even when its national content is wrong.
// International grammar remains a prior gate; the separate date-format advice
// is retained. Outgoing omission remains mandatory.
function selected(code: string, subtype: string, body: Parts[], fields: string[], direction: 'inbound' | 'outbound' = 'inbound', onIgnoredField?: (field:ProdatIgnoredField)=>void) {
  const wire = input(raw(body, code), code)
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: subtype,
    direction, referenceDate: '2026-09-30', mode: direction === 'inbound' ? 'parse' : 'catalog_evidence',
    applicationReference: ['Z13','Z14','Z15','Z18'].includes(code) ? '23-DGI-PRODAT' : '23-DDQ-PRODAT' })
  return validateCanonicalPolicyFields({ policy: { ...policy, fieldRules: policy.fieldRules.filter(rule => fields.includes(String('fieldNumber' in rule ? rule.fieldNumber : null))) },
    rawSegments: wire.rawSegments, una: wire.una, onIgnoredField })
}

describe('PRODAT incoming national exclusions at the field owner', () => {
  const unusedExamples: [string, Parts[]][] = [
    ['224', [['RFF', ['MG', 'IGNORED']]]],
    ['213', [['QTY', ['31', 'NOT-A-NUMBER', 'KWH']]]],
    ['218', [['CCI', '', 'Z05'], ['CAV', ['', '', '', 'NOT-A-NUMBER']]]],
  ]
  it.each(unusedExamples)('ignores incoming Z01 X field %s and retains outgoing prohibition', (field, extra) => {
    const body: Parts[] = [line('1', '735123456789012345'), ...extra]
    expect(selected('Z01', 'L', body, [field])).toEqual([])
    expect(selected('Z01', 'L', body, [field], 'outbound').some(issue => issue.blocking)).toBe(true)
  })

  it('ignores false subtype-only D319 in own Z04L but keeps required Z04D', () => {
    const body: Parts[] = [line('1', '735123456789012345'), ...characteristic('Z13', 'Z22'), ['RFF', ['Z07', 'EXTRA-REFERENCE']]]
    expect(selected('Z04', 'L', body, ['319'])).toEqual([])
    expect(selected('Z04', 'L', body, ['319'], 'outbound').some(issue => issue.blocking)).toBe(true)
    expect(selected('Z04', 'D', [line('1', '735123456789012345'), ...characteristic('Z13', 'Z70')], ['319'])
      .some(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '319')).toBe(true)
  })

  it('resolves an ignored UD parent from each own wire subtype, not root metadata', () => {
    const extra: Parts = ['NAD', 'UD', ['FAKE', 'BAD', 'BAD'], '', 'EXTRA', '', '', '', '', 'BAD']
    expect(selected('Z06', 'E', [line('1', '735123456789012345'), ...characteristic('Z13', 'E64'), extra],
      ['END_USER_GROUP', '227', '228', '231', '232', '316'])).toEqual([])
    expect(selected('Z14', 'V', [line('1', '735123456789012345'), ...characteristic('Z13', 'Z96'), extra],
      ['END_USER_GROUP', '227', '228', '316'])).toEqual([])
  })

  it('keeps ignored subtype-dependent fields bound to their own full-message line index', () => {
    const ignored: ProdatIgnoredField[] = []
    const body: Parts[] = [line('1','735123456789012345'), ...characteristic('Z13','Z22'), ['RFF',['Z07','EXTRA-A']],
      line('2','735123456789012352'), ...characteristic('Z13','Z22'), ['RFF',['Z07','EXTRA-B']]]
    expect(selected('Z04','L',body,['319'],'inbound',field=>ignored.push(field))).toEqual([])
    expect(ignored).toEqual(expect.arrayContaining([
      expect.objectContaining({fieldNumber:'319',occurrence:expect.objectContaining({objectId:'735123456789012345',lineIndex:0})}),
      expect.objectContaining({fieldNumber:'319',occurrence:expect.objectContaining({objectId:'735123456789012352',lineIndex:1})}),
    ]))
  })

  it('accepts an unused valid date and still detects its invalid format', () => {
    const body: Parts[] = [line('1', '735123456789012345'), ['DTM', ['93', '202610010000', '203']]]
    expect(selected('Z01', 'L', body, ['211'])).toEqual([])
    expect(selected('Z01', 'L', [line('1', '735123456789012345'), ['DTM', ['93', '202602300000', '203']]], ['211'])
      .some(issue => issue.code === 'FIELD_MATRIX_FIELD_FORMAT_INVALID')).toBe(true)
  })

  it('retains family-specific exclusions on UTILTS rather than adopting P119 globally', () => {
    expect(validateFieldMatrixPayload({ family: 'UTILTS', code: 'S02', rawSegments: ['RFF+MG:EXTRA'], mode: 'parse', direction: 'inbound' },
      [{ family: 'UTILTS', code: 'S02', fieldNumber: '224', fieldKey: 'meter', label: 'meter', segmentPath: 'RFF+MG', requirement: 'forbidden' }])
      .some(issue => issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT')).toBe(true)
  })

  it('actual canonical runtime accepts extra meter information and projects its own ignored field', () => {
    const body = [...head(), ...own('1', '735123456789012345', 'CASE-A')]
    body.splice(body.findIndex(part => part[0] === 'RFF'), 0, ['RFF', ['MG', 'IGNORED-METER']])
    const message = source(raw(body, 'Z01'))
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('accepted')
    expect(decision.responsePlan.some(item => item.family === 'APERAK' && item.outcome === 'negative')).toBe(false)
    expect(decision.prodatIgnoredFields).toContainEqual(expect.objectContaining({ fieldNumber: '224', sourceRule: 'PRODAT26A:P119',
      occurrence: expect.objectContaining({ objectId: '735123456789012345', lineItemReference: 'CASE-A', lineIndex: 0 }) }))
    expect(decision.validationReport.prodatIgnoredFields).toEqual(decision.prodatIgnoredFields)
    expect(message.raw_payload).toContain('IGNORED-METER')
  })

  it('rejects lexical failure before parsing or choosing business and ACK actors', () => {
    const message = source(raw([...head(), ...own('1', '735123456789012345', 'CASE-A')], 'Z01') + 'BROKEN?')
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.applicationDecision).toBe('not_applicable')
    expect(decision.functionalDecision).toBe('not_applicable')
    expect(decision.policy).toBeNull()
    expect(decision.canonical.family).toBe('UNKNOWN')
    expect(decision.canonical.sender).toBeNull()
    expect(decision.canonical.receiver).toBeNull()
    expect(decision.responsePlan).toEqual([])
    expect(decision.prodatIgnoredFields).toBeUndefined()
  })

  it('retains negative CONTRL for a parseable count mismatch', () => {
    const wire = raw([...head(), ...own('1', '735123456789012345', 'CASE-A')], 'Z01').replace(/UNT\+\d+/, 'UNT+999')
    const decision = resolveCanonicalRuntimeDecision(source(wire))
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.applicationDecision).toBe('not_applicable')
    expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'CONTRL', outcome:'negative'}))
  })

  it('maps missing national BGM1004 to application41/203 rather than syntax rejection', () => {
    const wire = raw([...head(), ...own('1', '735123456789012345', 'CASE-A')], 'Z01').replace('BGM+Z01+D+9+AB', 'BGM+Z01++9+AB')
    const decision = resolveCanonicalRuntimeDecision(source(wire))
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'CONTRL', outcome:'positive'}))
    expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'APERAK', outcome:'negative',
      applicationErrors:expect.arrayContaining([expect.objectContaining({ercCode:'41',fieldCode:'203'})])}))
  })

  it('every canonical X rule follows the incoming exclusion before national value validation', () => {
    const rules = canonicalProdat26AFieldRules('Z01').filter(rule => rule.requirement === 'forbidden')
    // Independent positive fragments above prove actual presence; this loop guards
    // each descriptor against being accidentally promoted back to a reject owner.
    const wire = input(raw([line('1', '735123456789012345'), ['RFF', ['MG', 'METER']]], 'Z01'), 'Z01')
    expect(validateFieldMatrixPayload({ ...wire, direction: 'inbound' }, rules)).toEqual([])
  })
})
