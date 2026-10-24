// reality-defects: F114
// Actual SQL core and source-extracted dependencies, isolated in PGlite. This
// checks committed edits between the app pre-read and RPC, not a native stack.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

type Row = Record<string, unknown>
type Snapshot = { customer: string | null; site: string | null; metering_point: string | null }
type Command = Record<string, unknown> & { customer: Row; site: Row; metering_point: Row; ediel_existing_graph_snapshot?: Snapshot; ediel_existing_graph_preservation?: Record<'customer'|'site'|'metering_point',{wire_keys:string[];metadata_delta:Row}> }
const record = (value: unknown): Row => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {}

function fixtureSql(schema: string): string {
 const statements: string[] = []
 const functions = ['gridex_new_external_tenant_reference','gridex_new_public_resource_reference','gridex_normalize_org_number','gridex_normalize_personal_number','gridex_normalize_email','gridex_normalize_phone','gridex_normalize_facility_id','gridex_normalize_metering_point_id','gridex_update_jsonb_row','gridex_insert_jsonb_row','gridex_normalize_audit_context_v1']
 for (const name of functions) {
  const found = schema.match(new RegExp(String.raw`CREATE FUNCTION public\.${name}\(.*?\n(\$[^\n]*?\$);`, 's'))
  assert.ok(found, `Missing real SQL helper ${name}`)
  statements.push(found[0])
 }
 for (const name of ['companies','customer_onboarding_operations','customer_match_review_cases','customers','customer_sites','metering_points','customer_onboarding_applications','domain_events','event_outbox','audit_logs']) {
  const found = schema.match(new RegExp(String.raw`CREATE TABLE public\.${name} \(.*?\n\);`, 's'))
  assert.ok(found, `Missing real table DDL ${name}`)
  statements.push(found[0])
 }
 const outboxIndex = schema.match(/CREATE UNIQUE INDEX event_outbox_unique_named_destination_idx .*?;/)
 const auditTrigger = schema.match(/CREATE TRIGGER audit_logs_normalize_context_v1 .*?;/)
 assert.ok(outboxIndex); assert.ok(auditTrigger)
 return statements.join('\n\n')+'\n'+outboxIndex[0]+'\n'+auditTrigger[0]+'\nALTER TABLE public.customer_match_review_cases ADD UNIQUE (onboarding_operation_id);'
}

