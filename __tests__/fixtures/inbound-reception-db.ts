import {createHash} from 'node:crypto'
import type {ParsedEdifactEnvelope} from '@/lib/inbound-mail/edielEmailParser'

export const company='00000000-0000-4000-8000-000000000001'
export const actor='00000000-0000-4000-8000-000000000002'
export const mailId='00000000-0000-4000-8000-000000000003'
export const parseId='00000000-0000-4000-8000-000000000004'
export const oldId='00000000-0000-4000-8000-000000000005'
export const newId='00000000-0000-4000-8000-000000000006'
export const receivedAt='2026-09-21T11:00:00.000Z'
type Row=Record<string,unknown>
export type BoundaryCall={table:string;operation:string;payload?:Row;filters:Array<[string,unknown]>}

/** Finite declared database ports. No registry or business acceptance is provided. */
export function inboundReceptionBoundary(parsed:ParsedEdifactEnvelope){
 const sourceHash=createHash('sha256').update(parsed.rawPayload).digest('hex')
 const state={environment:'test',existingEnvironment:'test',existing:true,actorActive:true,permission:true,
  error:null as {code:string;message:string;details?:string;hint?:string}|null,
  classification:'first_reception' as 'first_reception'|'protocol_duplicate'|'identity_conflict',
  original:{id:oldId,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:parsed.messageFamily,
   message_code:parsed.messageCode,receiver_ediel_id:parsed.receiverEdielId,application_reference:parsed.applicationReference,raw_payload:parsed.rawPayload,
   inbound_email_message_id:mailId,sender_ediel_id:parsed.senderEdielId,interchange_reference:parsed.interchangeReference,transaction_reference:parsed.transactionReference,external_reference:parsed.bgmReference,
   message_received_at:receivedAt,execution_context_snapshot:{immutableOriginal:true}} as Row,
  calls:[] as BoundaryCall[],rpcCalls:[] as {name:string;args:Row}[]}
 const from=(table:string)=>{
  const call:BoundaryCall={table,operation:'select',filters:[]};state.calls.push(call)
  let one=false
  const result=()=>{
   let rows:Row[]=[];let error:typeof state.error=null
   if(table==='company_memberships')rows=state.actorActive?[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}]:[]
   else if(table==='user_profiles')rows=state.actorActive?[{id:actor,user_status:'active'}]:[]
   else if(table==='ediel_messages'){
    if(call.operation==='select')rows=state.existing?[{...state.original,environment:state.existingEnvironment}]:[]
    else {error=state.error;rows=error?[]:[{id:newId}]}
   }else if(table==='inbound_email_messages')rows=[{id:mailId,company_id:company,environment:state.environment,received_at:receivedAt,raw_edifact_payload:parsed.rawPayload,ediel_mailboxes:{id:'declared-mailbox',environment:state.environment}}]
   else if(table==='inbound_email_attachments')rows=[]
   else if(table==='inbound_ediel_parse_results')rows=[{id:parseId}]
   else if(table==='ediel_message_events'||table==='outbound_requests'||table==='inbound_ediel_match_attempts')rows=[{id:'declared-metadata-only'}]
   else throw Error('undeclared_inbound_fixture_table:'+table)
   if(call.operation==='select')rows=rows.filter(r=>call.filters.every(([key,value])=>r[key]===value))
   return {data:one?rows[0]??null:rows,error}
  }
  const q={select:()=>q,eq:(key:string,value:unknown)=>{call.filters.push([key,value]);return q},is:(key:string,value:unknown)=>{call.filters.push([key,value]);return q},
   not:()=>q,order:()=>q,limit:()=>q,insert:(payload:Row)=>{call.operation='insert';call.payload=structuredClone(payload);return q},
   update:(payload:Row)=>{call.operation='update';call.payload=structuredClone(payload);return q},
   maybeSingle:()=>{one=true;return Promise.resolve(result())},single:()=>{one=true;return Promise.resolve(result())},
   then:(resolve:(value:ReturnType<typeof result>)=>unknown,reject?:(reason:unknown)=>unknown)=>Promise.resolve().then(result).then(resolve,reject)}
  return q
 }
 const rpc=async(name:string,args:Row)=>{
  state.rpcCalls.push({name,args:structuredClone(args)})
  if(name==='gridex_actor_has_company_permission')return {data:state.permission&&args.p_actor_user_id===actor&&args.p_company_id===company&&args.p_permission==='communication.write',error:null}
  if(name!=='ediel_record_inbound_reception_v1')throw Error('undeclared_inbound_fixture_rpc:'+name)
   const expected=state.calls.some(c=>c.table==='ediel_messages'&&c.operation==='insert')?newId:oldId
  if(args.p_company_id!==company||args.p_message_id!==expected||args.p_actor_user_id!==actor||args.p_inbound_email_message_id!==mailId||args.p_parse_result_id!==parseId)throw Error('inbound_reception_fixture_scope_mismatch')
  const held=state.classification!=='first_reception'
  return {data:{companyId:company,sourceMessageId:expected,inboundEmailMessageId:mailId,parseResultId:parseId,receptionId:'00000000-0000-4000-8000-000000000007',
   classification:state.classification,isReplay:state.existing,receivedAt,canonicalPayloadHash:sourceHash,receivedPayloadHash:state.classification==='identity_conflict'?'b'.repeat(64):sourceHash,
   responseRequestId:held?'00000000-0000-4000-8000-000000000008':null,status:held?'held':'observed',reason:held?'declared_original_response_source_required':null,businessEffectAuthorized:false},error:null}
 }
 return {state,from,rpc,writes:(table:string)=>state.calls.filter(c=>c.table===table&&c.operation!=='select')}
}
