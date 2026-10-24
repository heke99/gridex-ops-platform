// World helpers for reality scenario J2 (inbound UTILTS): the August switch on the platform's own path (as in
// scenarios F and G), reception on Vercel's cron cadence, Gridex staff's per-message UTILTS reprocessing in the
// real operator view (FINDINGS O2: no job re-evaluates held UTILTS) and read-only views of what was stored.
// Nothing here inserts metering values, market state or gates. Synthetic data only.
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import { calculateEarliestSwitchStartDate } from '@/lib/operations/switchStartDate'
import { evaluateSupplierSwitchSendWindow, loadSupplierSwitchPolicy } from '@/lib/operations/supplierSwitchScheduler'
import { LIVE, approveIssuerHistoryGround, gridOwnerSends, literal, sql, type AugustFacility, type LiveTenant } from '../live-chain-fixture'
import { operatorSession, submitServerAction } from './operatorConsole'
import { pollInboundMailLanes, runSlotAfterInbound } from './world'
import { cronTick } from './clock'
import type { UtiltsFile } from './inboundUtilts'

type Row = Record<string, unknown>
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The switch request exactly as the platform's own creation writes it (createSupplierSwitchRequest through
 * gridex_create_supplier_switch_v1), evaluated on the given creation day, then the Z03 from the real builder.
 * Like scenarios F and G, the send-window scheduler is the one check not run ("now is August").
 */
export async function establishSwitch(tenant: LiveTenant, input: { customerId: string; facility: AugustFacility; supplyStart: string; createdAt: string }) {
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
    metadata: { supplier_switch_blockers: [], pending_review_reason: null, reality_august_establishment: { createdAt: input.createdAt, sendWindow: window } },
    created_by: LIVE.automationUserId, updated_by: LIVE.automationUserId, created_at: input.createdAt, updated_at: input.createdAt }
  const created = await supabaseService.rpc('gridex_create_supplier_switch_v1', { p_company_id: tenant.companyId, p_request: request,
    p_event: { event_type: 'created', event_status: 'success', message: 'Switchärende skapat och köat för vidare handläggning.', created_by: LIVE.automationUserId,
      payload: { requestType: 'switch', requestedStartDate: input.supplyStart, incomingSupplierName: supplier.name, incomingSupplierOrgNumber: supplier.org, ownSupplierResolution: 'company_record', businessBlockers: [] } } })
  if (created.error) throw Error(`switch_create_failed:${f.gsrn}:${JSON.stringify(created.error)}`)
  const switchId = (created.data as { request: { id: string } }).request.id
  let built: Row
  try {
    await deriveRequestedMethodBeforeSwitch({ companyId: tenant.companyId, actorUserId: LIVE.automationUserId, switchRequestId: switchId })
    const message = await prepareAndQueueEdielZ03({ actorUserId: LIVE.automationUserId, switchRequestId: switchId, environment: 'production' })
    built = { ok: true, message: message.id, status: message.status }
  } catch (error) { built = { ok: false, error: error instanceof Error ? error.message : String(error) } }
  const z03 = sql<{ start: string | null } | null>(`SELECT to_jsonb(x) FROM (SELECT substring(m.raw_payload from 'DTM\\+92:(\\d{8})') start FROM public.ediel_messages m
    WHERE m.company_id=${literal(tenant.companyId)} AND m.switch_request_id=${literal(switchId)} AND m.message_code LIKE 'Z03%' ORDER BY m.created_at DESC LIMIT 1) x`)
  return { gsrn: f.gsrn, switchId, startDateCalculation, window, built, z03Start: z03?.start ?? null }
}

/** The grid owner mails one UTILTS file over SMTPS from its own mailbox, like its daily metering run. */
export async function gridOwnerMails(from: string, kind: 'UTILTS-E66' | 'UTILTS-E31', file: UtiltsFile) {
  await gridOwnerSends({ from, subject: `${kind} ${file.reference}`, filename: `${kind}_${file.reference}.edi`, edifact: file.edifact })
}

