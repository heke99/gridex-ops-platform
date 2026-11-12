import {beforeEach, expect, it, vi} from 'vitest'
const port=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,journal:[] as string[],rpc:vi.fn(),from:vi.fn(),activationFailure:''}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:port.from,rpc:port.rpc}}))
import {saveEdielSystemTestSettings} from '@/lib/ediel/systemTestSettings'
const company='10000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000002',profile='10000000-0000-4000-8000-000000000003',route='10000000-0000-4000-8000-000000000004',snapshot='10000000-0000-4000-8000-000000000005'
type QueryResult = {data: unknown; error: null | {code:string}}
type Query = {select:()=>Query; eq:(k:string,v:unknown)=>Query; order:()=>Query; limit:()=>Query; or:(value:string)=>Query; insert:(v:Record<string,unknown>)=>Query; update:(v:Record<string,unknown>)=>Query; single:()=>Query; maybeSingle:()=>Query; then:Promise<QueryResult>['then']}
const input={companyId:company,actorUserId:actor,testSuite:'TGT' as const,testPortalEdielId:'97002',actorRole:'esco',messageFamily:'UTILTS',setupPackage:'custom',environmentType:'tgt_test',routeProfileId:route,isActive:true}
beforeEach(()=>{
 port.activationFailure='';port.journal=[];port.tables={ediel_actor_settings:[{id:profile,company_id:company,environment:'test',is_active:true,actor_role:'energy_service_company',role:'energy_service_company',actor_ediel_id:'97001'}],ediel_counterparties:[],ediel_system_test_settings:[],ediel_active_test_configurations:[],audit_logs:[]}
 port.rpc.mockReset();port.rpc.mockImplementation(async(name:string)=>{port.journal.push('rpc:'+name);if(name==='canonical_capture_ediel_test_configuration_snapshot')return{data:{id:snapshot},error:null};if(name==='canonical_reconcile_ediel_test_capability_v1')return{data:{allowed:true,companyId:company,configurationId:port.tables.ediel_active_test_configurations.at(-1)?.id},error:null};throw new Error('unexpected_rpc:'+name)})
 port.from.mockImplementation((table:string)=>{
  if(!port.tables[table])throw new Error('unexpected_table:'+table)
  let operation='select',payload:Record<string,unknown>|undefined,single=false;const filters:((r:Record<string,unknown>)=>boolean)[]=[]
  const q:Query={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},order:()=>q,limit:()=>q,or:(value:string)=>{const clauses=value.split(',').map(c=>c.split('.'));filters.push(r=>clauses.some(([key,op,v])=>op==='eq'&&r[key]===v));return q},insert:(v:Record<string,unknown>)=>{operation='insert';payload=v;return q},update:(v:Record<string,unknown>)=>{operation='update';payload=v;return q},single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},then:(resolve,reject)=>Promise.resolve().then(()=>{
    let rows=port.tables[table].filter(r=>filters.every(f=>f(r)))
    if(operation==='insert'&&table==='ediel_active_test_configurations'&&port.activationFailure==='error')return{data:null,error:{code:'23514'}}
    if(operation==='insert'){const row={id:'10000000-0000-4000-8000-'+String(10+port.tables[table].length).padStart(12,'0'),...payload};port.tables[table].push(row);rows=[row];if(table==='ediel_active_test_configurations'&&port.activationFailure==='missing-id')rows=[{}];port.journal.push('insert:'+table)}
    if(operation==='update'){rows.forEach(r=>Object.assign(r,payload));port.journal.push('update:'+table)}
    return{data:single?(rows[0]??null):rows,error:null}
  }).then(resolve,reject)};return q
 })
})
it('CONTROL: real settings module completes snapshot, activation and scoped settings readback',async()=>{
 const result=await saveEdielSystemTestSettings(input)
 expect(result.companyId).toBe(company);expect(result.actorRole).toBe('esco');expect(result.routeProfileId).toBe(route)
 expect(port.tables.ediel_active_test_configurations).toHaveLength(1)
 expect(port.tables.ediel_active_test_configurations[0]).toMatchObject({company_id:company,actor_profile_id:profile,route_profile_id:route,configuration_snapshot_id:snapshot,environment_type:'tgt_test',status:'active'})
 expect(port.journal.indexOf('rpc:canonical_capture_ediel_test_configuration_snapshot')).toBeLessThan(port.journal.indexOf('insert:ediel_active_test_configurations'))
})
it('RED: successful canonical activation must request computed test-capability reconciliation, not leave seeded denial unchanged',async()=>{
 await saveEdielSystemTestSettings(input)
 expect(port.tables.ediel_active_test_configurations).toHaveLength(1)
 const afterActivation=port.journal.slice(port.journal.indexOf('insert:ediel_active_test_configurations')+1)
 expect(afterActivation,'missing computed reconcile after successful activation').toContain('rpc:canonical_reconcile_ediel_test_capability_v1')
})

