import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// Independent oracle: frozen P26.A r3 p22 UD parent + ten PC cells;
// p79 NAD/C082, C080, C059, 3251, 3164, 3207 descriptors.
const fields = ['227', '228', '231', '232', '316']
const familyFields = ['END_USER_GROUP', ...fields]
const subtypes = {Z06: {E:'E34', F:'E64', G:'E32'}, Z09: {E:'E34', B:'Z27', D:'Z70', F:'E64', G:'E32'}} as const
const reason = (value = 'E34') => characteristic('Z13', value)
const ud = (changes: Partial<Record<number, string | readonly string[]>> = {}): Parts => {
  const parts: (string | readonly string[])[] = ['NAD','UD',['000-CUSTOMER','','89'],'',['Synthetic','Second'],'','Town','','00123','SE']
  for (const [index,value] of Object.entries(changes)) parts[Number(index)] = value ?? ''
  return parts
}
const target = (issue: {scope?:string;description:string}) => issue.scope === 'prodat_dependent' && /Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/.test(issue.description)
function check(body: Parts[], code: 'Z06'|'Z09', alphabet: readonly string[], scope: 'payload'|'all'|'dependent_only' = 'payload', snapshot = 'F') {
  const wire = input(raw(body,code,alphabet),code)
  if (scope === 'payload') return validateProdatSubtypePayload(wire).filter(target)
  const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:snapshot,direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence'})
  return validateCanonicalPolicyFields({policy:{...policy,fieldRules:canonicalProdat26AFieldRules(code).filter(rule=>familyFields.includes(rule.fieldNumber!))},rawSegments:wire.rawSegments,una:wire.una,scope}).filter(target)
}

describe('source-bound Z06/Z09 UD conditions', () => {
  it('retains the ten original R/X cells and source-exact locators without adopting field229', () => {
    const cells = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json','utf8')) as {id:string;when:string;when_true:string;when_false:string}[]
    const descriptors = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_fields.json','utf8')) as {field:string;locator:string;source_pages:number[]}[]
    const parents = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_parent_groups.json','utf8')) as {group_id:string;notes:string;usage:Record<string,string>}[]
    const parent = parents.find(row=>row.group_id==='UD')!
    expect(parent.usage.Z06).toBe('D'); expect(parent.usage.Z09).toBe('D')
    expect(parent.notes).toContain('Elanvändaren anges i Z06E, men inte i Z06F eller Z06G.')
    expect(parent.notes).toContain('Elanvändaren anges även i Z09E men inte i Z09B, Z09D, Z09F eller Z09G.')
    expect(cells).toHaveLength(110)
    for (const code of ['Z06','Z09']) for (const field of fields) {
      expect(cells.find(c=>c.id===`PC-${field}-${code}`)).toMatchObject({when:'subtype == E',when_true:'R',when_false:'X'})
      expect(descriptors.find(d=>d.field===field)?.locator).toContain('SG17/NAD[3035=UD]')
    }
  })
  for (const code of ['Z06','Z09'] as const) {
    for (const [subtype] of Object.entries(subtypes[code])) it(`${code}${subtype}: parent and five children ignore byCell and use valid canonical subtype`, () => {
      for (const flag of [true,false]) for (const fieldNumber of familyFields) {
        expect(resolveProdatDependentCondition({messageCode:code,fieldNumber,facts:{canonicalSubtype:subtype,byCell:{[`${code}:${fieldNumber}`]:flag}}})).toMatchObject({status:subtype==='E'?'required':'not_required',requirement:subtype==='E'?'required':'forbidden'})
        expect(isProdatFieldInInapplicableParent({messageCode:code,subtype,fieldNumber})).toBe(subtype!=='E')
      }
      expect(isProdatFieldInInapplicableParent({messageCode:code,subtype,fieldNumber:'229'})).toBe(subtype!=='E')
    })
    for (const subtype of [null,'','V','Z06E','E34','UNKNOWN']) it(`${code}/${subtype}: unknown canonical subtype cannot be supplied by flags`, () => {
      for (const fieldNumber of familyFields) expect(resolveProdatDependentCondition({messageCode:code,fieldNumber,facts:{canonicalSubtype:subtype,byCell:{[`${code}:${fieldNumber}`]:true}}})?.status).toBe('undetermined')
    })
  }
})

