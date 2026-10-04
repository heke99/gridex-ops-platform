// masterplan: TEN-01, TEN-02, TEN-05
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],filters:[] as [string,unknown][],identity:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{const q:Record<string,unknown>={select:()=>q,order:()=>q,
 eq:(column:string,value:unknown)=>{io.filters.push([column,value]);return q},is:(column:string,value:unknown)=>{io.filters.push([column,value]);return q},
 limit:async()=>({data:io.rows.filter(row=>io.filters.every(([column,value])=>row[column]===value)),error:null})};return q}}}))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalTenantEdielIdentity:io.identity}))
import {getActiveEdielActorSettings} from '@/lib/ediel/config'
import {resolveCanonicalActorContext} from '@/lib/ediel/core/actorRegistry'
import {processActorRole} from '@/lib/ediel/core/marketRole'
const company='00000000-0000-4000-8000-000000000001'
const row=(role:string,id:string)=>({id,company_id:company,environment:'test',is_active:true,actor_role:role,ediel_id:'7300000000001',actor_ediel_id:'7300000000001',actor_name:'Synthetic'})
const identity=(roles:string[])=>({companyId:company,environment:'test',legalActorId:'a',legalEdielId:'7300000000001',transportActorId:'a',transportEdielId:'7300000000001',roleCodes:roles,representedByTransportAgent:false,transportRelationId:null})
beforeEach(()=>{io.filters=[];io.rows=[row('supplier','s'),row('energy_service_company','e')];io.identity.mockReset().mockResolvedValue(identity(['electricity_supplier','energy_service_company']))})
describe('role-bound actor profiles',()=>{
 it('derives the operational role from the process application reference only',()=>{
  expect(processActorRole('23-DDQ-PRODAT')).toBe('supplier')
  expect(processActorRole('23-DGI-PRODAT')).toBe('energy_service_company')
  expect(processActorRole('23-DDQ-UTILTS')).toBe('supplier')
  for(const value of [null,'','DGI','23-XYZ-PRODAT','x23-DGI-PRODAT'])expect(processActorRole(value)).toBeNull()
 })
 it('selects the separate supplier and ESCO profiles of one tenant by role',async()=>{
  expect((await getActiveEdielActorSettings('test',company,'supplier'))?.id).toBe('s');io.filters=[]
  expect((await getActiveEdielActorSettings('test',company,'energy_service_company'))?.id).toBe('e')
 })
 it('still refuses to pick one of several active profiles when no process role is given',async()=>{
  await expect(getActiveEdielActorSettings('test',company)).rejects.toThrow('ambiguous_active_tenant_ediel_actor_setting')
 })
 it('rejects a role profile whose verified tenant identity lacks that market role',async()=>{
  io.identity.mockResolvedValue(identity(['electricity_supplier']))
  await expect(resolveCanonicalActorContext('test',company,'energy_service_company')).rejects.toThrow('canonical_actor_market_role_missing:energy_service_company')
  io.filters=[];await expect(resolveCanonicalActorContext('test',company,'supplier')).resolves.toMatchObject({actorRole:'supplier',legalActorEdielId:'7300000000001'})
 })
 it('never resolves a tenant-less global actor context',async()=>{
  await expect(resolveCanonicalActorContext('test',null,'supplier')).rejects.toThrow('canonical_actor_company_required')
  expect(io.identity).not.toHaveBeenCalled()
 })
})
