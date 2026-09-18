import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/app/admin/ediel/actions',()=>({approveEdielInboundCaseAction:async()=>{},rejectEdielInboundCaseAction:async()=>{}}))
import Panel from '@/components/admin/ediel/EdielInboundCasesPanel'
import type { EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
// SSR form contract only; not a browser or live application certification.
vi.stubGlobal('React',React)
const row=(patch:Partial<EdielInboundCaseRow>={})=>({id:'case',company_id:'company',status:'pending_review',ediel_message_id:'message',case_type:'Z04',created_at:'2026-09-17',proposed_action:{objects:['A','B'].map((id,i)=>({meteringPointId:id,identityAgency:'89',validRegisterChain:true,registers:Array.from({length:i+1},()=>({endUserName:`Customer ${id}`,registerIndex:i+1}))}))},parsed_customer:{fullName:'Customer A'},...patch} as EdielInboundCaseRow)
const html=(r:EdielInboundCaseRow)=>renderToStaticMarkup(React.createElement(Panel,{cases:[r]}))
describe('object-scoped admin form contract',()=>{
 it('renders every object and a separate explicit decision instead of a first-customer root choice',()=>{
  const s=html(row());expect(s).toContain('Customer B');expect(s.match(/name="objectMeteringPointId"/g)).toHaveLength(2)
  expect(s.match(/name="objectMode"/g)).toHaveLength(2);expect(s).not.toContain('name="mode"')
  for(const key of ['objectCustomerId','objectSiteId','objectMeteringPointDbId','objectIdentityAgency'])expect(s.match(new RegExp(`name="${key}"`,'g'))).toHaveLength(2)
 })
 it('shows a resume form for an approved partial batch with immutable choices and no reject button',()=>{
  const decisions=['A','B'].map(meteringPointId=>({meteringPointId,identityAgency:'89',mode:'create_new_customer'}))
  const s=html(row({status:'approved',review_decision:{objectApplication:{version:1,decisions,receipts:[{key:'A',result:{customer_id:'a'}}]}}}))
  expect(s).toContain('Återuppta');expect(s).toContain('1 av 2');expect(s).not.toContain('Avvisa case');expect(s).not.toContain('<select')
  expect(s.match(/name="objectMode"/g)).toHaveLength(2)
 })
 it('does not offer reapplication of a completed batch',()=>{
  const s=html(row({status:'applied'}));expect(s).not.toContain('name="objectMode"');expect(s).not.toContain('Godkänn och applicera')
 })
 it('retains the legacy single-object form',()=>{
  const s=html(row({proposed_action:{objects:[{meteringPointId:'A',identityAgency:'89',registers:[]}]}}));expect(s).toContain('name="mode"');expect(s).not.toContain('name="objectMode"')
 })
 it('does not embed source identifiers as HTML',()=>{
  const r=row();(r.proposed_action.objects as {meteringPointId:string}[])[0].meteringPointId='<script>bad</script>'
  const s=html(r);expect(s).not.toContain('<script>bad</script>');expect(s).toContain('&lt;script&gt;')
 })
})
