import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
vi.mock('server-only',()=>({}))
const io=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),selected:'00000000-0000-4000-8000-000000000001'}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:io.selected})})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.getUser},rpc:io.rpc})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
import {POST} from '@/app/api/ediel/customer-record-retention/route'
import {readRetentionJson,requireRetentionScope} from '@/lib/ediel/retention/retentionHttp'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',decision='00000000-0000-4000-8000-000000000004'
const permissions=['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.address_history']
const request=(body:unknown)=>new NextRequest('http://localhost/api/ediel/customer-record-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.resetAllMocks();io.selected=company;io.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});io.rpc.mockImplementation(async(name)=>({error:null,data:name==='ediel_current_retention_session_v1'?{companyId:company,actorUserId:actor,permissions}:{status:'submitted',decisionId:decision,sourceHash:'a'.repeat(64),targetHash:'b'.repeat(64),documentHash:'c'.repeat(64),retentionClass:'customer_address_history',issuerQualified:false}}))})
it('actual dedicated scope trusts server selection and current native class grants rather than an operative/global role',async()=>{
 expect(await requireRetentionScope(['ediel.retention.submit'])).toMatchObject({companyId:company,userId:actor,permissions})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_current_retention_session_v1',{p_company_id:company,p_actor_user_id:actor})
})
it('unauthenticated GoTrue result cannot invoke the native scope or any write',async()=>{
 io.getUser.mockResolvedValue({data:{user:null},error:null});const r=await POST(request({action:'purge',decisionId:decision}));expect(r.status).toBe(403);expect(io.rpc).not.toHaveBeenCalled();expect(r.headers.get('cache-control')).toBe('private, no-store')
})
it('malformed server company selector is an authority denial and cannot fall back to a caller tenant',async()=>{
 io.selected='foreign';const r=await POST(request({action:'purge',decisionId:decision,companyId:company}));expect(r.status).toBe(403);expect(io.rpc).not.toHaveBeenCalled()
})
it('current native foreign-actor or foreign-company receipts never establish a scope',async()=>{
 for(const wrong of [{companyId:target,actorUserId:actor},{companyId:company,actorUserId:target}]){io.rpc.mockResolvedValue({error:null,data:{...wrong,permissions}});expect((await POST(request({action:'purge',decisionId:decision}))).status).toBe(403)}
 expect(io.rpc.mock.calls.every(([name])=>name==='ediel_current_retention_session_v1')).toBe(true)
})
it('strict command selectors reject caller actor/company and duplicate permission authority before the source writer',async()=>{
 for(const extra of [{companyId:target},{actorUserId:target},{permission:'ediel.retention.purge'}])expect((await POST(request({action:'purge',decisionId:decision,...extra}))).status).toBe(400)
 expect(io.rpc.mock.calls.every(([name])=>name==='ediel_current_retention_session_v1')).toBe(true)
})
it('a missing current operation grant does not become an implicit class grant or write permission',async()=>{
 io.rpc.mockResolvedValue({error:null,data:{companyId:company,actorUserId:actor,permissions:['ediel.retention.review','ediel.retention.address_history']}})
 expect((await POST(request({action:'purge',decisionId:decision}))).status).toBe(403);expect(io.rpc).toHaveBeenCalledTimes(1)
})
it('actual source submit persists the exact document and authenticated actor while missing issuer qualification remains false',async()=>{
 const documentBase64=Buffer.from('SYNTHETIC unit source').toString('base64'),r=await POST(request({action:'submit',retentionClass:'customer_address_history',targetId:target,documentBase64,issuerReceipt:null}))
 expect(r.status).toBe(200);expect(await r.json()).toMatchObject({issuerQualified:false,status:'submitted'});expect(io.rpc).toHaveBeenLastCalledWith('ediel_submit_customer_record_retention_v1',{p_company_id:company,p_actor_user_id:actor,p_retention_class:'customer_address_history',p_target_id:target,p_document_base64:documentBase64,p_issuer_receipt:null})
})
it('a native legal/source hold remains HTTP409 and has no follow-on storage action',async()=>{
 io.rpc.mockImplementation(async(name)=>({error:null,data:name==='ediel_current_retention_session_v1'?{companyId:company,actorUserId:actor,permissions}:{status:'held',missing:['current_exact_class_legal_review_deadline']}}));const r=await POST(request({action:'purge',decisionId:decision}));expect(r.status).toBe(409);expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['ediel_current_retention_session_v1','ediel_begin_customer_record_retention_v1'])
})
it('JSON body bounds are enforced on streamed bytes even with no or misleading content length',async()=>{
 for(const length of [null,'1']){const r=new NextRequest('http://localhost/test',{method:'POST',headers:{'content-type':'application/json',...(length?{'content-length':length}:{})},body:'{"value":"too large"}'});await expect(readRetentionJson(r,5)).rejects.toThrow('body_limit')}
})
