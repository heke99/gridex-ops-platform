// SDK-only finite fixture support. The source issuer, legal/reception wrappers,
// policy and validators stay real. Synthetic SDK rows do not prove native authority.
import {createHash} from 'node:crypto'
import {vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'

export type ProdatOwnSourceReadingFixtureScope={
 actorUserId:string;receivedAt:string;mailId:string;parseId:string;receptionId:string;legalActorId:string
}

export function createProdatOwnSourceReadingSdk(){
const io=({rpc:vi.fn(),from:vi.fn(),rows:{} as Record<string,Record<string,unknown>[]>,
 legal:{} as Record<string,unknown>,reception:{} as Record<string,unknown>,
 calls:[] as {kind:'table'|'rpc';name:string;args:Record<string,unknown>;notNull?:string[]}[],
 scope:null as (ProdatOwnSourceReadingFixtureScope&{companyId:EdielMessageRow['company_id'];sourceMessageId:string})|null,
 rpcErrors:{} as Record<string,unknown>,tableErrors:{} as Record<string,unknown>,
 permissions:new Set<string>(),permissionChecks:0,revokeAfter:Infinity})
 return io
}
export type ProdatOwnSourceReadingSdk=ReturnType<typeof createProdatOwnSourceReadingSdk>
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(3),received='2026-10-01T12:01:00.123456Z'
const hash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex')

export function installProdatOwnSourceReadingFixture(io:ProdatOwnSourceReadingSdk,row:EdielMessageRow,variant:'L'|'LK',options?:ProdatOwnSourceReadingFixtureScope){
 io.scope=options?{...options,companyId:row.company_id,sourceMessageId:row.id}:null
 const readActor=options?.actorUserId??actor,readReceived=options?.receivedAt??received
 const mailId=options?.mailId??id(4),parseId=options?.parseId??id(5),receptionId=options?.receptionId??id(6)
 const legalActorId=options?.legalActorId??id(8)
 const wire=tokenizeEdifact(row.raw_payload!)
 const receiver=wire.segments.find(token=>token.tag==='NAD'&&segmentComposite(token,1,wire.una)[0]==='DO')
 if(!receiver)throw Error('OWN_READING_FIXTURE_LEGAL_RECEIVER_MISSING')
 const receiverId=segmentComposite(receiver,2,wire.una)[0]
 io.rows={ediel_messages:[structuredClone(row) as unknown as Record<string,unknown>],
  user_profiles:[{id:readActor,user_status:'active'}],
  company_memberships:[{company_id:row.company_id,user_id:readActor,status:'active',is_active:true,accepted_at:readReceived}],
  inbound_email_messages:[{id:mailId,company_id:row.company_id,environment:row.environment,received_at:readReceived,raw_edifact_payload:row.raw_payload}],
  inbound_ediel_parse_results:[{id:parseId,company_id:row.company_id,inbound_email_message_id:mailId,raw_payload:row.raw_payload,parse_status:'parsed'}]}
 io.legal={basisKind:'observed_source_persistence',companyId:row.company_id,environment:row.environment,direction:'inbound',
  family:'PRODAT',code:'Z04',subtype:variant,legalActorId,legalEdielId:receiverId,actorRole:'electricity_supplier',
  transportActorId:legalActorId,transportEdielId:receiverId,applicationReference:'23-DDQ-PRODAT',sourceEdition:'c'.repeat(64),
  canonicalProjection:{family:'PRODAT',code:'Z04',subtype:variant,transactionReasonCode:variant==='L'?'Z22':'Z23',direction:'inbound',
   senderRoles:['grid_owner'],receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
  observedAt:readReceived,sourceReceivedAt:readReceived}
 io.reception={companyId:row.company_id,sourceMessageId:row.id,inboundEmailMessageId:mailId,parseResultId:parseId,receptionId,
  classification:'first_reception',isReplay:true,receivedAt:readReceived,canonicalPayloadHash:hash(row.raw_payload!),receivedPayloadHash:hash(row.raw_payload!),
  responseRequestId:null,status:'observed',reason:null,businessEffectAuthorized:false}
}


export function resetProdatOwnSourceReadingSdk(io:ProdatOwnSourceReadingSdk){
 io.rpc.mockReset();io.from.mockReset();io.rows={};io.calls=[];io.rpcErrors={};io.tableErrors={}
 io.scope=null
 io.permissions=new Set(['communication.read','metering.write']);io.permissionChecks=0;io.revokeAfter=Infinity
 io.from.mockImplementation((table:string)=>{
  if(!Object.hasOwn(io.rows,table))throw Error(`UNEXPECTED_UNIT_TABLE:${table}`)
  const filters:Record<string,unknown>={},notNull:string[]=[]
  const result=async()=>{
   const matches=io.rows[table].filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)&&notNull.every(key=>row[key]!==null&&row[key]!==undefined))
   io.calls.push({kind:'table',name:table,args:{...filters},...(io.scope?{notNull:[...notNull]}:{})})
   return {data:matches.length===1?structuredClone(matches[0]):null,error:io.tableErrors[table]??null}
  }
  const query={select:(_columns:string)=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query},
   not:(key:string,operator:string,value:unknown)=>{if(operator!=='is'||value!==null)throw Error('UNEXPECTED_UNIT_NOT');notNull.push(key);return query},
   single:result,maybeSingle:result}
  return query
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  io.calls.push({kind:'rpc',name,args:{...args}})
  if(io.rpcErrors[name])return {data:null,error:io.rpcErrors[name]}
  if(name==='gridex_actor_has_company_permission'){
   io.permissionChecks++
   return {data:args.p_company_id===(io.scope?io.scope.companyId:id(2))&&args.p_actor_user_id===(io.scope?.actorUserId??actor)&&io.permissionChecks<=io.revokeAfter&&io.permissions.has(String(args.p_permission)),error:null}
  }
  if(name==='ediel_require_inbound_legal_context_v1')return {data:args.p_company_id===(io.scope?io.scope.companyId:id(2))&&args.p_message_id===(io.scope?.sourceMessageId??id(1))?structuredClone(io.legal):null,error:null}
  if(name==='ediel_inbound_reception_request_v1')return {data:Object.keys(io.reception).length&&args.p_company_id===(io.scope?io.scope.companyId:id(2))&&args.p_message_id===(io.scope?.sourceMessageId??id(1))&&args.p_actor_user_id===(io.scope?.actorUserId??actor)&&args.p_inbound_email_message_id===(io.scope?.mailId??id(4))?structuredClone(io.reception):null,error:null}
  throw Error(`UNEXPECTED_UNIT_RPC:${name}`)
 })
}


