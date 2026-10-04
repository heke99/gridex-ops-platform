// masterplan: P-06
// Z13 never carries a date of birth (field 249) as customer identity; the
// inbound side reports the forbidden qualifier (ediel-prodat-aperak-text-evidence).
import {expect,it} from 'vitest'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

it('field 249 (DTM+329 date of birth) is not part of Z13/Z14/Z15/Z18 while it stays optional for Z01',()=>{
 const rule=(code:string)=>canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber==='249')!
 expect(rule('Z01').requirement).toBe('optional')
 for(const code of ['Z13','Z14','Z15','Z18'])expect(rule(code).requirement).not.toMatch(/required|optional|dependent/)
})
