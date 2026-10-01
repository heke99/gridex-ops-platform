import {randomUUID}from'node:crypto'
import {afterEach,describe,expect,it,vi}from'vitest'
import {quote,session,sql,until}from'./partner-queue-continuation-20260930-native'
vi.mock('server-only',()=>({}))
import {resumeStuckEdielIntents}from'@/lib/ediel/intent/resumeStuckIntents'

type Claim={intent:{id:string;company_id:string;updated_at:string},phase:'validated'|'draft';claimToken:string;expiresAt:string}
const owned:string[]=[]
function fixture(phase:'validated'|'draft',noisy=250,quiet=1){
 const A=randomUUID(),B=randomUUID();owned.push(A,B)
 sql(`insert into companies(id,name,status)values(${quote(A)},'Synthetic noisy resume tenant','active'),(${quote(B)},'Synthetic quiet resume tenant','active');
  insert into ediel_message_intents(company_id,message_family,message_code,business_process,sender_ediel_id,receiver_ediel_id,
   application_reference,interchange_reference,message_reference,idempotency_key,validation_status,updated_at)
  select ${quote(A)},'PRODAT','Z01','customer_masterdata','12345','23456','synthetic-local-only',gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
   ${quote(phase)},clock_timestamp()-interval '2 hours'from generate_series(1,${noisy});
  insert into ediel_message_intents(company_id,message_family,message_code,business_process,sender_ediel_id,receiver_ediel_id,
   application_reference,interchange_reference,message_reference,idempotency_key,validation_status,updated_at)
  select ${quote(B)},'PRODAT','Z01','customer_masterdata','12345','23456','synthetic-local-only',gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
   ${quote(phase)},clock_timestamp()-interval '1 hour'from generate_series(1,${quiet});select to_jsonb(true);`)
 return {A,B}
}
const claimCommand=(phase:'validated'|'draft',limit:number,company:string|null,token:string)=>
 `select public.gridex_claim_ediel_resume_intents_fair_v1(${quote(phase)},${company?quote(company):'null'}::uuid,${limit},${quote(token)}::uuid);`
const claim=(phase:'validated'|'draft',limit=25,company:string|null=null,token=randomUUID())=>
 sql<Claim[]>(`set role service_role;${claimCommand(phase,limit,company,token)}`)
const check=(c:Claim,token=c.claimToken)=>sql<boolean>(`set role service_role;select to_jsonb(public.gridex_check_ediel_resume_claim_v1(
 ${quote(c.intent.company_id)},${quote(c.intent.id)},${quote(c.phase)},${quote(token)}));`)
const finishCommand=(c:Claim,token=c.claimToken)=>`select to_jsonb(public.gridex_finish_ediel_resume_claim_v1(
 ${quote(c.intent.company_id)},${quote(c.intent.id)},${quote(c.phase)},${quote(token)},'processed',null));`
const finish=(c:Claim,token=c.claimToken)=>sql<boolean>(`set role service_role;${finishCommand(c,token)}`)
const snapshot=(companies:string[])=>sql<Record<string,unknown>>(`select jsonb_build_object(
 'intents',(select jsonb_agg(to_jsonb(i)order by id)from ediel_message_intents i where company_id in(${companies.map(quote).join(',')})),
 'claims',(select jsonb_agg(to_jsonb(i)order by intent_id)from private.ediel_resume_claims i where company_id in(${companies.map(quote).join(',')})),
 'turns',(select jsonb_agg(to_jsonb(i)order by phase,company_id)from private.ediel_resume_tenant_turns i where company_id in(${companies.map(quote).join(',')})),
 'messages',(select count(*)from ediel_messages where company_id in(${companies.map(quote).join(',')})),
 'requests',(select count(*)from outbound_requests where company_id in(${companies.map(quote).join(',')})),
 'outbox',(select count(*)from ediel_outbox where company_id in(${companies.map(quote).join(',')})));`)
