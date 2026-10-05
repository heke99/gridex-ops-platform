// masterplan: TEN-11, AT-TEN-11
// Sender object errors are also never fabricated for stale local identity:
// __tests__/ediel-inbound-verified-tenant-context.test.ts (tagged).
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({inserts:[] as {table:string;row:Record<string,unknown>}[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const q:Record<string,unknown>={}
 Object.assign(q,{select:()=>q,eq:()=>q,maybeSingle:()=>q,limit:()=>q,
  insert:(row:Record<string,unknown>)=>{io.inserts.push({table,row});return q},
  update:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:{id:'held-message'},error:null}).then(resolve)})
 return q}}}))
import {createUnresolvedInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import type {ParsedEdifactEnvelope} from '@/lib/inbound-mail/edielEmailParser'

const parsed={messageFamily:'PRODAT',messageCode:'Z04',senderEdielId:'7300000000005',receiverEdielId:'7300000000001',senderSubAddress:null,receiverSubAddress:null,
 interchangeReference:'I-1',transactionReference:null,applicationReference:'23-DDQ-PRODAT',bgmReference:'DOC-1',rawPayload:"UNH+1+PRODAT:D:97A:UN:E2SE6A'",references:{},parties:{},
 errorCodes:[],freeText:[],segments:[],lineGroups:[]} as unknown as ParsedEdifactEnvelope

beforeEach(()=>{io.inserts=[]})

describe('TEN-11 a local tenant-selection problem is not a sender protocol error',()=>{
 for(const tenantStatus of ['unassigned','ambiguous'] as const){
  it(`${tenantStatus} routing is held for manual review as received, never as syntax failure or negative ACK`,async()=>{
   await createUnresolvedInboundEdielMessage({inboundEmailMessageId:'mail',parsed,tenantStatus,reasons:['local'],candidates:[]})
   const messages=io.inserts.filter(i=>i.table==='ediel_messages')
   expect(messages).toHaveLength(1)
   const {row}=messages[0]
   expect(row).toMatchObject({direction:'inbound',message_family:'PRODAT',status:'received',business_match_status:'blocked',failure_reason:null,company_id:null})
   expect(row.validation_report).toMatchObject({status:'routing_unresolved_manual_review',syntaxDecision:'not_checked'})
   // No outbound CONTRL/APERAK (E10, ERC 42/209) is created for our own routing problem.
   expect(io.inserts.some(i=>['CONTRL','APERAK','UTILTS_ERR'].includes(String(i.row.message_family))||i.row.direction==='outbound')).toBe(false)
  })
 }
})
