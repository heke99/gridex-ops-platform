// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Prospective public source refusal; no hooks, tests or manufactured authority.
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {reviewNativeEscoAssignmentEvidence as review,seedNativeEscoFixture,
 nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from '../fixtures/ediel-service-evidence-native'

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
  expect(archive.normalized).toMatchObject(terms(archive.artifact.evidence_kind))
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