afterEach(()=>{
 // Delete only fixture-owned transient intents/leases/turns. Company/legal
 // history stays intact until disposable-stack teardown, guards stay enabled.
 if(owned.length)sql(`delete from ediel_message_intents where company_id in(${owned.map(quote).join(',')});
  delete from private.ediel_resume_tenant_turns where company_id in(${owned.map(quote).join(',')});select to_jsonb(true);`)
 owned.length=0
})
describe.sequential('genuine fair resume claims with canonical preparation blocked, no external dispatch',()=>{
 it('both global phases cap noisy work and persist actual limit-one tenant turns',()=>{
  for(const phase of['validated','draft']as const){
   expect(sql<number>(`select count(*)::int from ediel_message_intents i join companies c on c.id=i.company_id
    where c.status in('active','onboarding')and private.gridex_ediel_resume_phase_eligible_v1(i,${quote(phase)});`)).toBe(0)
   const f=fixture(phase),before=snapshot([f.A,f.B]),rows=claim(phase,100)
   expect(rows.filter(c=>c.intent.company_id===f.A)).toHaveLength(5);expect(rows.filter(c=>c.intent.company_id===f.B)).toHaveLength(1)
   expect(snapshot([f.A,f.B]).intents).toEqual(before.intents)
   for(const c of rows)expect(finish(c)).toBe(true)
   expect(claim(phase,1)[0].intent.company_id).toBe(f.A);expect(claim(phase,1)[0].intent.company_id).toBe(f.B)
   sql(`delete from ediel_message_intents where company_id in(${quote(f.A)},${quote(f.B)});delete from private.ediel_resume_tenant_turns where company_id in(${quote(f.A)},${quote(f.B)});select to_jsonb(true);`)
  }
 })
 it('actual company-bound engine preserves noisy rows and canonical blocked guards with zero message/request/outbox effects',async()=>{
  for(const phase of['validated','draft']as const){
   const f=fixture(phase),before=snapshot([f.A,f.B]),result=await resumeStuckEdielIntents({companyId:f.B,limit:25})
   expect(result).toMatchObject({candidates:1,blocked:1,resumed:0,errors:[]})
   expect(sql<Record<string,unknown>[]>(`select coalesce(jsonb_agg(to_jsonb(i)order by id),'[]'::jsonb)from ediel_message_intents i where company_id=${quote(f.A)};`))
    .toEqual((before.intents as Array<{company_id:string}>).filter(i=>i.company_id===f.A))
   expect(snapshot([f.A,f.B])).toMatchObject({messages:0,requests:0,outbox:0})
   expect(sql<string>(`select to_jsonb(validation_status)from ediel_message_intents where company_id=${quote(f.B)};`)).toBe('blocked')
  }
 })
 it('current company, phase, stamp, token and expiry are rechecked; frontend/private grants deny',()=>{
  const f=fixture('validated',0,1),c=claim('validated',1,f.B)[0],before=snapshot([f.A,f.B])
  expect(check(c)).toBe(true);expect(check(c,randomUUID())).toBe(false);expect(finish(c,randomUUID())).toBe(false);expect(snapshot([f.A,f.B])).toEqual(before)
  expect(sql<boolean>(`set role service_role;select to_jsonb(public.gridex_check_ediel_resume_claim_v1(${quote(f.B)},${quote(c.intent.id)},'draft',${quote(c.claimToken)}));`)).toBe(false)
  sql(`update ediel_message_intents set updated_at=clock_timestamp()where id=${quote(c.intent.id)};select to_jsonb(true);`)
  expect(check(c)).toBe(false)
  sql(`update private.ediel_resume_claims set claimed_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute'where intent_id=${quote(c.intent.id)};select to_jsonb(true);`)
  const next=claim('validated',1,f.B)[0],reclaimed=snapshot([f.A,f.B])
  expect(next.claimToken).not.toBe(c.claimToken);expect(check(next)).toBe(true)
  expect(check(c)).toBe(false);expect(finish(c)).toBe(false);expect(snapshot([f.A,f.B])).toEqual(reclaimed)
  sql(`update companies set status='paused'where id=${quote(f.B)};select to_jsonb(true);`)
  expect(check(next)).toBe(false);expect(finish(next)).toBe(false);expect(claim('validated',1,f.B)).toEqual([])
  for(const role of['anon','authenticated']){
   expect(()=>sql(`set role ${role};${claimCommand('validated',1,f.B,randomUUID())}`)).toThrow(/permission denied/)
   expect(()=>sql(`set role ${role};select public.gridex_check_ediel_resume_claim_v1(${quote(f.B)},${quote(c.intent.id)},'validated',${quote(c.claimToken)});`)).toThrow(/permission denied/)
   expect(()=>sql(`set role ${role};${finishCommand(c)}`)).toThrow(/permission denied/)
   expect(sql<boolean>(`select to_jsonb(has_table_privilege(${quote(role)},'private.ediel_resume_claims','SELECT')or has_table_privilege(${quote(role)},'private.ediel_resume_claims','INSERT'));`)).toBe(false)
  }
  expect(sql<boolean>(`select to_jsonb(has_table_privilege('service_role','private.ediel_resume_claims','DELETE')or has_table_privilege('service_role','private.ediel_resume_claims','TRUNCATE'));`)).toBe(false)
 })
 it('two actual transactions return disjoint claims after observing private-turn wait',async()=>{
  expect(sql<number>(`select count(*)::int from ediel_message_intents i join companies c on c.id=i.company_id where c.status in('active','onboarding')and private.gridex_ediel_resume_phase_eligible_v1(i,'validated');`)).toBe(0)
  fixture('validated',20,20)
  const firstName='resume_first_'+randomUUID(),first=session(firstName),name='resume_second_'+randomUUID(),second=session(name)
  try{
   first.child.stdin.write(`begin;set local role service_role;${claimCommand('validated',2,null,randomUUID())}\n\\echo RESUME_FIRST_HELD\n`)
   await until(()=>first.output().stdout.includes('RESUME_FIRST_HELD'),'resume_first_not_held')
   second.child.stdin.end(`set role service_role;${claimCommand('validated',2,null,randomUUID())}`)
   await until(()=>sql<boolean>(`select to_jsonb(exists(select 1 from pg_stat_activity blocked
    cross join lateral unnest(pg_blocking_pids(blocked.pid)) as blocking(pid)
    join pg_stat_activity blocker on blocker.pid=blocking.pid
    where blocked.application_name=${quote(name)}and blocked.wait_event_type='Lock'and blocker.application_name=${quote(firstName)}));`),'resume_second_not_waiting_for_first')
   first.child.stdin.end('commit;\n');expect(await first.exited,first.output().stderr).toBe(0);expect(await second.exited,second.output().stderr).toBe(0)
   const a=JSON.parse(first.output().stdout.split('\n').find(s=>s.startsWith('['))!)as Claim[],b=JSON.parse(second.output().stdout.trim())as Claim[]
   expect(a).toHaveLength(2);expect(b).toHaveLength(2);expect(b.every(c=>!a.some(i=>i.intent.id===c.intent.id))).toBe(true)
  }finally{for(const c of[first,second])if(c.child.exitCode===null)c.child.kill('SIGTERM');await Promise.allSettled([first.exited,second.exited])}
 })
 it('actual server lease UPSERT protects a fresh competitor token and the exact expiry cutoff',()=>{
  const f=fixture('validated',1,0),c=claim('validated',1,f.A)[0],at='2026-10-01T00:00:00Z',token=randomUUID()
  const source=sql<string>(`select to_jsonb(pg_get_functiondef('public.gridex_claim_ediel_resume_intents_fair_v1(text,uuid,integer,uuid)'::regprocedure));`)
  const fragment=source.match(/\), leases as\(([\s\S]*?)\n \), turns as\(/)?.[1];expect(fragment).toBeTruthy()
  sql(`update private.ediel_resume_claims set claimed_at=${quote(at)}::timestamptz-interval '1 minute',expires_at=${quote(at)}::timestamptz where intent_id=${quote(c.intent.id)};select to_jsonb(true);`)
  const concrete=fragment!.replaceAll('p_phase',"'validated'").replaceAll('p_claim_token',quote(token)+'::uuid').replaceAll('v_now',quote(at)+'::timestamptz')
  const command=`with chosen as(select id,company_id,updated_at from ediel_message_intents where id=${quote(c.intent.id)}),leases as(${concrete})select count(*)::int from leases;`
  expect(sql<number>(`set role service_role;${command}`)).toBe(0)
  expect(sql<string>(`select to_jsonb(claim_token)from private.ediel_resume_claims where intent_id=${quote(c.intent.id)};`)).toBe(c.claimToken)
  sql(`update private.ediel_resume_claims set expires_at=expires_at-interval '1 microsecond'where intent_id=${quote(c.intent.id)};select to_jsonb(true);`)
  expect(sql<number>(`set role service_role;${command}`)).toBe(1);expect(check(c)).toBe(false);expect(finish(c)).toBe(false)
 })
 it('a late tenant-turn write fault rolls every actual claim and turn back',()=>{
  const f=fixture('validated',1,1),before=snapshot([f.A,f.B]),fault='resume_turn_'+randomUUID().replaceAll('-','')
  try{
   sql(`create function private.${fault}()returns trigger language plpgsql as $fault$begin if new.company_id=${quote(f.B)}then raise exception 'synthetic_resume_turn_fault';end if;return new;end;$fault$;
    create trigger ${fault} before insert or update on private.ediel_resume_tenant_turns for each row execute function private.${fault}();select to_jsonb(true);`)
   expect(()=>claim('validated',25)).toThrow(/synthetic_resume_turn_fault/);expect(snapshot([f.A,f.B])).toEqual(before)
  }finally{sql(`drop trigger if exists ${fault} on private.ediel_resume_tenant_turns;drop function if exists private.${fault}();select to_jsonb(true);`)}
 })
 it('final completion expiry reaches its sleep witness and rolls its lease write back',()=>{
  const f=fixture('validated',0,1),c=claim('validated',1,f.B)[0],fault='resume_expiry_'+randomUUID().replaceAll('-',''),witness=fault+'_hit'
  try{
   sql(`create sequence private.${witness};revoke all on sequence private.${witness} from public;grant usage on sequence private.${witness} to service_role;
    create function private.${fault}()returns trigger language plpgsql as $fault$begin if new.intent_id=${quote(c.intent.id)}and new.finished_at is not null then perform nextval('private.${witness}'::regclass);perform pg_sleep(0.6);end if;return new;end;$fault$;
    create trigger ${fault} before update on private.ediel_resume_claims for each row execute function private.${fault}();select to_jsonb(true);`)
   const before=snapshot([f.A,f.B])
   expect(()=>sql(`begin;update private.ediel_resume_claims set claimed_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '0.4 seconds'where intent_id=${quote(c.intent.id)};
    set local role service_role;${finishCommand(c)}commit;`)).toThrow(/ediel_resume_claim_expired/)
   expect(sql<{called:boolean;calls:number}>(`select jsonb_build_object('called',is_called,'calls',last_value)from private.${witness};`)).toEqual({called:true,calls:1})
   expect(snapshot([f.A,f.B])).toEqual(before)
  }finally{sql(`drop trigger if exists ${fault} on private.ediel_resume_claims;drop function if exists private.${fault}();drop sequence if exists private.${witness};select to_jsonb(true);`)}
 })
})
