// masterplan: P-06, AT-P-06
// Z13 never carries a date of birth (field 249) as customer identity; the
// inbound side reports the forbidden qualifier (ediel-prodat-aperak-text-evidence).
import {expect,it} from 'vitest'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

it('field 249 (DTM+329 date of birth) is not part of Z13/Z14/Z15/Z18 while it stays optional for Z01',()=>{
 const rule=(code:string)=>canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber==='249')!
 expect(rule('Z01').requirement).toBe('optional')
 for(const code of ['Z13','Z14','Z15','Z18'])expect(rule(code).requirement).not.toMatch(/required|optional|dependent/)
})

import {mapFacilityBusinessError} from '@/lib/energy/facilityDataErrors'
import {customerIntakeStatusForReadiness} from '@/lib/website/applicationReview'
it('protected identity is preserved: no automatic send, no retry, no customer contact, manual review and a blocked intake',()=>{
 expect(mapFacilityBusinessError('protected_identity')).toMatchObject({status:'protected_identity',retryAllowed:false,
  requiresCustomerContact:false,requiresGridOwnerContact:false,requiresSuperadminReview:true})
 expect(customerIntakeStatusForReadiness({status:'protected_identity',missingFields:[],blockingReasons:[],canStartSwitch:false} as never)).toBe('blocked')
})
