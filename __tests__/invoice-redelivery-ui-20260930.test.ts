import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
const f=vi.hoisted(()=>({company:'ed170000-0000-4000-8000-000000000001',customer:'ed170000-0000-4000-8000-000000000008',
  invoice:'ed170000-0000-4000-8000-000000000012',item:'ed170000-0000-4000-8000-000000000011',account:'ed170000-0000-4000-8000-000000000010',
  actor:'ed170000-0000-4000-8000-000000000003',guard:vi.fn(),detail:vi.fn(),scope:vi.fn(),rpc:vi.fn(),queries:[] as Array<{table:string;filters:Record<string,unknown>}>,
  pending:false,state:null as null|{status:'success'|'error';message:string},hookIndex:0,values:[] as string[],formAction:vi.fn(),ownersError:false,
}))
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useCallback:(callback:unknown)=>callback,
  useActionState:()=>[f.state,f.formAction,f.pending],useState:(initial:string)=>{const i=f.hookIndex++;if(f.values[i]===undefined)f.values[i]=initial;return [f.values[i],(value:string)=>{f.values[i]=value}]},
}))
vi.mock('@/components/admin/AdminUnsavedChanges',()=>({useUnsavedChanges:()=>undefined}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageKeyAccess:f.guard,requireAdminActionAccess:f.guard}))
vi.mock('@/lib/auth/requirePermissionServer',()=>({requirePermissionServer:f.guard}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:f.scope,assertUserCanOperateCompany:async()=>undefined}))
vi.mock('@/lib/billing/invoiceReviewData',()=>({getInvoiceReviewDetail:f.detail}))
vi.mock('@/lib/customer-operations/supportSession',()=>({currentSupportSession:async()=>({kind:'ops',userId:f.actor,sessionId:'ed170000-0000-4000-8000-000000000005'})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:f.actor,email:'staff@example.invalid'}}})}})}))
vi.mock('@/components/admin/AdminHeader',()=>({default:()=>null}))
vi.mock('next/cache',()=>({revalidatePath:()=>undefined}))
vi.mock('next/navigation',()=>({unstable_rethrow:()=>undefined}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:f.rpc,from:(table:string)=>{
  const filters:Record<string,unknown>={};const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},not:(key:string,_operator:string,value:unknown)=>{filters[key]=['not',value];return q},single:()=>q,
    then:(resolve:(value:unknown)=>unknown)=>{f.queries.push({table,filters});return Promise.resolve(table==='companies'
      ?{data:{billing_settings:{invoice_profile:{distribution_method:'email'}}},error:null}
      :{data:[{id:f.account,user_id:f.actor,portal_user_id:f.actor,user_email:'recorded-owner@example.invalid'}],error:f.ownersError?{message:'PRIVATE'}:null}).then(resolve)}};return q},}}))
