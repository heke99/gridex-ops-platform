import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({read:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/ediel/core/ackDraftSource',()=>({readExistingAckBeforeDraft:io.read}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {isQualifiedProdatApplicationError,projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {EdielMessageRow} from '@/lib/ediel/types'
const actor='10000000-0000-4000-8000-000000000001'
function message(document='DOC',installation='E22'){
 const raw_payload=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',interchangeReference:'ORIGINAL-I',acknowledgementRequest:true,messages:[{messageReference:'ORIGINAL-M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:[`BGM+Z04+${document}+9+AB`,'DTM+137:202610091200:203','DTM+ZZZ:1:805','NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE','LIN+1++735999999999999999:::9','DTM+92:202610150000:203','CCI++Z13','CAV+Z22','CCI++Z07',`CAV+${installation}`,'RFF+LI:OWN-LI','RFF+Z05:TES','NAD+UD+5566778899:SE1:260++Synthetic+Street+City++12345+SE']} ]})
 return {id:'10000000-0000-4000-8000-000000000002',company_id:'10000000-0000-4000-8000-000000000003',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',environment:'test',raw_payload,parsed_payload:{documentReference:'CACHED-DOC',bgmReference:'CACHED-DOC'},external_reference:'CACHED-DOC',sender_ediel_id:'12345',receiver_ediel_id:'54321',application_reference:'23-DDQ-PRODAT',message_received_at:'2026-10-09T12:00:00Z',created_at:'2026-10-09T12:00:00Z'} as unknown as EdielMessageRow
}
function errors(source:EdielMessageRow,field:string){const wire=tokenizeEdifact(source.raw_payload!);const rules=canonicalProdat26AFieldRules('Z04').filter(rule=>rule.fieldNumber===field);expect(rules).toHaveLength(1);const result=projectProdatDiagnostics(validateFieldMatrixPayload({direction:'inbound',mode:'parse',family:'PRODAT',code:'Z04',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,applicationReference:'23-DDQ-PRODAT'},rules));expect(result.disposition.kind).toBe('continue');expect(result.applicationErrors).toHaveLength(1);expect(isQualifiedProdatApplicationError(result.applicationErrors[0])).toBe(true);return result.applicationErrors}
beforeEach(()=>{vi.clearAllMocks();io.read.mockResolvedValue(null);io.rpc.mockImplementation(()=>{throw Error('unexpected DB external port')});io.from.mockImplementation(()=>{throw Error('unexpected DB external port')})})
it('fresh real missing203 preparation retains the same A255 hold as the actual renderer, with no physical substitute',async()=>{
 const source=message(''),applicationErrors=errors(source,'203'),seal=JSON.stringify(source)
 expect(applicationErrors).toEqual([expect.objectContaining({fieldCode:'203',ercCode:'41',prodatOccurrence:expect.objectContaining({scope:'header'})})])
 expect(()=>buildAperakDraft({actorUserId:actor,sourceMessage:source,outcome:'negative',applicationErrors})).toThrow('aperak_prodat_document_reference_required')
 await expect(prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).rejects.toThrow('aperak_prodat_document_reference_required')
 expect(io.read).toHaveBeenCalledTimes(1);expect(io.read.mock.calls[0][0].ackScope).toBe('message');expect(JSON.stringify(source)).toBe(seal);expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})
it('whole protected existing original is returned before fresh missing203 diagnostics',async()=>{
 const source=message(''),applicationErrors=errors(source,'203'),original={id:'retained-whole',raw_payload:'unchanged actual retained original',status:'sent'} as EdielMessageRow
 io.read.mockResolvedValue(original)
 expect(await prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).toEqual({kind:'existing',message:original});expect(io.read).toHaveBeenCalledTimes(1);expect(io.rpc).not.toHaveBeenCalled()
})
it('current protected-original refusal still wins and produces no fresh rendering',async()=>{
 const source=message(''),applicationErrors=errors(source,'203');io.read.mockRejectedValue(Error('current protected actor refused'))
 await expect(prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).rejects.toThrow('current protected actor refused');expect(io.read).toHaveBeenCalledTimes(1);expect(io.rpc).not.toHaveBeenCalled()
})
it('real invalid306 retains its own source scope and physical ERC42 response under real preparer and renderer',async()=>{
 const source=message('DOC','E22'),applicationErrors=errors(source,'306'),seal=JSON.stringify(source)
 expect(applicationErrors).toEqual([expect.objectContaining({fieldCode:'306',ercCode:'42',text:'Felaktigt Installationsstatus E22',prodatOccurrence:expect.objectContaining({objectId:'735999999999999999',lineItemReference:'OWN-LI'})})])
 const result=await prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors});expect(result.kind).toBe('draft');if(result.kind!=='draft')throw Error('fresh synthetic response not rendered')
 const wire=tokenizeEdifact(result.draft.rawPayload!),part=(tag:string,n:number)=>segmentComposite(wire.segments.find(s=>s.tag===tag),n,wire.una)
 expect(part('BGM',3)).toEqual(['34']);expect(part('ERC',1)).toEqual(['42','','260']);expect(part('FTX',3)).toEqual(['306','','260']);expect(part('FTX',4)).toEqual(['Felaktigt Installationsstatus E22']);expect(wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una))).toEqual([['ACW','DOC'],['Z07','735999999999999999'],['LI','OWN-LI']]);expect(JSON.stringify(source)).toBe(seal);expect(io.read.mock.calls.map(([p])=>p.ackScope)).toEqual(['message','object']);expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})

it('protected object replay survives missing document before any fresh hold',async()=>{
 const source=message(''),applicationErrors=errors(source,'306'),original={id:'retained-object',status:'sent',raw_payload:'retained physical response'} as EdielMessageRow
 io.read.mockResolvedValueOnce(null).mockResolvedValueOnce(original)
 expect(await prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).toEqual({kind:'existing',message:original})
 expect(io.read.mock.calls.map(([input])=>input.ackScope)).toEqual(['message','object']);expect(io.rpc).not.toHaveBeenCalled()
})
it('protected object read denial wins over fresh absent-document hold',async()=>{
 const source=message(''),applicationErrors=errors(source,'306')
 io.read.mockResolvedValueOnce(null).mockRejectedValueOnce(Error('protected object actor refused'))
 await expect(prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).rejects.toThrow('protected object actor refused')
 expect(io.read.mock.calls.map(([input])=>input.ackScope)).toEqual(['message','object']);expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['X'.repeat(36),'X'.repeat(120)])('present historical document retains protected object replay: %s',async document=>{
 const source=message(document),applicationErrors=errors(source,'306'),original={id:'historical-object',status:'sent',raw_payload:'retained original'} as EdielMessageRow
 io.read.mockResolvedValueOnce(null).mockResolvedValueOnce(original)
 expect(await prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).toEqual({kind:'existing',message:original})
 expect(io.read.mock.calls.map(([input])=>input.ackScope)).toEqual(['message','object']);expect(io.rpc).not.toHaveBeenCalled()
})
