// masterplan: SC-009
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,count:null as number|null|undefined,options:[] as unknown[],limits:[] as number[],signals:[] as AbortSignal[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const q={select:(_columns:string,options?:unknown)=>{io.options.push(options);return q},eq:()=>q,
 limit:(n:number)=>{io.limits.push(n);return q},abortSignal:(signal:AbortSignal)=>{io.signals.push(signal);return q},
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:io.rows[table]??[],count:io.count===undefined?(io.rows[table]??[]).length:io.count,error:null}).then(resolve)};return q
}}}))
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import {parseActorRegistryXml} from '@/lib/actor-registry/parseActorRegistryXml'
const input={companyId:'company',environment:'test' as const,asOf:'2026-09-22T12:00:00Z',requireExactCounts:true}
beforeEach(()=>{const scope={company_id:'company',environment:'test',valid_from:'2026-01-01T00:00:00Z',valid_to:null};io.rows={tenant_ediel_profiles:[{...scope,id:'profile',market:'electricity',is_enabled:true}],tenant_actor_identifiers:[{...scope,id:'identifier',actor_id:'actor',identifier_type:'EdielId',identifier_value:'54321'}],tenant_actor_roles:[{...scope,id:'role',actor_id:'actor',role_code:'electricity_supplier'}],tenant_counterparty_relations:[]};io.count=undefined;io.options=[];io.limits=[];io.signals=[]})
it('reports exact-count completeness only after each actual bounded query confirms it',async()=>{
 const value=await resolveCanonicalTenantEdielIdentityWithEvidence(input)
 expect(value.evidence).toMatchObject({completeness:'exact_count',completedAt:expect.any(String),historicalKnowledge:'not_established',consistency:'independent_reads'})
 expect(io.options).toEqual(Array(4).fill({count:'exact'}));expect(io.limits).toEqual(Array(4).fill(8193));expect(io.signals).toHaveLength(4)
})
it.each([null,0,2,8193])('withholds identity evidence on missing, truncated or over-budget count %s',async count=>{io.count=count;await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('tenant_ediel_evidence_incomplete')})
it('rejects duplicate physical rows instead of accepting a falsely complete set',async()=>{io.rows.tenant_ediel_profiles.push({...io.rows.tenant_ediel_profiles[0]});await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('tenant_ediel_evidence_incomplete')})

// Synthetic official-shape source and declared tenant-read ports. Importing a
// technical address is separate from the explicitly configured tenant mandate.
function delegatedRegistryRecipient() {
 const [actor]=parseActorRegistryXml('<Registry><Market Code="EL" CountryCode="SE"><Company><Name>Synthetic delegated retailer</Name><Identifiers><Key Type="EdielId">62110</Key></Identifiers><Role>PowerSupplier</Role><EDIFACTDetails Type="PRODAT"><PartyId>62110</PartyId><InterchangePartyId>82150</InterchangePartyId><CommunicationAddress Type="SMTP">shared@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market></Registry>')
 const route=actor.routes[0]
 expect(actor.edielId).toBe('62110')
 expect(route).toMatchObject({partyId:'62110',interchangePartyId:'82150',isVerified:false,status:'needs_review'})
 io.rows.tenant_actor_identifiers[0].identifier_value=actor.edielId
 io.rows.tenant_counterparty_relations=[{company_id:input.companyId,environment:input.environment,id:'explicit-mandate',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true,valid_from:'2026-01-01T00:00:00Z',valid_to:null}]
 io.rows.platform_actor_identifiers=[{id:'transport-identifier',actor_id:'agent',identifier_type:'EdielId',identifier_value:route.interchangePartyId,valid_from:'2026-01-01',valid_to:null}]
 return {environment:input.environment,receiverEdielId:route.interchangePartyId,marketActorEdielId:route.partyId,messageFamily:route.messageFamily,messageCode:'Z04'}
}

it('SC-009 routes the sourced 82150 agent for legal62110 only through the actual current explicit delegation',async()=>{
 const recipient=delegatedRegistryRecipient()
 const result=await resolveInboundTenantFromIdentifiers(recipient)
 expect(result).toMatchObject({status:'resolved',companyId:input.companyId,source:'verified_legal_identity',transportEdielId:'82150',marketActorEdielId:'62110'})
 expect(result.evidence.find(row=>row.source==='verified_legal_identity')?.details).toMatchObject({legalEdielId:'62110',transportEdielId:'82150',representedByTransportAgent:true,transportRelationId:'explicit-mandate'})
 const current=await resolveCanonicalTenantEdielIdentityWithEvidence(input)
 expect(current.identity).toMatchObject({legalEdielId:'62110',transportEdielId:'82150',transportRelationId:'explicit-mandate'})
 expect(current.evidence.records.identifiers[0].identifier_value).toBe('62110')
 expect(current.evidence.records.transportIdentifiers[0].identifier_value).toBe('82150')
})

it.each(['missing','expired','ambiguous','wrong_transport'] as const)('SC-009 holds the same sourced technical/SMTP recipient with %s delegation evidence',async kind=>{
 const recipient=delegatedRegistryRecipient()
 if(kind==='missing')io.rows.tenant_counterparty_relations=[]
 else if(kind==='expired')io.rows.tenant_counterparty_relations[0].valid_to='2026-06-01T00:00:00Z'
 else if(kind==='ambiguous')io.rows.tenant_counterparty_relations.push({...io.rows.tenant_counterparty_relations[0],id:'second-mandate'})
 else io.rows.platform_actor_identifiers[0].identifier_value='82151'
 const result=await resolveInboundTenantFromIdentifiers(recipient)
 expect(result).toMatchObject({status:'unresolved',companyId:null,transportEdielId:'82150',marketActorEdielId:'62110'})
 expect(result.evidence.filter(row=>row.source==='verified_legal_identity')).toEqual([])
 expect(io.rows.tenant_actor_identifiers[0].identifier_value).toBe('62110')
})
