// Finding 20261029-3f1a8ab1/claude-track5/001: customer_portal_write_idempotency
// required customer_id, so every customer-less Partner API write (customer,
// contract, webhook subscription) and the customer-portal identity sync failed
// with 23502/HTTP 500. Real local SQL/PostgREST and the real ledger owner
// (lib/api/strictRequest.ts) and Partner API route; synthetic tenants only.
import {execFileSync} from 'node:child_process'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {NextRequest} from 'next/server'
import {beforeAll,expect,it} from 'vitest'
import {executeIdempotentPortalWrite} from '@/lib/api/strictRequest'
import {POST as partnerPost} from '@/app/api/partner/v1/[[...path]]/route'

const CUSTOMERLESS_ROUTES=[
 '/api/partner/v1/customer','/api/partner/v1/contract','/api/partner/v1/webhook/subscription',
 '/api/partner/v1/customers','/api/partner/v1/contracts','/api/partner/v1/webhooks/subscriptions',
 '/api/v1/customer-portal/sync',
]
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('portal_idempotency_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:20000,
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
  operation:'/api/v1/customer/profile-update',payload:{},execute:async()=>{executed=true;return {statusCode:200,body:{}}}})).rejects.toBeTruthy()
 expect(executed).toBe(false)
 expect(ledgerRows(A,'/api/v1/customer/profile-update',key)).toBe(0)
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
