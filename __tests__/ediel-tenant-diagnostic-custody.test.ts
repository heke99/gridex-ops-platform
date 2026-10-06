import {beforeEach,expect,it,vi} from 'vitest'
import {resolveInboundTenantForMessage} from '@/lib/ediel/core/tenantResolver'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {msg} from './fixtures/prodat-prior-flow'

const io=vi.hoisted(()=>({from:vi.fn(),resolve:vi.fn(),event:vi.fn(),stored:null as EdielMessageRow|null,
  diagnostics:[] as Record<string,unknown>[],updates:[] as Record<string,unknown>[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event,getEdielMessageById:vi.fn()}))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async importOriginal=>({
  ...await importOriginal<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>(),
  resolveInboundTenantFromIdentifiers:io.resolve,
}))
const company='00000000-0000-4000-8000-000000000001'
const foreign='00000000-0000-4000-8000-000000000002'
beforeEach(()=>{
  vi.clearAllMocks();io.diagnostics=[];io.updates=[]
  io.event.mockResolvedValue({})
  io.from.mockImplementation((table:string)=>{
    let operation='select',payload:Record<string,unknown>|undefined
    const result=()=>{
      if(table==='ediel_messages'&&operation==='update'){
        io.updates.push(payload!);io.stored={...io.stored!,...payload} as EdielMessageRow
        return {data:io.stored,error:null}
      }
      if(table==='ediel_unresolved_items'){
        if(operation==='insert'){
          const saved={id:'diagnostic',...payload};io.diagnostics.push(saved)
          return {data:saved,error:null}
        }
        return {data:io.diagnostics[0]??null,error:null}
      }
      throw new Error(`UNEXPECTED_DATABASE_OPERATION:${table}:${operation}`)
    }
    const chain={select:()=>chain,eq:()=>chain,limit:()=>chain,
      update:(p:Record<string,unknown>)=>{operation='update';payload=p;return chain},
      insert:(p:Record<string,unknown>)=>{operation='insert';payload=p;return chain},
      single:async()=>result(),maybeSingle:async()=>result()}
    return chain
  })
})

for(const status of ['not_found','ambiguous'] as const)
for(const custody of [company,null])
for(const environment of ['test','production'] as const)
it(`keeps ${status} business resolution held and binds diagnostic to persisted ${custody??'unattributed'} ${environment} custody`,async()=>{
  // Directory resolution is a declared input port; parsing, source update and
  // diagnostic creation run through the real public resolver. No business
  // owner or tenant invariant is mocked into a successful result.
  const message={...msg('Z15','Z24','CASE-ALPHA'),company_id:foreign,environment,
    parsed_payload:{companyId:foreign}} as EdielMessageRow
  io.stored={...message,company_id:custody}
  io.resolve.mockResolvedValue({status,companyId:null,evidence:[],candidateCompanyIds:[foreign],
    reasons:['Synthetic directory refusal'],warnings:[],confidence:0,source:null})
  const result=await resolveInboundTenantForMessage({actorUserId:'synthetic-actor',message})
  expect(result.status).toBe(status==='ambiguous'?'tenant_ambiguous':'tenant_not_found')
  expect(result.companyId).toBeNull()
  expect(result.message).toMatchObject({company_id:custody,environment,business_match_status:'business_blocked',processing_status:'routing_unresolved'})
  expect(io.updates[0]).not.toHaveProperty('company_id')
  expect(io.diagnostics).toHaveLength(1)
  expect(io.diagnostics[0]).toMatchObject({company_id:custody,environment,source_message_id:message.id,status:'open',
    issue_type:result.status,extracted_identifiers:{tenantResolution:{status,companyId:null}}})
  // The same held original reuses its diagnostic rather than widening custody.
  await resolveInboundTenantForMessage({actorUserId:'synthetic-actor',message:result.message})
  expect(io.diagnostics).toHaveLength(1)
  expect(io.stored!.company_id).toBe(custody)
})
