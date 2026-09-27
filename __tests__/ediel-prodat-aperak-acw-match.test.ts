import {expect,it,vi} from 'vitest'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'

const state=vi.hoisted(()=>({conditions:[] as string[],companies:[] as string[],attempts:[] as Record<string,unknown>[],requestRows:true}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>({
  insert(payload:Record<string,unknown>){state.attempts.push(payload);return Promise.resolve({error:null})},
  select(){return {
    eq(key:string,value:string){if(key==='company_id')state.companies.push(value);return this},
    not(){return this},
    or(conditions:string){state.conditions.push(conditions);return this},
    limit:async()=>({data:table==='outbound_requests'&&state.requestRows
      ? [
        {id:'wrong-own-ack-interchange',external_reference:'I'},
        {id:'original-document',external_reference:'D'},
      ].filter(row=>state.conditions.at(-1)?.includes(`external_reference.eq.${row.external_reference}`))
      : table==='ediel_messages'
        ? [{id:'wrong-own-ack-interchange',external_reference:'I'}, {id:'original-message',external_reference:'D'}]
          .filter(row=>state.conditions.at(-1)?.includes(`external_reference.eq.${row.external_reference}`))
      : [],error:null}),
  }}
})}}))

import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'

function prodatAperak(acw:boolean){
  return parseEdifactPayload(`UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+I++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'${acw?"RFF+ACW:D'":''}ERC+42::260'FTX+AAO++314::260+Felaktigt Sekvensnummer 4'UNT+${acw?6:5}+1'UNZ+1+I'`)
}

it('matches PRODAT APERAK through its original BGM ACW, never its own UNB or UNH',async()=>{
  state.conditions=[];state.companies=[];state.attempts=[];state.requestRows=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match).toMatchObject({status:'matched',entityType:'outbound_request',entityId:'original-document'})
  expect(state.conditions).toEqual(['external_reference.eq.D'])
  expect(state.companies).toEqual(['tenant-A'])
})

it('holds PRODAT APERAK with no original ACW even when its own UNB can match',async()=>{
  state.conditions=[];state.companies=[];state.attempts=[];state.requestRows=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(false)})
  expect(match.status).toBe('missing')
  expect(state.conditions).toEqual([])
})

it('holds conflicting original ACW references instead of choosing the first',async()=>{
  state.conditions=[];state.companies=[];state.attempts=[];state.requestRows=true
  const parsed=prodatAperak(true)
  parsed.references.ACW=['D','OTHER']
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed})
  expect(match.status).toBe('missing')
  expect(state.conditions).toEqual([])
})

it('uses the same ACW constraint for an original outbound Ediel message without an outbound request',async()=>{
  state.conditions=[];state.companies=[];state.attempts=[];state.requestRows=false
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match).toMatchObject({status:'matched',entityType:'ediel_message',entityId:'original-message'})
  expect(state.conditions).toEqual(['external_reference.eq.D','external_reference.eq.D,bgm_reference.eq.D'])
  expect(state.companies).toEqual(['tenant-A','tenant-A'])
})