import Page from '@/app/admin/billing/invoices/[id]/redelivery/page'
import InvoicePage from '@/app/admin/billing/invoices/[id]/page'
import Form from '@/app/admin/billing/invoices/[id]/redelivery/RedeliveryDecisionForm'
import {recordInvoiceRedeliveryDecisionFormAction} from '@/app/admin/billing/invoices/[id]/redelivery-actions'
function nodes(value:ReactNode):ReactElement<Record<string,unknown>>[]{if(Array.isArray(value))return value.flatMap(nodes);if(!isValidElement(value))return [];const node=value as ReactElement<Record<string,unknown>>;return [node,...nodes(node.props.children as ReactNode)]}
function props(){return {companyId:f.company,customerId:f.customer,invoiceId:f.invoice,expectedRevision:3,expectedOverrideRevision:0,idempotencyKey:'redelivery-ui-test-1',accountIds:[f.account],canRecord:true}}
function renderForm(){f.hookIndex=0;return nodes(Form(props()))}
beforeEach(()=>{
  f.pending=false;f.state=null;f.values=[];f.hookIndex=0;f.queries=[];f.ownersError=false
  f.guard.mockReset().mockResolvedValue({userId:f.actor,companyId:f.company,isPlatformAdmin:false,permissions:['billing_underlay.read','billing_underlay.export']})
  f.scope.mockReset().mockResolvedValue({companyId:f.company})
  f.detail.mockReset().mockResolvedValue({invoice:{id:f.invoice,amount_inc_vat:125},item:{id:f.item,status:'sent'},underlay:{},pricingRun:{},pricingLines:[],priceSnapshot:null,approval:{},lifecycleStage:'dispatched',
    customer:{id:f.customer,company_id:f.company,full_name:'Synthetic customer',billing_profile_revision:3,billing_profile:{recipient:'Synthetic customer',email:'new@example.invalid'}},contract:{id:'ed170000-0000-4000-8000-000000000009',company_id:f.company,customer_id:f.customer,billing_profile_override:{},billing_profile_override_revision:0}})
  f.rpc.mockReset().mockResolvedValue({data:null,error:{message:'redelivery_actor_forbidden'}})
})
it('binds the real decision form to current scoped invoice/customer/profile revisions and tenant channel',async()=>{
  const tree=nodes(await Page({params:Promise.resolve({id:f.item})}))
  const form=tree.find(node=>node.type===Form)!
  expect(form.props).toMatchObject({...props(),idempotencyKey:expect.stringMatching(/^invoice-redelivery:/)})
  expect(form.props.accountLabels).toEqual({[f.account]:'Registrerad ägarrelation: recorded-owner@example.invalid'})
  expect(f.detail).toHaveBeenCalledWith({companyId:f.company,invoiceExportItemId:f.item})
  expect(f.queries.find(query=>query.table==='customer_portal_accounts')?.filters).toMatchObject({company_id:f.company,customer_id:f.customer,role:'owner',status:'active',is_active:true,user_id:['not',null]})
})
it('denies a changed selected tenant before loading invoice or owner resources',async()=>{
  f.scope.mockResolvedValue({companyId:'ed170000-0000-4000-8000-000000000002'})
  const tree=nodes(await Page({params:Promise.resolve({id:f.item})}))
  expect(tree.some(node=>node.props.role==='alert')).toBe(true);expect(f.detail).not.toHaveBeenCalled();expect(f.queries).toHaveLength(0)
})
it('makes the new form read-only without current export permission or a qualified owner list',async()=>{
  f.guard.mockResolvedValue({userId:f.actor,companyId:f.company,isPlatformAdmin:false,permissions:['billing_underlay.read']})
  expect(nodes(await Page({params:Promise.resolve({id:f.item})})).find(node=>node.type===Form)?.props.canRecord).toBe(false)
  f.ownersError=true;expect(nodes(await Page({params:Promise.resolve({id:f.item})})).find(node=>node.type===Form)?.props.canRecord).toBe(false)
})
it('links the current sent invoice to its actual decision page only for current export actors',async()=>{
  expect(nodes(await InvoicePage({params:Promise.resolve({id:f.item})})).some(node=>node.props.href===`/admin/billing/invoices/${f.item}/redelivery`)).toBe(true)
  f.guard.mockResolvedValue({userId:f.actor,companyId:f.company,isPlatformAdmin:false,permissions:['billing_underlay.read']})
  expect(nodes(await InvoicePage({params:Promise.resolve({id:f.item})})).some(node=>node.props.href===`/admin/billing/invoices/${f.item}/redelivery`)).toBe(false)
})
it('preserves typed reason and selected relationship across a returned server error and locks pending/completed submission',()=>{
  let tree=renderForm()
  const textarea=tree.find(node=>node.type==='textarea')!;const select=tree.find(node=>node.type==='select')!
  ;(textarea.props.onChange as (event:unknown)=>void)({target:{value:'Keep my draft after current authorization failure'}})
  ;(select.props.onChange as (event:unknown)=>void)({target:{value:f.account}})
  f.state={status:'error',message:'Aktuell ägarrelation krävs.'};tree=renderForm()
  expect(tree.find(node=>node.type==='textarea')?.props.value).toContain('Keep my draft')
  expect(tree.find(node=>node.type==='select')?.props.value).toBe(f.account)
  expect(tree.find(node=>node.props.role==='alert')).toBeDefined()
  f.pending=true;expect(renderForm().find(node=>node.type==='fieldset')?.props.disabled).toBe(true)
  f.pending=false;f.state={status:'success',message:'Beslutet är sparat. Leverans väntar.'}
  expect(renderForm().find(node=>node.type==='button')?.props.disabled).toBe(true)
})
it('parses the real form action and denies forged verification or missing revision without RPC',async()=>{
  const data=new FormData();for(const [key,value] of Object.entries(props()))if(!['accountIds','canRecord'].includes(key))data.set(key,String(value));data.set('accountId',f.account);data.set('reason','Retain unchanged invoice')
  expect(await recordInvoiceRedeliveryDecisionFormAction(null,data)).toMatchObject({status:'error',code:'redelivery_actor_forbidden'})
  expect(f.rpc.mock.calls[0][1]).toMatchObject({p_command:{actorUserId:f.actor,expectedRevision:3,expectedOverrideRevision:0}})
  f.rpc.mockClear();data.set('verified','true');expect(await recordInvoiceRedeliveryDecisionFormAction(null,data)).toMatchObject({status:'error',code:'invalid_redelivery_command'});expect(f.rpc).not.toHaveBeenCalled()
  data.delete('verified');data.delete('expectedRevision');expect(await recordInvoiceRedeliveryDecisionFormAction(null,data)).toMatchObject({status:'error',code:'invalid_redelivery_command'});expect(f.rpc).not.toHaveBeenCalled()
})
