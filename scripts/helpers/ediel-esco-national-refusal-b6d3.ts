// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// National denial input oracle only. No test registration or source authority.
import {expect} from 'vitest'
import {createHash} from 'node:crypto'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {DEFAULT_UNA,serializeUna} from '@/lib/ediel/core/una'
import {omitPermissionField} from './ediel-permission-field-omissions'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielBusinessMatchResult} from '@/lib/ediel/matching/matchingTypes'
import type {EdielSyntaxValidationResult} from '@/lib/ediel/core/syntaxValidator'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import type {OriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'

export type EscoNationalField='203'|'205'|'206'|'207'|'208'|'313'|'322'
export function omitEscoNationalField(raw:string,field:EscoNationalField,input:{sender:string;receiver:string;li:string;status:'A13'|'A76'}){
 const original=tokenizeEdifact(raw),{segments:s,una:u}=original,e=u.dataElementSeparator,c=u.componentDataElementSeparator
 expect(raw).toBe(serializeUna(u)+s.map(row=>row.raw).join(u.segmentTerminator)+u.segmentTerminator)
 for(const delimiter of [e,c,u.segmentTerminator])expect(raw.includes(u.releaseCharacter+delimiter)).toBe(false)
 for(const tag of ['UNB','UNH','BGM','UNT','UNZ','LIN'])expect(s.filter(row=>row.tag===tag)).toHaveLength(1)
 expect(s.slice(0,8).map(row=>row.tag)).toEqual(['UNB','UNH','BGM','DTM','DTM','NAD','NAD','LIN'])
 expect(segmentComposite(s[0],2,u)[0]).toBe(input.sender);expect(segmentComposite(s[0],3,u)[0]).toBe(input.receiver)
 expect(segmentComposite(s[0],7,u)).toEqual(['23-DGI-PRODAT'])
 expect(segmentComposite(s[1],1,u)).toEqual(['1']);expect(segmentComposite(s[1],2,u)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(segmentComposite(s[2],1,u)).toEqual(['Z14']);expect(segmentComposite(s[2],2,u)[0]).toBeTruthy()
 expect(segmentComposite(s[2],3,u)).toEqual(['9']);expect(segmentComposite(s[2],4,u)).toEqual(['AB'])
 expect(segmentComposite(s[3],1,u)[0]).toBe('137');expect(segmentComposite(s[4],1,u)).toEqual(['ZZZ','1','805'])
 expect(segmentComposite(s[5],1,u)).toEqual(['FR']);expect(segmentComposite(s[5],2,u)).toEqual([input.sender,'160','SVK'])
 expect(segmentComposite(s[6],1,u)).toEqual(['DO']);expect(segmentComposite(s[6],2,u)).toEqual([input.receiver,'160','SVK'])
 expect(s[7].raw).toBe('LIN'+e+'1');expect(s[7].index).toBe(7)
 expect(s.filter(row=>row.tag==='NAD'&&['UD','IT'].includes(segmentComposite(row,1,u)[0]??''))).toEqual([])
 expect(s.filter(row=>row.tag==='RFF'&&['Z05','Z09'].includes(segmentComposite(row,1,u)[0]??''))).toEqual([])
 const li=s.filter(row=>row.tag==='RFF'&&segmentComposite(row,1,u)[0]==='LI')
 expect(li).toHaveLength(1);expect(segmentComposite(li[0],1,u)).toEqual(['LI',input.li])
 for(const [qualifier,value] of [['Z13','Z96'],['Z23',input.status]] as const){
  const positions=s.flatMap((row,i)=>row.tag==='CCI'&&segmentComposite(row,2,u)[0]===qualifier?[i]:[])
  expect(positions).toHaveLength(1);expect(positions[0]).toBeGreaterThan(7)
  expect(s[positions[0]].raw).toBe('CCI'+e+e+qualifier);expect(s[positions[0]+1].raw).toBe('CAV'+e+value)
  expect(s[positions[0]+2]?.tag).not.toBe('CAV')
 }
 const tag=field==='205'||field==='206'?'DTM':field==='207'||field==='208'?'NAD':field==='322'?'CCI':'BGM'
 const qualifier=field==='205'?'137':field==='206'?'ZZZ':field==='207'?'FR':field==='208'?'DO':field==='322'?'Z23':null
 const target=s.flatMap((row,i)=>row.tag===tag&&(qualifier===null||segmentComposite(row,tag==='CCI'?2:1,u)[0]===qualifier)?[i]:[])
 expect(target).toHaveLength(1);const at=target[0],expected=s.map(row=>row.raw)
 if(tag==='DTM')expected.splice(at,1)
 else if(tag==='CCI')expected.splice(at,2)
 else{
  const elements=expected[at].split(e),position=tag==='NAD'?2:field==='203'?2:4
  if(tag==='NAD'){const parts=elements[position].split(c);parts[0]='';elements[position]=parts.join(c)}
  else elements[position]=''
  expected[at]=elements.join(e)
 }
 const unh=expected.findIndex(row=>row.startsWith('UNH'+e)),unt=expected.findIndex(row=>row.startsWith('UNT'+e))
 const trailer=expected[unt].split(e);trailer[1]=String(unt-unh+1);expected[unt]=trailer.join(e)
 const result=omitPermissionField(raw,field),actual=tokenizeEdifact(result)
 expect(result).not.toBe(raw);expect(actual.una).toEqual(u);expect(actual.segments.map(row=>row.raw)).toEqual(expected)
 expect(actual.segments.filter(row=>row.tag==='LIN').map(row=>({raw:row.raw,index:row.index})))
  .toEqual([{raw:'LIN'+e+'1',index:field==='205'||field==='206'?6:7}])
 return result
}

type Row=Record<string,unknown>
type MatchedNationalField=Exclude<EscoNationalField,'208'>
type NationalUniverse={customers:Row[];points:Row[];switches:Row[];facilities:Row[];customerInfo:Row[]}
type NationalMatchInput={source:EdielMessageRow;companyId:string;customerId:string;li:string;field:MatchedNationalField}
const clean=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// PRE-state only: this never calls the matcher to manufacture its expected result.
export function qualifyEscoNationalMatcherPrestate(universe:NationalUniverse,input:NationalMatchInput):EdielBusinessMatchResult{
 const {source,companyId,customerId,li,field}=input
 expect(['203','205','206','207','313','322']).toContain(field)
 expect(source).toMatchObject({company_id:companyId,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14',
  customer_id:customerId,metering_point_id:null,switch_request_id:null,grid_owner_data_request_id:null})
 for(const column of ['site_id','process_type','transaction_reference'] as const){
  expect(Object.hasOwn(source,column)).toBe(true);expect(source[column]===null||typeof source[column]==='string').toBe(true)
 }
 expect(source.raw_payload).toBeTruthy();const wire=tokenizeEdifact(source.raw_payload!),s=wire.segments,u=wire.una
 expect(s.filter(row=>row.tag==='UNH')).toHaveLength(1);expect(s.filter(row=>row.tag==='LIN').map(row=>row.raw)).toEqual(['LIN+1'])
 expect(segmentComposite(s.find(row=>row.tag==='UNH'),2,u)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(s.filter(row=>row.tag==='LOC')).toEqual([])
 const refs=s.filter(row=>row.tag==='RFF').map(row=>segmentComposite(row,1,u))
 expect(refs).toEqual([['LI',li]])
 expect(s.filter(row=>row.tag==='NAD'&&['UD','IT'].includes((segmentComposite(row,1,u)[0]??'').toUpperCase()))).toEqual([])
 const bgm=s.filter(row=>row.tag==='BGM');expect(bgm).toHaveLength(1)
 expect(segmentComposite(bgm[0],1,u)).toEqual(['Z14'])
 const document=segmentComposite(bgm[0],2,u)[0]||null
 expect(clean(source.external_reference)).toBe(document);expect(document===null).toBe(field==='203')
 const reasons=s.flatMap((row,i)=>row.tag==='CCI'&&segmentComposite(row,2,u)[0]==='Z13'?[i]:[])
 expect(reasons).toHaveLength(1);expect(s[reasons[0]+1].raw).toBe('CAV+Z96')
 expect(Object.keys(universe).sort()).toEqual(['customerInfo','customers','facilities','points','switches'])
 for(const rows of Object.values(universe))for(const row of rows)expect(row.company_id).toBe(companyId)
 const customerColumns=['id','company_id','customer_number','personal_number','org_number','email','status']
 for(const row of universe.customers)for(const column of customerColumns)expect(Object.hasOwn(row,column)).toBe(true)
 const searchedValues=[clean(source.external_reference),clean(source.customer_id)].filter((value):value is string=>value!==null)
 // Literal public loose-identifier domains, including UUID-only row IDs.
 const matches=universe.customers.filter(row=>searchedValues.some(value=>
  ['customer_number','personal_number','org_number','email'].some(column=>row[column]===value)||
  (uuid.test(value)&&typeof row.id==='string'&&row.id.toLowerCase()===value.toLowerCase())))
 expect(matches).toHaveLength(1);const customer=matches[0];expect(customer.id).toBe(customerId)
 expect(typeof customer.status==='string'||customer.status===null).toBe(true)
 const pointValues=[...new Set([clean(source.metering_point_id),clean(source.external_reference),clean(source.transaction_reference),li]
  .filter((value):value is string=>value!==null))]
 const normalized=[...new Set(pointValues.map(value=>value.replace(/[^0-9A-Za-z]/g,'').toUpperCase()).filter(Boolean))]
 for(const row of universe.points){
  for(const column of ['meter_point_id','metering_point_id','site_facility_id','ediel_reference','normalized_metering_point_id'])expect(Object.hasOwn(row,column)).toBe(true)
  expect(pointValues.some(value=>['meter_point_id','metering_point_id','site_facility_id','ediel_reference'].some(column=>row[column]===value))).toBe(false)
  expect(typeof row.normalized_metering_point_id==='string'&&normalized.includes(row.normalized_metering_point_id)).toBe(false)
 }
 // Fresh synthetic tenant: empty complete journals also exclude payload and
 // site/grid-owner context matches, not just exact random document references.
 expect(universe.switches).toEqual([]);expect(universe.facilities).toEqual([]);expect(universe.customerInfo).toEqual([])
 return {confidence:'high',customerId,siteId:source.site_id??null,meteringPointId:null,processId:null,processType:source.process_type,
  permissionId:null,candidates:[{entityType:'customer',entityId:customerId,confidence:'high',score:180,reason:'customer_id_already_set',
   details:{companyId,customerNumber:customer.customer_number,status:customer.status,searchedValues}}],
  reasons:['customer_id_already_set:180'],warnings:[],manualReviewReason:null}
}
export function captureEscoNationalMatcherPrestate(sql:<T>(query:string)=>T,lit:(value:string)=>string,input:NationalMatchInput){
 const tables={customers:'public.customers',points:'public.metering_points',switches:'public.supplier_switch_requests',
  facilities:'public.grid_owner_information_requests',customerInfo:'public.customer_info_requests'} as const
 const universe=sql<NationalUniverse>(`SELECT jsonb_build_object(${Object.entries(tables).map(([key,table])=>
  `'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r WHERE company_id=${lit(input.companyId)})`).join(',')})`)
 const expected=qualifyEscoNationalMatcherPrestate(universe,input)
 return {source:structuredClone(input.source),universe:structuredClone(universe),expected:structuredClone(expected)}
}

// Literal selected D.97A originals; never copy the validator's returned source
// or issue vector into its expected value. The closed N wire has 13 UNH..UNT
// segments, less the one omitted DTM or the two own status segments.
export function qualifyEscoNationalSyntax(actual:EdielSyntaxValidationResult,field:EscoNationalField){
 expect(['203','205','206','207','208','313','322']).toContain(field)
 const rejected=field==='207'||field==='208',count=field==='205'||field==='206'?12:field==='322'?11:13
 expect(actual).toEqual({ok:!rejected,issues:rejected?[{code:'UNSM_MANDATORY_ELEMENT_MISSING',severity:'error',
  title:'Full versionsbunden UNSM-grammatik',description:'PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'}]:[],
  declaredUntCount:count,actualMessageSegmentCount:count,grammarQualification:'qualified',grammarSources:[{messageIndex:1,
   key:'PRODAT:D:97A:UN',archiveSha256:'4a8fbe74935a140b0982f9b555571831e7b9d90311acdbf195ae481e2fe705a8',members:[
    {archiveMember:'EDIFACT/D97ADISK/EDMD.ZIP!EDIFACT/DIRECTOR/TRMD/PRODAT_D.97A',sha256:'f6d6258573235c642889c2d7404774d1fc642db4cb70c46ef7bb93a1c95f6cf9'},
    {archiveMember:'EDIFACT/D97ADISK/EDSD.ZIP!EDIFACT/DIRECTOR/TRSD/EDSD.97A',sha256:'f8e67ec915604e16768b153cd6b837ab47e0fb31265e4cfc154db246bf6d7c11'},
    {archiveMember:'EDIFACT/D97ADISK/EDCD.ZIP!EDIFACT/DIRECTOR/TRCD/EDCD.97A',sha256:'545aba5d4df750784d023633685835385b2fdbb49853769b2c79bbd1b7ccf2c1'},
   ]}]})
}

type UnresolvedInput={companyId:string;sender:string;receiver:string;li:string;actorSettingId:string;
 interchangeReference:string;documentReference:string}
type Window=readonly[number,number]
const unresolvedColumns=['id','company_id','source_message_id','issue_type','severity','extracted_identifiers','suggested_matches','status',
 'assigned_to','resolved_by','resolved_at','created_at','environment','inbound_email_message_id','ediel_message_id','reason','resolution_status',
 'candidate_company_ids','parsed_sender_ediel_id','parsed_receiver_ediel_id','parsed_subaddress','message_family','message_code','raw_payload',
 'raw_sender','raw_receiver','raw_interchange_reference','raw_message_type','suggested_company_id','created_by','updated_at','inbound_quarantine_id'] as const
// The setting ID comes from the caller's independent PRE source capture, never
// the returned tenant observation. Transport alone does not resolve a tenant.
export function escoNationalUnresolved208Resolution(input:UnresolvedInput){
 expect(input.actorSettingId).toMatch(uuid)
 return {status:'unresolved',companyId:null,transportEdielId:input.receiver,marketActorEdielId:null,receiverEdielId:input.receiver,
  receiverSubaddress:null,source:null,confidence:0,reasons:[`UNB receiver ${input.receiver} kunde inte matchas säkert till tenant i test.`],
  warnings:[],candidateCompanyIds:[],evidence:[{companyId:input.companyId,source:'ediel_actor_settings',score:100,details:{
   actorSettingId:input.actorSettingId,matchedTransport:true,matchedMarketActor:false,subaddressRequired:false,
   transportEdielId:input.receiver,marketActorEdielId:null,receiverEdielId:input.receiver,receiverSubaddress:null,applicationReference:'23-DGI-PRODAT'}}]}
}
function observedTime(value:unknown,window:Window){
 expect(window.every(Number.isFinite)).toBe(true);expect(window[0]).toBeLessThanOrEqual(window[1])
 expect(typeof value).toBe('string');const instant=Date.parse(String(value));expect(Number.isFinite(instant)).toBe(true)
 expect(instant).toBeGreaterThanOrEqual(window[0]);expect(instant).toBeLessThanOrEqual(window[1]);return value
}
function qualifyUnresolved208Before(before:Row,input:UnresolvedInput){
 expect(Object.keys(before)).toHaveLength(127)
 expect(before).toMatchObject({company_id:input.companyId,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(typeof before.id).toBe('string');expect(before.id).toMatch(uuid);expect(typeof before.raw_payload).toBe('string')
 expect(before.immutable_payload_hash).toBe(createHash('sha256').update(String(before.raw_payload)).digest('hex'))
 const wire=tokenizeEdifact(String(before.raw_payload)),s=wire.segments,u=wire.una
 for(const tag of ['UNB','UNH','BGM','LIN','NAD'])expect(s.filter(row=>row.tag===tag)).toHaveLength(tag==='NAD'?2:1)
 expect(segmentComposite(s.find(row=>row.tag==='UNB'),2,u)).toEqual([input.sender,'ZZ'])
 expect(segmentComposite(s.find(row=>row.tag==='UNB'),3,u)).toEqual([input.receiver,'ZZ'])
 expect(segmentComposite(s.find(row=>row.tag==='UNB'),5,u)).toEqual([input.interchangeReference])
 expect(segmentComposite(s.find(row=>row.tag==='UNB'),7,u)).toEqual(['23-DGI-PRODAT'])
 expect(segmentComposite(s.find(row=>row.tag==='UNH'),2,u)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(segmentComposite(s.find(row=>row.tag==='BGM'),1,u)).toEqual(['Z14'])
 expect(segmentComposite(s.find(row=>row.tag==='BGM'),2,u)).toEqual([input.documentReference])
 expect(s.filter(row=>row.tag==='LIN').map(row=>row.raw)).toEqual(['LIN+1']);expect(s.filter(row=>row.tag==='LOC')).toEqual([])
 expect(s.filter(row=>row.tag==='RFF').map(row=>segmentComposite(row,1,u))).toEqual([['LI',input.li]])
 const nad=s.filter(row=>row.tag==='NAD')
 expect(nad.map(row=>segmentComposite(row,1,u))).toEqual([['FR'],['DO']])
 expect(segmentComposite(nad[0],2,u)).toEqual([input.sender,'160','SVK']);expect(segmentComposite(nad[1],2,u)).toEqual(['','160','SVK'])
 expect((before.parsed_payload as Row).tenantResolution).toBeUndefined();expect((before.validation_report as Row).tenantResolution).toBeUndefined()
}
export function qualifyEscoNationalUnresolved208Source(actual:Row,before:Row,input:UnresolvedInput,window:Window){
 qualifyUnresolved208Before(before,input);const resolution=escoNationalUnresolved208Resolution(input)
 const updated=observedTime(actual.updated_at,window)
 expect(Date.parse(String(updated))).toBeGreaterThanOrEqual(Date.parse(String(before.updated_at)))
 expect(actual).toEqual({...before,tenant_resolution_status:'tenant_not_found',business_match_status:'business_blocked',processing_status:'routing_unresolved',
  parsed_payload:{...(before.parsed_payload as Row),tenantResolution:resolution},validation_report:{...(before.validation_report as Row),tenantResolution:resolution},
  failure_reason:'Routing unresolved: meddelandet är tekniskt läsbart men kunde inte kopplas säkert till tenant.',updated_at:updated})
 return resolution
}
export function qualifyEscoNationalUnresolved208Item(actual:Row,sourceId:string,input:UnresolvedInput,window:Window){
 expect(actual.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
 const created=observedTime(actual.created_at,window);expect(actual.updated_at).toBe(created)
 const resolution=escoNationalUnresolved208Resolution(input)
 expect(actual).toEqual({...Object.fromEntries(unresolvedColumns.map(column=>[column,null])),id:actual.id,company_id:input.companyId,
  source_message_id:sourceId,issue_type:'tenant_not_found',severity:'warning',status:'open',environment:'test',candidate_company_ids:[],
  extracted_identifiers:{sender:input.sender,senderSubAddress:null,receiver:input.receiver,receiverSubAddress:null,applicationReference:'23-DGI-PRODAT',
   interchangeReference:input.interchangeReference,messageFamily:'PRODAT',messageCode:'Z14',bgmReference:input.documentReference,
   transactionReference:input.li,businessReference:input.li,tenantResolution:resolution},suggested_matches:resolution.evidence,created_at:created,updated_at:created})
}
export function captureEscoNationalUnresolved208Owner(sql:<T>(query:string)=>T,lit:(value:string)=>string,before:Row,input:UnresolvedInput){
 const sourceBefore=structuredClone(before),basis=structuredClone(input);qualifyUnresolved208Before(sourceBefore,basis)
 const table='public.ediel_unresolved_items',types:Row={id:'uuid',company_id:'uuid',source_message_id:'uuid',assigned_to:'uuid',resolved_by:'uuid',
  resolved_at:'timestamp with time zone',created_at:'timestamp with time zone',inbound_email_message_id:'uuid',ediel_message_id:'uuid',candidate_company_ids:'uuid[]',
  extracted_identifiers:'jsonb',suggested_matches:'jsonb',suggested_company_id:'uuid',created_by:'uuid',updated_at:'timestamp with time zone',inbound_quarantine_id:'uuid'}
 const defaults:Row={id:'gen_random_uuid()',severity:"'warning'::text",extracted_identifiers:"'{}'::jsonb",suggested_matches:"'[]'::jsonb",
  status:"'open'::text",created_at:'now()',updated_at:'now()',candidate_company_ids:"'{}'::uuid[]"}
 const nonnull=['id','issue_type','severity','extracted_identifiers','suggested_matches','status','created_at','candidate_company_ids','updated_at']
 const schema=sql<Row[]>(`SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attname) FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=${lit(table)}::regclass AND a.attnum>0 AND NOT a.attisdropped`)
 const byName=(a:Row,b:Row)=>String(a.name).localeCompare(String(b.name))
 expect([...schema].sort(byName)).toEqual(unresolvedColumns.map(name=>({name,type:types[name]??'text',nullable:!nonnull.includes(name),default:defaults[name]??null})).sort(byName))
 const read=()=>sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r`)
 let prior=structuredClone(read()),calls=0
 expect(prior.filter(row=>row.source_message_id===sourceBefore.id)).toEqual([])
 return {qualify(window:Window){
  const now=read();for(const row of prior)expect(now.find(next=>next.id===row.id)).toEqual(row)
  const added=now.filter(row=>!prior.some(old=>old.id===row.id))
  if(calls===0){expect(added).toHaveLength(1);qualifyEscoNationalUnresolved208Item(added[0],String(sourceBefore.id),basis,window)}
  else expect(now).toEqual(prior)
  const own=now.filter(row=>row.source_message_id===sourceBefore.id);expect(own).toHaveLength(1)
  prior=structuredClone(now);calls++;return structuredClone(own[0])
 }}
}

type NationalRegistryBasis={sourceHash:string;databaseProfileKey?:string;messageProfileId:string;rulePackId:string;
 originalVersion:string;originalSnapshot:OriginalRulePackWitness}
type CanonicalNationalInput={sender:string;receiver:string;li:string;status:'A13'|'A76';healthyWire:string;registry:NationalRegistryBasis|null}
const nationalProfile='prodat_z14_permission_response'
const nationalHeaderFields={
 '203':{name:'message_id',description:'BGM/1004',path:'BGM/1004',component:{documentElement:2},text:'Meddelandeidentifikation saknas'},
 '205':{name:'document_date',description:'DTM+137',path:'DTM+137',component:{valueElement:'C507/2380',formatElement:'C507/2379',dateQualifier:'137'},text:'Meddelandedatum saknas'},
 '206':{name:'timezone',description:'DTM+ZZZ',path:'DTM+ZZZ',component:{valueElement:'C507/2380',formatElement:'C507/2379',dateQualifier:'ZZZ'},text:'Tidszon saknas'},
 '313':{name:'request_for_acknowledgement',description:'BGM/4343',path:'BGM/4343',component:{documentElement:4},text:'Kvittensbegäran saknas'},
} as const
function nationalCanonicalVector(field:MatchedNationalField,li:string,registry:NationalRegistryBasis|null){
 const syntaxText='PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'
 if(field==='207'){
  expect(registry).toBeNull()
  return {syntaxDecision:'rejected',applicationDecision:'not_applicable',functionalDecision:'not_applicable',
   issues:[{layer:'syntax',severity:'error',code:'UNSM_MANDATORY_ELEMENT_MISSING',title:'Full versionsbunden UNSM-grammatik',description:syntaxText,source:'validateEdifactSyntax'}],
   sourceRules:['CANONICAL_RUNTIME_3_0_POLICY'],decisionTrace:['Canonical parser: PRODAT Z14 (E2SE6A).',`Syntax validator: avvisad (${syntaxText}).`],
   responsePlan:[{family:'CONTRL',outcome:'negative',reason:syntaxText}],policyProfile:null,disposition:undefined,ignored:undefined,register:undefined,application:undefined,evidence:undefined}
 }
 expect(registry).not.toBeNull();if(!registry)throw Error('esco_national_independent_PRE_registry_required')
 expect(registry.sourceHash).toMatch(/^[0-9a-f]{64}$/);expect(registry.messageProfileId).toMatch(uuid);expect(registry.rulePackId).toMatch(uuid)
 const snapshot=registry.originalSnapshot,dbProfile=registry.databaseProfileKey??nationalProfile
 expect(Object.keys(snapshot).sort()).toEqual(['guideSources','messageProfile','rulePack'])
 expect(snapshot.rulePack).toMatchObject({id:registry.rulePackId,source_hash:registry.sourceHash})
 expect(snapshot.messageProfile).toMatchObject({id:registry.messageProfileId,rule_pack_id:registry.rulePackId,profile_key:dbProfile})
 expect(Array.isArray(snapshot.guideSources)).toBe(true)
 for(const guide of snapshot.guideSources)expect(guide.rule_pack_id).toBe(registry.rulePackId)
 expect(registry.originalVersion).toBe(`${snapshot.rulePack.guide_version}:r${snapshot.rulePack.guide_revision}`)
 if(registry.databaseProfileKey!==undefined){expect(registry.databaseProfileKey.trim()).toBe(registry.databaseProfileKey);expect(registry.databaseProfileKey).not.toBe('')}
 const object=field==='322',header=object?null:nationalHeaderFields[field],absent={kind:'absent'},unavailable={kind:'unavailable'}
 const occurrence={ownReferences:object?{objectId:absent,lineItemReference:{kind:'present',value:li},customerId:absent}:
  {objectId:unavailable,lineItemReference:unavailable,customerId:unavailable},scope:object?'object':'header',messageReference:'1',
  lineIndex:object?0:null,lineNumber:object?'1':null,registerPosition:object?1:null,objectId:null,identityAgency:null,lineItemReference:object?li:null}
 const path=object?'CCI++Z23/CAV':header!.path,code=object?'PRODAT_PERMISSION_322_MISSING':'FIELD_MATRIX_REQUIRED_FIELD_MISSING'
 const diagnostic={kind:'field',fieldNumber:field,errorKind:'missing',sourceRule:object?'PRODAT26A:P21/73/75/119/123':`PRODAT26A:§2.2:Z14:${field}`,
  segmentPath:path,group:object?'SG8/SG14':'header',component:{locator:path,...(object?{composite:'C889',cavComponent:0}:header!.component)},occurrence}
 const text=object?'Tillståndets status saknas':header!.text,aperakText={kind:'ready',text,fallback:object?'unavailable':'not_needed'}
 const issues=[{layer:'application',severity:'error',code,title:object?'Tillståndsfält 322':`${header!.name} saknas`,
  description:object?'P26.A s.21/73/75/123: 322 missing':`${header!.description} krävs för PRODAT Z14.`,source:'validateCanonicalPolicyFields',
  prodatDiagnostic:diagnostic,prodatAperakText:aperakText,originalSeverity:'error'}]
 const responsePlan=[{family:'CONTRL',outcome:'positive',reason:'Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.'},
  {family:'APERAK',outcome:'negative',erc:'41',ftx:text,reason:'PRODAT innehåller ett blockerande canonical policy-/fältfel.',applicationErrors:[
   {ercCode:'41',fieldCode:field,text,prodatAperakText:aperakText,prodatOccurrence:occurrence,referenceQualifier:null,referenceNumber:null,
    lineItemReference:object?li:null,prodatFieldDiagnostic:diagnostic}]}]
 const registers=[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:field==='205'||field==='206'?6:7}]
 const scope={messageIndex:0,messageReference:'1',objectId:null,identityAgency:null,registers}
 return {syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted',issues,responsePlan,
  sourceRules:['CANONICAL_RUNTIME_3_0_POLICY','CANONICAL_EDIEL_POLICY','PRODAT_26A_POLICY_FIELD_VALIDATOR','PRODAT_DEPENDENT_CONDITION_ENGINE',
   `RULE_PACK_EVIDENCE:${nationalProfile}:${registry.sourceHash}`],
  decisionTrace:['Canonical parser: PRODAT Z14 (E2SE6A).','Syntax validator: accepterad.',
   'PRODAT Z14N validerades mot en canonical policy med 16 D-villkor.',`DB evidence verifierad för source-owned policy: ${nationalProfile}.`],
  policyProfile:nationalProfile,disposition:{kind:'continue',reasons:[]},ignored:[],
  register:{version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[{...scope,disposition:'accepted',reasons:[]}]},
  application:{version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision:object?'accepted':'rejected',
   objects:[{...scope,applicationDecision:'rejected',reasonCodes:[code]}]},
  evidence:{profileKey:nationalProfile,...(registry.databaseProfileKey!==undefined?{databaseProfileKey:registry.databaseProfileKey}:{}),
   messageProfileId:registry.messageProfileId,rulePackId:registry.rulePackId,sourceHash:registry.sourceHash,version:registry.originalVersion,snapshot}}
}
// Capture before the public command: never turn a returned decision/witness
// into its expected value. The caller separately proves dated registry admission.
export function captureEscoNationalCanonical(before:EdielMessageRow&{immutable_payload_hash:string},field:MatchedNationalField,input:CanonicalNationalInput){
 expect(['203','205','206','207','313','322']).toContain(field)
 const source=structuredClone(before),basis=structuredClone(input),healthy=tokenizeEdifact(basis.healthyWire)
 expect(source).toMatchObject({environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(source.company_id).toMatch(uuid);expect(source.id).toMatch(uuid)
 expect(healthy.segments.map(row=>row.tag)).toEqual(['UNB','UNH','BGM','DTM','DTM','NAD','NAD','LIN','CCI','CAV','CCI','CAV','RFF','UNT','UNZ'])
 expect(source.raw_payload).toBe(omitEscoNationalField(basis.healthyWire,field,basis))
 expect(source.immutable_payload_hash).toBe(createHash('sha256').update(source.raw_payload!).digest('hex'))
 const expected=nationalCanonicalVector(field,basis.li,basis.registry)
 return {qualify(actual:CanonicalRuntimeDecision){
  const states={syntaxDecision:actual.syntaxDecision,applicationDecision:actual.applicationDecision,functionalDecision:actual.functionalDecision}
  expect(states).toEqual({syntaxDecision:expected.syntaxDecision,applicationDecision:expected.applicationDecision,functionalDecision:expected.functionalDecision})
  expect(actual.issues).toEqual(expected.issues);expect(actual.sourceRules).toEqual(expected.sourceRules);expect(actual.decisionTrace).toEqual(expected.decisionTrace)
  expect(actual.responsePlan).toEqual(expected.responsePlan)
  if(field==='207')expect(actual.policy).toBeNull();else expect(actual.policy?.profileKey).toBe(expected.policyProfile)
  expect(actual.prodatProcessingDisposition).toEqual(expected.disposition);expect(actual.prodatIgnoredFields).toEqual(expected.ignored)
  expect(actual.prodatRegisterValidation).toEqual(expected.register);expect(actual.prodatApplicationValidation).toEqual(expected.application)
  expect(actual.prodatSourceFunctionValidation).toBeUndefined();expect(actual.utiltsBusinessOutcome).toBeNull()
  for(const key of ['utiltsFunctionalValidation','utiltsHeaderValidation','utiltsTransactionValidation'] as const)expect(actual[key]).toBeUndefined()
  const report=actual.validationReport
  expect(report.canonicalRuntimeVersion).toBe('3.0-policy');expect(report.utiltsBusinessOutcome).toBeNull()
  for(const key of ['syntaxDecision','applicationDecision','functionalDecision','issues','sourceRules','decisionTrace','responsePlan'] as const)expect(report[key]).toEqual(expected[key])
  expect(report.rulePackEvidence).toEqual(expected.evidence);expect(report.prodatProcessingDisposition).toEqual(expected.disposition);expect(report.prodatIgnoredFields).toEqual(expected.ignored)
  if(field==='207')expect(Object.hasOwn(report,'rulePackEvidence')).toBe(false)
  expect(report.fieldRuleSource).toBe(field==='207'?undefined:'canonical_policy')
  qualifyEscoNationalSyntax(report.syntax as EdielSyntaxValidationResult,field)
 }}
}

type RegistryNationalField=Exclude<MatchedNationalField,'207'>
const nationalRegistryTables=['ediel_rule_packs','ediel_message_profiles','ediel_runtime_capabilities','ediel_rule_pack_sources'] as const
export function captureEscoNationalRegistry(sql:<T>(query:string)=>T,lit:(value:string)=>string,
 before:EdielMessageRow&{immutable_payload_hash:string},field:RegistryNationalField,input:Omit<CanonicalNationalInput,'registry'>){
 expect(['203','205','206','313','322']).toContain(field)
 const source=structuredClone(before),basis=structuredClone(input)
 expect(source).toMatchObject({environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(source.id).toMatch(uuid);expect(source.company_id).toMatch(uuid)
 expect(tokenizeEdifact(basis.healthyWire).segments.map(row=>row.tag)).toEqual(['UNB','UNH','BGM','DTM','DTM','NAD','NAD','LIN','CCI','CAV','CCI','CAV','RFF','UNT','UNZ'])
 expect(source.raw_payload).toBe(omitEscoNationalField(basis.healthyWire,field,basis))
 expect(source.immutable_payload_hash).toBe(createHash('sha256').update(source.raw_payload!).digest('hex'))
 const instant=parseSourceReceiptInstant(source.message_received_at)
 expect(instant).not.toBeNull();if(instant===null)throw Error('esco_national_original_receipt_required')
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date(Number(instant/BigInt(1000))))
 const datePart=(type:string)=>parts.find(part=>part.type===type)!.value
 const businessDate=`${datePart('year')}-${datePart('month')}-${datePart('day')}`
 expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(businessDate>='2026-04-01').toBe(true)
 // One MVCC statement captures every candidate before capability/readiness
 // checks and the complete original rows. No authority is created or selected
 // by a copied runtime observation; retained receipt selects the guide date.
 const captured=sql<Row>(`WITH params AS (SELECT ${lit(businessDate)}::date AS business_date),
candidates AS (
 SELECT rp.id AS pack_id, mp.id AS profile_id,
        to_jsonb(rp) AS pack, to_jsonb(mp) AS profile,
        mp.message_code, mp.transaction_subtype
 FROM public.ediel_rule_packs rp
 JOIN public.ediel_message_profiles mp ON mp.rule_pack_id=rp.id AND mp.is_enabled
 CROSS JOIN params p
 WHERE rp.market='electricity' AND rp.family='PRODAT'
   AND mp.message_code='Z14' AND mp.transaction_subtype='N'
   AND mp.direction IN ('inbound','both')
   AND rp.status IN ('active','transition','future')
   AND p.business_date>=rp.valid_from
   AND (rp.valid_to IS NULL OR p.business_date<=rp.valid_to)
), resolved AS (
 SELECT c.*, to_jsonb(rc) AS capability,
  jsonb_build_object(
   'rule_pack_id',c.pack_id,'message_profile_id',c.profile_id,
   'market',c.pack->'market','family',c.pack->'family',
   'guide_version',c.pack->'guide_version','guide_revision',c.pack->'guide_revision',
   'unh_association_code',c.pack->'unh_association_code',
   'valid_from',c.pack->'valid_from','valid_to',c.pack->'valid_to',
   'source_document',c.pack->'source_document','source_hash',c.pack->'source_hash',
   'field_matrix_version',c.pack->'field_matrix_version',
   'profile_key',c.profile->'profile_key','business_process',c.profile->'business_process',
   'phase',c.profile->'phase','profile',c.profile->'profile',
   'parser_ready',coalesce(rc.parser_ready,false),'builder_ready',coalesce(rc.builder_ready,false),
   'validator_ready',coalesce(rc.validator_ready,false),'ack_ready',coalesce(rc.ack_ready,false),
   'state_machine_ready',coalesce(rc.state_machine_ready,false)) AS raw_evidence
 FROM candidates c LEFT JOIN public.ediel_runtime_capabilities rc
 ON rc.rule_pack_id=c.pack_id AND rc.message_code=c.message_code
 AND rc.transaction_subtype=c.transaction_subtype AND rc.direction IN ('inbound','both')
), originals AS (
 SELECT r.*,r.raw_evidence||jsonb_build_object(
  'original_version',(r.pack->>'guide_version')||':r'||(r.pack->>'guide_revision'),
  'original_snapshot',jsonb_build_object(
   'rulePack',r.pack,'messageProfile',r.profile,'guideSources',
   (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
    FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=r.pack_id))) AS witness
 FROM resolved r
), global_images AS (
 SELECT 'ediel_rule_packs' AS table_name,count(*) AS row_count,
 coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) AS image FROM public.ediel_rule_packs t
 UNION ALL SELECT 'ediel_message_profiles',count(*),coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.ediel_message_profiles t
 UNION ALL SELECT 'ediel_runtime_capabilities',count(*),coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.ediel_runtime_capabilities t
 UNION ALL SELECT 'ediel_rule_pack_sources',count(*),coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.ediel_rule_pack_sources t
)
SELECT jsonb_build_object(
 'businessDate',(SELECT business_date FROM params),
 'candidateCount',(SELECT count(*) FROM candidates),
 'resolvedCount',(SELECT count(*) FROM resolved),
 'candidates',(SELECT coalesce(jsonb_agg(jsonb_build_object('rulePack',pack,'messageProfile',profile) ORDER BY pack_id,profile_id),'[]'::jsonb) FROM candidates),
 'resolved',(SELECT coalesce(jsonb_agg(jsonb_build_object('rulePackId',pack_id,'messageProfileId',profile_id,'runtimeCapability',capability,'rawEvidence',raw_evidence) ORDER BY pack_id,profile_id,capability->>'id'),'[]'::jsonb) FROM resolved),
 'selectedOriginal',CASE WHEN (SELECT count(*) FROM candidates)=1 AND (SELECT count(*) FROM resolved)=1
  THEN (SELECT witness FROM originals) ELSE NULL END,
 'globalRegistryBaseline',(SELECT jsonb_object_agg(table_name,image ORDER BY table_name) FROM global_images))`)
 expect(captured.businessDate).toBe(businessDate);expect(captured.candidateCount).toBe(1);expect(captured.resolvedCount).toBe(1)
 const original=captured.selectedOriginal as Row;expect(original).not.toBeNull()
 const snapshot=original.original_snapshot as OriginalRulePackWitness,pack=snapshot.rulePack,profile=snapshot.messageProfile
 expect(Object.keys(snapshot).sort()).toEqual(['guideSources','messageProfile','rulePack'])
 expect(pack.id).toMatch(uuid);expect(profile.id).toMatch(uuid)
 expect(pack).toMatchObject({market:'electricity',family:'PRODAT',status:'active',guide_version:'26.A',guide_revision:'3',unh_association_code:'E2SE6A',
  source_document:'PRODAT 26.A revision 3',source_hash:'17f05b4f0d9b7eefc72cb88dd424e22b7c57537c341140d1227d237b2a6c2830'})
 expect(typeof pack.valid_from).toBe('string');expect(pack.valid_from).toBe('2026-04-01');expect(pack.valid_to).toBeNull()
 expect(profile).toMatchObject({rule_pack_id:pack.id,is_enabled:true,message_code:'Z14',transaction_subtype:'N',
  profile_key:'PRODAT:Z14:N:26.A:r3',business_process:'metering_permission_rejected'})
 expect(['inbound','both']).toContain(profile.direction)
 expect(profile.profile).toMatchObject({family:'PRODAT',messageCode:'Z14',transactionSubtype:'N',guideVersion:'26.A',guideRevision:'3',
  canonicalDirection:profile.direction,senderRole:'grid_owner',receiverRole:'esco',businessProcess:'metering_permission_rejected',
  businessEvent:'metering_reporting_permission_rejected',reasonForTransaction:'Z96'})
 expect(captured.candidates).toEqual([{rulePack:pack,messageProfile:profile}])
 const resolved=captured.resolved as Row[];expect(resolved).toHaveLength(1)
 const capability=resolved[0].runtimeCapability as Row
 expect(capability).toMatchObject({rule_pack_id:pack.id,message_code:'Z14',transaction_subtype:'N'})
 expect(capability.id).toMatch(uuid);expect(['inbound','both']).toContain(capability.direction)
 for(const key of ['parser_ready','validator_ready','ack_ready','state_machine_ready'])expect(capability[key]).toBe(true)
 expect(typeof capability.builder_ready).toBe('boolean')
 const packFields=['market','family','guide_version','guide_revision','unh_association_code','valid_from','valid_to','source_document','source_hash','field_matrix_version']
 const readiness=['parser_ready','builder_ready','validator_ready','ack_ready','state_machine_ready']
 const raw={rule_pack_id:pack.id,message_profile_id:profile.id,...Object.fromEntries(packFields.map(key=>[key,pack[key]])),
  profile_key:profile.profile_key,business_process:profile.business_process,phase:profile.phase,profile:profile.profile,
  ...Object.fromEntries(readiness.map(key=>[key,capability[key]]))}
 expect(resolved).toEqual([{rulePackId:pack.id,messageProfileId:profile.id,runtimeCapability:capability,rawEvidence:raw}])
 expect(original).toEqual({...raw,original_version:'26.A:r3',original_snapshot:snapshot})
 const global=structuredClone(captured.globalRegistryBaseline) as Record<string,Row[]>
 expect(Object.keys(global).sort()).toEqual([...nationalRegistryTables].sort())
 for(const table of nationalRegistryTables)expect(Array.isArray(global[table])).toBe(true)
 expect(global.ediel_rule_packs.filter(row=>row.id===pack.id)).toEqual([pack])
 expect(global.ediel_message_profiles.filter(row=>row.id===profile.id)).toEqual([profile])
 expect(global.ediel_runtime_capabilities.filter(row=>row.id===capability.id)).toEqual([capability])
 expect(snapshot.guideSources).toEqual(global.ediel_rule_pack_sources.filter(row=>row.rule_pack_id===pack.id))
 const registry:NationalRegistryBasis=structuredClone({sourceHash:String(pack.source_hash),databaseProfileKey:String(profile.profile_key),
  messageProfileId:String(profile.id),rulePackId:String(pack.id),originalVersion:'26.A:r3',originalSnapshot:snapshot})
 return {businessDate,get basis(){return structuredClone(registry)},conserved(){
  const current=sql<Record<string,Row[]>>(`SELECT jsonb_build_object(${nationalRegistryTables.map(table=>
   `'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.${table} t)`).join(',')})`)
  expect(current).toEqual(global)
 }}
}

// The complete received original is frozen BEFORE processing. Fresh UNB
// entropy and minute clocks are qualified before any full-row projection.
export function captureEscoNationalAckWire(before:EdielMessageRow&{immutable_payload_hash:string},field:EscoNationalField,
 input:Omit<CanonicalNationalInput,'registry'>){
 expect(['203','205','206','207','208','313','322']).toContain(field)
 const source=structuredClone(before),basis=structuredClone(input)
 expect(source).toMatchObject({environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(source.id).toMatch(uuid);expect(source.company_id).toMatch(uuid)
 expect(source.raw_payload).toBe(omitEscoNationalField(basis.healthyWire,field,basis))
 expect(source.immutable_payload_hash).toBe(createHash('sha256').update(source.raw_payload!).digest('hex'))
 const received=parseSourceReceiptInstant(source.message_received_at)
 expect(received).not.toBeNull();if(received===null)throw Error('esco_national_original_receipt_required')
 const healthy=tokenizeEdifact(basis.healthyWire)
 expect(healthy.segments.filter(row=>row.tag==='NAD').map(row=>row.raw)).toEqual([
  `NAD+FR+${basis.sender}:160:SVK+++++++SE`,`NAD+DO+${basis.receiver}:160:SVK+++++++SE`])
 const original=tokenizeEdifact(source.raw_payload!),u=original.una
 expect(u).toEqual(DEFAULT_UNA)
 const transport=original.segments.find(row=>row.tag==='UNB')!,bgm=original.segments.find(row=>row.tag==='BGM')!
 const sourceRef=segmentComposite(transport,5,u)[0],document=segmentComposite(bgm,2,u)[0]
 const sender=segmentComposite(transport,2,u).join(':'),receiver=segmentComposite(transport,3,u).join(':')
 expect(sender).toBe(basis.sender+':ZZ');expect(receiver).toBe(basis.receiver+':ZZ')
 const arrival=new Date(Number(received/BigInt(1000))+3600000).toISOString().slice(0,16).replace(/[-T:]/g,'')
 return {qualify(raw:string,window:Window){
  expect(window.every(Number.isFinite)).toBe(true);expect(window[0]).toBeLessThanOrEqual(window[1])
  expect(window[1]-window[0]).toBeLessThanOrEqual(120000)
  const ack=tokenizeEdifact(raw),s=ack.segments;expect(ack.una).toEqual(DEFAULT_UNA)
  expect(raw).toBe(serializeUna(DEFAULT_UNA)+s.map(row=>row.raw).join("'")+"'")
  const family=segmentComposite(s[1],2,ack.una)[0];expect(['CONTRL','APERAK']).toContain(family)
  const object=family==='APERAK',negative=object||field==='207'||field==='208'
  if(object)expect(['205','206','313','322']).toContain(field)
  const interchange=segmentComposite(s[0],5,ack.una)[0];expect(interchange).toMatch(/^[0-9A-F]{14}$/)
  // Independently enumerate every minute intersecting the actual invocation,
  // retaining Stockholm DST for generation and fixed UTC+1 for arrival.
  const clocks=[] as string[]
  for(let instant=Math.floor(window[0]/60000)*60000;instant<=window[1];instant+=60000){
   const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(instant))
   const part=(type:string)=>parts.find(row=>row.type===type)!.value
   clocks.push(['year','month','day','hour','minute'].map(part).join(''))
  }
  const creation=s[0].elements[4];expect(clocks.map(value=>value.slice(2,8)+':'+value.slice(8))).toContain(creation)
  expect(s[0].elements).toEqual(['UNB','UNOC:3',receiver,sender,creation,interchange,'','23-DGI-PRODAT','',object?'1':'','','1'])
  const type=object?'APERAK:D:96A:UN:E2SE6A':'CONTRL:2:2:UN:EDIEL2'
  const business=object?(()=>{
   const generated=segmentComposite(s[3],1,ack.una)[1];expect(clocks).toContain(generated)
   const text=field==='322'?'Tillståndets status saknas':nationalHeaderFields[field as keyof typeof nationalHeaderFields].text
   return [`BGM+++${field==='322'?'34':'27'}`,`DTM+137:${generated}:203`,`DTM+178:${arrival}:203`,
    `RFF+ACW:${document}`,`NAD+FR+${basis.receiver}:160:SVK+++++++SE`,`NAD+DO+${basis.sender}:160:SVK+++++++SE`,
    'ERC+41::260',`FTX+AAO++${field}::260+${text}`,...(field==='322'?[`RFF+LI:${basis.li}`]:[])]
  })():[`UCI+${sourceRef.slice(0,14)}+${sender}+${receiver}+${negative?'4':'1'}`]
  expect(s.map(row=>row.raw)).toEqual([s[0].raw,`UNH+1+${type}`,...business,`UNT+${business.length+2}+1`,`UNZ+1+${interchange}`])
  return {family:family as 'CONTRL'|'APERAK',outcome:negative?'negative' as const:'positive' as const,
   scope:object?(field==='322'?'object' as const:'message' as const):'interchange' as const,
   messageReference:'1',interchangeReference:interchange,rawPayload:raw}
 }}
}

// Independent READ-only birth/identity binding. It creates a comparison value,
// never a durable source-rule receipt or application capability.
const nationalSourceColumns=["id","company_id","direction","message_standard","message_family","message_code","message_version","process_type","environment","test_flag","status","transport_type","mailbox","mailbox_message_id","sender_ediel_id","sender_name","sender_sub_address","receiver_ediel_id","receiver_name","receiver_sub_address","sender_email","receiver_email","subject","file_name","mime_type","interchange_reference","external_reference","correlation_reference","transaction_reference","application_reference","original_message_id","original_transaction_id","original_message_code","related_message_id","communication_route_id","outbound_request_id","switch_request_id","grid_owner_data_request_id","partner_export_id","customer_id","site_id","metering_point_id","grid_owner_id","raw_payload","parsed_payload","validation_report","requires_contrl","requires_aperak","contrl_status","aperak_status","utilts_err_status","ack_outcome","syntax_check_status","functional_check_status","failure_reason","message_created_at","message_received_at","message_sent_at","parsed_at","validated_at","acknowledged_at","failed_at","ack_due_at","created_at","updated_at","created_by","updated_by","metadata","unb_sender_id","unb_sender_subaddress","unb_receiver_id","unb_receiver_subaddress","message_reference","bgm_code","bgm_reference","tenant_resolution_status","business_match_status","ack_status","processing_status","raw_payload_hash","utilts_subtype","measurement_resolution","backend_automation_status","backend_automation_reason","route_profile_id","route_version","transport_profile_id","routing_decision_id","routing_snapshot","parsed_unb_sender_ediel_id","parsed_unb_receiver_ediel_id","resolved_company_id","resolved_sender_ediel_id","resolved_receiver_ediel_id","receiver_source","resolved_grid_owner_id","resolved_counterparty_id","dynamic_receiver_strategy","party_id","party_address_id","transport_security_mode","route_transport_security_mode","was_smime_encrypted","expected_receiver_certificate_id","cms_expected_receiver_present","operation_id","grid_owner_information_request_id","intent_id","message_subtype","business_process","business_state","rule_profile_key","rule_profile_version_id","rule_profile_version","rule_pack_checksum","rule_pack_snapshot","canonical_rule_pack_id","certificate_profile_id","business_date","source_operation_id","immutable_payload_hash","immutable_rendered_at","execution_context_snapshot","contrl_due_at","business_response_due_at","response_overdue_at","inbound_email_message_id"] as const
const nationalBirthColumns=['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot'] as const
const nationalIdentityTables=['tenant_actor_identifiers','tenant_actor_roles','tenant_ediel_profiles','tenant_counterparty_relations','platform_actor_identifiers'] as const
type NationalIdentityPrestate={identityEditions:Row[];identityUniverses:Record<string,Row[]>;
 identityReceiptUniverse:Row[];receivedSourceUniverse:Row[];sourceRuleUniverse:Row[]}
const nationalIdentityLedgers={identityReceiptUniverse:'gridex_ediel_inbound_context.receipts',receivedSourceUniverse:'gridex_received_sources.sources',sourceRuleUniverse:'gridex_ediel_source_rules.receipts'} as const
// Capture BEFORE public intake. The INSERT-time winner is independently selected
// from this whole immutable baseline, not learned from the resulting receipt.
export function captureEscoNationalIdentityPrestate(sql:<T>(query:string)=>T){
 const frozen=structuredClone(sql<NationalIdentityPrestate>(`SELECT jsonb_build_object(
 'identityEditions',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.source_version),'[]'::jsonb) FROM gridex_ediel_readiness.source_editions e),
 'identityUniverses',jsonb_build_object(${nationalIdentityTables.map(table=>
  `'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.${table} t)`).join(',')}),
 ${Object.entries(nationalIdentityLedgers).map(([key,table])=>`'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]'::jsonb) FROM ${table} t)`).join(',')})`))
 expect(Object.keys(frozen).sort()).toEqual(['identityEditions','identityUniverses','identityReceiptUniverse','receivedSourceUniverse','sourceRuleUniverse'].sort())
 expect(frozen.identityEditions.length).toBeGreaterThan(0);expect(new Set(frozen.identityEditions.map(row=>row.source_version)).size).toBe(frozen.identityEditions.length)
 for(const edition of frozen.identityEditions){
  expect(Object.keys(edition).sort()).toEqual(['source_version','input_manifest','catalog','recorded_at'].sort());expect(edition.source_version).toMatch(/^[a-f0-9]{64}$/)
  expect(parseSourceReceiptInstant(edition.recorded_at)).not.toBeNull();expect(Array.isArray(edition.catalog)).toBe(true)
  expect(edition.input_manifest).not.toBeNull();expect(typeof edition.input_manifest).toBe('object');expect(Array.isArray(edition.input_manifest)).toBe(false)
 }
 expect(Object.keys(frozen.identityUniverses).sort()).toEqual([...nationalIdentityTables].sort())
 for(const table of nationalIdentityTables)expect(Array.isArray(frozen.identityUniverses[table])).toBe(true)
 for(const key of Object.keys(nationalIdentityLedgers) as (keyof typeof nationalIdentityLedgers)[]){expect(Array.isArray(frozen[key])).toBe(true)
  expect(new Set(frozen[key].map(row=>row.source_message_id)).size).toBe(frozen[key].length)}
 return {get basis(){return structuredClone(frozen)}}
}
export function captureEscoNationalBornBasis(sql:<T>(query:string)=>T,lit:(value:string)=>string,
 before:EdielMessageRow&{immutable_payload_hash:string},field:RegistryNationalField,input:Omit<CanonicalNationalInput,'registry'>,registry:NationalRegistryBasis,pre:{identityBeforeIntake:NationalIdentityPrestate;intakeWindow:readonly[number,number]}){
 expect(['203','205','206','313','322']).toContain(field)
 const source=structuredClone(before),basis=structuredClone(input),original=structuredClone(registry),prior=structuredClone(pre.identityBeforeIntake),window=[...pre.intakeWindow]
 expect(window).toHaveLength(2);expect(window.every(Number.isSafeInteger)).toBe(true);expect(window[1]).toBeGreaterThanOrEqual(window[0]);expect(window[1]-window[0]).toBeLessThanOrEqual(120000)
 const bounded=(value:unknown)=>{const instant=parseSourceReceiptInstant(value);expect(instant).not.toBeNull();if(instant===null)throw Error('esco_national_birth_clock_required')
  expect(instant>=BigInt(window[0])*BigInt(1000)&&instant<(BigInt(window[1])+BigInt(1))*BigInt(1000)).toBe(true);return instant}
 const compareOld=(old:Row[],current:Row[])=>{expect(Array.isArray(current)).toBe(true);for(const row of old)expect(current.filter(r=>r.source_message_id===row.source_message_id)).toEqual([row])}
 for(const key of Object.keys(nationalIdentityLedgers) as (keyof typeof nationalIdentityLedgers)[])expect(prior[key].some(row=>row.source_message_id===source.id)).toBe(false)
 const winner=[...prior.identityEditions].sort((a,b)=>{const at=parseSourceReceiptInstant(a.recorded_at)!,bt=parseSourceReceiptInstant(b.recorded_at)!;return at===bt?String(a.source_version).localeCompare(String(b.source_version)):at>bt?-1:1})[0]
 expect(winner).toBeTruthy()
 expect(Object.keys(source).sort()).toEqual([...nationalSourceColumns].sort())
 expect(source).toMatchObject({environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(source.id).toMatch(uuid);expect(source.company_id).toMatch(uuid)
 expect(source.raw_payload).toBe(omitEscoNationalField(basis.healthyWire,field,basis))
 expect(source.immutable_payload_hash).toBe(createHash('sha256').update(source.raw_payload!).digest('hex'))
 const arrival=parseSourceReceiptInstant(source.message_received_at);expect(arrival).not.toBeNull()
 const pack=original.originalSnapshot.rulePack,profile=original.originalSnapshot.messageProfile,guides=original.originalSnapshot.guideSources
 expect(Object.keys(original.originalSnapshot).sort()).toEqual(['guideSources','messageProfile','rulePack'])
 expect(original.databaseProfileKey).toBe('PRODAT:Z14:N:26.A:r3');expect(original.originalVersion).toBe('26.A:r3')
 expect(pack.id).toBe(original.rulePackId);expect(profile.id).toBe(original.messageProfileId)
 expect(profile.rule_pack_id).toBe(pack.id);expect(profile.profile_key).toBe(original.databaseProfileKey)
 expect(pack.source_hash).toBe(original.sourceHash);expect(`${pack.guide_version}:r${pack.guide_revision}`).toBe(original.originalVersion)
 const snapshot={...original.originalSnapshot,profileKey:original.databaseProfileKey,profileVersionId:original.messageProfileId,version:original.originalVersion,checksum:original.sourceHash}
 const binding={canonical_rule_pack_id:original.rulePackId,rule_profile_key:original.databaseProfileKey,rule_profile_version_id:original.messageProfileId,
  rule_profile_version:original.originalVersion,rule_pack_checksum:original.sourceHash,rule_pack_snapshot:snapshot}
 expect(Object.fromEntries(nationalBirthColumns.map(key=>[key,source[key]]))).toEqual(binding)
 const read=()=>sql<Row>(`WITH source AS (
 SELECT m.* FROM public.ediel_messages m WHERE m.id=${lit(source.id)}::uuid AND m.company_id=${lit(source.company_id!)}::uuid
), identity_receipt AS (
 SELECT i.* FROM gridex_ediel_inbound_context.receipts i JOIN source m ON i.source_message_id=m.id
), named_profile AS (
 SELECT mp.* FROM public.ediel_message_profiles mp JOIN source m ON mp.id=m.rule_profile_version_id
), named_pack AS (
 SELECT rp.* FROM public.ediel_rule_packs rp JOIN named_profile mp ON rp.id=mp.rule_pack_id
), named_identity_edition AS (
 SELECT e.* FROM gridex_ediel_readiness.source_editions e JOIN identity_receipt i ON e.source_version=i.context->>'sourceEdition'
)
SELECT jsonb_build_object(
 'sourceCount',(SELECT count(*) FROM source),'source',(SELECT to_jsonb(m) FROM source m),
 'identityReceiptCount',(SELECT count(*) FROM identity_receipt),'identityReceipt',(SELECT to_jsonb(i) FROM identity_receipt i),
 'profileCount',(SELECT count(*) FROM named_profile),'profile',(SELECT to_jsonb(mp) FROM named_profile mp),
 'packCount',(SELECT count(*) FROM named_pack),'pack',(SELECT to_jsonb(rp) FROM named_pack rp),
 'guideSources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM public.ediel_rule_pack_sources s JOIN named_pack rp ON rp.id=s.rule_pack_id),
 'identityEditionCount',(SELECT count(*) FROM named_identity_edition),'identityEdition',(SELECT to_jsonb(e) FROM named_identity_edition e),
 'latestIdentityEdition',(SELECT to_jsonb(e) FROM gridex_ediel_readiness.source_editions e ORDER BY e.recorded_at DESC,e.source_version LIMIT 1),
 'receivedSourceCount',(SELECT count(*) FROM gridex_received_sources.sources r JOIN source m ON r.source_message_id=m.id),
 'receivedSource',(SELECT to_jsonb(r) FROM gridex_received_sources.sources r JOIN source m ON r.source_message_id=m.id),
 ${Object.entries(nationalIdentityLedgers).map(([key,table])=>`'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]'::jsonb) FROM ${table} t)`).join(',')},
 'databaseTimeZone',current_setting('TimeZone'),'identityObservedDate',(SELECT observed_at::date FROM identity_receipt),
 'identityEditions',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.source_version),'[]'::jsonb) FROM gridex_ediel_readiness.source_editions e),
 'priorSourceRuleReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(rr) ORDER BY rr.source_message_id),'[]'::jsonb) FROM gridex_ediel_source_rules.receipts rr JOIN source m ON rr.source_message_id=m.id),
 'identityUniverses',jsonb_build_object(${nationalIdentityTables.map(table=>
  `'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.${table} t)`).join(',')}))`)
 const captured=structuredClone(read())
 for(const key of ['sourceCount','identityReceiptCount','profileCount','packCount','identityEditionCount'])expect(captured[key]).toBe(1)
 expect(captured.source).toEqual(source);expect(captured.profile).toEqual(profile);expect(captured.pack).toEqual(pack);expect(captured.guideSources).toEqual(guides)
 expect(captured.priorSourceRuleReceipts).toEqual([])
 expect(typeof captured.databaseTimeZone).toBe('string');expect(captured.identityEditions).toEqual(prior.identityEditions);expect(captured.identityUniverses).toEqual(prior.identityUniverses)
 expect(captured.latestIdentityEdition).toEqual(winner)
 for(const key of Object.keys(nationalIdentityLedgers) as (keyof typeof nationalIdentityLedgers)[]){const rows=captured[key] as Row[];compareOld(prior[key],rows)
  if(key==='sourceRuleUniverse')expect(rows).toEqual(prior[key]);else{expect(rows).toHaveLength(prior[key].length+1);expect(rows.filter(row=>!prior[key].some(old=>old.source_message_id===row.source_message_id))).toEqual([key==='identityReceiptUniverse'?captured.identityReceipt:captured.receivedSource])}}
 const receipt=captured.identityReceipt as Row,context=receipt.context as Row,edition=captured.identityEdition as Row,universes=captured.identityUniverses as Record<string,Row[]>
 expect(Object.keys(receipt).sort()).toEqual(['source_message_id','company_id','environment','direction','payload_sha256','source_received_at','observed_at','status','reason','context'].sort())
 expect(receipt).toMatchObject({source_message_id:source.id,company_id:source.company_id,environment:'test',direction:'inbound',payload_sha256:source.immutable_payload_hash,status:'ready',reason:null})
 const observed=bounded(receipt.observed_at)
 expect(parseSourceReceiptInstant(receipt.source_received_at)).toBe(arrival)
 expect(Object.keys(context).sort()).toEqual(['basisKind','companyId','environment','direction','family','code','subtype','legalActorId','legalEdielId','actorRole','transportActorId','transportEdielId','applicationReference','sourceEdition','canonicalProjection','observedAt','sourceReceivedAt','facts'].sort())
 expect(context).toMatchObject({basisKind:'observed_source_persistence',companyId:source.company_id,environment:'test',direction:'inbound',family:'PRODAT',code:'Z14',subtype:'N',legalEdielId:basis.receiver,transportEdielId:basis.receiver,applicationReference:'23-DGI-PRODAT'})
 expect(parseSourceReceiptInstant(context.observedAt)).toBe(observed);expect(parseSourceReceiptInstant(context.sourceReceivedAt)).toBe(arrival)
 expect(context.sourceEdition).toMatch(/^[a-f0-9]{64}$/)
 expect(Object.keys(edition).sort()).toEqual(['source_version','input_manifest','catalog','recorded_at'].sort())
 expect(edition).toEqual(winner);expect(edition.source_version).toBe(context.sourceEdition);expect(Array.isArray(edition.catalog)).toBe(true)
 expect(typeof edition.input_manifest).toBe('object');expect(edition.input_manifest).not.toBeNull();expect(Array.isArray(edition.input_manifest)).toBe(false)
 expect(parseSourceReceiptInstant(edition.recorded_at)).not.toBeNull()
 expect((captured.identityEditions as Row[]).filter(row=>row.source_version===edition.source_version)).toEqual([edition])
 const projections=(edition.catalog as Row[]).filter(row=>row.family==='PRODAT'&&row.code==='Z14'&&row.transactionReasonCode==='Z96')
 expect(projections).toHaveLength(1);const projection=projections[0]
 expect(['inbound','both']).toContain(projection.direction);expect(projection.applicationReferences).toContain('23-DGI-PRODAT')
 expect(projection.subtype).toBe('N');expect(context.canonicalProjection).toEqual(projection)
 expect(Object.keys(universes).sort()).toEqual([...nationalIdentityTables].sort())
 for(const table of nationalIdentityTables)expect(Array.isArray(universes[table])).toBe(true)
 const valid=(row:Row)=>{
  const start=parseSourceReceiptInstant(row.valid_from),end=row.valid_to===null?null:parseSourceReceiptInstant(row.valid_to)
  expect(start).not.toBeNull();if(row.valid_to!==null)expect(end).not.toBeNull()
  return start!==null&&observed!==null&&start<=observed&&(end===null||observed<end)
 }
 const utcDate=new Date(Number(observed/BigInt(1000))).toISOString().slice(0,10)
 const possibleDates=[-1,0,1].map(day=>new Date(Date.parse(utcDate+'T00:00:00Z')+day*86400000).toISOString().slice(0,10));expect(possibleDates).toContain(captured.identityObservedDate)
 const own=(row:Row)=>row.company_id===source.company_id&&row.environment==='test'
 const legal=universes.tenant_actor_identifiers.filter(row=>row.environment==='test'&&row.identifier_type==='EdielId'&&row.identifier_value===basis.receiver&&valid(row))
 expect([...new Set(legal.map(row=>row.company_id))]).toEqual([source.company_id])
 const identifiers=universes.tenant_actor_identifiers.filter(row=>own(row)&&row.identifier_type==='EdielId'&&valid(row))
 const actors=[...new Set(identifiers.map(row=>`${row.actor_id}:${row.identifier_value}`))];expect(actors).toHaveLength(1)
 const actor=identifiers[0]?.actor_id;expect(actor).toMatch(uuid);expect(identifiers[0]?.identifier_value).toBe(basis.receiver)
 const profiles=universes.tenant_ediel_profiles.filter(row=>own(row)&&row.market==='electricity'&&row.is_enabled===true&&valid(row));expect(profiles).toHaveLength(1)
 const allow=projection.receiverRoles as string[];expect(Array.isArray(allow)).toBe(true)
 const roles=universes.tenant_actor_roles.filter(row=>own(row)&&row.actor_id===actor&&valid(row)&&(allow.includes(String(row.role_code))||allow.includes(row.role_code==='energy_service_company'?'esco':row.role_code==='electricity_supplier'?'supplier':String(row.role_code))))
 const roleCodes=[...new Set(roles.map(row=>row.role_code))];expect(roleCodes).toHaveLength(1);expect(['energy_service_company','esco']).toContain(roleCodes[0])
 const relations=universes.tenant_counterparty_relations.filter(row=>own(row)&&row.relation_type==='ediel_transport_agent'&&row.is_enabled===true&&valid(row));expect(relations.length).toBeLessThanOrEqual(1)
 let transportActor=actor,transportId=basis.receiver,transportIdentifiers:Row[]|null=null
 if(relations.length){
  transportActor=relations[0].counterparty_actor_id;expect(transportActor).toMatch(uuid);expect(transportActor).not.toBe(actor)
  // No observer-session timezone is used as an INSERT oracle. All possible
  // local calendar dates must select the very same full candidate rows.
  const candidates=(date:string)=>universes.platform_actor_identifiers.filter(row=>row.actor_id===transportActor&&row.identifier_type==='EdielId'&&(row.valid_from===null||String(row.valid_from)<=date)&&(row.valid_to===null||date<=String(row.valid_to)))
  transportIdentifiers=candidates(utcDate);for(const date of possibleDates)expect(candidates(date)).toEqual(transportIdentifiers)
  const values=[...new Set(transportIdentifiers.map(row=>row.identifier_value))];expect(values).toHaveLength(1);expect(values[0]).toBe(basis.receiver);transportId=String(values[0])
 }
 const facts={profile:profiles[0],identifiers:identifiers.filter(row=>row.actor_id===actor),roles:roles.filter(row=>row.role_code===roleCodes[0]),transportRelation:relations[0]??null,transportIdentifiers}
 expect(context).toEqual({basisKind:'observed_source_persistence',companyId:source.company_id,environment:'test',direction:'inbound',family:'PRODAT',code:'Z14',subtype:projection.subtype,
  legalActorId:actor,legalEdielId:basis.receiver,actorRole:roleCodes[0],transportActorId:transportActor,transportEdielId:transportId,applicationReference:'23-DGI-PRODAT',sourceEdition:edition.source_version,
  canonicalProjection:projection,observedAt:receipt.observed_at,sourceReceivedAt:receipt.source_received_at,facts})
 const execution=source.execution_context_snapshot as Row,born=execution?.receivedProdatContext as Row
 expect(Object.keys(execution)).toEqual(['receivedProdatContext']);expect(Object.keys(born).sort()).toEqual(['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt'].sort())
 const birthClock=bounded(born.capturedAt);expect(birthClock<=observed).toBe(true)
 expect(parseSourceReceiptInstant(born.sourceReceivedAt)).toBe(arrival)
 const expectedBirth={version:1,contextOrigin:'database_insert',sourceMessageId:source.id,companyId:source.company_id,environment:'test',messageCode:'Z14',payloadHash:source.immutable_payload_hash,sourceReceivedAt:born.sourceReceivedAt,capturedAt:born.capturedAt}
 expect(born).toEqual(expectedBirth);expect(captured.receivedSourceCount).toBe(1)
 const received=captured.receivedSource as Row;expect(Object.keys(received).sort()).toEqual(['source_message_id','company_id','environment','origin','message_code','source_received_at','captured_at','raw_payload','payload_hash','received_context','scope_point','retention_byte_length','retention_purged_at'].sort())
 expect(bounded(received.captured_at)>=observed).toBe(true);expect(parseSourceReceiptInstant(received.source_received_at)).toBe(arrival)
 expect(received).toEqual({source_message_id:source.id,company_id:source.company_id,environment:'test',origin:'database_insert',message_code:'Z14',source_received_at:received.source_received_at,captured_at:received.captured_at,raw_payload:source.raw_payload,payload_hash:source.immutable_payload_hash,received_context:expectedBirth,scope_point:null,retention_byte_length:Buffer.byteLength(source.raw_payload!,'utf8'),retention_purged_at:null})
 const expected={profileKey:original.databaseProfileKey,messageProfileId:original.messageProfileId,rulePackId:original.rulePackId,sourceHash:original.sourceHash,version:original.originalVersion,
  snapshot:{profileKey:original.databaseProfileKey,profileVersionId:original.messageProfileId,version:original.originalVersion,checksum:original.sourceHash,
   originalMessageSnapshot:snapshot,...original.originalSnapshot,identitySourceEdition:edition.source_version}}
 return {get basis(){return structuredClone(expected)},qualify(actual:unknown){expect(actual).toEqual(expected)},preserved(current:EdielMessageRow&{immutable_payload_hash:string}){
  expect(Object.fromEntries(nationalBirthColumns.map(key=>[key,current[key]]))).toEqual(binding)
  for(const key of ['id','company_id','environment','direction','message_standard','message_family','message_code','raw_payload','immutable_payload_hash','message_received_at','execution_context_snapshot'] as const)expect(current[key]).toEqual(source[key])
  const fresh=read();expect(fresh.receivedSourceCount).toBe(1);expect(fresh.receivedSource).toEqual(received)
  for(const key of Object.keys(nationalIdentityLedgers) as (keyof typeof nationalIdentityLedgers)[])compareOld(prior[key],fresh[key] as Row[])
  expect(fresh.identityReceiptCount).toBe(1);expect(fresh.identityReceipt).toEqual(receipt)
  expect(fresh.identityEdition).toEqual(edition);expect(fresh.identityEditions).toEqual(captured.identityEditions);expect(fresh.identityUniverses).toEqual(universes)
  expect(fresh.profile).toEqual(profile);expect(fresh.pack).toEqual(pack);expect(fresh.guideSources).toEqual(guides)
  expect(possibleDates).toContain(fresh.identityObservedDate)
 }}
}

const nationalQueueColumns=['id','company_id','ediel_message_id','source_message_id','status','priority','lock_key','message_family','message_code','ack_outcome','environment','route_profile_id','attempts','last_error','payload','queued_at','sent_at','created_at','updated_at','created_by','updated_by','locked_at','locked_by','send_attempt_count','current_send_attempt_id','route_contract_fingerprint','route_contract_snapshot','receiver_ediel_id','receiver_subaddress','certificate_fingerprint','intent_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot','immutable_payload_hash','generation','blocked_reason','blocked_at','company_status_snapshot','operation_decision_snapshot'] as const
type NationalAckRowsInput=CanonicalNationalInput&{actorId:string;bornBasis:ReturnType<typeof captureEscoNationalBornBasis>['basis']|null;
 routes:Record<'CONTRL'|'APERAK',{profile:Row;route:Row}>;priorMessages:Row[];priorQueues:Row[];priorOwnerWitnesses:Row[]}
// Pure complete-row comparison only. Before native use the caller must qualify
// these PRE routes, source links/B and the genuine private creation/owner graph.
// This never supplies an owner capability or records a durable receipt.
export function captureEscoNationalAckRows(sql:<T>(query:string)=>T,lit:(value:string)=>string,
 before:EdielMessageRow&{immutable_payload_hash:string},field:EscoNationalField,input:NationalAckRowsInput){
 const source=structuredClone(before),basis=structuredClone(input),wire=captureEscoNationalAckWire(source,field,basis)
 expect(Object.keys(source).sort()).toEqual([...nationalSourceColumns].sort());expect(basis.actorId).toMatch(uuid)
 expect(source.application_reference).toBe('23-DGI-PRODAT')
 for(const rows of [basis.priorMessages,basis.priorQueues,basis.priorOwnerWitnesses])expect(Array.isArray(rows)).toBe(true)
 const original=tokenizeEdifact(source.raw_payload!),unb=original.segments.find(row=>row.tag==='UNB')!,bgm=original.segments.find(row=>row.tag==='BGM')!
 const document=segmentComposite(bgm,2,original.una)[0],hasAperak=['205','206','313','322'].includes(field)
 const scopes:Row[]=hasAperak?[field==='322'?{scope:'object',reference:String(original.segments.find(row=>row.tag==='LIN')!.index),
  physicalReference:{lineIndex:original.segments.find(row=>row.tag==='LIN')!.index,id:null,li:basis.li},outcome:'negative'}:
  {scope:'message',reference:document,physicalReference:{documentId:document},outcome:'negative'}]:[]
 let scopeHash:string|null=null
 if(hasAperak){
  // Serialize the independent literal with PostgreSQL JSONB spelling, never
  // hash returned guide outcomes or replace it with JS JSON.stringify bytes.
  const text=sql<string>(`SELECT to_jsonb(${lit(JSON.stringify(scopes))}::jsonb::text)`)
  expect(typeof text).toBe('string');expect(JSON.parse(text)).toEqual(scopes)
  scopeHash=createHash('sha256').update(text,'utf8').digest('hex')
 }
 const vector=field==='208'?null:nationalCanonicalVector(field,basis.li,basis.registry)
 const applicationPlan=vector?.responsePlan.find(row=>row.family==='APERAK')
 const errors=applicationPlan&&'applicationErrors' in applicationPlan?structuredClone(applicationPlan.applicationErrors):null
 if(hasAperak){
  expect(errors).not.toBeNull();expect(basis.bornBasis).not.toBeNull();if(!basis.bornBasis||!basis.registry)throw Error('esco_national_original_B_required')
  const b=basis.bornBasis,r=basis.registry
  expect(b).toEqual({profileKey:r.databaseProfileKey,messageProfileId:r.messageProfileId,rulePackId:r.rulePackId,sourceHash:r.sourceHash,version:r.originalVersion,
   snapshot:{profileKey:r.databaseProfileKey,profileVersionId:r.messageProfileId,version:r.originalVersion,checksum:r.sourceHash,
    originalMessageSnapshot:source.rule_pack_snapshot,...r.originalSnapshot,identitySourceEdition:b.snapshot.identitySourceEdition}})
  expect(b.snapshot.identitySourceEdition).toMatch(/^[a-f0-9]{64}$/)
 }
 const nulls=(names:string)=>Object.fromEntries(names.split(' ').map(key=>[key,null]))
 return {get scopes(){return structuredClone(scopes)},qualify(ack:Row,queue:Row,window:Window,qualifiedOwnerWitnessId:string|null){
  expect(window.every(Number.isSafeInteger)).toBe(true);expect(window[0]).toBeLessThanOrEqual(window[1]);expect(window[1]-window[0]).toBeLessThanOrEqual(120000)
  expect(Object.keys(ack).sort()).toEqual([...nationalSourceColumns].sort());expect(Object.keys(queue).sort()).toEqual([...nationalQueueColumns].sort())
  expect(typeof ack.raw_payload).toBe('string');const facts=wire.qualify(ack.raw_payload as string,window),{family,outcome}=facts
  const aperak=family==='APERAK',scope=aperak&&field==='322'?'object':'message',selected=basis.routes[family],profile=selected.profile,route=selected.route
  expect(profile.id).toMatch(uuid);expect(route.id).toMatch(uuid)
  expect(profile).toMatchObject({company_id:source.company_id,communication_route_id:route.id,environment:'test',application_reference:'23-DGI-PRODAT'})
  expect(route.company_id).toBe(source.company_id);expect(clean(profile.mailbox)).toBe(profile.mailbox);expect(clean(route.target_email)).toBe(route.target_email)
  expect(profile.mailbox).not.toBeNull();expect(route.target_email).not.toBeNull()
  expect(ack.id).toMatch(uuid);expect(queue.id).toMatch(uuid);expect(ack.id).not.toBe(queue.id)
  expect(basis.priorMessages.some(row=>row.id===ack.id)).toBe(false);expect(basis.priorQueues.some(row=>row.id===queue.id)).toBe(false)
  expect(basis.priorMessages.some(row=>row.interchange_reference===facts.interchangeReference)).toBe(false)
  if(aperak){expect(qualifiedOwnerWitnessId).toMatch(uuid);expect(basis.priorOwnerWitnesses.some(row=>row.id===qualifiedOwnerWitnessId)).toBe(false)}else expect(qualifiedOwnerWitnessId).toBeNull()
  const fresh=(value:unknown)=>{
   expect(typeof value).toBe('string');const instant=parseSourceReceiptInstant(value);expect(instant).not.toBeNull()
   if(instant===null)throw Error('esco_national_ACK_clock_required')
   expect(instant>=BigInt(window[0])*BigInt(1000)&&instant<(BigInt(window[1])+BigInt(1))*BigInt(1000)).toBe(true)
   return value
  }
  const fileNames:string[]=[]
  for(let instant=Math.floor(window[0]/1000)*1000;instant<=window[1];instant+=1000)
   fileNames.push(`outbound_${family}_${family}_${new Date(instant).toISOString().replace(/[-:]/g,'').replace(/\..+/,'')}.edi`)
  expect(fileNames).toContain(ack.file_name)
  if(aperak){
   const due=parseSourceReceiptInstant(ack.ack_due_at),created=parseSourceReceiptInstant(ack.message_created_at);expect(due).not.toBeNull();expect(created).not.toBeNull()
   if(due===null||created===null)throw Error('esco_national_APERAK_due_clock_required')
   const built=due-BigInt(30*60*1000000)
   expect(built>=BigInt(window[0])*BigInt(1000)&&built<(BigInt(window[1])+BigInt(1))*BigInt(1000)&&built<=created).toBe(true)
  }
  const b=basis.bornBasis,snapshot=aperak?{...b!.snapshot,inheritedFromSourceMessage:true,sourceMessageId:source.id,authority:'resolveCanonicalEdielPolicy'}:{}
  const metadata={ackFamily:family,ackOutcome:outcome,sourceInterchangeReference:source.interchange_reference,sourceExternalReference:source.external_reference,
   sourceTransactionReference:source.transaction_reference,generatedInterchangeReference:facts.interchangeReference,generatedMessageReference:facts.messageReference,
   applicationErrors:aperak?errors:null,aperakSequenceToken:null,ackSourceId:source.id,...(aperak?{ackScope:scope}:{})}
  const preflight=preflightEdielPayload({rawPayload:facts.rawPayload,mimeType:'application/EDIFACT',messageStandard:'edifact',mode:'send',companyId:source.company_id,validationPurpose:'render'})
  expect(preflight.blocking).toBe(false)
  const hash=createHash('sha256').update(facts.rawPayload,'utf8').digest('hex')
  const expected={...nulls('mailbox_message_id subject transaction_reference original_transaction_id failure_reason message_received_at message_sent_at parsed_at validated_at acknowledged_at failed_at unb_sender_id unb_sender_subaddress unb_receiver_id unb_receiver_subaddress message_reference bgm_code bgm_reference tenant_resolution_status business_match_status processing_status raw_payload_hash utilts_subtype measurement_resolution backend_automation_status backend_automation_reason route_version transport_profile_id routing_decision_id parsed_unb_sender_ediel_id parsed_unb_receiver_ediel_id resolved_company_id resolved_sender_ediel_id resolved_receiver_ediel_id receiver_source resolved_grid_owner_id resolved_counterparty_id dynamic_receiver_strategy party_id party_address_id transport_security_mode route_transport_security_mode was_smime_encrypted expected_receiver_certificate_id cms_expected_receiver_present operation_id grid_owner_information_request_id intent_id message_subtype business_process business_state certificate_profile_id business_date contrl_due_at business_response_due_at response_overdue_at inbound_email_message_id'),
   id:ack.id,company_id:source.company_id,direction:'outbound',message_standard:'edifact',message_family:family,message_code:family,message_version:aperak?'E2SE6A':'EDIEL2',process_type:'ack',environment:'test',test_flag:1,status:'draft',transport_type:'smtp',
   mailbox:profile.mailbox,sender_ediel_id:segmentComposite(unb,3,original.una)[0],sender_name:clean(source.receiver_name),sender_sub_address:clean(segmentComposite(unb,3,original.una)[2]),
   receiver_ediel_id:segmentComposite(unb,2,original.una)[0],receiver_name:clean(source.sender_name),receiver_sub_address:clean(segmentComposite(unb,2,original.una)[2]),
   sender_email:aperak?clean(source.receiver_email)??clean(source.mailbox):profile.mailbox,receiver_email:route.target_email,file_name:ack.file_name,mime_type:'application/edifact',
   interchange_reference:facts.interchangeReference,external_reference:aperak?'':null,correlation_reference:aperak?document:null,application_reference:'23-DGI-PRODAT',original_message_id:facts.messageReference,original_message_code:'Z14',related_message_id:source.id,
   communication_route_id:route.id,route_profile_id:profile.id,
   ...Object.fromEntries((['outbound_request_id','switch_request_id','grid_owner_data_request_id','partner_export_id','customer_id','site_id','metering_point_id','grid_owner_id'] as const).map(key=>[key,aperak?source[key]:null])),
   raw_payload:facts.rawPayload,parsed_payload:metadata,validation_report:{generatedBy:'buildAckDraft',engine:'canonical_ediel_ack_engine',engineVersion:'2026-05-production-ack-v1',sourceMessageId:source.id,sourceFamily:'PRODAT',sourceCode:'Z14',
    sourceInterchangeReference:source.interchange_reference,generatedInterchangeReference:facts.interchangeReference,applicationErrors:aperak?errors:null,utiltsErrSequenceToken:null,aperakSequenceToken:null,ackScope:scope,relatedTransactionReference:null,payloadPreflight:preflight},
   requires_contrl:false,requires_aperak:false,contrl_status:'not_required',aperak_status:'not_required',utilts_err_status:'not_required',ack_outcome:outcome,ack_status:outcome,syntax_check_status:aperak?'not_checked':outcome==='positive'?'ok':'failed',functional_check_status:aperak?'failed':'not_checked',
   message_created_at:fresh(ack.message_created_at),ack_due_at:aperak?ack.ack_due_at:null,created_at:fresh(ack.created_at),updated_at:fresh(ack.updated_at),created_by:basis.actorId,updated_by:basis.actorId,metadata:{},routing_snapshot:{},
   canonical_rule_pack_id:aperak?b!.rulePackId:null,rule_profile_key:aperak?b!.profileKey:null,rule_profile_version_id:aperak?b!.messageProfileId:null,rule_profile_version:aperak?b!.version:null,rule_pack_checksum:aperak?b!.sourceHash:null,rule_pack_snapshot:snapshot,
   source_operation_id:aperak?`ediel_ack:${source.id}:APERAK:rawscope:${scopeHash}`:`ediel_ack:${source.id}:CONTRL:message`,immutable_payload_hash:hash,immutable_rendered_at:fresh(ack.immutable_rendered_at),execution_context_snapshot:aperak?{outboundOwnerWitnessId:qualifiedOwnerWitnessId}:{}}
  expect(Object.keys(expected).sort()).toEqual([...nationalSourceColumns].sort());expect(ack).toEqual(expected)
  const expectedQueue={...nulls('last_error sent_at locked_at locked_by current_send_attempt_id route_contract_fingerprint receiver_ediel_id receiver_subaddress certificate_fingerprint intent_id blocked_reason blocked_at company_status_snapshot operation_decision_snapshot'),
   id:queue.id,company_id:source.company_id,ediel_message_id:ack.id,source_message_id:source.id,status:'queued',priority:100,lock_key:`${source.company_id}:test:ack:${ack.id}`,message_family:family,message_code:family,ack_outcome:outcome,environment:'test',route_profile_id:profile.id,attempts:0,send_attempt_count:0,generation:1,
   payload:{createdBy:'inbound_backend_automation',ackFamily:family,outcome,sourceMessageId:source.id,messageFamily:'PRODAT',messageCode:'Z14'},queued_at:fresh(queue.queued_at),created_at:fresh(queue.created_at),updated_at:fresh(queue.updated_at),created_by:basis.actorId,updated_by:basis.actorId,route_contract_snapshot:{},
   rule_profile_key:aperak?b!.profileKey:null,rule_profile_version_id:aperak?b!.messageProfileId:null,rule_profile_version:aperak?b!.version:null,rule_pack_checksum:aperak?b!.sourceHash:null,rule_pack_snapshot:snapshot,immutable_payload_hash:hash}
  expect(Object.keys(expectedQueue).sort()).toEqual([...nationalQueueColumns].sort());expect(queue).toEqual(expectedQueue)
 }}
}

// READ-only national route PRE. Plain expected DTOs are comparisons, never capabilities.
const nationalRouteReadSql="SELECT jsonb_build_object('sourceCount',(SELECT count(*) FROM public.ediel_messages WHERE id=$1::uuid),\n 'source127',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE m.id=$1::uuid),\n 'runtimeView',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.route_profile_id),'[]'::jsonb) FROM public.ediel_route_runtime_v v),\n 'readAt',statement_timestamp(),'databaseTimeZone',current_setting('TimeZone'),\n 'routes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.communication_routes t),\n 'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.ediel_route_profiles t),\n 'transportProfiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.ediel_transport_profiles t),\n 'mailboxes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.ediel_mailboxes t),\n 'actorSettings',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.ediel_actor_settings t),\n 'gridOwners',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.grid_owners t),\n 'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_inbound_receptions.receptions t),\n 'responseRequests',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_inbound_receptions.response_requests t),\n 'technicalSources',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_technical_ack.sources t),\n 'syntaxFacets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_technical_ack.syntax_facets t),\n 'technicalReplies',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_technical_ack.replies t),\n 'identityReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_inbound_context.receipts t),\n 'sourceRuleReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_source_rules.receipts t),\n 'creationReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_ack_replay.creation_receipts t),\n 'outboundWitnesses',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_outbound_owner.witnesses t),\n 'outboundConsumptions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_outbound_owner.consumptions t),\n 'namespaceCoverage',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_wire_namespace.coverage t),\n 'namespaceReservations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM gridex_ediel_wire_namespace.reservations t),\n 'tenantIdentifiers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.tenant_actor_identifiers t),\n 'transportRelations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.tenant_counterparty_relations t),\n 'platformIdentifiers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.platform_actor_identifiers t),\n 'tenantProfiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.tenant_ediel_profiles t),\n 'tenantRoles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.tenant_actor_roles t),\n 'retainedMail',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.inbound_email_messages t),\n 'parses',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.inbound_ediel_parse_results t),\n 'attachments',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.inbound_email_attachments t))"
const nationalRouteFrameColumns={"routes":["id","company_id","route_name","is_active","route_scope","route_type","grid_owner_id","target_system","endpoint","target_email","auth_config","supported_payload_version","notes","created_at","updated_at","created_by","updated_by","metadata","environment_type","market_party_role","counterparty_ediel_id","route_group","supported_message_families","supported_message_codes"],"profiles":["id","company_id","communication_route_id","is_enabled","sender_ediel_id","sender_sub_address","sender_name","receiver_ediel_id","receiver_sub_address","receiver_name","application_reference","smtp_host","smtp_port","imap_host","imap_port","mailbox","encryption_mode","payload_format","default_message_version","default_test_flag","default_timezone","environment","message_standard","ack_mode","notes","metadata","created_at","updated_at","created_by","updated_by","message_family","message_code","own_ediel_id","own_subaddress","counterparty_ediel_id","counterparty_subaddress","mailbox_id","transport_type","ack_policy","is_active","route_name","route_type","sender_subaddress","receiver_subaddress","smtp_profile_id","actor_setting_id","direction","counterparty_role","counterparty_id","receiver_email","transport_profile_id","route_version","is_test_route","is_production_route","valid_from","valid_to","receiver_source","dynamic_receiver_strategy","receiver_message_subaddress","subaddress_required","business_code","transport_mode","smtp_from","smtp_to","signing_mode","tls_required","certificate_id","allow_unencrypted_test","allow_unencrypted_production","allow_unencrypted_production_expires_at","allow_unencrypted_production_granted_by","allow_unencrypted_production_reason","security_policy_status","max_payload_bytes","split_strategy","production_mode","party_id","party_address_id","transport_security_mode","receiver_certificate_id","certificate_required","smtp_provider","certificate_environment","transport_environment","target_system","is_production_ready","environment_type"],"transportProfiles":["id","company_id","environment","name","transport_channel","direction","mailbox_id","sender_email","receiver_email","host","port","secret_reference","is_platform_shared","is_active","created_at","updated_at","created_by","updated_by"],"mailboxes":["id","company_id","environment","mailbox_name","email_address","imap_host","imap_port","username","secret_reference","is_active","poll_interval_minutes","last_polled_at","locked_at","locked_by","last_error","metadata","created_at","updated_at","mailbox_type","transport_mode","tls_required","smtp_from","smtp_to","signing_mode","encryption_mode","certificate_id","security_status","clock_skew_ms","last_time_sync_check_at","provider","is_shared_platform_mailbox"],"actorSettings":["id","company_id","actor_name","actor_ediel_id","actor_role","environment","is_active","sender_name","sender_sub_address","default_application_reference","default_timezone","default_charset","default_test_flag","smtp_from_email","smtp_reply_to_email","mailbox","brp_name","brp_ediel_id","brp_status","esett_status","valid_from","valid_to","notes","metadata","created_at","updated_at","created_by","updated_by","market","role","ediel_id","sender_subaddress","receiver_subaddress","receiver_sub_address","application_reference","legal_name","organization_number","market_roles","test_status","production_status","production_send_lock_enabled","first_production_send_approved","first_production_message_id","approved_by","approved_at","contact_email","operations_contact_email","sender_subaddress_prodat","sender_subaddress_utilts","default_transport_channel","transport_profile_id","subaddress_required","receiver_message_subaddress"],"gridOwners":["id","company_id","name","owner_code","ediel_id","org_number","contact_name","email","phone","address_line_1","address_line_2","postal_code","city","country","notes","is_active","created_at","updated_at","created_by","updated_by","organization_number","contact_email","contact_phone","website","default_bidding_zone_code","environment","lifecycle_status","default_prodat_subaddress","default_utilts_subaddress","transport_channel","communication_email","source","source_verified_at","verified_for_customer_flow","technical_owner_only","actor_registry_status","platform_market_actor_id","platform_grid_owner_id","verification_status","verification_reasons","certificate_status","certificate_environment","certificate_fingerprint_sha256","route_status","route_count","prodat_route_count","utilts_route_count","duplicate_group_key","duplicate_count","resolver_source_status","verification_checked_at","verified_at","verification_metadata","prodat_subaddress_status","utilts_subaddress_status","prodat_subaddress_source","utilts_subaddress_source","subaddress_verified_at","subaddress_verified_by","subaddress_verification_note","prodat_ready_for_customer_flow","utilts_ready_for_metering_flow","supplier_switch_ready","certificate_last_import_at","certificate_import_source","certificate_valid_to","not_seen_in_latest_import","last_seen_in_import_at","electricity_scope_status","excluded_from_electricity_scope","manual_review_required","manual_review_reason"],"receptions":["id","company_id","source_message_id","inbound_email_message_id","parse_result_id","actor_user_id","environment","canonical_payload_hash","received_payload_hash","received_at","classification","scope","transport_source_snapshot","recorded_at"],"responseRequests":["id","reception_id","company_id","source_message_id","reason","status","recorded_at"],"technicalSources":["source_message_id","source_company_id","company_id","environment","payload_sha256","observed_at","source_received_at","status","reason","evidence"],"syntaxFacets":["id","source_message_id","company_id","environment","payload_sha256","facts_text","facts_hash"],"technicalReplies":["source_message_id","company_id","environment","payload_sha256","canonical_assessment_id","evidence"],"identityReceipts":["source_message_id","company_id","environment","direction","payload_sha256","source_received_at","observed_at","status","reason","context"],"sourceRuleReceipts":["source_message_id","company_id","environment","direction","payload_sha256","captured_at","canonical_assessment_id","original_source_message_id","evidence"],"creationReceipts":["ack_message_id","source_message_id","company_id","environment","actor_user_id","source_payload_hash","ack_payload_hash","source_operation_id","event_id","family","sequence_field","sequence_value","outcome","recorded_at"],"outboundWitnesses":["id","company_id","actor_user_id","environment","payload_sha256","family","code","related_message_id","observed_at","context","evidence"],"outboundConsumptions":["witness_id","source_message_id","company_id","environment","payload_sha256"],"namespaceCoverage":["source_message_id","payload_sha256","company_id","environment"],"namespaceReservations":["environment","sender_namespace","application_namespace","reference_kind","wire_reference","source_message_id","company_id","first_payload_sha256","reserved_at"],"tenantIdentifiers":["id","company_id","environment","actor_id","identifier_type","identifier_value","qualifier","subaddress","valid_from","valid_to"],"transportRelations":["id","company_id","environment","counterparty_actor_id","relation_type","is_enabled","valid_from","valid_to"],"platformIdentifiers":["id","actor_id","identifier_type","identifier_value","id_code_qualifier","id_code_responsible","source","is_verified","valid_from","valid_to","metadata","created_at","updated_at"],"tenantProfiles":["id","company_id","environment","market","is_enabled","valid_from","valid_to","metadata"],"tenantRoles":["id","company_id","environment","actor_id","role_code","valid_from","valid_to"],"retainedMail":["id","company_id","mailbox_id","internet_message_id","from_address","to_address","subject","received_at","raw_email_path","raw_email","raw_edifact_payload","body_text","body_html","has_attachments","processing_status","dedupe_key","match_status","match_payload","error_message","created_at","updated_at","environment","sender_ediel_id","receiver_ediel_id","interchange_reference","transaction_reference","external_reference","message_family","message_code","raw_message_sha256","dedupe_scope","dedupe_reason","duplicate_of_id","ai_processing_actor_user_id","ai_processing_decision_id"],"parses":["id","company_id","inbound_email_message_id","message_family","message_code","interchange_reference","transaction_reference","sender_ediel_id","sender_sub_address","receiver_ediel_id","receiver_sub_address","application_reference","parse_status","parsed_payload","validation_report","raw_payload","created_at"],"attachments":["id","company_id","inbound_email_message_id","filename","mime_type","size_bytes","storage_path","raw_text","is_edifact_candidate","metadata","created_at"],"source127":["id","company_id","direction","message_standard","message_family","message_code","message_version","process_type","environment","test_flag","status","transport_type","mailbox","mailbox_message_id","sender_ediel_id","sender_name","sender_sub_address","receiver_ediel_id","receiver_name","receiver_sub_address","sender_email","receiver_email","subject","file_name","mime_type","interchange_reference","external_reference","correlation_reference","transaction_reference","application_reference","original_message_id","original_transaction_id","original_message_code","related_message_id","communication_route_id","outbound_request_id","switch_request_id","grid_owner_data_request_id","partner_export_id","customer_id","site_id","metering_point_id","grid_owner_id","raw_payload","parsed_payload","validation_report","requires_contrl","requires_aperak","contrl_status","aperak_status","utilts_err_status","ack_outcome","syntax_check_status","functional_check_status","failure_reason","message_created_at","message_received_at","message_sent_at","parsed_at","validated_at","acknowledged_at","failed_at","ack_due_at","created_at","updated_at","created_by","updated_by","metadata","unb_sender_id","unb_sender_subaddress","unb_receiver_id","unb_receiver_subaddress","message_reference","bgm_code","bgm_reference","tenant_resolution_status","business_match_status","ack_status","processing_status","raw_payload_hash","utilts_subtype","measurement_resolution","backend_automation_status","backend_automation_reason","route_profile_id","route_version","transport_profile_id","routing_decision_id","routing_snapshot","parsed_unb_sender_ediel_id","parsed_unb_receiver_ediel_id","resolved_company_id","resolved_sender_ediel_id","resolved_receiver_ediel_id","receiver_source","resolved_grid_owner_id","resolved_counterparty_id","dynamic_receiver_strategy","party_id","party_address_id","transport_security_mode","route_transport_security_mode","was_smime_encrypted","expected_receiver_certificate_id","cms_expected_receiver_present","operation_id","grid_owner_information_request_id","intent_id","message_subtype","business_process","business_state","rule_profile_key","rule_profile_version_id","rule_profile_version","rule_pack_checksum","rule_pack_snapshot","canonical_rule_pack_id","certificate_profile_id","business_date","source_operation_id","immutable_payload_hash","immutable_rendered_at","execution_context_snapshot","contrl_due_at","business_response_due_at","response_overdue_at","inbound_email_message_id"]} as const
const nationalRouteConfigurationKeys=["routes", "profiles", "transportProfiles", "mailboxes", "actorSettings", "gridOwners", "tenantIdentifiers", "transportRelations", "platformIdentifiers", "tenantProfiles", "tenantRoles", "runtimeView"] as const
const nationalRouteMutableLedgerKeys=["receptions", "responseRequests", "technicalSources", "syntaxFacets", "technicalReplies", "identityReceipts", "sourceRuleReceipts", "creationReceipts", "outboundWitnesses", "outboundConsumptions", "namespaceCoverage", "namespaceReservations", "retainedMail", "parses", "attachments"] as const
function nationalOrdinaryView(profile:Row,route:Row):Row{return {
 company_id:profile.company_id,
 route_profile_id:profile.id,
 communication_route_id:profile.communication_route_id,
 environment:profile.environment,
 message_standard:profile.message_standard,
 ack_mode:profile.ack_mode,
 payload_format:profile.payload_format,
 encryption_mode:profile.encryption_mode,
 default_message_version:profile.default_message_version,
 default_test_flag:profile.default_test_flag,
 default_timezone:profile.default_timezone,
 receiver_ediel_id:profile.receiver_ediel_id,
 receiver_sub_address:profile.receiver_sub_address,
 receiver_subaddress:profile.receiver_subaddress,
 receiver_message_subaddress:profile.receiver_message_subaddress,
 receiver_name:profile.receiver_name,
 mailbox:profile.mailbox,
 application_reference:profile.application_reference,
 route_profile_notes:profile.notes,
 is_enabled:profile.is_enabled,
 route_name:route.route_name,
 communication_route_active:route.is_active,
 route_scope:route.route_scope,
 route_type:route.route_type,
 grid_owner_id:route.grid_owner_id,
 target_system:route.target_system,
 endpoint:route.endpoint,
 target_email:profile.smtp_to??route.target_email,
 supported_payload_version:route.supported_payload_version,
 communication_route_notes:route.notes,
 sender_ediel_id:profile.sender_ediel_id,
 sender_name:profile.sender_name,
 sender_sub_address:profile.sender_sub_address,
 sender_subaddress:profile.sender_subaddress,
 subaddress_required:profile.subaddress_required,
 signing_mode:profile.signing_mode,
 tls_required:profile.tls_required,
 certificate_id:profile.receiver_certificate_id??profile.certificate_id,
 receiver_certificate_id:profile.receiver_certificate_id,
 certificate_required:profile.certificate_required,
 allow_unencrypted_test:profile.allow_unencrypted_test,
 allow_unencrypted_production:profile.allow_unencrypted_production,
 allow_unencrypted_production_expires_at:profile.allow_unencrypted_production_expires_at,
 allow_unencrypted_production_granted_by:profile.allow_unencrypted_production_granted_by,
 allow_unencrypted_production_reason:profile.allow_unencrypted_production_reason,
 security_policy_status:profile.security_policy_status,
 smtp_host:profile.smtp_host,
 smtp_port:profile.smtp_port,
 imap_host:profile.imap_host,
 imap_port:profile.imap_port,
 message_family:profile.message_family,
 business_code:profile.business_code,
 transport_security_mode:profile.transport_security_mode,
 party_id:profile.party_id,
 party_address_id:profile.party_address_id,
}}
type NationalRouteDeclaration={companyId:string;actorUserId:string;environment:'test';expectedRouteId:string;expectedContrlProfileId:string;expectedAperakProfileId?:string;
 rawWireHash:string;originalUNB:{sender:string[];receiver:string[];interchangeReference:string;uciReference:string;applicationReference:string;environment:'test';testIndicator:string};
 SMTPfromHostPort:{from:string;host:string;port:number}}
type NationalRouteIdentityPre=Pick<NationalIdentityPrestate,'identityUniverses'>&{currentIdentity:{companyId:string;environment:string;legalActorId:string;legalEdielId:string;transportActorId:string;transportEdielId:string;roleCodes:string[];representedByTransportAgent:boolean;transportRelationId:string|null}}
type NationalRouteMailboxInputs={mailId:string;parseId:string;mailboxId:string;receptionId:string;safeSmtpReadiness:{provider:string;user:string;passwordConfigured:boolean;globalEmailProvider:string|null;applicationDkim:boolean;replyTo:string|null;secure:boolean;sharedMailboxAddress:string|null}}
type NationalRouteFrame={sourceCount:number;source127:Row;readAt:string;databaseTimeZone:string;runtimeView:Row[]}&Record<Exclude<keyof typeof nationalRouteFrameColumns,'source127'>,Row[]>
type NationalRouteGrowth=Partial<Record<typeof nationalRouteMutableLedgerKeys[number],Row[]>>
export function captureEscoNationalRoutePrestate(sqlRead:<T>(query:string)=>T,
 before:EdielMessageRow&{immutable_payload_hash:string},declared:NationalRouteDeclaration,identityPre:NationalRouteIdentityPre,mailboxInputs:NationalRouteMailboxInputs){
 const source=structuredClone(before),d=structuredClone(declared),identity=structuredClone(identityPre),mailbox=structuredClone(mailboxInputs)
 const exactKeys=(row:Row,keys:readonly string[])=>expect(Object.keys(row).sort()).toEqual([...keys].sort())
 const one=<T>(rows:T[],why:string):T=>{expect(rows,why).toHaveLength(1);return rows[0]}
 const instant=(value:unknown)=>{const t=parseSourceReceiptInstant(value);expect(t).not.toBeNull();if(t===null)throw Error('esco_national_route_clock_required');return t}
 const interval=(r:Row,t:bigint)=>instant(r.valid_from)<=t&&(r.valid_to===null||t<instant(r.valid_to))
 const email=(v:unknown)=>typeof v==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)
 const own=(r:Row)=>r.company_id===d.companyId&&r.environment===d.environment
 const sorted=(rows:Row[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))
 for(const id of [source.id,d.companyId,d.actorUserId,d.expectedRouteId,d.expectedContrlProfileId,mailbox.mailId,mailbox.parseId,mailbox.mailboxId,mailbox.receptionId])expect(id).toMatch(uuid)
 if(d.expectedAperakProfileId!==undefined)expect(d.expectedAperakProfileId).toMatch(uuid)
 exactKeys(source,nationalSourceColumns);expect(d.environment).toBe('test');expect(source).toMatchObject({company_id:d.companyId,environment:d.environment,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14'})
 expect(typeof source.raw_payload).toBe('string');expect(d.rawWireHash).toMatch(/^[a-f0-9]{64}$/)
 expect(createHash('sha256').update(source.raw_payload!,'utf8').digest('hex')).toBe(d.rawWireHash);expect(source.immutable_payload_hash).toBe(d.rawWireHash)
 const parsed=tokenizeEdifact(source.raw_payload!),unbs=parsed.segments.filter(row=>row.tag==='UNB'),unb=one(unbs,'one physical UNB')
 expect(parsed.segments[0]).toEqual(unb);expect(unb.elements).toHaveLength(12)
 for(const delimit of [parsed.una.dataElementSeparator,parsed.una.componentDataElementSeparator,parsed.una.segmentTerminator])expect(source.raw_payload!.includes(parsed.una.releaseCharacter+delimit)).toBe(false)
 const physical={sender:segmentComposite(unb,2,parsed.una),receiver:segmentComposite(unb,3,parsed.una),interchangeReference:segmentComposite(unb,5,parsed.una)[0],
  uciReference:segmentComposite(unb,5,parsed.una)[0]?.slice(0,14),applicationReference:segmentComposite(unb,7,parsed.una)[0]??'',environment:segmentComposite(unb,11,parsed.una)[0]==='1'?'test':'production',testIndicator:segmentComposite(unb,11,parsed.una)[0]??''}
 exactKeys(d.originalUNB,['sender','receiver','interchangeReference','uciReference','applicationReference','environment','testIndicator']);expect(physical).toEqual(d.originalUNB)
 for(const parts of [physical.sender,physical.receiver]){expect(parts.length>=1&&parts.length<=3).toBe(true);expect(parts[0]).toBeTruthy();for(const part of parts){expect(typeof part).toBe('string');expect(part.length).toBeLessThanOrEqual(35)}}
 expect(physical.applicationReference).toBe('23-DGI-PRODAT');expect(source.application_reference).toBe(physical.applicationReference)
 expect(source.sender_ediel_id).toBe(physical.sender[0]);expect(source.receiver_ediel_id).toBe(physical.receiver[0])
 const smtp=d.SMTPfromHostPort;expect(email(smtp.from)).toBe(true);expect(smtp.host.length).toBeGreaterThan(0);expect(Number.isInteger(smtp.port)&&smtp.port>=1&&smtp.port<=65535).toBe(true)
 exactKeys(mailbox.safeSmtpReadiness,['provider','user','passwordConfigured','globalEmailProvider','applicationDkim','replyTo','secure','sharedMailboxAddress'])
 expect(mailbox.safeSmtpReadiness).toMatchObject({passwordConfigured:true,applicationDkim:false});expect(mailbox.safeSmtpReadiness.provider.toLowerCase()).toBe('strato');expect(String(mailbox.safeSmtpReadiness.globalEmailProvider??'').toLowerCase()).not.toBe('strato');expect(clean(mailbox.safeSmtpReadiness.user)).not.toBeNull();expect(typeof mailbox.safeSmtpReadiness.secure).toBe('boolean');if(mailbox.safeSmtpReadiness.sharedMailboxAddress!==null){expect(smtp.from.toLowerCase()).toBe(mailbox.safeSmtpReadiness.sharedMailboxAddress.toLowerCase());expect(mailbox.safeSmtpReadiness.user.toLowerCase()).toBe(mailbox.safeSmtpReadiness.sharedMailboxAddress.toLowerCase())}
 // UUID is already checked against the closed hexadecimal/hyphen grammar.
 // Only its two literal $1 slots are substituted; this is no generic SQL binder.
 const read=()=>{
  const f=structuredClone(sqlRead<NationalRouteFrame>(nationalRouteReadSql.replaceAll('$1',`'${source.id}'`)))
  exactKeys(f,['sourceCount','source127','readAt','databaseTimeZone','runtimeView',...Object.keys(nationalRouteFrameColumns).filter(k=>k!=='source127')]);expect(f.sourceCount).toBe(1)
  instant(f.readAt);expect(typeof f.databaseTimeZone).toBe('string');expect(f.databaseTimeZone.length).toBeGreaterThan(0)
  exactKeys(f.source127,nationalSourceColumns)
  for(const [key,columns] of Object.entries(nationalRouteFrameColumns)){if(key==='source127')continue;const rows=f[key as keyof NationalRouteFrame] as Row[];expect(Array.isArray(rows)).toBe(true);for(const row of rows)exactKeys(row,columns)}
  expect(Array.isArray(f.runtimeView)).toBe(true);for(const row of f.runtimeView)exactKeys(row,Object.keys(nationalOrdinaryView({},{})));const expectedWholeView=f.profiles.flatMap(p=>f.routes.filter(r=>r.id===p.communication_route_id).map(r=>nationalOrdinaryView(p,r))).sort((a,b)=>String(a.route_profile_id).localeCompare(String(b.route_profile_id)));expect(f.runtimeView).toEqual(expectedWholeView)
  return f
 }
 const frozen=read();expect(frozen.source127).toEqual(source)
 const sameIdentityTables={tenant_actor_identifiers:'tenantIdentifiers',tenant_counterparty_relations:'transportRelations',platform_actor_identifiers:'platformIdentifiers',tenant_ediel_profiles:'tenantProfiles',tenant_actor_roles:'tenantRoles'} as const
 for(const [table,key] of Object.entries(sameIdentityTables))expect(frozen[key as keyof NationalRouteFrame]).toEqual(identity.identityUniverses[table])
 const reception=one(frozen.receptions.filter(r=>r.id===mailbox.receptionId),'declared reception')
 expect(reception).toMatchObject({company_id:d.companyId,environment:d.environment,source_message_id:source.id,inbound_email_message_id:mailbox.mailId,parse_result_id:mailbox.parseId,actor_user_id:d.actorUserId,classification:'first_reception',canonical_payload_hash:d.rawWireHash,received_payload_hash:d.rawWireHash})
 expect(source.mailbox_message_id).toBe(mailbox.mailId);expect(source.inbound_email_message_id).toBe(mailbox.mailId)
 const snapshot=reception.transport_source_snapshot as Row
 exactKeys(snapshot,['mailboxId','internetMessageId','rawMessageSha256','parsePayloadHash','sourceKind','deliveryAuthenticated','originalMailboxSmtpAddress','originalMailboxCompanyId','originalMailboxEnvironment','originalMailboxShared'])
 expect(snapshot).toMatchObject({mailboxId:mailbox.mailboxId,parsePayloadHash:d.rawWireHash,sourceKind:'retained_mail_observation',originalMailboxEnvironment:d.environment,deliveryAuthenticated:false})
 expect(email(snapshot.originalMailboxSmtpAddress)).toBe(true);expect(smtp.from.trim().toLowerCase()).toBe(String(snapshot.originalMailboxSmtpAddress).toLowerCase())
 expect(snapshot.originalMailboxCompanyId===d.companyId||snapshot.originalMailboxCompanyId===null||snapshot.originalMailboxShared===true).toBe(true)
 const mail=one(frozen.retainedMail.filter(r=>r.id===mailbox.mailId),'retained original mail'),box=one(frozen.mailboxes.filter(r=>r.id===mailbox.mailboxId),'retained original mailbox'),parse=one(frozen.parses.filter(r=>r.id===mailbox.parseId),'retained original parse')
 expect(mail.mailbox_id).toBe(box.id);expect(mail.company_id===null||mail.company_id===d.companyId).toBe(true);expect(mail.environment===null||mail.environment===d.environment).toBe(true)
 expect(box).toMatchObject({environment:d.environment,is_active:true});expect(box.company_id===d.companyId||box.company_id===null||box.is_shared_platform_mailbox===true).toBe(true)
 expect(snapshot.internetMessageId).toBe(mail.internet_message_id);expect(snapshot.rawMessageSha256).toBe(mail.raw_message_sha256);expect(reception.received_at).toBe(mail.received_at)
 expect(parse).toMatchObject({company_id:d.companyId,inbound_email_message_id:mail.id,message_family:'PRODAT',message_code:'Z14',raw_payload:source.raw_payload,interchange_reference:physical.interchangeReference,application_reference:physical.applicationReference,sender_ediel_id:physical.sender[0],receiver_ediel_id:physical.receiver[0]})
 expect(reception.scope).toEqual({sender:parse.sender_ediel_id,receiver:parse.receiver_ediel_id,applicationReference:parse.application_reference,interchangeReference:parse.interchange_reference,family:parse.message_family,code:parse.message_code})
 const retained=[mail.raw_edifact_payload,mail.body_text,mail.raw_email,...frozen.attachments.filter(r=>r.inbound_email_message_id===mail.id).map(r=>r.raw_text)]
 expect(retained.some(v=>typeof v==='string'&&v.includes(source.raw_payload!))).toBe(true)
 const technicalSource=one(frozen.technicalSources.filter(r=>r.source_message_id===source.id),'actual born technical source')
 expect(technicalSource).toMatchObject({source_company_id:d.companyId,company_id:d.companyId,environment:d.environment,payload_sha256:d.rawWireHash,source_received_at:source.message_received_at,status:'ready',reason:null})
 const observed=instant(technicalSource.observed_at),current=instant(frozen.readAt);expect(observed<=current).toBe(true)
 // Date-typed platform intervals are inclusive. For non-UTC database zones all
 // possible local dates must select identical rows, avoiding a guessed birth date.
 const platformAt=(row:Row,t:bigint)=>{
  const date=new Date(Number(t/BigInt(1000))).toISOString().slice(0,10),dates=frozen.databaseTimeZone==='UTC'?[date]:[-1,0,1].map(day=>new Date(Date.parse(date+'T00:00:00Z')+day*86400000).toISOString().slice(0,10))
  const matches=dates.map(v=>(row.valid_from===null||String(row.valid_from)<=v)&&(row.valid_to===null||v<=String(row.valid_to)))
  expect(new Set(matches).size,'timezone-independent platform date selection').toBe(1);return matches[0]
 }
 const endpointAt=(time:bigint)=>{
  const relations=frozen.transportRelations.filter(r=>r.environment===d.environment&&r.relation_type==='ediel_transport_agent'&&r.is_enabled===true&&interval(r,time))
  const candidates=frozen.tenantIdentifiers.filter(r=>r.environment===d.environment&&r.identifier_type==='EdielId'&&r.identifier_value===physical.receiver[0]&&interval(r,time)&&!relations.some(rel=>rel.company_id===r.company_id)).map(r=>({company:r.company_id,actor:r.actor_id}))
  for(const relation of relations)for(const id of frozen.platformIdentifiers.filter(r=>r.actor_id===relation.counterparty_actor_id&&r.identifier_type==='EdielId'&&r.identifier_value===physical.receiver[0]&&platformAt(r,time)))candidates.push({company:relation.company_id,actor:id.actor_id})
  expect([...new Set(candidates.map(r=>r.company))]).toEqual([d.companyId]);expect(relations.filter(own).length).toBeLessThanOrEqual(1)
  const actor=one([...new Set(candidates.filter(r=>r.company===d.companyId).map(r=>r.actor))],'unique technical endpoint actor');expect(actor).toMatch(uuid);return actor
 }
 const endpointActor=endpointAt(observed);expect(endpointAt(current)).toBe(endpointActor)
 const allOrNull=(rows:Row[])=>rows.length?sorted(rows):null
 const endpointFacts={tenantIdentifiers:allOrNull(frozen.tenantIdentifiers.filter(own)),transportRelations:allOrNull(frozen.transportRelations.filter(r=>own(r)&&r.relation_type==='ediel_transport_agent')),
  platformIdentifiers:allOrNull(frozen.platformIdentifiers.filter(r=>r.actor_id===endpointActor&&r.identifier_type==='EdielId'))}
 expect(technicalSource.evidence).toEqual({kind:'technical_syntax_ack',version:1,companyId:d.companyId,environment:d.environment,sourceMessageId:source.id,sourceHash:d.rawWireHash,observedAt:technicalSource.observed_at,originalUNB:physical,transportActorId:endpointActor,transportEdielId:physical.receiver[0],endpointFacts})
 const aliases=(r:Row,p:Row)=>({route_profile_id:p.id,communication_route_id:r.id,route_name:r.route_name,communication_route_active:r.is_active,route_scope:r.route_scope,route_type:r.route_type,grid_owner_id:r.grid_owner_id,target_system:r.target_system,endpoint:r.endpoint,target_email:r.target_email,supported_payload_version:r.supported_payload_version,communication_route_notes:r.notes,route_profile_notes:p.notes})
 const environmentRoute=(r:Row)=>d.environment==='test'&&['tgt_test','agt_test','bilateral_test'].includes(String(r.environment_type))
 const sameOrNull=(v:unknown,w:unknown)=>v===null||v===w
 const technicalPairs:{route:Row;profile:Row;transportProfile:Row|null}[]=[]
 for(const r of frozen.routes){if(r.company_id!==d.companyId||r.is_active!==true||r.route_scope!=='ediel_ack'||!environmentRoute(r)||!email(r.target_email))continue
  for(const p of frozen.profiles){if(p.communication_route_id!==r.id||p.company_id!==r.company_id||!own(p)||p.is_enabled!==true||p.is_active!==true||p.message_standard!=='edifact'||p.payload_format!=='edifact'||!sameOrNull(p.message_family,'CONTRL')||!sameOrNull(p.business_code,'CONTRL')||p.sender_ediel_id!==physical.receiver[0]||p.receiver_ediel_id!==physical.sender[0]||p.application_reference!==physical.applicationReference||p.mailbox!==smtp.from)continue
   if((p.sender_subaddress??p.sender_sub_address??'')!==(physical.receiver[2]??'')||(p.receiver_subaddress??p.receiver_sub_address??'')!==(physical.sender[2]??'')||!(p.sender_subaddress===null||p.sender_sub_address===null||p.sender_subaddress===p.sender_sub_address)||!(p.receiver_subaddress===null||p.receiver_sub_address===null||p.receiver_subaddress===p.receiver_sub_address))continue
   if(p.transport_profile_id===null){if(p.smtp_host===smtp.host&&p.smtp_port===smtp.port)technicalPairs.push({route:r,profile:p,transportProfile:null})}
   else for(const tp of frozen.transportProfiles.filter(t=>t.id===p.transport_profile_id&&own(t)&&t.is_active===true&&t.transport_channel==='smtp'&&['outbound','both'].includes(String(t.direction))&&t.sender_email===smtp.from&&t.host===smtp.host&&t.port===smtp.port))
    if(sameOrNull(p.smtp_host,smtp.host)&&sameOrNull(p.smtp_port,smtp.port))technicalPairs.push({route:r,profile:p,transportProfile:tp})
  }
 }
 const contrl=one(technicalPairs,'whole technical candidate PAIR count');expect(contrl.route.id).toBe(d.expectedRouteId);expect(contrl.profile.id).toBe(d.expectedContrlProfileId)
 const technicalDTO={kind:'technical_syntax_ack_route',smtpHost:smtp.host,smtpPort:smtp.port,companyId:d.companyId,environment:d.environment,sourceMessageId:source.id,sourceHash:d.rawWireHash,
  route:{...contrl.route,auth_config:{}},routeRuntime:{...contrl.profile,...aliases(contrl.route,contrl.profile)},senderEdielId:physical.receiver[0],senderQualifier:physical.receiver[1]||null,senderSubAddress:physical.receiver[2]||null,
  receiverEdielId:physical.sender[0],receiverQualifier:physical.sender[1]||null,receiverSubAddress:physical.sender[2]||null,receiverMessageSubAddress:physical.sender[2]||null,
  applicationReference:physical.applicationReference,senderEmail:smtp.from,receiverEmail:contrl.route.target_email,mailbox:smtp.from,routeKey:`contrl_source_reply|${contrl.route.id}|${contrl.profile.id}|${d.environment}|${physical.applicationReference}`,authorizesBusinessEffect:false}
 let aperak:{route:Row;profile:Row;transportProfile:Row|null}|null=null,ordinaryView:Row|null=null,ordinaryContext:Row|null=null
 if(d.expectedAperakProfileId!==undefined){
  const grids=frozen.gridOwners.filter(r=>r.company_id===d.companyId&&r.is_active===true&&r.ediel_id===clean(source.sender_ediel_id)),gridId=grids.length===1?grids[0].id:null
  const eligibleRoutes=frozen.routes.filter(r=>r.company_id===d.companyId&&r.is_active===true&&r.route_scope==='ediel_ack'&&environmentRoute(r))
  let routes=gridId===null?[]:eligibleRoutes.filter(r=>r.grid_owner_id===gridId);expect(routes.length).toBeLessThanOrEqual(1);if(!routes.length)routes=eligibleRoutes.filter(r=>r.grid_owner_id===null)
  const r=one(routes,'ordinary selected grid-owner or generic route');expect(r.id).toBe(d.expectedRouteId)
  const p=one(frozen.profiles.filter(p=>own(p)&&p.communication_route_id===r.id&&p.application_reference===physical.applicationReference&&p.is_enabled===true&&(p.is_active===null||p.is_active===true)&&sameOrNull(p.message_family,'APERAK')&&sameOrNull(p.business_code,'APERAK')),'ordinary raw candidate row count')
  expect(p.id).toBe(d.expectedAperakProfileId);ordinaryView=nationalOrdinaryView(p,r)
  expect(one(frozen.runtimeView.filter(v=>own(v)&&v.communication_route_id===r.id&&v.route_profile_id===p.id),'ordinary runtime view row count')).toEqual(ordinaryView)
  const actor=one(frozen.actorSettings.filter(a=>own(a)&&a.is_active===true&&a.actor_role==='energy_service_company'),'own ESCO actor setting')
  expect(frozen.tenantProfiles.filter(r=>own(r)&&r.market==='electricity'&&r.is_enabled===true&&interval(r,current)).length,'current tenant EDIEL profile enabled').toBeGreaterThan(0)
  const legalIds=frozen.tenantIdentifiers.filter(r=>own(r)&&r.identifier_type==='EdielId'&&interval(r,current))
  const legalActor=one([...new Set(legalIds.map(r=>clean(r.actor_id)).filter(Boolean))],'current legal actor'),legalEdiel=one([...new Set(legalIds.map(r=>clean(r.identifier_value)).filter(Boolean))],'current legal Ediel ID')
  const roleCodes=[...new Set(frozen.tenantRoles.filter(r=>own(r)&&r.actor_id===legalActor&&interval(r,current)).map(r=>clean(r.role_code)).filter(Boolean))].sort()
  expect(roleCodes).toContain('energy_service_company')
  const ordinaryRelations=frozen.transportRelations.filter(r=>own(r)&&r.relation_type==='ediel_transport_agent'&&r.is_enabled===true&&interval(r,current));expect(ordinaryRelations.length).toBeLessThanOrEqual(1)
  const relation=ordinaryRelations[0]??null,transportActor=relation?relation.counterparty_actor_id:legalActor
  // Plain current ordinary identity resolves all platform Ediel identifiers;
  // its legacy directory read has no DATE predicate. Technical endpoint uses
  // the separate inclusive DATE check above. Both must independently agree.
  const transportEdiel=relation?one([...new Set(frozen.platformIdentifiers.filter(r=>r.actor_id===transportActor&&r.identifier_type==='EdielId').map(r=>clean(r.identifier_value)).filter(Boolean))],'ordinary current transport Ediel ID'):legalEdiel
  if(relation){expect(transportActor).not.toBe(legalActor);expect(transportEdiel).not.toBe(legalEdiel)}
  exactKeys(identity.currentIdentity,['companyId','environment','legalActorId','legalEdielId','transportActorId','transportEdielId','roleCodes','representedByTransportAgent','transportRelationId'])
  expect({...identity.currentIdentity,roleCodes:[...identity.currentIdentity.roleCodes].sort()}).toEqual({companyId:d.companyId,environment:d.environment,legalActorId:legalActor,legalEdielId:legalEdiel,transportActorId:transportActor,transportEdielId:transportEdiel,roleCodes,representedByTransportAgent:relation!==null,transportRelationId:relation?.id??null})
  expect(identity.currentIdentity).toMatchObject({companyId:d.companyId,environment:d.environment,transportEdielId:physical.receiver[0]});expect(identity.currentIdentity.roleCodes).toContain('energy_service_company')
  expect(clean(actor.ediel_id)??clean(actor.actor_ediel_id)).toBe(identity.currentIdentity.legalEdielId)
  const receiverSub=clean(ordinaryView.receiver_subaddress)??clean(ordinaryView.receiver_sub_address),senderSub=clean(ordinaryView.sender_subaddress)??clean(ordinaryView.sender_sub_address)??clean(actor.sender_subaddress_prodat)??clean(actor.sender_subaddress)??clean(actor.sender_sub_address)
  const version=clean(ordinaryView.default_message_version),app=clean(source.application_reference),receiver=clean(source.sender_ediel_id),messageSub=clean(ordinaryView.receiver_message_subaddress)??receiverSub
  ordinaryContext={senderEdielId:identity.currentIdentity.transportEdielId,senderName:clean(ordinaryView.sender_name)??clean(actor.sender_name)??clean(actor.legal_name)??clean(actor.actor_name),senderSubAddress:senderSub,
   receiverEdielId:receiver,receiverName:clean(ordinaryView.receiver_name),receiverSubAddress:receiverSub,receiverMessageSubAddress:messageSub,mailbox:clean(ordinaryView.mailbox)??clean(actor.mailbox),receiverEmail:clean(r.target_email),applicationReference:app,
   defaultMessageVersion:version,routeKey:`ediel_ack|${r.id}|${receiver}|${messageSub??receiverSub??'no-subaddress'}|${app}|edifact|test|${version??'default-version'}`}
  // The ordinary atomic guard is separately exact, unlike trim/context fallbacks.
  expect(p).toMatchObject({sender_ediel_id:ordinaryContext.senderEdielId,receiver_ediel_id:ordinaryContext.receiverEdielId,application_reference:ordinaryContext.applicationReference,mailbox:ordinaryContext.mailbox})
  expect(p.sender_subaddress??p.sender_sub_address??'').toBe(senderSub??'');expect(p.receiver_subaddress??p.receiver_sub_address??'').toBe(receiverSub??'');expect(r.target_email).toBe(ordinaryContext.receiverEmail)
  expect(senderSub).toBe(physical.receiver[2]??null);expect(receiverSub).toBe(physical.sender[2]??null)
  aperak={route:r,profile:p,transportProfile:null}
 }
 const configuration=(fresh:NationalRouteFrame)=>{for(const key of nationalRouteConfigurationKeys)expect(fresh[key],`whole ${key} configuration`).toEqual(frozen[key])}
 const immutableSource=['id','company_id','environment','direction','raw_payload','immutable_payload_hash','mailbox_message_id','inbound_email_message_id','application_reference','message_received_at'] as const
 const sourceAfter=(actual:Row,expected:Row)=>{exactKeys(expected,nationalSourceColumns);expect(actual).toEqual(expected);for(const key of immutableSource)expect(actual[key]).toEqual(source[key])}
 const canonical=(value:unknown):string=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical((value as Row)[key]))])))
 const compareOld=(old:Row[],fresh:Row[])=>{for(const row of old)expect(fresh.filter(r=>canonical(r)===canonical(row)), 'complete old private row retained').toHaveLength(1)}
 const compareAfter=(fresh:NationalRouteFrame,expected:Row,growth:NationalRouteGrowth)=>{
  configuration(fresh);sourceAfter(fresh.source127,expected)
  expect(Object.keys(growth).every(key=>(nationalRouteMutableLedgerKeys as readonly string[]).includes(key))).toBe(true)
  for(const key of nationalRouteMutableLedgerKeys){const added=growth[key]??[];expect(Array.isArray(added)).toBe(true);for(const row of added)exactKeys(row,nationalRouteFrameColumns[key]);compareOld(frozen[key],fresh[key]);
   // Growth is an exact externally-qualified whole-row transcript. No broad
   // company whitelist or ledger no-growth assumption substitutes owner proof.
   expect([...fresh[key]].sort((a,b)=>canonical(a).localeCompare(canonical(b)))).toEqual([...frozen[key],...added].sort((a,b)=>canonical(a).localeCompare(canonical(b))))}
 }
 return {
  get declaration(){return structuredClone(d)},get mailboxBasis(){return structuredClone(mailbox)},get baselines(){return structuredClone(frozen)},get selected(){return structuredClone({CONTRL:contrl,APERAK:aperak})},
  get expectedOrdinaryView(){return structuredClone(ordinaryView)},get expectedTechnicalDTO(){return structuredClone(technicalDTO)},get ordinaryContext(){return structuredClone(ordinaryContext)},
  get dependencies(){return ['genuine current actor/auth/membership/permissions','independently qualified current tenant identity','genuine canonical guide/source and outbound owner chain','genuine public technical capability and namespace/replay owner'] as const},
  assertCurrentTransportUnchanged(currentSmtp:NationalRouteDeclaration['SMTPfromHostPort'],currentReadiness:NationalRouteMailboxInputs['safeSmtpReadiness']){expect(currentSmtp).toEqual(smtp);expect(currentReadiness).toEqual(mailbox.safeSmtpReadiness)},
  assertConfigurationUnchanged(){configuration(read())},
  assertAfter(expectedSource127:Row,independentlyQualifiedNewRows:NationalRouteGrowth){
   const expected=structuredClone(expectedSource127),growth=structuredClone(independentlyQualifiedNewRows),after=read();compareAfter(after,expected,growth)
   return {assertReplayUnchanged(expectedReplaySource127:Row){const replay=read();configuration(replay);sourceAfter(replay.source127,structuredClone(expectedReplaySource127));for(const key of nationalRouteMutableLedgerKeys)expect(replay[key],`whole replay ${key}`).toEqual(after[key])}}
  }
 }
}

// Plain closed expectation only; callers separately qualify dated source-owned
// registry and policy inputs. Never register this copy as an owner capability.
export function freezeEscoNationalCanonicalExpectation(field:Exclude<EscoNationalField,'208'>,li:string,independentRegistry:NationalRegistryBasis|null){
 expect(['203','205','206','207','313','322']).toContain(field)
 expect(typeof li).toBe('string');expect(li.length).toBeGreaterThan(0)
 return structuredClone(nationalCanonicalVector(field,li,structuredClone(independentRegistry)))
}
