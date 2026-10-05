// masterplan: P-16, AT-P-16
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readSourceQualifiedProdatBilateralCapability,sourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
const rpc=vi.mocked(supabaseService.rpc),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+DOC+9'LIN+1++735123456789012345:::9'RFF+LI:OWN-A'LIN+2++735123456789012352:::9'RFF+LI:OWN-B'UNT+7+M'UNZ+1+I'"
const row={id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04',raw_payload:raw} as EdielMessageRow
const receipt=()=>({version:1,owner:'immutable-bilateral-prodat-profile-v1',companyId:row.company_id,environment:row.environment,sourceMessageId:row.id,sourcePayloadHash:createHash('sha256').update(raw).digest('hex'),messageCode:'Z04',subtype:'H',objects:['735123456789012345','735123456789012352'].map((objectId,index)=>({objectId,identityAgency:'9',firstLineIndex:index,lineItemReference:index?'OWN-B':'OWN-A',profileVersionId:id(3),process:'normal_start_h',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64)}))})
beforeEach(()=>rpc.mockReset())
it('redeems only the exact returned protected source/own physical capability; copied public JSON and altered source cannot redeem it',async()=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const qualified=await readSourceQualifiedProdatBilateralCapability(row)
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_prodat_bilateral_source_capability_v1',{p_company_id:row.company_id,p_source_message_id:row.id})
 expect(sourceQualifiedProdatBilateralCapability(row,qualified)).toBe(qualified)
 expect(sourceQualifiedProdatBilateralCapability(row,{...qualified!})).toBeNull()
 expect(sourceQualifiedProdatBilateralCapability({...row,raw_payload:raw.replace('OWN-A','FOREIGN')},qualified)).toBeNull()
 expect(sourceQualifiedProdatBilateralCapability({...row,company_id:id(9)},qualified)).toBeNull()
})
it.each([{companyId:id(9)},{sourceMessageId:id(9)},{environment:'production'},{sourcePayloadHash:'f'.repeat(64)},{owner:'caller_ready'},{subtype:'A'}])('malformed native source binding %j never creates a capability',async bad=>{
 rpc.mockResolvedValueOnce({data:{...receipt(),...bad},error:null} as never)
 await expect(readSourceQualifiedProdatBilateralCapability(row)).rejects.toThrow(/unqualified|required/)
})
it.each(['index','li','point','agency','profile','process','hash'])('altered own %s cannot borrow sibling authority',async field=>{
 const r=receipt(),own=r.objects[0]
 if(field==='index')own.firstLineIndex=1
 if(field==='li')own.lineItemReference='OWN-B'
 if(field==='point')own.objectId=r.objects[1].objectId
 if(field==='agency')own.identityAgency='89'
 if(field==='profile')own.profileVersionId='approved'
 if(field==='process')own.process='assigned_supply'
 if(field==='hash')own.sourceGrammarHash='public-ready'
 rpc.mockResolvedValueOnce({data:r,error:null} as never)
 await expect(readSourceQualifiedProdatBilateralCapability(row)).rejects.toThrow('own_physical_scope_required')
})
it('a missing immutable current authority stays null; outbound/caller-only IDs make no native call',async()=>{
 rpc.mockResolvedValueOnce({data:null,error:null} as never)
 expect(await readSourceQualifiedProdatBilateralCapability(row)).toBeNull()
 rpc.mockClear();expect(await readSourceQualifiedProdatBilateralCapability({...row,id:'caller-id'})).toBeNull()
 expect(await readSourceQualifiedProdatBilateralCapability({...row,direction:'outbound'})).toBeNull();expect(rpc).not.toHaveBeenCalled()
})
it('the complete physical scope is required, including both own first registers',async()=>{
 rpc.mockResolvedValueOnce({data:{...receipt(),objects:receipt().objects.slice(0,1)},error:null} as never)
 await expect(readSourceQualifiedProdatBilateralCapability(row)).rejects.toThrow('whole_physical_scope_required')
})
