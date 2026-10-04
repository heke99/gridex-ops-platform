import {beforeEach,describe,expect,it,vi} from 'vitest'
const read=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure',()=>({readQualifiedCustomerStructure:read}))
import {requireDataRequestStructure} from '@/lib/ediel/sources/dataRequestStructure'
const input={companyId:'company',customerId:'customer',siteId:'site',meteringPointId:'point',actorUserId:'actor',environment:'test' as const,periodStart:'2026-10-01',periodEnd:'2026-10-02',legalSupplier:'12345',legalNetwork:'54321'}
beforeEach(()=>read.mockReset())
describe('source-only actual data request resolution',()=>{
 it.each([['Z04','D','15'],['Z02','Q','60']])('uses method %s independently of reporting %s',async(method,frequency,resolution)=>{
  read.mockResolvedValue({status:'selected',legalSupplier:'12345',legalNetwork:'54321',fields:{measurementMethod:method,reportingFrequency:frequency}})
  expect(await requireDataRequestStructure(input)).toMatchObject({resolution})
 })
 it.each(['Z01','Z03',null])('does not invent exact resolution for source method %s',async method=>{
  read.mockResolvedValue({status:'selected',legalSupplier:'12345',legalNetwork:'54321',fields:{measurementMethod:method,reportingFrequency:'D'}})
  await expect(requireDataRequestStructure(input)).rejects.toThrow('utilts_dated_structure_resolution_unavailable')
 })
 it('does not borrow another legal supplier/network or an unqualified read',async()=>{
  read.mockResolvedValue({status:'selected',legalSupplier:'FOREIGN',legalNetwork:'54321',fields:{measurementMethod:'Z04'}})
  await expect(requireDataRequestStructure(input)).rejects.toThrow('utilts_dated_structure_legal_party_mismatch')
  read.mockResolvedValue({status:'unavailable',reason:'own_source_missing'})
  await expect(requireDataRequestStructure(input)).rejects.toThrow('utilts_dated_structure_unavailable:own_source_missing')
 })
})