it('returned reconciliation error propagates before audit/success, preserving explicit partial configuration persistence',async()=>{
 const normal=port.rpc.getMockImplementation()!
 port.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='canonical_reconcile_ediel_test_capability_v1'?{data:null,error:{code:'23514',message:'qualification rejected'}}:normal(name,...args))
 await expect(saveEdielSystemTestSettings(input)).rejects.toMatchObject({code:'23514'})
 expect(port.tables.ediel_active_test_configurations).toHaveLength(1)
 expect(port.tables.audit_logs).toHaveLength(0)
})
it.each([null,{}, {allowed:false}, {allowed:true,companyId:'foreign',configurationId:'foreign'}])('missing/denied/mismatched computed result is not configuration success: %j',async decision=>{
 const normal=port.rpc.getMockImplementation()!
 port.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='canonical_reconcile_ediel_test_capability_v1'?{data:decision,error:null}:normal(name,...args))
 await expect(saveEdielSystemTestSettings(input)).rejects.toThrow('kunde inte kvalificeras')
 expect(port.tables.audit_logs).toHaveLength(0)
})
it('snapshot error stops before activation/reconcile/audit',async()=>{
 port.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'snapshot denied'}})
 await expect(saveEdielSystemTestSettings(input)).rejects.toMatchObject({code:'42501'})
 expect(port.tables.ediel_active_test_configurations).toHaveLength(0)
 expect(port.tables.audit_logs).toHaveLength(0)
 expect(port.rpc).toHaveBeenCalledTimes(1)
})
it('AGT saves no TGT capability basis and asserts no portal certification',async()=>{
 await saveEdielSystemTestSettings({...input,environmentType:'agt_test',testSuite:'AGT'})
 expect(port.rpc.mock.calls.map(c=>c[0])).toEqual(['canonical_capture_ediel_test_configuration_snapshot'])
 expect(port.tables.ediel_active_test_configurations[0]).toMatchObject({environment_type:'agt_test'})
 expect(port.tables).not.toHaveProperty('ediel_agt_readiness')
})
it('computed producer uses exact company, actor and inserted configuration ID after activation',async()=>{
 await saveEdielSystemTestSettings(input)
 expect(port.rpc).toHaveBeenLastCalledWith('canonical_reconcile_ediel_test_capability_v1',{p_company_id:company,p_actor_user_id:actor,p_configuration_id:port.tables.ediel_active_test_configurations[0].id})
 expect(port.tables).not.toHaveProperty('company_capabilities')
})

it.each(['error','missing-id'])('activation %s stops before computed admission/audit',async failure=>{
 port.activationFailure=failure
 await expect(saveEdielSystemTestSettings(input)).rejects.toBeDefined()
 expect(port.rpc.mock.calls.map(c=>c[0])).toEqual(['canonical_capture_ediel_test_configuration_snapshot'])
 expect(port.tables.audit_logs).toHaveLength(0)
})
it.each(['foreign-tenant','different-role','ambiguous-role'])('normal actor selector denies %s before snapshot/activation',async variant=>{
 if(variant==='foreign-tenant')port.tables.ediel_actor_settings[0].company_id='foreign'
 if(variant==='different-role')Object.assign(port.tables.ediel_actor_settings[0],{actor_role:'supplier',role:'supplier'})
 if(variant==='ambiguous-role')port.tables.ediel_actor_settings.push({...port.tables.ediel_actor_settings[0],id:'another'})
 await expect(saveEdielSystemTestSettings(input)).rejects.toThrow()
 expect(port.rpc).not.toHaveBeenCalled()
 expect(port.tables.ediel_active_test_configurations).toHaveLength(0)
})

