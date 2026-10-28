import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {CustomerContractRow} from '@/lib/customer-contracts/types'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const io=vi.hoisted(()=>({updateError:null as unknown,updateCalls:0}))
vi.mock('server-only',()=>({}))
vi.mock('next/cache',()=>({revalidatePath:()=>undefined}))
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error('REDIRECT:'+url)},unstable_rethrow:(e:unknown)=>{if(e instanceof Error&&e.message.startsWith('REDIRECT:'))throw e}}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:async()=>({userId:'staff-a'})}))
vi.mock('@/lib/tenant/entityGuards',()=>({loadCustomerTenantContext:async()=>({companyId:'company-a'}),assertContractTenant:async()=>undefined}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('next/link',()=>({default:'a'}))
vi.mock('@/components/admin/customers/contracts/actions',()=>({createContractAction:async()=>undefined,createContractFromOfferAction:async()=>undefined,logContractEventAction:async()=>undefined,updateContractAction:async()=>{io.updateCalls++;if(io.updateError)throw io.updateError}}))
vi.mock('@/lib/customer-contracts/onlineSigning',()=>({sendOnlineContractSignatureRequest:async()=>undefined}))
import {EditContractForm} from '@/components/admin/customers/contracts/ContractForms'
import {updateContractWithSigningFeedbackAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'
beforeEach(()=>{
  vi.stubGlobal('React',React)
  io.updateError=null;io.updateCalls=0
})
afterEach(()=>{vi.unstubAllGlobals()})
describe('expected manual signing errors stay a recoverable OPS message',()=>{
  const form=()=>{const f=new FormData();f.set('customer_id','customer-a');f.set('customer_contract_id','contract-a');return f}
  it('maps the actual signature-evidence guard without retrying or changing the business command',async()=>{
    io.updateError={code:'23514',message:'customer_contract_signature_evidence_incomplete'}
    await expect(updateContractWithSigningFeedbackAction(form())).rejects.toThrow(/REDIRECT:.*signature\?error=/)
    expect(io.updateCalls).toBe(1)
  })
  it('preserves unknown failures rather than concealing them or claiming success',async()=>{
    const error={code:'XX000',message:'unexpected failure'};io.updateError=error
    await expect(updateContractWithSigningFeedbackAction(form())).rejects.toBe(error)
    expect(io.updateCalls).toBe(1)
  })
  it('delegates one successful ordinary site update without inventing a signature',async()=>{
    const f=form();f.set('status','pending_signature');f.set('site_id','site-a')
    await expect(updateContractWithSigningFeedbackAction(f)).resolves.toBeUndefined()
    expect(io.updateCalls).toBe(1)
  })
  it('preserves Next redirect control flow from the original action',async()=>{
    io.updateError=Error('REDIRECT:/existing-result')
    await expect(updateContractWithSigningFeedbackAction(form())).rejects.toThrow('REDIRECT:/existing-result')
    expect(io.updateCalls).toBe(1)
  })
})

describe('actual OPS edit form preserves signature evidence semantics',()=>{
  const render=(signedAt:string|null,overrides:Partial<CustomerContractRow>={})=>{
    const row={id:'contract-a',customer_id:'customer-a',company_id:'company-a',status:signedAt?'signed':'pending_signature',
      signed_at:signedAt,contract_name:'Synthetic agreement',contract_type:'variable_monthly',source_type:'catalog',price_snapshot:{},metadata:{},...overrides} as unknown as CustomerContractRow
    return renderToStaticMarkup(React.createElement(EditContractForm,{contract:row,customerId:'customer-a',siteOptions:[{id:'site-a',label:'Synthetic site'}],meteringPointOptions:[]}))
  }
  it('does not offer a new manually signed status without an actual signature',()=>{
    const html=render(null)
    const option=html.match(/<option[^>]*value="signed"[^>]*>/)?.[0]
    expect(option).toContain('disabled=""')
  })
  it('submits the complete original signature instant when editing other fields',()=>{
    const exact='2026-10-28T11:30:01.123456+00:00'
    const html=render(exact)
    const field=html.match(/<input[^>]*name="signed_at"[^>]*>/)?.[0]
    expect(field?.match(/value="([^"]*)"/)?.[1]).toBe(exact)
  })
  it('submits no invented signing date for an unsigned agreement',()=>{
    const html=render(null)
    const field=html.match(/<input[^>]*name="signed_at"[^>]*>/)?.[0]
    expect(field?.match(/value="([^"]*)"/)?.[1]).toBe('')
  })
  it('renders an existing canonical-only site binding as the selected site',()=>{
    const html=render(null,{site_id:null,customer_site_id:'site-a'})
    const select=html.match(/<select[^>]*name="site_id"[^>]*>([\s\S]*?)<\/select>/)?.[1]
    expect(select).toMatch(/<option[^>]*value="site-a"[^>]*selected=""/)
  })
})
