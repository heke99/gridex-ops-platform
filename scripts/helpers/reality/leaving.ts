// Reality scenario H ("the customer leaves"): switch requests made the way the platform makes them, the grid
// owner's reprocessing step for held UTILTS, and read-only observations of supply, billing and access.
// Synthetic data only (E2E-, example.invalid). Never writes market state the grid owner would send.
import { supabaseService } from '@/lib/supabase/service'
import { calculateEarliestSwitchStartDate } from '@/lib/operations/switchStartDate'
import { evaluateSupplierSwitchSendWindow, loadSupplierSwitchPolicy } from '@/lib/operations/supplierSwitchScheduler'
import { LIVE, approveIssuerHistoryGround, literal, sql, type AugustFacility, type LiveTenant } from '../live-chain-fixture'
import { operatorSession, submitServerAction } from './operatorConsole'

type Row = Record<string, unknown>
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A switch request exactly as createSupplierSwitchRequest writes it (gridex_create_supplier_switch_v1 with its
 * "created" event), on the signed contract's start_supplier_switch path, evaluated on `createdAt`. Same
 * construction as scenario F's August switches (chain-f-invoice.test.ts createAugustSwitch).
 */
export async function createSignedContractSwitch(tenant: LiveTenant, input: { customerId: string; facility: AugustFacility; supplyStart: string; createdAt: string }) {
  const now = new Date(input.createdAt), policy = loadSupplierSwitchPolicy({ subtype: 'L' })
  const startDateCalculation = calculateEarliestSwitchStartDate({ requestType: 'switch', requestedStartDate: input.supplyStart, noticePeriod: null, contractEndDate: null,
    earliestSupplierStartDate: null, moveInDate: null, marketLeadDays: policy.marketLeadDays, today: now })
  const window = evaluateSupplierSwitchSendWindow({ requestedStartDate: startDateCalculation.effectiveStartDate, policy, now })
  const supplier = sql<{ name: string; org: string | null }>(`SELECT jsonb_build_object('name',coalesce(legal_name,name),'org',org_number) FROM public.companies WHERE id=${literal(tenant.companyId)}`)
  const site = sql<Row>(`SELECT jsonb_build_object('gridOwner',grid_owner_id) FROM public.customer_sites WHERE id=${literal(input.facility.siteId)}`)
  const f = input.facility
  const request = { customer_id: input.customerId, contract_id: f.contractId, customer_contract_id: f.contractId, site_id: f.siteId, customer_site_id: f.siteId,
    metering_point_id: f.meteringPointId, power_of_attorney_id: f.powerOfAttorneyId, authorization_document_id: f.authorizationDocumentId,
    request_type: 'switch', status: 'queued', requested_start_date: startDateCalculation.effectiveStartDate, current_supplier_unknown: true,
    incoming_supplier_name: supplier.name, incoming_supplier_org_number: supplier.org, grid_owner_id: site.gridOwner, price_area_code: 'SE3',
    validation_snapshot: { isReady: true, issues: [], candidateMeteringPointId: f.meteringPointId, latestPowerOfAttorneyId: f.powerOfAttorneyId,
      ownSupplierResolution: 'company_record', currentSupplier: { id: null, name: null, orgNumber: null, edielId: null, unknown: true, contractStatus: null, contractEndDate: null,
        noticePeriod: null, terminationFee: null, responseStatus: null }, manualSupplierTerms: null, startDateCalculation, businessBlockers: [] },
    lifecycle_blocked: false, lifecycle_block_source: null, automation_origin: 'customer_operation_job',
    automation_key: `customer-operation:${input.customerId}:${f.siteId}:${f.meteringPointId}`,
    metadata: { supplier_switch_blockers: [], pending_review_reason: null, reality_h_establishment: { createdAt: input.createdAt, sendWindow: window } },
    created_by: LIVE.automationUserId, updated_by: LIVE.automationUserId, created_at: input.createdAt, updated_at: input.createdAt }
  const created = await supabaseService.rpc('gridex_create_supplier_switch_v1', { p_company_id: tenant.companyId, p_request: request,
    p_event: { event_type: 'created', event_status: 'success', message: 'Switchärende skapat och köat för vidare handläggning.', created_by: LIVE.automationUserId,
      payload: { requestType: 'switch', requestedStartDate: input.supplyStart, incomingSupplierName: supplier.name, incomingSupplierOrgNumber: supplier.org, ownSupplierResolution: 'company_record', businessBlockers: [] } } })
  if (created.error) throw Error(`switch_create_failed:${f.gsrn}:${JSON.stringify(created.error)}`)
  const row = (created.data as { request: { id: string; requested_start_date: string }; existing: boolean })
  return { facility: f.gsrn, switchId: row.request.id, existing: row.existing, start: row.request.requested_start_date, startDateCalculation, window }
}

