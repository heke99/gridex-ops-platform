// masterplan: P-06, AT-P-06
// Z13 never carries a date of birth (field 249) as customer identity; the
// inbound side reports the forbidden qualifier (ediel-prodat-aperak-text-evidence).
import {expect,it} from 'vitest'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

it('field 249 (DTM+329 date of birth) is not part of Z13/Z14/Z15/Z18 while it stays optional for Z01',()=>{
 const rule=(code:string)=>canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber==='249')!
 expect(rule('Z01').requirement).toBe('optional')
 for(const code of ['Z13','Z14','Z15','Z18'])expect(rule(code).requirement).not.toMatch(/required|optional|dependent/)
})

import {mapFacilityBusinessError} from '@/lib/energy/facilityDataErrors'
import {customerIntakeStatusForReadiness} from '@/lib/website/applicationReview'
it('protected identity is preserved: no automatic send, no retry, no customer contact, manual review and a blocked intake',()=>{
 expect(mapFacilityBusinessError('protected_identity')).toMatchObject({status:'protected_identity',retryAllowed:false,
  requiresCustomerContact:false,requiresGridOwnerContact:false,requiresSuperadminReview:true})
 expect(customerIntakeStatusForReadiness({status:'protected_identity',missingFields:[],blockingReasons:[],canStartSwitch:false} as never)).toBe('blocked')
})

// Actual consuming workflow with declared ports: an in-memory Supabase port
// that records every table write, plus the outbound-freeze, sender-mailbox,
// event and PDF ports. No mapper flag or readiness value is supplied by hand.
import {vi} from 'vitest'
const port=vi.hoisted(()=>({writes:[] as Array<{table:string,op:string,payload:unknown}>,events:[] as unknown[],
 rows:{} as Record<string,unknown>}))
vi.mock('@/lib/supabase/service',()=>{
 const builder=(table:string)=>{let op='select',payload:unknown=null
  const resolve=()=>{
   if(op!=='select'){port.writes.push({table,op,payload})
    return {data:op==='insert'?[{id:'req-1',case_reference:null,...(payload as object)}]:[{id:'row'}],error:null}}
   const row=port.rows[table]??null
   return {data:Array.isArray(row)?row:row,error:null}}
  const single=async()=>{const r=resolve();return {data:Array.isArray(r.data)?r.data[0]??null:r.data,error:null}}
  const q:Record<string,unknown>={}
  for(const m of ['select','eq','neq','in','is','or','order','limit'])q[m]=()=>q
  q.insert=(p:unknown)=>{op='insert';payload=p;return q};q.update=(p:unknown)=>{op='update';payload=p;return q}
  q.maybeSingle=single;q.single=single
  q.then=(ok:(v:unknown)=>unknown,err?:(e:unknown)=>unknown)=>Promise.resolve(resolve()).then(ok,err)
  return q}
 return {supabaseService:{from:builder,storage:{from:()=>({download:async()=>({data:null,error:null})})}}}})
vi.mock('@/lib/platform/outboundFreeze',()=>({assertOutboundAllowed:async()=>undefined}))
vi.mock('@/lib/customers/customerOperationEvents',()=>({emitCustomerOperationEvent:async(e:unknown)=>{port.events.push(e)}}))
vi.mock('@/lib/email/fullmaktPdf',()=>({renderFullmaktPdfBase64:async()=>'PDF'}))
vi.mock('@/lib/email/manualOperationsMailbox',async(orig)=>({...(await orig<object>()),
 resolveManualOperationsMailbox:async()=>({id:'mbx',mailboxType:'manual',fromEmail:'ops@example.invalid',replyToEmail:null})}))
import {requestMissingFacilityInformation} from '@/lib/customer-operations/requestMissingFacilityInformationCore'

it('the actual manual information workflow routes a protected identity to blocked review with no send, retry or customer contact',async()=>{
 port.rows={
  customer_sites:{id:'site-1',company_id:'co-1',customer_id:'cu-1',grid_owner_id:'go-1',address_hash:'h1',grid_area_code:'ABC',protected_identity:false},
  customers:{id:'cu-1',company_id:'co-1',protected_identity:true,customer_number:'K1',full_name:'Skyddad Person'},
  powers_of_attorney:[{id:'poa-1',status:'signed',scope:'facility_information_lookup',site_id:'site-1',accepted_at:'2026-09-01T10:00:00Z'}],
  grid_owner_contact_channels:[{id:'cc-1',email:'grid@example.invalid',company_id:null,source:'platform',is_enabled:true,is_verified:true}],
 }
 const result=await requestMissingFacilityInformation({companyId:'co-1',customerId:'cu-1',siteId:'site-1',actorUserId:'u-1'} as never)
 expect(result).toMatchObject({status:'blocked',emailOutboxId:null,nextAction:{code:'protected_identity_manual_review'},
  blockers:[{code:'protected_identity'}]})
 const tables=port.writes.map(w=>w.table)
 // No automatic send: no manual e-mail outbox row and no Ediel outbox row.
 expect(tables).not.toContain('manual_email_outbox');expect(tables).not.toContain('ediel_outbox')
 // The request is born in review, not ready-to-send, so no worker retry picks it up.
 const born=port.writes.find(w=>w.table==='grid_owner_information_requests'&&w.op==='insert')!.payload as Record<string,unknown>
 expect(born.status).toBe('needs_review');expect((born.metadata as Record<string,unknown>).protected_identity).toBe(true)
 // No customer contact: only the internal site/customer next action is set.
 expect(port.writes.filter(w=>w.table==='customer_sites'||w.table==='customers').map(w=>(w.payload as Record<string,unknown>).next_action))
  .toEqual(['Skyddad identitet. Hantera begäran manuellt.','Skyddad identitet. Hantera begäran manuellt.'])
 expect(tables).not.toContain('power_of_attorney_events')
})
