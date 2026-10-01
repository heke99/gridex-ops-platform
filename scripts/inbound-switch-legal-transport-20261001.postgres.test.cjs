// Bounded service/business core: actual installed owners and candidate forward.
// Canonical dispatcher UPDATE is explicitly simulated; no native/Auth/role attack proof.
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {test}=require('node:test')
const {PGlite}=require('@electric-sql/pglite')
const schema=readFileSync(resolve(__dirname,'../supabase/schema.sql'),'utf8')
const forward=readFileSync(resolve(__dirname,'../supabase/migrations/20261001050658_inbound_switch_current_legal_transport_binding.sql'),'utf8')
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
async function fixture(delegated=false, incomingPatch={}){
  const family='PRODAT',witness=true,historicalSentInsert=false
  const raw=wire(family,{...(delegated?{'54321:14+12345:14':'54321:14+82150:14'}:{}),...incomingPatch})
  const outgoing=delegated?outWire.replace('12345:14+54321:14','82150:14+54321:14'):outWire
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
    ${['tenant_actor_identifiers','tenant_actor_roles','tenant_ediel_profiles','tenant_counterparty_relations','platform_actor_identifiers','ediel_messages','website_customer_applications',...effectTables].map(name=>table(name)).join('\n')}
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
    insert into public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) values('${a}','test','electricity',true,clock_timestamp()-interval '1 day');
    insert into public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) values('${a}','test','${id(23)}','EdielId','12345',clock_timestamp()-interval '1 day');
    insert into public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) values('${a}','test','${id(23)}','electricity_supplier',clock_timestamp()-interval '1 day');
    ${delegated?`insert into public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from) values('${a}','test','${id(24)}','ediel_transport_agent',true,clock_timestamp()-interval '1 day');
    insert into public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to) values('${id(24)}','EdielId','82150',true,'2026-01-01','2099-01-01');`:''}
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
  if(process.env.INBOUND_LEGAL_TRANSPORT_BASELINE!=='1')await db.exec(forward)
  {
    await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,switch_request_id,customer_id,site_id,metering_point_id,
      canonical_rule_pack_id,communication_route_id,route_profile_id,application_reference,source_operation_id,status,message_sent_at) values($1,$2,'outbound','PRODAT','Z03',$3,$4,$5,$6,$7,$8,$8,$8,'23-DDQ-PRODAT','synthetic-source',${historicalSentInsert?"'sent'":"'queued'"},${historicalSentInsert?"'2026-10-01T00:00:00Z'":"NULL"})`,[origin,a,outgoing,sw,c,site,point,id(21)])
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

test('equal physical/legal parties retain actual accepted effects and permanent replay',async()=>{
 const db=await fixture();try{const first=await apply(db);assert.equal(first.outcome,'supplier_switch_accepted');assert.equal(first.replayed,false)
  const before=await state(db);assert.equal((await apply(db)).replayed,true);assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('distinct tenant physical transport retains legal NAD parties with current explicit delegation',async()=>{
 const db=await fixture(true);try{const r=await apply(db),s=await state(db)
  assert.equal(r.outcome,'supplier_switch_accepted');assert.equal(s.supplier_switch_requests[0].status,'accepted')
  assert.equal(s.customer_supply_periods.length,1);assert.equal(s.customer_operation_jobs.length,1)
  const original=s.ediel_messages.find(row=>row.id===origin)
  assert.ok(original.raw_payload.includes('82150:14+54321:14'))
  assert.ok(original.raw_payload.includes('NAD+FR+12345:160:SVK'))
 }finally{await db.close()}
})
test('wrong received legal NAD cannot borrow a correctly reversed physical envelope',async()=>{
 const db=await fixture(true,{'NAD+DO+12345':'NAD+DO+82150'});try{const before=await state(db)
  await assert.rejects(apply(db),e=>e.code==='23503');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('revoked current delegation is rechecked before permanent replay without new effects',async()=>{
 const db=await fixture(true);try{await apply(db);await db.exec('update public.tenant_counterparty_relations set is_enabled=false')
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_tenant_identity_mismatch');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('expired half-open current transport identifier is held before first effect',async()=>{
 const db=await fixture(true);try{await db.exec('update public.platform_actor_identifiers set valid_to=current_date')
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_tenant_identity_mismatch');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('delegated last-intent failure rolls every business effect back and current retry commits once',async()=>{
 const db=await fixture(true);try{await db.exec(`create function private.delegated_late_fault() returns trigger language plpgsql as $$begin raise exception 'delegated_final_intent_fault';end$$;
   create trigger delegated_late_fault before insert on public.customer_operation_jobs for each row execute function private.delegated_late_fault()`);
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='delegated_final_intent_fault');assert.deepEqual(await state(db),before)
  await db.exec('drop trigger delegated_late_fault on public.customer_operation_jobs');await apply(db)
  const after=await state(db);assert.equal(after.customer_operation_jobs.length,1);assert.equal(after.customer_supply_periods.length,1)
 }finally{await db.close()}
})
test('current supplier profile and market-role prerequisites remain required independently of transport',async()=>{
 for(const change of ['update public.tenant_ediel_profiles set is_enabled=false',
   'update public.tenant_actor_roles set valid_to=clock_timestamp()',
   `insert into public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from)
     values('${a}','test','${id(25)}','ediel_transport_agent',true,clock_timestamp()-interval '1 day')`]){
  const db=await fixture(true);try{await db.exec(change);const before=await state(db)
   await assert.rejects(apply(db),e=>e.message==='inbound_switch_tenant_identity_mismatch');assert.deepEqual(await state(db),before)
  }finally{await db.close()}
 }
})
test('actual current-identity expiry during the final intent rolls the whole transaction back',async()=>{
 const db=await fixture(true);try{
  await db.exec(`update public.tenant_counterparty_relations set valid_to=clock_timestamp()+interval '1 second';
    create function private.delegated_expiry() returns trigger language plpgsql as $$begin perform pg_sleep(1.1);return new;end$$;
    create trigger delegated_expiry before insert on public.customer_operation_jobs for each row execute function private.delegated_expiry()`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_tenant_identity_expired');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
test('actual current-identity expiry during the final permanent receipt rolls every effect back',async()=>{
 const db=await fixture(true);try{
  await db.exec(`update public.tenant_counterparty_relations set valid_to=clock_timestamp()+interval '2 seconds';
    create function private.delegated_receipt_expiry() returns trigger language plpgsql as $$begin perform pg_sleep(2.1);return new;end$$;
    create trigger delegated_receipt_expiry before insert on private.gridex_inbound_switch_lifecycle_receipts
      for each row execute function private.delegated_receipt_expiry()`)
  const before=await state(db);await assert.rejects(apply(db),e=>e.message==='inbound_switch_tenant_identity_expired');assert.deepEqual(await state(db),before)
 }finally{await db.close()}
})
