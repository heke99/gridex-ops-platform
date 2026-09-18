import { describe, expect, it } from 'vitest'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { alphabets, characteristic, input, line, raw, rule, type Parts } from './fixtures/prodat-register'

// Independent oracle: P26.A revision 3, section 2.2, printed pages 17–20.
// 508/217: Z06F required; Z06E/G optional. 306/254: Z06F/G required;
// Z06E optional. Z09 216 is required except D (forbidden); 217 is
// required for F/G and forbidden for B/D/E. Do not derive these from the
// runtime registry, the legacy byCell flag, or the tested field's presence.
const cases = [
  ['Z06', '508', 'F', 'E64', 'required'],
  ['Z06', '508', 'E', 'E34', 'optional'],
  ['Z06', '508', 'G', 'E32', 'optional'],
  ['Z06', '217', 'F', 'E64', 'required'],
  ['Z06', '217', 'E', 'E34', 'optional'],
  ['Z06', '217', 'G', 'E32', 'optional'],
  ['Z06', '306', 'F', 'E64', 'required'],
  ['Z06', '306', 'G', 'E32', 'required'],
  ['Z06', '306', 'E', 'E34', 'optional'],
  ['Z06', '254', 'F', 'E64', 'required'],
  ['Z06', '254', 'G', 'E32', 'required'],
  ['Z06', '254', 'E', 'E34', 'optional'],
  ['Z09', '216', 'B', 'Z27', 'required'],
  ['Z09', '216', 'E', 'E34', 'required'],
  ['Z09', '216', 'F', 'E64', 'required'],
  ['Z09', '216', 'G', 'E32', 'required'],
  ['Z09', '216', 'D', 'Z70', 'forbidden'],
  ['Z09', '217', 'F', 'E64', 'required'],
  ['Z09', '217', 'G', 'E32', 'required'],
  ['Z09', '217', 'B', 'Z27', 'forbidden'],
  ['Z09', '217', 'D', 'Z70', 'forbidden'],
  ['Z09', '217', 'E', 'E34', 'forbidden'],
] as const
const cells = [['Z06','508'],['Z06','217'],['Z06','306'],['Z06','254'],['Z09','216'],['Z09','217']] as const
const payloadField: Record<string, Parts[]> = {
  '508': [['DTM', ['354', '15', '806']]],
  '216': [['DTM', ['157', '202610010000', '203']]],
  '217': characteristic('Z04', 'Z03'),
  '306': characteristic('Z07', 'E22'),
  '254': characteristic('Z15', 'E02'),
}
function policy(code: string, field: string, subtype: string): CanonicalEdielPolicy {
  const source = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:subtype,
    direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence'})
  return {...source, fieldRules: [rule(field, code)], prodatDependentConditions: source.prodatDependentConditions.map(value => ({...value,status:'not_required'}))}
}
function validate(code: string, field: string, subtype: string, body: Parts[], scope: 'all' | 'dependent_only' = 'all', alphabet: readonly string[] = alphabets[0]) {
  const wire = input(raw(body, code, alphabet), code)
  return validateCanonicalPolicyFields({policy:policy(code,field,subtype),rawSegments:wire.rawSegments,una:wire.una,scope})
}
const errors = (result: ReturnType<typeof validate>) => result.filter(value => value.blocking || value.severity === 'error')

// The status remains compatible, but the new explicit requirement must preserve
// the difference between "may be sent" and "must not be sent".
describe('source-defined D subtype outcomes, not free-form byCell assertions', () => {
  it.each(cases)('%s:%s subtype %s (%s) is %s', (code,field,subtype,_reason,requirement) => {
    const resolved = resolveProdatDependentCondition({messageCode:code,fieldNumber:field,facts:{canonicalSubtype:subtype}})
    expect(resolved?.status).toBe(requirement === 'required' ? 'required' : 'not_required')
    expect(resolved?.requirement).toBe(requirement)
    expect(resolved?.source.section).toMatch(/§2\.2.*s\.(17|18|19|20)/)
  })
  it.each(cases)('%s:%s cannot be overridden by byCell (%s/%s/%s)', (code,field,subtype,_reason,requirement) => {
    for (const byCell of [true,false,null]) {
      const resolved = resolveProdatDependentCondition({messageCode:code,fieldNumber:field,facts:{canonicalSubtype:subtype,byCell:{[`${code}:${field}`]:byCell}}})
      expect(resolved?.requirement).toBe(requirement)
    }
  })
  it.each(cells)('%s:%s keeps missing or invalid subtype undetermined', (code,field) => {
    for (const bad of [undefined,null,'','INVALID','N','V',false,1,{toString:()=> 'F'}]) {
      const resolved = resolveProdatDependentCondition({messageCode:code,fieldNumber:field,facts:{canonicalSubtype:bad as string,byCell:{[`${code}:${field}`]:true}}})
      expect(resolved?.status).toBe('undetermined')
      expect(resolved?.requirement).toBe('undetermined')
    }
  })
  it('does not pretend the remaining date/business rules have been implemented', () => {
    expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'210',facts:{canonicalSubtype:'F'}})?.status).toBe('undetermined')
  })
})

