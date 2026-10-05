// masterplan: TEN-01, AT-TEN-01, TEN-02, AT-TEN-02
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({tables:[] as string[],writes:[] as string[],rows:{} as Record<string,Record<string,unknown>[]>,
 legacy:vi.fn(),authorize:vi.fn(),identity:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{io.tables.push(table)
 const write=(op:string)=>()=>{io.writes.push(`${op}:${table}`);return q}
 const q:Record<string,unknown>={select:()=>q,order:()=>q,eq:()=>q,is:()=>q,limit:()=>q,abortSignal:()=>q,
  insert:write('insert'),update:write('update'),upsert:write('upsert'),delete:write('delete'),
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:io.rows[table]??[],count:(io.rows[table]??[]).length,error:null}).then(resolve)}
 return q}}}))
vi.mock('@/lib/ediel/core/kernelLegacy',()=>({createCanonicalOutboundMessage:io.legacy,resolveCanonicalOutboundContext:vi.fn(),resolveCanonicalInboundActor:vi.fn(),
 resolveOutboundMessageVersion:vi.fn(),resolveInboundAcceptedVersions:vi.fn(),registerInboundCanonicalMessage:vi.fn(),buildCanonicalReferencesForOutbound:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.authorize}))
import {createCanonicalOutboundMessage} from '@/lib/ediel/core/kernel'
import {resolveCanonicalActorContext} from '@/lib/ediel/core/actorRegistry'
import {assertInboundTransportMatchesTenantIdentity,resolveCanonicalTenantEdielIdentity} from '@/lib/ediel/tenant/tenantEdielIdentity'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'

const company='00000000-0000-4000-8000-000000000001'
const legal='7300000000001',gridex='7300000000999'
const scope={company_id:company,environment:'test',valid_from:'2026-01-01T00:00:00Z',valid_to:null}
const setting=(patch:Record<string,unknown>={})=>({id:'setting-esco',company_id:company,environment:'test',is_active:true,actor_role:'energy_service_company',
 ediel_id:legal,actor_ediel_id:legal,actor_name:'Tenant Energi AB',legal_name:'Tenant Energi AB',mailbox:'ediel@tenant.example',...patch})
const draft=(patch:Partial<CreateEdielMessageInput>={}):CreateEdielMessageInput=>({actorUserId:'user',companyId:company,direction:'outbound',messageStandard:'edifact',
 messageFamily:'PRODAT',messageCode:'Z13',environment:'test',senderEdielId:legal,receiverEdielId:'7300000000002',applicationReference:'23-DGI-PRODAT',
 communicationRouteId:'route',routeProfileId:'profile',sourceOperationId:'op',customerId:'customer',rawPayload:'UNA:+.? \'UNB+UNOC:3',...patch})
beforeEach(()=>{
 io.tables=[];io.writes=[];io.legacy.mockReset();io.authorize.mockReset().mockResolvedValue(undefined)
 io.rows={ediel_actor_settings:[setting()],tenant_ediel_profiles:[{...scope,id:'profile',market:'electricity',is_enabled:true}],
  tenant_actor_identifiers:[{...scope,id:'identifier',actor_id:'legal-actor',identifier_type:'EdielId',identifier_value:legal}],
  tenant_actor_roles:[{...scope,id:'role',actor_id:'legal-actor',role_code:'energy_service_company'}],tenant_counterparty_relations:[],
  // A platform (Gridex) actor exists in the directory; it must never be adopted without an explicit relation.
  platform_actor_identifiers:[{id:'gridex-id',actor_id:'gridex-actor',identifier_type:'EdielId',identifier_value:gridex,valid_from:null,valid_to:null}]}
})

describe('TEN-01 verified execution context before customer mutation',()=>{
 it('a failed identity gate stops the kernel before any message or customer row is written',async()=>{
  io.rows.tenant_actor_roles=[]
  await expect(createCanonicalOutboundMessage({actorUserId:'user',baseInput:draft()} as never)).rejects.toThrow('tenant_market_roles_missing')
  expect(io.legacy).not.toHaveBeenCalled()
  expect(io.writes).toEqual([])
  expect(io.tables).not.toContain('ediel_messages')
  expect(io.tables).not.toContain('customers')
 })
 it('a wire sender that is not the verified transport identity is refused without any write',async()=>{
  await expect(createCanonicalOutboundMessage({actorUserId:'user',baseInput:draft({senderEdielId:gridex})} as never)).rejects.toThrow('canonical_outbound_sender_identity_mismatch')
  expect(io.legacy).not.toHaveBeenCalled();expect(io.writes).toEqual([])
 })
 it('an unauthorized tenant actor is refused before identity resolution or any write',async()=>{
  io.authorize.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(createCanonicalOutboundMessage({actorUserId:'user',baseInput:draft()} as never)).rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(io.tables).toEqual([]);expect(io.legacy).not.toHaveBeenCalled()
 })
})

