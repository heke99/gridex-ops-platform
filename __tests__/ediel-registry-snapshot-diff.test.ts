// masterplan: IMP-03, AT-IMP-03
import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
import {diffRegistryRecord,readRegistryPreviewSnapshot,type RegistryDiffRecord} from '@/lib/actor-registry/registrySnapshotDiff'
const current:RegistryDiffRecord={name:'Synthetic registry actor',legalName:'Synthetic registry actor',market:'EL',countryCode:'SE',orgNumber:'5590000000',edielId:'12345',svkId:'SYN',roles:['electricity_supplier'],routes:[{messageFamily:'PRODAT',environment:'production',applicationReference:'PRODAT',communicationAddress:'old@example.invalid',subaddress:null,partyId:'12345',interchangePartyId:'12345'}]}
describe('actual source values against native current registry snapshot',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('counts an unchanged actor as unchanged despite missing TXT org/roles and fresh metadata',()=>{
  expect(diffRegistryRecord({...current,orgNumber:null,roles:[],routes:[{...current.routes[0],metadata:{changed:true},isVerified:false}]},current)).toEqual([])
 })
 it.each([
  ['name',{...current,name:'Changed source name'}],
  ['countryCode',{...current,countryCode:'DK'}],
  ['market',{...current,market:'GAS'}],
  ['roles',{...current,roles:['electricity_supplier','balance_responsible']}],
  ['routes',{...current,routes:[{...current.routes[0],communicationAddress:'new@example.invalid'}]}],
  ['routes',{...current,routes:[{...current.routes[0],interchangePartyId:'54321'}]}],
  ['routes',{...current,routes:[{...current.routes[0],subaddress:'registered-case'}]}],
 ])('reports actual %s changes', (field,input)=>expect(diffRegistryRecord(input as RegistryDiffRecord,current)).toEqual([field]))
 it('does not interpret missing source routes as an authenticated deletion',()=>expect(diffRegistryRecord({...current,routes:[]},current)).toEqual([]))
 it('reads one actual native snapshot with scoped platform actor and deduplicated legal IDs',async()=>{
  const snapshot={snapshotHash:'a'.repeat(64),actors:[{...current,actorId:'00000000-0000-4000-8000-000000000001'}]}
  mocks.rpc.mockResolvedValue({data:snapshot,error:null})
  expect(await readRegistryPreviewSnapshot('actor',['12345','12345'])).toEqual(snapshot)
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_registry_preview_snapshot_v1',{p_actor_user_id:'actor',p_ediel_ids:['12345']})
 })
 it('fails closed if the native snapshot read fails',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:Error('current actor revoked')})
  await expect(readRegistryPreviewSnapshot('actor',['12345'])).rejects.toThrow('current actor revoked')
 })
})
