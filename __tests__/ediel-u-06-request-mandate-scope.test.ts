// masterplan: U-06, AT-U-06
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure',()=>({readQualifiedCustomerStructure:io.read}))
import {requireDataRequestStructure} from '@/lib/ediel/sources/dataRequestStructure'
import {getCanonicalUtiltsMarketProfile} from '@/lib/ediel/rulebook/utiltsMarketSemantics'

const scope={companyId:'c',actorUserId:'u',environment:'test' as const,customerId:'cust',siteId:'site',meteringPointId:'mp',
 periodStart:'2026-07-01',periodEnd:'2026-08-01',legalSupplier:'11111',legalNetwork:'22222'}
const selected=(over:Record<string,unknown>={})=>({status:'selected',legalSupplier:'11111',legalNetwork:'22222',fields:{measurementMethod:'E01'},...over})

beforeEach(()=>{io.read.mockReset()})

describe('U-06 an E73/E74 request is only built with a scoped, mandated basis',()=>{
 it('never requests "all data": customer, site, point and period are all required before any source read',async()=>{
  for(const missing of ['customerId','siteId','meteringPointId','periodStart','periodEnd'] as const)
   await expect(requireDataRequestStructure({...scope,[missing]:null})).rejects.toThrow('utilts_dated_structure_request_scope_required')
  expect(io.read).not.toHaveBeenCalled()
 })
 it('without a qualified own structure for exactly that period (no supply/agreement basis) the request is refused',async()=>{
  io.read.mockResolvedValue({status:'unavailable',reason:'dated_structure_owned_period_missing'})
  await expect(requireDataRequestStructure(scope)).rejects.toThrow('utilts_dated_structure_unavailable:dated_structure_owned_period_missing')
  expect(io.read).toHaveBeenCalledWith(expect.objectContaining({customerId:'cust',siteId:'site',meteringPointId:'mp',periodStart:'2026-07-01',periodEnd:'2026-08-01'}))
 })
 it('the parties of the basis must be the request parties: another supplier or grid owner is refused',async()=>{
  io.read.mockResolvedValue(selected({legalSupplier:'99999'}))
  await expect(requireDataRequestStructure(scope)).rejects.toThrow('utilts_dated_structure_legal_party_mismatch')
  io.read.mockResolvedValue(selected({legalNetwork:'99999'}))
  await expect(requireDataRequestStructure(scope)).rejects.toThrow('utilts_dated_structure_legal_party_mismatch')
 })
 it('E74 (S03/E31) is a bilateral request: never sent automatically, only after manual review of the agreement',()=>{
  expect(getCanonicalUtiltsMarketProfile('E74')).toMatchObject({bilateralRequired:true,supplierSupport:'manual_review'})
 })
})
