import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({contextCompany:'own',selectedCompany:'own',permissions:['communication.read','cases.write'],read:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageAccess:async()=>({userId:'actual-actor',companyId:io.contextCompany,permissions:io.permissions,email:'fixture@example.invalid'})}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:async()=>({companyId:io.selectedCompany,memberships:[{companyId:'own',status:'active',companyStatus:'active'}]})}))
vi.mock('@/components/admin/AdminHeader',()=>({default:({title}:{title:string})=>React.createElement('header',null,title)}))
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not_found')}}))
vi.mock('@/lib/ediel/operations/processNextAction',()=>({readEdielProcessNextActions:io.read}))
import Page from '@/app/admin/ediel/process-watches/page'
const source='10203040-1111-4111-8111-102030405060'
const decision={sourceMessageId:source,summary:'Invänta det egna tillämpade Z06-svaret.',waitingFor:['Z06','APERAK'],responsibility:'counterparty',blockers:[],allowedActions:['read_source'],timeBasis:{anchor:'z09_validity_day',validityDay:'2026-10-01',dueDay:'2026-11-10',actualAcceptedAt:'2026-09-30T12:00:00Z',businessDueAt:'2026-11-10T23:00:00Z',technicalDueAt:null}}
const render=async(query:Record<string,string|string[]>={})=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}))
beforeEach(()=>{io.contextCompany='own';io.selectedCompany='own';io.permissions=['communication.read','cases.write'];io.read.mockReset().mockResolvedValue(new Map([[source,decision]]))})
describe('OPS02 actual readonly process-watch server consumer',()=>{
 it('uses current selected company/actor and displays validity day with independent actual send proof',async()=>{
  const html=await render({environment:'test',sourceId:source})
  expect(io.read).toHaveBeenCalledWith(expect.objectContaining({companyId:'own',actorUserId:'actual-actor',environment:'test',messageIds:[source],access:{canRead:true,canReview:true,canPrepare:false}}))
  expect(html).toContain('giltighetsdag 2026-10-01');expect(html).toContain('bevakningsdag 2026-11-10');expect(html).toContain('SMTP-acceptans 2026-09-30');expect(html).toContain('Z06, APERAK');expect(html).not.toContain('Skicka på nytt')
 })
 it('overview explicitly names each-owner limit rather than claiming whole history',async()=>{
  const html=await render();expect(html).toContain('högst 100 bevakningar per källägare');expect(io.read.mock.calls[0][0].messageIds).toBeUndefined()
 })
 it('foreign context, missing current communication read and owner denial remain held without leaked owner errors',async()=>{
  io.contextCompany='foreign';let html=await render();expect(io.read).not.toHaveBeenCalled();expect(html).not.toContain(source)
  io.contextCompany='own';io.permissions=[];await render();expect(io.read).not.toHaveBeenCalled()
  io.permissions=['communication.read'];io.read.mockRejectedValue(Error('private_other_company_source_secret'))
  html=await render();expect(html).toContain('Processbeslutet kunde inte hämtas');expect(html).not.toContain('private_other_company_source_secret');expect(html).not.toContain(source)
 })
 it('tenant/body authority, repeated selectors, invalid source IDs and unknown keys are rejected before source reads',async()=>{
  const invalidQueries: Array<Record<string,string|string[]>> = [{companyId:'foreign'},{environment:['test','production']},{sourceId:[source]},{sourceId:'guessed'},{environment:'any'},{action:'send'}]
  for(const query of invalidQueries)
   await expect(render(query)).rejects.toThrow('not_found')
  expect(io.read).not.toHaveBeenCalled()
 })
 it('readonly current actor sees the same facts but no review authority or provider operation',async()=>{
  io.permissions=['communication.read'];await render({sourceId:source})
  expect(io.read.mock.calls[0][0].access).toEqual({canRead:true,canReview:false,canPrepare:false})
 })
})
