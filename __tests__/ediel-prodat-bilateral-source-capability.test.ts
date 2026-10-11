// masterplan: AT-Z04H-SUPPLIER
// masterplan: P-16, AT-P-16
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const database=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),stored:null as unknown}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:database}))
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readSourceQualifiedProdatBilateralCapability,sourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
const rpc=vi.mocked(supabaseService.rpc),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+DOC+9'LIN+1++735123456789012345:::9'RFF+LI:OWN-A'LIN+2++735123456789012352:::9'RFF+LI:OWN-B'UNT+7+M'UNZ+1+I'"
const payloadHash=createHash('sha256').update(raw).digest('hex')
const receivedContext={version:1,contextOrigin:'database_insert',sourceMessageId:id(1),companyId:id(2),environment:'test',messageCode:'Z04',payloadHash,sourceReceivedAt:'2026-10-01T12:01:00Z',capturedAt:'2026-10-01T12:01:00Z'}
const row={id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',raw_payload:raw,
 message_created_at:'2026-10-01T12:00:00Z',message_received_at:'2026-10-01T12:01:00Z',created_at:'2026-10-01T12:01:00Z',execution_context_snapshot:{receivedProdatContext:receivedContext}} as EdielMessageRow
const receipt=()=>({version:1,owner:'immutable-bilateral-prodat-profile-v1',companyId:row.company_id,environment:row.environment,sourceMessageId:row.id,sourcePayloadHash:createHash('sha256').update(raw).digest('hex'),messageCode:'Z04',subtype:'H',objects:['735123456789012345','735123456789012352'].map((objectId,index)=>({objectId,identityAgency:'9',firstLineIndex:index,lineItemReference:index?'OWN-B':'OWN-A',profileVersionId:id(3),process:'normal_start_h',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64)}))})
beforeEach(()=>{
 rpc.mockReset();database.from.mockReset();database.stored=structuredClone(row)
 database.from.mockImplementation(()=>{
  const query={select:vi.fn(),eq:vi.fn(),single:vi.fn(),maybeSingle:vi.fn()}
  query.select.mockReturnValue(query);query.eq.mockReturnValue(query)
  query.single.mockImplementation(async()=>({data:database.stored,error:null}))
  query.maybeSingle.mockImplementation(async()=>({data:database.stored,error:null}))
  return query
 })
})
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

const alteredSourceRows:readonly [string,Partial<EdielMessageRow>][]=[
 ['receipt clock',{message_received_at:'2026-10-02T12:01:00Z'}],
 ['document clock',{message_created_at:'2026-10-02T12:00:00Z'}],
 ['persistence clock',{created_at:'2026-10-02T12:01:00Z'}],
 ['association/version',{message_version:'E2SE5A'}],
 ['application reference',{application_reference:'27-DDQ-PRODAT'}],
 ['direction',{direction:'outbound'}],
 ['standard',{message_standard:'xml'}],
 ['company',{company_id:id(9)}],
 ['environment',{environment:'production'}],
 ['raw bytes',{raw_payload:raw.replace('OWN-A','FOREIGN')}],
 ['family',{message_family:'UTILTS'}],
 ['received context version',{execution_context_snapshot:{receivedProdatContext:{...receivedContext,version:2}}}],
 ['received context clock',{execution_context_snapshot:{receivedProdatContext:{...receivedContext,sourceReceivedAt:'2026-10-02T12:01:00Z'}}}],
 ['received context hash',{execution_context_snapshot:{receivedProdatContext:{...receivedContext,payloadHash:'f'.repeat(64)}}}],
 ['received context identity',{execution_context_snapshot:{receivedProdatContext:{...receivedContext,sourceMessageId:id(9)}}}],
 ['received context origin',{execution_context_snapshot:{receivedProdatContext:{...receivedContext,contextOrigin:'caller'}}}],
]

it.each(alteredSourceRows)('a capability cannot redeem an altered %s',async(_name,patch)=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const qualified=await readSourceQualifiedProdatBilateralCapability(row)
 expect(qualified).not.toBeNull()
 expect(sourceQualifiedProdatBilateralCapability({...row,...patch},qualified)).toBeNull()
})

it.each(alteredSourceRows.filter(([name])=>!['direction','standard','family'].includes(name)))('initial caller-forged %s cannot become protected source authority',async(_name,patch)=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 // The native receipt refers to the unchanged stored original. Capturing the
 // caller's initial metadata in a WeakMap would still accept this forgery.
 const result=await readSourceQualifiedProdatBilateralCapability({...row,...patch}).catch(()=>null)
 expect(result).toBeNull()
})

it('qualified minting also reads the actual persisted original metadata',async()=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 expect(await readSourceQualifiedProdatBilateralCapability(row)).not.toBeNull()
 expect(database.from).toHaveBeenCalledWith('ediel_messages')
})

it('equivalent UTC clock spellings preserve authenticated minting and redemption',async()=>{
 const equivalent={...row,message_created_at:'2026-10-01T14:00:00+02:00',message_received_at:'2026-10-01T14:01:00+02:00',created_at:'2026-10-01T14:01:00+02:00',
  execution_context_snapshot:{receivedProdatContext:{...receivedContext,sourceReceivedAt:'2026-10-01T14:01:00+02:00',capturedAt:'2026-10-01T14:01:00+02:00'}}}
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const qualified=await readSourceQualifiedProdatBilateralCapability(equivalent)
 expect(qualified).not.toBeNull()
 expect(sourceQualifiedProdatBilateralCapability(row,qualified)).toBe(qualified)
 expect(sourceQualifiedProdatBilateralCapability(equivalent,qualified)).toBe(qualified)
})

const contextBoundaryChanges=[
 ['an extra context key',{...receivedContext,extra:'caller'}],
 ['one microsecond of captured time',{...receivedContext,capturedAt:'2026-10-01T12:01:00.000001Z'}],
] as const

it.each(contextBoundaryChanges)('initial %s cannot become authenticated insertion context',async(_name,context)=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const caller={...row,execution_context_snapshot:{receivedProdatContext:context}}
 expect(await readSourceQualifiedProdatBilateralCapability(caller).catch(()=>null)).toBeNull()
})

it.each(contextBoundaryChanges)('a minted capability cannot redeem with %s',async(_name,context)=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const qualified=await readSourceQualifiedProdatBilateralCapability(row)
 expect(qualified).not.toBeNull()
 expect(sourceQualifiedProdatBilateralCapability({...row,execution_context_snapshot:{receivedProdatContext:context}},qualified)).toBeNull()
})
