import {beforeEach,it,expect,vi} from 'vitest'
type DomainEventContract = Parameters<typeof buildPublicWebhookPayload>[0]
type DomainEventFixture = Pick<DomainEventContract, 'id'|'company_id'|'event_type'|'aggregate_type'|'aggregate_id'|'occurred_at'|'payload'>
type WebhookSubscriptionFixture = {
 id:string;company_id:string;api_client_id:string;status:string;endpoint_url:string;
 timeout_ms:number;max_attempts:number;signing_secret_ref:string;event_types:string[];
 custom_headers:Record<string,unknown>;metadata:Record<string,unknown>
}
type WebhookDeliveryFixture = {
 id:string;company_id:string;webhook_subscription_id:string;domain_event_id:string;
 event_type:string;status:string;attempts:number;max_attempts:number;next_attempt_at:string;
 payload:Record<string,unknown>
}
type WebhookQueryResult = {data:unknown;error:null}
type WebhookChainMethod = 'select'|'in'|'lt'|'lte'|'order'|'limit'|'maybeSingle'
type WebhookQuery = PromiseLike<WebhookQueryResult> & {
 update:(patch:Record<string,unknown>)=>WebhookQuery;
 upsert:(rows:Partial<WebhookDeliveryFixture>[])=>WebhookQuery;
 eq:(key:string,value:unknown)=>WebhookQuery
} & Partial<Record<WebhookChainMethod,()=>WebhookQuery>>
const m=vi.hoisted(()=>({subscription:{id:'subscription',company_id:'company',api_client_id:'revoked-client',status:'active',endpoint_url:'https://receiver.example.invalid',timeout_ms:1000,max_attempts:3,signing_secret_ref:'SYNTHETIC',event_types:['customer.updated'],custom_headers:{},metadata:{}} as WebhookSubscriptionFixture,delivery:{id:'delivery',company_id:'company',webhook_subscription_id:'subscription',domain_event_id:'event',event_type:'customer.updated',status:'queued',attempts:0,max_attempts:3,next_attempt_at:'2026-01-01T00:00:00Z',payload:{} as Record<string,unknown>} as WebhookDeliveryFixture,queries:[] as string[],transport:vi.fn(async()=>({ok:true,status:200,body:'ok'}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
 m.queries.push(table);let patch:Record<string,unknown>|null=null
 const filters:Record<string,unknown>={},ins:{rows?:Partial<WebhookDeliveryFixture>[]}={}
 const run=async()=>{
  if(table==='webhook_subscriptions'){
   if(patch)return {data:null,error:null}
   const rows=m.subscription.status===filters.status||!filters.status?[m.subscription]:[]
   return {data:rows,error:null}
  }
  if(table==='webhook_deliveries'){
   if(ins.rows){m.delivery={...m.delivery,...ins.rows[0]};return {data:null,error:null}}
   if(patch?.status==='delivery_uncertain')return {data:null,error:null}
   if(patch?.status==='processing'){Object.assign(m.delivery,patch);return {data:[{...m.delivery}],error:null}}
   if(patch){Object.assign(m.delivery,patch);return {data:{id:m.delivery.id},error:null}}
   return {data:[{id:m.delivery.id}],error:null}
  }
  if(table==='integration_api_clients')return {data:{id:'revoked-client',status:'revoked',revoked_at:'2026-10-07'},error:null}
  throw Error('unexpected '+table)
 }
 const q:WebhookQuery={then:(a,b)=>run().then(a,b),update:(p)=>{patch=p;return q},upsert:(r)=>{ins.rows=r;return q},eq:(k:string,v:unknown)=>{filters[k]=v;return q}}
 for(const name of ['select','in','lt','lte','order','limit','maybeSingle'] as const)q[name]=()=>q
 return q
}}}))
vi.mock('@/lib/tenant/operationPolicy',()=>({getTenantOperationDecision:async()=>({allowed:true,company_status:'active'})}))
vi.mock('@/lib/integrations/tenantContext',()=>({loadExternalTenantReference:async()=> 'organization_syntheticpublicreference123456'}))
vi.mock('@/lib/integrations/publicWebhookTransport',()=>({postPublicWebhook:m.transport}))
import {buildPublicWebhookPayload,enqueueWebhookDeliveriesForEvent,dispatchDueWebhookDeliveries} from '@/lib/integrations/webhooks'
beforeEach(()=>{process.env.WEBHOOK_SIGNING_SECRET_SYNTHETIC='synthetic-proof-secret';m.queries=[];m.transport.mockClear();m.subscription.status='active';m.delivery.status='queued';m.delivery.payload=buildPublicWebhookPayload({id:'event',company_id:'company',event_type:'customer.updated',aggregate_type:'customer',aggregate_id:'customer',occurred_at:'2026-10-07T00:00:00Z',payload:{status:'active'}} as DomainEventFixture as DomainEventContract,'organization_syntheticpublicreference123456')})
it('active queuedsubscription dispatches without checking revokedlinkedcredential',async()=>{
 expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
 expect(m.transport).toHaveBeenCalledTimes(1)
 expect(m.queries).not.toContain('integration_api_clients')
})
it('pausedsubscription prevents queuedtransport',async()=>{
 m.subscription.status='paused'
 expect((await dispatchDueWebhookDeliveries()).sent).toBe(0)
 expect(m.delivery.status).toBe('skipped');expect(m.transport).not.toHaveBeenCalled()
})
it('new enqueue only requires activesubscription not linkedcredential',async()=>{
 expect(await enqueueWebhookDeliveriesForEvent({id:'event',company_id:'company',event_type:'customer.updated',aggregate_type:'customer',aggregate_id:'customer',occurred_at:'2026-10-07T00:00:00Z',payload:{status:'active'}} as DomainEventFixture as DomainEventContract)).toBe(1)
 expect(m.queries).not.toContain('integration_api_clients')
})
