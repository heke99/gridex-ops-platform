import { describe, expect, it } from 'vitest'
import { ud } from './fixtures/prodat-ud'
import { readFileSync } from 'node:fs'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { PRODAT_SOURCE_SUBTYPE_REQUIREMENTS } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// Independent oracle: frozen P26.A r3 p22 parent/usage, p79 NAD components.
// This unit does not claim full field229 address-evidence qualification.
const fields = ['227', '228', '231', '232', '316'] as const
const codes = ['Z06', 'Z09'] as const
const reasons = { E: 'E34', F: 'E64', G: 'E32', B: 'Z27', D: 'Z70' } as const
const otherSubtypes = { Z06: ['F', 'G'], Z09: ['B', 'D', 'F', 'G'] } as const
const reason = (value = 'E34') => characteristic('Z13', value)

const protectedUd = (issue: {scope?: string; description: string; code: string}) =>
  issue.scope === 'prodat_dependent' && /Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)\b/.test(issue.description)
function check(body: Parts[], code: typeof codes[number], alphabet: readonly string[], mode: 'payload' | 'all' | 'dependent_only' = 'payload') {
  const wire = input(raw(body, code, alphabet), code)
  if (mode === 'payload') return validateProdatSubtypePayload(wire).filter(protectedUd)
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: 'F',
    direction: 'outbound', referenceDate: '2026-09-19', mode: 'catalog_evidence',
    prodatDependentFacts: { canonicalSubtype: 'F', byCell: Object.fromEntries([...fields, 'END_USER_GROUP'].map(f => [`${code}:${f}`, false])) } })
  return validateCanonicalPolicyFields({ policy, rawSegments: wire.rawSegments, una: wire.una, scope: mode }).filter(protectedUd)
}

describe('UD immutable source outcomes, never byCell authority', () => {
  it('binds exactly the ten unchanged numeric projections to E/R and non-E/X', () => {
    const cells = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json', 'utf8')) as {id: string; when: string; when_true: string; when_false: string}[]
    for (const code of codes) for (const field of fields) {
      expect(cells.find(cell => cell.id === `PC-${field}-${code}`)).toMatchObject({when:'subtype == E',when_true:'R',when_false:'X'})
      const source = PRODAT_SOURCE_SUBTYPE_REQUIREMENTS.find(r => r.messageCode === code && r.fieldNumber === field)
      expect(source).toBeDefined()
      expect(Object.isFrozen(source)).toBe(true)
      expect(Object.isFrozen(source!.outcomes)).toBe(true)
    }
  })
  for (const code of codes) for (const field of fields) {
    it(`${code}:${field} has exact positive, forbidden and unknown branches`, () => {
      for (const byCell of [true, false]) {
        const evaluate = (subtype: unknown) => resolveProdatDependentCondition({messageCode:code,fieldNumber:field,
          facts:{canonicalSubtype:subtype as string,byCell:{[`${code}:${field}`]:byCell}}})
        expect(evaluate('E')).toMatchObject({status:'required',requirement:'required'})
        for (const subtype of otherSubtypes[code]) expect(evaluate(subtype)).toMatchObject({status:'not_required',requirement:'forbidden'})
        for (const subtype of [null,'','V','Z22','E34',false,{},'N']) expect(evaluate(subtype)).toMatchObject({status:'undetermined',requirement:'undetermined'})
      }
    })
  }
  it('parent applicability keeps Z14N and unrelated parents independent', () => {
    for (const code of codes) for (const subtype of otherSubtypes[code]) {
      for (const fieldNumber of ['END_USER_GROUP', ...fields, '229']) expect(isProdatFieldInInapplicableParent({messageCode:code,subtype,fieldNumber})).toBe(true)
      expect(isProdatFieldInInapplicableParent({messageCode:code,subtype,fieldNumber:'INVOICEE_GROUP'})).toBe(false)
    }
    for (const subtype of ['E','V','E34',null]) expect(isProdatFieldInInapplicableParent({messageCode:'Z06',subtype,fieldNumber:'END_USER_GROUP'})).toBe(false)
    expect(isProdatFieldInInapplicableParent({messageCode:'Z14',subtype:'N',fieldNumber:'316'})).toBe(true)
    expect(isProdatFieldInInapplicableParent({messageCode:'Z14',subtype:'N',fieldNumber:'INSTALLATION_GROUP'})).toBe(true)
    expect(isProdatFieldInInapplicableParent({messageCode:'Z14',subtype:'V',fieldNumber:'END_USER_GROUP'})).toBe(false)
  })
})

