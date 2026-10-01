const {PGlite}=require('@electric-sql/pglite')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const A='ea710000-0000-4000-8000-000000000001',B='ea710000-0000-4000-8000-000000000002'
async function createResumeCore(){
 const db=new PGlite()
 const original=readFileSync(resolve(__dirname,'../supabase/migrations/20260625110000_ediel_message_intents_foundation.sql'),'utf8')
 const ddl=original.slice(original.indexOf('create table if not exists public.ediel_message_intents'),original.indexOf('alter table public.ediel_message_intents enable row level security'))
 assert(ddl.includes('ediel_message_intents_direction_chk')&&ddl.includes('ediel_message_intents_idempotency_uidx'))
 await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema private;create table public.companies(id uuid primary key,status text default 'active');create table public.ediel_messages(id uuid primary key);create table public.outbound_requests(id uuid primary key);${ddl}
 insert into public.companies(id) values('${A}'),('${B}');grant usage on schema public,private to service_role;grant select,insert,update on all tables in schema public to service_role;`)
 const columns=new Set((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='ediel_message_intents'")).rows.map(row=>row.column_name))
 await db.exec(readFileSync(resolve(__dirname,'../supabase/migrations/20261001012959_ediel_resume_tenant_fair_claim.sql'),'utf8'))
 await db.exec('set role service_role')
 const reads=[],writes=[]
 const identifier=key=>{assert(columns.has(key),`unexpected column ${key}`);return key}
 const jsonValue=value=>value&&typeof value==='object'&&!(value instanceof Date)?JSON.stringify(value):value
 const normalize=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])))
 const service={rpc:async(name,args)=>{
  const definitions={gridex_claim_ediel_resume_intents_fair_v1:['p_phase','p_company_id','p_limit','p_claim_token'],gridex_check_ediel_resume_claim_v1:['p_company_id','p_intent_id','p_phase','p_claim_token'],gridex_finish_ediel_resume_claim_v1:['p_company_id','p_intent_id','p_phase','p_claim_token','p_outcome','p_reason']}
  assert(definitions[name],`unexpected RPC ${name}`)
  const keys=definitions[name],values=keys.map(key=>args[key])
  try{return {data:(await db.query(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values)).rows[0].result,error:null}}catch(error){return {data:null,error:{code:error.code,message:error.message}}}
 },from:table=>{
  assert.equal(table,'ediel_message_intents','zero other database/transport surface allowed')
  const filters=[],ordering=[];let maximum=null,projection='*',update=null,single=false
  const q={
   select:fields=>{projection=fields==='*'?'*':fields.split(',').map(identifier).join(',');return q},
   eq:(key,value)=>{filters.push([identifier(key),'=',value]);return q},
   in:(key,value)=>{filters.push([identifier(key),'in',value]);return q},
   is:(key,value)=>{assert.equal(value,null);filters.push([identifier(key),'null',null]);return q},
   order:(key,{ascending})=>{ordering.push(`${identifier(key)} ${ascending?'ASC':'DESC'}`);return q},
   limit:value=>{assert(Number.isSafeInteger(value)&&value>0&&value<=50);maximum=value;return q},
   update:value=>{assert(Object.keys(value).every(key=>columns.has(key)));update=value;return q},
   maybeSingle:()=>{single=true;return q},
   then:(resolve,reject)=>execute().then(resolve,reject),
  }
  async function execute(){
   const values=[]
   const parameter=(value,raw=false)=>{values.push(raw?value:jsonValue(value));return '$'+values.length}
   const clauses=()=>filters.map(([key,operator,value])=>operator==='null'?`${key} IS NULL`:operator==='in'?`${key}=ANY(${parameter(value,true)}::text[])`:`${key}=${parameter(value)}`)
   try{
    let statement
    if(update){const set=Object.entries(update).map(([key,value])=>`${key}=${parameter(value)}`).join(',');statement=`UPDATE public.ediel_message_intents SET ${set} WHERE ${clauses().join(' AND ')} RETURNING ${projection}`}
    else statement=`SELECT ${projection} FROM public.ediel_message_intents${filters.length?' WHERE '+clauses().join(' AND '):''}${ordering.length?' ORDER BY '+ordering.join(','):''}${maximum?' LIMIT '+maximum:''}`
    const result=normalize((await db.query(statement,values)).rows)
    ;(update?writes:reads).push({statement,values,rows:result})
    return {data:single?result[0]??null:result,error:null}
   }catch(error){return {data:null,error:{code:error.code,message:error.message}}}
  }
  return q
 }}
 async function seed(phase,noisy=250,quiet=1){
  assert(['validated','draft'].includes(phase))
  const ids={A:[],B:[]}
  for(const [company,count,at,key] of[[A,noisy,'2026-01-01T00:00:00Z','A'],[B,quiet,'2026-01-02T00:00:00Z','B']]){
   for(let i=0;i<count;i++){
    const id=randomUUID();ids[key].push(id)
    await db.query(`insert into public.ediel_message_intents(id,company_id,message_family,message_code,business_process,sender_ediel_id,receiver_ediel_id,
      application_reference,interchange_reference,message_reference,idempotency_key,validation_status,updated_at)
      values($1::uuid,$2::uuid,'PRODAT','Z01','customer_masterdata','12345','23456','synthetic-local-only',($1::uuid)::text,($1::uuid)::text,($1::uuid)::text,$3,$4)`,[id,company,phase,at])
   }
  }
  return ids
 }
 const counts=async()=> (await db.query("select company_id,validation_status,count(*)::int as total from public.ediel_message_intents group by company_id,validation_status order by company_id,validation_status")).rows
 return {db,service,seed,counts,reads,writes,A,B}
}
module.exports={createResumeCore}