it('compares locked Ediel graph snapshots and rolls back stale updates while preserving valid onboarding and replay', async () => {
 const schema = fs.readFileSync(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8')
 const migrationDirectory = path.join(process.cwd(), 'supabase', 'migrations')
 const migrations = fs.readdirSync(migrationDirectory).filter(name => name.endsWith('_ediel_inbound_existing_graph_cas.sql'))
 expect(migrations).toHaveLength(1)
 const core = fs.readFileSync(path.join(migrationDirectory, migrations[0]), 'utf8')
 const db = new PGlite()
 const checks: { name: string; status: string; message?: string; code?: string }[] = []
 try {
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;')
  await db.exec(fixtureSql(schema))
  await db.exec('GRANT SELECT ON public.customers,public.customer_sites,public.metering_points TO service_role')
  await db.exec(fs.readFileSync(path.join(migrationDirectory,'20261024020125_ediel_inbound_graph_snapshot_basis.sql'),'utf8'))
  const capturedCore = schema.match(new RegExp(String.raw`CREATE FUNCTION public\.gridex_onboard_customer_graph_core\(p_command jsonb\).*?\n\$\$;`, 's'))
  assert.ok(capturedCore)
  const capturedDefinition = capturedCore[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
  await db.exec(capturedDefinition.replace('AS $$', () => 'AS $$\n-- unknown predecessor'))
  await expect(db.exec(core)).rejects.toMatchObject({ message: 'ediel_inbound_graph_core_predecessor_unqualified' })
  await db.exec(capturedDefinition)
  const metadataQuery = "SELECT prosecdef, proconfig, proacl, proowner FROM pg_proc WHERE oid = 'public.gridex_onboard_customer_graph_core(jsonb)'::regprocedure"
  const predecessorMetadata = (await db.query(metadataQuery)).rows
  await db.exec('SET ROLE service_role')
  try{await expect(db.query("SELECT public.ediel_inbound_graph_snapshot_basis_v1('00000000-0000-4000-8000-0000000002a0',NULL,NULL,NULL)")).rejects.toMatchObject({code:'55000',message:'ediel_inbound_graph_core_not_ready'})}
  finally{await db.exec('RESET ROLE')}
  await db.exec(core)
  await db.exec(core) // The explicitly qualified postimage is safe to reapply.
  expect((await db.query(metadataQuery)).rows).toEqual(predecessorMetadata)
const company='00000000-0000-4000-8000-0000000002a0',customer='00000000-0000-4000-8000-0000000002c2',site='00000000-0000-4000-8000-0000000002c3',point='00000000-0000-4000-8000-0000000002c4',actor='00000000-0000-4000-8000-0000000002c1';
 await db.query('INSERT INTO public.companies(id,name)VALUES($1,\'Synthetic tenant\')',[company]);
 await db.query("INSERT INTO public.customers(id,company_id,status,full_name,personal_number,customer_number,metadata)VALUES($1,$2,'active','Old name','199001011234','C-001','{\"crm\":\"kept\"}')",[customer,company]);
 await db.query("INSERT INTO public.customer_sites(id,company_id,customer_id,facility_id,status,street)VALUES($1,$2,$3,'735999999999999911','active','Old street')",[site,company,customer]);
 await db.query("INSERT INTO public.metering_points(id,company_id,customer_id,site_id,meter_point_id,status)VALUES($1,$2,$3,$4,'735999999999999911','active')",[point,company,customer,site]);
 const row=async (table: 'customers' | 'customer_sites' | 'metering_points'): Promise<Row> =>(await db.query<{ row: Row }>('SELECT to_jsonb(t) row FROM public.'+table+' t WHERE id=$1',[{customers:customer,customer_sites:site,metering_points:point}[table]])).rows[0].row;
 const snapshots=async()=>({customer:await row('customers'),site:await row('customer_sites'),metering_point:await row('metering_points')});
 const basis=async(companyId=company,customerId: string|null=customer,siteId: string|null=site,pointId: string|null=point): Promise<Snapshot> => {
  await db.exec('SET ROLE service_role')
  try{return (await db.query<{basis:Snapshot}>('SELECT public.ediel_inbound_graph_snapshot_basis_v1($1,$2,$3,$4) basis',[companyId,customerId,siteId,pointId])).rows[0].basis}
  finally{await db.exec('RESET ROLE')}
 };
 let count=0;
 const command=async(): Promise<Command> =>{const snapshot=await snapshots();return {company_id:company,actor_user_id:actor,channel:'ediel_inbound',idempotency_key:'synthetic-cas-'+(++count),matching_policy:'link_selected',existing_customer_id:customer,existing_site_id:site,existing_metering_point_id:point,update_existing:true,customer:{full_name:'Wire name',status:snapshot.customer.status,metadata:{inboundCaseId:'synthetic-case'}},site:{facility_id:'735999999999999911',status:snapshot.site.status,street:snapshot.site.street},metering_point:{meter_point_id:'735999999999999911',status:snapshot.metering_point.status},application:{source_record_type:'ediel_inbound_case',source_record_id:'synthetic-case'},ediel_existing_graph_snapshot:await basis(),ediel_existing_graph_preservation:{
  customer:{wire_keys:['full_name'],metadata_delta:{inboundCaseId:'synthetic-case'}},
  site:{wire_keys:['facility_id'],metadata_delta:{}},metering_point:{wire_keys:['meter_point_id'],metadata_delta:{}},
 }}};
 const execute=async (cmd: Command)=>(await db.query<{ result: Row }>('SELECT public.gridex_onboard_customer_graph_core($1::jsonb) result',[JSON.stringify(cmd)])).rows[0].result;
 const observe=async (name: string, test: () => Promise<void>)=>{try{await test();checks.push({name,status:'PASS'})}catch(error){checks.push({name,status:'FAIL',message:String(error),code:error instanceof Error && 'code' in error ? String(error.code) : undefined})}};
 await observe('unchanged row permits wire update, keeps active statuses, adds lineage, emits one real application/outbox',async()=>{
  const cmd=await command();const result=await execute(cmd);assert.equal(result.ok,true);assert.equal((await row('customers')).full_name,'Wire name');assert.equal((await row('customers')).status,'active');assert.equal(record((await row('customers')).metadata).crm,'kept');assert.equal(record((await row('customers')).metadata).inboundCaseId,'synthetic-case');assert.equal((await row('customer_sites')).street,'Old street');assert.equal((await row('metering_points')).status,'active');assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM public.event_outbox')).rows[0].n,1);
 });
 const races=[['customer status','customers',"status='terminated'"],['customer metadata','customers',"metadata=metadata||'{\"concurrent\":true}'::jsonb"],['site address','customer_sites',"street='Concurrent street'"],['meter lifecycle','metering_points',"status='closed'"],['site reparent','customer_sites',"customer_id='00000000-0000-4000-8000-000000000999'"],['meter reparent','metering_points',"customer_id='00000000-0000-4000-8000-000000000999'"]] as const;
 for(const [name,table,edit] of races)await observe('committed '+name+' change rejects stale graph atomically',async()=>{
  const before=await snapshots(),cmd=await command();await db.exec(`UPDATE public.${table} SET ${edit}`);const changed=await snapshots();const beforeCounts=(await db.query('SELECT (SELECT count(*) FROM public.customer_onboarding_operations)::int ops,(SELECT count(*) FROM public.customer_onboarding_applications)::int apps,(SELECT count(*) FROM public.event_outbox)::int outbox')).rows[0];
  let error: unknown;try{await execute(cmd)}catch(e){error=e}assert.ok(error instanceof Error,'stale command must reject');assert.match(error.message,/ediel_inbound_graph_changed|selected_site_not_found_for_customer_tenant|selected_metering_point_not_found_for_customer_tenant/);assert.deepEqual(await snapshots(),changed);assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM public.customer_onboarding_operations)::int ops,(SELECT count(*) FROM public.customer_onboarding_applications)::int apps,(SELECT count(*) FROM public.event_outbox)::int outbox')).rows[0],beforeCounts);
  await db.query('SELECT public.gridex_update_jsonb_row(\'public.'+table+'\'::regclass,$1,$2,$3::jsonb)',[{customers:customer,customer_sites:site,metering_points:point}[table],company,JSON.stringify(before[({customers:'customer',customer_sites:'site',metering_points:'metering_point'} as const)[table]])]);
 });
 await observe('missing snapshot fails closed without graph writes',async()=>{const cmd=await command();delete cmd.ediel_existing_graph_snapshot;const before=await snapshots();let error: unknown;try{await execute(cmd)}catch(e){error=e}assert.ok(error instanceof Error);assert.match(error.message,/ediel_inbound_graph_snapshot_required/);assert.deepEqual(await snapshots(),before)});
 await observe('expected absent customer cannot overwrite a newly matching row',async()=>{const cmd=await command();cmd.existing_customer_id=null;cmd.matching_policy='link_unique';cmd.customer.personal_number='199001011234';assert.ok(cmd.ediel_existing_graph_snapshot);cmd.ediel_existing_graph_snapshot.customer=null;const before=await snapshots();let error: unknown;try{await execute(cmd)}catch(e){error=e}assert.ok(error instanceof Error);assert.match(error.message,/ediel_inbound_graph_changed/);assert.deepEqual(await snapshots(),before)});
 for(const entity of ['site','metering_point'] as const)await observe('expected absent '+entity+' cannot overwrite a newly matching row',async()=>{const cmd=await command();delete cmd[entity==='site'?'existing_site_id':'existing_metering_point_id'];assert.ok(cmd.ediel_existing_graph_snapshot);cmd.ediel_existing_graph_snapshot[entity]=null;const before=await snapshots();let error: unknown;try{await execute(cmd)}catch(e){error=e}assert.ok(error instanceof Error);assert.match(error.message,/ediel_inbound_graph_changed/);assert.deepEqual(await snapshots(),before)});
 await observe('equivalent PostgREST UTC timestamp spelling does not cause a false graph conflict',async()=>{const cmd=await command();for(const key of ['customer','site','metering_point'] as const){const value=cmd.ediel_existing_graph_snapshot?.[key];if(value&&cmd.ediel_existing_graph_snapshot)cmd.ediel_existing_graph_snapshot[key]=value.replaceAll('+00:00\"','Z\"');}assert.equal((await execute(cmd)).ok,true)});
 await observe('malformed snapshot fails before graph changes',async()=>{const cmd=await command();cmd.ediel_existing_graph_snapshot={customer:null,site:[] as unknown as string,metering_point:null};const before=await snapshots();let error: unknown;try{await execute(cmd)}catch(e){error=e}assert.ok(error instanceof Error);assert.match(error.message,/ediel_inbound_graph_snapshot_required/);assert.deepEqual(await snapshots(),before)});
 await observe('explicitly refreshed command can retry after a concurrent edit without losing its new address',async()=>{const stale=await command();await db.exec("UPDATE public.customer_sites SET street='New preserved address'");let error: unknown;try{await execute(stale)}catch(e){error=e}assert.ok(error instanceof Error);const fresh=await command();fresh.idempotency_key=stale.idempotency_key;assert.equal((await execute(fresh)).ok,true);assert.equal((await row('customer_sites')).street,'New preserved address')});
 await observe('non-Ediel existing update still uses original core contract without snapshot',async()=>{const cmd=await command();cmd.channel='admin';delete cmd.ediel_existing_graph_snapshot;assert.equal((await execute(cmd)).ok,true)});
 await observe('valid completed operation replay returns original receipt before stale graph snapshot validation',async()=>{const cmd=await command();const first=await execute(cmd);await db.exec("UPDATE public.customer_sites SET street='After replay'");assert.deepEqual(await execute(cmd),first);assert.equal((await row('customer_sites')).street,'After replay')});

 for(const [section,table,id] of [['customer','customers',customer],['site','customer_sites',site],['metering_point','metering_points',point]] as const)await observe('unchanged '+section+' JSONB unsafe integer stays exact across two fresh opaque reads and RPC writes',async()=>{
  await db.query('UPDATE public.'+table+" SET metadata='{\"opaque_counter\":9007199254740993}'::jsonb WHERE id=$1",[id]);
  for(let repeat=0;repeat<2;repeat++){
   const cmd=await command();assert.ok(cmd.ediel_existing_graph_snapshot?.[section]?.includes('9007199254740993'));
   if(section==='site'){cmd.site.metadata={siteLineage:'safe'};cmd.ediel_existing_graph_preservation!.site.metadata_delta={siteLineage:'safe'}}
   if(section==='metering_point'){cmd.metering_point.metadata={pointLineage:'safe'};cmd.ediel_existing_graph_preservation!.metering_point.metadata_delta={pointLineage:'safe'}}
   assert.equal((await execute(cmd)).ok,true);
   assert.equal((await db.query<{value:string}>('SELECT metadata->>\'opaque_counter\' value FROM public.'+table+' WHERE id=$1',[id])).rows[0].value,'9007199254740993');
   const replay=await execute(cmd);assert.equal(replay.ok,true);
   const op=(await db.query<{snapshot:Row}>('SELECT command_snapshot snapshot FROM public.customer_onboarding_operations WHERE id=$1',[replay.operation_id])).rows[0].snapshot;
   // Inspect exact PostgreSQL text, never the driver's JS Number conversion.
   if(section==='customer')assert.equal((await db.query<{value:string}>("SELECT command_snapshot#>>'{customer,metadata,opaque_counter}' value FROM public.customer_onboarding_operations WHERE id=$1",[replay.operation_id])).rows[0].value,'9007199254740993');
   assert.ok(op.ediel_existing_graph_snapshot);
  }
 });
 await observe('a genuine later unsafe-integer metadata edit still rejects an opaque stale graph atomically',async()=>{
  const cmd=await command();await db.query("UPDATE public.customers SET metadata=jsonb_set(metadata,'{opaque_counter}','9007199254740995'::jsonb) WHERE id=$1",[customer]);
  await assert.rejects(execute(cmd),{code:'40001',message:'ediel_inbound_graph_changed'});
  assert.equal((await db.query<{value:string}>("SELECT metadata->>'opaque_counter' value FROM public.customers WHERE id=$1",[customer])).rows[0].value,'9007199254740995');
 });
 await observe('compatible reader is tenant/customer scoped and foreign IDs disclose no row text',async()=>{
  assert.deepEqual(await basis('00000000-0000-4000-8000-000000000999'),{customer:null,site:null,metering_point:null});
  assert.deepEqual(await basis(company,null,site,point),{customer:null,site:null,metering_point:null});
  const own=await basis(company,customer,'00000000-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000999');assert.ok(own.customer);assert.equal(own.site,null);assert.equal(own.metering_point,null);
 });
 await observe('compatible reader refuses absent company and every non-service caller, internal preservation is not service callable',async()=>{
  await assert.rejects(db.query('SELECT public.ediel_inbound_graph_snapshot_basis_v1($1,$2,$3,$4)',[company,customer,site,point]),{code:'42501'});
  await db.exec('SET ROLE service_role');try{
   await assert.rejects(db.query('SELECT public.ediel_inbound_graph_snapshot_basis_v1(NULL,$1,$2,$3)',[customer,site,point]),{code:'22023'});
   await assert.rejects(db.query("SELECT public.ediel_preserve_inbound_graph_payload_v1('{}','{}','{}')"),{code:'42501'});
  }finally{await db.exec('RESET ROLE')}
  await db.exec('SET ROLE anon');try{await assert.rejects(db.query('SELECT public.ediel_inbound_graph_snapshot_basis_v1($1,$2,$3,$4)',[company,customer,site,point]),{code:'42501'})}finally{await db.exec('RESET ROLE')}
 });
 for(const shape of ['missing','unknown-outer','unknown-inner','missing-inner','invalid-text','missing-preservation','bad-wire-mask'] as const)await observe('rejects '+shape+' basis/directive without side effects',async()=>{
  const cmd=await command();
  if(shape==='missing')delete cmd.ediel_existing_graph_snapshot;
  if(shape==='unknown-outer')(cmd.ediel_existing_graph_snapshot as unknown as Row).extra=null;
  if(shape==='unknown-inner'||shape==='missing-inner'){
   const raw=JSON.parse(cmd.ediel_existing_graph_snapshot!.customer!);if(shape==='unknown-inner')raw.extra=true;else delete raw.full_name;cmd.ediel_existing_graph_snapshot!.customer=JSON.stringify(raw);
  }
  if(shape==='invalid-text')cmd.ediel_existing_graph_snapshot!.customer='not JSON';
  if(shape==='missing-preservation')delete cmd.ediel_existing_graph_preservation;
  if(shape==='bad-wire-mask')cmd.ediel_existing_graph_preservation!.customer.wire_keys=['full_name','unknown'];
  const counts=(await db.query('SELECT (SELECT count(*) FROM public.customer_onboarding_operations)::int ops,(SELECT count(*) FROM public.customer_onboarding_applications)::int apps,(SELECT count(*) FROM public.event_outbox)::int outbox')).rows[0];
  await assert.rejects(execute(cmd));
  assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM public.customer_onboarding_operations)::int ops,(SELECT count(*) FROM public.customer_onboarding_applications)::int apps,(SELECT count(*) FROM public.event_outbox)::int outbox')).rows[0],counts);
 });
 console.log('F114_ACTUAL_SQL_CHECKS='+JSON.stringify(checks));

  expect(checks.filter(check => check.status === 'FAIL')).toEqual([])
  expect(checks).toHaveLength(29)
 } finally { await db.close() }
}, 30000)

