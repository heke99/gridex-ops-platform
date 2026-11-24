import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import { utiltsOwnerCompany } from './utiltsCanonicalOwnerIo'
import {createUtiltsFinalValidationIo as legacyValidationIo,qualifyUtiltsFixtureSource as insertContext} from './utiltsFinalValidationFixture'

export const UTILTS_FIXTURE_ACTOR='77777777-7777-4777-8777-777777777777'
const originals=new Map<string,EdielMessageRow>()
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
/** Explicit setup of a new declared synthetic original, before the real initial
 * owner runs. Copies of decisions, parsed approval flags and caller RPC tuples
 * cannot register or change an original. This is bounded I/O, not native proof. */
export function qualifyUtiltsFixtureSource<T extends EdielMessageRow>(message:T):T {
 insertContext(message)
 originals.set(message.id,structuredClone(message))
 return message
}
function ownSource(args:Record<string,unknown>,sourceKey='p_source_message_id'){
 const source=originals.get(String(args[sourceKey]))
 if(!source||args.p_company_id!==source.company_id)throw Error('fixture_original_scope_mismatch')
 return source
}
/** The separately declared request has no persisted outbound source in this fixture. */
export function readAbsentFixtureSentE73Period(args: Record<string, unknown>, requestId: string) {
 if(Object.keys(args).length!==4 || args.p_request_id!==requestId || args.p_actor_user_id!==UTILTS_FIXTURE_ACTOR
  || ![...originals.values()].some(source=>source.company_id===args.p_company_id && source.environment===args.p_environment)) {
  throw Error('fixture_sent_e73_scope_mismatch')
 }
 return Promise.resolve({data:null,error:null})
}
const E73_FIXTURE_REFERENCE = 'SYNTHETIC-E73-JULY'
const E73_FIXTURE_REQUEST = 'request-a'
const fixtureSentE73 = new Map<string,{ request: Record<string,unknown>; raw: string; receivedReference:string; bounds: {requestedFrom:string;requestedUntil:string} }>()
const fixtureRequestScopeKey = (companyId: unknown, environment: unknown) => JSON.stringify([companyId,environment])

/** Declare the counterpart's original and the outbound E73 wire before any
 * receive decision. This models only the native sent-reference/period ports. */
export function declareFixtureE66Request(message: EdielMessageRow, requestOverrides: Record<string,unknown> = {}, receivedReference = E73_FIXTURE_REFERENCE) {
 if (!message.company_id || !message.raw_payload || message.message_code!=='E66') return
 const raw = message.raw_payload
 if (!raw.includes("\nIDE+")) return
 message.raw_payload=raw.replace('\nIDE+', "\nRFF+ACW:"+receivedReference+"'\nIDE+")
   .replace(/UNT\+(\d+)\+/, (_,count)=>'UNT+'+(Number(count)+1)+'+')
 fixtureSentE73.set(fixtureRequestScopeKey(utiltsOwnerCompany,message.environment),{
   request:{id:E73_FIXTURE_REQUEST,company_id:utiltsOwnerCompany,request_scope:'billing_underlay',
     status:'sent',customer_id:'customer-a',site_id:'site-a',metering_point_id:'point-a',grid_owner_id:'owner-a',
     external_reference:E73_FIXTURE_REFERENCE,response_payload:{},...requestOverrides},
   raw: [
     "UNA:+.? '",
     `UNB+UNOC:3+21660:ZZ+91100:ZZ+260630:2100+FIXTUREE73++23-DDQ-E66-${message.environment==='test'?'T':'S'}+++1${message.environment==='test'?'+1':''}'`,
     "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
     `BGM+E73::260+${E73_FIXTURE_REFERENCE}+9+AB'`,
     "DTM+137:202606302100:203'","DTM+735:?+0100:406'","MKS+23+E02::260'",`RFF+TN:${E73_FIXTURE_REFERENCE}'`,
     "NAD+MS+21660:SVK:260'","NAD+MR+91100:SVK:260'",`IDE+24+${E73_FIXTURE_REFERENCE}'`,
     "LOC+172+735999260731000007::9'","LOC+239+TES:SVK:260'","LIN+++8716867000030:::9'",
     "DTM+324:202606302300202607312300:719'","DTM+597:202606302100:203'","STS+7++E73::260'",
     "FTX+AAO+++Request missing E66'","FTX+ZZZ+++Consumption'","RFF+E66'","UNT+19+1'","UNZ+1+FIXTUREE73'",
   ].join(''),
   receivedReference,
   bounds:{requestedFrom:'2026-06-30T22:00:00.000Z',requestedUntil:'2026-07-31T22:00:00.000Z'},
 })
}

