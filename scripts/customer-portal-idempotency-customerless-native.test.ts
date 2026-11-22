// Finding 20261029-3f1a8ab1/claude-track5/001: customer_portal_write_idempotency
// required customer_id, so every customer-less Partner API write (customer,
// contract, webhook subscription) and the customer-portal identity sync failed
// with 23502/HTTP 500. Real local SQL/PostgREST and the real ledger owner
// (lib/api/strictRequest.ts) and Partner API route; synthetic tenants only.
import {execFileSync} from 'node:child_process'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {NextRequest} from 'next/server'
import {beforeAll,expect,it} from 'vitest'
import {appendFileSync,lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {claimPortalWriteIdempotency,executeIdempotentPortalWrite} from '@/lib/api/strictRequest'
import {GET as partnerGet,POST as partnerPost,DELETE as partnerDelete} from '@/app/api/partner/v1/[[...path]]/route'
import {requireIntegrationApiAccess} from '@/lib/integrations/apiAuth'
import {supabaseService} from '@/lib/supabase/service'

const CUSTOMERLESS_ROUTES=[
 '/api/partner/v1/customer','/api/partner/v1/contract','/api/partner/v1/webhook/subscription',
 '/api/partner/v1/customers','/api/partner/v1/contracts','/api/partner/v1/webhooks/subscriptions',
 '/api/v1/customer-portal/sync',
]
const PHASE=process.env.GRIDEX_CUSTOMERLESS_NATIVE_PHASE
if(!['baseline','upgrade','clean'].includes(String(PHASE)))throw Error('customerless_qualified_config_required')
const CHECK='customer_portal_write_idempotency_customer_required_check'
const FORWARD=resolve(__dirname,'../supabase/migrations/20261101084405_customer_portal_idempotency_customerless_forward_guard.sql')
const WEBHOOK_FORWARD=resolve(__dirname,'../supabase/migrations/20261101092632_webhook_subscription_physical_compatibility_forward.sql')
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('portal_idempotency_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input:`\\set VERBOSITY verbose\n${input}`,encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe'],
 }).trim()
}
function sqlError(input:string):string{
 try{sql(input);return ''}catch(error){return String((error as {stderr?:unknown}).stderr??error)}
}
function company(label:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(id)},${literal(`Synthetic idempotency ${label}`)},'active');`)
 return id
}
/** Launch-ready Partner API client exactly as authenticate_integration_request_v1 requires. */
function partnerClient(companyId:string,scopes:string[]):{id:string;token:string}{
 const id=randomUUID(),prefix=`gdxp_${randomBytes(4).toString('hex').slice(0,7)}`
 const token=`${prefix}.${randomBytes(32).toString('base64url')}`
 rememberSecret(token)
 const scopeArray=`ARRAY[${scopes.map(literal).join(',')}]::text[]`
 sql(`INSERT INTO public.integration_api_clients(id,company_id,name,status,key_prefix,secret_hash,scopes,rate_limit_per_minute)
   VALUES(${literal(id)},${literal(companyId)},'Synthetic partner','active',${literal(prefix)},${literal(createHash('sha256').update(token).digest('hex'))},${scopeArray},600);
  UPDATE public.integration_api_clients SET launch_ready=true,launch_blockers='[]'::jsonb WHERE id=${literal(id)};
  INSERT INTO public.tenant_website_installation_receipts(company_id,api_client_id,environment,profile_key,idempotency_key,state,scopes,receipt_sha256,completed_at)
   VALUES(${literal(companyId)},${literal(id)},'production','tenant_website',${literal(`native-${id}`)},'completed',${scopeArray},${literal(randomBytes(32).toString('hex'))},now());
  UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(companyId)} AND capability_code='api_sales';`)
 return {id,token}
}
function request(path:string,key:string):NextRequest{
 return new NextRequest(new URL(path,'http://127.0.0.1:3000'),{method:'POST',headers:{'idempotency-key':key}})
}
const ledgerRows=(companyId:string,route:string,key:string)=>Number(sql(`SELECT count(*) FROM public.customer_portal_write_idempotency
 WHERE company_id=${literal(companyId)} AND route=${literal(route)} AND idempotency_key=${literal(key)}`))

let A='',B='',clientA='',clientB=''
beforeAll(()=>{
 A=company('A');B=company('B')
 clientA=partnerClient(A,['partner_customers.write']).id
 clientB=partnerClient(B,['partner_customers.write']).id
})

// The original five donor callback bodies below are retained. They qualify the
// shared owner plus ONE actual HTTP handler, not seven complete business APIs.
if(PHASE!=='baseline'){
it('accepts a customer-less claim on each of the seven server-constant routes and deduplicates a replay',async()=>{
 for(const route of CUSTOMERLESS_ROUTES){
  const key=randomUUID()
  let executions=0
  const write=()=>executeIdempotentPortalWrite({request:request(route,key),companyId:A,clientId:clientA,customerId:null,
   operation:route,payload:{route,probe:1},execute:async()=>{executions+=1;return {statusCode:201,body:{created:executions}}}})
  const first=await write()
  const replay=await write()
  expect(first).toMatchObject({statusCode:201,body:{created:1},replayed:false})
  expect(replay).toMatchObject({statusCode:201,body:{created:1},replayed:true})
  expect(executions).toBe(1)
  expect(ledgerRows(A,route,key)).toBe(1)
  const changed=executeIdempotentPortalWrite({request:request(route,key),companyId:A,clientId:clientA,customerId:null,
   operation:route,payload:{route,probe:2},execute:async()=>{executions+=1;return {statusCode:201,body:{}}}})
  await expect(changed).rejects.toMatchObject({code:'idempotency_conflict',status:409})
  expect(executions).toBe(1)
 }
})

it('still refuses a customer-less row on every other route',async()=>{
 const key=randomUUID()
 for(const route of ['/api/v1/customer/profile-update','/api/v1/customer/sync','/api/v1/staff/customers/[ref]/contact','/api/partner/v1/customer/x']){
  expect(sqlError(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
   VALUES(${literal(A)},${literal(clientA)},NULL,${literal(route)},${literal(key)},repeat('a',64),'processing');`))
   .toMatch(/customer_portal_write_idempotency_customer_required_check/)
 }
 let executed=false
 await expect(executeIdempotentPortalWrite({request:request('/api/v1/customer/profile-update',key),companyId:A,clientId:clientA,customerId:null,
  operation:'/api/v1/customer/profile-update',payload:{},execute:async()=>{executed=true;return {statusCode:200,body:{}}}}))
  .rejects.toMatchObject({code:'23514',message:expect.stringContaining('customer_portal_write_idempotency_customer_required_check')})
 expect(executed).toBe(false)
 expect(ledgerRows(A,'/api/v1/customer/profile-update',key)).toBe(0)
})

