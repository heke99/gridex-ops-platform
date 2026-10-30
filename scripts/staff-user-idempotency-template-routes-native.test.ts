// Finding 20261029-3f1a8ab1/claude-track5/006: staff-user writes claim the
// customer-portal ledger without a customer. Access changes used routes with the
// target user id embedded, which no allow-list could name, so every such write
// failed. They now record the public route template and carry the target user in
// the hashed payload. Real local SQL/PostgREST ledger, CHECK and tenant membership
// check; only the staff-API auth wrapper and the staff command are in-process.
import {execFileSync} from 'node:child_process'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {NextRequest} from 'next/server'
import {beforeAll,beforeEach,expect,it,vi} from 'vitest'

const io=vi.hoisted(()=>({ctx:{} as Record<string,unknown>,calls:[] as {op:string;userId?:string}[]}))
vi.mock('@/lib/staff-api/http',async importOriginal=>({...await importOriginal<typeof import('@/lib/staff-api/http')>(),
 withStaffApi:async(_r:unknown,_o:unknown,handler:(ctx:unknown)=>Promise<Response>)=>handler(io.ctx)}))
vi.mock('@/lib/tenant/staffCommands',()=>({
 inviteStaff:vi.fn(async(_c:unknown,input:{email:string})=>{io.calls.push({op:'invite'});return {email:input.email,status:'pending'}}),
 changeStaffRole:vi.fn(async(_c:unknown,input:{userId:string;roleKey:string})=>{io.calls.push({op:'change',userId:input.userId});return {user_id:input.userId,role_key:input.roleKey,status:'active'}}),
 disableStaff:vi.fn(async(_c:unknown,input:{userId:string})=>{io.calls.push({op:'disable',userId:input.userId});return {user_id:input.userId,status:'disabled'}}),
 reactivateStaff:vi.fn(async(_c:unknown,input:{userId:string})=>{io.calls.push({op:'enable',userId:input.userId});return {user_id:input.userId,status:'active'}}),
 listStaff:vi.fn(),listStaffRoles:vi.fn(),
}))

const {disableStaffUser,enableStaffUser,patchStaffUser,postStaffUser}=await import('@/lib/staff-api/userHandlers')
const {supabaseService}=await import('@/lib/supabase/service')

const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('staff_idempotency_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:20000,
 }).trim()
}
function company(label:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(id)},${literal(`Synthetic staff ${label}`)},'active');`)
 return id
}
function apiClient(companyId:string):string{
 const id=randomUUID()
 sql(`INSERT INTO public.integration_api_clients(id,company_id,name,status,key_prefix,secret_hash,scopes)
  VALUES(${literal(id)},${literal(companyId)},'Synthetic staff client','active',${literal(`gdxp_${randomBytes(4).toString('hex').slice(0,7)}`)},
   ${literal(createHash('sha256').update(randomUUID()).digest('hex'))},ARRAY['staff_users.write']);`)
 return id
}
async function member(companyId:string,label:string):Promise<string>{
 const email=`staff-${label}-${randomUUID().slice(0,8)}@example.invalid`
 const {data,error}=await supabaseService.auth.admin.createUser({email,password:`Sim-${randomBytes(12).toString('hex')}!`,email_confirm:true})
 if(error||!data.user)throw error??Error('create_user_failed')
 sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(data.user.id)},${literal(email)},'Synthetic staff','active') ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
   VALUES(${literal(companyId)},${literal(data.user.id)},'support','active',true,now(),now(),'customer_service_agent','customer_service_agent');`)
 return data.user.id
}
const req=(path:string,body:unknown,key:string,method='POST')=>new NextRequest(`http://127.0.0.1:3000/api/v1/staff/users${path}`,{
 method,headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)})
