import {readFileSync} from 'node:fs'
import {X509Certificate,createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {parseActorRegistryXml} from '@/lib/actor-registry/parseActorRegistryXml'
import {importActorRegistryXml} from '@/lib/actor-registry/importActorRegistry'
const actor='00000000-0000-4000-8000-000000000001',pem=readFileSync(new URL('./fixtures/ediel-synthetic-registry-certificate.txt',import.meta.url),'utf8')
const document=(cert:string)=>`<Market Code="EL" Country="SE"><Company><Name>Synthetic certificate source</Name><Key Type="EdielId">21660</Key><Role>ESCO</Role><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId><CommunicationAddress Type="SMTP">synthetic@example.invalid</CommunicationAddress></EDIFACTDetails>${cert}</Company></Market>`
beforeEach(()=>{rpc.mockReset();rpc.mockImplementation(async(name:string)=>({data:name==='ediel_read_actor_registry_batch_v1'?null:{importRunId:'run',uiRunId:'ui',totalRecords:1,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held_pending_current_source_readiness'},error:null}))})
it.each(['text','cdata'] as const)('preserves exact multiline public certificate %s for actual X509 decoding',kind=>{
 const xml=document(`<Certificate><PEM>${kind==='cdata'?`<![CDATA[${pem}]]>`:pem}</PEM><Purpose>encryption</Purpose></Certificate>`)
 const actual=parseActorRegistryXml(xml)[0].certificates[0].pem!
 expect(actual).toBe(pem.trim())
 expect(new X509Certificate(actual).raw).toEqual(new X509Certificate(pem).raw)
})
it('binds exact source DER and parsed validity through actual shared import producer without authorizing trust',async()=>{
 const xml=document(`<Certificate><PEM>${pem}</PEM><Purpose>both</Purpose></Certificate>`)
 await importActorRegistryXml({xml,uploadedBy:actor})
 const cert=new X509Certificate(pem),hash=createHash('sha256').update(cert.raw).digest('hex').toUpperCase()
 const apply=rpc.mock.calls.find(([name])=>name==='ediel_apply_actor_registry_v1')!
 expect(apply).toBeTruthy();expect(Buffer.from(apply[1].p_source_base64,'base64')).toEqual(Buffer.from(xml))
 expect(apply[1].p_records[0].certificates).toEqual(['encryption','signing'].map(purpose=>expect.objectContaining({purpose,derBase64:cert.raw.toString('base64'),pem:pem.trim(),fingerprintSha256:hash,validFrom:new Date(cert.validFrom).toISOString(),validTo:new Date(cert.validTo).toISOString()})))
 expect(apply[1].p_records[0].certificates.some((row:Record<string,unknown>)=>row.status==='valid'||row.isVerified===true)).toBe(false)
})
it('rejects conflicting fingerprint and ambiguous certificate PEM before native apply',async()=>{
 const conflict=document(`<Certificate><PEM>${pem}</PEM><FingerprintSha256>${'A'.repeat(64)}</FingerprintSha256></Certificate>`)
 await expect(importActorRegistryXml({xml:conflict,uploadedBy:actor})).rejects.toThrow('source_fingerprint_mismatch')
 expect(rpc.mock.calls.some(([name])=>name==='ediel_apply_actor_registry_v1')).toBe(false)
 expect(()=>parseActorRegistryXml(document(`<Certificate><PEM>${pem}</PEM><PEM>${pem}</PEM></Certificate>`))).toThrow('ambiguous_field')
})
