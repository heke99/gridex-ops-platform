// Exact production legal-profile/catalog trigger chain + lifecycle SQL core.
// This is not full Supabase history/RLS or native Data API concurrency proof.
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {runInThisContext}=require('node:vm')
const {test}=require('node:test')
const ts=require('typescript')
const {PGlite}=require('@electric-sql/pglite')
const schema=readFileSync(resolve(__dirname,'../supabase/schema.sql'),'utf8')
const native=readFileSync(resolve(__dirname,'customer-operation-lifecycle-atomic-20260930.native.test.ts'),'utf8')
const migration=readFileSync(resolve(__dirname,'../supabase/migrations/20260930230204_customer_operation_lifecycle_intent_atomic.sql'),'utf8')
const id=n=>`e6190000-0000-4000-8000-${String(n).padStart(12,'0')}`
const f={company:id(1),customer:id(11),site:id(21),point:id(31),contract:id(41),operation:id(51),key:'baseline-approved-operation'}
const effects={timeline:'customer_operation_events',domain:'domain_events',fanout:'event_outbox',intents:'customer_operation_jobs'}
function table(name){const b=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(b,'actual table:'+name);return b}
function fn(name){const bodies=[];let offset=0;while(true){const start=schema.indexOf('CREATE FUNCTION public.'+name+'(',offset);if(start<0)break
 const end=schema.indexOf('\n--\n',start);bodies.push(schema.slice(start,end));offset=end}assert.ok(bodies.length,'actual function:'+name);return bodies.reverse().join('\n')}
function trigger(name){const b=schema.split('\n').find(x=>x.startsWith('CREATE TRIGGER '+name+' '));assert.ok(b,'actual trigger:'+name);return b}
function index(name){const b=schema.match(new RegExp(`CREATE UNIQUE INDEX ${name} [^;]+;`))?.[0];assert.ok(b,'actual index:'+name);return b}
async function functions(db,names){const done=new Set();async function add(name){if(done.has(name))return;done.add(name);const body=fn(name)
 for(const m of body.matchAll(/public\.(\w+)\s*\(/g))if(m[1]!==name&&schema.includes('CREATE FUNCTION public.'+m[1]+'('))await add(m[1])
 await db.exec(body)}for(const name of names)await add(name)}
async function fixture(){
 const db=new PGlite()
 await db.exec(`create schema private;create schema extensions;create role service_role bypassrls;create role authenticated;create role anon;
  create function extensions.digest(bytea,text)returns bytea language sql immutable as $$select sha256($1)$$;`)
 await functions(db,['gridex_normalize_org_number','gridex_new_external_tenant_reference','gridex_new_public_resource_reference'])
 const sources=['companies','tenant_legal_profiles','contract_publication_revisions','webhook_subscriptions','webhook_deliveries','audit_logs',...Object.values(effects)]
 await db.exec(sources.map(table).join('\n'))
 await db.exec(`alter table public.companies add primary key(id);
  alter table public.tenant_legal_profiles add unique(company_id);
  alter table public.contract_publication_revisions add unique(company_id,channel);
  ${Object.values(effects).map(t=>`alter table public.${t} add primary key(id);`).join('\n')}
  ${['customer_operation_events_company_idempotency_uidx','customer_operation_jobs_active_idempotency_uidx','customer_operation_jobs_lifecycle_notification_uidx',
   'domain_events_idempotency_key_idx','event_outbox_unique_named_destination_idx'].map(index).join('\n')}
  ${schema.match(/ALTER TABLE ONLY public\.webhook_deliveries\s+ADD CONSTRAINT webhook_deliveries_idempotency_unique UNIQUE \(idempotency_key\);/)[0]}
  create table public.customers(id uuid primary key,company_id uuid not null);
  create table public.customer_sites(id uuid primary key,company_id uuid not null,customer_id uuid not null);
  create table public.metering_points(id uuid primary key,company_id uuid not null,customer_id uuid not null,site_id uuid,customer_site_id uuid);
  create table public.customer_contracts(id uuid primary key,company_id uuid not null,customer_id uuid not null,site_id uuid,customer_site_id uuid,metering_point_id uuid);`)
 await functions(db,['gridex_refresh_legal_profile_completeness','gridex_rebuild_company_legal_profile','gridex_sync_company_legal_profile_trigger',
  'gridex_bump_contract_publication_revision','gridex_public_catalog_dependency_revision_trigger_v1'])
 await db.exec(['tenant_legal_profiles_completeness','trg_gridex_catalog_rev_legal_profile','gridex_companies_legal_profile_sync'].map(trigger).join('\n'))
 await db.exec(`insert into public.companies(id,name,status)values('${f.company}','Synthetic atomic lifecycle','active');
  insert into public.customers values('${f.customer}','${f.company}');insert into public.customer_sites values('${f.site}','${f.company}','${f.customer}');
  insert into public.metering_points values('${f.point}','${f.company}','${f.customer}','${f.site}','${f.site}');
  insert into public.customer_contracts values('${f.contract}','${f.company}','${f.customer}','${f.site}','${f.site}','${f.point}');
  grant usage on schema private to service_role;grant all on all tables in schema public to service_role;`)
 await db.exec(migration)
 return db
}
function command(){return {company_id:f.company,customer_id:f.customer,customer_site_id:f.site,metering_point_id:f.point,contract_id:f.contract,
 customer_operation_job_id:null,operation_id:f.operation,actor_user_id:null,aggregate_type:'customer_site',aggregate_id:f.site,event_code:'supplier_switch.requested',
 title:'Approved switch prepared',message:'Unsent intent only',status:'waiting_response',severity:'info',action_required:false,action_url:null,source:'customer_operations',visibility:'tenant',
 payload:{contract_id:f.contract,marker:'approved'},idempotency_key:f.key,source_event_id:f.key,notification_template:'switch.started'}}
async function record(db){await db.exec('set role service_role');try{return(await db.query('select public.gridex_record_customer_operation_event_v1($1::jsonb) as value',[JSON.stringify(command())])).rows[0].value}
 finally{await db.exec('reset role')}}
async function state(db){const out={communication:0,emailOutbox:0,webhookDeliveries:0,switchRequests:0,edielMessages:0}
 for(const [key,t]of Object.entries(effects))out[key]=(await db.query(`select * from public.${t} order by id`)).rows.map(row=>JSON.parse(JSON.stringify(row)))
 return out}
function actualAssertion(){const body=native.match(/\/\/ BEGIN_LIFECYCLE_PACKAGE_ASSERTION\n([\s\S]*?)\/\/ END_LIFECYCLE_PACKAGE_ASSERTION/)?.[1]
 assert.ok(body,'actual native baseline/delta assertion absent')
 const js=ts.transpile(body,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS})
 return runInThisContext('(function(assert){'+js+'\nreturn assertApprovedPackage;})')(assert)}

