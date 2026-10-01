import {createHash} from 'node:crypto'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

export const utiltsOwnerCompany='11111111-1111-4111-8111-111111111111'
const sourceId='22222222-2222-4222-8222-222222222222',packId='33333333-3333-4333-8333-333333333333',profileId='44444444-4444-4444-8444-444444444444'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const committed=new Map<string,Record<string,unknown>>()

export function resetUtiltsCanonicalOwnerIo() { committed.clear() }

/** Prospective external IO controls for the actual canonical-owner handoff.
 * These modeled insert/witness/COMMITTED receipts grant no native/legal proof.
 * The protocol engine and opaque initial/final owner ports remain real. */
export function receivedUtiltsOwnerFixture(message:EdielMessageRow):EdielMessageRow {
 return {...message,id:sourceId,company_id:utiltsOwnerCompany,execution_context_snapshot:{receivedUtiltsContext:{version:1,contextOrigin:'database_insert',sourceMessageId:sourceId,companyId:utiltsOwnerCompany,environment:message.environment,messageCode:message.message_code,payloadHash:hash(message.raw_payload!),sourceReceivedAt:message.message_received_at,capturedAt:message.message_received_at}}}
}
export function utiltsNamedOwnerWitness({canonicalPolicy:policy}:{canonicalPolicy:CanonicalEdielPolicy}) {
 const revision=policy.guide.guideRevision,number=revision.split('-').at(-1)!,databaseProfileKey=`UTILTS:${policy.code}:E5SE5A:${number}`
 return {profileKey:policy.profileKey,databaseProfileKey,messageProfileId:profileId,rulePackId:packId,sourceHash:'a'.repeat(64),originalVersion:`${revision}:r${number}`,
  originalSnapshot:{rulePack:{id:packId,source_hash:'a'.repeat(64),guide_version:revision,guide_revision:number},messageProfile:{id:profileId,rule_pack_id:packId,profile_key:databaseProfileKey},guideSources:[{id:'55555555-5555-4555-8555-555555555555',rule_pack_id:packId}]}}
}
export function utiltsCanonicalOwnerRpc(name:string,args:Record<string,string|null>) {
 if(name==='gridex_record_utilts_source_validation_v4') {
  const facts=JSON.parse(args.p_facts_text!)
  if(facts.owner!=='canonical-runtime-with-registry-v1' || !args.p_transaction_facts_text)throw Error('fixture_actual_canonical_own_facet_required')
  committed.set(`${args.p_company_id}/${args.p_source_message_id}`,facts)
  const data={version:4,assessmentId:'66666666-6666-4666-8666-666666666666',companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,sourceDisposition:'not_established',factsHash:hash(args.p_facts_text!),transactionFactsHash:hash(args.p_transaction_facts_text),headerFactsHash:args.p_header_facts_text ? hash(args.p_header_facts_text) : null,functionalFactsHash:args.p_functional_facts_text ? hash(args.p_functional_facts_text) : null}
  return {abortSignal:async()=>({error:null,data})}
 }
 if(name==='ediel_probe_source_rule_pack_capture_v1') {
  const witness=committed.get(`${args.p_company_id}/${args.p_message_id}`)?.rulePackEvidence as {rulePackId:string;messageProfileId:string;profileKey:string;version:string;sourceHash:string;snapshot:Record<string,unknown>}|undefined
  if(!witness)throw Error('fixture_committed_original_witness_required')
  return Promise.resolve({error:null,data:{status:'captured',evidence:{...witness,snapshot:{...witness.snapshot,profileKey:witness.profileKey,profileVersionId:witness.messageProfileId,version:witness.version,checksum:witness.sourceHash}}}})
 }
 // Structural/native inventory is independently unavailable in diagnostic tests.
 return {abortSignal:async()=>({data:null,error:{message:`synthetic_external_source_unavailable:${name}`}})}
}