export type InboundUtilts = { id: string; reference: string; status: string; code: string; meter: string | null }
/** Every inbound UTILTS message of the tenant, oldest first. */
export const inboundUtilts = (companyId: string) => sql<InboundUtilts[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,
    'reference',coalesce(external_reference,interchange_reference,''),'status',status,'code',message_code,'meter',metering_point_id) ORDER BY created_at),'[]')
  FROM public.ediel_messages WHERE company_id=${literal(companyId)} AND direction='inbound' AND message_family='UTILTS'`)

/** Like Vercel: the inbound mail cron (production lane, plus the test lane), then the Ediel outbox (which sends our CONTRL), once a minute. */
export async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: Row[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const inbound = await pollInboundMailLanes()
    const outbox = await runSlotAfterInbound()
    runs.push({ at: new Date().toISOString(), inbound: inbound.production.status, inboundTest: inbound.test.status, outbox: outbox.status })
    if (inbound.status !== 200) throw Error(`inbound_cron_failed:${inbound.status}:${JSON.stringify(inbound.body).slice(0, 500)}`)
    if (done() || Date.now() > deadline) break
    await cronTick()
  }
  return runs
}

export type ReprocessOutcome = { source: string; reference: string; button: boolean; label: string | null; actionStatus: number | null; stored: number; expected: number
  ms: number; diagnosis?: unknown }

/** What the engine and the database decided for one source (status, issues, per-transaction outcome, last events). */
export const sourceDiagnosis = (id: string) => sql<Row>(`SELECT jsonb_build_object('status',m.status,
    'issues',(SELECT coalesce(jsonb_agg(i->>'code'),'[]') FROM jsonb_array_elements(coalesce(m.validation_report#>'{utiltsRuntime,validation,issues}','[]')) i),
    'transactions',(SELECT coalesce(jsonb_agg(jsonb_build_object('disposition',t.disposition,'persistence',t.persistence_status,'final',t.final_response_type,'error',t.persistence_error,'issues',t.issue_codes)),'[]') FROM public.ediel_ack_transaction_results t WHERE t.source_message_id=m.id),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome,'status',a.status)),'[]') FROM public.ediel_messages a WHERE a.related_message_id=m.id),
    'lastEvents',(SELECT coalesce(jsonb_agg(e.message ORDER BY e.created_at DESC),'[]') FROM (SELECT message,created_at FROM public.ediel_message_events WHERE ediel_message_id=m.id ORDER BY created_at DESC LIMIT 4) e))
  FROM public.ediel_messages m WHERE m.id=${literal(id)}`)

/**
 * Issuer evidence for each source (SYNTHETIC stand-in for EXT-ISSUER-01, as scenarios E, F and G), then Gridex
 * staff run the UTILTS engine per message on /admin/ediel/messages/[id] and wait for the action's answer.
 * `expected(source)` is how many normalized values the source should leave behind.
 */
export async function reprocessAsOperator(tenant: LiveTenant, sources: InboundUtilts[], expected: (source: InboundUtilts) => number,
  progress?: (outcomes: ReprocessOutcome[]) => void): Promise<ReprocessOutcome[]> {
  for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
  const staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
  const page = await staff.newPage()
  const storedFor = (id: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(id)}`)
  const outcomes: ReprocessOutcome[] = []
  try {
    for (const source of sources) {
      const started = Date.now(), want = expected(source)
      await page.goto(`/admin/ediel/messages/${source.id}`)
      await page.getByText('Detaljvy för canonical kernel').first().waitFor({ timeout: 180_000 })
      const button = page.getByRole('button', { name: /Kör UTILTS engine \/ skapa TGT-svar|Återuppta hållna transaktioner/ })
      const visible = await button.count()
      const label = visible ? (await button.first().innerText()).trim() : null
      const actionStatus = visible ? await submitServerAction(page, () => button.first().click(), 600_000) : null
      let stored = storedFor(source.id)
      while (visible && stored < want && Date.now() - started < 120_000) { await pause(3_000); stored = storedFor(source.id) }
      const outcome: ReprocessOutcome = { source: source.id, reference: source.reference, button: Boolean(visible), label, actionStatus, stored, expected: want, ms: Date.now() - started }
      if (stored !== want) outcome.diagnosis = sourceDiagnosis(source.id)
      outcomes.push(outcome)
      if (progress && outcomes.length % 10 === 0) progress(outcomes)
    }
  } finally { await page.close() }
  return outcomes
}