export const prodatOwnSourceReadingActor=id(3)

/** Opt-in prerequisites for a new positive fixture, before hashing or birth.
 * Own pairs are supplied only by the first physical register of each object.
 * All existing business segments, including later-register omissions, survive. */
export function withProdatOwnSourceReadings(raw:string,options:{addLegalHeader?:boolean}={}):string {
 const wire=tokenizeEdifact(raw)
 const messages=wire.segments.filter(token=>token.tag==='UNH')
 const interchanges=wire.segments.filter(token=>token.tag==='UNB')
 if(messages.length!==1||interchanges.length!==1)throw Error('OWN_READING_FIXTURE_SINGLE_MESSAGE_REQUIRED')
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04')
 if(!grouped.groups.length||grouped.problems.length)throw Error('OWN_READING_FIXTURE_REGISTER_CHAIN_INVALID')
 const pairs=['CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6','CCI++Z16','CAV+:::111']
 const insertions=new Map<number,readonly string[]>()
 for(const group of grouped.groups.filter(group=>group.firstLineIndex===group.lineIndex)){
  if(group.segments.some(token=>token.tag==='CCI'&&['Z02','Z05','Z16'].includes(segmentComposite(token,2,wire.una)[0])))throw Error('OWN_READING_FIXTURE_PAIRS_ALREADY_PRESENT')
  const after=group.segments.find(token=>token.tag==='RFF'||token.tag==='NAD')
  const end=wire.segments.find(token=>token.index>group.segments.at(-1)!.index)
  if(!after&&!end)throw Error('OWN_READING_FIXTURE_INSERTION_MISSING')
  insertions.set((after??end)!.index,pairs)
 }
 const business:string[]=[]
 for(const token of wire.segments){
  if(insertions.has(token.index))business.push(...insertions.get(token.index)!)
  if(!['UNB','UNH','UNT','UNZ'].includes(token.tag))business.push(token.raw)
 }
 if(options.addLegalHeader){
  if(wire.segments.some(token=>token.tag==='NAD'&&['FR','DO'].includes(segmentComposite(token,1,wire.una)[0])))throw Error('OWN_READING_FIXTURE_HEADER_ALREADY_PRESENT')
  const first=business.findIndex(segment=>segment.startsWith('LIN+'))
  business.splice(first,0,'NAD+FR+54321:160:SVK','NAD+DO+12345:160:SVK')
 }
 const header=tokenizeEdifact(business.join("'")+"'")
 const party=(role:string)=>{
  const token=header.segments.find(token=>token.tag==='NAD'&&segmentComposite(token,1,header.una)[0]===role)
  if(!token)throw Error('OWN_READING_FIXTURE_PARTY_MISSING')
  return segmentComposite(token,2,header.una)[0]
 }
 return EdifactEnvelopeCodec.encode({sender:party('FR'),receiver:party('DO'),senderQualifier:'14',receiverQualifier:'14',
  interchangeReference:segmentComposite(interchanges[0],5,wire.una)[0],applicationReference:'23-DDQ-PRODAT',
  environment:'test',acknowledgementRequest:true,createdAt:new Date('2026-09-17T12:00:00Z'),timeZone:'UTC',
  messages:[{messageReference:segmentComposite(messages[0],1,wire.una)[0],
   messageTypeToken:segmentComposite(messages[0],2,wire.una).join(':'),businessSegments:business}]})
}

/** Construct complete, mutually consistent source/mail/parse/birth test facts.
 * Callers supply the final counted wire; no received original is repaired. */
export function prodatOwnSourceReadingMessage(raw:string):EdielMessageRow {
 const birth={version:1,contextOrigin:'database_insert',sourceMessageId:id(1),companyId:id(2),environment:'test',
  messageCode:'Z04',payloadHash:hash(raw),sourceReceivedAt:received,capturedAt:received}
 return {id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',
  message_code:'Z04',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',raw_payload:raw,
  inbound_email_message_id:id(4),message_created_at:'2026-09-17T11:00:00Z',message_received_at:received,created_at:received,
  status:'received',syntax_check_status:'not_checked',failure_reason:null,execution_context_snapshot:{receivedProdatContext:birth},
  parsed_payload:{},validation_report:{}} as unknown as EdielMessageRow
}