for (const code of ['Z06','Z09'] as const) for (const alphabet of alphabets) for (const scope of ['payload','all','dependent_only'] as const) {
  describe(`${code}/${alphabet.join('')}/${scope}: parent before children in actual wire scope`, () => {
    it('requires E parent and all five values; stale F snapshot cannot suppress it', () => {
      expect(check([line('1','A'),...reason()],code,alphabet,scope).length).toBeGreaterThan(0)
      for (const element of [2,4,6,8,9]) expect(check([line('1','A'),...reason(),ud({[element]:''})],code,alphabet,scope).length).toBeGreaterThan(0)
      expect(check([line('1','A'),...reason(),ud()],code,alphabet,scope)).toEqual([])
    })
    it('forbids any UD occurrence for each non-E subtype, including empty NAD', () => {
      for (const [subtype,value] of Object.entries(subtypes[code])) {
        if (subtype==='E') continue
        expect(check([line('1','A'),...reason(value)],code,alphabet,scope,'E')).toEqual([])
        for (const group of [ud(),['NAD','UD']]) expect(check([line('1','A'),...reason(value),group],code,alphabet,scope,'E').length).toBeGreaterThan(0)
      }
    })
    it('does not borrow an E parent across objects or identity agencies', () => {
      for (const [id,agency] of [['B','89'],['A','9']]) {
        const issues = check([line('1','A'),...reason(),line('2',id,undefined,agency),...reason(),ud()],code,alphabet,scope)
        expect(issues.some(i=>i.description.includes('Objekt A / 89'))).toBe(true)
        expect(check([line('1','A'),...reason(),ud(),line('2',id,undefined,agency),...reason(),ud({2:['OTHER','','89']})],code,alphabet,scope)).toEqual([])
      }
    })
    it('validates mixed E/non-E objects independently instead of using the first subtype globally', () => {
      expect(check([line('1','A'),...reason('E64'),line('2','B'),...reason(),ud()],code,alphabet,scope)).toEqual([])
      expect(check([line('1','A'),...reason(),ud(),line('2','B'),...reason('E64')],code,alphabet,scope)).toEqual([])
    })
    it('retains missing, duplicate, aliased, cross-code, malformed and misplaced reason uncertainty', () => {
      for (const parts of [[],reason('E'),reason('V'),reason('BAD'),[...reason(),...reason()],
        [['CCI','',['Z13','BAD']],['CAV','E34']], [['CCI','','Z13'],['CAV',['E34','BAD']]],
        [['RFF',['LI','REF']],...reason()], [ud(),...reason()]] as Parts[][]) {
        expect(check([line('1','A'),...parts,...(parts.some(p=>p[0]==='NAD')?[]:[ud()])],code,alphabet,scope).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      }
    })
    it('does not hide header, duplicate or malformed UD groups beside a valid object', () => {
      for (const body of [[ud(),line('1','A'),...reason(),ud()],
        [line('1','A'),...reason(),ud(),ud()], [line('1','A'),...reason(),ud(),['NAD',['UD','EXTRA']]],
        [line('1','A'),...reason(),ud(),['NAD','ud']]] as Parts[][]) expect(check(body,code,alphabet,scope).length).toBeGreaterThan(0)
    })
    it('checks source component limits, identity/agency and unused data rather than only presence', () => {
      for (const changes of [{2:['X','SE1','89']},{2:['X','','260']},{2:['X','','89','EXTRA']},
        {2:['x'.repeat(36),'','89']},{4:['','Name2']},{4:['First','Second','Unused']},{4:'x'.repeat(36)},
        {8:'x'.repeat(10)},{8:['12345','EXTRA']},{6:'x'.repeat(36)},{9:'INVALID'},
        {3:'UNUSED'},{7:'UNUSED'},{10:'EXTRA'},{5:['','','','EXTRA']}]) {
        expect(check([line('1','A'),...reason(),ud(changes)],code,alphabet,scope).length).toBeGreaterThan(0)
      }
      for (const identity of [['0000','','89'],['0000','SE1','260'],['0000','SE2','260'],['0000','1','260']]) {
        expect(check([line('1','A'),...reason(),ud({2:identity,4:["Na:me+'?",'S'.repeat(35)],6:'City',8:'00001'})],code,alphabet,scope)).toEqual([])
      }
    })
    it('does not promote address availability into a prerequisite for these ten cells', () => {
      expect(check([line('1','A'),...reason(),ud({5:''})],code,alphabet,scope)).toEqual([])
      expect(check([line('1','A'),...reason(),ud({5:['Street','','Line3']})],code,alphabet,scope)).toEqual([])
    })
  })
}

for (const alphabet of alphabets) {
  it(`${alphabet.join('')}: Z06 first-register UD inheritance is not introduction by a later register`, () => {
    expect(check([line('1','A','1'),...reason(),ud(),line('2','A','2')],'Z06',alphabet)).toEqual([])
    for (const body of [
      [line('1','A','1'),...reason(),line('2','A','2'),ud()],
      [line('1','A','1'),...reason('E64'),line('2','A','2'),...reason(),ud()],
      [line('1','A','1'),...reason(),ud(),line('2','A','2'),ud()],
      [line('1','A','1'),...reason(),ud(),line('2','A','3')],
    ]) expect(check(body,'Z06',alphabet).length).toBeGreaterThan(0)
  })
  for (const code of ['Z06','Z09'] as const) it(`${code}/${alphabet.join('')}: later messages and header NAD cannot satisfy the first object`, () => {
    const first = raw([line('1','A'),...reason()],code,alphabet)
    const second = raw([line('1','A'),...reason(),ud()],code,alphabet)
    const firstWire = input(first,code), secondWire = input(second,code)
    const laterMessage = secondWire.rawSegments.slice(1,-1)
    expect(validateProdatSubtypePayload({...firstWire,rawSegments:[...firstWire.rawSegments.slice(0,-1),...laterMessage,...firstWire.rawSegments.slice(-1)]}).filter(target).length).toBeGreaterThan(0)
    expect(check([ud(),line('1','A'),...reason()],code,alphabet).length).toBeGreaterThan(0)
  })
}

for (const code of ['Z06','Z09'] as const) it(`${code}: inactive address does not produce false errors; active address uncertainty is not decided by root flags`, () => {
  for (const actual of ['E64','E34']) for (const staleSubtype of ['E','F']) {
    const wire = input(raw([line('1','A'),...reason(actual),...(actual==='E34'?[ud()]:[])],code),code)
    const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:staleSubtype,direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence',prodatDependentFacts:{endUserAddressAvailable:true}})
    for (const scope of ['all','dependent_only'] as const) {
      const issues = validateCanonicalPolicyFields({policy:{...policy,fieldRules:canonicalProdat26AFieldRules(code).filter(r=>r.fieldNumber==='229')},rawSegments:wire.rawSegments,una:wire.una,scope})
      if (actual==='E64') expect(issues).toEqual([])
      else expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
    }
  }
})
