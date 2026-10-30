// Finding 20261029-3f1a8ab1/claude-track5/002: the canonical webhook_subscriptions
// schema lacked api_client_id, description, metadata, last_success_at and
// last_failure_at. The Partner API RPC then failed with 42703, health projection
// was a silent no-op (no auto-pause) and every subscription was treated as a
// website subscription. Real local SQL/PostgREST and the real dispatcher; only the
// outbound HTTPS transport is an in-process recorder. Synthetic tenants only.
import {execFileSync} from 'node:child_process'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {beforeAll,beforeEach,expect,it,vi} from 'vitest'

const sent:{url:string;body:string}[]=[]
let transportStatus=200
vi.mock('@/lib/integrations/publicWebhookTransport',async(importOriginal)=>{
 const original=await importOriginal<typeof import('@/lib/integrations/publicWebhookTransport')>()
 return {...original,postPublicWebhook:vi.fn(async(input:{url:string;body:string})=>{
  sent.push({url:input.url,body:input.body})
  return {status:transportStatus,ok:transportStatus>=200&&transportStatus<300,body:'{}'}
 })}
})

const {supabaseService}=await import('@/lib/supabase/service')
const {emitDomainEvent}=await import('@/lib/events/domainEvents')
const {dispatchDueWebhookDeliveries,enqueueWebhookDeliveriesForEvent}=await import('@/lib/integrations/webhooks')

const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('webhook_partner_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:20000,
 }).trim()
}
function company(label:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(id)},${literal(`Synthetic webhook ${label}`)},'active');
  UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(id)} AND capability_code='webhooks';`)
 return id
}
function apiClient(companyId:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.integration_api_clients(id,company_id,name,status,key_prefix,secret_hash,scopes)
  VALUES(${literal(id)},${literal(companyId)},'Synthetic partner','active',${literal(`gdxp_${randomBytes(4).toString('hex').slice(0,7)}`)},
   ${literal(createHash('sha256').update(randomUUID()).digest('hex'))},ARRAY['partner_webhooks.manage']);`)
 return id
}
async function partnerSubscription(companyId:string,clientId:string,name:string){
 const secret=`synthetic-${randomUUID()}-${randomUUID()}`
 const {data,error}=await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',{
  p_company_id:companyId,p_api_client_id:clientId,p_name:name,p_endpoint_url:`https://receiver.example.com/${name}`,
  p_event_types:['site.created'],p_secret:secret,p_description:'synthetic partner subscription',
 })
 return {data,error,secret}
}
function row(id:string){
 return JSON.parse(sql(`SELECT row_to_json(s) FROM (SELECT id,company_id,api_client_id,description,metadata,status,failure_count,
  last_success_at,last_failure_at,signing_secret_ref FROM public.webhook_subscriptions WHERE id=${literal(id)}) s`)) as {
  id:string;company_id:string;api_client_id:string|null;description:string|null;metadata:Record<string,unknown>;status:string
  failure_count:number;last_success_at:string|null;last_failure_at:string|null;signing_secret_ref:string}
}
function subscriptionId(companyId:string,name:string):string{
 return sql(`SELECT id FROM public.webhook_subscriptions WHERE company_id=${literal(companyId)} AND name=${literal(name)}`)
}
async function deliverOnce(companyId:string,subscription:string,secret:string){
 const ref=row(subscription).signing_secret_ref
 process.env[`WEBHOOK_SIGNING_SECRET_${ref}`]=secret
 const event=await emitDomainEvent({companyId,eventType:'site.created',aggregateType:'customer_site',aggregateId:randomUUID(),
  source:'native_test',payload:{site_reference:`site_${randomUUID().slice(0,8)}`,status:'draft',data_quality_status:'ok'},
  idempotencyKey:`native-webhook-partner:${randomUUID()}`})
 expect(event).toBeTruthy()
 expect(await enqueueWebhookDeliveriesForEvent(event!,{subscriptionIds:[subscription],force:true,strict:true})).toBe(1)
 return sql(`SELECT id FROM public.webhook_deliveries WHERE webhook_subscription_id=${literal(subscription)} AND domain_event_id=${literal(event!.id)}`)
}
const delivery=(id:string)=>JSON.parse(sql(`SELECT row_to_json(d) FROM (SELECT status,attempts,max_attempts FROM public.webhook_deliveries WHERE id=${literal(id)}) d`)) as {status:string;attempts:number;max_attempts:number}

let A='',B='',clientA='',clientB=''
beforeAll(()=>{A=company('A');B=company('B');clientA=apiClient(A);clientB=apiClient(B)})
beforeEach(()=>{sent.length=0;transportStatus=200})

it('creates a partner subscription bound to its API client with partner metadata and description',async()=>{
 const name=`partner-${randomUUID().slice(0,8)}`
 const {data,error}=await partnerSubscription(A,clientA,name)
 expect(error).toBeNull()
 expect(data).toMatchObject({name,status:'active'})
 const created=row(subscriptionId(A,name))
 expect(created).toMatchObject({company_id:A,api_client_id:clientA,description:'synthetic partner subscription',
  metadata:{source:'partner_api',secret_store:'supabase_vault'},failure_count:0,last_success_at:null,last_failure_at:null})
})