describe('TEN-01 prohibited: tenant name, domain or e-mail never replaces market identity',()=>{
 it('the market identity is the registered legal Ediel id, never the tenant name or mailbox',async()=>{
  const context=await resolveCanonicalActorContext('test',company,'energy_service_company')
  expect(context).toMatchObject({senderEdielId:legal,legalActorEdielId:legal,transportActorEdielId:legal,senderName:'Tenant Energi AB',mailbox:'ediel@tenant.example'})
  for(const value of [context.senderEdielId,context.legalActorEdielId,context.transportActorEdielId])expect(value).toMatch(/^\d{13}$/)
 })
 it('a profile carrying only a name, domain and e-mail has no market identity and is refused',async()=>{
  io.rows.ediel_actor_settings=[setting({ediel_id:null,actor_ediel_id:null,sender_name:'tenant.example'})]
  await expect(resolveCanonicalActorContext('test',company,'energy_service_company')).rejects.toThrow('saknar ediel_id/actor_ediel_id')
 })
 it('a profile id that is a name or e-mail is refused because it is not the verified legal identity',async()=>{
  for(const value of ['Tenant Energi AB','ediel@tenant.example','tenant.example']){
   io.rows.ediel_actor_settings=[setting({ediel_id:value,actor_ediel_id:value})]
   await expect(resolveCanonicalActorContext('test',company,'energy_service_company')).rejects.toThrow('canonical_actor_legacy_identity_mismatch')
  }
 })
})

describe('TEN-02 own legal Ediel id; shared mailbox is transport only',()=>{
 it('keeps the tenant own legal id as transport id when no transport-agent relation exists, without writing anything',async()=>{
  const identity=await resolveCanonicalTenantEdielIdentity({companyId:company,environment:'test'})
  expect(identity).toMatchObject({legalEdielId:legal,transportEdielId:legal,representedByTransportAgent:false,transportRelationId:null})
  expect(io.tables).not.toContain('platform_actor_identifiers')
  expect(io.writes).toEqual([])
 })
 it('never registers a technical agent automatically: no relation row is created and the Gridex id is not adopted',async()=>{
  await resolveCanonicalActorContext('test',company,'energy_service_company')
  expect(io.writes).toEqual([])
  const context=await resolveCanonicalActorContext('test',company,'energy_service_company')
  expect(context.senderEdielId).not.toBe(gridex);expect(context.representedByTransportAgent).toBe(false)
 })
 it('uses a transport agent only from an explicit, distinct relation; the legal id stays the tenant own',async()=>{
  io.rows.tenant_counterparty_relations=[{...scope,id:'rel',counterparty_actor_id:'gridex-actor',relation_type:'ediel_transport_agent',is_enabled:true}]
  const identity=await resolveCanonicalTenantEdielIdentity({companyId:company,environment:'test'})
  expect(identity).toMatchObject({legalEdielId:legal,transportEdielId:gridex,representedByTransportAgent:true,transportRelationId:'rel'})
  io.rows.platform_actor_identifiers=[{id:'x',actor_id:'gridex-actor',identifier_type:'EdielId',identifier_value:legal,valid_from:null,valid_to:null}]
  await expect(resolveCanonicalTenantEdielIdentity({companyId:company,environment:'test'})).rejects.toThrow('tenant_ediel_transport_agent_not_distinct')
  expect(io.writes).toEqual([])
 })
 it('an inbound UNB receiver must be the tenant transport id; a shared mailbox does not grant identity',()=>{
  const identity={companyId:company,environment:'test' as const,legalActorId:'a',legalEdielId:legal,transportActorId:'a',transportEdielId:legal,roleCodes:['energy_service_company'],representedByTransportAgent:false,transportRelationId:null}
  expect(()=>assertInboundTransportMatchesTenantIdentity({identity,unbReceiverEdielId:legal})).not.toThrow()
  expect(()=>assertInboundTransportMatchesTenantIdentity({identity,unbReceiverEdielId:gridex})).toThrow('inbound_transport_identity_mismatch')
  expect(()=>assertInboundTransportMatchesTenantIdentity({identity,unbReceiverEdielId:null})).toThrow('inbound_unb_receiver_missing')
 })
})
