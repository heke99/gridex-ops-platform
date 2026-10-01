// Real candidate SQL plus actual effect tables, original capture/lexical/workflow
// owners. PostgreSQL-core only: complete Supabase triggers/RLS/native are separate.
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {test}=require('node:test')
const {PGlite}=require('@electric-sql/pglite')
const schema=readFileSync(resolve(__dirname,'../supabase/schema.sql'),'utf8')
const migration=readFileSync(resolve(__dirname,'../supabase/migrations/20261001000738_inbound_switch_lifecycle_required_intent_atomic.sql'),'utf8')
const lifecycle=readFileSync(resolve(__dirname,'../supabase/migrations/20260930230204_customer_operation_lifecycle_intent_atomic.sql'),'utf8')
const lexer=readFileSync(resolve(__dirname,'../supabase/migrations/20260923113014_ediel_closure_original_wire_binding.sql'),'utf8')
const sourceGuard=readFileSync(resolve(__dirname,'../supabase/migrations/20260921224255_ediel_inbound_prodat_receive_context.sql'),'utf8')
const id=n=>`fc810000-0000-4000-8000-${String(n).padStart(12,'0')}`
const a=id(1),b=id(2),c=id(3),sibling=id(4),site=id(5),otherSite=id(6),point=id(7),contract=id(8),sw=id(9),m=id(10),app=id(11),wf=id(12),operation=id(13),origin=id(14)
const effectTables=['supplier_switch_requests','customer_supply_periods','customer_cases','ediel_message_events',
  'customer_application_workflows','customer_application_workflow_events','domain_events','event_outbox','customer_operation_events','customer_operation_jobs',
  'ediel_ack_chains','supplier_switch_events','outbound_requests','outbound_dispatch_events']
