// T4 source chain: builds, through the platform's own paths, everything billing needs before the underlay engine and invoice
// preparation can run - a live supplier (test lane), a customer on a published FIXED-price offer, a supply period from the
// grid owner's Z04, and daily UTILTS E66 files stored as qualified metering values.
//
// Adapted from claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426, scripts/reality/chain-f-invoice.test.ts
// (F1 go-live, F3 August customer + dated switch request + Z03, F4 world cadence until the Z04 activates supply, F5 grid owner
// E66, F6 reception, F6c issuer evidence + UTILTS engine). Differences from the reference are listed in the README ("Source
// chain": TEST lane instead of production go-live, one customer/facility, three months, fixed-price offer, UTILTS engine
// triggered through the real admin server action posted as a form instead of Playwright).
//
// Output: SIM_HOME/chain.json (written step by step). Each step fails with the product's own error text; a step that only
// works with an app change stops the chain and is reported as a candidate finding in chain.json -> blockers.
//
// SUBSTITUTIONS (stand-ins for things without a product entrypoint here):
//  * company/operator/admin users/offer/legal profile/Ediel identity/routes/grid owner: configureTenant (SQL + product RPCs)
//  * customer, site, metering point, contract row: augustSupplyCustomer (SQL for customer/site/meter/contract draft; signing
//    through the product's signature RPCs with the clock at the August/June instant; power of attorney through the admin writer)
//  * switch request: gridex_create_supplier_switch_v1 as the product writes it, evaluated on the dated creation day
//    (today is after the supply start, so "now" cannot be real; the Z03 builder and everything after it is the real code)
//  * Z03 queued with prepareAndQueueEdielZ03 in-process (no HTTP entrypoint found for a dated switch)
//  * issuer history ground: seedUtiltsIssuerHistoryGround (SYNTHETIC stand-in for EXT-ISSUER-01/EXT-ARCHIVE-02)
import { chmodSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { calculateEarliestSwitchStartDate } from '@/lib/operations/switchStartDate'
import { evaluateSupplierSwitchSendWindow, loadSupplierSwitchPolicy } from '@/lib/operations/supplierSwitchScheduler'
import {
  LIVE, approveIssuerHistoryGround, augustSupplyCustomer, configurePlatformMailbox, configureTenant, dayProfile, gs1, literal, publishFixedPriceOffer, sql,
  type AugustFacility, type LiveOffer, type LiveTenant,
} from './vendor/scripts/helpers/live-chain-fixture'
import { signIn } from '../runner/lib/session.mjs'
import { pause, slot, startGridOwner, TICK_MS, SIM_HOME, type GridOwnerSim } from './world'
import { archiveContractOriginal, createSourceActor, loadSignedAgreementPdf } from './contractSources'

const CHAIN_JSON = `${SIM_HOME}/chain.json`
const state: Record<string, unknown> = { startedAt: new Date().toISOString(), steps: {}, blockers: [] }
const save = () => { writeFileSync(CHAIN_JSON, JSON.stringify(state, null, 2)); try { chmodSync(CHAIN_JSON, 0o600) } catch { /* best effort */ } }
const step = (id: string, value: unknown) => { (state.steps as Record<string, unknown>)[id] = value; save() }
const blocker = (id: string, text: string) => { (state.blockers as unknown[]).push({ id, text }); save() }

/** Fixed commercial terms of the offer (publishFixedPriceOffer takes whole öre). Independent oracle input for the harness. */
const TERMS = { fixedOrePerKwh: 85, monthlyFeeSek: 49, vat: 0.25, binding: { bindingMonths: 0, noticeMonths: 1, renewalMonths: 12 } }
/** Supply starts 1 July: three complete months (July, August, September) are billable; each gets its own underlay and prepare. */
const SUPPLY_START = '2026-07-01'
const SIGNED_AT = '2026-06-12T09:30:00+02:00'
const SWITCH_CREATED_AT = '2026-06-12T09:31:00+02:00'
const GRID_AREA = 'ALS'
const MONTHS = { concurrentApprove: '2026-07', concurrentPrepare: '2026-08', main: '2026-09' } as const
const MIN_PER_STEP = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 60_000

/** Ediel days (00:00-24:00 +0100) of the three months, in order. */
const days = (): string[] => {
  const out: string[] = []
  for (const [y, m] of [[2026, 7], [2026, 8], [2026, 9]]) {
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
    for (let d = 1; d <= n; d += 1) out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return out
}
const DAYS = days()
const sum3 = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000

let tenant: LiveTenant
let offer: LiveOffer
let gridOwner: GridOwnerSim
let facility: AugustFacility
let customerId = ''
let gsrn = ''
let supplyPeriodId = ''
const sentFiles: Array<{ day: string; reference: string; values: number[] }> = []

/** Port of createAugustSwitch (chain-f-invoice.test.ts) with the dated evaluation; the request row is written as the product writes it. */
async function createDatedSwitch() {
  const now = new Date(SWITCH_CREATED_AT), policy = loadSupplierSwitchPolicy({ subtype: 'L' })
  const calc = calculateEarliestSwitchStartDate({ requestType: 'switch', requestedStartDate: SUPPLY_START, noticePeriod: null, contractEndDate: null,
    earliestSupplierStartDate: null, moveInDate: null, marketLeadDays: policy.marketLeadDays, today: now })
  const window = evaluateSupplierSwitchSendWindow({ requestedStartDate: calc.effectiveStartDate, policy, now })
  const supplier = sql<{ name: string; org: string | null }>(`SELECT jsonb_build_object('name',coalesce(legal_name,name),'org',org_number) FROM public.companies WHERE id=${literal(tenant.companyId)}`)
  const request = { customer_id: customerId, contract_id: facility.contractId, customer_contract_id: facility.contractId, site_id: facility.siteId, customer_site_id: facility.siteId,
    metering_point_id: facility.meteringPointId, power_of_attorney_id: facility.powerOfAttorneyId, authorization_document_id: facility.authorizationDocumentId,
    request_type: 'switch', status: 'queued', requested_start_date: calc.effectiveStartDate, current_supplier_unknown: true,
    incoming_supplier_name: supplier.name, incoming_supplier_org_number: supplier.org, grid_owner_id: tenant.gridOwnerId, price_area_code: 'SE3',
    validation_snapshot: { isReady: true, issues: [], candidateMeteringPointId: facility.meteringPointId, latestPowerOfAttorneyId: facility.powerOfAttorneyId,
      ownSupplierResolution: 'company_record', currentSupplier: { id: null, name: null, orgNumber: null, edielId: null, unknown: true, contractStatus: null, contractEndDate: null,
        noticePeriod: null, terminationFee: null, responseStatus: null }, manualSupplierTerms: null, startDateCalculation: calc, businessBlockers: [] },
    lifecycle_blocked: false, lifecycle_block_source: null, automation_origin: 'customer_operation_job',
    automation_key: `customer-operation:${customerId}:${facility.siteId}:${facility.meteringPointId}`,
    metadata: { supplier_switch_blockers: [], pending_review_reason: null, t4_dated_establishment: { createdAt: SWITCH_CREATED_AT, sendWindow: window } },
    created_by: LIVE.automationUserId, updated_by: LIVE.automationUserId, created_at: SWITCH_CREATED_AT, updated_at: SWITCH_CREATED_AT }
  const created = await supabaseService.rpc('gridex_create_supplier_switch_v1', { p_company_id: tenant.companyId, p_request: request,
    p_event: { event_type: 'created', event_status: 'success', message: 'Switchärende skapat och köat för vidare handläggning.', created_by: LIVE.automationUserId,
      payload: { requestType: 'switch', requestedStartDate: SUPPLY_START, incomingSupplierName: supplier.name, incomingSupplierOrgNumber: supplier.org, ownSupplierResolution: 'company_record', businessBlockers: [] } } })
  if (created.error) throw Error(`switch_create_failed:${JSON.stringify(created.error)}`)
  const row = created.data as { request: { id: string; requested_start_date: string }; existing: boolean }
  return { switchId: row.request.id, start: row.request.requested_start_date, calc, window, existing: row.existing }
}

/** Server-action form post, as a no-JS browser submits it (same technique as fixtures/flows.mjs). */
async function operatorSession() {
  return signIn({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, email: tenant.operatorEmail, password: tenant.operatorPassword, companyId: tenant.companyId })
}

describe.sequential('T4 source chain', () => {
  it('C0 environment: local stack, mailbox profile, automation user', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId, 'CRON_SECRET and GRIDEX_AUTOMATION_USER_ID from SIM_HOME/env').toBeTruthy()
    expect(configurePlatformMailbox(), 'shared test Ediel mailbox row updated').toBe(1)
    const health = await fetch(`${LIVE.appUrl}/login`)
    expect(health.status).toBe(200)
    step('C0', { appUrl: LIVE.appUrl, smtps: LIVE.smtpsPort, imaps: LIVE.imapsPort })
  })

  it('C1 supplier goes live in the test lane with a published fixed-price offer', async () => {
    tenant = await configureTenant(supabaseService as never, { terms: TERMS.binding })
    offer = await publishFixedPriceOffer(tenant, { fixedOrePerKwh: TERMS.fixedOrePerKwh, terms: TERMS.binding })
    // Test-lane Ediel configuration that configureTenant (production-oriented routes) does not create: tenant BRP valid on the supply
    // start, and supplier-switch / metering routes to the grid owner in the test environment. SQL substitution.
    sql(`INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name,valid_from,is_active)
       VALUES(${literal(tenant.companyId)},'test','54321','T4 BRP','2026-05-01',true);
     WITH r1 AS (INSERT INTO public.communication_routes(company_id,route_name,route_scope,environment_type,is_active,target_email,grid_owner_id)
       VALUES(${literal(tenant.companyId)},'T4 PRODAT test route','supplier_switch','bilateral_test',true,${literal(tenant.gridOwnerEmail)},${literal(tenant.gridOwnerId)}) RETURNING id),
     p1 AS (INSERT INTO public.ediel_route_profiles(company_id,communication_route_id,route_name,environment,is_enabled,is_active,message_family,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port)
       SELECT ${literal(tenant.companyId)},r1.id,'T4 PRODAT profile','test',true,true,'PRODAT','edifact','edifact',${literal(tenant.supplierEdielId)},${literal(tenant.issuerEdielId)},'23-DDQ-PRODAT',${literal(LIVE.platformMailbox)},${literal(LIVE.mailHost)},${LIVE.smtpsPort} FROM r1 RETURNING id),
     r2 AS (INSERT INTO public.communication_routes(company_id,route_name,route_scope,environment_type,is_active,target_email,grid_owner_id)
       VALUES(${literal(tenant.companyId)},'T4 UTILTS test route','metering_values','bilateral_test',true,${literal(tenant.gridOwnerEmail)},${literal(tenant.gridOwnerId)}) RETURNING id)
     INSERT INTO public.ediel_route_profiles(company_id,communication_route_id,route_name,environment,is_enabled,is_active,message_family,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port)
       SELECT ${literal(tenant.companyId)},r2.id,'T4 UTILTS profile','test',true,true,'UTILTS','edifact','edifact',${literal(tenant.supplierEdielId)},${literal(tenant.issuerEdielId)},'23-DDQ-E66-T',${literal(LIVE.platformMailbox)},${literal(LIVE.mailHost)},${LIVE.smtpsPort} FROM r2;`)
    // The product's own selection of invoice provider is a UI action (Fakturering -> Integrationer); the harness sets it with SQL.
    sql(`UPDATE public.companies SET invoice_export_target_system=${literal(process.env.T4_INVOICE_PROVIDER ?? 'file_export')},billing_provider_environment='test',invoice_export_enabled=true WHERE id=${literal(tenant.companyId)}`)
    state.tenant = { companyId: tenant.companyId, supplierEdielId: tenant.supplierEdielId, issuerEdielId: tenant.issuerEdielId, gridOwnerId: tenant.gridOwnerId,
      operatorEmail: tenant.operatorEmail, adminUserId: tenant.adminUserId, offerId: offer.offerId, publicationVersionId: offer.publicationVersionId }
    step('C1', state.tenant)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.contract_price_options WHERE company_id=${literal(tenant.companyId)} AND contract_type='fixed'`)).toBeGreaterThan(0)
  })

  it('C2 the grid owner as its own process, mailbox claimed on GreenMail', async () => {
    gridOwner = await startGridOwner({ edielId: tenant.issuerEdielId, email: tenant.gridOwnerEmail, pollMs: 5000 })
    await gridOwner.profile({ contrlDelayMs: 2000, aperakDelayMs: 4000, z04DelayMs: 8000, z02DelayMs: 8000 })
    step('C2', { url: gridOwner.url, edielId: gridOwner.edielId })
  })

  it('C3 customer on the fixed-price offer: signed in June, supply from 1 July (no supply period yet)', async () => {
    gsrn = gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
    const result = await augustSupplyCustomer(tenant, { firstName: 'Tora', lastName: 'T4Kund', personalNumber: '198001012384', email: `t4-kund-${randomUUID().slice(0, 8)}@example.invalid`,
      address: { street: 'Testvägen 1', postalCode: '441 30', city: 'Alingsås' }, supplyStart: SUPPLY_START, authorizedAt: SIGNED_AT,
      grid: { gridOwnerId: tenant.gridOwnerId, gridOwnerEdielId: tenant.issuerEdielId, gridAreaCode: GRID_AREA },
      facilities: [{ gsrn, street: 'Testvägen 1', postalCode: '441 30', city: 'Alingsås', annualConsumptionKwh: 6000 }], offer })
    customerId = result.customerId
    facility = result.facilities[0]
    const readiness = () => sql<Array<{ ready: boolean; blockers: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('ready',r.switch_ready,'blockers',r.blockers)),'[]')
      FROM public.customer_contract_lifecycle_readiness_v r WHERE r.company_id=${literal(tenant.companyId)} AND r.customer_contract_id=${literal(facility.contractId)}`)
    const deliveries: unknown[] = []
    for (let attempt = 0; attempt < 3 && !readiness().every((r) => r.ready); attempt += 1) deliveries.push(await processPendingContractConfirmations(50))
    step('C3', { customerId, gsrn, facility, deliveries, readiness: readiness() })
    expect(readiness().filter((r) => !r.ready), 'contract switch-ready (signed PDF archived, power of attorney)').toEqual([])
    const terms = sql<{ fixed: string | null; fee: string | null; type: string }>(`SELECT jsonb_build_object('fixed',fixed_price_ore_per_kwh,'fee',monthly_fee_sek,'type',contract_type) FROM public.customer_contracts WHERE id=${literal(facility.contractId)}`)
    step('C3-contract-terms', terms)
    expect(terms.type).toBe('fixed')
  })

  it('C3b dated customer sources for the Z03: signed-contract masterdata declaration and requested method (local synthetic issuer, two actors)', async () => {
    // Why: the Z03's requested start (2026-07-01) is not the current day, so customer_addresses (registered) cannot qualify it; base
    // requires a signed-contract declaration (see chain/contractSources.ts header). Product RPCs, synthetic issuer.
    const { pdf } = await loadSignedAgreementPdf(tenant.companyId, facility.contractId)
    const request = await createSourceActor(tenant.companyId, 'request'), reviewer = await createSourceActor(tenant.companyId, 'reviewer')
    const customer = sql<{ personal: string; name: string }>(`SELECT jsonb_build_object('personal',personal_number,'name',full_name) FROM public.customers WHERE id=${literal(customerId)}`)
    const base = { companyId: tenant.companyId, contractId: facility.contractId, pdf, request, reviewer }
    const masterdata = await archiveContractOriginal({ ...base, kind: 'masterdata_declaration', claims: {
      customerIdentity: { id: customer.personal, qualifier: 'SE2', agency: '260' },
      endUserMasterdata: { nameParts: [customer.name], streetParts: ['Testvägen 1'], postalCode: '441 30', city: 'Alingsås', country: 'SE' },
      validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' } })
    const method = await archiveContractOriginal({ ...base, kind: 'contract_requested_method', claims: { previousDeclarationId: null, requestedMethod: 'Z04' } })
    step('C3b', { masterdata, method, declarations: sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('environment',environment,'from',valid_from,'to',valid_to)),'[]') FROM gridex_customer_masterdata.signed_declarations WHERE company_id=${literal(tenant.companyId)}`) })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_customer_masterdata.signed_declarations WHERE company_id=${literal(tenant.companyId)} AND customer_id=${literal(customerId)} AND environment='test'`)).toBe(1)
  })

  it('C4 switch request created on the June day, Z03 built by the real builder and queued (test lane)', async () => {
    const created = await createDatedSwitch()
    step('C4-switch', created)
    expect(created.window.windowOpen, `send window open on the creation day: ${JSON.stringify(created.window)}`).toBe(true)
    let queued: { id: string; status?: string }
    try {
      queued = await prepareAndQueueEdielZ03({ actorUserId: LIVE.automationUserId, switchRequestId: created.switchId, environment: 'test' }) as never
    } catch (error) {
      blocker('C4', `Z03 builder refused: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    step('C4', { z03: queued.id, status: queued.status })
  })

  it('C5 the world runs on cron cadence until the grid owner confirmed (Z04) and supply is active from 1 July', async () => {
    const started = Date.now()
    const deadline = started + MIN_PER_STEP('T4_CHAIN_C5_MINUTES', 20)
    // fail-fast limits (minutes): a clearly unmet precondition must not wait for the overall deadline
    const NO_Z03_MIN = Number(process.env.T4_CHAIN_NO_Z03_MINUTES ?? 3), NOT_SENT_MIN = Number(process.env.T4_CHAIN_Z03_NOT_SENT_MINUTES ?? 5), NO_ANSWER_MIN = Number(process.env.T4_CHAIN_NO_ANSWER_MINUTES ?? 6)
    const TERMINAL = ['failed', 'rejected', 'cancelled', 'error', 'blocked', 'undeliverable', 'bounced', 'dead_letter']
    const runs: unknown[] = []
    const supply = () => sql<{ status: string; start: string; marketStart: string | null; z04: string | null; switch: string | null }>(`SELECT jsonb_build_object(
        'status',p.status,'start',p.start_date,'marketStart',p.market_start_at,'z04',s.inbound_z04_message_id,'switch',s.status)
      FROM public.customer_supply_periods p LEFT JOIN public.supplier_switch_requests s ON s.id=p.source_switch_request_id
      WHERE p.company_id=${literal(tenant.companyId)} AND p.metering_point_id=${literal(facility.meteringPointId)} ORDER BY p.created_at DESC LIMIT 1`) ?? null
    const switchState = () => sql<{ status: string; z04: string | null }>(`SELECT jsonb_build_object('status',status,'z04',inbound_z04_message_id) FROM public.supplier_switch_requests WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(facility.meteringPointId)} ORDER BY created_at DESC LIMIT 1`)
    const z03 = () => sql<{ status: string; error: string | null } | null>(`SELECT (SELECT jsonb_build_object('status',status,'error',coalesce(failure_reason,'')) FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='outbound' AND message_code='Z03' ORDER BY created_at DESC LIMIT 1)`)
    const stop = (text: string) => { blocker('C5', text); throw Error(`C5 fail-fast: ${text}`) }
    let sentAt: number | null = null, badInbound = 0
    for (;;) {
      const ran = await slot()
      runs.push({ at: new Date().toISOString(), inbound: ran.inbound.status, outbox: ran.outbox.status, operations: ran.operations?.status })
      badInbound = ran.inbound.status >= 500 ? badInbound + 1 : 0
      const period = supply(), message = z03(), go = await gridOwner.state()
      const elapsed = (Date.now() - started) / 60_000
      step('C5-progress', { elapsedMin: Math.round(elapsed * 10) / 10, runs: runs.slice(-3), period, switch: switchState(), z03: message, gridOwner: { received: go.received.map((r) => `${r.family}${r.code}:${r.handled}`), failures: go.failures } })
      if (period?.status === 'active') break
      if (go.failures.length) stop(`grid owner simulator failures: ${JSON.stringify(go.failures.slice(0, 3))}`)
      if (badInbound >= 3) stop(`inbound mail cron answered 5xx three times (last ${JSON.stringify(ran.inbound.body).slice(0, 300)})`)
      if (!message && elapsed > NO_Z03_MIN) stop(`no outbound Z03 exists ${NO_Z03_MIN} min after it was queued; switch ${JSON.stringify(switchState())}`)
      if (message && TERMINAL.includes(message.status)) stop(`outbound Z03 is ${message.status}: ${message.error}`)
      if (message && /^(sent|delivered|accepted|transmitted)/.test(message.status)) sentAt ??= Date.now()
      if (message && sentAt === null && elapsed > NOT_SENT_MIN) stop(`Z03 still "${message.status}" after ${NOT_SENT_MIN} min (outbox: ${JSON.stringify(ran.outbox.body).slice(0, 300)})`)
      if (sentAt !== null && go.received.length === 0 && (Date.now() - sentAt) / 60_000 > NO_ANSWER_MIN) stop(`Z03 sent but the grid owner has received no mail after ${NO_ANSWER_MIN} min`)
      if (Date.now() > deadline) stop(`supply period not active before the deadline; last state ${JSON.stringify({ period, switch: switchState(), z03: message })}`)
      await pause(TICK_MS)
    }
    const period = supply()
    expect(period, JSON.stringify(switchState())).toMatchObject({ status: 'active', start: SUPPLY_START })
    supplyPeriodId = sql<string>(`SELECT to_jsonb(id::text) FROM public.customer_supply_periods WHERE company_id=${literal(tenant.companyId)} AND metering_point_id=${literal(facility.meteringPointId)} ORDER BY created_at DESC LIMIT 1`)
    const basis = sql<unknown>(`SELECT gridex_received_sources.billing_supply_basis_v1(${literal(tenant.companyId)},${literal(supplyPeriodId)},'2026-06-30T23:00:00Z'::timestamptz,'2026-07-31T23:00:00Z'::timestamptz)`)
    step('C5', { supplyPeriodId, period, billingSupplyBasisJuly: basis })
    expect(basis, 'received-source billing supply basis for July exists').not.toBeNull()
  })

  it('C6 the grid owner sends every day of July, August and September as UTILTS E66', async () => {
    const batch = DAYS.map((day, i) => ({ meterId: gsrn, day, values: dayProfile(i), environment: 'test' }))
    const sent: Array<{ reference: string }> = []
    for (let offset = 0; offset < batch.length; offset += 31) {
      const response = await fetch(`${gridOwner.url}/__sim/send-e66-batch`, { method: 'POST', body: JSON.stringify({ receiver: tenant.supplierEdielId, files: batch.slice(offset, offset + 31) }) })
      const body = await response.json().catch(() => null) as { sent?: Array<{ reference: string }> } | null
      if (!response.ok || !body?.sent) throw Error(`grid_owner_send_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
      sent.push(...body.sent)
    }
    DAYS.forEach((day, i) => sentFiles.push({ day, reference: sent[i].reference, values: dayProfile(i) }))
    const monthKwh = (month: string) => sum3(sentFiles.filter((f) => f.day.startsWith(month)).flatMap((f) => f.values))
    state.months = Object.fromEntries(Object.entries(MONTHS).map(([key, month]) => [key, { month, kwh: monthKwh(month).toFixed(3), files: sentFiles.filter((f) => f.day.startsWith(month)).length }]))
    step('C6', { files: sentFiles.length, months: state.months })
    expect(sentFiles).toHaveLength(DAYS.length)
  })

  const inboundE66 = () => sql<Array<{ id: string; reference: string; status: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'reference',coalesce(external_reference,interchange_reference,''),'status',status) ORDER BY created_at),'[]')
    FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66'`)

  it('C7 the inbound cron receives every E66 on the tenant', async () => {
    const started = Date.now()
    const deadline = started + MIN_PER_STEP('T4_CHAIN_C7_MINUTES', 15)
    const NOTHING_MIN = Number(process.env.T4_CHAIN_C7_NOTHING_MINUTES ?? 5)
    const runs: unknown[] = []
    const mail = () => sql<{ total: number; failed: number; byStatus: Record<string, number>; sample: string | null }>(`SELECT jsonb_build_object('total',count(*),'failed',count(*) FILTER (WHERE processing_status IN ('failed','error')),
      'byStatus',coalesce(jsonb_object_agg(processing_status,n) FILTER (WHERE processing_status IS NOT NULL),'{}'::jsonb),'sample',(SELECT left(coalesce(error_message,''),300) FROM public.inbound_email_messages x WHERE x.company_id=${literal(tenant.companyId)} AND x.processing_status IN ('failed','error') LIMIT 1))
      FROM (SELECT processing_status,count(*) n FROM public.inbound_email_messages WHERE company_id=${literal(tenant.companyId)} GROUP BY 1) g`)
    const stop = (text: string) => { blocker('C7', text); throw Error(`C7 fail-fast: ${text}`) }
    let badInbound = 0
    for (;;) {
      const ran = await slot({ operations: false })
      badInbound = ran.inbound.status >= 500 ? badInbound + 1 : 0
      runs.push({ at: new Date().toISOString(), inbound: ran.inbound.status, fetched: (ran.inbound.body.result as Record<string, unknown> | undefined)?.fetchedMessages ?? null })
      const have = inboundE66().length, m = mail(), elapsed = (Date.now() - started) / 60_000
      step('C7-progress', { have, want: DAYS.length, elapsedMin: Math.round(elapsed * 10) / 10, mail: m, runs: runs.slice(-3) })
      if (have >= DAYS.length) break
      if (m && m.failed > 0) stop(`${m.failed} inbound mail job(s) in a terminal failed state: ${m.sample}`)
      if (badInbound >= 3) stop(`inbound mail cron answered 5xx three times (last ${JSON.stringify(ran.inbound.body).slice(0, 300)})`)
      if (elapsed > NOTHING_MIN && have === 0 && (!m || m.total === 0)) stop(`nothing arrived on the tenant ${NOTHING_MIN} min after the grid owner sent ${DAYS.length} files`)
      if (elapsed > NOTHING_MIN && have === 0 && m && m.total > 0) stop(`${m.total} mails arrived but none is a stored E66 message (inbound statuses ${JSON.stringify(m.byStatus)})`)
      if (Date.now() > deadline) stop(`only ${have}/${DAYS.length} E66 received before the deadline`)
      await pause(TICK_MS)
    }
    expect(inboundE66().length).toBeGreaterThanOrEqual(DAYS.length)
    step('C7', { received: inboundE66().length })
  })

  it('C8 issuer history evidence (synthetic stand-in) and UTILTS engine run per message through the admin server action', async () => {
    const sources = inboundE66()
    for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
    const operator = await operatorSession()
    const base = LIVE.appUrl
    const html = async (path: string) => { const r = await fetch(base + path, { headers: { cookie: operator.cookie() } }); return { status: r.status, text: await r.text() } }
    const page = await html(`/admin/ediel/messages/${sources[0].id}`)
    let actionId: string | null = null
    for (const form of page.text.match(/<form[\s\S]*?<\/form>/g) ?? []) {
      if (!/Kör UTILTS engine/.test(form)) continue
      const m = /name="\$ACTION_ID_([0-9a-f]+)"/.exec(form)
      if (m) { actionId = m[1]; break }
    }
    if (!actionId) { blocker('C8', `no "Kör UTILTS engine" form on /admin/ediel/messages/${sources[0].id} (page status ${page.status}); the message may be held or already answered`); }
    expect(actionId, 'UTILTS engine form on the message page').toBeTruthy()
    const storedFor = (id: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(id)}`)
    const results: Array<{ id: string; status: number; location: string | null; stored: number }> = []
    for (const [i, source] of sources.entries()) {
      const form = new FormData()
      form.set(`$ACTION_ID_${actionId}`, ''); form.set('edielMessageId', source.id)
      const response = await fetch(`${base}/admin/ediel/messages/${source.id}`, { method: 'POST', body: form, redirect: 'manual', headers: { cookie: operator.cookie(), origin: new URL(base).origin } })
      await response.arrayBuffer()
      let stored = storedFor(source.id)
      for (let wait = 0; wait < 30 && stored < 96; wait += 1) { await pause(2000); stored = storedFor(source.id) }
      results.push({ id: source.id, status: response.status, location: response.headers.get('location'), stored })
      if (i % 10 === 9) { step('C8-progress', { done: i + 1, results: results.slice(-3) }); await slot({ operations: false }) }
    }
    step('C8', { processed: results.length, notStored: results.filter((r) => r.stored < 96).length, sample: results.slice(0, 3) })
    expect(results.filter((r) => r.stored < 96).map((r) => `${r.id}: status ${r.status}, stored ${r.stored}`), 'every E66 stored 96 quarter-hours').toEqual([])
    // replies (CONTRL / APERAK) leave through the outbox
    for (let i = 0; i < 6; i += 1) { await slot({ operations: false }); await pause(TICK_MS) }
  })

  it('C9 stored values are billable: eligible rows with a supply period per month', async () => {
    const rows = sql<Array<{ month: string; n: number; eligible: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('month',m,'n',n,'eligible',e) ORDER BY m),'[]') FROM (
        SELECT to_char(period_start AT TIME ZONE 'Etc/GMT-1','YYYY-MM') m, count(*) n, count(*) FILTER (WHERE billing_gate_status='eligible' AND supply_period_id IS NOT NULL) e
        FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND revision_status='current' GROUP BY 1) x`)
    step('C9', rows)
    // No vacuous pass: every month must have exactly its 96 values per day, all billing-eligible with a supply period.
    const wanted = Object.fromEntries(Object.values(MONTHS).map((m) => [m, DAYS.filter((d) => d.startsWith(m)).length * 96]))
    const problems: string[] = []
    for (const [month, n] of Object.entries(wanted)) {
      const row = rows.find((r) => r.month === month)
      if (!row || row.n === 0) problems.push(`${month}: no normalized values (want ${n})`)
      else if (row.n !== n) problems.push(`${month}: ${row.n} values, want ${n}`)
      else if (row.eligible !== row.n) problems.push(`${month}: only ${row.eligible}/${row.n} billing-eligible with a supply period`)
    }
    expect(problems, `billing-eligible values per month: ${JSON.stringify(rows)}`).toEqual([])
    // chain output for the harness
    const contract = sql<Record<string, unknown>>(`SELECT to_jsonb(c) - 'signature_snapshot' - 'commercial_snapshot' - 'legal_snapshot' - 'application_snapshot' - 'version_snapshot' - 'price_snapshot' - 'tenant_legal_party_snapshot' - 'tenant_communication_snapshot' - 'legal_acceptance_snapshot' - 'signature_snapshot' - 'legal_versions_snapshot' FROM public.customer_contracts c WHERE c.id=${literal(facility.contractId)}`)
    state.result = {
      companyId: tenant.companyId, customerId, siteId: facility.siteId, meteringPointId: facility.meteringPointId, contractId: facility.contractId, supplyPeriodId, gsrn,
      terms: { fixedOrePerKwh: TERMS.fixedOrePerKwh, monthlyFeeSek: TERMS.monthlyFeeSek, vatRate: TERMS.vat, priceArea: 'SE3' }, months: state.months,
      operator: { email: tenant.operatorEmail }, contractFixedOre: contract.fixed_price_ore_per_kwh ?? null, contractMonthlyFee: contract.monthly_fee_sek ?? null,
      sha256: createHash('sha256').update(JSON.stringify(state.months)).digest('hex'),
    }
    state.finishedAt = new Date().toISOString()
    save()
    gridOwner?.stop()
  })
})

