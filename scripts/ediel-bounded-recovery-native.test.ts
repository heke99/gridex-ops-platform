// Disposable synthetic coordination fixtures only; real installed V6 owner,
// service-role Data API, GoTrue/JWT actors and two PostgreSQL sessions.
// No business processor, SMTP, provider or fabricated terminal receipt runs.
// Metadata-only UTILTS sources/held rows are declared upstream fixture inputs,
// not canonical business acceptance or retained-original callback qualification.
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'
import {beforeAll,describe,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {decisionNativeSql as sql,decisionUser,literal as lit} from './helpers/ediel-decision-original-native-fixture'
import {nativeLockProcess,nativeLockProcessEnv} from './helpers/native-lock-process'

const migration='supabase/migrations/20261023232112_ediel_bounded_recovery_work.sql'
const migrationHash='b3c0edfc15f5326b28d13530a0675070aeadb87f5bc7730f2087ed1674fdf616'
const migrationSql=readFileSync(migration,'utf8')
type Result={claimed?:Target[];scanned?:number;attempt?:number;state?:string;heldBy?:string}
type Target={companyId:string;sourceMessageId:string;recovery:{workId:string;token:string}}
type Rpc=(name:string,args:Record<string,unknown>)=>{abortSignal(signal:AbortSignal):PromiseLike<{data:Result|null;error:{code?:string;message?:string}|null}>}
const rpc=supabaseService.rpc.bind(supabaseService) as unknown as Rpc
async function request(name:string,args:Record<string,unknown>){return rpc(name,args).abortSignal(AbortSignal.timeout(5000))}
async function call(name:string,args:Record<string,unknown>){const r=await request(name,args);expect(r.error,JSON.stringify(r.error)).toBeNull();expect(r.data).not.toBeNull();return r.data!}
const scope=(company:string,environment='test')=>({p_kind:'held',p_environment:environment,p_company:company})
const transition=(t:Target,operation:string)=>({p_work:t.recovery.workId,p_token:t.recovery.token,p_operation:operation,p_error:null})
function state(t:Target){return sql<{attempts:number;state:string}>(`SELECT jsonb_build_object('attempts',attempts,'state',state) FROM gridex_ediel_recovery.work WHERE id=${lit(t.recovery.workId)}`)}
function source(company:string,environment='test',days=60){
  const id=randomUUID()
  // Let the actual canonical profile trigger resolve E66. Do not manufacture
  // a rule profile, validation assessment, actor grant or operational approval.
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,processing_status,message_received_at,created_at,updated_at)
    VALUES(${lit(id)},${lit(company)},${lit(environment)},'inbound','edifact','UTILTS','E66','processed','processed',clock_timestamp(),clock_timestamp()-make_interval(days=>${days}),clock_timestamp()-interval '1 hour')`)
  return id
}
function held(company:string,id:string,environment='test',fresh=false){
  const ledger=randomUUID()
  sql(`INSERT INTO public.ediel_ack_transaction_results(id,company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,created_at,updated_at)
    VALUES(${lit(ledger)},${lit(company)},${lit(environment)},${lit(id)},${lit('V6_NATIVE_'+ledger)},'positive','positive','pending','internal_review','none',clock_timestamp()-interval '1 day',clock_timestamp()-interval '${fresh?'0 seconds':'1 day'}')`)
  return ledger
}
function tenant(){const id=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(id)},'Synthetic bounded recovery native','active')`);return id}
async function discover(company:string,environment='test'){
  const r=await call('ediel_recovery_discover_v1',{...scope(company,environment),p_page:200,p_grace_seconds:300,p_lookback_hours:1080,p_max_attempts:6})
  expect(r.scanned).toBeLessThanOrEqual(200);return r
}
async function lease(company:string,environment='test'){
  const r=await call('ediel_recovery_lease_v1',{...scope(company,environment),p_exclude:[],p_source_limit:10,p_target_limit:50,p_grace_seconds:300})
  expect(r.scanned).toBeLessThanOrEqual(200);expect(r.claimed!.length).toBeLessThanOrEqual(50);return r.claimed!
}
async function selected(company:string,id:string){
  // Fixed finite cursor allowance; no unbounded "scan until found" fallback.
  for(let page=0;page<4;page++)await discover(company)
  const target=(await lease(company)).find(t=>t.sourceMessageId===id);expect(target).toBeDefined();return target!
}
function terminalEffects(company:string){return sql(`SELECT jsonb_build_object('outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${lit(company)}),'transport',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${lit(company)}),'receipts',(SELECT count(*) FROM gridex_ediel_recovery.terminal_receipts WHERE company_id=${lit(company)}))`)}

