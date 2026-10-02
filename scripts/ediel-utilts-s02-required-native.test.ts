import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, seedUtiltsConsumptionParties, seedUtiltsIssuerHistoryGround } from './helpers/utiltsConsumptionParties'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { s02PlanningFixture, s02PlanningPair, s02PlanningSecondSequence, type S02PlanningDefect } from '../__tests__/helpers/utiltsS02PlanningFixture'
import { utiltsNativeSourceFixture, utiltsTestEnvironmentWire } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

// Real public canonical consumer, evidence trigger, SQL, ACK gateway/writer
// and finalizer. Observe only final metering/billing/completion writes. No
// actual observations, historical mandates or transport worker are supplied.
const effects = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: effects.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(),
  ingestBillingUnderlay: effects.bill, syncGridOwnerDataRequestReceivedFromEdiel: effects.complete }))
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit = (value: unknown) => "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_s02_native_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000 }).trim()
  return result ? JSON.parse(result) as T : undefined as T
}
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

async function seed(_label: string, defect: S02PlanningDefect, ownFirst: boolean, transform: (raw: string) => string = raw => raw) {
  // Synthetic SMTP readiness only (technical ACK route check); no mail is sent.
  for (const [k, v] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(k, v)
  // Each seed owns a unique receiver supplier identity and a unique issuer
  // with its own synthetic approved issuer/transport-mandate version.
  const { ediel: actorEdielId, issuer } = seedUtiltsConsumptionParties(sql, lit, randomUUID())
  const smtp = assertEdielSmtpReadiness()
  const ids = { company: randomUUID(), actor: randomUUID(), route: randomUUID(), profile: randomUUID() }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'Synthetic native S02 required fields','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${lit(ids.actor)},'authenticated','authenticated',${lit(`s02-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(ids.actor)},${lit(`s02-${ids.actor}@example.invalid`)},'Synthetic S02 actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
   -- Declared local operator uses the genuine current membership/permission
   -- tables. No admin exemption or verified-source fixture grants authority.
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${lit(ids.company)},${lit(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${lit(ids.actor)},${lit(ids.company)},id,key FROM public.permissions
    WHERE key IN('metering.write','communication.read','communication.write','communication.send');
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)
      VALUES(${lit(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
      VALUES(${lit(ids.company)},'test',${lit(ids.actor)},'EdielId',${lit(actorEdielId)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
      VALUES(${lit(ids.company)},'test',${lit(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${lit(ids.company)},'test','Synthetic native legal supplier',${lit(actorEdielId)},${lit(actorEdielId)});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
      VALUES(${lit(ids.route)},${lit(ids.company)},'Native S02 ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port)
      VALUES(${lit(ids.profile)},${lit(ids.company)},${lit(ids.route)},'Native S02 ACK profile','test','edifact','edifact',${lit(actorEdielId)},${lit(issuer)},'23-DDQ-S02-S',true,true,${lit(smtp.from)},${lit(smtp.host)},${lit(smtp.port)});`)
  const fixture = s02PlanningFixture({ company: ids.company, receiver: actorEdielId, transactions: s02PlanningPair(defect, ownFirst) })
  const sourceId = randomUUID()
  const { id, raw, parsed } = utiltsNativeSourceFixture(utiltsTestEnvironmentWire(transform(fixture.raw_payload!)).replaceAll('+91100:ZZ+', `+${issuer}:ZZ+`).replaceAll('NAD+MS+91100:', `NAD+MS+${issuer}:`).replace('S02-DOCUMENT-001', `S02DOC${sourceId.replaceAll('-', '').slice(0, 14)}`), sourceId)
  // No prefilled profile/rule-pack authority: the actual family/date capture
  // trigger must qualify this source. No individual customer graph is needed.
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference)
    VALUES(${lit(id)},${lit(ids.company)},'test','inbound','edifact','UTILTS','S02','received',${lit(raw)},'{}','{}','2026-10-01T20:00:00Z','{}',${lit(parsed.applicationReference)},${lit(issuer)},${lit(actorEdielId)},${lit(parsed.interchangeReference)});`)
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
  expect(error).toBeNull()
  expect(data?.rule_pack_snapshot).toMatchObject({ authority: 'gridex_bind_inbound_ediel_rule_pack_evidence',
    databaseRole: 'evidence_only', family: 'UTILTS', code: 'S02', effectiveDate: '2026-10-01' })
  const source = data as EdielMessageRow
  seedUtiltsIssuerHistoryGround(sql, lit, source.id, ids.actor)
  await recordUtiltsTechnicalReception(source, ids.actor)
  let recorded: Awaited<ReturnType<typeof recordUtiltsFinalRuntime>> | undefined
  expect(source.customer_id).toBeNull(); expect(source.site_id).toBeNull(); expect(source.metering_point_id).toBeNull()
  const prepare = async (forceAccepted = false): Promise<UtiltsBoundPersistenceInput & { actorUserId: string }> => {
    // Production order: the structurally qualified runtime is recorded once.
    recorded ??= await recordUtiltsFinalRuntime(source)
    const runtime = { ...recorded, transactionDispositions: [...recorded.transactionDispositions] }, policy = resolveCanonicalMessagePolicy(source)!
    expect(runtime.validation.syntaxOk).toBe(true)
    // Deliberately exercise the service caller's attempted positive override,
    // even after runtime guide rejection. Preserve each physical IDE's fields.
    if (forceAccepted) runtime.transactionDispositions = runtime.transactionDispositions.map(row => ({
      ...row, disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] }))
    return { actorUserId: ids.actor, companyId: ids.company, environment: 'test', sourceMessageId: source.id, messageCode: 'S02', rawPayload: source.raw_payload!,
      contracts: await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches: [], dataRequest: null,
        fallback: { customerId: null, siteId: null, meteringPointId: null, gridOwnerId: null }, allowConsumption: false }),
      transactions: buildUtiltsTransactionPersistencePayload({ messageCode: 'S02', transactions: runtime.facts.transactions,
        dispositions: runtime.transactionDispositions, rawSegments: runtime.facts.rawSegments, matches: [] }) }
  }
  return { ids, source, parties: { issuer, receiver: actorEdielId }, prepare, consume: () => processInboundUtiltsMessage({ actorUserId: ids.actor, edielMessageId: source.id }) }
}

type Ack = { id: string; message_family: string; ack_outcome: string; raw_payload: string; company_id: string;
  source_operation_id: string; parsed_payload: { relatedTransactionReference: string }; rule_pack_snapshot: Record<string, unknown> }
type Reservation = { source_transaction_id: string; disposition: string; planned_response_type: string;
  final_response_type: string | null; response_message_id: string | null; persisted_series_id: string | null }
type Series = { id: string; source_transaction_reference: string; series_kind: string; external_metering_point_id: string }
type Value = { series_id: string; qualifier: string; quantity: number }
type Contract = { transaction_id: string; contract: { observations: unknown[]; metering: { capability: string }; billing: { capability: string } } }
type Snapshot = { acks: Ack[]; reservations: Reservation[]; receipts: unknown[]; series: Series[]; values: Value[]; contracts: Contract[]; outbox: unknown[] }
function snapshot(source: string): Snapshot {
  return sql(`SELECT jsonb_build_object(
    'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ediel_messages a WHERE a.related_message_id=${lit(source)}),
    'reservations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.source_transaction_id),'[]') FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=${lit(source)}),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=${lit(source)}),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_transaction_reference),'[]') FROM public.meter_reading_series s WHERE s.source_ediel_message_id=${lit(source)}),
    'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.series_id,v.source_order),'[]') FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_ediel_message_id=${lit(source)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.transaction_id),'[]') FROM gridex_utilts_binding.contracts c WHERE c.source_message_id=${lit(source)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE o.source_message_id=${lit(source)}))`)
}
function noConsumption() {
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
}
function directRpc(input: UtiltsBoundPersistenceInput & { actorUserId: string }) {
  // Bypass application persistence validation entirely: this oracle belongs
  // to the service-only PostgreSQL boundary, not to its TypeScript adapter.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'gridex_persist_utilts_consumption_v1', args: {
    p_company_id: string; p_environment: string; p_source_message_id: string; p_message_code: string; p_raw_payload: string; p_transactions: unknown; p_actor_user_id: string
  }) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  return rpc('gridex_persist_utilts_consumption_v1', { p_company_id: input.companyId, p_environment: input.environment,
    p_source_message_id: input.sourceMessageId, p_message_code: input.messageCode, p_raw_payload: input.rawPayload, p_actor_user_id: input.actorUserId,
    p_transactions: input.transactions.map((item, index) => ({ ...item, consumptionContract: input.contracts[index] })) })
}
function assertForecast(state: Snapshot, reference: string, point: string, quantity: number) {
  const series = state.series.find(row => row.source_transaction_reference === reference)!
  expect(series).toMatchObject({ series_kind: 'forecast', external_metering_point_id: point })
  expect(state.values.filter(row => row.series_id === series.id)).toMatchObject([{ qualifier: '135', quantity }])
  expect(state.values.filter(row => row.series_id === series.id)).toHaveLength(1)
  expect(state.contracts.find(row => row.transaction_id === reference)).toMatchObject({ contract: {
    observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } } })
}
function assertAck(f: Awaited<ReturnType<typeof seed>>, state: Snapshot, reference: string, outcome: 'positive' | 'negative') {
  const own = state.acks.filter(row => row.message_family === 'APERAK' && row.parsed_payload.relatedTransactionReference === reference)
  expect(own).toHaveLength(1)
  const ack = own[0]
  expect(ack.ack_outcome).toBe(outcome)
  expect(ack.company_id).toBe(f.ids.company)
  expect(ack.raw_payload).toContain(`BGM+${outcome === 'positive' ? '312' : '313'}`)
  expect(ack.raw_payload).toContain(`RFF+ACW:${reference}'`)
  expect(ack.source_operation_id).toBe(`ediel_ack:${f.source.id}:APERAK:${reference}`)
  expect(ack.rule_pack_snapshot).toMatchObject({ authority: 'resolveCanonicalEdielPolicy', inheritedFromSourceMessage: true, sourceMessageId: f.source.id })
  expect(state.reservations.find(row => row.source_transaction_id === reference)).toMatchObject({
    disposition: outcome === 'positive' ? 'accepted' : 'guide_rejected', planned_response_type: `${outcome}_aperak`,
    final_response_type: `${outcome}_aperak`, response_message_id: ack.id })
  return ack
}

it.each([true, false])('native clean S02 forecasts retain distinct points/values, positive ACKs and immutable retry, own first=%s', async ownFirst => {
  const f = await seed(ownFirst ? '54350' : '54351', 'clean', ownFirst)
  expect((await f.consume()).internalReviewRequired).toBe(false)
  const first = snapshot(f.source.id)
  expect(first.receipts).toHaveLength(1); expect(first.series).toHaveLength(2); expect(first.contracts).toHaveLength(2)
  assertForecast(first, 'S02-OWN', '735999260731000007', 111)
  assertForecast(first, 'S02-SIBLING', '735999888000001014', 222)
  assertAck(f, first, 'S02-OWN', 'positive'); assertAck(f, first, 'S02-SIBLING', 'positive')
  expect(first.acks.filter(row => row.message_family === 'UTILTS_ERR')).toEqual([])
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})

const cases = (['missing-point', 'missing-quantity', 'missing-both'] as const).flatMap((defect, index) =>
  [true, false].map((ownFirst, order) => ({ defect, ownFirst, actor: String(54352 + index * 2 + order) })))
it.each(cases)('native actual S02 $defect rejects only own IDE before forecasting and retries unchanged, own first=$ownFirst', async ({ defect, ownFirst, actor }) => {
  const f = await seed(actor, defect, ownFirst)
  // Consume before the future rejection assertion: RED must expose the real
  // persisted outcome, not stop at an in-memory disposition comparison.
  const result = await f.consume(), first = snapshot(f.source.id)
  expect(result.internalReviewRequired).toBe(false)
  const negative = assertAck(f, first, 'S02-OWN', 'negative')
  for (const field of defect === 'missing-both' ? ['209', '515'] : [defect === 'missing-point' ? '209' : '515']) {
    expect(negative.raw_payload).toContain('ERC+41')
    expect(negative.raw_payload).toContain(`FTX+AAO++${field}::260`)
  }
  assertAck(f, first, 'S02-SIBLING', 'positive')
  expect(first.reservations.find(row => row.source_transaction_id === 'S02-OWN')?.persisted_series_id).toBeNull()
  expect(first.series).toHaveLength(1); expect(first.contracts).toHaveLength(1)
  assertForecast(first, 'S02-SIBLING', '735999888000001014', 222)
  expect(first.acks.filter(row => row.message_family === 'UTILTS_ERR')).toEqual([])
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})

it('native direct clean accepted S02 persists nonbilling forecasts and immutable reservation/contract retry', async () => {
  const f = await seed('54358', 'clean', true), input = await f.prepare(true)
  const result = await directRpc(input), first = snapshot(f.source.id)
  expect(result.error).toBeNull()
  expect(result.data).toMatchObject([{ disposition: 'accepted', persistenceStatus: 'persisted' }, { disposition: 'accepted', persistenceStatus: 'persisted' }])
  assertForecast(first, 'S02-OWN', '735999260731000007', 111); assertForecast(first, 'S02-SIBLING', '735999888000001014', 222)
  expect(first.acks).toEqual([])
  expect((await directRpc(input)).error).toBeNull(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})

it.each(cases)('native direct accepted S02 $defect refuses the whole batch twice before any durable effect, own first=$ownFirst', async ({ defect, ownFirst, actor }) => {
  const f = await seed(String(Number(actor) + 10), defect, ownFirst), input = await f.prepare(true)
  expect(input.transactions.every(row => row.disposition === 'accepted' && row.responseType === 'positive_aperak')).toBe(true)
  expect(input.contracts.every(row => row.observations.length === 0)).toBe(true)
  const own = input.transactions.find(row => row.transactionId === 'S02-OWN')!
  if (defect !== 'missing-quantity') expect(own.externalMeteringPointId).toBeNull()
  if (defect !== 'missing-point') expect(own.quantities).toEqual([])
  const errors: (string | null)[] = [], states: Snapshot[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await directRpc(input)
    errors.push(error?.message ?? null)
    states.push(snapshot(f.source.id))
  }
  const observed = states.map(state => ({ receipts: state.receipts.length, reservations: state.reservations.map(row => ({
    transaction: row.source_transaction_id, disposition: row.disposition, response: row.planned_response_type })),
    series: state.series.map(row => ({ transaction: row.source_transaction_reference, point: row.external_metering_point_id, kind: row.series_kind })),
    values: state.values.map(row => ({ qualifier: row.qualifier, quantity: row.quantity })), contracts: state.contracts.length }))
  expect(errors, JSON.stringify({ errors, observed })).toEqual([
    expect.stringMatching(/utilts_(consumption_identity_unsupported|s02_quantity_required)/),
    expect.stringMatching(/utilts_(consumption_identity_unsupported|s02_quantity_required)/),
  ])
  for (const state of states) expect(state).toEqual({ acks: [], reservations: [], receipts: [], series: [], values: [], contracts: [], outbox: [] })
  noConsumption()
})

const quantityPlacements = [
  { defect: 'wrong-qualifier', transform: (raw: string) => raw.replace("SEQ++1'\nQTY+135:111'", "SEQ++1'\nQTY+136:111'") },
  { defect: 'before-sequence', transform: (raw: string) => raw.replace("SEQ++1'\nQTY+135:111'", "QTY+135:111'\nSEQ++1'") },
]
it.each(quantityPlacements)('native actual S02 $defect cannot supply own observation QTY135; sibling and retry remain independent', async ({ defect, transform }) => {
  const f = await seed(defect === 'wrong-qualifier' ? '54368' : '54369', 'clean', true, transform)
  expect((await f.consume()).internalReviewRequired).toBe(false)
  const first = snapshot(f.source.id), ack = assertAck(f, first, 'S02-OWN', 'negative')
  expect(ack.raw_payload).toContain('ERC+41'); expect(ack.raw_payload).toContain('FTX+AAO++515::260')
  expect(first.series).toHaveLength(1); expect(first.contracts).toHaveLength(1)
  assertForecast(first, 'S02-SIBLING', '735999888000001014', 222); assertAck(f, first, 'S02-SIBLING', 'positive')
  expect(first.reservations.find(row => row.source_transaction_id === 'S02-OWN')?.persisted_series_id).toBeNull()
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})

async function assertTwoAtomicRefusals(f: Awaited<ReturnType<typeof seed>>, errorCode: string) {
  const input = await f.prepare(true), observed = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await directRpc(input)
    observed.push({ error: result.error?.message ?? null, state: snapshot(f.source.id) })
  }
  for (const attempt of observed) {
    expect(attempt.error, JSON.stringify(observed)).toContain(errorCode)
    expect(attempt.state).toEqual({ acks: [], reservations: [], receipts: [], series: [], values: [], contracts: [], outbox: [] })
  }
  noConsumption()
}
it.each(quantityPlacements)('native direct S02 $defect refuses both attempts atomically despite sibling QTY135', async ({ defect, transform }) => {
  await assertTwoAtomicRefusals(await seed(defect === 'wrong-qualifier' ? '54370' : '54371', 'clean', true, transform), 'utilts_s02_quantity_required')
})

const zeroQuantity = (raw: string) => raw.replace('QTY+135:111', 'QTY+135:0')
it('native actual S02 zero quantity has its own positive ACK and immutable nonbilling forecast retry', async () => {
  const f = await seed('54372', 'clean', true, zeroQuantity)
  expect((await f.consume()).internalReviewRequired).toBe(false)
  const first = snapshot(f.source.id)
  assertForecast(first, 'S02-OWN', '735999260731000007', 0); assertAck(f, first, 'S02-OWN', 'positive')
  assertForecast(first, 'S02-SIBLING', '735999888000001014', 222); assertAck(f, first, 'S02-SIBLING', 'positive')
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})
it('native direct S02 zero quantity remains an accepted nonbilling forecast on immutable retry', async () => {
  const f = await seed('54373', 'clean', true, zeroQuantity), input = await f.prepare(true)
  expect((await directRpc(input)).error).toBeNull()
  const first = snapshot(f.source.id)
  assertForecast(first, 'S02-OWN', '735999260731000007', 0); assertForecast(first, 'S02-SIBLING', '735999888000001014', 222)
  expect((await directRpc(input)).error).toBeNull(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})

const nationalPoints = (raw: string) => raw.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000007::89')
  .replace('LOC+172+735999888000001014::9', 'LOC+172+735999888000001014::89')
it('native actual S02 agency89 stays guide-valid, held with syntax CONTRL only, and retries unchanged', async () => {
  const f = await seed('54374', 'clean', true, nationalPoints)
  expect(runUtiltsRuntimeForMessage(f.source).validation.ok).toBe(true)
  expect((await f.consume()).internalReviewRequired).toBe(true)
  const first = snapshot(f.source.id)
  expect(first.receipts).toHaveLength(1); expect(first.reservations).toHaveLength(2)
  for (const row of first.reservations) expect(row).toMatchObject({ disposition: 'internal_review', planned_response_type: 'none', persisted_series_id: null })
  // CV-SYNTAX may acknowledge the valid interchange independently of the
  // unsupported point's business authority. No APERAK/ERR or forecast is allowed.
  expect(first.acks).toHaveLength(1)
  const technical = first.acks[0]
  expect(technical).toMatchObject({ message_family: 'CONTRL', message_code: 'CONTRL',
    ack_outcome: 'positive', company_id: f.ids.company,
    source_operation_id: `ediel_ack:${f.source.id}:CONTRL:message` })
  expect(technical.raw_payload).toContain(`UCI+${f.source.interchange_reference}+${f.parties.issuer}:ZZ+${f.parties.receiver}:ZZ+1'`)
  expect(technical.parsed_payload.relatedTransactionReference).toBeNull()
  expect(technical.rule_pack_snapshot).toMatchObject({ authority: 'resolveCanonicalEdielPolicy',
    inheritedFromSourceMessage: true, sourceMessageId: f.source.id })
  expect(first.series).toEqual([]); expect(first.values).toEqual([])
  expect(first.contracts).toEqual([]); expect(first.outbox).toEqual([])
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})
it('native direct S02 agency89 refuses a positive override twice with zero durable effects', async () => {
  await assertTwoAtomicRefusals(await seed('54375', 'clean', true, nationalPoints), 'utilts_consumption_identity_unsupported')
})

it('native actual S02 first observation cannot fill missing QTY135 in own second SEQ; sibling and retry remain independent', async () => {
  const f = await seed('54376', 'clean', true, raw => s02PlanningSecondSequence(raw, null))
  expect((await f.consume()).internalReviewRequired).toBe(false)
  const first = snapshot(f.source.id), ack = assertAck(f, first, 'S02-OWN', 'negative')
  expect(ack.raw_payload).toContain('ERC+41'); expect(ack.raw_payload).toContain('FTX+AAO++515::260')
  expect(first.series).toHaveLength(1); expect(first.contracts).toHaveLength(1)
  assertForecast(first, 'S02-SIBLING', '735999888000001014', 222); assertAck(f, first, 'S02-SIBLING', 'positive')
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})
it('native direct S02 own second SEQ missing QTY135 refuses both whole batches atomically', async () => {
  await assertTwoAtomicRefusals(await seed('54377', 'clean', true, raw => s02PlanningSecondSequence(raw, null)), 'utilts_s02_quantity_required')
})

function assertTwoForecastObservations(state: Snapshot) {
  const own = state.series.find(row => row.source_transaction_reference === 'S02-OWN')!
  expect(own).toMatchObject({ series_kind: 'forecast', external_metering_point_id: '735999260731000007' })
  const values = state.values.filter(row => row.series_id === own.id)
  expect(values).toHaveLength(2); expect(values).toMatchObject([{ qualifier: '135', quantity: 111 }, { qualifier: '135', quantity: 333 }])
  expect(state.contracts.find(row => row.transaction_id === 'S02-OWN')).toMatchObject({ contract: {
    observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } } })
  assertForecast(state, 'S02-SIBLING', '735999888000001014', 222)
}
it('native actual S02 two own monthly observations stay distinct with positive ACKs and immutable retry', async () => {
  const f = await seed('54378', 'clean', true, raw => s02PlanningSecondSequence(raw, 333))
  expect((await f.consume()).internalReviewRequired).toBe(false)
  const first = snapshot(f.source.id)
  assertTwoForecastObservations(first); assertAck(f, first, 'S02-OWN', 'positive'); assertAck(f, first, 'S02-SIBLING', 'positive')
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})
it('native direct S02 two own monthly observations persist independently and retry unchanged', async () => {
  const f = await seed('54379', 'clean', true, raw => s02PlanningSecondSequence(raw, 333)), input = await f.prepare(true)
  expect((await directRpc(input)).error).toBeNull()
  const first = snapshot(f.source.id)
  assertTwoForecastObservations(first)
  expect((await directRpc(input)).error).toBeNull(); expect(snapshot(f.source.id)).toEqual(first); noConsumption()
})