function table(name,namespace='public'){
  const actual=schema.match(new RegExp(`CREATE TABLE ${namespace}\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(actual,`actual table missing:${name}`);return actual
}
function fn(name){
  const start=schema.indexOf(`CREATE FUNCTION ${name}(`);assert.ok(start>=0,`actual function absent:${name}`)
  const body=schema.slice(start).match(/AS (\$[^$]*\$)[\s\S]*?\1;/);assert.ok(body);return schema.slice(start,start+body.index+body[0].length)
}
function index(name){const actual=schema.match(new RegExp(`CREATE UNIQUE INDEX ${name} [^;]+;`))?.[0];assert.ok(actual,`actual index missing:${name}`);return actual}
function wire(family='PRODAT',patch={}){
  const body=family==='PRODAT'?['BGM+Z04+DOC+9','DTM+137:202610010000:203','DTM+ZZZ:1:805','NAD+FR+54321:160:SVK','NAD+DO+12345:160:SVK',
    'LIN+1++735999123456789012:::9','DTM+92:202610280000:203','CCI++Z13','CAV+Z22','RFF+LI:CASE']:
    family==='APERAK'?['BGM+++27','RFF+ACW:OUTDOC','ERC+42::260']:['UCI+OUTREF+12345:14+54321:14+4']
  const parts=['UNB+UNOC:3+54321:14+12345:14+261001:0000+REF',`UNH+M+${family}:D:${family==='PRODAT'?'96B':'96A'}:UN${family==='CONTRL'?'':':E2SE6A'}`,...body,`UNT+${body.length+2}+M`,'UNZ+1+REF']
  return Object.entries(patch).reduce((text,[from,to])=>text.replaceAll(from,to),parts.join("'")+"'")
}
const outWire=wire('PRODAT',{'54321:14+12345:14':'12345:14+54321:14','BGM+Z04+DOC':'BGM+Z03+OUTDOC',
  'NAD+FR+54321':'NAD+FR+12345','NAD+DO+12345':'NAD+DO+54321',"UNH+M+":"UNH+OM+","+M'":"+OM'","+REF":"+OUTREF"})
async function fixture(family='PRODAT',raw=wire(family),witness=true,historicalSentInsert=false){
  const db=new PGlite()
  await db.exec(`create schema private; create schema gridex_received_sources; create schema extensions;
    create role service_role bypassrls; create role anon; create role authenticated;
    create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid not null);
    create table public.customer_sites(id uuid primary key,company_id uuid not null,customer_id uuid not null,grid_owner_id uuid);
    create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,meter_point_id text,metering_point_id text,grid_owner_id uuid);
    create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid);
    create table public.grid_owners(id uuid primary key,company_id uuid,ediel_id text,is_active boolean,lifecycle_status text);
    ${['ediel_messages','website_customer_applications',...effectTables].map(name=>table(name)).join('\n')}
    ${['ediel_messages','website_customer_applications',...effectTables].map(name=>`alter table public.${name} add primary key(id);`).join('\n')}
    ${lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v1'),lexer.indexOf('CREATE FUNCTION gridex_received_sources.closure_wire_projection_v1'))}
    ${fn('gridex_received_sources.source_wire_point_v1')}
    ${table('sources','gridex_received_sources')}
    alter table gridex_received_sources.sources add primary key(source_message_id);
    ${['customer_operation_events_company_idempotency_uidx','customer_operation_jobs_active_idempotency_uidx','customer_operation_jobs_lifecycle_notification_uidx',
      'domain_events_idempotency_key_idx','event_outbox_unique_named_destination_idx','customer_application_workflow_events_idempotency_uidx',
      'customer_application_workflows_application_uidx','ux_customer_supply_periods_company_meter_start_active'].map(index).join('\n')}
    ${fn('gridex_received_sources.reject_mutation')}
    ${fn('gridex_received_sources.capture_insert')}
    create trigger gridex_capture_received_prodat_source after insert on public.ediel_messages for each row execute function gridex_received_sources.capture_insert();
    ${sourceGuard.slice(sourceGuard.indexOf('CREATE OR REPLACE FUNCTION'),sourceGuard.lastIndexOf('COMMIT;'))}
    create trigger proof_actual_message_contract before insert or update on public.ediel_messages for each row execute function public.gridex_validate_ediel_message_contract();
    ${fn('public.gridex_transition_customer_application_workflow')}
    insert into public.companies values('${a}'),('${b}');
    insert into public.customers values('${c}','${a}'),('${sibling}','${a}');
    insert into public.grid_owners values('${id(22)}','${a}','54321',true,'active');
    insert into public.customer_sites values('${site}','${a}','${c}','${id(22)}'),('${otherSite}','${a}','${sibling}','${id(22)}');
    insert into public.metering_points values('${point}','${a}','${c}','${site}','${site}','735999123456789012','735999123456789012','${id(22)}');
    insert into public.customer_contracts values('${contract}','${a}','${c}','${site}','${site}','${point}');
    insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,status,
      requested_start_date,rff_li_reference,grid_owner_ediel_id,z03_variant,operation_id,grid_owner_id)
      values('${sw}','${a}','${c}','${site}','${site}','${point}','${contract}','${contract}','submitted','2026-10-28','CASE','54321','L','${operation}','${id(22)}');
    insert into public.website_customer_applications(id,company_id,customer_id,external_customer_id,application_number,customer_number,contract_number,next_step)
      values('${app}','${a}','${c}','Synthetic reference','APP-C','CUST-C','AGREEMENT-C','waiting_response');
    insert into public.customer_application_workflows(id,company_id,customer_application_id,customer_id,customer_site_id,metering_point_id,contract_id,operation_id,state)
      values('${wf}','${a}','${app}','${c}','${site}','${point}','${contract}','${operation}','waiting_for_switch_response');
    grant usage on schema private,gridex_received_sources to service_role;
    grant all on all tables in schema public to service_role;
    grant select on gridex_received_sources.sources to service_role;`)
  await db.exec(lifecycle)
  await db.exec(migration)
  {
    await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,
      canonical_rule_pack_id,communication_route_id,route_profile_id,application_reference,source_operation_id,status,message_sent_at) values($1,$2,'outbound','PRODAT','Z03',$3,$4,$5,$6,$7,$8,$8,$8,'23-DDQ-PRODAT','synthetic-source',${historicalSentInsert?"'sent'":"'queued'"},${historicalSentInsert?"'2026-10-01T00:00:00Z'":"NULL"})`,[origin,a,outWire,sw,c,site,point,id(21)])
    await db.exec(`update public.supplier_switch_requests set outbound_z03_message_id='${origin}' where id='${sw}'`)
    // PostgreSQL-core fixture explicitly simulates the actual dispatcher UPDATE;
    // only genuine native runs qualify transport/MIME/storage and its receipt.
    if(witness)await db.exec(`set role service_role; update public.ediel_messages set status='sent',message_sent_at='2026-10-01T00:00:00Z' where id='${origin}'; reset role`)
  }
  await db.exec('set role service_role')
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,message_received_at,related_message_id,
    parsed_payload,ack_outcome) values($1,$2,'inbound',$3,$4,$5,$6,$7,$8,$9,'2026-10-01',${family==='PRODAT'?'NULL':`'${origin}'`},'{"contract_id":"forged-ui-value","start_date":"1999-01-01"}','positive')`,[m,a,family,family==='PRODAT'?'Z04':family,raw,sw,c,site,point])
  await db.exec('reset role')
  return db
}
async function apply(db,role='service_role',sourceId=m){
  await db.exec(`set role ${role}`)
  try{return(await db.query('select public.gridex_apply_inbound_switch_lifecycle_v1($1::uuid,null) as value',[sourceId])).rows[0].value}
  finally{await db.exec('reset role')}
}
async function state(db){
  const names=['ediel_messages',...effectTables,'private.gridex_inbound_switch_lifecycle_receipts']
  return(await db.query(`select jsonb_build_object(${names.map(name=>`'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by ${name.startsWith('private.')?'source_message_id':'id'}),'[]'::jsonb) from ${name.startsWith('private.')?name:'public.'+name} t)`).join(',')}) as value`)).rows[0].value
}
test('exact sealed Z04 and current contract graph commit switch/period/Ediel/workflow/three events and unsent intent together',async()=>{
  const db=await fixture();try{const r=await apply(db),s=await state(db)
    assert.equal(r.outcome,'supplier_switch_accepted');assert.equal(r.replayed,false)
    assert.equal(s.supplier_switch_requests[0].status,'accepted');assert.equal(s.supplier_switch_requests[0].confirmed_start_date,'2026-10-28')
    assert.equal(s.customer_supply_periods.length,1);assert.equal(s.customer_supply_periods[0].status,'confirmed_by_grid_owner')
    assert.equal(s.customer_supply_periods[0].contract_id,contract);assert.equal(s.customer_supply_periods[0].source_switch_request_id,sw)
    assert.equal(s.ediel_message_events.length,1);assert.equal(s.customer_application_workflows[0].state,'switch_confirmed')
    assert.equal(s.customer_application_workflow_events.length,1);assert.equal(s.domain_events.length,3);assert.equal(s.event_outbox.length,3)
    assert.equal(s.customer_operation_events.length,1);assert.equal(s.customer_operation_jobs.length,1)
    assert.equal(s.customer_operation_jobs[0].status,'queued');assert.equal(s.customer_operation_jobs[0].attempts,0)
    assert.equal(s.customer_operation_jobs[0].payload.contract_id,contract)
    assert.equal(s.customer_operation_jobs[0].idempotency_key,`lifecycle_notification:ediel:${m}:supplier_switch_accepted:switch.confirmed`)
    assert.ok(s.event_outbox.every(row=>row.status==='queued'&&row.sent_at===null))
  }finally{await db.close()}
})
test('late final intent fault rolls ALL accepted effects back; exact retry commits once',async()=>{
 const db=await fixture();try{
  await db.exec(`create function private.proof_late_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_final_intent_fault';end$$;
    create trigger proof_late_fault before insert on public.customer_operation_jobs for each row execute function private.proof_late_fault()`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='synthetic_final_intent_fault');assert.deepEqual(await state(db),before)
  await db.exec('drop trigger proof_late_fault on public.customer_operation_jobs');await apply(db);assert.equal((await state(db)).customer_operation_jobs.length,1)
 }finally{await db.close()}
})
for(const family of ['APERAK','CONTRL'])test(`sealed negative ${family} owns rejection/case/workflow/Ediel/intent and late-fault rollback`,async()=>{
 const db=await fixture(family);try{
  await db.exec(`create function private.proof_late_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_final_intent_fault';end$$;
    create trigger proof_late_fault before insert on public.customer_operation_jobs for each row execute function private.proof_late_fault()`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='synthetic_final_intent_fault');assert.deepEqual(await state(db),before)
  await db.exec('drop trigger proof_late_fault on public.customer_operation_jobs')
  const r=await apply(db),s=await state(db);assert.equal(r.outcome,family==='APERAK'?'business_rejection':'technical_rejection')
  assert.equal(s.supplier_switch_requests[0].status,'failed');assert.equal(s.customer_supply_periods.length,0);assert.equal(s.customer_cases.length,1)
  assert.ok(s.ediel_messages.find(row=>row.id===origin).failed_at,'actual source failure timestamp is preserved')
  assert.equal(s.customer_cases[0].customer_contract_id,contract);assert.equal(s.customer_application_workflows[0].state,'switch_rejected')
  assert.equal(s.domain_events.length,3);assert.equal(s.event_outbox.length,3);assert.equal(s.ediel_message_events.length,3);assert.equal(s.customer_operation_jobs.length,1)
 }finally{await db.close()}
})
test('permanent replay preserves terminal intent and later business state; current graph must still bind before replay',async()=>{
 const db=await fixture();try{
  const first=await apply(db);await db.exec("update public.customer_operation_jobs set status='completed',completed_at=clock_timestamp();update public.supplier_switch_requests set status='completed'")
  const before=await state(db),r=await apply(db);assert.equal(r.replayed,true);assert.equal(r.lifecycleReceipt.notificationJobId,first.lifecycleReceipt.notificationJobId);assert.deepEqual(await state(db),before)
  await db.exec(`update public.metering_points set customer_id='${sibling}' where id='${point}'`)
  await assert.rejects(apply(db),e=>e.code==='23503');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('stored source links, raw case/facility/sender and alias mismatches fail before effects',async()=>{
 for(const change of ["update public.ediel_messages set switch_request_id=null",`update public.metering_points set meter_point_id='OTHER'`,
  "update public.supplier_switch_requests set rff_li_reference='OTHER'","update public.supplier_switch_requests set grid_owner_ediel_id='99999'",
  `update public.supplier_switch_requests set customer_site_id='${otherSite}'`, `update public.customer_contracts set customer_site_id='${otherSite}'`]){
  const db=await fixture();try{await db.exec(change);const before=await state(db);await assert.rejects(apply(db),e=>e.code==='23503');assert.deepEqual(await state(db),before)}finally{await db.close()}
 }
})
test('positive ACK is technical only and changed live ACK cannot use original capture',async()=>{
 for(const [family,patch] of [['APERAK',{'ERC+42':'ERC+100','BGM+++27':'BGM+++34'}],['CONTRL',{'14+4':'14+1'}]]){
  const db=await fixture(family,wire(family,patch));try{const r=await apply(db),s=await state(db)
   assert.equal(r.outcome,'ignored');assert.equal(r.ackOutcome,'positive');assert.equal(s.customer_supply_periods.length,0)
   assert.equal(s.customer_cases.length,0);assert.equal(s.customer_operation_jobs.length,0);assert.equal(s.customer_operation_events.length,0)
   assert.equal(s.domain_events.length,0);assert.equal(s.ediel_ack_chains.length,1);assert.equal(s.supplier_switch_events.length,1)
  }finally{await db.close()}
 }
 const db=await fixture('APERAK');try{await db.exec("update public.ediel_messages set raw_payload='changed' where direction='inbound'");const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_trusted_receive_required');assert.deepEqual(await state(db),before)}finally{await db.close()}
})
test('anon/authenticated cannot invoke transaction, lexical facade or manufacture sealed ACK/receipt',async()=>{
 const db=await fixture('APERAK');try{
  const before=await state(db)
  for(const role of ['anon','authenticated']){await assert.rejects(apply(db,role),e=>e.code==='42501');await db.exec(`set role ${role}`)
   try{await assert.rejects(db.query(`select private.gridex_inbound_switch_wire_tokens_v1('x')`),e=>e.code==='42501');await assert.rejects(db.query('select * from private.gridex_inbound_switch_received_sources'),e=>e.code==='42501')}
   finally{await db.exec('reset role')}
  }
  assert.deepEqual(await state(db),before)
  await db.exec('set role service_role');try{await assert.rejects(db.query(`insert into private.gridex_inbound_switch_received_sources(source_message_id,company_id,environment,message_family)values($1,$2,'test','APERAK')`,[id(99),a]),e=>e.code==='42501')}
  finally{await db.exec('reset role')}
 }finally{await db.close()}
})
test('discordant current meter identity aliases cannot be hidden by coalesce during source binding',async()=>{
 const db=await fixture();try{await db.exec("update public.metering_points set metering_point_id='OTHER' where true");const before=await state(db)
  await assert.rejects(apply(db),e=>e.code==='23503');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('ambiguous identical pending periods are held rather than choosing an arbitrary row',async()=>{
 const db=await fixture();try{await db.exec(`insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,status)
  values('${a}','${c}','${point}','${contract}','${contract}','2026-10-28','pending'),('${a}','${c}','${point}','${contract}','${contract}','2026-10-28','pending')`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_supply_period_ambiguous');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('current exact operation workflow contract must bind before fresh transition or permanent replay',async()=>{
 for(const replay of [false,true]){const db=await fixture();try{
  if(replay)await apply(db)
  await db.exec(`insert into public.customer_contracts values('${id(30)}','${a}','${c}','${site}','${site}','${point}');update public.customer_application_workflows set contract_id='${id(30)}' where id='${wf}'`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_workflow_scope_mismatch');assert.deepEqual(await state(db),before)
 }finally{await db.close()}}
})

test('current operation ownership is revalidated on permanent receipt replay',async()=>{
 const db=await fixture();try{await apply(db);await db.exec(`update public.customer_application_workflows set operation_id='${id(31)}' where id='${wf}'`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_workflow_scope_mismatch');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('duplicate legal sender or receiver qualifiers cannot hide behind one matching party',async()=>{
 for(const qualifier of ['FR','DO']){
  const raw=wire().replace(`NAD+${qualifier}+`, `NAD+${qualifier}+99999:160:SVK'NAD+${qualifier}+`).replace('UNT+12+M','UNT+13+M')
  const db=await fixture('PRODAT',raw);try{const before=await state(db);await assert.rejects(apply(db),e=>e.code==='23503');assert.deepEqual(await state(db),before)}finally{await db.close()}
 }
})

