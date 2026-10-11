// Finite caller integration. Only database IO is substituted; tenant actor,
// immutable original/legal/reception READ, private context, compiled policy,
// registry witness decoder and canonical ledger facets execute as product code.
// A refused structural snapshot never establishes business/party/whole authority.
import {createHash} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {ownerId,ownerRulePack,ownerSourceWithInstallationStatus} from './helpers/sourceOwnerFixtures'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'

const fixtureSdk=vi.hoisted(()=>({value:null as ProdatOwnSourceReadingSdk|null,refuseCatalogue:false,
 unexpectedIo:[] as string[]}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatOwnSourceReadingSdk}=await import('./helpers/prodatOwnSourceReadingFixture')
 fixtureSdk.value=createProdatOwnSourceReadingSdk()
 const sdk=fixtureSdk.value
 return {supabaseService:{
  from:(table:string)=>{
   if(!Object.hasOwn(sdk.rows,table))fixtureSdk.unexpectedIo.push(`table:${table}`)
   const query=sdk.from(table)
   // Structural review uses the same scoped SELECT with a bounded signal.
   const refuseWrite=(operation:string)=>()=>{
    fixtureSdk.unexpectedIo.push(`${operation}:${table}`)
    throw Error('DECLARED_CALLER_BUSINESS_WRITE_FORBIDDEN')
   }
   return Object.assign(query,{abortSignal:()=>query,insert:refuseWrite('insert'),
    update:refuseWrite('update'),delete:refuseWrite('delete'),upsert:refuseWrite('upsert')})
  },
  rpc:(name:string,args:Record<string,unknown>)=>{
   const response=sdk.rpc(name,args)
   return Object.assign(response,{abortSignal:()=>response})
  },
 }}
})
const io=fixtureSdk.value!
const actor=ownerId(50)
const ledger='gridex_record_prodat_source_validation_v6'
const hash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex')
let source:ReturnType<typeof ownerSourceWithInstallationStatus>
const review=()=>reviewReceivedStructuralSource({companyId:source.company_id!,environment:source.environment,
 sourceMessageId:source.id,reviewerUserId:actor,confirmedOriginal:true,replacesSourceMessageId:null})
const ledgerCall=()=>io.calls.find(call=>call.name===ledger)
const applicationFacet=()=>{
 const text=ledgerCall()?.args.p_application_facts_text
 return typeof text==='string'?JSON.parse(text):null
}
const ownerWrites=()=>io.calls.filter(call=>call.kind==='rpc'&&[
 'gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1',
 'ediel_apply_supply_source_v1','ediel_apply_customer_life_event_source_v1',
].includes(call.name))

beforeEach(()=>{
 resetProdatOwnSourceReadingSdk(io);fixtureSdk.refuseCatalogue=false;fixtureSdk.unexpectedIo=[]
 // Explicit physical declarations and national values are selected before
 // construction and immutable birth hashing; no received row is repaired.
 source=ownerSourceWithInstallationStatus('Z12',{readingDeclarations:true,
  sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
 installProdatOwnSourceReadingFixture(io,source,'L',{actorUserId:actor,receivedAt:source.message_received_at!,
  mailId:source.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:ownerId(9)})
 io.permissions.add('communication.write')
 const actualReadIo=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   io.calls.push({kind:'rpc',name,args:{...args}})
   return fixtureSdk.refuseCatalogue?{data:null,error:new Error('DECLARED_CATALOGUE_UNAVAILABLE')}
    :{data:[ownerRulePack()],error:null}
  }
  if(name===ledger){
   io.calls.push({kind:'rpc',name,args:{...args}})
   if(args.p_company_id!==source.company_id||args.p_environment!==source.environment
    ||args.p_source_message_id!==source.id||args.p_source_payload_hash!==hash(source.raw_payload!)){
    return {data:null,error:new Error('DECLARED_LEDGER_ORIGINAL_SCOPE_REQUIRED')}
   }
   const data:Record<string,unknown>={version:6,assessmentId:ownerId(30),companyId:source.company_id,
    environment:source.environment,sourceMessageId:source.id,sourcePayloadHash:hash(source.raw_payload!),
    sourceDisposition:'not_established',factsHash:hash(String(args.p_facts_text))}
   for(const [key,arg] of [['objectFactsHash','p_object_facts_text'],['sourceFunctionFactsHash','p_source_function_facts_text'],
    ['applicationFactsHash','p_application_facts_text'],['ignoredFieldsHash','p_ignored_fields_text'],['responseFactsHash','p_response_facts_text']]){
    data[key]=typeof args[arg]==='string'?hash(args[arg]):null
   }
   return {data,error:null}
  }
  if(name==='gridex_source_object_snapshot_v1'){
   io.calls.push({kind:'rpc',name,args:{...args}})
   return {data:null,error:new Error('DECLARED_STRUCTURAL_SNAPSHOT_UNAVAILABLE')}
  }
  return actualReadIo(name,args)
 })
})
afterEach(()=>{
 expect(fixtureSdk.unexpectedIo).toEqual([])
 expect(io.calls.filter(call=>call.kind==='rpc'&&!['gridex_actor_has_company_permission',
  'ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1',
  'resolve_canonical_ediel_rule_pack_with_witness_v1',ledger,'gridex_source_object_snapshot_v1',
 ].includes(call.name))).toEqual([])
})