export function declaredFixtureE73Rpc(name: string, args: Record<string,unknown>) {
 if (name!=='gridex_match_e66_to_sent_e73_reference_v1' && name!=='gridex_read_sent_e73_period_v1') return undefined
 if (Object.keys(args).length!==4 || args.p_actor_user_id!==UTILTS_FIXTURE_ACTOR) throw Error('fixture_sent_e73_scope_mismatch')
 const original=fixtureSentE73.get(fixtureRequestScopeKey(args.p_company_id,args.p_environment))
 if (!original) throw Error('fixture_sent_e73_original_required')
 if (name==='gridex_match_e66_to_sent_e73_reference_v1') {
   if (args.p_reference!==original.receivedReference) throw Error('fixture_sent_e73_reference_mismatch')
   const requestMatches = original.raw.includes(`RFF+TN:${args.p_reference}'`)
   return Promise.resolve({data:requestMatches?[E73_FIXTURE_REQUEST]:[],error:null})
 }
 if (args.p_request_id!==E73_FIXTURE_REQUEST) throw Error('fixture_sent_e73_request_mismatch')
 return Promise.resolve({data:original.bounds,error:null})
}

export function declaredFixtureE73RequestQuery(table: string) {
 if (table!=='grid_owner_data_requests') return undefined
 const filters=new Map<string,unknown>()
 const query={
  select(columns:string) { if (columns!=='*') throw Error('fixture_e73_request_selection_mismatch'); return query },
  eq(key:string,value:unknown) {filters.set(key,value); return query},
  in(key:string,values:unknown[]) {
   if (key!=='request_scope' || values.join(',')!=='meter_values,billing_underlay') throw Error('fixture_e73_request_scope_mismatch')
   return query
  },
  maybeSingle() {
   if (filters.size!==2 || filters.get('id')!==E73_FIXTURE_REQUEST) throw Error('fixture_e73_request_filter_mismatch')
   const row=[...fixtureSentE73.values()].reverse().find(entry=>entry.request.company_id===filters.get('company_id'))
   if (!row) throw Error('fixture_e73_request_company_mismatch')
   return Promise.resolve({data:structuredClone(row.request),error:null})
  },
 }
 return query
}

export function absentFixtureMeteringPermissionQuery(table: string) {
 if (table!=='metering_permission_sites' && table!=='metering_permissions') return undefined
 const filters=new Map<string,unknown>()
 const query={
  select() {return query},
  eq(key:string,value:unknown) {filters.set(key,value);return query},
  in(key:string,statuses:unknown[]) {
   if (key!=='status' || !statuses.includes('active')) throw Error('fixture_permission_status_scope_mismatch')
   return query
  },
  order(field:string,options:{ascending:boolean}) {
   if (field!=='created_at' || options.ascending) throw Error('fixture_permission_order_mismatch')
   return query
  },
  limit(count:number) {
   if (count!==(table==='metering_permission_sites'?10:50)) throw Error('fixture_permission_limit_mismatch')
   return query
  },
  then(task:(result:{data:unknown[];error:null})=>unknown) {
   if (filters.get('company_id')!==utiltsOwnerCompany) throw Error('fixture_permission_company_mismatch')
   return Promise.resolve({data:[],error:null}).then(task)
  },
 }
 return query
}

