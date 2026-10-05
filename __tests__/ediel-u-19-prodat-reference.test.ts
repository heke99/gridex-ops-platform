// masterplan: U-19, AT-U-19
import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,inValues:[] as string[],companies:[] as unknown[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{const f:{company?:unknown,refs?:string[],point?:unknown}={};const q={select:()=>q,
 eq:(c:string,v:unknown)=>{if(c==='company_id'){f.company=v;db.companies.push(v)}if(c==='metering_point_id')f.point=v;return q},in:(_c:string,v:string[])=>{f.refs=v;db.inValues=v;return q},order:()=>q,
 limit:async()=>({data:db.rows.filter(r=>r.company_id===f.company&&(!f.refs||f.refs.includes(String(r.external_reference)))&&(f.point===undefined||r.metering_point_id===f.point)),error:null}),
 maybeSingle:async()=>({data:null,error:null})};return q}}}))
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {findMatchingGridOwnerDataRequest} from '@/lib/ediel/matching'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
beforeEach(()=>{db.inValues=[];db.companies=[]})

const run=(message:EdielMessageRow)=>runUtiltsRuntimeForMessage(message,{canonicalPolicy:resolveCanonicalEdielPolicy({family:'UTILTS',
 messageCode:'E66',direction:'inbound',referenceDate:'2026-10-01',applicationReference:message.application_reference,mode:'parse'})})
const outcome=(message:EdielMessageRow)=>{const r=run(message);return {errors:r.ackPlan.aperakApplicationErrors,codes:r.ackPlan.utiltsErrCodes,
 issues:r.validation.issues.filter(i=>i.severity==='error').map(i=>i.code)}}
const withReference=(rff:string)=>{const source=energyHandoffMessage('2026-10-01')
 const raw_payload=recountEdifactUnt(source.raw_payload!.replace("MEA+AAZ++KWH'","MEA+AAZ++KWH'\n"+rff))
 expect(raw_payload).toContain(rff);return {...source,raw_payload}}

describe('U-19 a PRODAT case reference (field 226) is never a mandatory authorization key for E66',()=>{
 it('an E66 without, with an unknown, or with a non-TN reference gets the same validation and ACK outcome',()=>{
  const control=outcome(energyHandoffMessage('2026-10-01'))
  for(const rff of ["RFF+TN:PRODAT-CASE-THAT-DOES-NOT-EXIST'","RFF+ZZZ:OTHER-QUALIFIER'"])
   expect(outcome(withReference(rff))).toEqual(control)
 })
})

describe('U-19 the PRODAT case reference is used for correlation where it can be bound',()=>{
 const base={id:'m1',company_id:'c1',direction:'inbound',message_family:'UTILTS',message_code:'E66',external_reference:null,transaction_reference:null,
  grid_owner_data_request_id:null,metering_point_id:null}
 it('binds a tenant-scoped request through RFF+TN when it exists',async()=>{
  db.rows=[{id:'req-tn',company_id:'c1',external_reference:'PRODAT-CASE-1',metering_point_id:'mp'}]
  const hit=await findMatchingGridOwnerDataRequest({...base,parsed_payload:{references:[{qualifier:'TN',value:'PRODAT-CASE-1'},{qualifier:'ZZZ',value:'IGNORED'}]}} as unknown as EdielMessageRow)
  expect(hit?.id).toBe('req-tn')
  expect(db.inValues).toEqual(['PRODAT-CASE-1']);expect(db.companies).toEqual(['c1'])
 })
 it('without a bindable reference it does not invent a match and does not throw',async()=>{
  db.rows=[]
  await expect(findMatchingGridOwnerDataRequest({...base,parsed_payload:{references:[{qualifier:'ZZZ',value:'OTHER'}]}} as unknown as EdielMessageRow)).resolves.toBeNull()
  expect(db.inValues).toEqual([])
 })
 it('binds through the actual parser output shape (references keyed by qualifier)',async()=>{
  db.rows=[{id:'req-tn',company_id:'c1',external_reference:'PRODAT-CASE-1',metering_point_id:'mp'}]
  const parsed=parseEdifactPayload(withReference("RFF+TN:PRODAT-CASE-1'").raw_payload!)
  expect(parsed.references.TN).toEqual(['PRODAT-CASE-1'])
  const hit=await findMatchingGridOwnerDataRequest({...base,parsed_payload:{references:parsed.references}} as unknown as EdielMessageRow)
  expect(hit?.id).toBe('req-tn');expect(db.inValues).toEqual(['PRODAT-CASE-1'])
 })
 it('a same-company TN naming another point is not bound; the request for the resolved point wins',async()=>{
  db.rows=[{id:'req-other',company_id:'c1',external_reference:'PRODAT-CASE-1',metering_point_id:'mp-other'},
   {id:'req-own',company_id:'c1',external_reference:'OWN',metering_point_id:'mp'}]
  const hit=await findMatchingGridOwnerDataRequest({...base,metering_point_id:'mp',parsed_payload:{references:{TN:['PRODAT-CASE-1']}}} as unknown as EdielMessageRow)
  expect(hit?.id).toBe('req-own')
 })
 it('ambiguous TN candidates stay unbound and fall back to the point, without throwing',async()=>{
  db.rows=[{id:'req-a',company_id:'c1',external_reference:'DUP',metering_point_id:null},{id:'req-b',company_id:'c1',external_reference:'DUP',metering_point_id:null}]
  await expect(findMatchingGridOwnerDataRequest({...base,parsed_payload:{references:{TN:['DUP']}}} as unknown as EdielMessageRow)).resolves.toBeNull()
 })
 it('an unbindable TN hint does not change the E66 validation and ACK outcome',()=>{
  expect(outcome(withReference("RFF+TN:DUP'"))).toEqual(outcome(energyHandoffMessage('2026-10-01')))
 })
})