/** Per facility: the latest switch, its Z03/Z04 and every supply period with its market bounds. */
export function supplyState(companyId: string, gsrns: string[]) {
  return sql<Array<{ facility: string; customer: string; switchId: string | null; switch: string | null; z04: string | null; periods: Row[] }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'facility',mp.metering_point_id,'customer',mp.customer_id,'switchId',s.id,'switch',s.status,'z04',s.inbound_z04_message_id,
      'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'customer',p.customer_id,'status',p.status,'start',p.start_date,'end',p.end_date,'actualEnd',p.actual_end_date,
        'marketStart',p.market_start_at,'marketEnd',p.market_end_at,'endSource',p.source_end_message_id,'contract',coalesce(p.customer_contract_id,p.contract_id)) ORDER BY p.start_date),'[]')
        FROM public.customer_supply_periods p WHERE p.company_id=mp.company_id AND p.metering_point_id=mp.id)) ORDER BY mp.created_at),'[]')
    FROM public.metering_points mp
    LEFT JOIN LATERAL (SELECT * FROM public.supplier_switch_requests x WHERE x.company_id=mp.company_id AND x.metering_point_id=mp.id ORDER BY x.created_at DESC LIMIT 1) s ON true
    WHERE mp.company_id=${literal(companyId)} AND mp.metering_point_id=ANY(${literal(`{${gsrns.join(',')}}`)}::text[])`)
}

/** Contract, customer and the follow-up tasks/cases a supply end leaves for one customer. */
export function leavingFollowup(companyId: string, customerId: string) {
  return sql<Row>(`SELECT jsonb_build_object(
    'customer',(SELECT jsonb_build_object('status',status,'reason',lifecycle_status_reason,'movedOut',moved_out_at) FROM public.customers WHERE id=${literal(customerId)}),
    'contracts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'reason',termination_reason,'endedAt',ended_at,'startsAt',starts_at,'binding',binding_months)),'[]') FROM public.customer_contracts WHERE company_id=${literal(companyId)} AND customer_id=${literal(customerId)}),
    'tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',task_type,'status',status,'description',description,'metadata',metadata) ORDER BY task_type),'[]') FROM public.customer_operation_tasks WHERE company_id=${literal(companyId)} AND customer_id=${literal(customerId)}),
    'cases',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',case_type,'reason',reason_category,'status',status,'source',source)),'[]') FROM public.customer_cases WHERE company_id=${literal(companyId)} AND customer_id=${literal(customerId)}),
    'emails',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',email_type,'status',status,'to',to_email)),'[]') FROM public.tenant_email_outbox WHERE company_id=${literal(companyId)} AND customer_id=${literal(customerId)}))`)
}

