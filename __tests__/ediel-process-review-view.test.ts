import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveEdielReviewProcessDecision } from '@/lib/ediel/operations/processNextAction'

const sourceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',caseId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const io=vi.hoisted(()=>({permissions:['cases.read','cases.write'],active:true,sourceCompany:'own',
 admittedAt:'2026-10-01T10:00:00Z' as string|null,metadata:{} as Record<string,unknown>}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageKeyAccess:async()=>({userId:'actor',companyId:'own',email:'operator@example.invalid',permissions:io.permissions})}))
vi.mock('@/lib/tenant/adminScope',()=>({resolveAdminTenantReadScope:async()=>({companyId:'own',companyName:'Own synthetic company',isPlatformAdmin:false})}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:async()=>({companyId:'own',memberships:[{companyId:'own',status:io.active?'active':'inactive',companyStatus:'active'}]})}))
vi.mock('@/components/admin/AdminHeader',()=>({default:({title}:{title:string})=>React.createElement('header',null,title)}))
vi.mock('@/app/admin/ediel/operational-cases/actions',()=>({updateEdielOperationalCaseStatusAction:()=>{throw Error('Rendering cannot mutate case status')}}))
vi.mock('@/lib/customer-cases/db',()=>({
 listCustomerCases:async()=>[],listCustomerCaseEvents:async()=>[],customerCaseStatusLabel:(value:string)=>value,
 getCustomerCaseById:async(id:string,company:string)=>{
  if(id!==caseId||company!=='own')throw Error('foreign case read')
  return {id:caseId,company_id:'own',source:'ediel_inbound_state_machine',title:'Own source review',status:'open',priority:'high',
   created_at:'2026-10-01T10:01:00Z',updated_at:'2026-10-01T10:01:00Z',customer_id:null,next_action:'Granska mätarhändelsen.',metadata:io.metadata}
 },
}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:(company:string)=>{
 if(company!=='own')throw Error('foreign source read')
 return {from:(table:string)=>{
  if(table!=='ediel_messages')throw Error('unexpected table')
  return {select:(columns:string)=>{
   expect(columns).toBe('id,company_id,message_received_at')
   return {eq:(key:string,id:string)=>{
    expect([key,id]).toEqual(['id',sourceId])
    return {maybeSingle:async()=>({error:null,data:{id:sourceId,company_id:io.sourceCompany,message_received_at:io.admittedAt}})}
   }}
  }}
 }}
}}))
import Page from '@/app/admin/ediel/operational-cases/page'

beforeEach(()=>{
 io.permissions=['cases.read','cases.write'];io.active=true;io.sourceCompany='own';io.admittedAt='2026-10-01T10:00:00Z'
 io.metadata={review_intent:'meter_change_review',source_ediel_message_id:sourceId,process_next_action:deriveEdielReviewProcessDecision({
  message:{id:sourceId,message_received_at:io.admittedAt},reviewIntent:'meter_change_review',nextAction:'Granska mätarhändelsen.',
 })}
})
describe('OPS02 actual operational case process panel',()=>{
 it('shows source-bound actual admission, responsibility and review without changing the case',async()=>{
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Processens nästa steg');expect(html).toContain('Faktisk mottagningstid');expect(html).toContain('Bolagets operatör')
  expect(html).toContain('Granska ärendet och uppdatera ärendestatus.');expect(html).toContain('name="status"')
  expect(html).not.toContain('Skicka meddelande')
 })
 it('metadata candidates do not authorize a reader or revoked member to review',async()=>{
  io.permissions=['cases.read'];let html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Statusändring kräver aktuell bolagsbehörighet.');expect(html).not.toContain('name="status"')
  io.permissions=['cases.read','cases.write'];io.active=false;html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Statusändring kräver aktuell bolagsbehörighet.');expect(html).not.toContain('name="status"')
 })
 it('a clock absent from the actual source cannot be reconstructed from persisted metadata or case created time',async()=>{
  io.admittedAt=null;const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Processens tidsgrund kan inte verifieras mot källmeddelandet.')
  expect(html).not.toContain('Faktisk mottagningstid')
 })
 it('another tenant source or tampered binding holds the process panel',async()=>{
  io.sourceCompany='foreign';let html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Processens tidsgrund kan inte verifieras mot källmeddelandet.')
  io.sourceCompany='own';io.metadata.process_next_action={...(io.metadata.process_next_action as object),sourceMessageId:'foreign'}
  html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({caseId})}))
  expect(html).toContain('Processens tidsgrund kan inte verifieras mot källmeddelandet.')
 })
})
