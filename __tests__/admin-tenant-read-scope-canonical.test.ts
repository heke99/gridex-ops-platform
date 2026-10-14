import { beforeEach, expect, it, vi } from 'vitest'
const io=vi.hoisted(()=>({platform:false,scope:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({isPlatformAdminContext:()=>io.platform}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:io.scope}))
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
beforeEach(()=>{io.platform=false;io.scope.mockResolvedValue({companyId:'owned-A',companyName:'A'})})
it('uses the same company as the authoritative permission context and does not label it as another company',async()=>{
  const result=await resolveAdminTenantReadScope({userId:'user',roles:[],permissions:[],companyId:'selected-B'})
  expect(result).toEqual({isPlatformAdmin:false,companyId:'selected-B',companyName:null})
})
it('fails closed for a canonical tenant context without a company even if a legacy membership fallback exists',async()=>{
  await expect(resolveAdminTenantReadScope({userId:'user',roles:[],permissions:[],companyId:null})).rejects.toThrow('saknar ett aktivt bolag')
})
it('preserves explicit platform aggregates and legacy contexts without a canonical company field',async()=>{
  expect(await resolveAdminTenantReadScope({userId:'user',roles:[],permissions:[]})).toMatchObject({companyId:'owned-A',companyName:'A'})
  io.platform=true
  expect(await resolveAdminTenantReadScope({userId:'user',roles:[],permissions:[],companyId:'selected-B'})).toMatchObject({companyId:null,companyName:null})
})
