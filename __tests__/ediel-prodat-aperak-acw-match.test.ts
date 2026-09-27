import {expect,it,vi} from 'vitest'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'

const state=vi.hoisted(()=>({conditions:[] as string[],lookups:[] as {table:string;filters:Record<string,string>}[],attempts:[] as Record<string,unknown>[],requestRows:true,messageRows:true,linked:false}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>({
  insert(payload:Record<string,unknown>){state.attempts.push(payload);return Promise.resolve({error:null})},
  select(){const filters:Record<string,string>={};return {
    eq(key:string,value:string){filters[key]=value;return this},
    not(){return this},
    or(conditions:string){state.conditions.push(conditions);return this},
    in(key:string,values:string[]){state.lookups.push({table,filters:{...filters,[key]:values.join(',')}});return Promise.resolve({data:values.includes('linked-request')?[{id:'linked-request',external_reference:'WRONG'}]:[],error:null})},
    limit:async()=>{state.lookups.push({table,filters});return {data:table==='outbound_requests'&&state.requestRows
      ? [
        {id:'wrong-own-ack-interchange',external_reference:'I'},
        {id:'original-document',external_reference:'D'},
      ].filter(row=>filters.external_reference===row.external_reference||state.conditions.at(-1)?.includes(`external_reference.eq.${row.external_reference}`))
      : table==='ediel_messages'&&state.messageRows
        ? [{id:'wrong-own-ack-interchange',external_reference:'I',bgm_reference:'I'}, {id:'original-message',external_reference:'D',bgm_reference:'D',outbound_request_id:state.linked?'linked-request':null}]
          .filter(row=>filters.external_reference===row.external_reference||filters.bgm_reference===row.bgm_reference||state.conditions.at(-1)?.includes(`external_reference.eq.${row.external_reference}`))
      : [],error:null}},
  }}
})}}))

import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'

function prodatAperak(acw:boolean){
  return parseEdifactPayload(`UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+I++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'${acw?"RFF+ACW:D'":''}ERC+42::260'FTX+AAO++314::260+Felaktigt Sekvensnummer 4'UNT+${acw?6:5}+1'UNZ+1+I'`)
}

it('matches PRODAT APERAK through its original BGM ACW, never its own UNB or UNH',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match).toMatchObject({status:'matched',entityType:'ediel_message',entityId:'original-message'})
  expect(state.conditions).toEqual([])
  expect(state.lookups).toEqual([
    {table:'ediel_messages',filters:{company_id:'tenant-A',direction:'outbound',external_reference:'D'}},
    {table:'ediel_messages',filters:{company_id:'tenant-A',direction:'outbound',bgm_reference:'D'}},
  ])
})

it('holds PRODAT APERAK with no original ACW even when its own UNB can match',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(false)})
  expect(match.status).toBe('missing')
  expect(state.conditions).toEqual([])
  expect(state.lookups).toEqual([])
})

it('holds conflicting original ACW references instead of choosing the first',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=true
  const parsed=prodatAperak(true)
  parsed.references.ACW=['D','OTHER']
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed})
  expect(match.status).toBe('missing')
  expect(state.conditions).toEqual([])
  expect(state.lookups).toEqual([])
})

it('uses the same ACW constraint for an original outbound Ediel message without an outbound request',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=false;state.messageRows=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match).toMatchObject({status:'matched',entityType:'ediel_message',entityId:'original-message'})
  expect(state.conditions).toEqual([])
  expect(state.lookups).toEqual([
    {table:'ediel_messages',filters:{company_id:'tenant-A',direction:'outbound',external_reference:'D'}},
    {table:'ediel_messages',filters:{company_id:'tenant-A',direction:'outbound',bgm_reference:'D'}},
  ])
})

it('treats ACW filter punctuation as literal document data',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=true
  const parsed=prodatAperak(true)
  parsed.references.ACW=['D,external_reference.eq.I']
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed})
  expect(match.status).toBe('missing')
  expect(state.conditions).toEqual([])
  expect(state.lookups.map(row=>Object.values(row.filters).at(-1))).toEqual(Array(2).fill('D,external_reference.eq.I'))
})

it('does not borrow a request reference when no outbound Ediel BGM matches ACW',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=false;state.linked=false
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match.status).toBe('missing')
})

it('follows the matched outbound message to its linked request, even when request references differ',async()=>{
  state.conditions=[];state.lookups=[];state.attempts=[];state.requestRows=true;state.messageRows=true;state.linked=true
  const match=await matchOutboundRequestForInbound({companyId:'tenant-A',parsed:prodatAperak(true)})
  expect(match).toMatchObject({status:'matched',entityType:'outbound_request',entityId:'linked-request'})
  expect(state.lookups.at(-1)).toEqual({table:'outbound_requests',filters:{company_id:'tenant-A',id:'linked-request'}})
  state.linked=false
})
