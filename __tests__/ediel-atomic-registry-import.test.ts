// masterplan: IMP-01, AT-IMP-01
import {describe,it,expect,vi,beforeEach} from 'vitest'
import {createHash} from 'node:crypto'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {applyActorRegistryRecords,decodeRegistryUpload,importActorRegistryXml} from '@/lib/actor-registry/importActorRegistry'
const actorUserId='00000000-0000-4000-8000-000000000001'
const routedCompany='<Company><Name>Synthetic routed actor</Name><Identifiers><Key Type="EdielId">21660</Key></Identifiers><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId><CommunicationAddress Type="SMTP">synthetic@example.invalid</CommunicationAddress></EDIFACTDetails></Company>'
const market=(companies:string)=>`<CompanyListMessage><Market Code="EL" Country="SE">${companies}</Market></CompanyListMessage>`
describe('actual atomic registry producer source boundary',()=>{
 beforeEach(()=>{rpc.mockReset();rpc.mockImplementation(async(name:string)=>({data:name==='ediel_read_actor_registry_batch_v1'?null:{importRunId:'run',uiRunId:'ui',totalRecords:1,created:1,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held'},error:null}))})
 it('retains exact declared Latin1 upload bytes independently of parsed Unicode',async()=>{
  const bytes=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Market Code="EL" Country="SE"><Company><Name>Å Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>','latin1')
  const xml=decodeRegistryUpload(bytes,'companies_xml')
  expect(xml).toContain('Å Synthetic')
  await applyActorRegistryRecords({sourceBytes:bytes,sourceKind:'companies_xml',actorUserId,actors:[{name:'Å Synthetic',countryCode:'SE',market:'EL',edielId:'21660',roles:[],routes:[],certificates:[],raw:{fixture:true}}]})
  expect(rpc).toHaveBeenCalledTimes(2)
  const [name,args]=rpc.mock.calls[1]
  expect(name).toBe('ediel_apply_actor_registry_v1');expect(Buffer.from(args.p_source_base64,'base64')).toEqual(bytes)
  expect(args.p_source_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
 })
 it('rejects undecodable or unimplemented source encodings before database apply',()=>{
  expect(()=>decodeRegistryUpload(Buffer.from([0xff]),'csv')).toThrow()
  expect(()=>decodeRegistryUpload(Buffer.from('<?xml version="1.0" encoding="UNKNOWN"?><Root/>'),'companies_xml')).toThrow('encoding_adapter_required')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('retains exact uploaded Latin1 bytes through the actual shared XML producer',async()=>{
  const bytes=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Market Code="EL" Country="SE"><Company><Name>Å Synthetic</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress Type="SMTP">synthetic@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>','latin1')
  await importActorRegistryXml({xml:decodeRegistryUpload(bytes,'companies_xml'),sourceBytes:bytes,uploadedBy:actorUserId})
  const args=rpc.mock.calls[1][1]
  expect(Buffer.from(args.p_source_base64,'base64')).toEqual(bytes)
  expect(args.p_source_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(args.p_records[0]).toMatchObject({name:'Å Synthetic',edielId:'21660',routes:[expect.objectContaining({messageFamily:'PRODAT',communicationAddress:'synthetic@example.invalid'})]})
 })
 it('holds a text/byte mismatch before any native import',async()=>{
  const bytes=Buffer.from('<Root/>')
  await expect(importActorRegistryXml({xml:'<Different/>',sourceBytes:bytes,uploadedBy:actorUserId})).rejects.toThrow('ediel_registry_source_bytes_text_mismatch')
  expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0][0]).toBe('ediel_read_actor_registry_batch_v1')
 })
 it('uses one atomic RPC for shared XML import even when old force reprocess was requested',async()=>{
  await importActorRegistryXml({xml:'<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>',uploadedBy:actorUserId,forceReprocess:true})
  expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls[1][1].p_records[0]).toMatchObject({edielId:'21660',market:'EL'})
 })
 it('requires a real actor and propagates atomic database failures without partial fallback',async()=>{
  await expect(importActorRegistryXml({xml:'<Root/>'})).rejects.toThrow('platform_actor_required')
  rpc.mockResolvedValue({data:null,error:{code:'23505',message:'source identity conflict'}})
  await expect(applyActorRegistryRecords({sourceBytes:'fixture',sourceKind:'csv',actorUserId,actors:[]})).rejects.toMatchObject({code:'23505'})
  expect(rpc).toHaveBeenCalledOnce()
 })
 it('holds a zero-route historical result without replacing its immutable batch',async()=>{
  rpc.mockResolvedValue({data:{importRunId:'old-run',uiRunId:'old-ui',totalRecords:1,created:1,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:[],activation:'held',reusedExistingRun:true},error:null})
  await expect(importActorRegistryXml({xml:'<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>',uploadedBy:actorUserId})).rejects.toThrow('ediel_registry_zero_routes_source_held')
  expect(rpc).toHaveBeenCalledOnce()
 })
 it('reads the exact frozen old source result before a current parser can reject its previous format',async()=>{
  const prior={importRunId:'old-run',uiRunId:'old-ui',totalRecords:2,created:2,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held',reusedExistingRun:true}
  rpc.mockResolvedValue({data:prior,error:null})
  await expect(importActorRegistryXml({xml:'<PreviousRegistryFormat/>',uploadedBy:actorUserId,forceReprocess:true})).resolves.toEqual(prior)
  expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0][0]).toBe('ediel_read_actor_registry_batch_v1')
 })
 it('surfaces the native zero-route diagnostic without local partial-import fallback',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'ediel_registry_zero_routes_source_held',details:'No source-qualified communication route can be imported.'}})
  await expect(importActorRegistryXml({xml:'<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>',uploadedBy:actorUserId})).rejects.toMatchObject({message:'ediel_registry_zero_routes_source_held'})
  expect(rpc).toHaveBeenCalledOnce()
 })
 it.each([
  ['empty-before','<Company/>',true,1],
  ['empty-after','<Company/>',false,2],
  ['unreadable-before','<Company><Unknown>unreadable source</Unknown></Company>',true,1],
  ['unreadable-after','<Company><Unknown>unreadable source</Unknown></Company>',false,2],
 ] as const)('rejects the whole fresh XML batch for %s instead of silently applying its routed sibling',async(_case,unreadable,before,ordinal)=>{
  const xml=market(before?unreadable+routedCompany:routedCompany+unreadable)
  await expect(importActorRegistryXml({xml,uploadedBy:actorUserId})).rejects.toThrow(`actor_registry_xml_identity_required:record_${ordinal}`)
  // The exact immutable prior-result read precedes new parsing. No new
  // normalized batch or partial good-sibling apply may reach the writer.
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc.mock.calls[0][0]).toBe('ediel_read_actor_registry_batch_v1')
 })
 it('retains readable named metadata without inventing a legal ID or dropping its routed sibling',async()=>{
  const xml=market('<Company><Name>Synthetic metadata only</Name></Company>'+routedCompany)
  await importActorRegistryXml({xml,uploadedBy:actorUserId})
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['ediel_read_actor_registry_batch_v1','ediel_apply_actor_registry_v1'])
  expect(rpc.mock.calls[1][1].p_records).toEqual([
   expect.objectContaining({name:'Synthetic metadata only',edielId:null,routes:[],raw:expect.objectContaining({registryDiagnostics:[expect.objectContaining({code:'actor_registry_declared_route_source_required'})]})}),
   expect.objectContaining({name:'Synthetic routed actor',edielId:'21660',routes:[expect.objectContaining({messageFamily:'PRODAT'})]}),
  ])
 })
 it('replays an immutable prior batch before the current unreadable-company guard can reinterpret its source',async()=>{
  const xml=market('<Company/>'+routedCompany)
  const prior={importRunId:'old-run',uiRunId:'old-ui',totalRecords:1,created:1,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held',reusedExistingRun:true}
  rpc.mockResolvedValue({data:prior,error:null})
  await expect(importActorRegistryXml({xml,uploadedBy:actorUserId})).resolves.toEqual(prior)
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc.mock.calls[0][0]).toBe('ediel_read_actor_registry_batch_v1')
 })
})
