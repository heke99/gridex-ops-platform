import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({users:vi.fn(async()=>({items:[]})),cases:vi.fn(async()=>({items:[],page:{}})),customers:vi.fn(async()=>({rows:[],total:0,page:1,pageSize:25,totalPages:0}))}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/staff-api/http',()=>({withStaffApi:async(_r:unknown,_o:unknown,fn:any)=>fn({companyId:'synthetic-company',actorUserId:'synthetic-actor',apiClientId:'synthetic-client',permissions:[]}),staffApiJson:(body:unknown)=>Response.json(body)}))
vi.mock('@/lib/tenant/staffCommands',()=>({listStaff:m.users,inviteStaff:vi.fn(),disableStaff:vi.fn(),reactivateStaff:vi.fn(),changeStaffRole:vi.fn(),listStaffRoles:vi.fn()}))
vi.mock('@/lib/staff-api/cases',async original=>({...await original<object>(),listStaffCases:m.cases}))
vi.mock('@/lib/customers/getCustomers',()=>({listCustomersPageForCompany:m.customers}))
import {getStaffUsers} from '@/lib/staff-api/userHandlers'
import {getStaffCases} from '@/lib/staff-api/caseHandlers'
import {getStaffCustomers} from '@/lib/staff-api/customerHandlers'
const req=(path:string,query:string)=>new NextRequest('https://example.invalid/api/v1/staff/'+path+'?'+query)
beforeEach(()=>vi.clearAllMocks())
it('users selects last duplicate and accepts hexadecimal numeric pagination',async()=>{
 await getStaffUsers(req('users','page=1&page=2'));expect(m.users.mock.calls[0][1].page).toBe(2)
 await getStaffUsers(req('users','page=0x10'));expect(m.users.mock.calls[1][1].page).toBe(16)
})
it('cases selects first duplicate and accepts exponent numeric limit',async()=>{
 await getStaffCases(req('cases','limit=1&limit=2'));expect(m.cases.mock.calls[0][0].limit).toBe(1)
 await getStaffCases(req('cases','limit=1e1'));expect(m.cases.mock.calls[1][0].limit).toBe(10)
})
it('customers rejects duplicate and nondecimal pagination before database port',async()=>{
 await expect(getStaffCustomers(req('customers','page=1&page=2'))).rejects.toMatchObject({status:422,code:'invalid_field'})
 await expect(getStaffCustomers(req('customers','page=0x10'))).rejects.toMatchObject({status:422,code:'invalid_field'})
 expect(m.customers).not.toHaveBeenCalled()
})
