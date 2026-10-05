// masterplan: TEN-07, AT-TEN-07, ESCO-11, AT-ESCO-11, SC-019
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielProjectionPage,EdielProjectionRequest} from '@/lib/ediel/services/types'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
import {projectEdielSeriesToBeneficiary} from '@/lib/ediel/services/projection'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const request:EdielProjectionRequest={beneficiaryCompanyId:uid(1),actorUserId:uid(2),grantId:uid(3),expectedGrantVersion:2,
 purpose:'billing',seriesId:uid(4),fields:['quantity'],startInclusive:'2026-01-01T00:00:00Z',endExclusive:'2026-02-01T00:00:00Z'}
const fixture=():EdielProjectionPage=>({grantId:uid(3),grantVersion:2,seriesId:uid(4),rows:[{quantity:'1.000'}],next:null,
 consumerReceiptId:uid(5),provenance:{version:1,sourceMessageId:uid(6),sourceRawHash:'a'.repeat(64),sourceFamily:'UTILTS',sourceCode:'E66',
 sourceEnvironment:'test',sourceRole:'DGI',sourceApplicationReference:'30-DGI-UTILTS',sourceSenderEdielId:'54321',receiverActorId:uid(7),receiverRole:'energy_service_company',
 contractVersion:2,contractHash:'b'.repeat(64),purpose:'billing',fields:['quantity'],qualityOrigin:null}})
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:fixture(),error:null})})
describe('actual beneficiary projection provenance adapter',()=>{
 it('retains original DGI sender/contract/purpose without rewriting the received source as DDQ',async()=>{
  const page=await projectEdielSeriesToBeneficiary(request)
  expect(page).toEqual(fixture())
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_beneficiary_series_page_v1',expect.objectContaining({p_beneficiary_company_id:uid(1),p_actor_user_id:uid(2),p_grant_id:uid(3),p_expected_grant_version:2,p_purpose:'billing',p_fields:['quantity']}))
 })
 it('requires fresh native provenance even when rows and a familiar grant UUID are present',async()=>{
  const data=fixture();delete (data as Partial<EdielProjectionPage>).provenance
  mocks.rpc.mockResolvedValue({data,error:null})
  await expect(projectEdielSeriesToBeneficiary(request)).rejects.toThrow('ediel_beneficiary_provenance_invalid')
 })
 it.each(['purpose','fields','sourceRole','contractHash','grantVersion'])('holds actual wrong %s binding rather than returning a derivative',async key=>{
  const data=fixture()
  if(key==='grantVersion')data.grantVersion=3
  else if(key==='purpose')data.provenance.purpose='unrelated'
  else if(key==='fields')data.provenance.fields=['quality']
  else if(key==='sourceRole')data.provenance.sourceRole='DDQ'
  else data.provenance.contractHash='unqualified'
  mocks.rpc.mockResolvedValue({data,error:null})
  await expect(projectEdielSeriesToBeneficiary(request)).rejects.toThrow('ediel_beneficiary_provenance_invalid')
 })
 it('returns quality and its exact origin only for the separately granted quality projection',async()=>{
  const data=fixture();data.rows=[{quality:'56'}];data.provenance.fields=['quality'];data.provenance.qualityOrigin={sourceMessageId:uid(6),seriesId:uid(4),column:'meter_reading_values.quality'}
  mocks.rpc.mockResolvedValue({data,error:null})
  expect((await projectEdielSeriesToBeneficiary({...request,fields:['quality']})).provenance.qualityOrigin).toEqual(data.provenance.qualityOrigin)
  await expect(projectEdielSeriesToBeneficiary(request)).rejects.toThrow('ediel_beneficiary_provenance_invalid')
 })
 it('rejects unauthorized quality/raw row fields and strips private extra attributes',async()=>{
  const data=fixture();data.rows=[{quantity:'1.000',quality:'56'}];mocks.rpc.mockResolvedValue({data,error:null})
  await expect(projectEdielSeriesToBeneficiary(request)).rejects.toThrow('ediel_beneficiary_provenance_invalid')
  const allowed={...fixture(),raw_payload:'private original',provenance:{...fixture().provenance,privateContract:'private original'}}
  mocks.rpc.mockResolvedValue({data:allowed,error:null})
  expect(await projectEdielSeriesToBeneficiary(request)).toEqual(fixture())
 })
 it('propagates current denial even after an earlier successful consumer receipt',async()=>{
  await projectEdielSeriesToBeneficiary(request)
  mocks.rpc.mockResolvedValue({data:null,error:new Error('current metering.read denied')})
  await expect(projectEdielSeriesToBeneficiary(request)).rejects.toThrow('current metering.read denied')
 })
})
