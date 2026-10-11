// Finite SDK composition only: real actor/source issuer, registry decoder,
// legal/reception wrappers and canonical owners remain the production code.
import type {ProdatOwnSourceReadingSdk} from './prodatOwnSourceReadingFixture'
import {ownerRulePack} from './sourceOwnerFixtures'

type Row=Record<string,unknown>
type Database={from:(table:string)=>unknown;rpc:(name:string,args:Row)=>unknown}
type Query=Record<string,(...args:unknown[])=>unknown>
const sourceTables=new Set(['ediel_messages','user_profiles','company_memberships','inbound_email_messages','inbound_ediel_parse_results'])
const mutators=new Set(['update','insert','upsert','delete'])

/** Declared catalogue transport rows, decoded by the real registry owner. */
export function finiteProdatRulePack(code:string,subtype:string,reason:string){
 const row=ownerRulePack(),profileKey=`PRODAT:${code}:${subtype}:26.A:r3`
 const profile={...row.profile,messageCode:code,transactionSubtype:subtype,reasonForTransaction:reason}
 return {...row,profile_key:profileKey,profile,original_snapshot:{...row.original_snapshot,
  messageProfile:{...row.original_snapshot.messageProfile,profile_key:profileKey,profile}}}
}

export function prodatOwnSourceReadingFixtureDatabase(sdk:ProdatOwnSourceReadingSdk,catalogue:()=>readonly ReturnType<typeof finiteProdatRulePack>[]=()=>[]){
 return prodatOwnSourceReadingAdapter(()=>sdk.scope?sdk:null,{
  from:table=>{throw Error(`UNDECLARED_SOURCE_OWNER_FIXTURE_TABLE:${table}`)},
  rpc:(name,args)=>{
   if(name!=='resolve_canonical_ediel_rule_pack_with_witness_v1')throw Error(`UNDECLARED_SOURCE_OWNER_FIXTURE_RPC:${name}`)
   const rows=catalogue().filter(row=>args.p_market===row.market&&args.p_family===row.family
    &&args.p_message_code===row.profile.messageCode&&args.p_transaction_subtype===row.profile.transactionSubtype
    &&args.p_direction===row.profile.canonicalDirection&&typeof args.p_business_date==='string'&&args.p_business_date>=row.valid_from)
   return Promise.resolve({data:structuredClone(rows),error:null})
  },
 })
}

/** Opt in with an explicitly installed, immutable original. Different source
 * rows, business queries and all writes stay with the existing finite port. */
export function prodatOwnSourceReadingAdapter(read:()=>ProdatOwnSourceReadingSdk|null,database:Database,options:{sourceMessageReads?:boolean}={}):Database {
 return {
  rpc:(name,args)=>{
   const sdk=read(),scope=sdk?.scope
   const ownScope=scope&&args.p_company_id===scope.companyId
   if(sdk&&ownScope&&(name==='gridex_actor_has_company_permission'&&['communication.read','ediel.read'].includes(String(args.p_permission))
    ||['ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1'].includes(name)&&args.p_message_id===scope.sourceMessageId)){
    return sdk.rpc(name,args)
   }
   return database.rpc(name,args)
  },
  from:table=>{
   if(!sourceTables.has(table)||table==='ediel_messages'&&options.sourceMessageReads===false)return database.from(table)
   const calls:{name:string;args:unknown[]}[]=[]
   const execute=(terminal:string,args:unknown[])=>{
    const sdk=read(),scope=sdk?.scope
    const sourceId=calls.find(call=>call.name==='eq'&&call.args[0]==='id')?.args[1]
    const supported=calls.every(call=>['select','eq','not','abortSignal'].includes(call.name))
    const useSdk=sdk&&scope&&supported&&!calls.some(call=>mutators.has(call.name))
     &&(table!=='ediel_messages'||sourceId===scope.sourceMessageId)
    let query=(useSdk?sdk.from(table):database.from(table)) as Query
    for(const call of calls){
     if(useSdk&&call.name==='abortSignal')continue
     query=query[call.name](...call.args) as Query
    }
    return query[terminal](...args)
   }
   const query=new Proxy({} as Query,{get:(_target,name)=>{
    if(typeof name!=='string')return undefined
    if(['single','maybeSingle','then'].includes(name))return (...args:unknown[])=>execute(name,args)
    return (...args:unknown[])=>{calls.push({name,args});return query}
   }})
   return query
  },
 }
}
