// executionScope: ISOLATED_NATIVE
// masterplan-sim: API01.03
// Expiry-only source oracle. Revoked POA and genuine native/provider qualification
// remain HOLD; an expired-only green run cannot qualify the whole original ID.
// Dates are controlled fixture inputs in DB, not a mocked Auth/system clock.
import { beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, requireEnv, sim } from '../lib'
import { createPartnerClient, partner, type PartnerClient, type PartnerResponse } from '../lib/partner'
import { http, receipt, sha256 } from '../lib/receipts'
import { createCompany, createCustomer, lit } from '../lib/t5-world'

const SCOPES = ['partner_sites.write', 'partner_power_of_attorney.write', 'customer_power_of_attorney.read', 'customer_sites.read']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
function need(value: unknown, code: string): asserts value { if (!value) throw new Error(`HARNESS_PRECONDITION: API01.03 ${code}`) }
function object(value: unknown): Record<string, unknown> {
  need(value && typeof value === 'object' && !Array.isArray(value), 'response_object')
  return value as Record<string, unknown>
}
function one<T>(rows: T[]): T { need(rows.length === 1, 'exact_row'); return rows[0] }
function ref(value: unknown): string { need(typeof value === 'string' && value.length > 0, 'resource_reference'); return value }
function isoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
type Scope = { companyId: string; customerId: string; siteId: string; contractId?: string }
type Poa = {
  id: string; company_id: string; customer_id: string; customer_site_id: string | null; site_id: string | null
  contract_id: string | null; customer_contract_id: string | null; power_of_attorney_reference: string; status: string
  signed_at: string | null; accepted_at: string | null; valid_to: string | null; valid_until: string | null; revoked_at: string | null
  document_hash: string | null; document_path: string | null
}
function readPoa(companyId: string, key: 'id' | 'power_of_attorney_reference', value: string): Poa {
  return one(psqlRows<Poa>(`/* API01_POA_FACT */ select p.* from public.powers_of_attorney p where p.company_id=${lit(companyId)} and p.${key}=${lit(value)}`))
}
function assertScope(poa: Poa, scope: Scope) {
  need(UUID.test(poa.id) && poa.company_id === scope.companyId && poa.customer_id === scope.customerId && (poa.customer_site_id ?? poa.site_id) === scope.siteId, 'poa_scope')
  need([poa.site_id, poa.customer_site_id].every(id => id === null || id === scope.siteId), 'poa_site_alias')
  if (scope.contractId) need((poa.contract_id ?? poa.customer_contract_id) === scope.contractId && [poa.contract_id, poa.customer_contract_id].every(id => id === null || id === scope.contractId), 'poa_contract')
  ref(poa.power_of_attorney_reference)
}
function clockInput() {
  const clock = one(psqlRows<{ now: string; dbToday: string; stockholmToday: string; expiredOn: string }>(`/* API01_POA_CLOCK */ select clock_timestamp()::text as now,current_date::text as "dbToday",(clock_timestamp() at time zone 'Europe/Stockholm')::date::text as "stockholmToday",(least(current_date,(clock_timestamp() at time zone 'Europe/Stockholm')::date)-1)::text as "expiredOn"`))
  need(Number.isFinite(Date.parse(clock.now)) && [clock.dbToday, clock.stockholmToday, clock.expiredOn].every(isoDate), 'clock_input')
  need(clock.expiredOn < clock.dbToday && clock.expiredOn < clock.stockholmToday, 'expired_input')
  return clock
}
function assertSigned(poa: Poa, scope: Scope, now: string): asserts poa is Poa & { signed_at: string; accepted_at: string; document_hash: string; document_path: string } {
  assertScope(poa, scope)
  need(poa.status === 'signed' && poa.revoked_at === null, 'signed_poa')
  for (const time of [poa.signed_at, poa.accepted_at]) need(time && Number.isFinite(Date.parse(time)) && Date.parse(time) <= Date.parse(now), 'signature_acceptance')
  need(poa.document_hash && HASH.test(poa.document_hash) && poa.document_path, 'signed_document')
}
function protectedPoaHash(poa: Poa) {
  // Hash all protected stored facts, including signed scopes/evidence metadata;
  // only the explicit expiry/status/update-time projection may change.
  const protectedFacts = Object.fromEntries(Object.entries(poa).filter(([key]) => !['status', 'valid_to', 'valid_until', 'updated_at'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
  return sha256(JSON.stringify(protectedFacts))
}
function expiryEvents(poa: Poa, date: string): number {
  const n = one(psqlRows<{ n: number }>(`/* API01_POA_EVENTS */ select count(*)::integer n from public.power_of_attorney_events where company_id=${lit(poa.company_id)} and power_of_attorney_id=${lit(poa.id)} and event_type='expired' and payload->>'valid_to'=${lit(date)} and payload->>'source'='customer_operations_cron'`)).n
  need(Number.isInteger(n) && n >= 0, 'expiry_event_count'); return n
}
async function expirePoa(poa: Poa, scope: Scope) {
  const clock = clockInput(); assertSigned(poa, scope, clock.now)
  const effective = poa.valid_until ?? poa.valid_to
  need(effective === null || (isoDate(effective) && effective >= clock.dbToday && effective >= clock.stockholmToday), 'initial_validity')
  const beforeEvents = expiryEvents(poa, clock.expiredOn)
  const changed = psql(`/* API01_POA_EXPIRE */ update public.powers_of_attorney set valid_to=${lit(clock.expiredOn)}::date,valid_until=case when valid_until is null then null else ${lit(clock.expiredOn)}::date end where company_id=${lit(scope.companyId)} and id=${lit(poa.id)} and status='signed' and document_hash=${lit(poa.document_hash)} and signed_at is not distinct from ${lit(poa.signed_at)}::timestamptz and accepted_at is not distinct from ${lit(poa.accepted_at)}::timestamptz returning id`)
  need(changed === poa.id, 'expiry_exact_write')
  const input = readPoa(scope.companyId, 'id', poa.id)
  expect(protectedPoaHash(input), 'expiry date input must preserve signature and ownership').toEqual(protectedPoaHash(poa))
  need(input.valid_to === clock.expiredOn && (input.valid_until ?? input.valid_to) === clock.expiredOn, 'stored_expired_input')
  const response = await fetch(new URL('/api/internal/customer-operations/cron?limit=100', sim.appUrl), { method: 'POST', headers: { authorization: `Bearer ${requireEnv('CRON_SECRET')}` } })
  const text = await response.text(); need(response.status === 200, 'expiry_sweep_transport')
  let body: unknown; try { body = JSON.parse(text) } catch { need(false, 'expiry_sweep_json') }
  const result = object(object(body).result), expiry = object(result.poaExpiry)
  need(object(body).ok === true && typeof expiry.expired === 'number' && Number.isInteger(expiry.expired) && expiry.expired >= 1, 'expiry_sweep_result')
  const stored = readPoa(scope.companyId, 'id', poa.id); assertScope(stored, scope)
  need(stored.status === 'expired' && stored.valid_to === clock.expiredOn && (stored.valid_until ?? stored.valid_to) === clock.expiredOn, 'stored_expiry')
  expect(protectedPoaHash(stored), 'expiry sweep must preserve signature and ownership').toEqual(protectedPoaHash(poa))
  need(expiryEvents(stored, clock.expiredOn) === beforeEvents + 1, 'same_poa_expiry_event')
  return { stored, sweep: http(response.status, text), date: clock.expiredOn }
}
function parsedResponse(response: PartnerResponse): Record<string, unknown> { need(response.status === 200, 'poa_read_transport'); return object(response.json) }

function minimalPdfBase64(label: string): string {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>']
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1').toString('base64')
}

const GRAPH_LANES = ['public.ediel_messages', 'public.outbound_requests', 'public.ediel_message_intents', 'public.ediel_outbox',
  'gridex_received_sources.switch_originals', 'gridex_outbound_dispatch.originals', 'gridex_outbound_dispatch.attempts',
  'gridex_outbound_dispatch.events', 'gridex_ediel_transport.attempts', 'public.supplier_switch_events',
  'public.customer_operation_jobs', 'public.customer_operation_tasks', 'public.customer_operation_events',
  'public.powers_of_attorney', 'public.power_of_attorney_events', 'public.supplier_switch_requests'] as const
function graph(companyId: string) {
  need(UUID.test(companyId), 'graph_company')
  const sql = GRAPH_LANES.map(lane => `select ${lit(lane)} lane,count(*)::integer n,encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') digest from ${lane} t where company_id=${lit(companyId)}`).join(' union all ')
  const rows = psqlRows<{ lane: string; n: number; digest: string }>(`/* API01_POA_GRAPH */ ${sql} order by lane`)
  need(rows.length === GRAPH_LANES.length && new Set(rows.map(row => row.lane)).size === GRAPH_LANES.length && rows.every(row => GRAPH_LANES.includes(row.lane as typeof GRAPH_LANES[number]) && Number.isInteger(row.n) && row.n >= 0 && HASH.test(row.digest)), 'effect_graph')
  return rows
}
type Fixture = Scope & { actorUserId: string; switchId: string; routeId: string; pointId: string; powerOfAttorneyId: string; authorizationDocumentId: string; contractId: string }
const READINESS_INPUTS = ['company_id', 'customer_contract_id', 'customer_id', 'customer_site_id', 'metering_point_id', 'agreement_ready', 'agreement_signed', 'facility_data_ready', 'switch_data_ready', 'signed_pdf_archived', 'start_date_ready', 'legal_document_count', 'accepted_document_count'] as const
function readiness(f: Fixture) {
  const row = one(psqlRows<Record<string, unknown>>(`/* API01_POA_READINESS */ select * from public.customer_contract_lifecycle_readiness_v where company_id=${lit(f.companyId)} and customer_contract_id=${lit(f.contractId)}`))
  need(row.company_id === f.companyId && row.customer_contract_id === f.contractId && row.customer_id === f.customerId && row.customer_site_id === f.siteId && row.metering_point_id === f.pointId, 'readiness_scope')
  for (const key of ['agreement_ready', 'agreement_signed', 'facility_data_ready', 'switch_data_ready', 'signed_pdf_archived', 'start_date_ready']) need(row[key] === true, 'non_poa_readiness')
  need(typeof row.legal_document_count === 'number' && row.legal_document_count > 0 && row.accepted_document_count === row.legal_document_count, 'legal_acceptance')
  return row
}
function assertQueued(f: Fixture, queued: unknown) {
  const id = object(queued).id; need(typeof id === 'string' && UUID.test(id), 'direct_message_id')
  const row = one(psqlRows<{ message: Record<string, unknown>; intent: Record<string, unknown>; original: Record<string, unknown> }>(`/* API01_POA_MESSAGE */ select to_jsonb(m) message,to_jsonb(i) intent,to_jsonb(o) original from public.ediel_messages m join public.ediel_message_intents i on i.id=m.intent_id and i.company_id=m.company_id join gridex_received_sources.switch_originals o on o.message_id=m.id and o.company_id=m.company_id where m.company_id=${lit(f.companyId)} and m.id=${lit(id)}`))
  const m = object(row.message), i = object(row.intent), o = object(row.original)
  need(m.id === id && m.company_id === f.companyId && m.customer_id === f.customerId && m.site_id === f.siteId && m.metering_point_id === f.pointId && m.switch_request_id === f.switchId && m.message_family === 'PRODAT' && m.message_code === 'Z03' && m.direction === 'outbound' && m.environment === 'test' && m.status === 'queued', 'message_scope')
  need(i.id === m.intent_id && i.company_id === f.companyId && i.operation_id === f.switchId && i.supplier_switch_request_id === f.switchId && i.customer_id === f.customerId && i.customer_site_id === f.siteId && i.ediel_message_id === id && i.outbound_request_id === m.outbound_request_id, 'intent_scope')
  need(o.message_id === id && o.company_id === f.companyId && o.contract_id === f.contractId && o.intent_id === m.intent_id && o.outbound_request_id === m.outbound_request_id, 'original_scope')
  need(typeof m.raw_payload === 'string' && m.raw_payload.length > 0 && typeof m.immutable_payload_hash === 'string' && HASH.test(m.immutable_payload_hash) && sha256(m.raw_payload) === m.immutable_payload_hash && o.payload_hash === m.immutable_payload_hash, 'immutable_original')
  return id
}

describe('API01.03 utgången POA', () => {
  let A: string, customerId: string, siteId: string, key: PartnerClient, custRef = '', siteRef = '', poaRef = '', pdfHash = ''
  beforeAll(async () => {
    A = createCompany('Sim T5 POA bolag A'); customerId = createCustomer(A, 'PoaKund'); key = createPartnerClient(A, SCOPES)
    custRef = ref(psql(`select customer_reference from public.customers where id=${lit(customerId)} and company_id=${lit(A)}`))
    const site = await partner(key, 'POST', `customer/${custRef}/site`, { address: 'Poavägen 1', zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
    need(site.status === 201, 'site_setup'); siteRef = ref(object(site.json).entity_id)
    siteId = one(psqlRows<{ id: string }>(`/* API01_POA_SITE */ select id from public.customer_sites where company_id=${lit(A)} and customer_id=${lit(customerId)} and facility_reference=${lit(siteRef)}`)).id
    need(UUID.test(siteId), 'site_binding')
    const pdf = minimalPdfBase64('poa'); pdfHash = sha256(Buffer.from(pdf, 'base64'))
    const created = await partner(key, 'POST', `customer/${custRef}/site/${siteRef}/powerofattorney`, { poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: pdf, file_extension: 'pdf' })
    need(created.status === 201, 'poa_setup'); poaRef = ref(object(created.json).entity_id)
  }, 120_000)

  it('API01.03 partner-API:ts GET redovisar en utgången POA som utgången (båda läsvägarna)', async () => {
    const scope = { companyId: A, customerId, siteId }, before = readPoa(A, 'power_of_attorney_reference', poaRef)
    need(before.document_hash === pdfHash, 'uploaded_document_hash')
    const { stored, sweep, date } = await expirePoa(before, scope)
    const simple = await partner(key, 'GET', `customer/${custRef}/site/${siteRef}/powerofattorney`), core = await partner(key, 'GET', `powers-of-attorney/${poaRef}`)
    const a = parsedResponse(simple), b = object(parsedResponse(core).data)
    expect({ ref: a.entity_id, status: a.status, date: a.valid_to }, 'simple API must identify the actual expired POA').toEqual({ ref: stored.power_of_attorney_reference, status: 'expired', date })
    expect({ ref: b.power_of_attorney_reference, status: b.status, date: b.valid_to }, 'core API must identify the actual expired POA').toEqual({ ref: stored.power_of_attorney_reference, status: 'expired', date })
    need(typeof b.signed_at === 'string' && Date.parse(b.signed_at) === Date.parse(stored.signed_at!), 'api_signature_binding')
    receipt('API01.03', 'GET exact expiry', { poaRef, date, protectedPoaSha256: protectedPoaHash(stored), sweep, simple: http(simple.status, simple.text), core: http(core.status, core.text), notVerified: ['revoked_poa', 'independent_native_provider_qualification'] })
  })

  it('API01.03 leverantörsbyte (Z03) med utgången POA nekas; samma kedja med giltig POA godtas', async () => {
    const fixtureModule = '@/scripts/helpers/ediel-normal-switch-native-fixture', flowModule = '@/lib/ediel/flows/prodatSwitch'
    const { seedNormalSwitchNativeFixture, futureNativeSupplyDate } = await import(/* @vite-ignore */ fixtureModule) as { seedNormalSwitchNativeFixture: (input: { deferOriginal: true; requestedStartDate: string }) => Promise<Fixture>; futureNativeSupplyDate: (days: number) => string }
    const { prepareAndQueueEdielZ03 } = await import(/* @vite-ignore */ flowModule) as { prepareAndQueueEdielZ03: (input: { actorUserId: string; switchRequestId: string; communicationRouteId: string; environment: 'test' }) => Promise<unknown> }
    const f = await seedNormalSwitchNativeFixture({ deferOriginal: true, requestedStartDate: futureNativeSupplyDate(14) })
    for (const id of [f.companyId, f.customerId, f.siteId, f.contractId, f.pointId, f.switchId, f.routeId, f.powerOfAttorneyId, f.authorizationDocumentId]) need(typeof id === 'string' && UUID.test(id), 'fixture_identity')
    const before = readPoa(f.companyId, 'id', f.powerOfAttorneyId); assertSigned(before, f, clockInput().now)
    const ready = readiness(f); need(ready.switch_ready === true && ready.valid_power_of_attorney === true && Array.isArray(ready.blockers) && ready.blockers.length === 0, 'valid_control_readiness')
    const input = { actorUserId: f.actorUserId, switchRequestId: f.switchId, communicationRouteId: f.routeId, environment: 'test' as const }
    let control: unknown
    try { control = await prepareAndQueueEdielZ03(input) } catch { need(false, 'valid_control_technical_failure') }
    const controlMessage = assertQueued(f, control)
    const { stored, date } = await expirePoa(before, f)
    const blocked = readiness(f)
    expect(READINESS_INPUTS.map(key => blocked[key]), 'only the POA readiness input changes').toEqual(READINESS_INPUTS.map(key => ready[key]))
    need(blocked.switch_ready === false && blocked.valid_power_of_attorney === false && Array.isArray(blocked.blockers) && blocked.blockers.length === 1 && blocked.blockers[0] === 'valid_power_of_attorney_missing', 'canonical_poa_blocker')
    const baseline = graph(f.companyId)
    let refused = false
    try { await prepareAndQueueEdielZ03(input) } catch (error) {
      const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
      need(message === 'PRODAT Z03 stoppades av canonical switch-gate: supplier_switch_not_ready', 'technical_failure_not_poa_denial')
      refused = true
    }
    need(refused, 'expired_poa_queued')
    expect(graph(f.companyId), 'refused attempt must preserve the exact original/queue/history baseline').toEqual(baseline)
    expect(protectedPoaHash(readPoa(f.companyId, 'id', f.powerOfAttorneyId)), 'refused attempt must preserve same POA evidence').toEqual(protectedPoaHash(stored))
    receipt('API01.03', 'Z03 exact POA refusal', { poaId: f.powerOfAttorneyId, date, controlMessage, blocker: 'valid_power_of_attorney_missing', graphSha256: sha256(JSON.stringify(baseline)), notVerified: ['revoked_poa', 'independent_native_provider_qualification'] })
  }, 600_000)
})
