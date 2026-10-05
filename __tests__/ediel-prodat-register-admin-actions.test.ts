import { beforeEach, describe, expect, it, vi } from 'vitest'
const boundary=vi.hoisted(()=>({admin:vi.fn(),company:vi.fn(),getCase:vi.fn(),approve:vi.fn(),reject:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:boundary.admin,requireCompanyScopedActionAccess:boundary.company}))
vi.mock('@/lib/ediel/inboundCases',()=>({getEdielInboundCaseById:boundary.getCase,approveEdielInboundCase:boundary.approve,rejectEdielInboundCase:boundary.reject}))
vi.mock('next/cache',()=>({revalidatePath:boundary.revalidate}))
vi.mock('@/app/admin/ediel/actions.part-1',()=>({formString:(v:unknown)=>typeof v==='string'?v.trim()||null:null,revalidateEdiel:boundary.revalidate}))
// Use the real legacy parser: missing mode defaults to update_existing_customer.
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:vi.fn()}}))
import { parseInboundCaseMode } from '@/lib/ediel/inboundCaseForm'
import { approveEdielInboundCaseAction as approve, rejectEdielInboundCaseAction as reject } from '@/app/admin/ediel/actions.part-5'
const form=()=>{const f=new FormData();f.set('caseId','case');return f}
const multi=()=>{const f=form();for(const id of ['A','B']){f.append('objectMeteringPointId',id);f.append('objectIdentityAgency','89');f.append('objectMode','create_new_customer');f.append('objectCustomerId','');f.append('objectSiteId','');f.append('objectMeteringPointDbId','')}return f}
beforeEach(()=>{vi.clearAllMocks();boundary.admin.mockResolvedValue({userId:'actor'});boundary.company.mockResolvedValue({userId:'actor'});boundary.getCase.mockResolvedValue({id:'case',company_id:'actual-company'})})
describe('actual admin action tenant and object decision boundaries',()=>{
 it('requires case-company permission before approval and ignores forged form company',async()=>{
  const f=form();f.set('companyId','forged');await approve(f)
  expect(boundary.company).toHaveBeenCalledWith('actual-company',{allOf:['communication.write','masterdata.write']})
  expect(boundary.approve).toHaveBeenCalledWith(expect.objectContaining({companyId:'actual-company',actorUserId:'actor',caseId:'case'}))
 })
 for(const action of [approve,reject])it('rejects another company without any mutation',async()=>{
  boundary.company.mockRejectedValueOnce(new Error('company denied'))
  await expect(action(form())).rejects.toThrow('company denied');expect(boundary.approve).not.toHaveBeenCalled();expect(boundary.reject).not.toHaveBeenCalled()
 })
 it('passes explicit object choices, not a shared root default',async()=>{
  await approve(multi());const p=boundary.approve.mock.calls[0][0]
  for (const key of ['mode','selectedCustomerId','selectedSiteId','selectedMeteringPointId']) expect(p).not.toHaveProperty(key);expect(p.objectDecisions).toEqual(['A','B'].map(id=>({meteringPointId:id,identityAgency:'89',mode:'create_new_customer',selectedCustomerId:null,selectedSiteId:null,selectedMeteringPointId:null})))
 })
 for(const key of ['objectIdentityAgency','objectMode','objectCustomerId','objectSiteId','objectMeteringPointDbId'])it(`rejects a misaligned object form ${key}`,async()=>{
  const f=multi();f.delete(key);await expect(approve(f)).rejects.toThrow('PRODAT_OBJECT_DECISION_REQUIRED');expect(boundary.approve).not.toHaveBeenCalled()
 })
 it('rejects an invalid object action mode before calling application',async()=>{
  const f=multi();f.delete('objectMode');f.append('objectMode','create_new_customer');f.append('objectMode','unrecognized')
  await expect(approve(f)).rejects.toThrow('PRODAT_OBJECT_DECISION_REQUIRED');expect(boundary.approve).not.toHaveBeenCalled()
 })
 it('does not permit silent dropping of orphan object choices',async()=>{
  const f=form();f.set('objectMode','create_new_customer');await expect(approve(f)).rejects.toThrow('PRODAT_OBJECT_DECISION_REQUIRED');expect(boundary.approve).not.toHaveBeenCalled()
 })
 it('stops missing-company cases before writing',async()=>{
  boundary.getCase.mockResolvedValueOnce({id:'case',company_id:null});await expect(approve(form())).rejects.toThrow(/bolag|company|TENANT/);expect(boundary.approve).not.toHaveBeenCalled()
 })
})

// The same real parser is used by the server action; no mocked default can hide
// a legacy selection being passed into the per-object application branch.
describe('legacy single-object mode compatibility',()=>{
 it.each([['create_new_customer','create_new_customer'],['link_existing_only','link_existing_only'],['update_existing_customer','update_existing_customer'],[null,'update_existing_customer'],['unrecognized','update_existing_customer']] as const)('preserves %s => %s',(value,expected)=>expect(parseInboundCaseMode(value)).toBe(expected))
 it('uses the real legacy default only without object choices',async()=>{
  await approve(form());expect(boundary.approve).toHaveBeenCalledWith(expect.objectContaining({mode:'update_existing_customer',objectDecisions:undefined}))
 })
})
