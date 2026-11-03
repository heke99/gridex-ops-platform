import {describe,it,expect} from 'vitest'
import {prepareUnsignedContractEdit, unsignedRevisionBlocker} from '@/lib/customer-contracts/revision'
import type {CustomerContractRow} from '@/lib/customer-contracts/types'
const instant='2026-10-29T10:00:00.123456+00:00'
const row=()=>({id:'contract-a',company_id:'company-a',customer_id:'customer-a',status:'pending_signature',signed_at:null,locked_at:null,
  contract_offer_id:'offer-a',contract_price_snapshot_id:'snapshot-a',energy_direction:'consumption',contract_type:'variable_monthly',
  vat_rate:0.25,invoice_fee_sek:19,spot_markup_ore_per_kwh:1,contract_name:'Synthetic proposal',site_id:null,customer_site_id:null,
  starts_at:'2026-11-01T10:15:00.123456+00:00',auto_renew_enabled:true,optional_fee_lines:[],
  price_snapshot:{invoiceFeeSek:19,custom_origin:'kept'},updated_at:instant}) as unknown as CustomerContractRow
function form(){const f=new FormData();f.set('edit_request_id','b91a82ea-a790-4623-b759-3aa9be558cac');f.set('expected_updated_at',instant);return f}
function proposal(){const f=form();f.set('acknowledge_current_terms','on');f.set('override_reason','Synthetic customer-specific proposal');return f}
describe('presence-aware unsigned agreement edit preparation',()=>{
 it('sends only a changed site and preserves omitted prices, exact dates, renewal and opaque snapshot data',()=>{
  const c=row(),f=form();f.set('site_id','b91a82ea-a790-4623-b759-3aa9be558cad');const before=structuredClone(c)
  expect(prepareUnsignedContractEdit(c,f)).toEqual({ok:true,editId:'b91a82ea-a790-4623-b759-3aa9be558cac',expectedUpdatedAt:instant,patch:{site_id:'b91a82ea-a790-4623-b759-3aa9be558cad'},acknowledgeCurrentTerms:false,commercialChange:false});expect(c).toEqual(before)
 })
 it('submits a stable explicit date without treating its unchanged calendar day as a commercial change',()=>{
  const f=form();f.set('starts_at','2026-11-01');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:true,patch:{starts_at:'2026-11-01'},commercialChange:false})
 })
 it('keeps the same submitted command after its successful response is lost',()=>{
  const f=proposal();f.set('invoice_fee_sek','25,50');f.set('auto_renew_present','1');f.set('starts_at','2026-12-01')
  const first=prepareUnsignedContractEdit(row(),f)
  const reloaded={...row(),invoice_fee_sek:25.5,auto_renew_enabled:false,starts_at:'2026-12-01',updated_at:'2026-10-29T11:20:00.000001+00:00'}
  const second=prepareUnsignedContractEdit(reloaded,f)
  expect(first.ok&&second.ok&&second.patch).toEqual(first.ok&&first.patch)
 })
 it('supports another fee revision after the prior one saved full ledger arrays',()=>{
  expect(unsignedRevisionBlocker({...row(),price_snapshot:{price_components:[{component_code:'electricity_certificate',amount:1.7}],base_components:[{source_type:'spot',price_area:'SE4',weight_percent:100}]}})).toBeNull()
 })
 it('preserves decimal commas, explicit zero and the raw microsecond comparison token',()=>{
  const f=proposal();f.set('invoice_fee_sek','25,50');f.set('start_fee_sek','0');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:true,expectedUpdatedAt:instant,patch:{invoice_fee_sek:25.5,start_fee_sek:0},commercialChange:true})
 })
 it('does not accept client-supplied identity, frozen evidence or operational billing fields in the patch',()=>{
  const f=form();for(const key of ['company_id','customer_id','signed_at','price_snapshot','actual_start_at','billing_ready_status'])f.set(key,'forged')
  expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:true,patch:{},commercialChange:false})
 })
 it('distinguishes an explicitly cleared rendered renewal checkbox from an omitted field',()=>{
  const f=proposal();f.set('auto_renew_present','1');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:true,patch:{auto_renew_enabled:false},commercialChange:true})
 })
 it.each(['signed_at','locked_at'])('rejects a captured %s even if status is still pending',key=>{
  const c={...row(),[key]:instant};expect(prepareUnsignedContractEdit(c,proposal())).toMatchObject({ok:false})
 })
 it('does not treat a status choice as customer signing evidence',()=>{
  const f=proposal();f.set('status','signed');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'status'})
 })
 it.each(['portfolio','mixed'])('holds a %s graph instead of flattening it into manual fees',contract_type=>{
  expect(unsignedRevisionBlocker({...row(),contract_type} as CustomerContractRow)).toBeTruthy()
 })
 it('requires a fresh agreement decision for binding terms as well as money',()=>{
  const f=form();f.set('notice_months','3');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'acknowledge_current_terms'})
 })
 it.each(['25x','NaN','Infinity','-1'])('rejects malformed or negative invoice charge %s',value=>{
  const f=proposal();f.set('invoice_fee_sek',value);expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'invoice_fee_sek'})
 })
 it('rejects a forged contract type before requesting a database revision',()=>{
  const f=proposal();f.set('contract_type','forged');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'contract_type'})
 })
 it('rejects an invalid calendar date rather than normalizing it into another month',()=>{
  const f=proposal();f.set('starts_at','2026-02-31');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'starts_at'})
 })
 it('refuses a date range that ends before the requested start',()=>{
  const f=proposal();f.set('starts_at','2026-12-02');f.set('ends_at','2026-12-01');expect(prepareUnsignedContractEdit(row(),f)).toMatchObject({ok:false,field:'ends_at'})
 })
})
