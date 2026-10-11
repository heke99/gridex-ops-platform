import {expect} from 'vitest'

type Row=Record<string,unknown>
export type ObservationWindow=readonly [number,number]
type Sql=<T=unknown>(query:string)=>T
type Fixture={ids:{company:string;legal:string;profile:string};sender:string;app:string}
const clockKeys=['evaluatedAt','observedAt','completedAt'] as const

// Independent, read-only source snapshot BEFORE processing. Keep all selected
// records, including inactive intervals; no returned observation supplies this
// expected identity, its tenant, record census or routing evidence.
export function captureEscoTenantBasis(sql:Sql,lit:(value:string)=>string,f:Fixture){
 const company=lit(f.ids.company),actor=lit(f.ids.legal)
 const records:Row={}
 for(const [key,table,columns,scope] of [
  ['profiles','tenant_ediel_profiles','id,company_id,environment,market,is_enabled,valid_from,valid_to',`company_id=${company} AND environment='test' AND market='electricity' AND is_enabled`],
  ['identifiers','tenant_actor_identifiers','id,company_id,environment,actor_id,identifier_type,identifier_value,qualifier,subaddress,valid_from,valid_to',`company_id=${company} AND environment='test' AND identifier_type='EdielId'`],
  ['roles','tenant_actor_roles','id,company_id,environment,actor_id,role_code,valid_from,valid_to',`company_id=${company} AND environment='test' AND actor_id=${actor}`],
  ['relations','tenant_counterparty_relations','id,company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to',`company_id=${company} AND environment='test' AND relation_type='ediel_transport_agent' AND is_enabled`],
 ] as const)records[key]=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM (SELECT ${columns} FROM public.${table} WHERE ${scope}) r`)
 records.transportIdentifiers=[]
 expect(records.profiles).toEqual([expect.objectContaining({id:f.ids.profile,company_id:f.ids.company})])
 expect(records.identifiers).toEqual([expect.objectContaining({company_id:f.ids.company,actor_id:f.ids.legal,identifier_value:f.sender})])
 expect(records.roles).toEqual([expect.objectContaining({company_id:f.ids.company,actor_id:f.ids.legal,role_code:'energy_service_company'})])
 expect(records.relations).toEqual([])
 // Complete global receiver candidate census, not merely a company-filtered
 // match. These fixtures have neither delegation nor inbound route hints.
 expect(sql(`SELECT coalesce(jsonb_agg(company_id ORDER BY company_id),'[]') FROM public.tenant_actor_identifiers
  WHERE environment='test' AND identifier_type='EdielId' AND identifier_value=${lit(f.sender)}`)).toEqual([f.ids.company])
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_route_profiles WHERE environment='test'
  AND (upper(trim(own_ediel_id))=${lit(f.sender)} OR upper(trim(receiver_ediel_id))=${lit(f.sender)})`)).toBe(0)
 const settings=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.ediel_actor_settings r WHERE environment='test'
  AND (upper(trim(ediel_id))=${lit(f.sender)} OR upper(trim(actor_ediel_id))=${lit(f.sender)})`)
 expect(settings).toEqual([expect.objectContaining({company_id:f.ids.company,ediel_id:f.sender,actor_ediel_id:f.sender,subaddress_required:false})])
 expect(settings[0].application_reference??settings[0].default_application_reference).toBeNull()
 const expectedResolution={status:'resolved',companyId:f.ids.company,transportEdielId:f.sender,marketActorEdielId:f.sender,
  receiverEdielId:f.sender,receiverSubaddress:null,source:'verified_legal_identity',confidence:400,
  reasons:[`Inbound tenant löstes via verified_legal_identity för receiver ${f.sender}.`],warnings:[],candidateCompanyIds:[f.ids.company],
  evidence:[{companyId:f.ids.company,source:'verified_legal_identity',score:400,details:{legalActorId:f.ids.legal,legalEdielId:f.sender,
   transportActorId:f.ids.legal,transportEdielId:f.sender,representedByTransportAgent:false,transportRelationId:null,roleCodes:['energy_service_company'],
   identityEvidence:{version:1,owner:'canonical-tenant-ediel-identity-v1',historicalKnowledge:'not_established',sourceDisposition:'not_established',
    consistency:'independent_reads',records,completeness:'exact_count',evaluatedAt:'QUALIFIED_CLOCK',observedAt:'QUALIFIED_CLOCK',completedAt:'QUALIFIED_CLOCK'}}},
   {companyId:f.ids.company,source:'ediel_actor_settings',score:140,details:{actorSettingId:settings[0].id,matchedTransport:true,
    matchedMarketActor:true,subaddressRequired:false,transportEdielId:f.sender,marketActorEdielId:f.sender,receiverEdielId:f.sender,
    receiverSubaddress:null,applicationReference:f.app}}]}
 return expectedResolution
}

// Only this known current-observation facet may refresh. Every other field
// (including record validity times and other similarly named clocks) remains.
export function qualifyTenantObservation(payload:Row,window:ObservationWindow){
 expect(window.every(Number.isFinite)).toBe(true);expect(window[0]).toBeLessThanOrEqual(window[1])
 const value=structuredClone(payload),resolution=value.tenantResolution as Row
 expect(resolution).toBeTruthy();expect(resolution.source).toBe('verified_legal_identity')
 const evidence=resolution.evidence as Row[];expect(Array.isArray(evidence)).toBe(true)
 const verified=evidence.filter(row=>row.source==='verified_legal_identity');expect(verified).toHaveLength(1)
 const identity=(verified[0].details as Row).identityEvidence as Row
 expect(identity).toMatchObject({version:1,owner:'canonical-tenant-ediel-identity-v1',historicalKnowledge:'not_established',
  sourceDisposition:'not_established',consistency:'independent_reads',completeness:'exact_count'})
 const clocks=clockKeys.map(key=>{
  const time=identity[key];expect(typeof time).toBe('string');const instant=Date.parse(String(time))
  expect(Number.isFinite(instant)).toBe(true);expect(new Date(instant).toISOString()).toBe(time)
  expect(instant).toBeGreaterThanOrEqual(window[0]);expect(instant).toBeLessThanOrEqual(window[1])
  identity[key]='QUALIFIED_CLOCK';return instant
 })
 expect(clocks[0]).toBeLessThanOrEqual(clocks[1]);expect(clocks[1]).toBeLessThanOrEqual(clocks[2])
 return {value,clocks}
}
export function qualifyEscoTenantFirst(payload:Row,expectedResolution:Row,window:ObservationWindow){
 const observation=qualifyTenantObservation(payload,window)
 expect(observation.value.tenantResolution).toEqual(expectedResolution)
 return payload.tenantResolution
}
export function expectEscoTenantReplay(previous:Row,next:Row,firstWindow:ObservationWindow,replayWindow:ObservationWindow){
 expect(replayWindow[0]).toBeGreaterThanOrEqual(firstWindow[1])
 const before=qualifyTenantObservation(previous,firstWindow),after=qualifyTenantObservation(next,replayWindow)
 expect(after.value).toEqual(before.value)
 after.clocks.forEach((clock,index)=>expect(clock).toBeGreaterThanOrEqual(before.clocks[index]))
}
