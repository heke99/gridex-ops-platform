import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({row:{} as Record<string,unknown>,error:null as unknown,loadError:null as unknown,guardError:null as unknown,calls:0,tenantChecks:0,last:{} as Record<string,FormDataEntryValue>}))
vi.mock('server-only',()=>({}))
vi.mock('next/link',()=>({default:'a'}))
vi.mock('next/cache',()=>({revalidatePath:()=>undefined}))
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error('REDIRECT:'+url)},unstable_rethrow:(e:unknown)=>{if(e instanceof Error&&e.message.startsWith('REDIRECT:'))throw e}}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:async()=>{if(io.guardError)throw io.guardError;return {userId:'staff-a'}}}))
vi.mock('@/lib/tenant/entityGuards',()=>({loadCustomerTenantContext:async()=>({companyId:'company-a'}),assertContractTenant:async()=>{io.tenantChecks++}}))
vi.mock('@/lib/customer-contracts/db',()=>({getCustomerContractById:async(id:string,options:{companyId:string})=>{if(id!=='contract-a'||options.companyId!=='company-a')throw Error('unscoped lookup');if(io.loadError)throw io.loadError;return io.row}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:io.row,error:io.loadError})};return q}}}))
vi.mock('@/components/admin/customers/contracts/actions',()=>({createContractAction:async()=>undefined,createContractFromOfferAction:async()=>undefined,logContractEventAction:async()=>undefined,updateContractAction:async(data:FormData)=>{io.calls++;io.last=Object.fromEntries(data.entries());if(io.error)throw io.error}}))
vi.mock('@/lib/customer-contracts/onlineSigning',()=>({sendOnlineContractSignatureRequest:async()=>undefined}))
import {saveContractWithFeedbackAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'
import {EditContractForm} from '@/components/admin/customers/contracts/ContractForms'
import type {CustomerContractRow} from '@/lib/customer-contracts/types'
const base=()=>({id:'contract-a',customer_id:'customer-a',company_id:'company-a',contract_offer_id:null,status:'draft',signed_at:null,locked_at:null,contract_price_snapshot_id:null,contract_name:'Synthetic agreement',contract_type:'variable_monthly',price_snapshot:{},metadata:{},green_fee_mode:'none',vat_rate:0.25})
const form=()=>{const f=new FormData();f.set('customer_id','customer-a');f.set('customer_contract_id','contract-a');return f}
beforeEach(()=>{vi.stubGlobal('React',React);io.row=base();io.calls=0;io.tenantChecks=0;io.error=null;io.loadError=null;io.guardError=null})
afterEach(()=>vi.unstubAllGlobals())
describe('recoverable contract fee save with existing authorized business command',()=>{
 it('returns the production-observed expected validation and never retries the write',async()=>{
  io.error=Error('Ange orsak när katalogpriser ändras.')
  expect(await saveContractWithFeedbackAction(form())).toEqual({status:'invalid',field:'override_reason',message:'Ange orsak när katalogpriser ändras.'});expect(io.calls).toBe(1)
 })
 it.each(['variable_fee_ore_per_kwh','invoice_fee_sek','monthly_fee_sek','start_fee_sek','admin_fee_sek','break_fee_sek','green_fee_value','discount_value'])('blocks changed %s for bound pricing before mutation',async(field)=>{
  io.row.contract_price_snapshot_id='snapshot-a';const f=form();f.set(field,'12,50');f.set('override_reason','A reason cannot rewrite a sealed price')
  expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid',field});expect(io.calls).toBe(0)
 })
 it('preserves omitted bound commercial fields in the effective delegate payload',async()=>{
  io.row.status='pending_signature';io.row.contract_price_snapshot_id='snapshot-a';io.row.invoice_fee_sek=19;io.row.green_fee_value=0;io.row.green_fee_mode='sek_month';io.row.vat_rate=0.12
  expect(await saveContractWithFeedbackAction(form())).toEqual({status:'saved'})
  expect(io.last).toMatchObject({invoice_fee_sek:'19',green_fee_value:'0',green_fee_mode:'sek_month',vat_rate:'12'})
 })
 it('recognizes the actual sealed-field database error while retaining unknown errors',async()=>{
  io.error={code:'55000',message:'signed_customer_contract_immutable:price_snapshot'};expect(await saveContractWithFeedbackAction(form())).toMatchObject({status:'invalid'})
  io.error={code:'55000',message:'other_failure:price_snapshot'};await expect(saveContractWithFeedbackAction(form())).rejects.toBe(io.error)
 })
 it('treats absent green surcharge mode consistently with the normal command',async()=>{
  io.row.contract_offer_id='offer-a';io.row.green_fee_mode=null;const f=form();f.set('green_fee_mode','none');expect(await saveContractWithFeedbackAction(f)).toEqual({status:'saved'})
 })
 it.each([null,0.12])('holds unsupported historic VAT %s on snapshot-only draft before the old helper can replace it',async(vat)=>{
  io.row.contract_price_snapshot_id='snapshot-a';io.row.vat_rate=vat
  expect(await saveContractWithFeedbackAction(form())).toMatchObject({status:'invalid',field:'vat_rate'});expect(io.calls).toBe(0)
 })
 it.each([null,0.12])('preserves supported production snapshot draft VAT %s',async(vat)=>{
  io.row.contract_price_snapshot_id='snapshot-a';io.row.energy_direction='production';io.row.vat_rate=vat
  expect(await saveContractWithFeedbackAction(form())).toEqual({status:'saved'});expect(io.last.vat_rate).toBe(vat===null?'':'12')
 })
 it('keeps the historic VAT display on a snapshot-only draft',()=>{
  const row={...base(),vat_rate:null,contract_price_snapshot_id:'snapshot-a'} as unknown as CustomerContractRow
  const html=renderToStaticMarkup(React.createElement(EditContractForm,{contract:row,customerId:'customer-a',siteOptions:[],meteringPointOptions:[]}))
  expect(html.match(/<input[^>]*name="vat_rate"[^>]*>/)?.[0]).toContain('value=""')
 })
 it('rejects clearing a bound fee and preserves zero as a real value',async()=>{
  io.row.invoice_fee_sek=10;io.row.contract_offer_id='offer-a';const f=form();f.set('invoice_fee_sek','')
  expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid'});expect(io.calls).toBe(0)
  io.row.invoice_fee_sek=0;f.set('invoice_fee_sek','0');expect(await saveContractWithFeedbackAction(f)).toEqual({status:'saved'});expect(io.calls).toBe(1)
 })
 it.each(['locked_at','signed_at','contract_offer_id','public_contract_offer_id','contract_publication_version_id','price_plan_version_id'])('holds repricing for %s as well as a snapshot',async(field)=>{
  io.row[field]='bound';const f=form();f.set('invoice_fee_sek','9');expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid'});expect(io.calls).toBe(0)
 })
 it('permits unchanged Swedish decimal fees and site-only edits on bound contracts',async()=>{
  io.row.contract_price_snapshot_id='snapshot-a';io.row.invoice_fee_sek=12.5;const f=form();f.set('invoice_fee_sek','12,50');f.set('site_id','site-a')
  expect(await saveContractWithFeedbackAction(f)).toEqual({status:'saved'});expect(io.calls).toBe(1);expect(io.tenantChecks).toBe(1)
 })
 it('rejects negative invoice fees before the database check',async()=>{
  const f=form();f.set('invoice_fee_sek','-1');expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid',field:'invoice_fee_sek'});expect(io.calls).toBe(0)
 })
 it.each(['Moms måste ligga mellan 0 och 100 procent.','Moms för nya konsumtionspriser måste vara 25 procent.'])('returns known VAT policy validation: %s',async(message)=>{
  io.error=Error(message);expect(await saveContractWithFeedbackAction(form())).toEqual({status:'invalid',field:'vat_rate',message})
 })
 it('rejects invalid numeric text before it can become null',async()=>{
  const f=form();f.set('invoice_fee_sek','not a number');expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid',field:'invoice_fee_sek'});expect(io.calls).toBe(0)
 })
 it('rejects a mismatched customer tuple before mutation',async()=>{
  io.row.customer_id='foreign-customer';await expect(saveContractWithFeedbackAction(form())).rejects.toThrow('Kundavtalet kunde inte hittas');expect(io.calls).toBe(0)
 })
 it.each(['green_fee_mode','discount_unit'])('holds changed %s for a bound contract',async(field)=>{
  io.row.contract_price_snapshot_id='snapshot-a';const f=form();f.set(field,field==='green_fee_mode'?'sek_month':'percent');expect(await saveContractWithFeedbackAction(f)).toMatchObject({status:'invalid',field});expect(io.calls).toBe(0)
 })
 it('keeps authorization, query failures and unknown errors as failures',async()=>{
  const denied=Error('denied');io.guardError=denied;await expect(saveContractWithFeedbackAction(form())).rejects.toBe(denied);expect(io.calls).toBe(0)
  io.guardError=null;io.loadError={code:'XX000'};await expect(saveContractWithFeedbackAction(form())).rejects.toBe(io.loadError);expect(io.calls).toBe(0)
  io.loadError=null;io.error=Error('unknown failure');await expect(saveContractWithFeedbackAction(form())).rejects.toBe(io.error)
 })
 it('keeps Next redirects and signature evidence handling intact',async()=>{
  io.error=Error('REDIRECT:/existing');await expect(saveContractWithFeedbackAction(form())).rejects.toThrow('REDIRECT:/existing')
  io.error={code:'23514',message:'customer_contract_signature_evidence_incomplete'};await expect(saveContractWithFeedbackAction(form())).rejects.toThrow(/REDIRECT:.*signature\?error=/)
 })
 it('displays bound pricing as readonly while keeping all fee values in submissions',()=>{
  const row={...base(),contract_offer_id:'offer-a',status:'pending_signature'} as unknown as CustomerContractRow
  const html=renderToStaticMarkup(React.createElement(EditContractForm,{contract:row,customerId:'customer-a',siteOptions:[],meteringPointOptions:[]}))
  for(const name of ['variable_fee_ore_per_kwh','invoice_fee_sek','start_fee_sek','admin_fee_sek','break_fee_sek'])expect(html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]).toContain('readOnly=""')
  expect(html).toContain('ny avtalsversion')
 })
})