// Actual candidate PL/pgSQL and mailbox SQL projection, over declared in-memory
// host rows only. These ready-shaped rows are trigger input states, not evidence
// of canonical/native/company qualification or a substitute positive fixture.
async function mailboxSqlComponent(shared=false) {
 const {PGlite}=await import('@electric-sql/pglite')
 const {readFileSync}=await import('node:fs')
 const sql=readFileSync(new URL('../supabase/migrations/20261110120000_canonical_ediel_test_capability_reconciliation_v1.sql',import.meta.url),'utf8')
 const marker='CREATE FUNCTION gridex_ediel_test_capability.invalidate_v1()'
 const start=sql.indexOf(marker),end=sql.indexOf('$b4$;',start)+6
 if(start<0||end<6)throw new Error('actual_invalidator_not_found')
 const projectionStart=sql.indexOf('select ',sql.indexOf('if r.mailbox_id is not null then'))+7
 const projectionEnd=sql.indexOf(' into mailbox_json',projectionStart)
 if(projectionStart<7||projectionEnd<projectionStart)throw new Error('actual_mailbox_projection_not_found')
 const projection=sql.slice(projectionStart,projectionEnd)
 const db=new PGlite()
 await db.exec(`CREATE SCHEMA gridex_ediel_test_capability;
 CREATE TABLE public.company_capabilities(company_id uuid,capability_code text,enabled boolean,readiness_status text,configuration jsonb,blockers text[],updated_at timestamptz);
 CREATE TABLE public.ediel_active_test_configurations(id uuid,company_id uuid,route_profile_id uuid);
 CREATE TABLE public.ediel_route_profiles(id uuid,company_id uuid,mailbox_id uuid);
 CREATE TABLE public.ediel_mailboxes(id uuid,company_id uuid,is_active boolean,secret_reference text,last_polled_at timestamptz,last_successful_poll_at timestamptz,locked_at timestamptz,locked_by text,last_error text,updated_at timestamptz);
 INSERT INTO public.company_capabilities VALUES('${company}','ediel_test',true,'ready','{}','{}',now());
 INSERT INTO public.ediel_mailboxes VALUES('${profile}','${company}',true,'env:SYNTHETIC_TEST_ONLY',null,null,null,null,null,now());`)
 const projectionMarker='CREATE FUNCTION gridex_ediel_test_capability.mailbox_configuration_v1('
 if(sql.includes(projectionMarker)) {
  const a=sql.indexOf(projectionMarker),b=sql.indexOf('$b4$;',a)+6
  await db.exec(sql.slice(a,b))
 }
 if(shared) await db.exec(`
 UPDATE public.ediel_mailboxes SET company_id=null;
 UPDATE public.company_capabilities SET configuration=jsonb_build_object('configurationId','${snapshot}');
 INSERT INTO public.ediel_active_test_configurations VALUES('${snapshot}','${company}','${route}');
 INSERT INTO public.ediel_route_profiles VALUES('${route}','${company}','${profile}');
 INSERT INTO public.company_capabilities VALUES('${actor}','ediel_test',true,'ready','{}','{}',now());`)
 await db.exec(sql.slice(start,end))
 await db.exec('CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_mailboxes FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();')
 const fingerprint=async()=> (await db.query<{value:unknown}>(`select ${projection} value from public.ediel_mailboxes m`)).rows[0].value
 const enabled=async()=> (await db.query<{enabled:boolean}>('select enabled from public.company_capabilities')).rows[0].enabled
 return {db,fingerprint,enabled}
}
it('F1 RED: actual poll-start/finish bookkeeping does not invalidate unchanged mailbox configuration',async()=>{
 const {db,enabled}=await mailboxSqlComponent()
 try {
  await db.exec(`update public.ediel_mailboxes set last_polled_at=now(),locked_at=now(),locked_by='synthetic-poll',last_error=null,updated_at=now();`)
  expect(await enabled(),'ordinary poll-start invalidated configuration').toBe(true)
  await db.exec(`update public.ediel_mailboxes set last_successful_poll_at=now(),locked_at=null,locked_by=null,last_error=null,updated_at=now();`)
  expect(await enabled(),'ordinary poll-finish invalidated configuration').toBe(true)
  await db.exec(`update public.ediel_mailboxes set secret_reference='env:OTHER_SYNTHETIC_TEST_ONLY',updated_at=now();`)
  expect(await enabled(),'credential-reference change must invalidate').toBe(false)
 } finally {await db.close()}
})
it('F1 RED: actual witness mailbox projection excludes successful-poll telemetry but retains configuration',async()=>{
 const {db,fingerprint}=await mailboxSqlComponent()
 try {
  const before=await fingerprint()
  await db.exec(`update public.ediel_mailboxes set last_successful_poll_at=now(),last_polled_at=now(),last_error='synthetic failure',locked_by='synthetic',locked_at=now(),updated_at=now();`)
  expect(await fingerprint()).toEqual(before)
  await db.exec('update public.ediel_mailboxes set is_active=false;')
  expect(await fingerprint()).not.toEqual(before)
 } finally {await db.close()}
})

it('F1 RED: shared mailbox polling preserves both tenants; semantic changes invalidate only dependent evidence',async()=>{
 const {db,fingerprint}=await mailboxSqlComponent(true)
 const caps=async()=> (await db.query<{company_id:string;enabled:boolean}>('select company_id,enabled from public.company_capabilities order by company_id')).rows
 try {
  const before=await fingerprint(), original=await caps()
  await db.exec(`update public.ediel_mailboxes set last_polled_at=now(),locked_at=now(),locked_by='synthetic-shared',last_error=null,updated_at=now();`)
  expect(await caps(),'shared poll-start must not block unrelated tenants').toEqual(original)
  await db.exec(`update public.ediel_mailboxes set last_successful_poll_at=now(),locked_at=null,locked_by=null,updated_at=now();`)
  expect(await caps()).toEqual(original);expect(await fingerprint()).toEqual(before)
  await db.exec('update public.ediel_mailboxes set is_active=false;')
  expect(await caps()).toEqual([{company_id:company,enabled:false},{company_id:actor,enabled:true}])
 } finally {await db.close()}
})
