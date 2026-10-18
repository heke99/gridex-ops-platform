// Neutral native-only exports; importing this file registers no tests or hooks.
// Phase/Auth source: C03 native84350818 lines125–220. Only exact-instant,
// suite-prefix and observed SQL scope are adapted. No injected product clock.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {nativeSql as sql} from './ediel-normal-switch-native-fixture'

export type PhaseActor = {userId:string;email:string;companyId:string;password:string;permissionKeys:string[]}
export type ClockSnapshot = {
  os:{realtime_ms:number;monotonic_ms:number};node:{realtime_ms:number;monotonic_ms:number}
  postgres_new_transaction:{now_ms:number;statement_ms:number;clock_ms:number;policy_day:string;
    timezone:string;postmaster_started_at:string;system_identifier:string;functions:unknown[]}
}
export type ClockPhaseReceipt = {name:string;target_instant_utc:string;market_start_at:string;
  relation:'strictly-before'|'at-or-after';before:ClockSnapshot;after:ClockSnapshot;
  local_api_auth_date_ms:number;current_authority:PhaseAuthorityReceipt[]}
export type PhaseAuthorityReceipt = {actor_user_id:string;company_id:string;iat:number;exp:number;
  authenticated_current_context:true;permission_keys:string[];phase_auth_readiness:Readiness}
export type Readiness = {attempts:number;exact_future_refusals:number;elapsed_monotonic_ms:number;ready:boolean}
export type ClockPhaseInput = {name:string;targetInstantUtc:string;actors:PhaseActor[];
  relation:{marketStartAt:string;expect:'strictly-before'|'at-or-after'}}
export type SupplyEffectSnapshot = Record<string,unknown>
export type FutureStartNativeReceipt = {schema:'ediel_z04_future_start_native_v1';
  accelerated_execution:true;actual_elapsed_14_days:false;authentic_external_market_history:false;
  whole_approval:false;source:{head:string;tree:string};originals:unknown[];phases:ClockPhaseReceipt[];
  cases:Array<{name:string;status:'PASSED';[key:string]:unknown}>}

