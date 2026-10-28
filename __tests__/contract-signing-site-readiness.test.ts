import { beforeEach,describe,expect,it,vi } from 'vitest'
type Row=Record<string,unknown>
const io=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,sent:[] as Row[]}))
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
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(t:string)=>query(t)}}))
vi.mock('@/lib/customer-contracts/onlineSigning',()=>({sendOnlineContractSignatureRequest:async(input:Row)=>{io.sent.push(input);return{deliveryStatus:'sent'}}}))
import {autoSendSigningLinkAfterCreate,contractHasValidSigningSite} from '@/lib/customer-contracts/autoSendSigningLink'
import {sendContractSignatureLinkAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'
const scope={companyId:'company-a',customerId:'customer-a',contractId:'contract-a'}
const contract=()=>io.tables.customer_contracts[0]
beforeEach(()=>{
  io.sent=[];io.tables={customer_contracts:[{id:'contract-a',company_id:'company-a',customer_id:'customer-a',customer_site_id:'site-a',site_id:'site-a',status:'pending_signature',signed_at:null}],
    customer_sites:[{id:'site-a',company_id:'company-a',customer_id:'customer-a'}],customers:[{id:'customer-a',company_id:'company-a',email:'signer@example.invalid'}],customer_contract_signature_requests:[]}
})
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
