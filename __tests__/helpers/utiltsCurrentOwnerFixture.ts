import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
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
