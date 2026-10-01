import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture, type UtiltsAckFixtureTransaction } from '../__tests__/helpers/utiltsErrGatewayFixture'
import { utiltsNativeSourceFixture } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { assertUtiltsPositiveAckAuthorityForSend } from '@/lib/ediel/utilts/positiveAckAuthority'
import * as database from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

// Real local DB, source ownership, matching, canonical dispatcher, reservations,
// ACK gateway/validator/writer and finalizer. No transport worker is invoked.
// Only final metering/billing/completion writes are observed: rejected IDEs
// must never reach them. ACK/persistence adapters are real; only the explicit
// interruption case throws before its second ERR writer call, then restores it.
const sinks = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: sinks.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(),
  ingestBillingUnderlay: sinks.bill, syncGridOwnerDataRequestReceivedFromEdiel: sinks.complete }))

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal = (value: unknown) => "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('local_native_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000 }).trim()
  return result ? JSON.parse(result) as T : undefined as T
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  sinks.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'observed-native-meter' } })
  sinks.bill.mockResolvedValue({ id: 'observed-native-underlay' })
  sinks.complete.mockResolvedValue(null)
})

async function seed(actorEdielId: string, transactions: UtiltsAckFixtureTransaction[]) {
  const ids = { company: randomUUID(), actor: randomUUID(), route: randomUUID(), profile: randomUUID(),
    customer: randomUUID(), site: randomUUID(), point: randomUUID(), grid: randomUUID(), request: randomUUID() }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(ids.company)},'Synthetic native ERR gateway','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${literal(ids.actor)},'authenticated','authenticated',${literal(`err-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(ids.actor)},${literal(`err-${ids.actor}@example.invalid`)},'Synthetic ERR actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)
      VALUES(${literal(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'EdielId',${literal(actorEdielId)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${literal(ids.company)},'test','Synthetic native legal supplier',${literal(actorEdielId)},${literal(actorEdielId)});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active)
      VALUES(${literal(ids.route)},${literal(ids.company)},'Native ERR ACK route','ediel_ack','bilateral_test',true);
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
      VALUES(${literal(ids.profile)},${literal(ids.company)},${literal(ids.route)},'Native ERR ACK profile','test','edifact',${literal(actorEdielId)},'91100','23-DDQ-E66-T',true);
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${literal(ids.customer)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','private');
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${literal(ids.grid)},${literal(ids.company)},${literal(ids.grid)},'91100','test',true,'active');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id)
      VALUES(${literal(ids.site)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id)
      VALUES(${literal(ids.point)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.site)},'735999260731000007','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope)
      VALUES(${literal(ids.request)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},'billing_underlay');`)
  const insertSource = async (ownTransactions: UtiltsAckFixtureTransaction[], transformRaw?: (raw: string) => string) => {
    const fixture = utiltsErrGatewayFixture({ company: ids.company, receiver: actorEdielId, transactions: ownTransactions })
    const { id, raw, parsed } = utiltsNativeSourceFixture(transformRaw ? transformRaw(fixture.raw_payload!) : fixture.raw_payload!, randomUUID())
    // Let the real trigger capture the unique family/date-qualified source
    // evidence; prefilled rule-pack columns would bypass that boundary.
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference)
      VALUES(${literal(id)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},${literal(ids.request)},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}','{}','2026-10-01T20:00:00Z','{}',${literal(parsed.applicationReference)},'91100',${literal(actorEdielId)},${literal(parsed.interchangeReference)});`)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
    expect(error).toBeNull()
    expect(data?.rule_pack_snapshot).toMatchObject({ authority: 'gridex_bind_inbound_ediel_rule_pack_evidence',
      databaseRole: 'evidence_only', family: 'UTILTS', code: 'E66', effectiveDate: '2026-10-01' })
    return data as EdielMessageRow
  }
  const source = await insertSource(transactions)
  return { ids, source, insertSource, consume: (ownSource = source) => processInboundUtiltsMessage({ actorUserId: ids.actor, edielMessageId: ownSource.id }) }
}