export function createUtiltsFinalValidationIo(){
 const legacy=legacyValidationIo()
 const witnesses=new Map<string,Record<string,unknown>>()
 return (name:string,args:Record<string,unknown>)=>{
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   if(args.p_market!=='electricity'||args.p_family!=='UTILTS'||args.p_direction!=='inbound'
    ||![...originals.values()].some(source=>source.message_code===args.p_message_code&&source.message_received_at?.slice(0,10)===args.p_business_date))
    throw Error('fixture_declared_registry_scope_mismatch')
   // Family is part of the declared original snapshot, before the real final
   // evidence owner records it; an ACK read never supplements that authority.
   return legacy(name,args)!.then(result=>({...result,data:(result.data as Record<string,unknown>[]).map(row=>{
    const snapshot=row.original_snapshot as Record<string,unknown>
    return {...row,original_snapshot:{...snapshot,rulePack:{...snapshot.rulePack as Record<string,unknown>,family:row.family}}}
   })}))
  }
  if(name==='gridex_read_utilts_issuer_identity_authority_v1'){
   const source=ownSource(args,'p_message_id')
   return Promise.resolve({error:null,data:{version:1,companyId:source.company_id,environment:source.environment,
    sourceMessageId:source.id,sourcePayloadHash:hash(source.raw_payload!),status:'qualified',
    authorityVersionId:'88888888-8888-4888-8888-888888888888',namespaceEpoch:'1',
    messageReferenceCollision:false,transactionReferenceCollisions:[],holdReason:null}})
  }
  if(name==='gridex_read_outbound_acks_for_source_v2'){
   if(!originals.has(String(args.p_source_message_id))||!['CONTRL','APERAK','UTILTS_ERR'].includes(String(args.p_ack_family)))throw Error('fixture_ack_original_scope_mismatch')
   const source=originals.get(String(args.p_source_message_id))!
   return Promise.resolve({error:null,data:{version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,companyId:source.company_id,environment:source.environment,
    sourceMessageId:source.id,sourcePayloadHash:hash(source.raw_payload!),originals:[]}})
  }
  if(name==='ediel_read_source_rule_pack_basis_v1'){
   const source=ownSource(args,'p_message_id'),witness=witnesses.get(source.id)
   if(!witness)throw Error('fixture_original_without_final_witness')
   const snapshot=witness.snapshot as Record<string,unknown>
   return Promise.resolve({error:null,data:{version:1,sourceMessage:structuredClone(source),sourceRulePackEvidence:{...witness,
    snapshot:{...snapshot,profileKey:witness.profileKey,profileVersionId:witness.messageProfileId,version:witness.version,checksum:witness.sourceHash}}}})
  }
  if(name==='gridex_record_utilts_source_validation_v4'){
   const source=ownSource(args)
   if(args.p_environment!==source.environment||args.p_source_payload_hash!==hash(source.raw_payload!))throw Error('fixture_original_hash_mismatch')
   const facts=JSON.parse(String(args.p_facts_text)) as {rulePackEvidence?:Record<string,unknown>}
   if(facts.rulePackEvidence)witnesses.set(source.id,structuredClone(facts.rulePackEvidence))
  }
  if(name==='ediel_probe_source_rule_pack_capture_v1')ownSource(args,'p_message_id')
  if(name==='gridex_actor_has_company_permission')return Promise.resolve({error:null,data:
   args.p_actor_user_id===UTILTS_FIXTURE_ACTOR&&['communication.write','communication.read','metering.write'].includes(String(args.p_permission))
   &&[...originals.values()].some(source=>source.company_id===args.p_company_id)})
  return legacy(name,args)
 }
}
/** Current actor rows are separate from original/guide receipts. Filter state
 * is validated at maybeSingle, so foreign UUIDs and revoked scope remain denied. */
export function currentUtiltsActorQuery(table:string){
 if(!['company_memberships','user_profiles'].includes(table))return null
 const filters=new Map<string,unknown>()
 const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.set(key,value);return q},not:()=>q,
  maybeSingle:async()=>{
   const actor=filters.get(table==='user_profiles'?'id':'user_id')
   const company=filters.get('company_id')
   const own=actor===UTILTS_FIXTURE_ACTOR&&(table==='user_profiles'||[...originals.values()].some(source=>source.company_id===company))
   return {error:null,data:!own?null:table==='user_profiles'?{id:actor,user_status:'active'}:
    {company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-09-01T00:00:00Z'}}
  }}
 return q
}