it('rejects another tenant client in the RPC and in the table itself',async()=>{
 const name=`foreign-${randomUUID().slice(0,8)}`
 const {error}=await partnerSubscription(A,clientB,name)
 expect(error?.message).toBe('partner_api_client_not_active_for_company')
 expect(subscriptionId(A,name)).toBe('')
 expect(()=>sql(`INSERT INTO public.webhook_subscriptions(company_id,api_client_id,name,endpoint_url,event_types,status)
  VALUES(${literal(A)},${literal(clientB)},'cross tenant','https://receiver.example.com/x',ARRAY['site.created'],'active');`))
  .toThrow(/webhook_subscriptions_company_api_client_fkey/)
})

function websiteSubscription(companyId:string,name:string){
 const secret=`synthetic-${randomUUID()}-${randomUUID()}`
 const id=sql(`WITH s AS (SELECT vault.create_secret(${literal(secret)},'gridex_webhook_'||replace(gen_random_uuid()::text,'-',''),'native test') id)
  INSERT INTO public.webhook_subscriptions(company_id,name,endpoint_url,event_types,status,signing_algorithm,signing_secret_ref,signing_secret_hash)
  SELECT ${literal(companyId)},${literal(name)},${literal(`https://receiver.example.com/${name}`)},ARRAY['site.created'],'active','HMAC-SHA256',s.id::text,
   encode(extensions.digest(convert_to(${literal(secret)},'utf8'),'sha256'),'hex') FROM s RETURNING id`)
 return {id,secret}
}

it('defaults a non-partner subscription to empty metadata so it stays on the website surface',async()=>{
 const name=`website-${randomUUID().slice(0,8)}`
 const {id,secret}=websiteSubscription(A,name)
 expect(row(id)).toMatchObject({api_client_id:null,metadata:{},description:null})
 const sentDelivery=await deliverOnce(A,id,secret)
 await dispatchDueWebhookDeliveries(10)
 expect(delivery(sentDelivery).status).toBe('sent')
 const body=JSON.parse(sent.find(s=>s.url.endsWith(name))!.body) as Record<string,unknown>
 expect(body).not.toHaveProperty('api_version')
})

it('records success and failure health and pauses only after the tenth dead letter',async()=>{
 const name=`health-${randomUUID().slice(0,8)}`
 const {id,secret}=websiteSubscription(A,name)

 sql(`UPDATE public.webhook_subscriptions SET failure_count=4 WHERE id=${literal(id)};`)
 await deliverOnce(A,id,secret)
 await dispatchDueWebhookDeliveries(10)
 expect(row(id)).toMatchObject({failure_count:0,status:'active'})
 expect(row(id).last_success_at).not.toBeNull()
 expect(row(id).last_failure_at).toBeNull()

 // A retryable failure at the threshold does not pause.
 transportStatus=500
 sql(`UPDATE public.webhook_subscriptions SET failure_count=9 WHERE id=${literal(id)};`)
 const retryable=await deliverOnce(A,id,secret)
 await dispatchDueWebhookDeliveries(10)
 expect(delivery(retryable).status).toBe('failed')
 expect(row(id)).toMatchObject({failure_count:10,status:'active'})
 expect(row(id).last_failure_at).not.toBeNull()
 sql(`UPDATE public.webhook_deliveries SET status='dead_letter' WHERE id=${literal(retryable)};`)

 // A dead letter below the threshold does not pause.
 sql(`UPDATE public.webhook_subscriptions SET failure_count=2 WHERE id=${literal(id)};`)
 const early=await deliverOnce(A,id,secret)
 sql(`UPDATE public.webhook_deliveries SET attempts=max_attempts-1 WHERE id=${literal(early)};`)
 await dispatchDueWebhookDeliveries(10)
 expect(delivery(early).status).toBe('dead_letter')
 expect(row(id)).toMatchObject({failure_count:3,status:'active'})

 // The tenth consecutive failure that dead-letters pauses the subscription.
 sql(`UPDATE public.webhook_subscriptions SET failure_count=9 WHERE id=${literal(id)};`)
 const last=await deliverOnce(A,id,secret)
 sql(`UPDATE public.webhook_deliveries SET attempts=max_attempts-1 WHERE id=${literal(last)};`)
 await dispatchDueWebhookDeliveries(10)
 expect(delivery(last).status).toBe('dead_letter')
 expect(row(id)).toMatchObject({failure_count:10,status:'paused'})
 // Tenant B is untouched by A's health projection.
 expect(sql(`SELECT count(*) FROM public.webhook_subscriptions WHERE company_id=${literal(B)} AND (failure_count>0 OR status='paused')`)).toBe('0')
})
