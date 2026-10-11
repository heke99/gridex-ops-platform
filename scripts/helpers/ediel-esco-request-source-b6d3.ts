// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Prospective public source refusal; no hooks, tests or manufactured authority.
import {createHash,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {segmentComposite,segmentElementCount,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {ServicePermissionOriginBasis} from '@/lib/ediel/services/permissionOrigin'
import {reviewNativeEscoAssignmentEvidence as review,seedNativeEscoFixture,
 prepareNativeEscoPermissionFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from '../fixtures/ediel-service-evidence-native'

type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Row=Record<string,unknown>
type State={business:Row;foreign:Row;commands:Row[];effects:Record<string,number>}
type Reviews={evidence:Row;current:boolean}[]
type Ports={state:(f:Fixture)=>State;reviews:(f:Fixture,e:Awaited<ReturnType<typeof review>>)=>Reviews;sentinel:()=>void}
const utc=(value:string)=>new Date(value).toISOString().replace('.000Z','+00:00')

export async function refuseEscoMissingHistoricalEnd(f:Fixture,ports:Ports){
 expect(f.mode).toBe('VH');expect(f.fields.data_end).toBeNull()
 const scope={companyId:f.ids.company,beneficiaryCompanyId:f.ids.beneficiary,providerActorId:f.ids.legal,
  actorProfileId:f.ids.profile,customerId:f.ids.customer,dsoActorId:f.ids.dso,environment:'test',mode:'VH',
  purpose:f.fields.purpose,objects:[f.point],products:[f.product],fields:f.fields.field_sets,
  dataStart:utc(f.fields.data_start),dataEnd:null,validFrom:utc(f.fields.valid_from),validTo:utc(f.fields.valid_to)}
 expect(f.current().scope).toEqual(scope)
 const assignment=sql<Row>(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a
  WHERE company_id=${lit(f.ids.company)} AND id=${lit(f.assignment)}`)
 expect(assignment).toMatchObject({id:f.assignment,company_id:f.ids.company,status:'held',mode:'VH',data_end:null,
  beneficiary_company_id:f.ids.beneficiary,provider_actor_id:f.ids.legal,actor_profile_id:f.ids.profile,
  customer_id:f.ids.customer,dso_actor_id:f.ids.dso,environment:'test',purpose:f.fields.purpose,
  object_ids:[f.point],product_ids:[f.product],field_sets:f.fields.field_sets})
 for(const key of ['data_start','valid_from','valid_to'] as const)expect(assignment[key]).toBe(utc(f.fields[key]))
 const journal=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY scope_basis_version),'[]')
  FROM gridex_service_administration.scope_versions s WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)}`)
 expect(journal).toEqual([{company_id:f.ids.company,assignment_id:f.assignment,scope_basis_version:f.current().basis,
  scope,recorded_at:assignment.created_at}])
 ports.sentinel()
 const reviewed=await review(f),reviews=ports.reviews(f,reviewed)
 const terms=(kind:unknown)=>({permission_reporting_frequency:'D',permission_purpose_code:'B72',
  permission_request_grid_area:'TES',permission_reporting_term_kind:'bounded',permission_customer_classification:'private',
  permission_agreement_reference:kind==='end_user_contract'?'SYN-'+f.ids.customer.slice(0,20):null,
  permission_requested_method:kind==='end_user_contract'?'Z04':null,
  permission_network_contract_start:kind==='dso_contract'?'2026-05-01':null,permission_network_contract_end:null})
 for(const row of reviews)expect(row.evidence).toMatchObject(terms(row.evidence.kind))
 const archives=sql<{artifact:Row;normalized:Row;current:boolean}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'artifact',to_jsonb(a),'normalized',gridex_ediel_services.evidence_terms_v1(e),
  'current',gridex_ediel_services.receipt_current_v1(a)) ORDER BY a.evidence_kind),'[]')
  FROM gridex_ediel_services.artifacts a JOIN gridex_ediel_services.reviews r ON r.artifact_id=a.id AND r.company_id=a.company_id
  JOIN public.ediel_service_evidence e ON e.id=r.evidence_id AND e.company_id=r.company_id AND e.assignment_id=a.assignment_id
  WHERE a.company_id=${lit(f.ids.company)} AND a.assignment_id=${lit(f.assignment)} AND a.id IN (${reviewed.artifacts.map(lit).join(',')})
   AND r.decision='approved' AND r.scope_basis_version=${f.current().basis}`)
 expect(archives).toHaveLength(5)
 expect(archives.map(a=>a.artifact.evidence_kind).sort()).toEqual(['downstream_use','dso_contract','end_user_contract','privacy_roles','service_contract'])
 for(const archive of archives){
  expect(archive.current).toBe(true)
  expect(archive.artifact).toMatchObject({company_id:f.ids.company,assignment_id:f.assignment,environment:'test',
   scope_basis_version:f.current().basis,source_hash:reviewed.hash,source_version:'synthetic-v1',scope})
  expect(archive.artifact.evidence_terms).toEqual(archive.normalized)
  const expected:Row=terms(archive.artifact.evidence_kind)
  if(archive.artifact.evidence_kind!=='dso_contract'){
   for(const key of ['permission_network_contract_start','permission_network_contract_end']){
    delete expected[key];expect(Object.hasOwn(archive.normalized,key)).toBe(false)
   }
  }
  expect(archive.normalized).toMatchObject(expected)
 }
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version}))
  .toMatchObject({status:'approved_waiting_permission',accessGranted:false})
 const current=f.current()
 expect(current.scope).toEqual(scope)
 expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`))
  .toEqual({status:'authorized',providerCompanyId:f.ids.company,providerActorId:f.ids.legal,beneficiaryCompanyId:f.ids.beneficiary,
   assignmentId:f.assignment,assignmentVersion:current.version,environment:'test',customerId:f.ids.customer,
   dsoActorId:f.ids.dso,mode:'VH',purpose:f.fields.purpose})
 const day=sql<string>(`SELECT to_jsonb((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date::text)`)
 expect(f.fields.data_start.slice(0,10)).toBe('2026-06-01')
 expect(Date.parse(day)).toBeGreaterThan(Date.parse(f.fields.data_start))
 expect(Date.parse(f.fields.data_start)).toBeGreaterThanOrEqual(Date.parse('2026-05-01'))
 expect(Date.parse(f.fields.data_start)).toBeGreaterThanOrEqual(Date.parse(day.replace(/^\d{4}/,String(Number(day.slice(0,4))-3))))
 const before=ports.state(f)
 for(const table of ['metering_permissions','ediel_assignment_permission_links',
  'gridex_service_administration.permission_request_owners','gridex_service_permission.request_timing_receipts',
  'gridex_service_permission.origins','ediel_messages','ediel_message_intents','outbound_requests','ediel_outbox',
  'ediel_data_access_grants','metering_permission_sites','customer_supply_periods','supplier_switch_requests',
  'meter_reading_series','meter_reading_values','gridex_ediel_transport.attempts',
  'gridex_received_sources.permission_effect_receipts','gridex_received_sources.permission_effect_transitions_v1','exports'])
  expect(before.business[table]).toEqual([])
 for(const count of Object.values(before.effects))expect(count).toBe(0)
 expect(before.commands.length).toBeGreaterThan(0)
 const stableReviews=ports.reviews(f,reviewed)
 expect(stableReviews).toEqual(reviews)
 const command={action:'request_access',assignmentId:f.assignment,expectedVersion:current.version,preferredRouteId:f.ids.route}
 expect(Object.hasOwn(command,'permissionId')).toBe(false)
 for(let retry=0;retry<2;retry++){
  expect(await f.command(command)).toEqual({status:'held',missing:['esco_historical_end_required']})
  expect(ports.state(f)).toEqual(before);expect(f.current()).toEqual(current)
  expect(ports.reviews(f,reviewed)).toEqual(stableReviews)
  ports.sentinel();expect(nativeEscoExternal.send).not.toHaveBeenCalled()
 }
}