it('authenticated structural review freshly reads its own L declaration and records the genuine accepted canonical facet',async()=>{
 expect(await review()).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 // This fails if the reachable caller omits the actor: the real private READ
 // cannot run, so the real canonical application owner holds the object.
 expect(applicationFacet()).toMatchObject({headerDecision:'accepted',objects:[{
  objectId:'735123456789012345',identityAgency:'9',applicationDecision:'accepted',reasonCodes:[],
 }]})
 const sourceRead=io.calls.find(call=>call.name==='ediel_inbound_reception_request_v1')
 expect(sourceRead?.args).toMatchObject({p_company_id:source.company_id,p_message_id:source.id,p_actor_user_id:actor})
 expect(io.calls.findIndex(call=>call.name==='inbound_ediel_parse_results'))
  .toBeLessThan(io.calls.findIndex(call=>call.name===ledger))
 expect(io.calls.some(call=>call.name==='gridex_source_object_snapshot_v1')).toBe(true)
 expect(ownerWrites()).toEqual([])
})

it('a reviewer with WRITE but without current READ is refused before canonical or owner writes',async()=>{
 io.permissions.delete('communication.read')
 expect(await review()).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
 expect(ledgerCall()).toBeUndefined();expect(ownerWrites()).toEqual([])
})

it('READ revoked after original mail/parse is refused before canonical or owner writes',async()=>{
 // Review WRITE consumes two permission checks, first READ consumes two;
 // the second real READ guard observes revocation after mail/parse.
 io.revokeAfter=4
 expect(await review()).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(io.calls.some(call=>call.name==='inbound_ediel_parse_results')).toBe(true)
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
 expect(ledgerCall()).toBeUndefined();expect(ownerWrites()).toEqual([])
})

it.each(['mail','parse','reception'] as const)('a mismatched immutable %s remains unqualified despite the reviewer and poisoned status hints',async(part)=>{
 if(part==='mail')io.rows.inbound_email_messages[0].raw_edifact_payload='FOREIGN'
 if(part==='parse')io.rows.inbound_ediel_parse_results[0].raw_payload='FOREIGN'
 if(part==='reception')io.reception.receivedPayloadHash='f'.repeat(64)
 // The unchanged owner fixture already carries a mutable FALSE hint. Adding
 // TRUE cannot turn an unqualified original into a private source declaration.
 io.rows.ediel_messages[0].validation_report={prodatDependentFacts:{meterReadingsSentInUtilts:true}}
 expect(await review()).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 if(part==='reception'){
  // The real reception decoder rejects unequal canonical/received hashes
  // before canonical validation, rather than converting an error to UNKNOWN.
  expect(applicationFacet()).toBeNull();expect(ledgerCall()).toBeUndefined()
 }else expect(applicationFacet()).toMatchObject({headerDecision:'held',objects:[{applicationDecision:'held'}]})
 expect(ownerWrites()).toEqual([])
})

it('a genuine own READ does not invent application authority when the actual registry witness is unavailable',async()=>{
 fixtureSdk.refuseCatalogue=true
 expect(await review()).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(io.calls.some(call=>call.name==='ediel_inbound_reception_request_v1')).toBe(true)
 expect(applicationFacet()).toBeNull();expect(ownerWrites()).toEqual([])
})