/** The inbound PRODAT/UTILTS sources of the tenant (newest last). */
export function inboundSources(companyId: string, codes: string[]) {
  return sql<Array<{ id: string; code: string; status: string; reference: string; meter: string | null; createdAt: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'code',message_code,
      'status',status,'reference',coalesce(external_reference,interchange_reference,''),'meter',metering_point_id,'createdAt',created_at) ORDER BY created_at),'[]')
    FROM public.ediel_messages WHERE company_id=${literal(companyId)} AND direction='inbound' AND message_code=ANY(${literal(`{${codes.join(',')}}`)}::text[])`)
}
export function sourceDiagnosis(id: string) {
  return sql<Row>(`SELECT jsonb_build_object('status',m.status,'code',m.message_code,
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome,'status',a.status)),'[]') FROM public.ediel_messages a WHERE a.related_message_id=m.id AND a.direction='outbound'),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',e.message,'reason',e.payload->>'reason') ORDER BY e.created_at DESC),'[]') FROM (SELECT * FROM public.ediel_message_events WHERE ediel_message_id=m.id ORDER BY created_at DESC LIMIT 6) e))
    FROM public.ediel_messages m WHERE m.id=${literal(id)}`)
}

/**
 * Held UTILTS are released by Gridex staff per message after issuer evidence (scenario F step F6c): the
 * SYNTHETIC stand-in for EXT-ISSUER-01, then the real "Kör UTILTS engine" / "Återuppta" server action.
 */
export async function reprocessHeldUtilts(tenant: LiveTenant, sourceIds: string[]) {
  for (const id of sourceIds) approveIssuerHistoryGround(id, tenant.adminUserId)
  const staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
  const page = await staff.newPage()
  const outcomes: Array<{ source: string; button: boolean; actionStatus: number | null; stored: number }> = []
  const storedFor = (id: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(id)}`)
  for (const id of sourceIds) {
    await page.goto(`/admin/ediel/messages/${id}`)
    await page.getByText('Detaljvy för canonical kernel').first().waitFor({ timeout: 180_000 })
    const button = page.getByRole('button', { name: /Kör UTILTS engine \/ skapa TGT-svar|Återuppta hållna transaktioner/ })
    const visible = await button.count()
    const actionStatus = visible ? await submitServerAction(page, () => button.first().click(), 600_000) : null
    const started = Date.now()
    while (visible && storedFor(id) < 96 && Date.now() - started < 60_000) await pause(3_000)
    outcomes.push({ source: id, button: Boolean(visible), actionStatus, stored: storedFor(id) })
  }
  await page.close()
  return outcomes
}

/** Every stored value of one metering point with its billing gate decision. */
export function gatedValues(meteringPointId: string) {
  return sql<Row>(`WITH v AS (SELECT *,(period_start AT TIME ZONE 'Europe/Stockholm')::date d FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND revision_status='current')
    SELECT jsonb_build_object('days',(SELECT coalesce(jsonb_object_agg(d,x),'{}') FROM (SELECT d,jsonb_build_object('values',count(*),'customers',jsonb_agg(DISTINCT customer_id),
        'gate',jsonb_agg(DISTINCT billing_gate_status),'period',jsonb_agg(DISTINCT supply_period_id),
        'reasons',(SELECT coalesce(jsonb_agg(DISTINCT r->>'code'),'[]') FROM v v2, jsonb_array_elements(coalesce(v2.billing_gate_reasons,'[]')) r WHERE v2.d=v.d)) x FROM v GROUP BY d) days))`)
}

/** What the monthly billing cron produced for one tenant and month. */
export function billingMonth(companyId: string, year: number, month: number) {
  const company = literal(companyId)
  return sql<{ underlays: Row[]; invoices: Row[] }>(`SELECT jsonb_build_object(
    'underlays',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'facility',mp.metering_point_id,'customer',u.customer_id,'supplyPeriod',u.supply_period_id,'status',u.status,
        'readiness',u.readiness_status,'block',u.billing_block_reason,'start',u.billing_period_start,'end',u.billing_period_end,'kwh',u.total_kwh,'missing',u.missing_values_count) ORDER BY mp.metering_point_id),'[]')
      FROM public.billing_underlays u LEFT JOIN public.metering_points mp ON mp.id=u.metering_point_id WHERE u.company_id=${company} AND u.underlay_year=${year} AND u.underlay_month=${month}),
    'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'customer',i.customer_id,'status',i.status,'start',i.period_start,'end',i.period_end,'incVat',i.amount_inc_vat) ORDER BY i.created_at),'[]')
      FROM public.customer_invoices i WHERE i.company_id=${company} AND i.period_start<make_date(${year},${month},1)+interval '1 month' AND coalesce(i.period_end,i.period_start)>=make_date(${year},${month},1)))`)
}

/** The Z13 history requests and other outbound PRODAT the tenant created for one metering point. */
export function outboundFor(companyId: string, meteringPointId: string) {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('code',message_code,'status',status,'createdAt',created_at) ORDER BY created_at),'[]')
    FROM public.ediel_messages WHERE company_id=${literal(companyId)} AND direction='outbound' AND message_family='PRODAT' AND metering_point_id=${literal(meteringPointId)}`)
}