test('actual company legal-profile trigger generates four baseline publication events before lifecycle command',async()=>{
 const db=await fixture();try{const before=await state(db)
  assert.equal(before.domain.length,4)
  assert.ok(before.domain.every(row=>row.event_type==='contracts.publication.changed'&&row.source==='database'))
  assert.deepEqual(before.domain.map(row=>row.payload.reason).sort(),['tenant_legal_profiles.insert','tenant_legal_profiles.insert','tenant_legal_profiles.update','tenant_legal_profiles.update'])
  assert.equal(before.fanout.length,0);assert.equal(before.timeline.length,0);assert.equal(before.intents.length,0)
  await record(db);const after=await state(db);assert.equal(after.domain.length,5)
  assert.throws(()=>{for(const key of Object.keys(effects))assert.equal(after[key].length,1,`old_absolute_count:${key}`)},/old_absolute_count:domain/)
 }finally{await db.close()}
})
test('actual native oracle preserves baseline and binds one complete newly approved package to operation/source/key/IDs',async()=>{
 const db=await fixture();try{const before=await state(db),receipt=await record(db),after=await state(db)
  const selected=actualAssertion()(f,before,after)
  assert.equal(selected.timeline.id,receipt.operationEventId);assert.equal(selected.domain.id,receipt.domainEventId);assert.equal(selected.intents.id,receipt.notificationJobId)
  assert.equal(selected.fanout.domain_event_id,receipt.domainEventId)
  const terminal=await state(db);await record(db);assert.deepEqual(await state(db),terminal)
 }finally{await db.close()}
})
test('actual late required-intent failure keeps all publication baseline rows and clean retry adds one package',async()=>{
 const db=await fixture();try{await db.exec(`create function private.baseline_late_intent_fault()returns trigger language plpgsql as $$begin raise exception 'baseline_late_intent_fault'using errcode='P0001';end$$;
  create trigger baseline_late_intent_fault before insert on public.customer_operation_jobs for each row execute function private.baseline_late_intent_fault();`)
  const before=await state(db);await assert.rejects(record(db),e=>e.code==='P0001');assert.deepEqual(await state(db),before)
  await db.exec('drop trigger baseline_late_intent_fault on public.customer_operation_jobs;drop function private.baseline_late_intent_fault()')
  await record(db);actualAssertion()(f,before,await state(db))
 }finally{await db.close()}
})
test('actual oracle rejects changed baseline, an extra unbound row and wrong source/operation with named collection diagnostics',async()=>{
 const db=await fixture();try{const before=await state(db);await record(db);const after=await state(db),check=actualAssertion()
  const modified=structuredClone(after);modified.domain.find(row=>row.id===before.domain[0].id).payload.reason='changed'
  assert.throws(()=>check(f,before,modified),/lifecycle_baseline_preserved:domain/)
  const extra=structuredClone(after);extra.domain.push({...after.domain.find(row=>row.idempotency_key===f.key),id:id(999)})
  assert.throws(()=>check(f,before,extra),/lifecycle_delta_count:domain/)
  const wrong=structuredClone(after);wrong.intents[0].payload.source_event_id='another'
  assert.throws(()=>check(f,before,wrong),/lifecycle_binding:intents/)
  const operation=structuredClone(after);operation.timeline[0].operation_id=id(999)
  assert.throws(()=>check(f,before,operation),/lifecycle_binding:timeline/)
 }finally{await db.close()}
})
