import { NextRequest } from 'next/server'
import { expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({write:vi.fn(),ctx:{companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorUserId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',apiClientId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissions:['users.write','users.read']}}))
vi.mock('@/lib/staff-api/http',async importOriginal=>({...await importOriginal<typeof import('@/lib/staff-api/http')>(),withStaffApi:async(_r:unknown,_o:unknown,h:(ctx:unknown)=>Promise<Response>)=>h(mocks.ctx)}))
vi.mock('@/lib/tenant/staffCommands',()=>({inviteStaff:vi.fn(),changeStaffRole:vi.fn(),disableStaff:vi.fn(),reactivateStaff:vi.fn(),listStaff:vi.fn(),listStaffRoles:vi.fn()}))
vi.mock('@/lib/api/strictRequest',async importOriginal=>({...await importOriginal<typeof import('@/lib/api/strictRequest')>(),executeIdempotentPortalWrite:mocks.write}))
import {postStaffUser} from '@/lib/staff-api/userHandlers'
it.each([false,true])('staff-user write drops replayed=%s from response header despite documented header',async replayed=>{
 mocks.write.mockResolvedValue({statusCode:201,body:{data:{email:'synthetic@example.invalid',role_key:'customer_service_agent',membership_role:'support',status:'pending'}},replayed})
 const response=await postStaffUser(new NextRequest('https://example.invalid/api/v1/staff/users',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic-op-one'},body:JSON.stringify({email:'synthetic@example.invalid',role_key:'customer_service_agent'})}))
 expect(response.status).toBe(201);expect(response.headers.get('Idempotency-Replayed')).toBeNull()
 expect(response.headers.get('X-Gridex-Contract-Version')).toBeTruthy()
})
