import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {originalRuleWitnessFixture} from './originalRuleWitnessFixture'

export const PRODAT_FIXTURE_COMPANY='00000000-0000-4000-8000-000000000002'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const original=originalRuleWitnessFixture({profileKey:'DECLARED:PRODAT:FIXTURE',messageProfileId:id(32),rulePackId:id(33),sourceHash:'a'.repeat(64)})
/** Declared synthetic registry transport response; not authentic source approval. */
export const prodatFixtureRegistryResolution={...original,originalVersion:original.version,originalSnapshot:original.snapshot}
const protectedBasis={rulePackId:original.rulePackId,messageProfileId:original.messageProfileId,profileKey:original.profileKey,
 version:original.version,sourceHash:original.sourceHash,snapshot:{profileKey:original.profileKey,profileVersionId:original.messageProfileId,
 version:original.version,checksum:original.sourceHash}}

/** Models the prospective protected INSERT context for these unit probes.
 * No persisted report or parsed-payload approval is promoted into authority. */
export function withProdatFixtureInsertContext(row:EdielMessageRow):EdielMessageRow {
 if(typeof row.raw_payload!=='string')throw Error('fixture_raw_required')
 const received='2026-09-20T00:00:00.000000Z'
 return {...row,company_id:PRODAT_FIXTURE_COMPANY,message_received_at:received,created_at:received,
  execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:row.id,
   companyId:PRODAT_FIXTURE_COMPANY,environment:row.environment,messageCode:row.message_code,payloadHash:hash(row.raw_payload),
   sourceReceivedAt:received,capturedAt:received}}} as EdielMessageRow
}

/** Only the named prospective owner ports are modelled. Every response is
 * checked against exact request fields by the real production adapters. */
export function prodatFixtureSourceRpc(name:string,args:Record<string,unknown>) {
 let data:Record<string,unknown>
 if(name==='gridex_record_source_validation_v1'||name==='gridex_record_prodat_source_validation_v2')data={version:name==='gridex_record_prodat_source_validation_v2'?2:1,...(name==='gridex_record_prodat_source_validation_v2'?{ignoredFieldsHash:typeof args.p_ignored_fields_text==='string'?hash(args.p_ignored_fields_text):null}:{}),companyId:args.p_company_id,environment:args.p_environment,
  sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,factsHash:hash(String(args.p_facts_text)),
  sourceDisposition:'not_established',assessmentId:id(34)}
 else if(name==='ediel_probe_source_rule_pack_capture_v1')data={status:'captured',evidence:protectedBasis}
 else if(name==='gridex_record_source_object_decisions_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,
  sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,
  factsHash:hash(String(args.p_facts_text)),assessmentId:id(35)}
 else if(name==='gridex_witness_source_objects_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,
  assessmentId:args.p_assessment_id,factsHash:args.p_facts_hash,witnessId:id(36),availableAt:new Date().toISOString()}
 else throw Error(`UNEXPECTED_SOURCE_RPC:${name}`)
 const result=Promise.resolve({data,error:null})
 return Object.assign(result,{abortSignal:()=>result})
}