const params=(id:string)=>({params:Promise.resolve({id})})
const ledger=(companyId:string,key:string)=>JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('route',route,'customer',customer_id,'status',status) ORDER BY created_at),'[]')
 FROM public.customer_portal_write_idempotency WHERE company_id=${literal(companyId)} AND idempotency_key=${literal(key)}`)) as {route:string;customer:string|null;status:string}[]

let A='',B='',clientA='',actor='',userOne='',userTwo='',foreign=''
beforeAll(async()=>{
 A=company('A');B=company('B');clientA=apiClient(A)
 actor=await member(A,'actor');userOne=await member(A,'one');userTwo=await member(A,'two');foreign=await member(B,'foreign')
})
beforeEach(()=>{io.calls.length=0;io.ctx={companyId:A,actorUserId:actor,apiClientId:clientA,permissions:['users.write','users.read']}})

it('claims each staff route template without a customer and replays the same user with the same response',async()=>{
 for(const [name,call,route] of [
  ['change',(key:string)=>patchStaffUser(req(`/${userOne}`,{role_key:'customer_service_agent'},key,'PATCH'),params(userOne)),'/api/v1/staff/users/[id]'],
  ['disable',(key:string)=>disableStaffUser(req(`/${userOne}/disable`,{},key),params(userOne)),'/api/v1/staff/users/[id]/disable'],
  ['enable',(key:string)=>enableStaffUser(req(`/${userOne}/enable`,{},key),params(userOne)),'/api/v1/staff/users/[id]/enable'],
 ] as const){
  io.calls.length=0
  const key=randomUUID()
  const first=await call(key)
  const firstBody=await first.json()
  expect(first.status,name).toBe(200)
  expect(first.headers.get('Idempotency-Replayed')).toBe('false')
  const replay=await call(key)
  expect(replay.status,name).toBe(200)
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
  // The stored response is replayed; request_id is the per-response envelope id.
  expect((await replay.json()).data).toEqual(firstBody.data)
  expect(io.calls,name).toEqual([{op:name,userId:userOne}])
  expect(ledger(A,key)).toEqual([{route,customer:null,status:'completed'}])
 }
})

it('answers 409 when the same key is reused against another user, without running the command',async()=>{
 const key=randomUUID()
 expect((await disableStaffUser(req(`/${userOne}/disable`,{},key),params(userOne))).status).toBe(200)
 await expect(disableStaffUser(req(`/${userTwo}/disable`,{},key),params(userTwo)))
  .rejects.toMatchObject({code:'idempotency_conflict',status:409})
 expect(io.calls).toEqual([{op:'disable',userId:userOne}])
 expect(ledger(A,key)).toEqual([{route:'/api/v1/staff/users/[id]/disable',customer:null,status:'completed'}])
})

it('answers 409 when the same key and user carry a different body, without running the command',async()=>{
 const key=randomUUID()
 expect((await patchStaffUser(req(`/${userOne}`,{role_key:'customer_service_agent'},key,'PATCH'),params(userOne))).status).toBe(200)
 await expect(patchStaffUser(req(`/${userOne}`,{role_key:'company_admin'},key,'PATCH'),params(userOne)))
  .rejects.toMatchObject({code:'idempotency_conflict',status:409})
 expect(io.calls).toEqual([{op:'change',userId:userOne}])
 expect(ledger(A,key)).toEqual([{route:'/api/v1/staff/users/[id]',customer:null,status:'completed'}])
})

it('claims the invite route without a customer',async()=>{
 const key=randomUUID()
 const res=await postStaffUser(req('',{email:`invite-${randomUUID().slice(0,8)}@example.invalid`,role_key:'customer_service_agent'},key))
 expect(res.status).toBe(201)
 expect(ledger(A,key)).toEqual([{route:'/api/v1/staff/users',customer:null,status:'completed'}])
})

it('refuses a target user who is not a member of the tenant, before claiming the ledger',async()=>{
 for(const target of [foreign,randomUUID()]){
  const key=randomUUID()
  await expect(enableStaffUser(req(`/${target}/enable`,{},key),params(target))).rejects.toMatchObject({code:'staff_user_not_found',status:404})
  expect(ledger(A,key)).toEqual([])
 }
 expect(io.calls).toEqual([])
})

it('still refuses a customer-less row on a staff route that is not a template',()=>{
 expect(()=>sql(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
  VALUES(${literal(A)},${literal(clientA)},NULL,${literal(`/api/v1/staff/users/${userOne}`)},${literal(randomUUID())},repeat('a',64),'processing');`))
  .toThrow(/customer_portal_write_idempotency_customer_required_check/)
})
