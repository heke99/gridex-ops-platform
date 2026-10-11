// masterplan: AT-Z03H-SUPPLIER
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {requiresBilateralProdatOutboundOwner,qualifyBilateralProdatOutboundDraft,bilateralProdatOutboundDraftQualified,createAtomicBilateralProdatOriginal,qualifyPersistedBilateralProdatOutboundOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
const rpc=vi.mocked(supabaseService.rpc),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(2)
const raw="UNB+UNOC:3+12345:14+54321:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC+9'LIN+1++735123456789012345:::9'CCI++Z13'CAV+Z25'RFF+LI:H-OWN'UNT+7+M'UNZ+1+I'"
const draft={companyId:id(1),environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',rawPayload:raw,actorUserId:id(99)} as CreateEdielMessageInput
const receipt=()=>({version:1,owner:'immutable-bilateral-prodat-outbound-profile-v1',companyId:id(1),environment:'test',actorUserId:actor,payloadHash:createHash('sha256').update(raw).digest('hex'),messageCode:'Z03',objects:[{objectId:'735123456789012345',identityAgency:'9',firstLineIndex:0,lineItemReference:'H-OWN',profileVersionId:id(3),process:'normal_start_h',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64),rulePackId:id(4),messageProfileId:id(5),pointId:id(6),customerId:id(7),siteId:id(8),contractId:id(9),contractHash:'c'.repeat(64),eventAt:'2026-10-01T12:00:00Z'}]})
beforeEach(()=>rpc.mockReset())
it('selects the native owner from physical H/LK reason fields, preserving ordinary Z03 and ACK paths',()=>{
 expect(requiresBilateralProdatOutboundOwner(draft)).toBe(true)
 const callerCache={...draft,rawPayload:raw.replace('Z25','Z22'),parsedPayload:{bilateralCapabilityVerified:true}}
 const physicalAck={...draft,messageFamily:'APERAK',rawPayload:raw.replace('PRODAT:D','APERAK:D')}
 const physicalLk={...draft,messageCode:'Z08',rawPayload:raw.replace('Z03','Z08').replace('Z25','Z23')}
 expect(requiresBilateralProdatOutboundOwner(callerCache)).toBe(false)
 expect(requiresBilateralProdatOutboundOwner(physicalAck)).toBe(false)
 expect(requiresBilateralProdatOutboundOwner(physicalLk)).toBe(true)
})
it('redeems only an exact native read capability for the actual kernel actor and whole original',async()=>{
 rpc.mockResolvedValueOnce({data:receipt(),error:null} as never)
 const q=await qualifyBilateralProdatOutboundDraft({draft,actorUserId:actor})
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_qualify_bilateral_prodat_outbound_draft_v1',{p_company_id:id(1),p_actor_user_id:actor,p_environment:'test',p_raw_payload:raw})
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:actor,qualification:q})).toBe(true)
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:actor,qualification:{...q!}})).toBe(false)
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:id(99),qualification:q})).toBe(false)
 expect(bilateralProdatOutboundDraftQualified({draft:{...draft,rawPayload:raw.replace('H-OWN','OTHER')},actorUserId:actor,qualification:q})).toBe(false)
 expect(bilateralProdatOutboundDraftQualified({draft:{...draft,companyId:id(99)},actorUserId:actor,qualification:q})).toBe(false)
})
it.each([{companyId:id(99)},{actorUserId:id(99)},{environment:'production'},{payloadHash:'f'.repeat(64)},{messageCode:'Z08'},{owner:'caller_approved'}])('native binding alteration %j cannot authorize origination',async bad=>{
 rpc.mockResolvedValueOnce({data:{...receipt(),...bad},error:null} as never)
 await expect(qualifyBilateralProdatOutboundDraft({draft,actorUserId:actor})).rejects.toThrow('receipt_unqualified')
})
it.each(['point','agency','index','li','profile','process','hash','contract','date'])('own %s alteration cannot borrow another profile or physical object',async field=>{
 const r=receipt(),o=r.objects[0]
 if(field==='point')o.objectId='735123456789012352'
 if(field==='agency')o.identityAgency='89'
 if(field==='index')o.firstLineIndex=1
 if(field==='li')o.lineItemReference='OTHER'
 if(field==='profile')o.profileVersionId='approved'
 if(field==='process')o.process='own_end_h'
 if(field==='hash')o.sourceGrammarHash='ready'
 if(field==='contract')o.contractHash='signed'
 if(field==='date')o.eventAt='2026-99-99'
 rpc.mockResolvedValueOnce({data:r,error:null} as never)
 await expect(qualifyBilateralProdatOutboundDraft({draft,actorUserId:actor})).rejects.toThrow('own_scope_required')
})
it('missing/revoked native authority holds before any original/witness create; ordinary drafts make no read call',async()=>{
 rpc.mockResolvedValueOnce({data:null,error:null} as never)
 await expect(qualifyBilateralProdatOutboundDraft({draft,actorUserId:actor})).rejects.toThrow('current_profile_required')
 expect(rpc).toHaveBeenCalledTimes(1)
 rpc.mockClear();expect(await qualifyBilateralProdatOutboundDraft({draft:{...draft,rawPayload:raw.replace('Z25','Z22')},actorUserId:actor})).toBeNull();expect(rpc).not.toHaveBeenCalled()
})
it('atomic adapter verifies the actual persisted native original and does not issue a separate witness prepare or public INSERT',async()=>{
 const message={id:id(10),company_id:id(1),environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z03',raw_payload:raw,created_by:actor,immutable_payload_hash:createHash('sha256').update(raw).digest('hex')}
 rpc.mockResolvedValueOnce({data:{version:1,message,replayed:false},error:null} as never)
 expect(await createAtomicBilateralProdatOriginal(draft,actor)).toEqual(message)
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_create_bilateral_prodat_original_v1',{p_company_id:id(1),p_actor_user_id:actor,p_draft:draft})
})
it.each([{company_id:id(99)},{created_by:id(99)},{immutable_payload_hash:'f'.repeat(64)},{raw_payload:raw.replace('H-OWN','OTHER')}])('malformed persisted original %j is rejected',async bad=>{
 const message={id:id(10),company_id:id(1),environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z03',raw_payload:raw,created_by:actor,immutable_payload_hash:createHash('sha256').update(raw).digest('hex'),...bad}
 rpc.mockResolvedValueOnce({data:{version:1,message},error:null} as never)
 await expect(createAtomicBilateralProdatOriginal(draft,actor)).rejects.toThrow('atomic_original_receipt_unqualified')
})

it('fresh persisted send qualification reads its actual private original rather than accepting row JSON or reissuing a witness',async()=>{
 const message={id:id(10),company_id:id(1),environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',raw_payload:raw,created_by:actor,parsed_payload:{bilateralCapabilityVerified:true}}
 rpc.mockResolvedValueOnce({data:{...receipt(),originalActorUserId:actor},error:null} as never)
 const q=await qualifyPersistedBilateralProdatOutboundOriginal(message as never,actor)
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_qualify_persisted_prodat_outbound_source_v1',{p_company_id:id(1),p_actor_user_id:actor,p_message_id:id(10)})
 expect(bilateralProdatOutboundDraftQualified(q)).toBe(true)
 rpc.mockResolvedValueOnce({data:null,error:null} as never)
 await expect(qualifyPersistedBilateralProdatOutboundOriginal(message as never,actor)).rejects.toThrow('current_profile_required')
})
