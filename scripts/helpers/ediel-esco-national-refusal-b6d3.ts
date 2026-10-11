// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// National denial input oracle only. No test registration or source authority.
import {expect} from 'vitest'
import {createHash} from 'node:crypto'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {omitPermissionField} from './ediel-permission-field-omissions'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielBusinessMatchResult} from '@/lib/ediel/matching/matchingTypes'
import type {EdielSyntaxValidationResult} from '@/lib/ediel/core/syntaxValidator'

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
