// Finding 20261029-3f1a8ab1/claude-track5/003: webhook event_id was derived from
// tenant and row identifiers, and the partner projection put it at the payload
// root where the public payload guard rejected it, so every partner delivery
// failed. Real local SQL/PostgREST and the real dispatcher; only the outbound
// HTTPS transport is an in-process recorder. Synthetic tenants only.
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

const REF=/^event_[a-f0-9]{32}$/
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('webhook_event_id_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:20000,
 }).trim()
}
function company(label:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(id)},${literal(`Synthetic event id ${label}`)},'active');
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
async function partnerSubscription(companyId:string,clientId:string){
 const name=`partner-${randomUUID().slice(0,8)}`,secret=`synthetic-${randomUUID()}-${randomUUID()}`
 const {error}=await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1',{
  p_company_id:companyId,p_api_client_id:clientId,p_name:name,p_endpoint_url:`https://receiver.example.com/${name}`,
  p_event_types:['site.created'],p_secret:secret,p_description:'synthetic',
 })
 expect(error).toBeNull()
 const id=sql(`SELECT id FROM public.webhook_subscriptions WHERE company_id=${literal(companyId)} AND name=${literal(name)}`)
 process.env[`WEBHOOK_SIGNING_SECRET_${sql(`SELECT signing_secret_ref FROM public.webhook_subscriptions WHERE id=${literal(id)}`)}`]=secret
 return {id,name}
}
async function event(companyId:string){
 const row=await emitDomainEvent({companyId,eventType:'site.created',aggregateType:'customer_site',aggregateId:randomUUID(),
  source:'native_test',payload:{site_reference:`site_${randomUUID().slice(0,8)}`,status:'draft',data_quality_status:'ok'},
  idempotencyKey:`native-event-id:${randomUUID()}`})
 expect(row).toBeTruthy()
 return row!
}
const stored=(eventId:string)=>sql(`SELECT coalesce(public_event_id,'') FROM public.domain_events WHERE id=${literal(eventId)}`)
const derived=(seed:string)=>`event_${createHash('sha256').update(seed).digest('hex').slice(0,32)}`

let A='',clientA='',tenantA=''
beforeAll(()=>{
 A=company('A');clientA=apiClient(A)
 tenantA=sql(`SELECT coalesce(external_tenant_reference,'') FROM public.companies WHERE id=${literal(A)}`)
})
beforeEach(()=>{sent.length=0;transportStatus=200})

it('gives each new event a random stored reference that is not derived from tenant or row identifiers',async()=>{
 const one=await event(A),two=await event(A)
 const a=stored(one.id),b=stored(two.id)
 expect(a).toMatch(REF);expect(b).toMatch(REF)
 expect(a).not.toBe(b)
 for(const [ref,id] of [[a,one.id],[b,two.id]] as const){
  expect(ref).not.toBe(derived(`${tenantA}:event:${id}`))
  expect(ref).not.toBe(derived(`${A}:${id}`))
 }
 // Uncorrelated: the two references share no common prefix beyond chance.
 expect(a.slice(6,14)).not.toBe(b.slice(6,14))
 expect(()=>sql(`UPDATE public.domain_events SET public_event_id=${literal(a)} WHERE id=${literal(two.id)};`)).toThrow(/domain_events_public_event_id_uidx/)
 expect(()=>sql(`UPDATE public.domain_events SET public_event_id='event_123' WHERE id=${literal(two.id)};`)).toThrow(/domain_events_public_event_id_format_check/)
})

it('delivers the partner projection with the stored reference, identical across a retry',async()=>{
 const {id,name}=await partnerSubscription(A,clientA)
 const ev=await event(A)
 expect(await enqueueWebhookDeliveriesForEvent(ev,{subscriptionIds:[id],force:true,strict:true})).toBe(1)
 const delivery=sql(`SELECT id FROM public.webhook_deliveries WHERE webhook_subscription_id=${literal(id)} AND domain_event_id=${literal(ev.id)}`)
 transportStatus=500
 await dispatchDueWebhookDeliveries(10)
 expect(sql(`SELECT status FROM public.webhook_deliveries WHERE id=${literal(delivery)}`)).toBe('failed')
 sql(`UPDATE public.webhook_deliveries SET next_attempt_at=now() WHERE id=${literal(delivery)};`)
 transportStatus=200
 await dispatchDueWebhookDeliveries(10)
 expect(sql(`SELECT status FROM public.webhook_deliveries WHERE id=${literal(delivery)}`)).toBe('sent')
 const bodies=sent.filter(s=>s.url.endsWith(name)).map(s=>JSON.parse(s.body) as Record<string,unknown>)
 expect(bodies).toHaveLength(2)
 expect(bodies[0].event_id).toBe(stored(ev.id))
 expect(bodies[1].event_id).toBe(bodies[0].event_id)
 expect(bodies[0]).toHaveProperty('api_version')
})

it('uses the stored reference in the database-side partner resource emitter',()=>{
 const sub=sql(`SELECT id FROM public.webhook_subscriptions WHERE company_id=${literal(A)} AND metadata->>'source'='partner_api' LIMIT 1`)
 expect(sub).not.toBe('')
 sql(`UPDATE public.companies SET external_tenant_reference=coalesce(external_tenant_reference,'tenant_'||substr(md5(id::text),1,16)) WHERE id=${literal(A)};`)
 const customer=randomUUID()
 sql(`INSERT INTO public.customers(id,company_id,customer_type,status,first_name,last_name,full_name,email,source,is_test_data)
  VALUES(${literal(customer)},${literal(A)},'private','active','Synthetic','Emitter','Synthetic Emitter','emitter@example.invalid','native_test',true);`)
 const key=`native-emitter:${randomUUID()}`
 sql(`SELECT private.gridex_emit_partner_resource_event_v2(${literal(A)},${literal(customer)},'site.created','customer_site','site_emitter','{}'::jsonb,${literal(key)});`)
 const row=JSON.parse(sql(`SELECT json_build_object('stored',e.public_event_id,'delivered',d.payload->>'event_id')
  FROM public.domain_events e JOIN public.webhook_deliveries d ON d.domain_event_id=e.id
  WHERE e.company_id=${literal(A)} AND e.idempotency_key=${literal(key)} AND d.webhook_subscription_id=${literal(sub)}`)) as {stored:string;delivered:string}
 expect(row.stored).toMatch(REF)
 expect(row.delivered).toBe(row.stored)
})

it('keeps the previously delivered reference for an event that predates the column',async()=>{
 const ev=await event(A)
 sql(`UPDATE public.domain_events SET public_event_id=NULL WHERE id=${literal(ev.id)};`)
 const {buildPublicWebhookPayload}=await import('@/lib/integrations/webhooks')
 const legacy=buildPublicWebhookPayload({...ev,public_event_id:null} as typeof ev,tenantA,'events')
 expect(legacy.event_id).toBe(derived(`${tenantA}:event:${ev.id}`))
})