for (const code of codes) for (const alphabet of alphabets) for (const mode of ['payload','all','dependent_only'] as const) {
  describe(`${code}/${alphabet.join('')}/${mode}: source-selected UD`, () => {
    const checkBody = (body: Parts[]) => check(body, code, alphabet, mode)
    it('requires E parent and all five children; ignores wrong root F snapshot', () => {
      expect(checkBody([line('1','A'),...reason()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A'),...reason(),ud()])).toEqual([])
      for (const element of [2,4,8,6,9]) expect(checkBody([line('1','A'),...reason(),ud({[element]:''})]).length).toBeGreaterThan(0)
    })
    it('forbids non-E parent even when empty or otherwise valid', () => {
      for (const subtype of otherSubtypes[code]) {
        expect(checkBody([line('1','A'),...reason(reasons[subtype])])).toEqual([])
        for (const group of [ud(), ['NAD','UD']]) expect(checkBody([line('1','A'),...reason(reasons[subtype]),group]).length).toBeGreaterThan(0)
      }
    })
    it('preserves decoded an text, leading zero postcode, agency and source maxima', () => {
      for (const identity of [['0A:B+?\'','SE1','260'],['000-ID','','89']]) {
        expect(checkBody([line('1','A'),...reason(),ud({2:identity,4:['A'.repeat(35),'B'.repeat(35)],6:'C'.repeat(35),8:'000000001',9:'SWE'})])).toEqual([])
      }
      expect(checkBody([line('1','A'),...reason(),ud({5:''})])).toEqual([]) // availability unknown != protocol absence
    })
    it('rejects malformed identity/name/city/postcode/country and unused components', () => {
      for (const change of [
        {2:['X','SE1','89']},{2:['X','','260']},{2:['X','SE1','260','X']},{2:'X'.repeat(36)},
        {4:['','Second']},{4:['First','Second','Third']},{4:'X'.repeat(36)},
        {6:['Town','Other']},{6:'X'.repeat(36)},{8:'0000000000'},{8:['00123','Other']},
        {9:'SWED'},{9:'swe'},{3:'UNUSED'},{7:'UNUSED'},{10:'EXTRA'},
      ] as Record<number,string|string[]>[]) expect(checkBody([line('1','A'),...reason(),ud(change)]).length).toBeGreaterThan(0)
    })
    it('checks decoded component widths before trimming, including id qualifier and agency', () => {
      for (const change of [
        {2:[' '+ 'I'.repeat(35),'','89']}, {2:['ID','SE1 ','260']}, {2:['ID','','89  ']},
        {4:[' '+ 'N'.repeat(35),'Second']}, {5:' '+ 'A'.repeat(35)},
        {6:' '+ 'C'.repeat(35)}, {8:' '+ '0'.repeat(9)}, {9:' SE '}, {9:' SE'},
      ] as Record<number,string|string[]>[]) expect(checkBody([line('1','A'),...reason(),ud(change)]).length).toBeGreaterThan(0)
    })
    it('rejects malformed/duplicate parents without losing them through narrowing', () => {
      for (const body of [
        [line('1','A'),...reason(),ud(),ud()],
        [line('1','A'),...reason(),ud({1:['UD','EXTRA']})],
        [ud(),line('1','A'),...reason(),ud()],
        [line('1','A'),...reason(),['NAD','IV','OTHER']],
      ] as Parts[][]) expect(checkBody(body).length).toBeGreaterThan(0)
    })
    it('cannot borrow another object or another identity agency parent/reason', () => {
      expect(checkBody([line('1','A'),...reason(),line('2','B'),...reason(),ud()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A',undefined,'89'),...reason(),ud(),line('2','A',undefined,'9'),...reason()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A'),ud(),line('2','B'),...reason(),ud()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A'),...reason(),ud(),line('2','B'),...reason(reasons.F)])).toEqual([])
    })
    it('keeps missing, duplicate, aliased, cross-code or misplaced reason unknown', () => {
      for (const badReason of [[],reason('E'),reason('Z22'),reason('Z96'),[...reason(),...reason()],
        [['CCI','','Z13']], [['CCI','','Z13'],['CAV',['E34','EXTRA']]],
        [['CCI','EXTRA','Z13'],['CAV','E34']], [['CCI','',['Z13','EXTRA']],['CAV','E34']],
        [...reason(),['CAV','E34']], [['RFF',['LI','CASE']],...reason()],
      ] as Parts[][]) expect(checkBody([line('1','A'),...badReason,ud()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A'),ud(),...reason()]).length).toBeGreaterThan(0)
    })
    if (code === 'Z06') it('uses register1 once and still detects prohibited later-register UD', () => {
      expect(checkBody([line('1','A','1'),...reason(),ud(),line('2','A','2')])).toEqual([])
      expect(checkBody([line('1','A','1'),...reason(),line('2','A','2'),ud()]).length).toBeGreaterThan(0)
      expect(checkBody([line('1','A','1'),...reason(reasons.F),line('2','A','2'),ud()]).length).toBeGreaterThan(0)
    })
  })
}

describe('UD retained parent source and envelope boundaries', () => {
  it('reads the unchanged page22 parent note rather than treating child D as parent evidence', () => {
    const tables = JSON.parse(readFileSync('docs/ediel/masterplan-v2/annex/source_tables.json', 'utf8')) as {source:string;page:number;rows:string[][]}[]
    const page = tables.find(table => table.source === 'P' && table.page === 22)!
    const parent = page.rows.find(row => row[1] === 'End user')!
    const note = parent.at(-1)!.replace(/\s+/g,' ')
    expect(note).toContain('Elanvändaren anges i Z06E, men inte i Z06F eller Z06G')
    expect(note).toContain('Elanvändaren anges även i Z09E men inte i Z09B, Z09D, Z09F eller Z09G')
    for (const code of codes) {
      expect(parent[page.rows[0].indexOf(code)]).toBe('D')
      for (const subtype of ['E',...otherSubtypes[code]]) for (const flag of [true,false]) {
        expect(resolveProdatDependentCondition({messageCode:code,fieldNumber:'END_USER_GROUP',facts:{canonicalSubtype:subtype,byCell:{[`${code}:END_USER_GROUP`]:flag}}}))
          .toMatchObject({requirement:subtype==='E'?'required':'forbidden'})
      }
    }
  })
  for (const code of codes) for (const alphabet of alphabets) {
    it(`${code}/${alphabet.join('')}: only a genuinely detached fragment can omit the LIN envelope`, () => {
      const full = input(raw([...reason(),ud()],code,alphabet),code)
      expect(validateProdatSubtypePayload(full).filter(protectedUd).length).toBeGreaterThan(0)
      const fragment = {...full,rawSegments:full.rawSegments.filter(segment => ['CCI','CAV','NAD'].includes(segment.split(alphabet[1])[0]))}
      expect(validateProdatSubtypePayload(fragment).filter(protectedUd)).toEqual([])
      expect(validateProdatSubtypePayload({...fragment,rawSegments:fragment.rawSegments.filter(s=>s.startsWith('NAD'))}).filter(protectedUd).length).toBeGreaterThan(0)
    })
    it(`${code}/${alphabet.join('')}: an invalid register chain cannot inherit a sibling E/UD parent`, () => {
      // Duplicated register index is invalid; each actual scope must stand alone.
      expect(check([line('1','A','1'),...reason(),ud(),line('2','A','1')],code,alphabet).length).toBeGreaterThan(0)
      expect(check([line('1','A','1'),...reason(),line('2','A','1'),ud()],code,alphabet).length).toBeGreaterThan(0)
    })
    it(`${code}/${alphabet.join('')}: released syntax-looking name text is data, while reason extras are not authority`, () => {
      const [,element,,terminator] = alphabet
      expect(check([line('1','A'),...reason(),ud({4:`Name${terminator}NAD${element}UD`})],code,alphabet)).toEqual([])
      for (const extra of [
        [['CCI','','Z13','EXTRA'],['CAV','E34']],
        [['CCI','','Z13'],['CAV','E34','EXTRA']],
        [['CCI','','z13'],['CAV','E34']],
      ] as Parts[][]) expect(check([line('1','A'),...extra,ud()],code,alphabet).length).toBeGreaterThan(0)
    })
  }
})