it('supports clean lexical DDL order while preserving helper-first application rollout',async()=>{
 const schema=fs.readFileSync(path.join(process.cwd(),'supabase','schema.sql'),'utf8')
 const migrationDirectory=path.join(process.cwd(),'supabase','migrations')
 const core=fs.readFileSync(path.join(migrationDirectory,'20261023232109_ediel_inbound_existing_graph_cas.sql'),'utf8')
 const helper=fs.readFileSync(path.join(migrationDirectory,'20261024020125_ediel_inbound_graph_snapshot_basis.sql'),'utf8')
 const captured=schema.match(/CREATE FUNCTION public\.gridex_onboard_customer_graph_core\(p_command jsonb\).*?\n\$\$;/s)
 assert.ok(captured)
 const db=new PGlite()
 try{
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;')
  await db.exec(fixtureSql(schema))
  await db.exec(captured[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
  await db.exec(core) // Clean replay's older timestamp creates no helper DDL dependency.
  expect((await db.query("SELECT to_regprocedure('public.ediel_inbound_graph_snapshot_basis_v1(uuid,uuid,uuid,uuid)') value")).rows[0]).toEqual({value:null})
  await db.exec(helper)
  await db.exec('GRANT SELECT ON public.customers,public.customer_sites,public.metering_points TO service_role;SET ROLE service_role')
  try{
   expect((await db.query("SELECT public.ediel_inbound_graph_snapshot_basis_v1('00000000-0000-4000-8000-0000000002a0',NULL,NULL,NULL) basis")).rows[0]).toEqual({basis:{customer:null,site:null,metering_point:null}})
  }finally{await db.exec('RESET ROLE')}
 }finally{await db.close()}
},30000)
