/* eslint-disable @typescript-eslint/no-require-imports -- Standalone owned-business PostgreSQL core test. */
// Full owned SQL + exact current manual-mail DDL/canonical email policy.
// Focused PostgreSQL core, not complete Supabase/native/transport acceptance.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const schema=readFileSync(resolve(__dirname,'../supabase/schema.sql'),'utf8')
const migration=readFileSync(resolve(__dirname,'../supabase/migrations/20261001043743_manual_email_tenant_fair_atomic_claim.sql'),'utf8')
const id=n=>`e6110000-0000-4000-8000-${String(n).padStart(12,'0')}`
function table(name){const value=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(value,name);return value}
function fn(name){const start=schema.indexOf('CREATE FUNCTION public.'+name+'(');assert.ok(start>=0,name);return schema.slice(start,schema.indexOf('\n--\n',start))}
async function fixture({candidate=true,capabilityOnly=false}={}){
 const db=new PGlite();await db.exec(`create schema private;create role service_role bypassrls;create role anon;create role authenticated;
  create table public.companies(id uuid primary key,status text,ediel_production_status text,production_status text,lifecycle_state_version bigint default 1);
  create table public.integration_api_clients(id uuid primary key,company_id uuid,status text,profile_key text);
  ${table('company_capabilities')}
  ${table('manual_email_outbox')}
  alter table public.manual_email_outbox add primary key(id);
  ${fn('canonical_tenant_operation_decision')}
  insert into public.companies(id,status)values('${id(1)}','active'),('${id(2)}','active'),('${id(3)}','paused');
  insert into public.integration_api_clients values('${id(11)}','${id(1)}','active','tenant_website'),('${id(12)}','${id(2)}','active','tenant_website'),('${id(13)}','${id(3)}','active','tenant_website');
  grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;`)
 if(capabilityOnly)await db.exec(`delete from public.integration_api_clients;
  insert into public.company_capabilities(company_id,capability_code,enabled,readiness_status,configuration)
  values('${id(1)}','email_outbound',true,'ready','{"synthetic_controlled_outer_transport":true,"physical_delivery_qualified":false}'),
        ('${id(2)}','email_outbound',true,'ready','{"synthetic_controlled_outer_transport":true,"physical_delivery_qualified":false}'),
        ('${id(3)}','email_outbound',true,'ready','{"synthetic_controlled_outer_transport":true,"physical_delivery_qualified":false}');`)
 if(candidate)await db.exec(migration)
 async function seed(noisy=250,quiet=1){await db.exec(`insert into public.manual_email_outbox(company_id,to_email,actual_recipient_email,from_email,subject,external_delivery,idempotency_key,queued_at,next_attempt_at)
  select '${id(1)}','recipient@example.invalid','recipient@example.invalid','sender@example.invalid','Synthetic unsent',true,'A-'||g,now()-interval'2hours',now()-interval'1hour'from generate_series(1,${noisy})g;
  insert into public.manual_email_outbox(company_id,to_email,actual_recipient_email,from_email,subject,external_delivery,idempotency_key,queued_at,next_attempt_at)
  select '${id(2)}','recipient@example.invalid','recipient@example.invalid','sender@example.invalid','Synthetic quiet',true,'B-'||g,now()-interval'1hour',now()-interval'1hour'from generate_series(1,${quiet})g;`)}
 async function claim(limit=25,company=null,token=id(90)){await db.exec('set role service_role');try{return(await db.query('select * from public.gridex_claim_manual_email_outbox_fair_v1($1::uuid,$2,$3,$4::uuid)',[company,limit,'controlled-worker',token])).rows.map(x=>x.gridex_claim_manual_email_outbox_fair_v1)}finally{await db.exec('reset role')}}
 const state=async()=>{const rows=(await db.query('select to_jsonb(o)as row from public.manual_email_outbox o order by id')).rows.map(x=>x.row);const exists=(await db.query("select to_regclass('private.manual_email_dispatch_tenant_turns')is not null as ok")).rows[0].ok;return {rows,turns:exists?(await db.query('select * from private.manual_email_dispatch_tenant_turns order by company_id')).rows:[],claims:exists?(await db.query('select to_jsonb(l)-\'payload_sha256\'||jsonb_build_object(\'payload_sha256\',encode(payload_sha256,\'hex\'))as row from private.manual_email_dispatch_claims l order by item_id')).rows:[]}}
 return{db,seed,claim,state}
}
test('current original delivery-status DDL must support the actual worker uncertain business outcome',async()=>{
 const f=await fixture({candidate:process.env.GRIDEX_MANUAL_EMAIL_BASELINE!=='1'});try{await f.seed(1,0)
  try{await f.db.exec("update public.manual_email_outbox set status='delivery_uncertain',delivery_status='delivery_uncertain',next_attempt_at=null")}
  catch(error){assert.equal(error.code,'23514');throw Object.assign(new Error('manual_uncertain_business_outcome_rejected_23514'),{code:error.code})}
 }finally{await f.db.close()}
})
test('actual owned SQL includes later quiet tenant, caps noisy5 and persists both turns',async()=>{
 const f=await fixture();try{await f.seed();const rows=await f.claim();assert.equal(rows.filter(x=>x.company_id===id(1)).length,5);assert.equal(rows.filter(x=>x.company_id===id(2)).length,1)
  assert.equal((await f.state()).turns.length,2);assert.ok(rows.every(x=>x.status==='sending'&&x.locked_by==='controlled-worker'&&x.claim_token===id(90)))
 }finally{await f.db.close()}
})
test('limit-one claims rotate persisted tenant turns and exact selected company preserves other rows',async()=>{
 const f=await fixture();try{await f.seed(20,3);assert.equal((await f.claim(1))[0].company_id,id(1));assert.equal((await f.claim(1,null,id(91)))[0].company_id,id(2))
  const other=(await f.state()).rows.filter(x=>x.company_id===id(2));const selected=await f.claim(25,id(1),id(92));assert.equal(selected.length,5);assert.deepEqual((await f.state()).rows.filter(x=>x.company_id===id(2)),other)
 }finally{await f.db.close()}
})
test('actual canonical policy excludes a paused tenant before slots while a quiet active tenant still progresses',async()=>{
 const f=await fixture();try{await f.seed();await f.db.exec(`update public.companies set status='paused'where id='${id(1)}'`);const before=(await f.state()).rows.filter(x=>x.company_id===id(1));const rows=await f.claim();assert.equal(rows.length,1);assert.equal(rows[0].company_id,id(2));assert.deepEqual((await f.state()).rows.filter(x=>x.company_id===id(1)),before)
 }finally{await f.db.close()}
})
test('a late actual turn failure rolls every claim/status/lease effect back',async()=>{
 const f=await fixture();try{await f.seed();await f.db.exec("create function private.manual_late_fault()returns trigger language plpgsql as $$begin raise exception 'controlled_late_turn_failure'using errcode='P0001';end$$;create trigger manual_late_fault before insert on private.manual_email_dispatch_tenant_turns for each row execute function private.manual_late_fault()")
  const before=await f.state();await assert.rejects(f.claim(),e=>e.code==='P0001');assert.deepEqual(await f.state(),before)
 }finally{await f.db.close()}
})
test('immutable payload change prevents actual completion and preserves every row',async()=>{
 const f=await fixture();try{await f.seed(1,0);const row=(await f.claim())[0];await f.db.exec(`update public.manual_email_outbox set subject='Current replacement'where id='${row.id}'`);const before=await f.state();await f.db.exec('set role service_role')
  const checked=await f.db.query('select * from public.gridex_recheck_manual_email_claim_v1($1::uuid,$2::uuid,$3,$4::uuid)',[row.company_id,row.id,'controlled-worker',id(90)]);assert.equal(checked.rows.length,0)
  const done=await f.db.query('select public.gridex_finish_manual_email_claim_v1($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)as ok',[row.company_id,row.id,'controlled-worker',id(90),JSON.stringify({status:'sent',delivery_status:'sent',provider_message_id:'controlled-receipt',attempts:1})]);assert.equal(done.rows[0].ok,false);await f.db.exec('reset role');assert.deepEqual(await f.state(),before)
 }finally{await f.db.close()}
})
test('fresh current leases cannot consume stale-recovery tenant slots ahead of eligible quiet work',async()=>{
 const f=await fixture();try{await f.seed(1,1);const rows=await f.claim(1,id(1));assert.equal(rows.length,1)
  await f.db.exec("update public.manual_email_outbox set status='sending',locked_at=now()-interval'20minutes',locked_by='controlled-worker'")
  const before=(await f.state()).rows.filter(x=>x.company_id===id(1));await f.db.exec('set role service_role')
  const recovered=(await f.db.query('select * from public.gridex_recover_stale_manual_email_outbox_v1(null,1)')).rows.map(x=>x.gridex_recover_stale_manual_email_outbox_v1)
  await f.db.exec('reset role');assert.equal(recovered.length,1);assert.equal(recovered[0].company_id,id(2));assert.deepEqual((await f.state()).rows.filter(x=>x.company_id===id(1)),before)
 }finally{await f.db.close()}
})
test('expiry reached during an actual completion trigger rolls status and lease effects back',async()=>{
 const f=await fixture();try{await f.seed(1,0);const row=(await f.claim())[0]
  await f.db.exec("create function private.manual_completion_expiry()returns trigger language plpgsql as $$begin if new.status='sent'then update private.manual_email_dispatch_claims set expires_at=clock_timestamp()-interval'1second'where item_id=new.id;end if;return new;end$$;create trigger manual_completion_expiry after update on public.manual_email_outbox for each row execute function private.manual_completion_expiry()")
  const before=await f.state();await f.db.exec('set role service_role');await assert.rejects(f.db.query('select public.gridex_finish_manual_email_claim_v1($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)',[row.company_id,row.id,'controlled-worker',id(90),JSON.stringify({status:'sent',delivery_status:'sent',provider_message_id:'controlled-receipt',attempts:1})]),e=>e.code==='40001')
  await f.db.exec('reset role');assert.deepEqual(await f.state(),before)
 }finally{await f.db.close()}
})
test('a retry completion requires the next exact attempt and a future retry boundary',async()=>{
 const f=await fixture();try{await f.seed(1,0);const row=(await f.claim())[0];const before=await f.state();await f.db.exec('set role service_role')
  await assert.rejects(f.db.query('select public.gridex_finish_manual_email_claim_v1($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)',[row.company_id,row.id,'controlled-worker',id(90),JSON.stringify({status:'queued',delivery_status:'queued'})]),e=>e.code==='22023')
  await f.db.exec('reset role');assert.deepEqual(await f.state(),before)
 }finally{await f.db.close()}
})
test('queued non-external, future and terminal rows never enter the actual due claim',async()=>{
 const f=await fixture();try{await f.seed(1,3);await f.db.exec(`update public.manual_email_outbox set external_delivery=false where company_id='${id(1)}';update public.manual_email_outbox set next_attempt_at=clock_timestamp()+interval'1day'where idempotency_key='B-1';update public.manual_email_outbox set status='failed',delivery_status='failed'where idempotency_key='B-2';update public.manual_email_outbox set status='sent',delivery_status='sent'where idempotency_key='B-3'`)
  const before=await f.state();assert.deepEqual(await f.claim(100),[]);assert.deepEqual(await f.state(),before)
 }finally{await f.db.close()}
})
test('a valid retry saves one exact attempt, ends its lease and replay has no further effect',async()=>{
 const f=await fixture();try{await f.seed(1,0);const row=(await f.claim())[0];const patch={status:'queued',delivery_status:'queued',attempts:1,next_attempt_at:new Date(Date.now()+300000).toISOString(),last_error:'Controlled failure',last_error_code:'send_retry'}
  await f.db.exec('set role service_role');const complete=()=>f.db.query('select public.gridex_finish_manual_email_claim_v1($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)as ok',[row.company_id,row.id,'controlled-worker',id(90),JSON.stringify(patch)])
  assert.equal((await complete()).rows[0].ok,true);await f.db.exec('reset role');const saved=await f.state();assert.equal(saved.rows[0].attempts,1);assert.equal(saved.rows[0].status,'queued');assert.equal(saved.rows[0].locked_by,null);assert.ok(saved.claims[0].row.finished_at)
  await f.db.exec('set role service_role');assert.equal((await complete()).rows[0].ok,false);await f.db.exec('reset role');assert.deepEqual(await f.state(),saved);assert.deepEqual(await f.claim(100),[])
 }finally{await f.db.close()}
})
test('stale recovery caps noisy tenant5, progresses quiet tenant and never queues uncertain delivery',async()=>{
 const f=await fixture();try{await f.seed(30,2);await f.db.exec("update public.manual_email_outbox set status='sending',locked_at=clock_timestamp()-interval'20minutes',locked_by='controlled-stale-worker'")
  await f.db.exec('set role service_role');const recover=async()=> (await f.db.query('select * from public.gridex_recover_stale_manual_email_outbox_v1(null,25)')).rows.map(x=>x.gridex_recover_stale_manual_email_outbox_v1)
  const first=await recover();assert.equal(first.filter(x=>x.company_id===id(1)).length,5);assert.equal(first.filter(x=>x.company_id===id(2)).length,2);await f.db.exec('reset role')
  const state=await f.state();assert.equal(state.rows.filter(x=>x.status==='delivery_uncertain'&&x.next_attempt_at===null).length,7);assert.deepEqual(await f.claim(100),[])
 }finally{await f.db.close()}
})
test('the actual prepared native claim SQL returns scalar JSON receipts with the production bindings',async()=>{
 const native=readFileSync(resolve(__dirname,'manual-email-fair-claim-20261001-native.test.ts'),'utf8')
 const start=native.indexOf('const claim ='),end=native.indexOf('\n\n// Hash',start);assert.ok(start>=0&&end>start)
 const ts=require('typescript');const constructor=ts.transpileModule(native.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const nativeClaim=new Function('quote','randomUUID',constructor+'\nreturn claim;')(value=>"'"+value.replaceAll("'","''")+"'",()=>id(90))
 const f=await fixture();try{await f.seed(1,1);await f.db.exec('set role service_role');const rows=(await f.db.query(nativeClaim(25,null,'controlled-worker',id(90)))).rows[0].coalesce;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.id&&row.company_id&&row.status==='sending'&&row.claim_token===id(90)))
 }finally{await f.db.close()}
})

test('controlled email capability state uses the actual canonical branch without provisioning any website client',async()=>{
 const f=await fixture({capabilityOnly:true});try{await f.seed(20,2)
  assert.equal((await f.db.query('select count(*)::int as n from public.integration_api_clients')).rows[0].n,0)
  const policy=(await f.db.query('select * from public.canonical_tenant_operation_decision($1::uuid,$2)',[id(1),'email.send'])).rows[0];assert.equal(policy.allowed,true);assert.equal(policy.capability_status,'ready')
  assert.equal((await f.claim(1))[0].company_id,id(1))
  await f.db.exec(`update public.company_capabilities set enabled=false,readiness_status='disabled'where company_id='${id(1)}'`)
  const before=(await f.state()).rows.filter(row=>row.company_id===id(1));const rows=await f.claim(1);assert.equal(rows.length,1);assert.equal(rows[0].company_id,id(2));assert.deepEqual((await f.state()).rows.filter(row=>row.company_id===id(1)),before)
 }finally{await f.db.close()}
})