test('unsent origin cannot be accepted from a submitted switch; fresh and replay need exact dispatch witness',async()=>{
 for(const replay of [false,true])for(const patch of ["status='queued'", "message_sent_at=null"]){
  const db=await fixture();try{if(replay)await apply(db);await db.exec(`update public.ediel_messages set ${patch} where id='${origin}'`);const before=await state(db)
   await assert.rejects(apply(db),e=>e.message==='inbound_switch_origin_unsent');assert.deepEqual(await state(db),before)
  }finally{await db.close()}
 }
 const db=await fixture('PRODAT',wire(),false);try{const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_origin_unsent');assert.deepEqual(await state(db),before)}finally{await db.close()}
})
test('real dispatched source permits genuinely queued switch while fresh closed/rejected switch stays held',async()=>{
 for(const status of ['queued','prepared','failed','accepted','completed']){const db=await fixture();try{await db.exec(`update public.supplier_switch_requests set status='${status}' where id='${sw}'`);const before=await state(db)
  if(['queued','prepared'].includes(status)){assert.equal((await apply(db)).outcome,'supplier_switch_accepted')}else{await assert.rejects(apply(db),e=>e.message==='inbound_switch_current_state_conflict');assert.deepEqual(await state(db),before)}
 }finally{await db.close()}}
})
test('future overlapping period blocks a new open period and existing pending confirmation',async()=>{
 for(const existing of [false,true]){const db=await fixture();try{
  if(existing)await db.exec(`insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,status)
   values('${a}','${c}','${point}','${contract}','${contract}','2026-10-28','pending')`)
  await db.exec(`insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,status)
   values('${a}','${c}','${point}','${contract}','${contract}','2026-11-28','pending')`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_supply_period_conflict');assert.deepEqual(await state(db),before)
 }finally{await db.close()}}
})

test('positive technical ACK receipt final failure rolls back all source/chain/switch audit effects',async()=>{
 const db=await fixture('CONTRL',wire('CONTRL',{'14+4':'14+1'}));try{
  await db.exec(`create function private.proof_final_receipt_fault()returns trigger language plpgsql as $$begin raise exception 'synthetic_final_receipt_fault';end$$;
   create trigger proof_final_receipt_fault before insert on private.gridex_inbound_switch_lifecycle_receipts for each row execute function private.proof_final_receipt_fault()`);
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='synthetic_final_receipt_fault');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})

test('sent INSERT and historical no-op projection never fabricate a fresh dispatch witness',async()=>{
 const db=await fixture('PRODAT',wire(),false,true);try{
  assert.equal((await db.query('select count(*)::int as n from private.gridex_inbound_switch_dispatch_sources')).rows[0].n,0)
  await db.exec(`update public.ediel_messages set status='sent',message_sent_at=message_sent_at where id='${origin}'`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_origin_unsent');assert.deepEqual(await state(db),before)
  assert.equal((await db.query('select count(*)::int as n from private.gridex_inbound_switch_dispatch_sources')).rows[0].n,0)
 }finally{await db.close()}
})
test('owned positive technical ACK receipt permits later exact sealed business Z04 without making ACK acceptance',async()=>{
 const db=await fixture('CONTRL',wire('CONTRL',{'14+4':'14+1'}));try{
  const ack=await apply(db);assert.equal(ack.outcome,'ignored');assert.equal(ack.finalAckReached,true)
  assert.equal((await state(db)).customer_supply_periods.length,0)
  const z04=id(38)
  await db.exec('set role service_role')
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,message_received_at)
   values($1,$2,'inbound','PRODAT','Z04',$3,$4,$5,$6,$7,'2026-10-01')`,[z04,a,wire(),sw,c,site,point])
  await db.exec('reset role')
  const accepted=await apply(db,'service_role',z04);assert.equal(accepted.outcome,'supplier_switch_accepted')
  const after=await state(db);assert.equal(after.customer_supply_periods.length,1);assert.equal(after.customer_operation_jobs.length,1)
  assert.equal(after['private.gridex_inbound_switch_lifecycle_receipts'].length,2)
  assert.equal((await apply(db,'service_role',z04)).replayed,true);assert.deepEqual(await state(db),after)
 }finally{await db.close()}
})
test('real linked outbound request belongs to exact switch graph and shares late intent rollback/replay',async()=>{
 for(const discordant of [false,true]){const db=await fixture('APERAK');try{
  const outbound=id(39)
  await db.exec(`insert into public.outbound_requests(id,company_id,customer_id,site_id,metering_point_id,request_type,source_type,source_id,status,sent_at)
   values('${outbound}','${a}','${discordant?sibling:c}','${site}','${point}','supplier_switch','supplier_switch_request','${sw}','sent','2026-10-01');
   update public.ediel_messages set outbound_request_id='${outbound}' where id='${origin}'`)
  if(discordant){const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_outbound_scope_mismatch');assert.deepEqual(await state(db),before)}
  else{
   await db.exec(`create function private.proof_outbound_fault()returns trigger language plpgsql as $$begin raise exception 'synthetic_final_intent_fault';end$$;
    create trigger proof_outbound_fault before insert on public.customer_operation_jobs for each row execute function private.proof_outbound_fault()`)
   const before=await state(db);await assert.rejects(apply(db),e=>e.message==='synthetic_final_intent_fault');assert.deepEqual(await state(db),before)
   await db.exec('drop trigger proof_outbound_fault on public.customer_operation_jobs');await apply(db)
   const after=await state(db);assert.equal(after.outbound_requests[0].status,'failed');assert.equal(after.outbound_dispatch_events.length,1)
   assert.equal((await apply(db)).replayed,true);assert.deepEqual(await state(db),after)
  }
 }finally{await db.close()}}
})

for(const [name,family,raw] of [
 ['unsupported action7','CONTRL',wire('CONTRL',{'14+4':'14+7'})],
 ['missingERC','APERAK',wire('APERAK',{"ERC+42::260'":"",'UNT+5+M':'UNT+4+M'})],
 ['UTILTS BGM inPRODAT','APERAK',wire('APERAK',{'BGM+++27':'BGM+312++9'})],
 ['whole rejectionERC100','APERAK',wire('APERAK',{'ERC+42::260':'ERC+100::260'})],
])test(`canonical protocol rejects ${name} before all effects`,async()=>{
 const db=await fixture(family,raw);try{const before=await state(db)
  await assert.rejects(apply(db),e=>e.message==='inbound_switch_ack_wire_invalid');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})

test('current Z03 both-required policy preserves partial CONTRL and only exact positive APERAK completes technical state',async()=>{
 const db=await fixture('CONTRL',wire('CONTRL',{'14+4':'14+1'}));try{
  await db.exec(`update public.ediel_messages set requires_contrl=true,requires_aperak=true,contrl_status='pending',aperak_status='pending' where id='${origin}';
   update public.supplier_switch_requests set status='queued' where id='${sw}'`)
  const first=await apply(db);assert.equal(first.finalAckReached,false)
  let s=await state(db);assert.equal(s.ediel_messages.find(r=>r.id===origin).status,'sent');assert.equal(s.supplier_switch_requests[0].status,'queued')
  assert.equal(s.customer_operation_jobs.length,0);assert.equal(s.customer_supply_periods.length,0)
  const aperak=id(40)
  await db.exec('set role service_role')
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,message_received_at,related_message_id)
   values($1,$2,'inbound','APERAK','APERAK',$3,$4,$5,$6,$7,'2026-10-01',$8)`,[aperak,a,wire('APERAK',{'BGM+++27':'BGM+++34','ERC+42':'ERC+100'}),sw,c,site,point,origin])
  await db.exec('reset role')
  const second=await apply(db,'service_role',aperak);assert.equal(second.finalAckReached,true);assert.equal(second.outcome,'ignored')
  s=await state(db);assert.equal(s.ediel_messages.find(r=>r.id===origin).status,'acknowledged');assert.equal(s.supplier_switch_requests[0].status,'submitted')
  assert.equal(s.customer_operation_jobs.length,0);assert.equal(s.domain_events.length,0);assert.equal(s.customer_supply_periods.length,0)
  assert.equal((await apply(db)).replayed,true);assert.deepEqual(await state(db),s)
 }finally{await db.close()}
})

async function installOrdinaryTenantWriter(db){
 const actor=id(41)
  // Auth.uid is a PostgreSQL-core request-claim adapter; the production company,
  // profile, global-role and membership authority helpers/policies are actual.
  await db.exec(`create schema auth; create function auth.uid()returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$`)
  await db.exec(`create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
   alter table public.companies add column status text default 'active';
   ${['user_profiles','company_memberships','admin_users','user_roles','roles'].map(name=>table(name)).join('\n')}
   ${['public.gridex_is_current_session_allowed','public.gridex_normalize_platform_role','public.gridex_user_is_platform_admin',
      'public.gridex_can_read_company','public.gridex_can_write_company','public.gridex_user_company_ids'].map(fn).join('\n')}
   insert into auth.users(id,email_confirmed_at) values('${actor}',now());
   insert into public.user_profiles(id,email,user_status) values('${actor}','ordinary-writer@example.invalid','active');
   insert into public.company_memberships(company_id,user_id,membership_role,status,role,is_active)
     values('${a}','${actor}','operations','active','operations',true);
   alter table public.ediel_messages enable row level security;
   alter table public.ediel_messages force row level security;
   grant usage on schema public,auth to authenticated;`)
  const grant=schema.match(/GRANT ALL ON TABLE public\.ediel_messages TO authenticated;/)?.[0];assert.ok(grant)
  const names=['gridex_mp_7bd821a0c63bef93248d','gridex_mp_a2f857be40f1e68ceb6e','gridex_perf_authenticated_select_v1','tenant_lifecycle_select_guard','tenant_lifecycle_update_guard','tenant_lifecycle_insert_guard']
  for(const name of names){const policy=schema.match(new RegExp(`CREATE POLICY ${name} ON public\\.ediel_messages [^;]+;`))?.[0];assert.ok(policy);await db.exec(policy)}
  await db.exec(grant)
  await db.exec(`set role authenticated; select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',false)`)
  assert.deepEqual((await db.query(`select public.gridex_can_write_company('${a}') allowed,public.gridex_can_write_company('${b}') foreign_allowed,public.gridex_user_is_platform_admin() platform`)).rows[0],
    {allowed:true,foreign_allowed:false,platform:false})
 return actor
}
test('actual current tenant UPDATE ACL/RLS cannot indirectly manufacture a first-sent dispatch witness, including claimed service role',async()=>{
 const db=await fixture('PRODAT',wire(),false);try{
  const actor=await installOrdinaryTenantWriter(db)
  let denial
  try{await db.exec(`update public.ediel_messages set status='sent',message_sent_at='2026-10-01' where id='${origin}'`)}catch(error){denial=error}
  await db.exec('reset role')
  const witnessCount=(await db.query(`select count(*)::int n from private.gridex_inbound_switch_dispatch_sources`)).rows[0].n
  const message=(await state(db)).ediel_messages.find(r=>r.id===origin)
  assert.ok(denial,`authenticated UPDATE manufactured witnesses=${witnessCount}, originStatus=${message.status}, sentAt=${message.message_sent_at}`)
  assert.equal(denial.code,'42501');assert.equal(denial.message,'inbound_switch_dispatch_service_required')
  assert.equal(witnessCount,0)
  assert.equal(message.status,'queued');assert.equal(message.message_sent_at,null)
  await db.exec(`set role authenticated; select set_config('request.jwt.claims','{"sub":"${actor}","role":"service_role"}',false)`)
  await assert.rejects(db.exec(`update public.ediel_messages set status='sent',message_sent_at='2026-10-01' where id='${origin}'`),
    e=>e.code==='42501'&&e.message==='inbound_switch_dispatch_service_required')
  await db.exec('reset role')
  assert.equal((await db.query(`select count(*)::int n from private.gridex_inbound_switch_dispatch_sources`)).rows[0].n,0)
  assert.equal((await state(db)).ediel_messages.find(r=>r.id===origin).status,'queued')
 }finally{await db.exec('reset role');await db.close()}
})
for(const family of ['PRODAT','CONTRL'])test(`actual ordinary current tenant ${family} INSERT cannot become trusted new switch receive evidence`,async()=>{
 const db=await fixture();try{
  const actor=await installOrdinaryTenantWriter(db)
  await db.exec(`select set_config('request.jwt.claims','{"sub":"${actor}","role":"service_role"}',false)`)
  const source=id(family==='PRODAT'?42:43)
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,message_received_at,related_message_id)
    values($1,$2,'inbound',$3,$4,$5,$6,$7,$8,$9,'2026-10-01',$10)`,[source,a,family,family==='PRODAT'?'Z04':family,wire(family),sw,c,site,point,origin])
  await db.exec('reset role')
  const before=await state(db)
  let denial
  try{await apply(db,'service_role',source)}catch(error){denial=error}
  const after=await state(db)
  assert.ok(denial,`authenticated ${family} INSERT led to switch=${after.supplier_switch_requests[0].status}, permanentReceipts=${after['private.gridex_inbound_switch_lifecycle_receipts'].length}`)
  assert.equal(denial.message,'inbound_switch_trusted_receive_required')
  assert.deepEqual(after,before)
 }finally{await db.exec('reset role');await db.close()}
})
