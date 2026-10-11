import {raw, common, line, characteristic, qty} from '../fixtures/prodat-register'
import {head, source} from '../fixtures/prodat-identity'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
export const ownerId = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const OWNER = {source:ownerId(1),company:ownerId(2),customer:ownerId(3),point:ownerId(4),site:ownerId(5),grid:ownerId(6),switch:ownerId(7),supply:ownerId(8),actor:ownerId(9),external:'735123456789012345'}
/** Synthetic activation rows returned by the external registry RPC. The real
 * registry decoder and named original witness remain the evidence owners. */
export function ownerRulePack() {
  const profileKey='PRODAT:Z04:L:26.A:r3',sourceHash='a'.repeat(64),packId=ownerId(12),profileId=ownerId(11)
  const profile={guideVersion:'26.A',guideRevision:'3',family:'PRODAT',messageCode:'Z04',transactionSubtype:'L',canonicalDirection:'inbound',reasonForTransaction:'Z22'}
  return {
    rule_pack_id:packId,message_profile_id:profileId,market:'electricity',family:'PRODAT',guide_version:'26.A',guide_revision:'3',
    unh_association_code:'E2SE6A',valid_from:'2026-04-01',valid_to:null,source_document:'Synthetic PRODAT 26.A revision 3 activation',
    source_hash:sourceHash,field_matrix_version:'26A-r3',profile_key:profileKey,business_process:'supplier_switch_confirmation',phase:null,profile,
    parser_ready:true,builder_ready:true,validator_ready:true,ack_ready:true,state_machine_ready:true,original_version:'26.A:r3',
    original_snapshot:{rulePack:{id:packId,source_hash:sourceHash,guide_version:'26.A',guide_revision:'3'},
      messageProfile:{id:profileId,rule_pack_id:packId,profile_key:profileKey,profile},guideSources:[]},
  }
}
/** Fixed synthetic wire. The real canonical engine must accept it, not a stub
 * of its output. Receiver-local reading facts are explicit fixture input. */
type OwnerSourceOptions = {readingDeclarations:true;environment?:'test'|'production';sourceCodes?:{
  installationStatus:'Z11'|'Z12';settlementMethod:'Z31'|'Z32'
}}
export function ownerSource(options?:OwnerSourceOptions):EdielMessageRow {
  return constructOwnerSource(options)
}
/** Explicit fixture choice made before wire construction and birth hashing.
 * The original ownerSource defaults remain unchanged. */