it('keeps the same customer-less key and route independent per tenant',async()=>{
 const route='/api/partner/v1/customer',key=randomUUID()
 const runs={A:0,B:0}
 const write=(companyId:string,clientId:string,tenant:'A'|'B')=>executeIdempotentPortalWrite({request:request(route,key),companyId,clientId,
  customerId:null,operation:route,payload:{route,tenant},execute:async()=>{runs[tenant]+=1;return {statusCode:201,body:{tenant}}}})
 await expect(write(A,clientA,'A')).resolves.toMatchObject({statusCode:201,body:{tenant:'A'},replayed:false})
 // Same key and route from tenant B: B's own write runs; A's stored response is never returned.
 await expect(write(B,clientB,'B')).resolves.toMatchObject({statusCode:201,body:{tenant:'B'},replayed:false})
 await expect(write(B,clientB,'B')).resolves.toMatchObject({statusCode:201,body:{tenant:'B'},replayed:true})
 expect(runs).toEqual({A:1,B:1})
 expect(ledgerRows(A,route,key)).toBe(1)
 expect(ledgerRows(B,route,key)).toBe(1)
})

it('rejects a customer-less row whose API client belongs to another tenant',()=>{
 expect(sqlError(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
  VALUES(${literal(A)},${literal(clientB)},NULL,'/api/partner/v1/customer',${literal(randomUUID())},repeat('a',64),'processing');`))
  .toMatch(/customer_portal_write_idempotency_company_client_fkey/)
})

it('records the server-constant route for a real Partner API customer write, not the request path',async()=>{
 const {token}=partnerClient(A,['partner_customers.write'])
 const key=randomUUID()
 const body={first_name:'Synthetic',last_name:'Ledger',soc_id:'199001019802',customer_type:'PRIVATE',invoice_address:'Testgatan 1',
  zip_code:'12345',city:'Teststad',country:'SE',email:`ledger-${randomUUID().slice(0,8)}@example.invalid`,cell_phone:'0701234567'}
 const call=(search:string)=>partnerPost(new NextRequest(new URL(`/api/partner/v1/customer${search}`,'http://127.0.0.1:3000'),{
  method:'POST',headers:{authorization:`Bearer ${token}`,'idempotency-key':key,'content-type':'application/json'},body:JSON.stringify(body)}),
  {params:Promise.resolve({path:['customer']})})
 const created=await call('?route=/api/v1/customer/profile-update')
 const createdBody=await created.json() as {entity_id?:string}
 expect(created.status,JSON.stringify(createdBody)).toBe(201)
 const replay=await call('')
 expect(replay.status).toBe(201)
 expect(await replay.json()).toEqual(createdBody)
 const rows=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('route',route,'customer',customer_id,'status',status)),'[]') FROM public.customer_portal_write_idempotency
  WHERE company_id=${literal(A)} AND idempotency_key=${literal(key)}`)) as {route:string;customer:string|null;status:string}[]
 expect(rows).toEqual([{route:'/api/partner/v1/customer',customer:null,status:'completed'}])
 expect(Number(sql(`SELECT count(*) FROM public.customers WHERE company_id=${literal(A)} AND customer_reference=${literal(createdBody.entity_id??'')}`))).toBe(1)
 expect(ledgerRows(B,'/api/partner/v1/customer',key)).toBe(0)
})
}