type SentExpectations={mode:'V'|'VH';external:string;messageReference:string;li:string;
 sender:string;receiver:string;legalSender:string;legalReceiver:string;customerId:string;customerQualifier:'SE1'|'SE2';
 customerName:string;country:string;reportStart:string;reportEnd:string|null;reportingTerm:'bounded'|'indefinite';
 method:string;frequency:string;product:string;purpose:string;agreement:string}
type RenderWindow={beforePrepare:number;afterPrepare:number}
const minute=(instant:number)=>new Date(instant+3600000).toISOString().slice(0,16).replace(/[-T:]/g,'')
const sourceText=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null

// Literal P26.A 23-field inventory, independent of renderer/matrix evaluation.
// Observes original SENT bytes only; never edits, persists or sends a mutant.
export function qualifyEscoSentZ13Fields(rawPayload:string,expected:SentExpectations,window:RenderWindow){
 expect(rawPayload.startsWith('UNA')).toBe(true)
 const {segments,una}=tokenizeEdifact(rawPayload)
 const all=(tag:string)=>segments.filter(s=>s.tag===tag)
 const one=(tag:string)=>{const found=all(tag);expect(found,tag).toHaveLength(1);return found[0]}
 const composite=(s:typeof segments[number],position:number)=>segmentComposite(s,position,una)
 const scalar=(s:typeof segments[number],position:number,value:string)=>expect(composite(s,position)).toEqual([value])
 const unb=one('UNB'),unh=one('UNH'),unt=one('UNT'),unz=one('UNZ'),lin=one('LIN'),bgm=one('BGM')
 expect(segments[0]).toBe(unb);expect(segments[1]).toBe(unh);expect(segments.at(-2)).toBe(unt);expect(segments.at(-1)).toBe(unz)
 scalar(unb,7,'23-DGI-PRODAT');scalar(unb,5,expected.external)
 expect(composite(unb,2)[0]).toBe(expected.sender);expect(composite(unb,3)[0]).toBe(expected.receiver)
 scalar(unh,1,expected.messageReference);expect(composite(unh,2)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(segmentElementCount(unh,una)).toBe(2)
 scalar(unt,1,String(segments.indexOf(unt)-segments.indexOf(unh)+1));scalar(unt,2,expected.messageReference)
 scalar(unz,1,'1');scalar(unz,2,expected.external)
 expect(segmentElementCount(unt,una)).toBe(2);expect(segmentElementCount(unz,una)).toBe(2)
 const linePosition=segments.indexOf(lin),header=segments.slice(2,linePosition),own=segments.slice(linePosition+1,-2)
 expect(header).toContain(bgm);expect(segmentElementCount(bgm,una)).toBe(4)
 scalar(bgm,1,'Z13');scalar(bgm,2,expected.external);scalar(bgm,3,'9');scalar(bgm,4,'AB')
 expect(expected.external).toMatch(/^.{1,35}$/);expect(expected.external).not.toBe(expected.messageReference)
 expect(segmentElementCount(lin,una)).toBe(1);scalar(lin,1,'1')
 const qualified=(tag:string,q:string,index=1)=>all(tag).filter(s=>composite(s,index)[0]===q)
 const dated=(q:string,scope:typeof segments,value?:string)=>{
  const found=qualified('DTM',q);expect(found,'DTM '+q).toHaveLength(1);const s=found[0]
  expect(scope).toContain(s);expect(segmentElementCount(s,una)).toBe(1)
  const parts=composite(s,1);expect(parts).toHaveLength(3);expect(parts[0]).toBe(q);expect(parts[2]).toBe(q==='ZZZ'?'805':'203')
  if(value!==undefined)expect(parts[1]).toBe(value)
  return parts[1]
 }
 const generated=dated('137',header)
 expect(generated).toMatch(/^\d{12}$/)
 const utcWire=Date.parse(`${generated.slice(0,4)}-${generated.slice(4,6)}-${generated.slice(6,8)}T${generated.slice(8,10)}:${generated.slice(10,12)}:00Z`)
 expect(Number.isFinite(utcWire)).toBe(true);expect(minute(utcWire-3600000)).toBe(generated)
 expect(Number.isFinite(window.beforePrepare)&&Number.isFinite(window.afterPrepare)).toBe(true)
 expect(window.afterPrepare).toBeGreaterThanOrEqual(window.beforePrepare)
 expect(generated>=minute(window.beforePrepare)&&generated<=minute(window.afterPrepare)).toBe(true)
 dated('ZZZ',header,'1');dated('90',own,minute(Date.parse(expected.reportStart)))
 if(expected.reportingTerm==='bounded'){
  expect(expected.reportEnd).toBeTruthy();dated('91',own,minute(Date.parse(expected.reportEnd!)))
 }else{expect(expected.reportingTerm).toBe('indefinite');expect(expected.reportEnd).toBeNull();expect(qualified('DTM','91')).toHaveLength(0)}
 const party=(q:string,id:string,scope:typeof segments)=>{
  const found=qualified('NAD',q);expect(found).toHaveLength(1);const s=found[0]
  expect(scope).toContain(s);expect(segmentElementCount(s,una)).toBe(9);scalar(s,1,q)
  expect(composite(s,2)).toEqual([id,'160','SVK']);scalar(s,9,'SE')
 }
 party('FR',expected.legalSender,header);party('DO',expected.legalReceiver,header)
 const pairs=[['Z04',[expected.method]],['Z12',['','','',expected.frequency]],['Z13',[expected.mode==='V'?'S17':'S18']],
  ['Z14',['','','','',expected.product]],['Z22',['E19']],['Z24',[expected.purpose]]] as const
 expect(all('CCI')).toHaveLength(6);expect(all('CAV')).toHaveLength(6)
 const positions:number[]=[]
 for(const [q,values] of pairs){
  const found=qualified('CCI',q,2);expect(found,q).toHaveLength(1);const cci=found[0],position=segments.indexOf(cci),cav=segments[position+1]
  expect(own).toContain(cci);expect(own).toContain(cav);expect(cav.tag).toBe('CAV')
  expect(segmentElementCount(cci,una)).toBe(2);scalar(cci,1,'');expect(composite(cci,2)).toEqual([q])
  expect(segmentElementCount(cav,una)).toBe(1);expect(composite(cav,1)).toEqual(values);positions.push(position)
 }
 expect(expected.frequency).toBe('D');expect(expected.purpose).toBe('B72');expect(expected.product).toMatch(/^.{1,35}$/)
 const datePositions=all('DTM').filter(s=>own.includes(s)).map(s=>segments.indexOf(s))
 for(const position of datePositions)expect(position).toBeLessThan(Math.min(...positions))
 const ref=(q:string,value:string)=>{
  const found=qualified('RFF',q);expect(found).toHaveLength(1);const s=found[0]
  expect(own).toContain(s);expect(segments.indexOf(s)).toBeGreaterThan(Math.max(...positions)+1)
  expect(segmentElementCount(s,una)).toBe(1);expect(composite(s,1)).toEqual([q,value]);expect(value).toMatch(/^.{1,35}$/)
  return segments.indexOf(s)
 }
 const referencePositions=[ref('LI',expected.li),ref('ANJ',expected.agreement)]
 const customers=qualified('NAD','UD');expect(customers).toHaveLength(1);const customer=customers[0]
 expect(own).toContain(customer);expect(segments.indexOf(customer)).toBeGreaterThan(Math.max(...referencePositions))
 expect(segmentElementCount(customer,una)).toBe(9);scalar(customer,1,'UD')
 expect(composite(customer,2)).toEqual([expected.customerId,expected.customerQualifier,'260'])
 expect(composite(customer,4)).toEqual([expected.customerName]);expect(expected.customerName.length).toBeLessThanOrEqual(35)
 scalar(customer,9,expected.country);expect(expected.country).toBe('SE')
 expect(qualified('DTM','329')).toHaveLength(0);expect(qualified('RFF','Z05')).toHaveLength(0);expect(qualified('RFF','Z09')).toHaveLength(0)
}

export function qualifyEscoSentZ13RequiredInventory(input:{f:Fixture;p:Awaited<ReturnType<typeof prepareNativeEscoPermissionFixture>>;
 source:{origin:Row;evidence:Row;current:boolean};renderWindow:RenderWindow}){
 const {f,p,source}=input,basis=source.origin.basis as ServicePermissionOriginBasis
 const capture=()=>sql<{message:Row;assignment:Row;intent:Row;permission:Row;customer:Row;current:boolean;senders:Row[];receivers:Row[]}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'message',to_jsonb(m),'assignment',to_jsonb(a),'intent',to_jsonb(i),'permission',to_jsonb(p),'customer',to_jsonb(c),
  'current',gridex_received_sources.sent_source_is_current_v1(m),
  'senders',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.tenant_actor_identifiers s
   WHERE s.company_id=m.company_id AND s.environment=m.environment AND s.actor_id=${lit(f.ids.legal)}
    AND s.identifier_type='EdielId' AND s.valid_from<=now() AND (s.valid_to IS NULL OR now()<s.valid_to)),
  'receivers',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.platform_actor_identifiers r
   WHERE r.actor_id=${lit(f.ids.dso)} AND lower(r.identifier_type) IN ('edielid','ediel_id') AND r.is_verified
    AND (r.valid_from IS NULL OR r.valid_from<=current_date) AND (r.valid_to IS NULL OR current_date<=r.valid_to)))),'[]')
  FROM public.ediel_messages m JOIN public.ediel_service_assignments a ON a.company_id=m.company_id AND a.id=${lit(f.assignment)}
  JOIN public.ediel_message_intents i ON i.company_id=m.company_id AND i.id=m.intent_id
  JOIN public.metering_permissions p ON p.company_id=m.company_id AND p.id=${lit(p.permissionId)} AND p.source_z13_message_id=m.id
  JOIN public.customers c ON c.company_id=m.company_id AND c.id=${lit(f.ids.customer)}
  WHERE m.company_id=${lit(f.ids.company)} AND m.id=${lit(p.z13.id)} AND m.environment='test'`)
 const before=capture();expect(before).toHaveLength(1);const {message,assignment,intent,permission,customer,current,senders,receivers}=before[0]
 expect(message).toEqual(p.z13);expect(current).toBe(true);expect(source.current).toBe(true)
 expect(message.immutable_payload_hash).toBe(createHash('sha256').update(p.z13.raw_payload!).digest('hex'))
 expect(basis).toEqual(p.z13.parsed_payload?.sourcePermissionBasis);expect(basis.customer).toEqual(customer)
 expect(basis).toMatchObject({mode:f.mode,providerActorId:f.ids.legal,dsoActorId:f.ids.dso,customerId:f.ids.customer})
 expect(assignment.mode).toBe(f.mode);expect(basis.objects).toHaveLength(1)
 const object=basis.objects[0];expect(object.point).toBeNull();expect(object.reportStart).toBeTruthy()
 expect(assignment.product_ids).toEqual([object.product]);expect(f.fields.product_ids).toEqual([object.product])
 expect(Date.parse(String(assignment.data_start))).toBe(Date.parse(object.reportStart!))
 expect(Date.parse(f.fields.data_start)).toBe(Date.parse(object.reportStart!))
 if(object.reportEnd==null){expect(assignment.data_end).toBeNull();expect(f.fields.data_end).toBeNull();expect(basis.reportingTerm).toBe('indefinite')}
 else{
  expect(Date.parse(String(assignment.data_end))).toBe(Date.parse(object.reportEnd))
  expect(Date.parse(f.fields.data_end!)).toBe(Date.parse(object.reportEnd));expect(basis.reportingTerm).toBe('bounded')
 }
 expect(basis.customerClassification).toBe('private');expect(source.evidence.permission_customer_classification).toBe('private')
 expect(source.evidence.permission_reporting_term_kind).toBe(basis.reportingTerm)
 expect(source.evidence.permission_reporting_frequency).toBe(basis.frequency)
 expect(source.evidence.permission_purpose_code).toBe(basis.purposeCode)
 expect(source.evidence.permission_requested_method).toBe(basis.requestedMethod)
 expect(source.evidence.permission_agreement_reference).toBe(basis.agreementReference)
 expect(senders).toHaveLength(1);expect(receivers).toHaveLength(1)
 expect(senders[0].identifier_value).toBe(basis.legalSenderId);expect(receivers[0].identifier_value).toBe(basis.legalReceiverId)
 expect(intent).toMatchObject({id:p.z13.intent_id,company_id:f.ids.company,environment:'test',message_code:'Z13',application_reference:'23-DGI-PRODAT',
  sender_ediel_id:message.sender_ediel_id,receiver_ediel_id:message.receiver_ediel_id,customer_id:f.ids.customer,
  route_profile_id:message.route_profile_id,communication_route_id:message.communication_route_id})
 const payload=intent.payload as Row
 expect(payload.externalReference).toBe(message.external_reference);expect(intent.interchange_reference).toBe(message.interchange_reference)
 expect(message.external_reference).toBe(message.interchange_reference);expect(intent.transaction_reference).toBe(message.transaction_reference)
 expect(permission.rff_li_reference).toBe(intent.transaction_reference);expect(p.li).toBe(intent.transaction_reference);expect(basis.li).toBeNull()
 const org=sourceText(customer.org_number),personal=sourceText(customer.personal_number)
 expect(Boolean(org)!==Boolean(personal)).toBe(true)
 const name=sourceText(customer.company_name)??sourceText(customer.full_name)??[sourceText(customer.first_name),sourceText(customer.last_name)].filter(Boolean).join(' ')
 const country=sourceText(customer.country)??sourceText(customer.country_code)??sourceText(customer.billing_country)
 expect(name).toBeTruthy();expect(country).toBe('SE')
 qualifyEscoSentZ13Fields(p.z13.raw_payload!,{mode:f.mode,external:String(payload.externalReference),messageReference:String(intent.message_reference),
  li:String(intent.transaction_reference),sender:String(message.sender_ediel_id),receiver:String(message.receiver_ediel_id),
  legalSender:basis.legalSenderId,legalReceiver:basis.legalReceiverId,customerId:(org??personal)!,customerQualifier:org?'SE1':'SE2',
  customerName:name,country:country!,reportStart:object.reportStart!,reportEnd:object.reportEnd??null,reportingTerm:basis.reportingTerm!,
  method:basis.requestedMethod!,frequency:basis.frequency!,product:object.product,purpose:basis.purposeCode!,agreement:basis.agreementReference!},input.renderWindow)
 expect(capture()).toEqual(before)
}
