import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {serviceEvidenceArchiveSchema} from '@/lib/ediel/services/evidenceReview'
const submission={assignmentId:'11111111-1111-4111-8111-111111111111',scopeBasisVersion:1,kind:'end_user_contract',terms:{valid_from:'2026-01-01T00:00:00Z',valid_to:null,permission_agreement_reference:'OWN-SIGNED-AGREEMENT',permission_requested_method:'Z04'},source:{bytesBase64:Buffer.from('%PDF-1.7 synthetic fixture').toString('base64'),mimeType:'application/pdf',reference:'declared-actual-source-reference',version:'v1'}}
describe('authenticated source permission term DTO, no authority minted by schema',()=>{
 it.each(['Z03','Z04'])('retains actual requested method %s and exact agreement reference for the native byte seal',method=>expect(serviceEvidenceArchiveSchema.parse({...submission,terms:{...submission.terms,permission_requested_method:method}}).terms).toMatchObject({permission_requested_method:method,permission_agreement_reference:'OWN-SIGNED-AGREEMENT'}))
 it.each(['E58','F','G','Z04 ',''])('refuses unsupported or altered wire method %s',method=>expect(()=>serviceEvidenceArchiveSchema.parse({...submission,terms:{...submission.terms,permission_requested_method:method}})).toThrow())
 it.each([' padded','padded ','','x'.repeat(36)])('refuses noncanonical agreement reference %s',reference=>expect(()=>serviceEvidenceArchiveSchema.parse({...submission,terms:{...submission.terms,permission_agreement_reference:reference}})).toThrow())
 it('keeps an absent term absent without deriving an agreement or method',()=>{const got=serviceEvidenceArchiveSchema.parse({...submission,terms:{valid_from:submission.terms.valid_from,valid_to:null}});expect(got.terms.permission_agreement_reference).toBeUndefined();expect(got.terms.permission_requested_method).toBeUndefined()})
 it('refuses a caller success flag',()=>expect(()=>serviceEvidenceArchiveSchema.parse({...submission,terms:{...submission.terms,authenticated:true}})).toThrow())
})
