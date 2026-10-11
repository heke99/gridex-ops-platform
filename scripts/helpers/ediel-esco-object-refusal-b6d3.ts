// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Literal counterpart omissions and read-only owner observations. This helper
// registers no tests/hooks and creates no validation or business authority.
import {createHash} from 'node:crypto'
import {expect} from 'vitest'
import {nativeEscoSql as sql,nativeEscoLiteral as lit,
 type seedNativeEscoFixture,type prepareNativeEscoPermissionFixture} from '../fixtures/ediel-service-evidence-native'
import {omitZ14Field} from './ediel-z14v-current-native-fixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Pending=Awaited<ReturnType<typeof prepareNativeEscoPermissionFixture>>
type Row=Record<string,unknown>
type Window=readonly[number,number]
export type EscoObjectField='316'|'234'|'302'|'508'|'326'|'217'|'222'|'513'|'260'|'325'|'228'
export type EscoReportingField=EscoObjectField|'321'|'322'|'323'
export const escoObjectRefusals=[['V','316'],['V','234'],['V','302'],['V','508'],['V','217'],['V','513'],['V','260'],['V','325'],['V','228'],
 ['VH','316'],['VH','234'],['VH','302'],['VH','508'],['VH','326'],['VH','217'],['VH','222'],['VH','513'],['VH','260'],['VH','325'],['VH','228']] as const
export function isEscoObjectRefusal(mode:'V'|'VH',field:EscoReportingField):field is EscoObjectField{
 return escoObjectRefusals.some(([m,n])=>m===mode&&n===field)
}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const minute=(value:string)=>new Date(Date.parse(value)+3600000).toISOString().slice(0,16).replace(/[-T:]/g,'')