beforeAll(()=>{
  expect(createHash('sha256').update(migrationSql).digest('hex')).toBe(migrationHash)
  for(const [name,definer]of [['gridex_ediel_recovery.eligible_v1',false],['public.ediel_recovery_discover_v1',true],['public.ediel_recovery_lease_v1',true],['public.ediel_recovery_transition_v1',true],['public.ediel_recovery_reconcile_v1',true]]as const){
    const start=migrationSql.indexOf('CREATE FUNCTION '+name+'('),bodyStart=migrationSql.indexOf('AS $$',start)+5,bodyEnd=migrationSql.indexOf('$$;',bodyStart)
    expect(start).toBeGreaterThanOrEqual(0);expect(bodyEnd).toBeGreaterThan(bodyStart)
    const body=migrationSql.slice(bodyStart,bodyEnd)
    expect(sql(`SELECT jsonb_build_object('n',count(*),'exact',bool_and(p.prosrc=${lit(body)} AND r.rolname='postgres' AND p.prosecdef=${definer} AND 'search_path=pg_catalog'=ANY(p.proconfig))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname=${lit(name.split('.')[0])} AND p.proname=${lit(name.split('.')[1])}`)).toEqual({n:1,exact:true})
  }
})

describe.sequential('installed V6 bounded recovery coordination',()=>{
  it('uses real service-role admission and refuses anonymous/authenticated JWT callers',async()=>{
    const company=tenant(),actor=await decisionUser(company,['communication.write'],randomUUID()+'Aa1!')
    expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${lit(actor.id)},${lit(company)},'communication.write'))`)).toBe(true)
    const anon=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
    for(const client of [anon,actor.client]){
      const r=await client.rpc('ediel_recovery_discover_v1',scope(company)).abortSignal(AbortSignal.timeout(5000));expect(r.error?.code).toBe('42501');expect(r.data).toBeNull()
    }
    await discover(company)
    const id=source(company);held(company,id);const t=await selected(company,id)
    expect(state(t)).toEqual({attempts:0,state:'leased'})
    await call('ediel_recovery_transition_v1',transition(t,'release'))
    expect(terminalEffects(company)).toEqual({outbox:0,transport:0,receipts:0})
  })
  it('discovers a recent hold on a sixty-day source and rejects mixed held refresh before START with attempt zero',async()=>{
    const company=tenant(),id=source(company);held(company,id);const b=held(company,id),t=await selected(company,id),before=terminalEffects(company)
    expect(sql(`SELECT to_jsonb(created_at<clock_timestamp()-interval '45 days') FROM public.ediel_messages WHERE id=${lit(id)}`)).toBe(true)
    sql(`UPDATE public.ediel_ack_transaction_results SET updated_at=clock_timestamp() WHERE id=${lit(b)}`)
    const start=await request('ediel_recovery_transition_v1',transition(t,'start'));expect(start.error?.message).toContain('ediel_recovery_start_refused')
    expect(state(t)).toEqual({attempts:0,state:'leased'});expect(terminalEffects(company)).toEqual(before)
    await call('ediel_recovery_transition_v1',transition(t,'release'))
  })
  it('rejects a fresh held row inserted after selection without consuming an attempt',async()=>{
    const company=tenant(),id=source(company);held(company,id);const t=await selected(company,id);held(company,id,'test',true)
    const start=await request('ediel_recovery_transition_v1',transition(t,'start'));expect(start.error?.message).toContain('ediel_recovery_start_refused')
    expect(state(t)).toEqual({attempts:0,state:'leased'});await call('ediel_recovery_transition_v1',transition(t,'release'))
  })
  it('does not discover or lease a source through a foreign company or environment',async()=>{
    const company=tenant(),foreign=tenant(),id=source(company);held(company,id)
    await discover(foreign);expect(await lease(foreign)).toEqual([])
    await discover(company,'production');expect(await lease(company,'production')).toEqual([])
    const t=await selected(company,id);expect(t.companyId).toBe(company)
    await call('ediel_recovery_transition_v1',transition(t,'release'))
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_recovery.work WHERE source_id=${lit(id)} AND (company_id<>${lit(company)} OR environment<>'test')`)).toBe(0)
  })
  it('two real sessions cannot START the same leased token twice',async()=>{
    const company=tenant(),id=source(company);held(company,id);const t=await selected(company,id),marker='bounded_start_ready_'+randomUUID().replaceAll('-','')
    const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{env:nativeLockProcessEnv(),stdio:['pipe','pipe','pipe']})
    const lock=nativeLockProcess(child,{marker,markerError:'bounded_start_session_not_ready',lifetimeMs:10000})
    child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ediel_recovery_transition_v1(${lit(t.recovery.workId)},${lit(t.recovery.token)},'start');\n\\echo ${marker}\n`)
    try{
      await lock.ready
      // Session A owns an uncommitted successful START. This authenticated
      // Data API call necessarily uses another PG session and hits its lock.
      const b=await request('ediel_recovery_transition_v1',transition(t,'start'));expect(b.error?.code).toBe('55P03')
      await lock.release('COMMIT')
    }finally{await lock.dispose()}
    expect(state(t)).toEqual({attempts:1,state:'running'})
    const stale=await request('ediel_recovery_transition_v1',transition(t,'start'));expect(stale.error?.message).toContain('ediel_recovery_start_refused')
    expect(state(t)).toEqual({attempts:1,state:'running'});expect(terminalEffects(company)).toEqual({outbox:0,transport:0,receipts:0})
  })
  it('UNCERTAIN is never stolen and canonical actor authorization cannot invent a terminal receipt',async()=>{
    const company=tenant(),foreign=tenant(),id=source(company);held(company,id);const t=await selected(company,id)
    const actor=await decisionUser(company,['communication.write'],randomUUID()+'Aa1!'),other=await decisionUser(foreign,['communication.write'],randomUUID()+'Aa1!')
    await call('ediel_recovery_transition_v1',transition(t,'start'));await call('ediel_recovery_transition_v1',{...transition(t,'uncertain'),p_error:'Declared unknown native fixture outcome'})
    // Only fixture-owned coordination leases expire; no protected source clock
    // or receipt is fabricated. Normal reclaim must still preserve uncertainty.
    sql(`UPDATE gridex_ediel_recovery.source_claims SET lease_until=clock_timestamp()-interval '1 hour' WHERE company_id=${lit(company)} AND source_id=${lit(id)};UPDATE gridex_ediel_recovery.work SET lease_until=clock_timestamp()-interval '1 hour' WHERE id=${lit(t.recovery.workId)}`)
    await lease(company);expect(await lease(company)).toEqual([]);expect(state(t)).toEqual({attempts:1,state:'uncertain'})
    const args={p_work:t.recovery.workId,p_token:t.recovery.token,p_company:company,p_expected_state:'uncertain',p_reason:'Native fixture verifies receipt-less HOLD',p_actor:other.id}
    const denied=await request('ediel_recovery_reconcile_v1',args);expect(denied.error?.message).toContain('ediel_recovery_reconcile_actor_denied')
    expect(await call('ediel_recovery_reconcile_v1',{...args,p_actor:actor.id})).toMatchObject({state:'uncertain',heldBy:'terminal_owner_receipt_missing'})
    expect(state(t)).toEqual({attempts:1,state:'uncertain'});expect(terminalEffects(company)).toEqual({outbox:0,transport:0,receipts:0})
  })
  it('installed cursor and fresh-row indexes bound actual PostgreSQL seeks beyond ten thousand old holds',async()=>{
    const company=tenant(),id=source(company)
    sql(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,created_at,updated_at) SELECT ${lit(company)},'test',${lit(id)},'V6_NATIVE_PLAN_'||g,'positive','positive','pending','internal_review','none',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day' FROM generate_series(1,10000)g`)
    held(company,id,'test',true)
    const fresh=migrationSql.match(/SELECT FROM public\.ediel_ack_transaction_results h WHERE h\.company_id=w\.company_id AND h\.environment=w\.environment AND h\.source_message_id=w\.source_id AND h\.updated_at>=statement_timestamp\(\)-make_interval\(secs=>grace_seconds\) AND h\.disposition='internal_review' AND h\.final_response_type IS NULL AND h\.finalized_at IS NULL AND h\.response_message_id IS NULL/)?.[0];expect(fresh).toBeDefined()
    const cursor=migrationSql.match(/SELECT x\.id,x\.created_at,x\.company_id,x\.source_message_id ediel_message_id[\s\S]*?ORDER BY x\.created_at,x\.id LIMIT p_page/)?.[0];expect(cursor).toBeDefined()
    const queries=[{name:'fresh_native_plan',types:'uuid,text,uuid,integer',query:fresh!.replace('SELECT FROM','SELECT 1 FROM').replaceAll('w.company_id','$1').replaceAll('w.environment','$2').replaceAll('w.source_id','$3').replace('grace_seconds','$4'),args:`${lit(company)},'test',${lit(id)},300`,index:'ediel_recovery_held_source_idx',rows:1},
      {name:'cursor_native_plan',types:'timestamptz,uuid,timestamptz,uuid,integer',query:cursor!.replaceAll('c.position_at','$1').replaceAll('c.position_id','$2').replaceAll('c.high_at','$3').replaceAll('c.high_id','$4').replace('p_page','$5'),args:`clock_timestamp()-interval '45 days','00000000-0000-0000-0000-000000000000',clock_timestamp()-interval '5 minutes','ffffffff-ffff-ffff-ffff-ffffffffffff',200`,index:'ediel_recovery_held_cursor_idx',rows:200}]
    for(const q of queries){
      // Explicit forced-index capability proof, not a claim about the default
      // production planner or index-build duration/locking at production size.
      const plan=sql<Array<{Plan:Record<string,unknown>}>>(`BEGIN;SET LOCAL plan_cache_mode=force_generic_plan;SET LOCAL enable_seqscan=off;PREPARE ${q.name}(${q.types}) AS ${q.query};EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE ${q.name}(${q.args});ROLLBACK;`)
      const nodes:Record<string,unknown>[]=[];const walk=(n:Record<string,unknown>)=>{nodes.push(n);for(const c of(n.Plans??[])as Record<string,unknown>[])walk(c)};walk(plan[0].Plan)
      const scan=nodes.find(n=>n['Index Name']===q.index);expect(scan).toBeDefined();expect(scan!['Actual Rows']).toBeLessThanOrEqual(q.rows);expect(scan!['Rows Removed by Filter']??0).toBe(0)
      if(q.rows===1){expect(scan!['Actual Rows']).toBe(1);for(const key of ['company_id','environment','source_message_id','updated_at'])expect(String(scan!['Index Cond'])).toContain(key)}
    }
  })
})
