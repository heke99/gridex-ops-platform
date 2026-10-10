// Declared synthetic Supabase SDK transport only. Original source/actor/legal/
// reception readers and normal runtime/policy/field validators remain real.
// Catalogue refusal grants no private application, response or whole-M proof.
import {createHash} from 'node:crypto'
import {vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {characteristic,line,raw,type Parts} from '@/__tests__/fixtures/prodat-register'

type Call={kind:'table'|'rpc';name:string;args:Record<string,unknown>}
type Row=Record<string,unknown>
export function createProdatZ10OwnSourceReadingSdk(){
 return ({
 rpc:vi.fn(),from:vi.fn(),rows:{} as Record<string,Row[]>,legal:{} as Row,reception:{} as Row,
 calls:[] as Call[],permissions:new Set<string>(),tableErrors:{} as Record<string,unknown>,
 rpcErrors:{} as Record<string,unknown>,afterRead:undefined as undefined|((call:Call)=>void|Promise<void>),
})
}
export type ProdatZ10OwnSourceReadingSdk=ReturnType<typeof createProdatZ10OwnSourceReadingSdk>
export const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const company=id(2),actor=id(3),mail=id(4),parse=id(5),source=id(1)
const point='735123456789012344',other='735123456789012351'
export const received='2026-10-01T12:01:00.123456Z'
const sha=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
type Declaration='valid'|'missing-first'|'duplicate-first'|'wrong-component-first'|'header'|'nonlocal-first'
export type Options={declaration?:Declaration;missing?:'214'|'218'|'later259';secondObject?:boolean;poison?:boolean;invalid?:'214'|'218';invalidChain?:boolean}
export function prodatZ10OwnSourceReadingMessage(options:Options={}):EdielMessageRow{
 const kind=options.declaration??'valid'
 const readings=(register:number,first:boolean):Parts[]=>[
  ...(options.missing==='214'&&first?[]:characteristic('Z02','1',options.invalid==='214'&&first?0:3)),
  ...(options.missing==='218'&&first?[]:characteristic('Z05','6',options.invalid==='218'&&first?0:3)),
  ...(first&&(kind==='missing-first'||kind==='nonlocal-first')||!first&&options.missing==='later259'?[]:
   characteristic('Z16',String(register),first&&kind==='wrong-component-first'?0:3)),
  ...(first&&kind==='duplicate-first'?characteristic('Z16',String(register),3):[]),
 ]
 const object=(p:string,sequence:number,declared:boolean):Parts[]=>[
  line(String(sequence),p,'1','9'),['DTM',['157','202610270000','203']],['DTM',['354','15','806']],
  ...characteristic('Z13','E58'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),
  ...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
  ...(declared?readings(101,true):[...characteristic('Z02','1',3),...characteristic('Z05','6',3)]),
  ['RFF',['MG','NEW-METER']],['RFF',['Z02','OLD-METER']],['RFF',['Z05','TES']],['RFF',['LI','M-OWN-'+String(sequence)]],
  ...(declared&&kind==='nonlocal-first'?characteristic('Z16','101',3):[]),
  ['NAD','Z02',['99876','160','SVK']],
  line(String(sequence+1),p,options.invalidChain?'3':'2','9'),...readings(102,false),
 ]
 const body:Parts[]=[
  ['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(kind==='header'?characteristic('Z16','101',3):[]),
  ...object(point,1,true),...(options.secondObject?object(other,3,false):[]),
 ]
 const wire=raw(body,'Z10').replace('+S+R+','+54321:14+12345:14+')
  .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 const birth={version:1,contextOrigin:'database_insert',sourceMessageId:source,companyId:company,
  environment:'test',messageCode:'Z10',payloadHash:sha(wire),sourceReceivedAt:received,capturedAt:received}
 return {process_type:null,test_flag:1,transport_type:'smtp',mailbox:null,mailbox_message_id:null,
  sender_ediel_id:'54321',sender_name:null,sender_sub_address:null,receiver_ediel_id:'12345',
  receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,
  file_name:null,mime_type:null,interchange_reference:'I',external_reference:null,correlation_reference:null,
  transaction_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,
  related_message_id:null,communication_route_id:null,outbound_request_id:null,switch_request_id:null,
  grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,
  grid_owner_id:null,requires_contrl:false,requires_aperak:false,contrl_status:null,aperak_status:null,
  utilts_err_status:null,ack_outcome:null,functional_check_status:null,message_sent_at:null,parsed_at:null,
  validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,updated_at:received,created_by:null,
  updated_by:null,id:source,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',
  message_family:'PRODAT',message_code:'Z10',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',
  raw_payload:wire,inbound_email_message_id:mail,created_at:received,message_received_at:received,
  message_created_at:'2026-09-17T11:00:00Z',status:'received',syntax_check_status:'not_checked',failure_reason:null,
  execution_context_snapshot:{receivedProdatContext:birth},
  parsed_payload:options.poison===undefined?{}:{meterReadingsSentInUtilts:options.poison,
   prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,
    byCell:{'Z10:214':options.poison,'Z10:218':options.poison,'Z10:259':options.poison}}},
  validation_report:options.poison===undefined?{}:{prodatDependentFacts:{meterReadingsSentInUtilts:options.poison}},
 }
}
export function installProdatZ10OwnSourceReadingFixture(io:ProdatZ10OwnSourceReadingSdk,row:EdielMessageRow){
 io.rows={
  ediel_messages:[structuredClone(row) as unknown as Row],
  user_profiles:[{id:actor,user_status:'active'}],
  company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:received}],
  inbound_email_messages:[{id:mail,company_id:company,environment:'test',received_at:received,raw_edifact_payload:row.raw_payload}],
  inbound_ediel_parse_results:[{id:parse,company_id:company,inbound_email_message_id:mail,raw_payload:row.raw_payload,parse_status:'parsed'}],
 }
 io.legal={basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',
  family:'PRODAT',code:'Z10',subtype:'M',legalActorId:id(8),legalEdielId:'12345',actorRole:'electricity_supplier',
  transportActorId:id(9),transportEdielId:'12345',applicationReference:'23-DDQ-PRODAT',sourceEdition:'c'.repeat(64),
  canonicalProjection:{family:'PRODAT',code:'Z10',subtype:'M',transactionReasonCode:'E58',direction:'inbound',
   senderRoles:['grid_owner'],receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
  observedAt:received,sourceReceivedAt:received}
 io.reception={companyId:company,sourceMessageId:source,inboundEmailMessageId:mail,parseResultId:parse,receptionId:id(6),
  classification:'first_reception',isReplay:true,receivedAt:received,canonicalPayloadHash:sha(row.raw_payload!),
  receivedPayloadHash:sha(row.raw_payload!),responseRequestId:null,status:'observed',reason:null,businessEffectAuthorized:false}
}
export function resetProdatZ10OwnSourceReadingSdk(io:ProdatZ10OwnSourceReadingSdk){
 io.from.mockReset();io.rpc.mockReset();io.rows={};io.calls=[];io.permissions=new Set(['communication.read'])
 io.tableErrors={};io.rpcErrors={};io.afterRead=undefined
 io.from.mockImplementation((name:string)=>{
  if(!Object.hasOwn(io.rows,name))throw Error('UNEXPECTED_COMPONENT_TABLE:'+name)
  const filters:Record<string,unknown>={},notNull:string[]=[]
  const read=async()=>{
   const matches=io.rows[name].filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)&&notNull.every(k=>r[k]!=null))
   const data=matches.length===1?structuredClone(matches[0]):null
   const call:Call={kind:'table',name,args:{...filters}};io.calls.push(call);await io.afterRead?.(call)
   return {data,error:io.tableErrors[name]??null}
  }
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},
   not:(key:string,op:string,value:unknown)=>{if(op!=='is'||value!==null)throw Error('UNEXPECTED_COMPONENT_NOT');notNull.push(key);return q},
   maybeSingle:read,single:read}
  return q
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const call:Call={kind:'rpc',name,args:{...args}};io.calls.push(call)
  let data:unknown
  if(name==='gridex_actor_has_company_permission')data=args.p_company_id===company&&args.p_actor_user_id===actor&&io.permissions.has(String(args.p_permission))
  else if(name==='ediel_require_inbound_legal_context_v1')data=args.p_company_id===company&&args.p_message_id===source?structuredClone(io.legal):null
  else if(name==='ediel_inbound_reception_request_v1')data=Object.keys(io.reception).length&&args.p_company_id===company&&args.p_message_id===source&&args.p_actor_user_id===actor&&args.p_inbound_email_message_id===mail?structuredClone(io.reception):null
  else if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1')return {data:null,error:new Error('DECLARED_CATALOGUE_REFUSAL_NO_PRIVATE_RECEIPT')}
  else throw Error('UNEXPECTED_COMPONENT_RPC:'+name)
  await io.afterRead?.(call)
  return {data,error:io.rpcErrors[name]??null}
 })
}
