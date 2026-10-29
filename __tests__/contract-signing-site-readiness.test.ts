import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {CustomerContractRow} from '@/lib/customer-contracts/types'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
type Row=Record<string,unknown>
const io=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,sent:[] as Row[],updateError:null as unknown,updateCalls:0}))
function query(table:string){
  const filters:Array<(r:Row)=>boolean>=[];let one=false
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},
    is:(k:string,v:unknown)=>{filters.push(r=>(r[k]??null)===v);return q},gt:()=>q,limit:()=>q,
    maybeSingle:()=>{one=true;return q},single:()=>{one=true;return q},
    then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>{
      const rows=(io.tables[table]??[]).filter(r=>filters.every(f=>f(r)))
      return Promise.resolve({data:one?(rows[0]??null):rows,error:null}).then(resolve,reject)
    }};return q
}
vi.mock('server-only',()=>({}))
vi.mock('next/cache',()=>({revalidatePath:()=>undefined}))
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error('REDIRECT:'+url)},unstable_rethrow:(e:unknown)=>{if(e instanceof Error&&e.message.startsWith('REDIRECT:'))throw e}}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:async()=>({userId:'staff-a'})}))
vi.mock('@/lib/tenant/entityGuards',()=>({loadCustomerTenantContext:async()=>({companyId:'company-a'}),assertContractTenant:async()=>undefined}))
vi.mock('@/lib/customer-contracts/db',()=>({getCustomerContractById:async()=>null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(t:string)=>query(t)}}))
vi.mock('next/link',()=>({default:'a'}))
vi.mock('@/components/admin/customers/contracts/actions',()=>({createContractAction:async()=>undefined,createContractFromOfferAction:async()=>undefined,logContractEventAction:async()=>undefined,updateContractAction:async()=>{io.updateCalls++;if(io.updateError)throw io.updateError}}))
vi.mock('@/lib/customer-contracts/onlineSigning',()=>({sendOnlineContractSignatureRequest:async(input:Row)=>{io.sent.push(input);return{deliveryStatus:'sent'}}}))
import {autoSendSigningLinkAfterCreate,contractHasValidSigningSite} from '@/lib/customer-contracts/autoSendSigningLink'
import {EditContractForm} from '@/components/admin/customers/contracts/ContractForms'
import {sendContractSignatureLinkAction,updateContractWithSigningFeedbackAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'
const scope={companyId:'company-a',customerId:'customer-a',contractId:'contract-a'}
const contract=()=>io.tables.customer_contracts[0]
beforeEach(()=>{
  vi.stubGlobal('React',React)
  io.sent=[];io.updateError=null;io.updateCalls=0;io.tables={customer_contracts:[{id:'contract-a',company_id:'company-a',customer_id:'customer-a',customer_site_id:'site-a',site_id:'site-a',status:'pending_signature',signed_at:null}],
    customer_sites:[{id:'site-a',company_id:'company-a',customer_id:'customer-a'}],customers:[{id:'customer-a',company_id:'company-a',email:'signer@example.invalid'}],customer_contract_signature_requests:[]}
})
afterEach(()=>{vi.unstubAllGlobals()})
describe('ordinary OPS signature sends require the contract exact site',()=>{
  it.each(['canonical','legacy','both'])('accepts a known matching %s site binding',async kind=>{
    if(kind==='canonical')contract().site_id=null
    if(kind==='legacy')contract().customer_site_id=null
    expect(await contractHasValidSigningSite(scope)).toBe(true)
  })
  it.each(['missing','conflicting','foreign customer','foreign tenant','foreign contract'])('rejects %s without inferring the customer only site',async kind=>{
    if(kind==='missing'){contract().site_id=null;contract().customer_site_id=null}
    if(kind==='conflicting')contract().site_id='site-b'
    if(kind==='foreign customer')io.tables.customer_sites[0].customer_id='foreign'
    if(kind==='foreign tenant')io.tables.customer_sites[0].company_id='foreign'
    if(kind==='foreign contract')contract().company_id='foreign'
    expect(await contractHasValidSigningSite(scope)).toBe(false)
  })
  it('holds automatic sending for manual correction when the unsigned contract has no site',async()=>{
    contract().site_id=null;contract().customer_site_id=null
    const result=await autoSendSigningLinkAfterCreate({...scope,actorUserId:'staff-a',actorCanWriteContracts:true})
    expect(result.status).toBe('needs_review');expect(result.message).toMatch(/anläggning/i);expect(io.sent).toHaveLength(0)
  })
  it('sends a correctly scoped contract through the normal automatic sender once',async()=>{
    const result=await autoSendSigningLinkAfterCreate({...scope,actorUserId:'staff-a',actorCanWriteContracts:true})
    expect(result.status).toBe('sent');expect(io.sent).toHaveLength(1)
    expect(io.sent[0]).toMatchObject({...scope,actorUserId:'staff-a'})
  })
  it('stops the manual resend before queueing or replacing any link if the contract lacks site',async()=>{
    contract().site_id=null;contract().customer_site_id=null
    const f=new FormData();f.set('customer_id','customer-a');f.set('contract_id','contract-a')
    await expect(sendContractSignatureLinkAction(f)).rejects.toThrow(/REDIRECT:.*error=/)
    expect(io.sent).toHaveLength(0)
  })
  it('permits the manual send for the exact valid customer/tenant/site',async()=>{
    const f=new FormData();f.set('customer_id','customer-a');f.set('contract_id','contract-a')
    await expect(sendContractSignatureLinkAction(f)).rejects.toThrow(/REDIRECT:.*sent=1/)
    expect(io.sent).toHaveLength(1)
  })
})

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