type StoredDays = Record<string, { normalized: number; kwh: number; eligible: number; estimated: number; revised: number; metering: number }>
/** Current stored values of one metering point per day of `zone` (by instant), from both series (billing and Mina sidor sources). */
function storedPerZoneDay(companyId: string, meteringPointId: string, zone: 'Europe/Stockholm' | 'Etc/GMT-1') {
  return sql<StoredDays>(`
    WITH n AS (SELECT (period_start AT TIME ZONE ${literal(zone)})::date d,quantity_kwh,billing_gate_status,quality_status,revision_number FROM public.normalized_metering_values
      WHERE company_id=${literal(companyId)} AND metering_point_id=${literal(meteringPointId)} AND revision_status='current'),
     m AS (SELECT (period_start AT TIME ZONE ${literal(zone)})::date d FROM public.metering_values WHERE company_id=${literal(companyId)} AND metering_point_id=${literal(meteringPointId)} AND is_current)
    SELECT coalesce(jsonb_object_agg(d::text,x),'{}') FROM (SELECT n.d,jsonb_build_object('normalized',count(*),'kwh',sum(n.quantity_kwh),
      'eligible',count(*) FILTER (WHERE n.billing_gate_status='eligible'),'estimated',count(*) FILTER (WHERE n.quality_status='56'),
      'revised',count(*) FILTER (WHERE n.revision_number>1),'metering',(SELECT count(*) FROM m WHERE m.d=n.d)) x FROM n GROUP BY n.d) y`)
}
/** Per Stockholm civil day (portal / partner API view): a civil day sums the overlapping Ediel files by instant. */
export const storedPerDay = (companyId: string, meteringPointId: string) => storedPerZoneDay(companyId, meteringPointId, 'Europe/Stockholm')
/**
 * Per Ediel day (00:00–24:00 +0100; PostgreSQL 'Etc/GMT-1' is UTC+1): exactly what one grid-owner E66 file covers
 * (ENV-08, T15), so a day's count and kWh compare 1:1 with the file that was sent.
 */
export const storedPerEdielDay = (companyId: string, meteringPointId: string) => storedPerZoneDay(companyId, meteringPointId, 'Etc/GMT-1')

/** Every current value of one metering point in one Ediel day (00:00–24:00 +0100), in time order (kWh as text, revision, quality, gate). */
export function storedDay(companyId: string, meteringPointId: string, day: string) {
  return sql<Array<{ start: string; kwh: string; revision: number; quality: string | null; gate: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'start',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'kwh',quantity_kwh::text,'revision',revision_number,'quality',quality_status,'gate',billing_gate_status) ORDER BY period_start),'[]')
    FROM public.normalized_metering_values WHERE company_id=${literal(companyId)} AND metering_point_id=${literal(meteringPointId)} AND revision_status='current'
     AND (period_start AT TIME ZONE 'Etc/GMT-1')::date=${literal(day)}::date`)
}

/** Underlays, invoices and export items of the tenant for one month, keyed so that a re-run can be compared exactly. */
export function billingState(companyId: string, year: number, month: number) {
  return sql<{ underlays: Row[]; invoices: Row[]; exportItems: Row[]; runs: Row[] }>(`SELECT jsonb_build_object(
    'underlays',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'facility',mp.metering_point_id,'status',u.status,'readiness',u.readiness_status,'kwh',u.total_kwh::text,'values',u.source_meter_value_count,
        'missing',u.missing_values_count,'block',u.billing_block_reason,'direction',u.energy_direction,'start',u.billing_period_start,'end',u.billing_period_end,'updated',u.updated_at) ORDER BY mp.metering_point_id,u.energy_direction),'[]')
      FROM public.billing_underlays u LEFT JOIN public.metering_points mp ON mp.id=u.metering_point_id WHERE u.company_id=${literal(companyId)} AND u.underlay_year=${year} AND u.underlay_month=${month}),
    'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'customer',i.customer_id,'status',i.status,'kwh',i.total_kwh::text,'exVat',i.amount_ex_vat::text,'incVat',i.amount_inc_vat::text,
        'underlay',coalesce(i.billing_underlay_id,(SELECT e.billing_underlay_id FROM public.invoice_export_items e WHERE e.id=i.invoice_export_item_id)),
        'calculation',i.calculation_snapshot_sha256,'updated',i.updated_at) ORDER BY i.created_at),'[]') FROM public.customer_invoices i WHERE i.company_id=${literal(companyId)}),
    'exportItems',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'underlay',e.billing_underlay_id,'status',e.status,'incVat',e.amount_inc_vat::text) ORDER BY e.created_at),'[]')
      FROM public.invoice_export_items e WHERE e.company_id=${literal(companyId)}),
    'runs',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',r.status,'failure',r.failure_reason,'blocked',r.total_blocked,'prepared',r.total_exported,'at',r.started_at) ORDER BY r.started_at),'[]')
      FROM public.billing_automation_runs r WHERE r.company_id=${literal(companyId)} AND r.billing_year=${year} AND r.billing_month=${month}))`)
}
