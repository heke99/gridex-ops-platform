import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest,NextResponse} from 'next/server'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),serviceRpc:vi.fn(),guard:vi.fn(),user:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.serviceRpc}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc,auth:{getUser:mocks.user}})}))
vi.mock('@/lib/admin/apiGuards',()=>({requireAdminApiAccess:mocks.guard}))
import {POST as archive} from '@/app/api/ediel/supply-rescission-sources/route'
import {POST as review} from '@/app/api/ediel/supply-rescission-sources/[artifactId]/review/route'
import {GET as source} from '@/app/api/ediel/supply-rescission-sources/[artifactId]/source/route'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),actor=id(2),artifact=id(3),bytes=Buffer.from('Original legal source'),hash=createHash('sha256').update(bytes).digest('hex'),submission={environment:'test',supplyPeriodId:id(4),effectiveAt:'2026-10-16T12:30:00Z',rulePackId:id(5),source:{bytesBase64:bytes.toString('base64'),mimeType:'text/plain',reference:'Actual original selector',version:'1'}},request=(value:unknown)=>new NextRequest('http://localhost/api/ediel/supply-rescission-sources',{method:'POST',body:JSON.stringify(value),headers:{'content-type':'application/json'}}),params={params:Promise.resolve({artifactId:artifact})}
// Finite authenticated-server/native-result boundaries only. No mocked ready
// result certifies legal issuer, business source, original or market authority.
beforeEach(()=>{mocks.rpc.mockReset();mocks.serviceRpc.mockReset();mocks.serviceRpc.mockImplementation((...args)=>mocks.rpc(...args));mocks.user.mockReset();mocks.user.mockResolvedValue({data:{user:{id:actor}},error:null});mocks.guard.mockReset();mocks.guard.mockResolvedValue({guard:{companyId:company,userId:actor},response:null})})
describe('national H intake: server scope, strict source data and protected bytes',()=>{
 it.each([
  {label:'missing session user',data:{user:null},error:null},
  {label:'different actual session user',data:{user:{id:id(9)}},error:null},
  {label:'unverified user read',data:{user:{id:actor}},error:{message:'Auth unavailable'}},
 ])('rejects $label before any archive or legal effect',async session=>{
  mocks.user.mockResolvedValue(session)
  mocks.rpc.mockResolvedValue({data:{status:'archived',companyId:company,artifactId:artifact,sourceHash:hash,scopeHash:'a'.repeat(64),missing:[]},error:null})
  expect((await archive(request(submission))).status).toBe(403)
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.serviceRpc).not.toHaveBeenCalled()
 })

 it('archives supplied exact bytes using authenticated company/actor; archive status cannot grant legal mandate or business success',async()=>{mocks.rpc.mockResolvedValue({data:{status:'archived',companyId:company,artifactId:artifact,sourceHash:hash,scopeHash:'a'.repeat(64),missing:['authentic_legal_rescission_issuer_and_separate_qualified_review']},error:null});const response=await archive(request(submission));expect(response.status).toBe(201);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(mocks.rpc).toHaveBeenCalledWith('ediel_archive_supply_rescission_v1',{p_company_id:company,p_actor_user_id:actor,p_submission:submission});expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.serviceRpc).not.toHaveBeenCalled();expect(mocks.user).toHaveBeenCalledOnce()})
 it.each([{companyId:id(9)},{actorUserId:id(9)},{approved:true},{legalPrerequisitesCompleted:true},{customerEvent:'bankruptcy'}])('rejects caller authority or unrelated status fields before native archive %j',async extra=>{const response=await archive(request({...submission,...extra}));expect(response.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('authorization failure invokes no native read/archive/review',async()=>{mocks.guard.mockResolvedValue({response:NextResponse.json({error:'Forbidden'},{status:403})});expect((await archive(request(submission))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('requires actual original source clause for approval, and the separate current reviewer grant',async()=>{const response=await review(request({sourceHash:hash,scopeHash:'a'.repeat(64),decision:'approve',reason:'Review'}),params);expect(response.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.guard).toHaveBeenCalledWith({allOf:['communication.write','contracts.read','metering.write','ediel.supply_rescission.review']})})
 it('native missing legal prerequisites remains a concrete hold',async()=>{mocks.rpc.mockResolvedValue({data:{status:'held',companyId:company,artifactId:artifact,missing:['authentic_current_legal_rescission_issuer_and_prerequisites']},error:null});const response=await review(request({sourceHash:hash,scopeHash:'a'.repeat(64),decision:'approve',reason:'Review',sourceClauseLocator:'Page 1',sourceClauseQuote:'Actual source clause'}),params);expect(response.status).toBe(409);expect((await response.json()).missing).toEqual(['authentic_current_legal_rescission_issuer_and_prerequisites']);expect(mocks.rpc).toHaveBeenCalledOnce()})
 it('protected original download binds exact company/actor, hash and length without exposing a different artifact',async()=>{mocks.rpc.mockResolvedValue({data:{status:'archived',companyId:company,artifactId:artifact,sourceHash:hash,scopeHash:'a'.repeat(64),missing:['independent_review'],bytesBase64:bytes.toString('base64'),byteLength:bytes.length,mimeType:'text/plain'},error:null});const response=await source(new NextRequest('http://localhost/source'),params);expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('etag')).toBe(`"${hash}"`);expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_supply_rescission_artifact_v1',{p_company_id:company,p_actor_user_id:actor,p_artifact_id:artifact,p_include_bytes:true})})
 it('altered protected bytes produce no download or authority',async()=>{mocks.rpc.mockResolvedValue({data:{status:'archived',companyId:company,artifactId:artifact,sourceHash:hash,scopeHash:'a'.repeat(64),missing:[],bytesBase64:Buffer.from('Other').toString('base64'),byteLength:5,mimeType:'text/plain'},error:null});const response=await source(new NextRequest('http://localhost/source'),params);expect(response.status).toBe(403);expect(response.headers.get('content-disposition')).toBeNull()})
})
