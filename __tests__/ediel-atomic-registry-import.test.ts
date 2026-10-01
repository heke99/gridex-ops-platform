import {describe,it,expect,vi,beforeEach} from 'vitest'
import {createHash} from 'node:crypto'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {applyActorRegistryRecords,decodeRegistryUpload,importActorRegistryXml} from '@/lib/actor-registry/importActorRegistry'
const actorUserId='00000000-0000-4000-8000-000000000001'
describe('actual atomic registry producer source boundary',()=>{
 beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:{importRunId:'run',uiRunId:'ui',totalRecords:1,created:1,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held'},error:null})})
 it('retains exact declared Latin1 upload bytes independently of parsed Unicode',async()=>{
  const bytes=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Market Code="EL" Country="SE"><Company><Name>Å Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>','latin1')
  const xml=decodeRegistryUpload(bytes,'companies_xml')
  expect(xml).toContain('Å Synthetic')
  await applyActorRegistryRecords({sourceBytes:bytes,sourceKind:'companies_xml',actorUserId,actors:[{name:'Å Synthetic',countryCode:'SE',market:'EL',edielId:'21660',roles:[],routes:[],certificates:[],raw:{fixture:true}}]})
  expect(rpc).toHaveBeenCalledOnce()
  const [name,args]=rpc.mock.calls[0]
  expect(name).toBe('ediel_apply_actor_registry_v1');expect(Buffer.from(args.p_source_base64,'base64')).toEqual(bytes)
  expect(args.p_source_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
 })
 it('rejects undecodable or unimplemented source encodings before database apply',()=>{
  expect(()=>decodeRegistryUpload(Buffer.from([0xff]),'csv')).toThrow()
  expect(()=>decodeRegistryUpload(Buffer.from('<?xml version="1.0" encoding="UNKNOWN"?><Root/>'),'companies_xml')).toThrow('encoding_adapter_required')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('retains exact uploaded Latin1 bytes through the actual shared XML producer',async()=>{
  const bytes=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Market Code="EL" Country="SE"><Company><Name>Å Synthetic</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="PRODAT"><CommunicationAddress Type="SMTP">synthetic@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>','latin1')
  await importActorRegistryXml({xml:decodeRegistryUpload(bytes,'companies_xml'),sourceBytes:bytes,uploadedBy:actorUserId})
  const args=rpc.mock.calls[0][1]
  expect(Buffer.from(args.p_source_base64,'base64')).toEqual(bytes)
  expect(args.p_source_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(args.p_records[0]).toMatchObject({name:'Å Synthetic',edielId:'21660',routes:[expect.objectContaining({messageFamily:'PRODAT',communicationAddress:'synthetic@example.invalid'})]})
 })
 it('holds a text/byte mismatch before any native import',async()=>{
  const bytes=Buffer.from('<Root/>')
  await expect(importActorRegistryXml({xml:'<Different/>',sourceBytes:bytes,uploadedBy:actorUserId})).rejects.toThrow('ediel_registry_source_bytes_text_mismatch')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('uses one atomic RPC for shared XML import even when old force reprocess was requested',async()=>{
  await importActorRegistryXml({xml:'<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>',uploadedBy:actorUserId,forceReprocess:true})
  expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0][1].p_records[0]).toMatchObject({edielId:'21660',market:'EL'})
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
 it('surfaces the native zero-route diagnostic without local partial-import fallback',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'ediel_registry_zero_routes_source_held',details:'No source-qualified communication route can be imported.'}})
  await expect(importActorRegistryXml({xml:'<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key></Company></Market>',uploadedBy:actorUserId})).rejects.toMatchObject({message:'ediel_registry_zero_routes_source_held'})
  expect(rpc).toHaveBeenCalledOnce()
 })
})
