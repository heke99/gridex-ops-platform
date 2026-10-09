import { describe,it,expect,vi,beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({calls:0, budget:2,rpc:vi.fn()}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:vi.fn(async()=>{m.calls++;return m.calls>m.budget?{ok:false,status:429,error:'Rate limited',errorCode:'rate_limited'}:{ok:true,client:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}}),logIntegrationApiRequest:vi.fn(async()=>{})}))
vi.mock('@/lib/integrations/publicWebhookTransport',()=>({assertPublicWebhookTarget:vi.fn(async()=>{})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:m.rpc}}))
vi.mock('@/lib/partner-api/business',()=>({handleBusinessPartnerApi:vi.fn(async()=>null)}))
vi.mock('@/lib/partner-api/canonical',()=>({handleCanonicalPartnerApi:vi.fn(async()=>null)}))
vi.mock('@/lib/partner-api/core',()=>({handlePartnerApi:vi.fn(async()=>null)}))
vi.mock('@/lib/api/strictRequest',async importOriginal=>({...await importOriginal<object>(),executeIdempotentPortalWrite:async({execute}:{execute:()=>Promise<unknown>})=>execute()}))
import { POST } from '@/app/api/partner/v1/[[...path]]/route'
beforeEach(()=>{m.calls=0;m.budget=2;m.rpc.mockReset();m.rpc.mockResolvedValue({data:{webhook_subscription_reference:'webhook_public_reference'},error:null})})
function call(){return POST(new NextRequest('https://example.invalid/api/partner/v1/webhook/subscription',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'probe'},body:JSON.stringify({webhook_event:'CUSTOMER_CREATED',target_url:'https://public.example/webhook',signing_secret:'x'.repeat(32)})}),{params:Promise.resolve({path:['webhook','subscription']})})}
describe('temporary review proof',()=>{
 it('one actual dispatcher-to-simple-handler request authenticates twice',async()=>{const r=await call();expect(r.status).toBe(201);expect(m.calls).toBe(2);expect(m.rpc).toHaveBeenCalledOnce()})
 it('one remaining limiter slot prevents the first request creating a webhook',async()=>{m.budget=1;const r=await call();expect(r.status).toBe(429);expect(m.calls).toBe(2);expect(m.rpc).not.toHaveBeenCalled()})
})