/** Independent fixed UTC+1 oracle, not the production date renderer. */
export function marketStartInstant(day:string):string {
  assert.match(day,/^\d{4}-\d{2}-\d{2}$/)
  const midnight=Date.parse(day+'T00:00:00.000Z')
  assert(Number.isFinite(midnight)&&new Date(midnight).toISOString().slice(0,10)===day)
  return new Date(midnight-3600000).toISOString()
}
export function requireBoundary(nowMs:number,startAt:string,relation:'strictly-before'|'at-or-after') {
  const start=Date.parse(startAt)
  assert(Number.isFinite(nowMs)&&Number.isFinite(start),'actual_boundary_clock_required')
  assert(relation==='strictly-before'?nowMs<start:nowMs>=start,'actual_pg_start_boundary_crossed')
}
export async function phaseContextReadiness<T extends {error:{code?:string;message?:string}|null}>(
  read:(signal:AbortSignal)=>PromiseLike<T>,
  ports={monotonic:()=>performance.now(),wait:(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)),signal:(ms:number)=>AbortSignal.timeout(ms)},
) {
  const started=ports.monotonic(),deadline=started+3000
  let context:T|undefined,attempts=0,futureRefusals=0
  while(attempts<30){
    const remaining=deadline-ports.monotonic()
    if(remaining<1)break
    context=await read(ports.signal(Math.floor(Math.min(1000,remaining))));attempts++
    if(context.error?.code!=='PGRST303'||context.error.message!=='JWT issued at future')break
    futureRefusals++
    const left=deadline-ports.monotonic()
    if(left<1||attempts===30)break
    await ports.wait(Math.min(100,left))
  }
  if(!context)throw Error('z04future_phase_auth_readiness_no_response')
  const elapsed=ports.monotonic()-started
  return {context,readiness:{attempts,exact_future_refusals:futureRefusals,elapsed_monotonic_ms:elapsed,ready:context.error===null&&elapsed<=3000}}
}
function freshClaims(claims:{sub?:string;iat?:number;exp?:number},id:string) {
  const now=Date.now()/1000
  assert.equal(claims.sub,id);assert.equal(typeof claims.iat,'number');assert.equal(typeof claims.exp,'number')
  assert(Math.abs(now-claims.iat!)<30);assert(claims.exp!>now);assert(claims.exp!-claims.iat!<=3600)
}
export async function authenticateCurrentPhaseActor(input:PhaseActor):Promise<PhaseAuthorityReceipt> {
  const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  const logged=await client.auth.signInWithPassword({email:input.email,password:input.password})
  assert.equal(logged.error,null);assert.equal(logged.data.user?.id,input.userId)
  const token=logged.data.session?.access_token
  if(!token)throw Error('z04future_actual_current_login_required')
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')) as {sub?:string;iat?:number;exp?:number}
  freshClaims(claims,input.userId)
  const rpcClient=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false},
  })
  const ready=await phaseContextReadiness(signal=>rpcClient.rpc('canonical_authenticated_tenant_context',{
    p_selected_company_id:input.companyId,
  }).abortSignal(signal))
  assert.equal(ready.context.error,null);assert(ready.readiness.ready)
  const context=ready.context.data as {authorized?:boolean;selected_company_id?:string}
  assert.equal(context.authorized,true);assert.equal(context.selected_company_id,input.companyId)
  freshClaims(claims,input.userId)
  for(const key of input.permissionKeys){
    const permission=await rpcClient.rpc('gridex_actor_has_company_permission',{
      p_actor_user_id:input.userId,p_company_id:input.companyId,p_permission:key,
    })
    assert.equal(permission.error,null);assert.equal(permission.data,true)
  }
  await client.auth.signOut({scope:'local'})
  return {actor_user_id:input.userId,company_id:input.companyId,iat:claims.iat!,exp:claims.exp!,
    authenticated_current_context:true,permission_keys:[...input.permissionKeys],phase_auth_readiness:ready.readiness}
}
export function readActualMarketClocks():ClockSnapshot {
  const os=JSON.parse(execFileSync('python3',['-c','import time,json;print(json.dumps({"realtime_ms":time.time_ns()/1000000,"monotonic_ms":time.monotonic_ns()/1000000}))'],{encoding:'utf8',timeout:10000})) as ClockSnapshot['os']
  const pg=sql<ClockSnapshot['postgres_new_transaction']>(`BEGIN;SELECT jsonb_build_object(
    'now_ms',extract(epoch FROM now())*1000,'statement_ms',extract(epoch FROM statement_timestamp())*1000,
    'clock_ms',extract(epoch FROM clock_timestamp())*1000,'policy_day',(clock_timestamp()+interval '1 hour')::date,
    'timezone',current_setting('TimeZone'),'postmaster_started_at',pg_postmaster_start_time(),
    'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.oid::regprocedure::text)
      FROM pg_proc p WHERE p.oid=ANY(ARRAY['public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure,
        'public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'::regprocedure,
        'public.gridex_process_ready_supplier_switch_activations(uuid,integer)'::regprocedure])));COMMIT;`)
  const node={realtime_ms:Date.now(),monotonic_ms:performance.now()}
  for(const t of [os.realtime_ms,Number(pg.now_ms),Number(pg.statement_ms),Number(pg.clock_ms)])assert(Math.abs(node.realtime_ms-t)<5000)
  assert.equal(pg.functions.length,3)
  return {os,node,postgres_new_transaction:pg}
}
export async function advanceProspectiveMarketPhase(input:ClockPhaseInput):Promise<ClockPhaseReceipt> {
  const path=process.env.GRIDEX_Z04_FUTURE_CLOCK_CONTROL,controller=process.env.GRIDEX_Z04_FUTURE_CLOCK_CONTROLLER_SCRIPT
  if(!path||!controller)throw Error('z04future_owned_clock_controller_required')
  const control=JSON.parse(readFileSync(path,'utf8')) as {admitted?:boolean;mode?:string;deadline_monotonic_ms?:number}
  assert.equal(control.admitted,true);assert.equal(control.mode,'native');assert(control.deadline_monotonic_ms)
  const before=readActualMarketClocks(),target=Date.parse(input.targetInstantUtc)
  assert(Number.isFinite(target)&&target>before.node.realtime_ms)
  assert(before.os.monotonic_ms<control.deadline_monotonic_ms)
  const change=JSON.parse(execFileSync('python3',[controller,'--advance',String(target/1000)],{encoding:'utf8',timeout:20000})) as {target_realtime_ms:number;shared_restore_lock:boolean}
  assert.equal(change.target_realtime_ms,target);assert.equal(change.shared_restore_lock,true)
  const after=readActualMarketClocks()
  requireBoundary(Number(after.postgres_new_transaction.clock_ms),input.relation.marketStartAt,input.relation.expect)
  const health=await fetch('http://127.0.0.1:54321/auth/v1/health',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}})
  assert(health.ok)
  const apiDate=Date.parse(health.headers.get('date')??'')
  assert(Number.isFinite(apiDate)&&Math.abs(Date.now()-apiDate)<5000)
  const authority=[]
  for(const actor of input.actors)authority.push(await authenticateCurrentPhaseActor(actor))
  return {name:input.name,target_instant_utc:input.targetInstantUtc,market_start_at:input.relation.marketStartAt,
    relation:input.relation.expect,before,after,local_api_auth_date_ms:apiDate,current_authority:authority}
}