type Snapshot = {
  acks: { id: string; family: string; outcome: string; scope: string; reference: string; wire: string; process: string; company: string; operation: string; policy: Record<string, unknown>; createdAt: string; updatedAt: string }[]
  reservations: { transaction: string; disposition: string; plan: string; final: string | null; ack: string | null; series: string | null; row: Record<string, unknown> }[]
  receipts: unknown[]
  series: { transaction: string; kind: string }[]
  outbox: unknown[]
  contracts: unknown[]
}
function snapshot(source: string): Snapshot {
  return sql(`SELECT jsonb_build_object(
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'scope',parsed_payload->>'ackScope','reference',parsed_payload->>'relatedTransactionReference','wire',raw_payload,'process',process_type,'company',company_id,'operation',source_operation_id,'policy',rule_pack_snapshot,'createdAt',created_at,'updatedAt',updated_at) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(source)}),
    'reservations',(SELECT coalesce(jsonb_agg(jsonb_build_object('transaction',source_transaction_id,'disposition',disposition,'plan',planned_response_type,'final',final_response_type,'ack',response_message_id,'series',persisted_series_id,'row',to_jsonb(a)) ORDER BY source_transaction_id),'[]') FROM public.ediel_ack_transaction_results a WHERE source_message_id=${literal(source)}),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_utilts_binding.receipts r WHERE source_message_id=${literal(source)}),
    'series',(SELECT coalesce(jsonb_agg(jsonb_build_object('transaction',source_transaction_reference,'kind',series_kind) ORDER BY source_transaction_reference),'[]') FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(source)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE source_message_id=${literal(source)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.transaction_id),'[]') FROM gridex_utilts_binding.contracts c WHERE source_message_id=${literal(source)}))`)
}
function assertErrs(f: Awaited<ReturnType<typeof seed>>, state: Snapshot, references: string[]) {
  const errs = state.acks.filter(row => row.family === 'UTILTS_ERR')
  expect(errs).toHaveLength(references.length)
  expect(new Set(errs.map(row => row.id)).size).toBe(references.length)
  for (const reference of references) {
    const ack = errs.find(row => row.reference === reference)!
    expect(ack).toBeDefined()
    expect(ack.wire).toContain(`RFF+TN:${reference}'`)
    expect(ack.wire).toContain('STS+E01::260+41+E87::260')
    expect(ack.process).toBe('functional_rejection')
    expect(ack.company).toBe(f.ids.company)
    expect(ack.operation).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:${reference}`)
    expect(ack.policy).toMatchObject({ authority: 'resolveCanonicalEdielPolicy', inheritedFromSourceMessage: true, sourceMessageId: f.source.id })
    expect(state.reservations.find(row => row.transaction === reference)).toMatchObject({ disposition: 'processability_rejected', plan: 'utilts_err', final: 'utilts_err', ack: ack.id, series: null })
  }
}

it('actual canonical consumer persists two independent same-code E87 ERRs, no forbidden effects, stable retry and positive control', async () => {
  const references = ['ERR-NATIVE-SHARED-PREFIX-IDE-A', 'ERR-NATIVE-SHARED-PREFIX-IDE-B']
  const f = await seed('54340', references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  expect(runUtiltsRuntimeForMessage(f.source).ackPlan.utiltsErrDetails.map(row => row.code)).toEqual(['E87', 'E87'])
  await f.consume()
  const first = snapshot(f.source.id)
  expect(first.receipts).toHaveLength(1)
  assertErrs(f, first, references)
  expect(first.acks.filter(row => row.family === 'APERAK')).toEqual([])
  expect(first.series).toEqual([])
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
  await f.consume()
  expect(snapshot(f.source.id)).toEqual(first)
  const positive = await f.insertSource([{ reference: 'ERR-NATIVE-POSITIVE', outcome: 'accepted' }])
  await f.consume(positive)
  const positiveState = snapshot(positive.id)
  expect(positiveState.reservations).toMatchObject([{ transaction: 'ERR-NATIVE-POSITIVE', disposition: 'accepted', final: 'positive_aperak' }])
  expect(positiveState.series).toHaveLength(1)
  expect(positiveState.acks.filter(row => row.family === 'UTILTS_ERR')).toEqual([])
  expect(positiveState.acks.filter(row => row.family === 'APERAK')).toMatchObject([{ outcome: 'positive', reference: 'ERR-NATIVE-POSITIVE' }])
  // U-14/ACK-03: actual committed storage/final reservation + actual renderer
  // own DM. DOC belongs to source BGM; DM must never be mistaken for source.
  const positiveAckId = positiveState.acks.find(row => row.family === 'APERAK')!.id
  const savedAck = await database.getEdielMessageById(positiveAckId)
  expect(savedAck).not.toBeNull()
  const sourceWire = tokenizeEdifact(positive.raw_payload!), ackWire = tokenizeEdifact(savedAck!.raw_payload!)
  const document = segmentComposite(sourceWire.segments.find(t => t.tag === 'BGM'), 2, sourceWire.una)[0]
  const dm = ackWire.segments.filter(t => t.tag === 'RFF').map(t => segmentComposite(t, 1, ackWire.una)).find(c => c[0] === 'DM')![1]
  expect(dm).toBeTruthy(); expect(dm).not.toBe(document)
  expect(segmentComposite(ackWire.segments.find(t => t.tag === 'DOC'), 2, ackWire.una)[0]).toBe(document)
  await expect(assertUtiltsPositiveAckAuthorityForSend(savedAck!)).resolves.toBeUndefined()
  // A caller cannot mutate the saved immutable final ACK into another wire.
  await expect(assertUtiltsPositiveAckAuthorityForSend({ ...savedAck!, raw_payload: savedAck!.raw_payload!.replace(`DM:${dm}`, `DM:${document}`) }))
    .rejects.toThrow('utilts_positive_ack_storage_unavailable')

  expect(sinks.meter).toHaveBeenCalledWith(expect.objectContaining({ companyId: f.ids.company, quantityKwh: 500 }))
})

it('actual mixed consumer keeps positive, guide-negative and two E87 ERR reservations and ACK wire scopes separate', async () => {
  const transactions: UtiltsAckFixtureTransaction[] = [
    { reference: 'MIX-NATIVE-OK', outcome: 'accepted' }, { reference: 'MIX-NATIVE-GUIDE', outcome: 'guide_rejected' },
    { reference: 'MIX-NATIVE-ERR-A', outcome: 'processability_rejected' }, { reference: 'MIX-NATIVE-ERR-B', outcome: 'processability_rejected' },
  ]
  const f = await seed('54341', transactions)
  expect(runUtiltsRuntimeForMessage(f.source).transactionDispositions.map(row => row.disposition)).toEqual(transactions.map(row => row.outcome))
  await f.consume()
  const first = snapshot(f.source.id)
  assertErrs(f, first, ['MIX-NATIVE-ERR-A', 'MIX-NATIVE-ERR-B'])
  const aperaks = first.acks.filter(row => row.family === 'APERAK')
  expect(aperaks).toHaveLength(2)
  for (const [reference, outcome, bgm] of [['MIX-NATIVE-OK', 'positive', '312'], ['MIX-NATIVE-GUIDE', 'negative', '313']]) {
    const ack = aperaks.find(row => row.reference === reference)!
    expect(ack.outcome).toBe(outcome)
    expect(ack.wire).toContain(`BGM+${bgm}`)
    expect(ack.wire).toContain(`RFF+ACW:${reference}'`)
    expect(first.reservations.find(row => row.transaction === reference)?.ack).toBe(ack.id)
  }
  expect(first.series).toEqual([{ transaction: 'MIX-NATIVE-OK', kind: 'actual' }])
  // The existing mixed-functional consumer holds metering/billing consumption;
  // this bounded test verifies ACK separation, not full SC-044 acceptance.
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
  await f.consume()
  expect(snapshot(f.source.id)).toEqual(first)
})

