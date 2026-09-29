import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture, type UtiltsAckFixtureTransaction } from '../__tests__/helpers/utiltsErrGatewayFixture'
import { utiltsNativeSourceFixture } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
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
  const insertSource = async (ownTransactions: UtiltsAckFixtureTransaction[]) => {
    const fixture = utiltsErrGatewayFixture({ company: ids.company, receiver: actorEdielId, transactions: ownTransactions })
    const { id, raw, parsed } = utiltsNativeSourceFixture(fixture.raw_payload!, randomUUID())
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
  acks: { id: string; family: string; outcome: string; reference: string; wire: string; process: string; company: string; operation: string; policy: Record<string, unknown>; createdAt: string; updatedAt: string }[]
  reservations: { transaction: string; disposition: string; plan: string; final: string | null; ack: string | null; series: string | null; row: Record<string, unknown> }[]
  receipts: unknown[]
  series: { transaction: string; kind: string }[]
  outbox: unknown[]
  contracts: unknown[]
}
function snapshot(source: string): Snapshot {
  return sql(`SELECT jsonb_build_object(
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'reference',parsed_payload->>'relatedTransactionReference','wire',raw_payload,'process',process_type,'company',company_id,'operation',source_operation_id,'policy',rule_pack_snapshot,'createdAt',created_at,'updatedAt',updated_at) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(source)}),
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