export function ownerSourceWithInstallationStatus(installationStatus:'Z11'|'Z12',options?:OwnerSourceOptions):EdielMessageRow {
  if(installationStatus!=='Z11'&&installationStatus!=='Z12')throw new RangeError('installationStatus requires Z11 or Z12')
  return constructOwnerSource(options,installationStatus)
}
function constructOwnerSource(options?:OwnerSourceOptions,installationStatus?:'Z11'|'Z12'):EdielMessageRow {
  const own=common('1','Synthetic')
  // Explicit synthetic physical inputs only; no private READ or UTILTS receipt.
  // Keep the original no-argument wire and its UNKNOWN readings unchanged.
  const optedIn=options?.readingDeclarations===true
  // Complete caller-selected controls only; no inferred installation or tariff
  // facts, and no claim that the unchanged synthetic register111 is qualified.
  const sourceCodes=optedIn?options?.sourceCodes:undefined
  if(sourceCodes!==undefined&&(sourceCodes===null||
    !['Z11','Z12'].includes(sourceCodes.installationStatus)||!['Z31','Z32'].includes(sourceCodes.settlementMethod))){
    throw new RangeError('sourceCodes requires Z11/Z12 installationStatus and Z31/Z32 settlementMethod')
  }
  const readings=optedIn?[...characteristic('Z02','1',3),...characteristic('Z05','6',3),...characteristic('Z16','111',3)]:[]
  const environment=optedIn?(options.environment??'test'):'test'
  // Original D97A group8: own dates, quantity, characteristics, references, parties.
  let wire=raw([...head(),line('1',OWNER.external,undefined,'9'),...own.filter(p=>p[0]==='DTM'),qty('1000'),
    ...own.filter(p=>p[0]==='CCI'||p[0]==='CAV'),
    ...characteristic('Z07',sourceCodes?.installationStatus??installationStatus??'E22'),...characteristic('Z12','D',3),...characteristic('Z15',sourceCodes?.settlementMethod??'D'),
    ['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],
    ...readings,
    ...own.filter(p=>p[0]==='RFF'),...own.filter(p=>p[0]==='NAD'),
    ['NAD','IT',[OWNER.external,'','9'],'','','Street','Town','','12345','SE'],
    ['NAD','Z02',['11111','160','SVK']]],'Z04').replace('+S+R+','+12345:14+54321:14+')
  if(optedIn){
    const envelopeTags=new Set(['UNB','UNH','UNT','UNZ'])
    const businessSegments=tokenizeEdifact(wire).segments.filter(segment=>!envelopeTags.has(segment.tag)).map(segment=>segment.raw)
    wire=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'I',
      applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment,
      createdAt:new Date('2026-09-17T10:00:00.000Z'),timeZone:'Europe/Stockholm',
      messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments}]})
  }
  return {...source(wire,'Z04'),id:OWNER.source,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,
    ...(optedIn?{environment,test_flag:environment==='test'?1:0,inbound_email_message_id:ownerId(60),created_at:'2026-09-22T10:00:00Z'}:{}),
    message_received_at:'2026-09-22T10:00:00Z',
    parsed_payload:{subtype:'L',start_date:'2026-10-01',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}},
    execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:OWNER.source,companyId:OWNER.company,environment,messageCode:'Z04',payloadHash:evidenceHash(wire),sourceReceivedAt:'2026-09-22T10:00:00Z',capturedAt:'2026-09-22T10:00:00Z'}}} as EdielMessageRow
}
export function ownerRows():Record<string,Record<string,unknown>[]> {
  const tenant={company_id:OWNER.company,environment:'test',valid_from:'2026-01-01T00:00:00Z',valid_to:null}
  return {
    company_memberships:[{company_id:OWNER.company,user_id:ownerId(50),status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}],
    user_profiles:[{id:ownerId(50),user_status:'active'}],
    tenant_ediel_profiles:[{...tenant,id:ownerId(20),market:'electricity',is_enabled:true}],
    tenant_actor_identifiers:[{...tenant,id:ownerId(21),actor_id:OWNER.actor,identifier_type:'EdielId',identifier_value:'54321',qualifier:null,subaddress:null}],
    tenant_actor_roles:[{...tenant,id:ownerId(22),actor_id:OWNER.actor,role_code:'electricity_supplier'}],
    tenant_counterparty_relations:[],platform_actor_identifiers:[],
    metering_points:[{id:OWNER.point,company_id:OWNER.company,customer_id:OWNER.customer,meter_point_id:OWNER.external,site_id:OWNER.site,customer_site_id:OWNER.site,grid_owner_id:OWNER.grid}],
    customer_sites:[{id:OWNER.site,company_id:OWNER.company,customer_id:OWNER.customer,facility_id:OWNER.external,grid_owner_id:OWNER.grid}],
    grid_owners:[{id:OWNER.grid,name:'Synthetic network',ediel_id:'12345',is_active:true,lifecycle_status:'active',default_prodat_subaddress:null,default_utilts_subaddress:null,communication_email:null,email:null,environment:'test'}],
    supplier_switch_requests:[{id:OWNER.switch,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,inbound_z04_message_id:OWNER.source,status:'draft',confirmed_start_date:null}],
    customer_supply_periods:[{id:OWNER.supply,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,source_message_id:OWNER.source,status:'draft',start_date:'2026-10-01'}],
  }
}

/** Named registry rows are explicitly synthetic IO. Real canonical field
 * selection and immutable original witness decoding remain active. */
export function ownerRulePackEvidence(){
 const rulePackId=ownerId(12),messageProfileId=ownerId(11),sourceHash='a'.repeat(64),databaseProfileKey='PRODAT:Z04:L:26.A:r3'
 return {profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey,sourceHash,messageProfileId,rulePackId,originalVersion:'26.A:r3',originalSnapshot:{rulePack:{id:rulePackId,guide_version:'26.A',guide_revision:'3',source_hash:sourceHash},messageProfile:{id:messageProfileId,rule_pack_id:rulePackId,profile_key:databaseProfileKey},guideSources:[]}}
}