it('SC-044 exact three-IDE consumer stores only accepted data and finalizes independent positive, guide-negative and functional responses on stable retry', async () => {
  const transactions: UtiltsAckFixtureTransaction[] = [
    { reference: 'SC044-IDE-1', outcome: 'accepted' },
    { reference: 'SC044-IDE-2', outcome: 'guide_rejected' },
    { reference: 'SC044-IDE-3', outcome: 'processability_rejected' },
  ]
  const f = await seed('54344', transactions), runtime = runUtiltsRuntimeForMessage(f.source)
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.validation.issues.filter(issue => issue.kind === 'application' && !issue.lineItemReference && !issue.referenceNumber)).toEqual([])
  expect(runtime.transactionDispositions.map(row => ({ transaction: row.transactionId, disposition: row.disposition })))
    .toEqual(transactions.map(row => ({ transaction: row.reference, disposition: row.outcome })))
  await f.consume()
  const first = snapshot(f.source.id)
  expect(first.receipts).toHaveLength(1); expect(first.reservations).toHaveLength(3)
  expect(first.receipts[0]).toMatchObject({ company_id: f.ids.company, environment: 'test',
    source_message_id: f.source.id, message_code: 'E66', raw_hash: createHash('sha256').update(f.source.raw_payload!).digest('hex') })
  assertErrs(f, first, ['SC044-IDE-3'])
  const application = first.acks.filter(row => row.family === 'APERAK' || row.family === 'UTILTS_ERR')
  expect(application).toHaveLength(3); expect(new Set(application.map(row => row.id)).size).toBe(3)
  expect(application.map(row => row.reference).sort()).toEqual(transactions.map(row => row.reference).sort())
  expect([...application.find(row => row.family === 'UTILTS_ERR')!.wire.matchAll(/RFF\+TN:([^']+)'/g)].map(match => match[1])).toEqual(['SC044-IDE-3'])
  for (const [reference, outcome, disposition, bgm] of [
    ['SC044-IDE-1', 'positive', 'accepted', '312'], ['SC044-IDE-2', 'negative', 'guide_rejected', '313'],
  ]) {
    const ack = application.find(row => row.family === 'APERAK' && row.reference === reference)!
    expect(ack).toBeDefined(); expect(ack.outcome).toBe(outcome)
    expect(ack.wire).toContain(`BGM+${bgm}`); expect(ack.wire).toContain(`RFF+ACW:${reference}'`)
    expect([...ack.wire.matchAll(/RFF\+ACW:([^']+)'/g)].map(match => match[1])).toEqual([reference])
    if (outcome === 'positive') expect(ack.wire).toContain('ERC+100::260')
    expect(ack.company).toBe(f.ids.company); expect(ack.operation).toBe(`ediel_ack:${f.source.id}:APERAK:${reference}`)
    expect(ack.policy).toMatchObject({ authority: 'resolveCanonicalEdielPolicy', inheritedFromSourceMessage: true, sourceMessageId: f.source.id })
    expect(first.reservations.find(row => row.transaction === reference)).toMatchObject({
      disposition, plan: `${outcome}_aperak`, final: `${outcome}_aperak`, ack: ack.id })
  }
  const guide = application.find(row => row.reference === 'SC044-IDE-2')!
  expect(guide.wire).toContain('ERC+42::260'); expect(guide.wire).toContain('FTX+AAO++209::260')
  expect(first.reservations.find(row => row.transaction === 'SC044-IDE-2')?.series).toBeNull()
  expect(first.series).toEqual([{ transaction: 'SC044-IDE-1', kind: 'actual' }])
  const stored = () => sql<{ series: Record<string, unknown>[]; values: Record<string, unknown>[]; contracts: Record<string, unknown>[]; immutable: boolean }>(`SELECT jsonb_build_object(
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.meter_reading_series s WHERE s.source_ediel_message_id=${literal(f.source.id)}),
    'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.source_order),'[]') FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_ediel_message_id=${literal(f.source.id)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.transaction_id),'[]') FROM gridex_utilts_binding.contracts c WHERE c.source_message_id=${literal(f.source.id)}),
    'immutable',(SELECT bool_and(s.immutable_hash=encode(extensions.digest(convert_to(s.raw_transaction::text,'UTF8'),'sha256'),'hex')) FROM public.meter_reading_series s WHERE s.source_ediel_message_id=${literal(f.source.id)}))`)
  const data = stored()
  expect(data.series).toHaveLength(1); expect(data.values).toHaveLength(1); expect(data.contracts).toHaveLength(1)
  expect(data.series[0]).toMatchObject({ company_id: f.ids.company, source_ediel_message_id: f.source.id,
    source_transaction_reference: 'SC044-IDE-1', series_kind: 'actual', external_metering_point_id: '735999260731000007',
    raw_transaction: { transactionId: 'SC044-IDE-1', disposition: 'accepted', externalMeteringPointId: '735999260731000007' } })
  expect(data.immutable).toBe(true)
  expect(data.values[0]).toMatchObject({ series_id: data.series[0].id, qualifier: '136', quantity: 500 })
  expect(data.contracts[0]).toMatchObject({ series_id: data.series[0].id, company_id: f.ids.company,
    source_message_id: f.source.id, transaction_id: 'SC044-IDE-1', contract: {
      companyId: f.ids.company, environment: 'test', messageCode: 'E66', transactionId: 'SC044-IDE-1', seriesKind: 'actual' } })
  expect(first.reservations.find(row => row.transaction === 'SC044-IDE-1')?.series).toBe(data.series[0].id)
  // SC-044 requires accepted storage and scoped responses. The existing mixed
  // functional hold of downstream metering/billing is outside this contract.
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
  await f.consume(); expect(snapshot(f.source.id)).toEqual(first); expect(stored()).toEqual(data)
})

for (const [actor, fault, transform] of [
  ['54345', 'UNT count', (raw: string) => raw.replace(/UNT\+\d+\+1'/, "UNT+999+1'")],
  ['54346', 'UNH/UNT reference', (raw: string) => raw.replace(/(UNT\+\d+\+)1'/, "$1OTHER'")],
] as const) it(`actual direct consumer refuses ${fault} before application responses or accepted storage on stable retry`, async () => {
  const transactions: UtiltsAckFixtureTransaction[] = [{ reference: `SYNTAX-${actor}-IDE`, outcome: 'accepted' }]
  const f = await seed(actor, transactions)
  expect(validateEdifactSyntax(f.source).ok).toBe(true)
  await f.consume()
  const control = snapshot(f.source.id)
  expect(control.series).toHaveLength(1)
  expect(control.acks.filter(row => row.family === 'APERAK')).toMatchObject([{ outcome: 'positive', reference: transactions[0].reference }])
  sinks.meter.mockClear(); sinks.bill.mockClear(); sinks.complete.mockClear()

  // Alter only the trailer after the valid fixture calculated its count. The
  // native helper changes UNB/UNZ references only; it does not repair this fault.
  // Give the new source its own physical IDE so the previously committed
  // control series cannot satisfy or obscure this syntax-refusal oracle.
  const ownTransactions: UtiltsAckFixtureTransaction[] = [{ reference: `SYNTAX-${actor}-NEW`, outcome: 'accepted' }]
  const unprocessedControl = await f.insertSource(ownTransactions)
  expect(validateEdifactSyntax(unprocessedControl).ok).toBe(true)
  expect(snapshot(unprocessedControl.id)).toMatchObject({ series: [], contracts: [], reservations: [] })
  const malformed = await f.insertSource(ownTransactions, transform)
  expect(validateEdifactSyntax(malformed).ok).toBe(false)
  expect(snapshot(malformed.id).series).toEqual([])
  await f.consume(malformed)
  const first = snapshot(malformed.id)
  await f.consume(malformed)
  expect(snapshot(malformed.id)).toEqual(first)
  expect(first, 'direct syntax rejection must precede persistent accepted effects').toMatchObject({ series: [], contracts: [], outbox: [] })
  expect(first.reservations.filter(row => row.disposition === 'accepted')).toEqual([])
  expect(first.acks.filter(row => row.family === 'APERAK' || row.family === 'UTILTS_ERR')).toEqual([])
  expect(first.acks.filter(row => row.family === 'CONTRL')).toMatchObject([{ outcome: 'negative', company: f.ids.company }])
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
})

it('SC-045 actual header rejection emits one message-scope U-APERAK without invented ACW or later functional effects and retries stably', async () => {
  const transactions: UtiltsAckFixtureTransaction[] = [
    { reference: 'SC045-IDE-1', outcome: 'accepted' },
    { reference: 'SC045-IDE-2', outcome: 'processability_rejected' },
  ]
  const f = await seed('54347', transactions)
  const controlRuntime = runUtiltsRuntimeForMessage(f.source)
  expect(controlRuntime.transactionDispositions.map(row => row.disposition)).toEqual(['accepted', 'processability_rejected'])
  await f.consume()
  const control = snapshot(f.source.id)
  expect(control.series).toEqual([{ transaction: 'SC045-IDE-1', kind: 'actual' }])
  assertErrs(f, control, ['SC045-IDE-2'])

  const missingTimezone = await f.insertSource(transactions, raw => {
    const headerRemoved = raw.replace(/^DTM\+735:[^\n]*\n/m, '')
    expect(headerRemoved).not.toBe(raw)
    const segments = tokenizeEdifact(headerRemoved).segments
    const count = segments.findIndex(row => row.tag === 'UNT') - segments.findIndex(row => row.tag === 'UNH') + 1
    return headerRemoved.replace(/UNT\+\d+\+1'/, `UNT+${count}+1'`)
  })
  expect(validateEdifactSyntax(missingTimezone).ok).toBe(true)
  const runtime = runUtiltsRuntimeForMessage(missingTimezone)
  expect(runtime.validation.issues.filter(issue => issue.kind === 'functional')).toEqual([])
  expect(runtime.ackPlan.aperakApplicationErrors).toMatchObject([{ ercCode: '41', fieldCode: '206' }])
  sinks.meter.mockClear(); sinks.bill.mockClear(); sinks.complete.mockClear()
  await f.consume(missingTimezone)
  const first = snapshot(missingTimezone.id)
  await f.consume(missingTimezone)
  expect(snapshot(missingTimezone.id)).toEqual(first)
  expect(first).toMatchObject({ series: [], contracts: [], outbox: [] })
  expect(first.reservations.filter(row => row.disposition === 'accepted')).toEqual([])
  expect(first.acks.filter(row => row.family === 'UTILTS_ERR')).toEqual([])
  const application = first.acks.filter(row => row.family === 'APERAK')
  expect(application, 'one header outcome must not become per-IDE negative APERAKs').toHaveLength(1)
  expect(application[0]).toMatchObject({ outcome: 'negative', scope: 'message', reference: null, company: f.ids.company,
    policy: { authority: 'resolveCanonicalEdielPolicy', inheritedFromSourceMessage: true, sourceMessageId: missingTimezone.id } })
  expect(application[0].wire).toContain('BGM+313'); expect(application[0].wire).toContain('ERC+41::260')
  expect(application[0].wire).toContain('FTX+AAO++206::260'); expect(application[0].wire).not.toContain('RFF+ACW:')
  expect(application[0].wire).toContain('APERAK:D:04A:UN:E5SE5A')
  expect(application[0].wire).toContain("DOC+E66:SVK:260+GRIDEX2607E66MSG001'")
  const currentReferences = [...application[0].wire.matchAll(/RFF\+DM:([^']+)'/g)].map(match => match[1])
  expect(currentReferences).toHaveLength(1); expect(currentReferences[0]).toBeTruthy()
  // Internal finalization is an implementation requirement for the same source
  // header outcome; it does not invent an original physical ACW on the wire.
  expect(first.reservations).toHaveLength(transactions.length)
  for (const reservation of first.reservations) {
    expect(reservation).toMatchObject({ disposition: 'guide_rejected', final: 'negative_aperak', ack: application[0].id, series: null })
    expect(reservation.row.finalized_at).toBeTruthy()
  }
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
})

it('committed first ERR and reservation survive an interruption before second ACK, then converge without rewriting', async () => {
  const references = ['RETRY-NATIVE-ERR-A', 'RETRY-NATIVE-ERR-B']
  const f = await seed('54342', references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const create = database.createEdielMessage
  const interruption = vi.spyOn(database, 'createEdielMessage').mockImplementation(async input => {
    if (input.messageFamily === 'UTILTS_ERR' && input.parsedPayload?.relatedTransactionReference === references[1]) {
      throw Error('synthetic_interruption_before_second_err_insert')
    }
    return create(input)
  })
  await expect(f.consume()).rejects.toThrow('synthetic_interruption_before_second_err_insert')
  const interrupted = snapshot(f.source.id)
  assertErrs(f, interrupted, [references[0]])
  expect(interrupted.reservations.find(row => row.transaction === references[1])).toMatchObject({ final: null, ack: null, series: null })
  expect(interrupted.series).toEqual([])
  interruption.mockRestore()
  await f.consume()
  const completed = snapshot(f.source.id)
  assertErrs(f, completed, references)
  const committed = interrupted.acks.find(row => row.family === 'UTILTS_ERR')!
  expect(completed.acks.find(row => row.id === committed.id)).toEqual(committed)
  expect(completed.reservations.find(row => row.transaction === references[0])).toEqual(interrupted.reservations.find(row => row.transaction === references[0]))
  await f.consume()
  expect(snapshot(f.source.id)).toEqual(completed)
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
})

it('real native gateway distinguishes same-code IDEs once drafts satisfy canonical process semantics', async () => {
  const references = ['DIRECT-NATIVE-SHARED-IDE-A', 'DIRECT-NATIVE-SHARED-IDE-B']
  const f = await seed('54343', references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS_ERR', messageCode: 'ERR', direction: 'outbound',
    referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', mode: 'catalog_evidence' })
  const create = async (reference: string) => {
    const draft = buildUtiltsErrDraft({ actorUserId: f.ids.actor, sourceMessage: f.source, messageText: 'E87', relatedTransactionReference: reference })
    // Diagnostic isolation of the duplicate key; consumer cases above use the
    // unchanged builder directly and independently verify process ownership.
    draft.processType = policy.processGroup
    return createCanonicalAckMessage({ actorUserId: f.ids.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
  }
  const first = await create(references[0]), second = await create(references[1])
  expect(second.id).not.toBe(first.id)
  expect(second.raw_payload).toContain(`RFF+TN:${references[1]}'`)
  expect((await create(references[0])).id).toBe(first.id)
  expect((await create(references[1])).id).toBe(second.id)
  expect(snapshot(f.source.id).acks).toHaveLength(2)
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
})
