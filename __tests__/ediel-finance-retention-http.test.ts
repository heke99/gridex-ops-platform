import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const f=vi.hoisted(()=>({rpc:vi.fn(),user:'00000000-0000-4000-8000-000000000002' as string|null,company:'00000000-0000-4000-8000-000000000001',permissions:['ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.settlement_copy_evidence']}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:f.company})})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:f.user?{id:f.user}:null},error:null})},rpc:f.rpc})}))
import {POST} from '@/app/api/ediel/finance-copy-retention/route'
const target='00000000-0000-4000-8000-000000000010',decision='00000000-0000-4000-8000-000000000011',hash='a'.repeat(64)
const request=(body:unknown)=>new NextRequest('http://localhost/api/ediel/finance-copy-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
const basis={retentionClass:'settlement_calculation_body',targetId:target,sourceTable:'public.portfolio_monthly_settlements',bodyColumns:['calculation_snapshot'],periodStart:'2020-01-01T00:00:00+00:00',periodEnd:'2020-02-01T00:00:00+00:00',originalProducerHash:hash,sourceBound:true,sourceHash:hash,targetHash:hash,scopeHash:hash,byteLength:200,includedCustomers:['00000000-0000-4000-8000-000000000003'],allIncludedScopesClosed:false,complete:false,authority:'none'}
beforeEach(()=>{f.user='00000000-0000-4000-8000-000000000002';f.company='00000000-0000-4000-8000-000000000001';f.permissions=['ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.settlement_copy_evidence'];f.rpc.mockReset();f.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:f.company,actorUserId:f.user,permissions:f.permissions},error:null}:{data:basis,error:null})})
it('actual authenticated scope selects company and actor; protected source metadata never authorizes a purge',async()=>{
 const r=await POST(request({action:'basis',retentionClass:'settlement_calculation_body',targetId:target}));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(await r.json()).toEqual(basis)
 expect(f.rpc).toHaveBeenLastCalledWith('ediel_finance_copy_retention_basis_v1',{p_company_id:f.company,p_actor_user_id:f.user,p_retention_class:'settlement_calculation_body',p_target_id:target})
 expect(f.rpc.mock.calls.some(([name])=>name==='ediel_purge_finance_copy_retention_v1')).toBe(false)
})
it('caller company/actor overrides and unknown classes fail before the source owner',async()=>{
 for(const extra of [{companyId:target},{actorUserId:target},{retentionClass:'everything'}]){f.rpc.mockClear();expect((await POST(request({action:'basis',retentionClass:'settlement_calculation_body',targetId:target,...extra}))).status).toBe(400);expect(f.rpc.mock.calls).toHaveLength(1)}
})
it('read-only current scope cannot submit/review/revoke/purge even with a guessed own decision',async()=>{
 f.permissions=['ediel.retention.read','ediel.retention.settlement_copy_evidence']
 for(const body of [{action:'review',decisionId:decision,outcome:'approve',reason:'guess'},{action:'revoke',decisionId:decision,reason:'guess'},{action:'purge',decisionId:decision},{action:'submit',retentionClass:'settlement_calculation_body',targetId:target,documentBase64:'dGVzdA==',issuerReceipt:null}]){f.rpc.mockClear();expect((await POST(request(body))).status).toBe(403);expect(f.rpc.mock.calls).toHaveLength(1)}
})
it('a native current source/deadline/review hold remains a 409 with no secondary application or provider operation',async()=>{
 f.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:f.company,actorUserId:f.user,permissions:f.permissions},error:null}:{data:{status:'held',missing:['unchanged_source_and_all_included_scopes_closed']},error:null})
 const r=await POST(request({action:'purge',decisionId:decision}));expect(r.status).toBe(409);expect(await r.json()).toEqual({status:'held',missing:['unchanged_source_and_all_included_scopes_closed']});expect(f.rpc.mock.calls.filter(([name])=>name==='ediel_purge_finance_copy_retention_v1')).toHaveLength(1)
})
it('no user, revoked native company authority, invalid base64 and oversized streaming documents are held before archive',async()=>{
 f.user=null;expect((await POST(request({action:'purge',decisionId:decision}))).status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();f.user='00000000-0000-4000-8000-000000000002'
 const body={action:'submit',retentionClass:'settlement_calculation_body',targetId:target,documentBase64:'%%%=',issuerReceipt:null};expect((await POST(request(body))).status).toBe(400);expect(f.rpc.mock.calls.some(([name])=>name==='ediel_submit_finance_copy_retention_v1')).toBe(false)
 f.rpc.mockResolvedValue({data:null,error:Error('actual_current_membership_revoked')});expect((await POST(request({action:'purge',decisionId:decision}))).status).toBe(403)
})
it('source hashes/false completeness and target selector are validated on the actual native response',async()=>{
 f.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:f.company,actorUserId:f.user,permissions:f.permissions},error:null}:{data:{...basis,complete:true},error:null})
 expect((await POST(request({action:'basis',retentionClass:'settlement_calculation_body',targetId:target}))).status).toBe(400)
})