describe('actual canonical field validation rederives D requirements from each wire object', () => {
  for (const scope of ['all','dependent_only'] as const) {
    describe(scope, () => {
      it.each(cases)('%s:%s %s (%s) enforces %s despite forged root statuses', (code,field,subtype,reason,requirement) => {
        const base: Parts[] = [line('1','LOCAL:A'),...characteristic('Z13',reason)]
        expect(errors(validate(code,field,subtype,base,scope)).length > 0).toBe(requirement === 'required')
        expect(errors(validate(code,field,subtype,[...base,...payloadField[field]],scope)).length > 0).toBe(requirement === 'forbidden')
      })
      it.each(alphabets)('does not let another object supply a missing value using %j', (...alphabet) => {
        const body: Parts[] = [line('1','OBJECT:A'),...characteristic('Z13','E64'),...payloadField['217'],
          line('2','OBJECT:B'),...characteristic('Z13','E64')]
        const result = errors(validate('Z06','217','F',body,scope,alphabet))
        expect(result).toHaveLength(1)
        expect(result[0].description).toContain('OBJECT:B')
      })
      it('uses B-specific subtype even when the root/A subtype permits the field', () => {
        const body: Parts[] = [line('1','A'),...characteristic('Z13','E64'),...payloadField['217'],
          line('2','B'),...characteristic('Z13','E34'),...payloadField['217']]
        const result = errors(validate('Z09','217','F',body,scope))
        expect(result).toHaveLength(1)
        expect(result[0].description).toContain('B')
      })
      it('permits optional Z06G observation length while requiring it for a sibling Z06F', () => {
        const body: Parts[] = [line('1','A'),...characteristic('Z13','E64'),...payloadField['508'],
          line('2','B'),...characteristic('Z13','E32')]
        expect(errors(validate('Z06','508','F',body,scope))).toEqual([])
      })
      it('does not read a later register repetition as authority for a common field', () => {
        const body: Parts[] = [line('1','A','1'),...characteristic('Z13','E64'),
          line('2','A','2'),...characteristic('Z13','E34'),...payloadField['217']]
        const result = errors(validate('Z06','217','F',body,scope))
        expect(result).toHaveLength(1)
      })
      it('does not require the first-register common value again in register two', () => {
        const body: Parts[] = [line('1','A','1'),...characteristic('Z13','E64'),...payloadField['217'],line('2','A','2')]
        expect(errors(validate('Z06','217','F',body,scope))).toEqual([])
      })
      it.each(['missing','duplicate','unknown','alias'])('blocks %s field-223 evidence before accepting a dependent field', (kind) => {
        const reason = kind === 'missing' ? [] : kind === 'duplicate' ? [...characteristic('Z13','E64'),...characteristic('Z13','E34')]
          : characteristic('Z13',kind === 'alias' ? 'F' : 'INVALID')
        const result = errors(validate('Z06','217','F',[line('1','A'),...reason,...payloadField['217']],scope))
        expect(result.some(value => value.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      })
      it('does not borrow field223 or the dependent value from the next message', () => {
        const first = input(raw([line('1','A')],'Z06'),'Z06')
        const second = input(raw([line('1','B'),...characteristic('Z13','E64'),...payloadField['217']],'Z06'),'Z06')
        const result = validateCanonicalPolicyFields({policy:policy('Z06','217','F'),rawSegments:[...first.rawSegments,...second.rawSegments],una:first.una,scope})
        expect(result.some(value => value.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      })
      it('keeps date syntax checks active for an optional dependent date', () => {
        const result=errors(validate('Z06','508','G',[line('1','A'),...characteristic('Z13','E32'),['DTM',['354','0','806']]],scope))
        expect(result.length).toBeGreaterThan(0)
      })
    })
  }
})


describe('object identity and independent combination coverage',()=>{
  it('keeps identical object strings in different agencies distinct',()=>{
    // These are separate identities, not a multiple-register chain.
    const exact:Parts[]=[line('1','123',undefined,'9'),...characteristic('Z13','E64'),...payloadField['217'],
      line('2','123',undefined,'89'),...characteristic('Z13','Z27'),...payloadField['217']]
    const failures=errors(validate('Z09','217','F',exact))
    expect(failures).toHaveLength(1)
    expect(failures[0].description).toContain('123 / 89')
  })
  it('exhaustively checks two-object method requirements without cross-object presence borrowing',()=>{
    for(const reasonA of ['E34','E64','E32']) for(const reasonB of ['E34','E64','E32']) {
      for(const aPresent of [true,false]) for(const bPresent of [true,false]) {
        const body:Parts[]=[line('1','A'),...characteristic('Z13',reasonA),...(aPresent?payloadField['217']:[]),
          line('2','B'),...characteristic('Z13',reasonB),...(bPresent?payloadField['217']:[])]
        const expected=Number(reasonA==='E64'&&!aPresent)+Number(reasonB==='E64'&&!bPresent)
        expect(errors(validate('Z06','217','F',body))).toHaveLength(expected)
      }
    }
  })
})

describe('migrated D scoping retains global date placement checks',()=>{
  for(const scope of ['all','dependent_only'] as const) {
    it(`${scope}: optional Z06G period is not allowed in the message header`,()=>{
      const result=validate('Z06','508','G',[...payloadField['508'],line('1','A'),...characteristic('Z13','E32')],scope)
      expect(errors(result).some(issue=>issue.fieldPath==='DTM+354')).toBe(true)
    })
    it(`${scope}: a valid in-object Z09F date does not hide its header duplicate`,()=>{
      const result=validate('Z09','216','F',[...payloadField['216'],line('1','A'),...characteristic('Z13','E64'),...payloadField['216']],scope)
      expect(errors(result).some(issue=>issue.fieldPath==='DTM+157')).toBe(true)
    })
  }
})