type Retained={company:string;client:string;customer:string;keys:Record<string,string>;rows:unknown;catalog:unknown;webhooks:string[];webhookRows:Record<string,unknown>[];webhookCatalog:unknown;deliveries:string[];deliveryRows:unknown}
function privatePath(path:string|undefined,exists:boolean):string{
 const temp=process.env.RUNNER_TEMP
 if(!temp||!path||resolve(path)!==path||!path.startsWith(temp+'/')||realpathSync(dirname(path))!==dirname(path))throw Error('customerless_private_retained_path')
 if(exists){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)||s.size>1048576)throw Error('customerless_private_retained_identity')}
 return path
}
function rememberSecret(value:string){
 const path=privatePath(process.env.GRIDEX_CUSTOMERLESS_SECRET_VALUES,true)
 appendFileSync(path,JSON.stringify(value)+'\n',{mode:0o600})
}
const rowsFor=(ids:string[])=>JSON.parse(sql(`SELECT coalesce(json_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.customer_portal_write_idempotency t WHERE idempotency_key=ANY(ARRAY[${ids.map(literal).join(',')}]::text[]);`)) as unknown
function catalog():unknown{
 return JSON.parse(sql(`SELECT json_build_object(
 'table',(SELECT json_build_object('oid',oid,'owner',relowner,'rls',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl) FROM pg_class WHERE oid='public.customer_portal_write_idempotency'::regclass),
 'columns',(SELECT json_agg(json_build_object('name',attname,'type',atttypid,'collation',attcollation,'required',CASE WHEN attname='customer_id' THEN NULL ELSE attnotnull END) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.customer_portal_write_idempotency'::regclass AND attnum>0 AND NOT attisdropped),
 'constraints',(SELECT json_agg(json_build_object('oid',oid,'name',conname,'type',contype,'valid',convalidated,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.customer_portal_write_idempotency'::regclass AND conname<>${literal(CHECK)}),
 'indexes',(SELECT json_agg(json_build_object('oid',i.indexrelid,'def',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'nullsNotDistinct',i.indnullsnotdistinct) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid='public.customer_portal_write_idempotency'::regclass),
 'triggers',(SELECT json_agg(json_build_object('oid',oid,'name',tgname,'enabled',tgenabled,'def',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.customer_portal_write_idempotency'::regclass)
 );`))
}
function customer(companyId:string,mergedInto?:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,is_test_data${mergedInto?',merged_into_customer_id':''}) VALUES(${literal(id)},${literal(companyId)},'Synthetic','Retained',true${mergedInto?','+literal(mergedInto):''});`)
 return id
}
function owner(companyId:string,clientId:string,customerId:string|null,route:string,key:string,payload:unknown,execute:()=>Promise<{statusCode:number;body:unknown}>){
 return executeIdempotentPortalWrite({request:request(route,key),companyId,clientId,customerId,operation:route,payload,execute})
}
function loadRetained():Retained{
 const path=privatePath(process.env.GRIDEX_CUSTOMERLESS_RETAINED,true),bytes=readFileSync(path)
 if(createHash('sha256').update(bytes).digest('hex')!==process.env.GRIDEX_CUSTOMERLESS_RETAINED_SHA256)throw Error('customerless_retained_sha_mismatch')
 return JSON.parse(bytes.toString()) as Retained
}
function webhookCatalog():unknown{
 return JSON.parse(sql(`SELECT json_build_object(
 'table',(SELECT json_build_object('oid',oid,'owner',relowner,'rls',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl) FROM pg_class WHERE oid='public.webhook_subscriptions'::regclass),
 'columns',(SELECT json_agg(json_build_object('name',a.attname,'type',a.atttypid,'mod',a.atttypmod,'collation',a.attcollation,'required',a.attnotnull,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.webhook_subscriptions'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname NOT IN ('api_client_id','description','metadata','last_success_at','last_failure_at')),
 'constraints',(SELECT json_agg(json_build_object('oid',oid,'name',conname,'type',contype,'valid',convalidated,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.webhook_subscriptions'::regclass AND conname NOT IN ('webhook_subscriptions_company_client_fkey','webhook_subscriptions_metadata_object_check')),
 'indexes',(SELECT json_agg(json_build_object('oid',i.indexrelid,'def',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.webhook_subscriptions'::regclass AND c.relname<>'webhook_subscriptions_company_client_endpoint_uidx'),
 'triggers',(SELECT json_agg(json_build_object('oid',t.oid,'name',t.tgname,'enabled',t.tgenabled,'def',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid='public.webhook_subscriptions'::regclass AND NOT EXISTS(SELECT FROM pg_constraint c WHERE c.oid=t.tgconstraint AND c.conrelid=t.tgrelid AND c.conname='webhook_subscriptions_company_client_fkey')),
 'policies',(SELECT json_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid='public.webhook_subscriptions'::regclass)
 );`))
}
const webhookRows=(ids:string[])=>JSON.parse(sql(`SELECT coalesce(json_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.webhook_subscriptions s WHERE id=ANY(ARRAY[${ids.map(literal).join(',')}]::uuid[]);`)) as Record<string,unknown>[]
const deliveryRows=(ids:string[])=>JSON.parse(sql(`SELECT coalesce(json_agg(to_jsonb(d) ORDER BY id),'[]') FROM public.webhook_deliveries d WHERE id=ANY(ARRAY[${ids.map(literal).join(',')}]::uuid[]);`)) as unknown
const webhookArgs=(companyId:string,clientId:string,endpoint:string,secret:string)=>({p_company_id:companyId,p_api_client_id:clientId,p_name:'Synthetic native webhook',p_endpoint_url:endpoint,p_event_types:['site.created'],p_secret:secret,p_description:'Native local fixture'})
async function createWebhook(companyId:string,clientId:string,endpoint:string,secret:string){
 rememberSecret(secret)
 const result=await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',webhookArgs(companyId,clientId,endpoint,secret))
 if(result.error)throw Error('native_webhook_create:'+result.error.code)
 const data=result.data as {webhook_subscription_reference?:string}
 expect(typeof data.webhook_subscription_reference).toBe('string')
 const row=JSON.parse(sql(`SELECT to_json(s) FROM public.webhook_subscriptions s WHERE company_id=${literal(companyId)} AND webhook_subscription_reference=${literal(data.webhook_subscription_reference!)};`)) as Record<string,unknown>
 expect(row).toMatchObject({company_id:companyId,api_client_id:clientId,description:'Native local fixture',endpoint_url:endpoint,metadata:{source:'partner_api',secret_store:'supabase_vault'}})
 expect(String(row.signing_secret_hash)===createHash('sha256').update(secret).digest('hex')).toBe(true)
 return row
}

if(PHASE==='baseline'){
 it('BASELINE: actual current NOT NULL rejects each NULL owner claim specifically23502 before effects',async()=>{
  expect(sql("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.customer_portal_write_idempotency'::regclass AND attname='customer_id';")).toBe('t')
  for(const route of CUSTOMERLESS_ROUTES){let effects=0;const key=randomUUID()
   await expect(owner(A,clientA,null,route,key,{route},async()=>{effects++;return{statusCode:201,body:{}}})).rejects.toMatchObject({code:'23502'})
   expect(effects).toBe(0);expect(ledgerRows(A,route,key)).toBe(0)
  }
 })
 it('BASELINE: authenticated/scoped actual customer POST observes real23502 and no customer or claim effect',async()=>{
  const client=partnerClient(A,['partner_customers.write']),key=randomUUID()
  const make=()=>new NextRequest('http://127.0.0.1:3000/api/partner/v1/customer',{method:'POST',headers:{authorization:`Bearer ${client.token}`,'idempotency-key':key,'content-type':'application/json'},body:JSON.stringify({first_name:'Synthetic',last_name:'Baseline',soc_id:'199001019802',customer_type:'PRIVATE',invoice_address:'Testgatan 1',zip_code:'12345',city:'Teststad',country:'SE',email:`baseline-${key}@example.invalid`,cell_phone:'0701234567'})})
  const access=await requireIntegrationApiAccess(make(),['partner_customers.write'])
  expect(access.ok,'baseline actual Auth/scope prerequisite').toBe(true)
  if(!access.ok)throw Error('baseline_customer_auth_scope_unqualified')
  expect(access.client).toMatchObject({id:client.id,company_id:A})
  const before=sql(`SELECT count(*) FROM public.customers WHERE company_id=${literal(A)};`)
  const original=globalThis.fetch,traces:Array<{code:unknown;route:unknown;customer:unknown}>=[]
  // Pass through the real SDK fetch/response. This observes the actual route's
  // database cause; a generic500, fake error or separate owner loop is insufficient.
  globalThis.fetch=async(input,init)=>{
   const response=await original(input,init),url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
   if(url.origin==='http://127.0.0.1:54321'&&url.pathname==='/rest/v1/customer_portal_write_idempotency'&&init?.method==='POST'&&typeof init.body==='string'){
    const body=JSON.parse(init.body) as Record<string,unknown>
    if(body.idempotency_key===key){const result=await response.clone().json() as {code?:unknown};traces.push({code:result.code,route:body.route,customer:body.customer_id})}
   }
   return response
  }
  let response:Response
  try{response=await partnerPost(make(),{params:Promise.resolve({path:['customer']})})}finally{globalThis.fetch=original}
  expect(response.status).toBe(500)
  expect(traces).toEqual([{code:'23502',route:'/api/partner/v1/customer',customer:null}])
  expect(ledgerRows(A,'/api/partner/v1/customer',key)).toBe(0)
  expect(sql(`SELECT count(*) FROM public.customers WHERE company_id=${literal(A)};`)).toBe(before)
 })
 it('BASELINE: qualified actual webhook owner reaches missing physical column42703 and rolls back its Vault write',async()=>{
  expect(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='webhook_subscriptions';")).toBe('24')
  const secret='native-'+randomBytes(32).toString('hex');rememberSecret(secret)
  const before=sql('SELECT count(*) FROM vault.secrets;')
  const result=await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',webhookArgs(A,clientA,`https://${randomUUID()}.example.invalid/hook`,secret))
  expect(result.error).toMatchObject({code:'42703'})
  expect(sql('SELECT count(*) FROM vault.secrets;')).toBe(before)
  expect(sql(`SELECT count(*) FROM public.webhook_subscriptions WHERE company_id=${literal(A)};`)).toBe('0')
 })
 it('BASELINE: actual forward refuses wrong and unvalidated same-name constraints atomically',()=>{
  const source=readFileSync(FORWARD,'utf8'),before=catalog()
  const wrong=[`CHECK(true)`,`CHECK(customer_id IS NOT NULL OR true)`,`CHECK(customer_id IS NOT NULL OR route IN (${CUSTOMERLESS_ROUTES.map(literal).join(',')},'/not-allowed'))`,`CHECK(customer_id IS NOT NULL OR route IN (${CUSTOMERLESS_ROUTES.map(literal).join(',')})) NOT VALID`,`UNIQUE(response_status)`]
  for(const definition of wrong){
   const error=sqlError(`BEGIN; ALTER TABLE public.customer_portal_write_idempotency ADD CONSTRAINT ${CHECK} ${definition};\n${source}\nROLLBACK;`)
   expect(error).toMatch(/55000/);expect(error).toContain('customerless_required_check_conflict')
   expect(sql("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.customer_portal_write_idempotency'::regclass AND attname='customer_id';")).toBe('t')
   expect(catalog()).toEqual(before)
   expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid='public.customer_portal_write_idempotency'::regclass AND conname=${literal(CHECK)};`)).toBe('0')
  }
  // Simulate an already applied immutable donor in a rollback-only transaction.
  expect(sql(`BEGIN; ALTER TABLE public.customer_portal_write_idempotency ADD CONSTRAINT ${CHECK} CHECK(customer_id IS NOT NULL OR route IN (${CUSTOMERLESS_ROUTES.map(literal).join(',')})); ALTER TABLE public.customer_portal_write_idempotency ALTER COLUMN customer_id DROP NOT NULL;\n${source}\nSELECT 'matching_prior_accepted'; ROLLBACK;`)).toContain('matching_prior_accepted')
  expect(catalog()).toEqual(before)
 })
 it('BASELINE: seed real nonnull completed/failed/stale records for SAME-database upgrade retention',async()=>{
  const c=customer(A),route='/api/v1/customer/profile-update',keys={completed:randomUUID(),failed:randomUUID(),processing:randomUUID()}
  await expect(owner(A,clientA,c,route,keys.completed,{retained:true},async()=>({statusCode:201,body:{retained:true}}))).resolves.toMatchObject({replayed:false})
  await expect(owner(A,clientA,c,route,keys.failed,{retained:true},async()=>{throw Error('controlled_preupgrade_failure')})).rejects.toThrow('controlled_preupgrade_failure')
  await claimPortalWriteIdempotency({idempotencyKey:keys.processing,companyId:A,clientId:clientA,customerId:c,operation:route,payload:{retained:true}})
  sql(`UPDATE public.customer_portal_write_idempotency SET started_at=now()-interval '1 hour' WHERE company_id=${literal(A)} AND idempotency_key=${literal(keys.processing)};`)
  const legacySecret='legacy-'+randomBytes(32).toString('hex');rememberSecret(legacySecret)
  const vault=sql(`SELECT vault.create_secret(${literal(legacySecret)},${literal('native-retained-'+randomUUID())},'Native legacy retention fixture');`)
  expect(vault).toMatch(/^[a-f0-9-]{36}$/)
  const subscriptions=[randomUUID(),randomUUID()],endpoint=`https://${randomUUID()}.example.invalid/legacy`
  for(const id of subscriptions)sql(`INSERT INTO public.webhook_subscriptions(id,company_id,name,endpoint_url,event_types,status,signing_algorithm,signing_secret_ref,signing_secret_hash,failure_count) VALUES(${literal(id)},${literal(A)},'Native retained independent legacy',${literal(endpoint)},ARRAY['site.created'],'active','HMAC-SHA256',${literal(vault)},${literal(createHash('sha256').update(legacySecret).digest('hex'))},2);`)
  // Synthetic historical ROWS for DDL retention, not observed deliveries or a
  // business-event PASS. Never dispatch these artificial failed records.
  const event=randomUUID(),deliveries=[randomUUID(),randomUUID()]
  sql(`INSERT INTO public.domain_events(id,company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,source,payload) VALUES(${literal(event)},${literal(A)},'site.created','site',${literal('site_native_retention_'+event)},${literal(c)},'native_row_retention_fixture','{"legacy_native_fixture":true}'::jsonb);`)
  for(const [i,id] of deliveries.entries()){
   const payload=JSON.stringify({legacy_native_fixture:true,ordinal:i}),hash=createHash('sha256').update(payload).digest('hex')
   sql(`INSERT INTO public.webhook_deliveries(id,company_id,webhook_subscription_id,domain_event_id,event_type,status,attempts,idempotency_key,payload,target_url,public_delivery_id,request_body_hash,response_status,response_body) VALUES(${literal(id)},${literal(A)},${literal(subscriptions[i])},${literal(event)},'site.created','failed',2,${literal('native-retained:'+id)},${literal(payload)}::jsonb,${literal(endpoint)},${literal('delivery_'+hash.slice(0,32))},${literal(hash)},500,'native retained fixture');`)
  }
  const retained:Retained={company:A,client:clientA,customer:c,keys,rows:rowsFor(Object.values(keys)),catalog:catalog(),webhooks:subscriptions,webhookRows:webhookRows(subscriptions),webhookCatalog:webhookCatalog(),deliveries,deliveryRows:deliveryRows(deliveries)}
  writeFileSync(privatePath(process.env.GRIDEX_CUSTOMERLESS_RETAINED,false),JSON.stringify(retained),{flag:'wx',mode:0o600})
  expect((retained.rows as unknown[]).length).toBe(3)
 })
 it('BASELINE: actual physical forward rejects incompatible profiles and preserves neutral legacy backfill in a rollback',()=>{
  const r=JSON.parse(readFileSync(privatePath(process.env.GRIDEX_CUSTOMERLESS_RETAINED,true),'utf8')) as Retained,source=readFileSync(WEBHOOK_FORWARD,'utf8')
  const cases=[
   {ddl:'ALTER TABLE public.webhook_subscriptions ADD COLUMN api_client_id text;',reason:'webhook_physical_column_conflict:api_client_id'},
   {ddl:"ALTER TABLE public.webhook_subscriptions ADD COLUMN metadata jsonb; UPDATE public.webhook_subscriptions SET metadata='[]'::jsonb;",reason:'webhook_metadata_object_conflict'},
   {ddl:"ALTER TABLE public.webhook_subscriptions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb; ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_metadata_object_check CHECK(true);",reason:'webhook_metadata_check_conflict'},
   {ddl:'ALTER TABLE public.webhook_subscriptions ADD COLUMN api_client_id uuid; ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_company_client_fkey FOREIGN KEY(api_client_id) REFERENCES public.integration_api_clients(id) ON DELETE SET NULL;',reason:'webhook_client_delete_policy_conflict'},
   {ddl:'ALTER TABLE public.webhook_subscriptions ADD COLUMN api_client_id uuid; ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_company_client_fkey FOREIGN KEY(company_id,api_client_id) REFERENCES public.integration_api_clients(company_id,id) NOT VALID;',reason:'webhook_company_client_fk_conflict'},
   {ddl:'CREATE INDEX webhook_subscriptions_company_client_endpoint_uidx ON public.webhook_subscriptions(company_id);',reason:'webhook_client_endpoint_index_conflict'},
  ]
  for(const c of cases){
   const error=sqlError(`BEGIN; ${c.ddl}\n${source}\nROLLBACK;`)
   expect(error).toMatch(/55000/);expect(error).toContain(c.reason)
   expect(webhookCatalog()).toEqual(r.webhookCatalog);expect(webhookRows(r.webhooks)).toEqual(r.webhookRows);expect(deliveryRows(r.deliveries)).toEqual(r.deliveryRows)
   expect(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='webhook_subscriptions';")).toBe('24')
  }
  const first=r.webhookRows[0],second=r.webhookRows[1]
  const preserved=sql(`BEGIN; ALTER TABLE public.webhook_subscriptions ADD COLUMN metadata jsonb; UPDATE public.webhook_subscriptions SET metadata='{"known":"preserved"}'::jsonb WHERE id=${literal(String(first.id))};\n${source}\nSELECT ((SELECT metadata='{"known":"preserved"}'::jsonb AND updated_at=${literal(String(first.updated_at))}::timestamptz FROM public.webhook_subscriptions WHERE id=${literal(String(first.id))}) AND (SELECT metadata='{}'::jsonb AND updated_at=${literal(String(second.updated_at))}::timestamptz FROM public.webhook_subscriptions WHERE id=${literal(String(second.id))})); ROLLBACK;`)
  expect(preserved).toBe('t');expect(webhookRows(r.webhooks)).toEqual(r.webhookRows)
 })
}

if(PHASE!=='baseline'){
 it('catalog: exact validated seven-operation CHECK, customer nullable, route required, both key domains and FKs retained',()=>{
  const state=JSON.parse(sql(`SELECT json_build_object('nullable',NOT a.attnotnull,'routeRequired',(SELECT attnotnull FROM pg_attribute WHERE attrelid=a.attrelid AND attname='route'),'type',c.contype,'valid',c.convalidated,'definition',pg_get_constraintdef(c.oid)) FROM pg_attribute a JOIN pg_constraint c ON c.conrelid=a.attrelid AND c.conname=${literal(CHECK)} WHERE a.attrelid='public.customer_portal_write_idempotency'::regclass AND a.attname='customer_id';`)) as {nullable:boolean;routeRequired:boolean;type:string;valid:boolean;definition:string}
  expect(state).toMatchObject({nullable:true,routeRequired:true,type:'c',valid:true})
  for(const route of CUSTOMERLESS_ROUTES)expect(state.definition).toContain(literal(route))
  const indexes=sql("SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indrelid='public.customer_portal_write_idempotency'::regclass ORDER BY indexrelid;")
  expect(indexes).toContain('(company_id, api_client_id, customer_id, route, idempotency_key)')
  expect(indexes).toContain('(company_id, api_client_id, route, idempotency_key) WHERE (customer_id IS NULL)')
  const constraints=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.customer_portal_write_idempotency'::regclass AND contype='f';")
  expect(constraints).toContain('(company_id, api_client_id)');expect(constraints).toContain('(customer_id, company_id)')
  // Actual writer re-applies the exact source; its semantic comparison must be usable.
  expect(sql(`BEGIN;\n${readFileSync(FORWARD,'utf8')}\nSELECT 'idempotent_forward'; ROLLBACK;`)).toContain('idempotent_forward')
 })
 it('denies exact-case/prefix/query variants and missing required route with precise SQLSTATE and zero row effects',()=>{
  for(const route of ['/API/partner/v1/customer','/api/partner/v1/customer/','/api/partner/v1/customer?x=1','/api/partner/v1/customers/x','/api/v1/customer-portal/sync-more']){
   const key=randomUUID(),error=sqlError(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,route,idempotency_key,request_hash,status) VALUES(${literal(A)},${literal(clientA)},${literal(route)},${literal(key)},repeat('a',64),'processing');`)
   expect(error).toMatch(/23514/);expect(error).toContain(CHECK);expect(ledgerRows(A,route,key)).toBe(0)
  }
  expect(sqlError(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,idempotency_key,request_hash,status) VALUES(${literal(A)},${literal(clientA)},${literal(randomUUID())},repeat('a',64),'processing');`)).toMatch(/23502/)
 })
 it('keeps two clients in one tenant and two operations for one client in separate durable key domains',async()=>{
  const second=partnerClient(A,['partner_customers.write']).id,key=randomUUID();let effects=0
  for(const [client,route] of [[clientA,CUSTOMERLESS_ROUTES[0]],[second,CUSTOMERLESS_ROUTES[0]],[clientA,CUSTOMERLESS_ROUTES[1]]]){
   const write=()=>owner(A,client,null,route,key,{client,route},async()=>({statusCode:201,body:{ordinal:++effects}}))
   await expect(write()).resolves.toMatchObject({replayed:false});await expect(write()).resolves.toMatchObject({replayed:true})
  }
  expect(effects).toBe(3)
 })
 it('same-key concurrent owner claims have exactly one effect and a durable replay; no hash stealing',async()=>{
  const route=CUSTOMERLESS_ROUTES[0],key=randomUUID();let effects=0,release:()=>void=()=>{},entered:()=>void=()=>{}
  const gate=new Promise<void>(r=>{release=r}),started=new Promise<void>(r=>{entered=r})
  const write=()=>owner(A,clientA,null,route,key,{concurrent:true},async()=>{effects++;entered();await gate;return{statusCode:201,body:{once:true}}})
  const first=write()
  try{await Promise.race([started,first.then(()=>{throw Error('customerless_concurrent_callback_not_entered')})]);await expect(write()).rejects.toMatchObject({code:'idempotency_in_progress',status:409});await expect(owner(A,clientA,null,route,key,{concurrent:false},async()=>{effects++;return{statusCode:201,body:{}}})).rejects.toMatchObject({code:'idempotency_conflict',status:409})}finally{release()}
  await expect(first).resolves.toMatchObject({replayed:false});await expect(write()).resolves.toMatchObject({replayed:true,body:{once:true}})
  expect(effects).toBe(1);expect(ledgerRows(A,route,key)).toBe(1)
 })
 it('nonnull customer tenant and merged guards survive; anon/authenticated cannot write the ledger',async()=>{
  const c=customer(A),foreign=customer(B),merged=customer(A,c),route='/api/v1/customer/profile-update'
  for(const [id,code,message] of [[foreign,'23514','customer_portal_customer_not_found_for_tenant'],[randomUUID(),'23514','customer_portal_customer_not_found_for_tenant']]){
   let effects=0;await expect(owner(A,clientA,id,route,randomUUID(),{},async()=>{effects++;return{statusCode:200,body:{}}})).rejects.toMatchObject({code,message});expect(effects).toBe(0)
  }
  const mergedError=sqlError(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status) VALUES(${literal(A)},${literal(clientA)},${literal(merged)},${literal(route)},${literal(randomUUID())},repeat('a',64),'processing');`)
  expect(mergedError).toMatch(/23514/);expect(mergedError).toContain('customer_merged_write_conflict')
  let mergedEffects=0;await expect(owner(A,clientA,merged,route,randomUUID(),{},async()=>{mergedEffects++;return{statusCode:200,body:{}}})).rejects.toMatchObject({code:'portal_identity_customer_conflict',status:409});expect(mergedEffects).toBe(0)
  for(const role of ['anon','authenticated']){
   const error=sqlError(`BEGIN; SET LOCAL ROLE ${role}; INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status) VALUES(${literal(A)},${literal(clientA)},NULL,${literal(CUSTOMERLESS_ROUTES[0])},${literal(randomUUID())},repeat('a',64),'processing'); ROLLBACK;`)
   expect(error).toMatch(/42501/)
  }
 })
 it('real customer handler denies missing authentication and forbidden scope before claim or customer mutation',async()=>{
  const denied=partnerClient(A,['partner_contracts.read']).token
  const before=sql(`SELECT count(*) FROM public.customers WHERE company_id=${literal(A)};`)
  for(const [token,status] of [['',401],[denied,403]] as const){
   const key=randomUUID(),response=await partnerPost(new NextRequest('http://127.0.0.1:3000/api/partner/v1/customer',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`} :{}),'idempotency-key':key,'content-type':'application/json'},body:JSON.stringify({first_name:'Synthetic'})}),{params:Promise.resolve({path:['customer']})})
   expect(response.status).toBe(status);expect(ledgerRows(A,CUSTOMERLESS_ROUTES[0],key)).toBe(0)
  }
  expect(sql(`SELECT count(*) FROM public.customers WHERE company_id=${literal(A)};`)).toBe(before)
 })
 it('physical webhook catalog is exact, validated and idempotent, with neutral object metadata',()=>{
  const columns=JSON.parse(sql("SELECT json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='webhook_subscriptions' AND column_name IN ('api_client_id','description','metadata','last_success_at','last_failure_at');")) as Array<Record<string,unknown>>
  expect(columns).toEqual([
   {name:'api_client_id',type:'uuid',nullable:'YES',default:null},
   {name:'description',type:'text',nullable:'YES',default:null},
   {name:'last_failure_at',type:'timestamp with time zone',nullable:'YES',default:null},
   {name:'last_success_at',type:'timestamp with time zone',nullable:'YES',default:null},
   {name:'metadata',type:'jsonb',nullable:'NO',default:"'{}'::jsonb"},
  ])
  const fk=JSON.parse(sql("SELECT json_build_object('valid',convalidated,'type',contype,'delete',confdeltype,'update',confupdtype,'match',confmatchtype,'deferred',condeferrable,'definition',pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.webhook_subscriptions'::regclass AND conname='webhook_subscriptions_company_client_fkey';")) as Record<string,unknown>
  expect(fk).toMatchObject({valid:true,type:'f',delete:'a',update:'a',match:'s',deferred:false})
  expect(fk.definition).toContain('FOREIGN KEY (company_id, api_client_id) REFERENCES integration_api_clients(company_id, id)')
  const index=JSON.parse(sql("SELECT json_build_object('unique',indisunique,'valid',indisvalid,'ready',indisready,'immediate',indimmediate,'nullsNotDistinct',indnullsnotdistinct,'keys',indnkeyatts,'definition',pg_get_indexdef(indexrelid)) FROM pg_index WHERE indexrelid='public.webhook_subscriptions_company_client_endpoint_uidx'::regclass;")) as Record<string,unknown>
  expect(index).toMatchObject({unique:true,valid:true,ready:true,immediate:true,nullsNotDistinct:false,keys:3})
  expect(index.definition).toContain('(company_id, api_client_id, endpoint_url)')
  expect(index.definition).toContain("(api_client_id IS NOT NULL)")
  const before=webhookCatalog()
  expect(sql(`BEGIN;\n${readFileSync(WEBHOOK_FORWARD,'utf8')}\nSELECT 'physical_idempotent'; ROLLBACK;`)).toContain('physical_idempotent')
  expect(webhookCatalog()).toEqual(before)
  const bad=sqlError(`INSERT INTO public.webhook_subscriptions(company_id,name,endpoint_url,event_types,metadata) VALUES(${literal(A)},'Native invalid metadata','https://metadata.example.invalid',ARRAY['site.created'],'[]'::jsonb);`)
  expect(bad).toMatch(/23514/);expect(bad).toContain('webhook_subscriptions_metadata_object_check')
 })
 it('actual scoped SQL owner/Vault reader and authenticated HTTP list/delete preserve client and tenant boundaries',async()=>{
  const client=partnerClient(A,['partner_webhooks.manage']),foreign=partnerClient(B,['partner_webhooks.manage']),secret='native-'+randomBytes(32).toString('hex')
  const row=await createWebhook(A,client.id,`https://${randomUUID()}.example.invalid/owned`,secret),id=String(row.id),reference=String(row.webhook_subscription_reference)
  const read=await supabaseService.rpc('gridex_read_webhook_signing_secret_v1',{p_company_id:A,p_subscription_id:id})
  expect(read.error===null).toBe(true);expect(read.data===secret).toBe(true)
  const deniedRead=await supabaseService.rpc('gridex_read_webhook_signing_secret_v1',{p_company_id:B,p_subscription_id:id})
  expect(deniedRead.error===null).toBe(true);expect(deniedRead.data===null).toBe(true)
  const list=async(token:string)=>partnerGet(new NextRequest('http://127.0.0.1:3000/api/partner/v1/webhooks/subscriptions',{headers:{authorization:`Bearer ${token}`}}),{params:Promise.resolve({path:['webhooks','subscriptions']})})
  const own=await list(client.token);expect(own.status).toBe(200)
  const ownBody=await own.json() as {data:{subscriptions:Array<Record<string,unknown>>}}
  expect(ownBody.data.subscriptions.map(s=>s.webhook_subscription_reference)).toEqual([reference])
  expect(JSON.stringify(ownBody).includes(secret)).toBe(false)
  const other=await list(foreign.token);expect(other.status).toBe(200)
  expect((await other.json() as {data:{subscriptions:unknown[]}}).data.subscriptions).toEqual([])
  const before=sql('SELECT count(*) FROM vault.secrets;')
  const deniedCreate=await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',webhookArgs(A,foreign.id,`https://${randomUUID()}.example.invalid/foreign`,secret))
  expect(deniedCreate.error?.code).toBe('42501');expect(sql('SELECT count(*) FROM vault.secrets;')).toBe(before)
  const denyDelete=await supabaseService.rpc('gridex_delete_partner_webhook_subscription_v1',{p_company_id:B,p_api_client_id:foreign.id,p_subscription_reference:reference})
  expect(denyDelete.error===null).toBe(true);expect(denyDelete.data===false).toBe(true)
  for(const role of ['anon','authenticated']){
   const error=sqlError(`BEGIN; SET LOCAL ROLE ${role}; SELECT public.gridex_read_webhook_signing_secret_v1(${literal(A)},${literal(id)}); ROLLBACK;`)
   expect(error).toMatch(/42501/)
  }
  const physical=sqlError(`DELETE FROM public.integration_api_clients WHERE id=${literal(client.id)};`)
  expect(physical).toMatch(/23503/)
  expect(webhookRows([id])[0]).toMatchObject({api_client_id:client.id,company_id:A})
  const deleted=await partnerDelete(new NextRequest(`http://127.0.0.1:3000/api/partner/v1/webhooks/subscriptions/${reference}`,{method:'DELETE',headers:{authorization:`Bearer ${client.token}`}}),{params:Promise.resolve({path:['webhooks','subscriptions',reference]})})
  expect(deleted.status).toBe(200);expect(webhookRows([id])).toEqual([])
  expect(sql(`SELECT count(*) FROM vault.secrets WHERE id=${literal(String(row.signing_secret_ref))}::uuid;`)).toBe('0')
 })
 it('actual concurrent webhook owners enforce the intended client/endpoint index without leaking a losing Vault secret',async()=>{
  const client=partnerClient(A,['partner_webhooks.manage']),second=partnerClient(A,['partner_webhooks.manage']),secret='native-'+randomBytes(32).toString('hex'),endpoint=`https://${randomUUID()}.example.invalid/concurrent`
  rememberSecret(secret)
  const before=Number(sql('SELECT count(*) FROM vault.secrets;'))
  const result=await Promise.all([1,2].map(()=>supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',webhookArgs(A,client.id,endpoint,secret))))
  expect(result.filter(r=>r.error===null)).toHaveLength(1)
  const loser=result.find(r=>r.error!==null)!.error!
  expect(loser.code).toBe('23505');expect(loser.message).toContain('webhook_subscriptions_company_client_endpoint_uidx')
  expect(Number(sql('SELECT count(*) FROM vault.secrets;'))).toBe(before+1)
  expect(sql(`SELECT count(*) FROM public.webhook_subscriptions WHERE company_id=${literal(A)} AND api_client_id=${literal(client.id)} AND endpoint_url=${literal(endpoint)};`)).toBe('1')
  await createWebhook(A,second.id,endpoint,secret)
  const raw=()=>`INSERT INTO public.webhook_subscriptions(company_id,name,endpoint_url,event_types) VALUES(${literal(A)},'Native independent legacy',${literal(endpoint)},ARRAY['site.created']);`
  sql(raw()+raw())
  expect(sql(`SELECT count(*) FROM public.webhook_subscriptions WHERE company_id=${literal(A)} AND endpoint_url=${literal(endpoint)} AND api_client_id IS NULL;`)).toBe('2')
  const foreign=sqlError(`INSERT INTO public.webhook_subscriptions(company_id,api_client_id,name,endpoint_url,event_types) VALUES(${literal(B)},${literal(client.id)},'Native invalid link',${literal(endpoint)},ARRAY['site.created']);`)
  expect(foreign).toMatch(/23503/);expect(foreign).toContain('webhook_subscriptions_company_client_fkey')
 })
}
if(PHASE==='upgrade'){
 it('UPGRADE: retains exact legacy rows/catalog and durable responses without rerunning uncertain effects',async()=>{
  const r=loadRetained();expect(rowsFor(Object.values(r.keys))).toEqual(r.rows);expect(catalog()).toEqual(r.catalog)
  expect(webhookCatalog()).toEqual(r.webhookCatalog)
  expect(webhookRows(r.webhooks)).toEqual(r.webhookRows.map(row=>({...row,api_client_id:null,description:null,metadata:{},last_success_at:null,last_failure_at:null})))
  expect(deliveryRows(r.deliveries)).toEqual(r.deliveryRows)
  for(const row of r.webhookRows){const secret=await supabaseService.rpc('gridex_read_webhook_signing_secret_v1',{p_company_id:r.company,p_subscription_id:String(row.id)});expect(secret.error===null).toBe(true);expect(typeof secret.data==='string'&&createHash('sha256').update(secret.data).digest('hex')===row.signing_secret_hash).toBe(true)}
  const route='/api/v1/customer/profile-update';let effects=0
  const write=(key:string)=>owner(r.company,r.client,r.customer,route,key,{retained:true},async()=>{effects++;return{statusCode:201,body:{wrong:true}}})
  await expect(write(r.keys.completed)).resolves.toMatchObject({replayed:true,statusCode:201,body:{retained:true}})
  await expect(write(r.keys.processing)).rejects.toMatchObject({code:'idempotency_reconciliation_required',status:409})
  await expect(write(r.keys.failed)).rejects.toMatchObject({code:'idempotency_previous_attempt_failed',status:409})
  expect(effects).toBe(0);expect(rowsFor(Object.values(r.keys))).toEqual(r.rows)
 })
}