export function omitEscoObjectField(raw:string,field:EscoObjectField,f:Fixture,p:Pending,renderWindow:Window){
 const original=tokenizeEdifact(raw),s=original.segments
 expect(s.filter(x=>x.tag==='UNH')).toHaveLength(1);expect(s.filter(x=>x.tag==='LIN')).toHaveLength(1)
 expect(s.filter(x=>x.tag==='BGM')).toHaveLength(1);expect(s.filter(x=>x.tag==='UNT')).toHaveLength(1)
 expect(s.slice(0,8).map(x=>x.tag)).toEqual(['UNB','UNH','BGM','DTM','DTM','NAD','NAD','LIN'])
 expect(segmentComposite(s[3],1,original.una)[0]).toBe('137');expect(segmentComposite(s[4],1,original.una)[0]).toBe('ZZZ')
 expect(segmentComposite(s[5],1,original.una)[0]).toBe('FR');expect(segmentComposite(s[6],1,original.una)[0]).toBe('DO')
 expect(s[7].index).toBe(7);expect(s[7].raw).toBe('LIN+1++'+f.point+':::9')
 expect(segmentComposite(s[0],7,original.una)[0]).toBe('23-DGI-PRODAT')
 expect(segmentComposite(s[1],2,original.una)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(s.some(x=>x.raw==='RFF+LI:'+p.li)).toBe(true)
 const u=original.una
 for(const delimiter of [u.dataElementSeparator,u.componentDataElementSeparator,u.segmentTerminator])expect(raw.includes(u.releaseCharacter+delimiter)).toBe(false)
 const party=field==='316'||field==='228'?'UD':field==='234'?'IT':null
 const date=field==='302'?'90':field==='508'?'354':field==='326'?'693':null
 const char=field==='217'?'Z04':field==='513'?'Z22':field==='222'?'Z12':null
 const ref=field==='260'?'Z05':field==='325'?'Z09':null
 const positions=s.flatMap((x,i)=>i>7&&(party?x.tag==='NAD'&&segmentComposite(x,1,u)[0]===party:
  date?x.tag==='DTM'&&segmentComposite(x,1,u)[0]===date:
  char?x.raw==='CCI++'+char:x.tag==='RFF'&&segmentComposite(x,1,u)[0]===ref)?[i]:[])
 expect(positions).toHaveLength(1);const at=positions[0],expected=s.map(x=>x.raw)
 if(party){const element=field==='316'?9:field==='234'?5:4,parts=s[at].raw.split(u.dataElementSeparator)
  expect(parts[element]).toBe(field==='316'?'SE':field==='234'?'Synthetic Street 1':'Synthetic Customer')
  parts[element]='';expected[at]=parts.join(u.dataElementSeparator)
 }else if(date){const value=segmentComposite(s[at],1,u)
  if(field==='508')expect(value).toEqual(['354','60','806'])
  else if(field==='302')expect(value).toEqual(['90',minute(String(f.fields.data_start)),'203'])
  else{expect(value).toEqual(['693',expect.stringMatching(/^\d{12}$/),'203'])
   expect(value[1]>=minute(new Date(renderWindow[0]).toISOString())).toBe(true)
   expect(value[1]<=minute(new Date(renderWindow[1]).toISOString())).toBe(true)}
  expected.splice(at,1)
 }else if(char){expect(s[at+1].raw).toBe('CAV+'+(field==='217'?'Z04':field==='513'?'E19':':::D'));expected.splice(at,2)
 }else{expect(segmentComposite(s[at],1,u)).toEqual([ref,field==='260'?'TES':'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8)]);expected.splice(at,1)}
 const unh=expected.findIndex(x=>x.startsWith('UNH+')),unt=expected.findIndex(x=>x.startsWith('UNT+'))
 expected[unt]='UNT+'+(unt-unh+1)+'+'+segmentComposite(s.find(x=>x.tag==='UNT'),2,u)[0]
 const result=omitZ14Field(raw,field),actual=tokenizeEdifact(result)
 expect(actual.una).toEqual(u);expect(actual.segments.map(x=>x.raw)).toEqual(expected)
 return result
}

// Frozen P26.A locators; expected diagnostics do not consult the runtime matrix.
const diagnostic={
 '316':{segmentPath:'NAD+UD/3207',group:'SG8/SG17',component:{locator:'NAD+UD/3207',partyQualifier:'UD',partyElement:9,partyComponents:1}},
 '234':{segmentPath:'NAD+IT/C059/3042[1..3]',group:'SG8/SG17',component:{locator:'NAD+IT/C059/3042[1..3]',partyQualifier:'IT',partyElement:5,partyComponents:3}},
 '228':{segmentPath:'NAD+UD/C080/3036[1..2]',group:'SG8/SG17',component:{locator:'NAD+UD/C080/3036[1..2]',partyQualifier:'UD',partyElement:4,partyComponents:2}},
 '302':{segmentPath:'DTM+90',group:'SG8',component:{locator:'DTM+90',dateQualifier:'90',valueElement:'C507/2380',formatElement:'C507/2379'}},
 '508':{segmentPath:'DTM+354',group:'SG8',component:{locator:'DTM+354',dateQualifier:'354',valueElement:'C507/2380',formatElement:'C507/2379'}},
 '326':{segmentPath:'DTM+693',group:'SG8',component:{locator:'DTM+693',dateQualifier:'693',valueElement:'C507/2380',formatElement:'C507/2379'}},
 '217':{segmentPath:'CCI++Z04/CAV',group:'SG8/SG14',component:{locator:'CCI++Z04/CAV',composite:'C889',cavComponent:0}},
 '513':{segmentPath:'CCI++Z22/CAV',group:'SG8/SG14',component:{locator:'CCI++Z22/CAV',composite:'C889',cavComponent:0}},
 '222':{segmentPath:'CCI++Z12/CAV',group:'SG8/SG14',component:{locator:'CCI++Z12/CAV',composite:'C889',cavComponent:3}},
 '260':{segmentPath:'RFF+Z05',group:'SG8/SG16',component:{locator:'RFF+Z05',referenceScope:'line',valueElement:'C506/1154'}},
 '325':{segmentPath:'RFF+Z09',group:'SG8/SG16',component:{locator:'RFF+Z09',referenceScope:'line',valueElement:'C506/1154'}},
} as const
export function qualifyEscoObjectDiagnostic(actual:unknown,field:EscoObjectField,f:Fixture,p:Pending){
 expect(actual).toEqual({kind:'field',fieldNumber:field,errorKind:'missing',sourceRule:'PRODAT26A:§2.2:Z14:'+field,...diagnostic[field],
  occurrence:{scope:'object',messageReference:'1',lineIndex:0,lineNumber:'1',registerPosition:1,objectId:f.point,identityAgency:'9',lineItemReference:p.li,
   ownReferences:{objectId:{kind:'present',value:f.point},lineItemReference:{kind:'present',value:p.li},customerId:{kind:'present',value:'199001011234'}}}})
}

const tables={assessments:'gridex_received_sources.object_assessments',witnesses:'gridex_received_sources.object_availability_witnesses',
 canonical:'gridex_received_sources.validation_assessments',selection:'gridex_received_sources.object_selection_snapshots',
 customer:'gridex_received_sources.customer_primary_response_receipts',structural:'gridex_received_sources.structural_object_apply_receipts',
 batches:'gridex_received_sources.structural_apply_batches'} as const
type Snapshot=Record<keyof typeof tables,Row[]>
const snapshot=():Snapshot=>Object.fromEntries(Object.entries(tables).map(([key,table])=>[key,
 sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r`)])) as Snapshot
type Column={name:string;type:string;nullable:boolean;default:string|null}
function schema(table:string,columns:readonly string[],defaults:Record<string,string>,nullable:readonly string[]=[]){
 const actual=sql<Column[]>(`SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid=${lit(table)}::regclass AND a.attnum>0 AND NOT a.attisdropped`)
 const types:Record<string,string>={id:'uuid',source_message_id:'uuid',company_id:'uuid',assessment_id:'uuid',canonical_assessment_id:'uuid',previous_assessment_id:'uuid',
  owner_readsets:'jsonb',created_xid:'xid8',assessed_at:'timestamp with time zone',observed_at:'timestamp with time zone'}
 expect(actual).toEqual(columns.map(name=>({name,type:types[name]??'text',nullable:nullable.includes(name),default:defaults[name]??null})))
}
const xid=()=>sql<string>('SELECT to_jsonb(pg_current_xact_id()::text)')
function xidValue(value:unknown){expect(typeof value).toBe('string');expect(value).toMatch(/^[1-9]\d*$/)
 const n=BigInt(String(value));expect(n).toBeLessThanOrEqual(BigInt('18446744073709551615'));return n}
function boundedTime(value:unknown,window:Window,received:string){expect(typeof value).toBe('string');const instant=Date.parse(String(value))
 expect(Number.isFinite(instant)).toBe(true);expect(instant).toBeGreaterThanOrEqual(Math.max(window[0],Date.parse(received)))
 expect(instant).toBeLessThanOrEqual(window[1]);return instant}
function added(old:Row[],now:Row[]){for(const row of old)expect(now.find(r=>r.id===row.id)).toEqual(row)
 return now.filter(row=>!old.some(r=>r.id===row.id))}
function chain(rows:Row[],source:string){const own=rows.filter(r=>r.source_message_id===source)
 expect(own.filter(r=>r.previous_assessment_id===null)).toHaveLength(1)
 const leaves=own.filter(r=>!own.some(child=>child.previous_assessment_id===r.id));expect(leaves).toHaveLength(1)
 const visited=new Set<unknown>();let node:Row|undefined=leaves[0]
 while(node){expect(visited.has(node.id)).toBe(false);visited.add(node.id);if(node.previous_assessment_id===null)break
  node=own.find(r=>r.id===node!.previous_assessment_id);expect(node).toBeTruthy()}
 expect(visited.size).toBe(own.length);return leaves[0]
}
export function captureEscoObjectOwner(f:Fixture,source:EdielMessageRow,raw:string){
 schema(tables.assessments,['id','source_message_id','company_id','environment','source_payload_hash','canonical_assessment_id','previous_assessment_id',
  'facts_text','facts_hash','owner_readsets','created_xid','assessed_at'],{id:'gen_random_uuid()',created_xid:'pg_current_xact_id()',assessed_at:'clock_timestamp()'},['previous_assessment_id'])
 schema(tables.witnesses,['id','assessment_id','company_id','environment','source_message_id','facts_hash','visibility_snapshot','observed_at'],
  {id:'gen_random_uuid()',observed_at:'clock_timestamp()'})
 const physical=tokenizeEdifact(raw);expect(physical.segments.filter(s=>s.tag==='LIN')).toHaveLength(1)
 expect(physical.segments[7].raw).toBe('LIN+1++'+f.point+':::9')
 const object={messageIndex:0,messageReference:'1',objectId:f.point,identityAgency:'9',
  registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:7}]}
 let before=snapshot(),beforeXid=xid(),calls=0
 expect(before.assessments.filter(r=>r.source_message_id===source.id)).toEqual([])
 expect(before.witnesses.filter(r=>r.source_message_id===source.id)).toEqual([])
 return {qualify(window:Window){
  const afterXid=xid(),now=snapshot(),assessments=added(before.assessments,now.assessments),witnesses=added(before.witnesses,now.witnesses)
  expect(assessments).toHaveLength(1);expect(witnesses).toHaveLength(1)
  for(const key of ['selection','customer','structural','batches'] as const)expect(now[key]).toEqual(before[key])
  const row=assessments[0],w=witnesses[0],parents=added(before.canonical,now.canonical)
  const parent=parents.find(r=>r.id===row.canonical_assessment_id);expect(parent).toBeTruthy()
  if(!parent)throw Error('esco_object_owner_fresh_canonical_parent_required')
  expect(parent).toMatchObject({source_message_id:source.id,company_id:f.ids.company,environment:'test',source_payload_hash:hash(raw),facts_hash:hash(String(parent.facts_text))})
  const facts=JSON.parse(String(parent.facts_text))
  expect(facts).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',reasonCodes:expect.arrayContaining(['FIELD_MATRIX_REQUIRED_FIELD_MISSING'])})
  expect(facts.registerValidation).toEqual({version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',
   objects:[{messageIndex:0,messageReference:'1',objectId:f.point,identityAgency:'9',disposition:'accepted',registers:object.registers,reasons:[]}]})
  const text=JSON.stringify({version:1,owner:'received-source-object-decisions-v1',ruleVersion:'1',canonicalFactsHash:parent.facts_hash,
   objects:[{object,disposition:'rejected',reasons:['FIELD_MATRIX_REQUIRED_FIELD_MISSING'],business:null,party:null}]})
  expect(row.id).toMatch(uuid);expect(w.id).toMatch(uuid);expect(w.id).not.toBe(row.id)
  expect(row).toEqual({id:row.id,source_message_id:source.id,company_id:f.ids.company,environment:'test',source_payload_hash:hash(raw),
   canonical_assessment_id:parent.id,previous_assessment_id:calls===0?null:chain(before.assessments,source.id).id,
   facts_text:text,facts_hash:hash(text),owner_readsets:[],created_xid:row.created_xid,assessed_at:row.assessed_at})
  const created=sql<string>(`SELECT to_jsonb(created_xid::text) FROM ${tables.assessments} WHERE id=${lit(String(row.id))}`)
  expect(row.created_xid).toBe(created);expect(xidValue(created)).toBeGreaterThan(xidValue(beforeXid));expect(xidValue(created)).toBeLessThan(xidValue(afterXid))
  const assessed=boundedTime(row.assessed_at,window,source.message_received_at!)
  expect(w).toEqual({id:w.id,assessment_id:row.id,company_id:f.ids.company,environment:'test',source_message_id:source.id,
   facts_hash:hash(text),visibility_snapshot:w.visibility_snapshot,observed_at:w.observed_at})
  expect(boundedTime(w.observed_at,window,source.message_received_at!)).toBeGreaterThanOrEqual(assessed)
  expect(w.visibility_snapshot).toMatch(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/)
  expect(sql(`SELECT to_jsonb(pg_visible_in_snapshot(a.created_xid,w.visibility_snapshot::pg_snapshot)) FROM ${tables.assessments} a
   JOIN ${tables.witnesses} w ON w.assessment_id=a.id WHERE a.id=${lit(String(row.id))} AND w.id=${lit(String(w.id))}`)).toBe(true)
  chain(now.assessments,source.id);expect(now.assessments.filter(r=>r.source_message_id===source.id)).toHaveLength(calls+1)
  for(const a of now.assessments.filter(r=>r.source_message_id===source.id))expect(now.witnesses.filter(r=>r.assessment_id===a.id)).toHaveLength(1)
  before=now;beforeXid=xid();calls++
 }}
}
