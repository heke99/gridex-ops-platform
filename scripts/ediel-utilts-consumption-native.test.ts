import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from '../__tests__/helpers/utiltsObservationHandoff'
import { e72PointRequestMessage } from '../__tests__/helpers/utiltsE72PointRequest'
import { utiltsNativeSourceFixture, utiltsRecountUnt, utiltsTestEnvironmentWire } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, finalizeUtiltsTransactionAck, persistUtiltsTransactionResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { ingestBoundUtiltsMetering, createBoundUtiltsBilling } from '@/lib/ediel/utilts/consumptionSinks'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, seedUtiltsConsumptionParties, setUtiltsReceiverRole, seedUtiltsIssuerHistoryGround, receiveUtiltsRetry } from './helpers/utiltsConsumptionParties'
import { committedPersistenceBody, type PersistenceCatalogReceipt } from './helpers/utiltsPersistenceCatalog'
const forgedRefusal /* canonical transaction owner refuses a forged payload first */ = (specific: string) => new RegExp(`utilts_(${specific}|transaction_owner_(evidence_required|outcome_mismatch))`), ownIdentity /* a derived source is a new original: own field 505 per issuer */ = (raw: string) => raw.replaceAll('GRIDEX2607E66001', `D${randomUUID().replaceAll('-', '').slice(0, 15)}`)

// Real parser, canonical policy, preparation, service HTTP RPC, SQL, stored
// contract validation and both sink adapters. Only final external writes are
// observed, allowing the crash boundary between persistence and consumption.
const effects = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), ack: vi.fn(), complete: vi.fn(), outbound: vi.fn(), status: vi.fn(), readRaw: null as string | null }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: effects.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(), ingestBillingUnderlay: effects.bill,
  syncGridOwnerDataRequestReceivedFromEdiel: effects.complete, findOpenOutboundBySource: effects.outbound }))
vi.mock('@/lib/ediel/core/kernel', async original => ({ ...await original<Record<string, unknown>>(), createCanonicalAckMessage: effects.ack }))
vi.mock('@/lib/ediel/db', async original => {
  const actual = await original<typeof import('@/lib/ediel/db')>()
  return { ...actual, linkEdielMessage: vi.fn(), createEdielMessageEvent: vi.fn(), updateEdielMessageStatus: effects.status,
    getEdielMessageById: async (id: string) => {
      const row = await actual.getEdielMessageById(id)
      return row && effects.readRaw !== null ? { ...row, raw_payload: effects.readRaw } : row
    } }
})

// Exact seven-argument prospective RPC until genuine regenerated metadata is
// imported. This leaves every poisoned raw/contract payload unchanged.
const nativePersistenceRpc = supabaseService.rpc.bind(supabaseService) as unknown as (
 name: 'gridex_persist_utilts_consumption_v1', args: { p_company_id: string; p_environment: string; p_source_message_id: string;
 p_message_code: string; p_raw_payload: string; p_transactions: unknown; p_actor_user_id?: string | null },
) => PromiseLike<{ data: unknown; error: { message: string; code: string } | null }>
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit = (value: unknown) => value === null ? 'NULL' : "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T = unknown>(input: string, maxBuffer = 2000000): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_local_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000, maxBuffer }).trim()
  // Unwrapped PostgreSQL booleans use t/f in unaligned text output. JSONB
  // booleans already use true/false; keep every other result strict JSON.
  if (result === 't' || result === 'f') return (result === 't') as T
  return result ? JSON.parse(result) as T : undefined as T
}
async function seed() {
  const ids = { source: randomUUID(), company: randomUUID(), customer: randomUUID(), point: randomUUID(), site: randomUUID(), grid: randomUUID(), request: randomUUID(), actor: randomUUID(), ediel: '', issuer: '' }
  const { ediel, issuer } = seedUtiltsConsumptionParties(sql, lit, ids.actor)
  const message = energyHandoffMessage('2026-10-01', ids.company)
  message.id = ids.source; message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replaceAll('260831181101', ids.source.slice(0, 12).replaceAll('-', ''))
    .replace('+21660:ZZ+', `+${ediel}:ZZ+`).replace('NAD+MR+21660:SVK:260', `NAD+MR+${ediel}:SVK:260`)
    .replace('+91100:ZZ+', `+${issuer}:ZZ+`).replace('NAD+MS+91100:SVK:260', `NAD+MS+${issuer}:SVK:260`)
  if (message.raw_payload.includes('21660') || message.raw_payload.includes('91100')) throw new Error('native_consumption_parties_unbound')
  ids.ediel = ediel; ids.issuer = issuer
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'E035 bound consumption synthetic','active');
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
   VALUES(${lit(ids.actor)},'authenticated','authenticated',${lit(`e035-retry-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
   VALUES(${lit(ids.actor)},${lit(`e035-retry-${ids.actor}@example.invalid`)},'Synthetic E035 retry actor','active',now(),now()) ON CONFLICT(id) DO UPDATE SET user_status='active';
   -- Declared local operator uses the genuine current membership/permission
   -- tables. No admin exemption or verified-source fixture grants authority.
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${lit(ids.company)},${lit(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${lit(ids.actor)},${lit(ids.company)},id,key FROM public.permissions
    WHERE key IN('metering.write','communication.read','communication.write','communication.send');
   INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) SELECT ${lit(ids.company)},e,'electricity',true,clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'EdielId',${lit(ediel)},clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','private');
   INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${lit(ids.grid)},${lit(ids.company)},${lit(ids.grid)},${lit(ids.issuer)},'test',true,'active');
   INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},'735999260731000007','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(ids.request)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'billing_underlay');`)
  const insertSource = async (raw: string, code = 'E66', environment = 'test', receivedAt = '2026-10-01T20:00:00Z' /* inside the 25-A-3 grace */) => {
    // Template parties are bound to this fixture's own receiver and issuer.
    raw = raw.replaceAll('+91100:ZZ+', `+${ids.issuer}:ZZ+`).replaceAll('NAD+MS+91100:', `NAD+MS+${ids.issuer}:`)
      .replaceAll('+21660:ZZ+', `+${ids.ediel}:ZZ+`).replaceAll('NAD+MR+21660:', `NAD+MR+${ids.ediel}:`)
    setUtiltsReceiverRole(sql, lit, ids.company, ids.actor, code)
    // Each inserted source is a new issued message with its own BGM 1004 reference.
    const sourceId = randomUUID(); raw = raw.replace(/(BGM\+[^+']*\+)[^+']+/, `$1M${sourceId.replaceAll('-', '').slice(0, 20)}`)
    const fixture = utiltsNativeSourceFixture(utiltsRecountUnt(environment === 'test' ? utiltsTestEnvironmentWire(raw) : raw.replace(/(UNB\+[^']*)\+\+1'/, "$1'") /* production: no UNB test flag */), sourceId)
    const { id, parsed } = fixture
    raw = fixture.raw
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${lit(id)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},${lit(ids.request)},${lit(environment)},'inbound','edifact','UTILTS',${lit(code)},'received',${lit(raw)},'{}',${lit(receivedAt)},'{}',${lit(parsed.applicationReference)},${lit(ids.issuer)},${lit(ids.ediel)},${lit(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code=${lit(code)} AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
    seedUtiltsIssuerHistoryGround(sql, lit, id, ids.actor)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
    expect(error).toBeNull()
    await recordUtiltsTechnicalReception(data as unknown as EdielMessageRow, ids.actor)
    return data as unknown as EdielMessageRow
  }
  const original = await insertSource(message.raw_payload!)
  const dataRequest = { id: ids.request, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point, grid_owner_id: ids.grid, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  const recorded = new Map<string, Awaited<ReturnType<typeof recordUtiltsFinalRuntime>>>()
  const prepare = async (source = original, held = false, allowConsumption = true): Promise<UtiltsBoundPersistenceInput & { actorUserId: string }> => {
    const policy = resolveCanonicalMessagePolicy(source)!
    // Production order (utiltsDataRequest.part-2): the structurally qualified
    // runtime is recorded as the canonical final decision once per source, and
    // the same runtime drives every persistence payload for that source.
    if (!recorded.has(source.id)) recorded.set(source.id, await recordUtiltsFinalRuntime(source))
    const runtime = { ...recorded.get(source.id)! }
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    if (held) runtime.transactionDispositions = runtime.transactionDispositions.map(d => ({ ...d, disposition: 'internal_review', responseType: 'none', issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'] }))
    const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: ids.point, customerId: ids.customer, siteId: ids.site, gridOwnerId: ids.grid, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
    const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest: allowConsumption ? dataRequest : null,
      fallback: { customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point, gridOwnerId: ids.grid }, allowConsumption })
    return { actorUserId: ids.actor, companyId: ids.company, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
      transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  }
  return { ids, original, insertSource, prepare, dataRequest }
}
beforeEach(() => {
  vi.clearAllMocks()
  effects.readRaw = null
  effects.status.mockResolvedValue(null); effects.complete.mockResolvedValue(null); effects.outbound.mockResolvedValue(null)
  effects.ack.mockImplementation(async ({ sourceMessage }: { sourceMessage: EdielMessageRow }) => ({ id: sourceMessage.id }))
  effects.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'observed-meter' } })
  effects.bill.mockResolvedValue({ id: 'observed-underlay' })
})
it.each(['quantity', 'timezone', 'resolution-format'])('full processor persisted interruption rejects actual runtime %s retry before ACK/completion or sinks', async kind => {
  const f = await seed()
  effects.status.mockRejectedValueOnce(new Error('synthetic_interruption_after_committed_persistence'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_committed_persistence')
  const before = snapshot(f.original.id)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(f.original.id)}`)).toBe(1)
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const original = f.original.raw_payload!
  const changed = kind === 'quantity' ? original.replace('QTY+136:500', 'QTY+136:999')
    : kind === 'timezone' ? original.replace('?+0100:406', '?+0200:406') : original.replace('15:806', '15:805')
  const runtime = runUtiltsRuntimeForMessage({ ...f.original, raw_payload: changed })
  expect(runtime.validation.ok).toBe(true)
  await expect(createInboundEdielMessage({ companyId: f.ids.company, environment: 'test', actorUserId: f.ids.actor, ...receiveUtiltsRetry(sql, lit, { companyId: f.ids.company, actorUserId: f.ids.actor, raw: changed, parsed: parseInboundEmailContent({ attachmentText: changed })! }), parsed: parseInboundEmailContent({ attachmentText: changed })! })).rejects.toThrow('same_identity_different_original_requires_review')
  // A read-to-persist race must also fail even if a stale upstream snapshot
  // bypassed the natural dedup call: the initial owner is bound to the locked bytes.
  effects.readRaw = changed
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('ediel_initial_utilts_owner_unavailable')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled(); expect(effects.outbound).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  effects.readRaw = null
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(replay.ingestedMeterValueIds).toEqual(['observed-meter'])
  expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '500', periodStart: '2026-06-30T23:00:00.000Z' }))
  expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '500', underlayMonth: 6 }))
  expect(effects.complete).toHaveBeenCalledTimes(1)
  expect(effects.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK')).toBe(true)
})
function snapshot(source: string) {
  return sql(`SELECT jsonb_build_object('acks',(SELECT jsonb_agg(to_jsonb(a)) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${lit(source)}),
   'series',(SELECT jsonb_agg(to_jsonb(s)) FROM public.meter_reading_series s WHERE source_ediel_message_id=${lit(source)}),
   'contracts',(SELECT jsonb_agg(to_jsonb(c)) FROM gridex_utilts_binding.contracts c WHERE source_message_id=${lit(source)}))`)
}
it('real persisted interruption + natural changed-byte dedup cannot consume old success, identical retry consumes stored content', async () => {
  const f = await seed(), input = await f.prepare()
  const first = await persistUtiltsTransactionResults(input), before = snapshot(f.original.id)
  expect(first[0].consumptionContract?.observations[0].quantity).toBe('500')
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const changed = f.original.raw_payload!.replace('QTY+136:500', 'QTY+136:999')
  await expect(createInboundEdielMessage({ companyId: f.ids.company, environment: 'test', actorUserId: f.ids.actor, ...receiveUtiltsRetry(sql, lit, { companyId: f.ids.company, actorUserId: f.ids.actor, raw: changed, parsed: parseInboundEmailContent({ attachmentText: changed })! }), parsed: parseInboundEmailContent({ attachmentText: changed })! })).rejects.toThrow('same_identity_different_original_requires_review')
  await expect(f.prepare({ ...f.original, raw_payload: changed }).then(persistUtiltsTransactionResults)).rejects.toThrow('utilts_consumption_binding_conflict:physical_quantity_membership')
  expect((await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', { p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: f.original.id, p_message_code: 'E66', p_raw_payload: changed, p_actor_user_id: f.ids.actor, p_transactions: input.transactions.map((t, i) => ({ ...t, consumptionContract: input.contracts[i] })) })).error?.message).toMatch(/utilts_source_binding_conflict/)
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const replay = await persistUtiltsTransactionResults(input)
  expect(replay[0].seriesId).toBe(first[0].seriesId); expect(replay[0].idempotentReplay).toBe(true)
  replay[0].consumptionContract!.observations[0].quantity = 999
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: replay })
  await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: replay, existingBillingUnderlayId: null })
  expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '500', periodStart: '2026-06-30T23:00:00.000Z' }))
  expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '500', underlayMonth: 6, underlayYear: 2026 }))
  expect(snapshot(f.original.id)).toEqual(before)
})
it.each(['quantity', 'timezone', 'resolutionFormat', 'customer', 'request', 'point', 'billing-period', 'unknown-version'])('native immutable comparison rejects %s without replacing ACK/series/contract', async kind => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input); const before = snapshot(f.original.id)
  const changed = structuredClone(input), c = changed.contracts[0]
  if (kind === 'quantity') c.observations[0].quantity = 999
  if (kind === 'timezone') { c.interpretation.offsetMinutes = 120; c.interpretation.timezoneRaw = '+0200'; c.observations[0].periodStart = '2026-06-30T22:00:00.000Z'; c.observations[0].periodEnd = c.observations[0].readAt = '2026-06-30T22:15:00.000Z' }
  if (kind === 'resolutionFormat') { c.interpretation.resolutionFormat = '805'; c.observations[0].resolution = 'PT15H' }
  if (kind === 'customer') c.metering.customerId = randomUUID()
  if (kind === 'request') c.billing.sourceRequestId = randomUUID()
  if (kind === 'point') c.metering.meteringPointId = randomUUID()
  if (kind === 'billing-period') { c.billing.periodEnd = '2026-07-01T00:00:00.000Z'; c.billing.month = 7 }
  if (kind === 'unknown-version') Object.assign(c, { version: 2 })
  await expect(persistUtiltsTransactionResults(changed)).rejects.toThrow(/utilts_(consumption|transaction_persistence)/)
  expect(snapshot(f.original.id)).toEqual(before)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
})
it('bound held source releases only on identical bytes and membership', async () => {
  const f = await seed(), held = await f.prepare(f.original, true)
  const first = await persistUtiltsTransactionResults(held), again = await persistUtiltsTransactionResults(held)
  expect(first[0].persistenceStatus).toBe('not_applicable'); expect(again[0].sourceBinding).toEqual(first[0].sourceBinding)
  expect(await persistUtiltsTransactionResults(await f.prepare())).toMatchObject([{ persistenceStatus: 'persisted' }])
  const { error } = await supabaseService.from('ediel_messages').update({ raw_payload: f.original.raw_payload!.replace('500', '999') }).eq('id', f.original.id)
  expect(error?.code).toBe('P0U01')
  const status = await supabaseService.from('ediel_messages').update({ failure_reason: 'diagnostic-only' }).eq('id', f.original.id)
  expect(status.error).toBeNull()
})
it.each(['accepted', 'internal_review'])('unbound historical %s evidence cannot acquire a present-day seal', async disposition => {
  const f = await seed(), input = await f.prepare()
  sql(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status)
   VALUES(${lit(f.ids.company)},'test',${lit(f.original.id)},'GRIDEX2607E66001','positive','positive','pending',${lit(disposition)},${lit(disposition === 'accepted' ? 'positive_aperak' : 'none')},'not_applicable');`)
  const before = snapshot(f.original.id)
  await expect(persistUtiltsTransactionResults(input)).rejects.toThrow('utilts_historical_binding_unavailable')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(f.original.id)}`)).toBe(0)
})
it('same-issuer resend of field 505 is a duplicate identity, a new correction preserves exact noncurrent replay', async () => {
  const f = await seed(), input = await f.prepare(), first = await persistUtiltsTransactionResults(input)
  const copy = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'COPY'+f.original.interchange_reference!))
  expect((await recordUtiltsFinalRuntime(copy)).validation.issues.map(issue => issue.code)).toContain('UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE') // identities hold over time
  const correction = await f.insertSource(f.original.raw_payload!.replaceAll('GRIDEX2607E66001', 'CORRECTION').replaceAll(f.original.interchange_reference!, 'COR'+f.original.interchange_reference!).replace('QTY+136:500', 'QTY+136:501'))
  expect((await persistUtiltsTransactionResults(await f.prepare(correction)))[0].seriesId).not.toBe(first[0].seriesId)
  expect(sql(`SELECT is_current FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)).toBe(false)
  expect((await persistUtiltsTransactionResults(input))[0].seriesId).toBe(first[0].seriesId)
})
it.each(['before', 'after'] as const)('mixed physical LOC+175 %s LOC+172 cannot acquire a point consumption receipt or ACK reservation', async order => {
  const f = await seed(), supported = await f.prepare()
  const point = "LOC+172+735999260731000007::9'"
  const object = "LOC+175+735999260731000007::9'"
  const raw = f.original.raw_payload!
    .replace(point, order === 'before' ? `${object}\n${point}` : `${point}\n${object}`)
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  const source = await f.insertSource(raw)
  const physical = (message: EdielMessageRow) => sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(
   gridex_utilts_binding.wire_tokens_v1(${lit(message.raw_payload)}),'GRIDEX2607E66001')),'null'::jsonb)`)
  expect(physical(f.original)).toBe('735999260731000007')
  expect(physical(source)).toBeNull()
  // The service RPC is a separate authority boundary. A caller can supply a
  // previously prepared point contract despite the application's LOC+175 hold.
  const forged = { ...supported, sourceMessageId: source.id, rawPayload: source.raw_payload! }
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(forged)).rejects.toThrow(forgedRefusal('consumption_identity_unsupported'))
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  }
  expect(effects.ack).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  expect((await persistUtiltsTransactionResults(supported))[0].persistenceStatus).toBe('persisted')
})
it('a misplaced LOC+175 after SEQ cannot acquire a point or object-shaped positive reservation', async () => {
  const f = await seed(), supported = await f.prepare()
  const raw = f.original.raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+175+735999260731000007::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  const source = await f.insertSource(raw)
  const tokens = `gridex_utilts_binding.wire_tokens_v1(${lit(source.raw_payload)})`
  expect(sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(${tokens},'GRIDEX2607E66001')),'null'::jsonb)`)).toBeNull()
  expect(sql<boolean>(`SELECT gridex_utilts_binding.unowned_regulating_object_v1(${tokens},'GRIDEX2607E66001')`)).toBe(true)
  const forged = { ...supported, sourceMessageId: source.id, rawPayload: source.raw_payload! }
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(forged)).rejects.toThrow(/utilts_(consumption_identity_unsupported|regulating_object_owner_unavailable)/)
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  }
  const processed = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(processed.ingestedMeterValueIds).toEqual([])
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  // A source-qualified technical CONTRL may acknowledge interchange syntax;
  // this held transaction must not produce a positive market ACK.
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(effects.meter).not.toHaveBeenCalled()
  expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(before)
  expect((await persistUtiltsTransactionResults(supported))[0].persistenceStatus).toBe('persisted')
})
it('a second physical LOC+172 after SEQ cannot reserve a point or link its source on retry', async () => {
  const f = await seed(), supported = await f.prepare()
  const raw = f.original.raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+172+735999260731000014::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  const source = await f.insertSource(raw)
  const tokens = `gridex_utilts_binding.wire_tokens_v1(${lit(source.raw_payload)})`
  expect(sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(${tokens},'GRIDEX2607E66001')),'null'::jsonb)`)).toBeNull()
  const forged = { ...supported, sourceMessageId: source.id, rawPayload: source.raw_payload! }
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(forged)).rejects.toThrow(forgedRefusal('consumption_identity_unsupported'))
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  }
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(before)
  expect((await persistUtiltsTransactionResults(supported))[0].persistenceStatus).toBe('persisted')
})
it('an S01 point with a second LOC+172 after SEQ holds its final ACK and series on retry', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace("SEQ++1'", "SEQ++1'\nLOC+172+735999260731000014::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  const source = await f.insertSource(ownIdentity(raw), 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect((await run()).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
})
it.each(['object-first', 'point-first'] as const)(
  'native mixed S01 %s object and late second-LOC+172 point reserve neither ACK nor series on retry', async order => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(start, end)
  const second = point.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  const object = (order === 'object-first' ? point : second).map(line =>
    line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9'))
  const sibling = order === 'object-first' ? second : point
  const seq = sibling.findIndex(line => line.startsWith('SEQ+'))
  sibling.splice(seq + 1, 0, "LOC+172+735999260731000014::9'")
  lines.splice(start, end - start, ...(order === 'object-first' ? [...object, ...sibling] : [...sibling, ...object]))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  const raw = lines.join('\n').replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  expect(runUtiltsRuntimeForMessage(source).transactionDispositions.map(item => item.disposition)).toEqual(['accepted', 'accepted'])
  const pointId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  const tokens = `gridex_utilts_binding.wire_tokens_v1(${lit(source.raw_payload)})`
  expect(sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(${tokens},${lit(pointId)})),'null'::jsonb)`)).toBeNull()
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect((await run()).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id) ORDER BY source_transaction_id)
   FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`)).toEqual([
    { disposition: 'internal_review', plan: 'none', final: null, series: null },
    { disposition: 'internal_review', plan: 'none', final: null, series: null },
  ])
  // The source receipt seals the original and physical IDE membership even
  // when both transaction dispositions are held without market effects.
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  const receipt = () => sql(`SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(source.id)}`)
  const beforeReceipt = receipt()
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(receipt()).toEqual(beforeReceipt)
})
it('native S01 valid LOC+175 cannot reserve a point series or positive ACK through a forged service RPC', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9').replaceAll('GRIDEX2607E66001', 'S01OBJECT001')
  const source = await f.insertSource(raw, 'S01')
  const prepared = await f.prepare(source, false, false)
  expect(prepared.transactions[0]).toMatchObject({ disposition: 'accepted', meteringPointId: null, externalMeteringPointId: null })
  const forged = structuredClone(prepared)
  forged.transactions[0].meteringPointId = f.ids.point
  forged.transactions[0].externalMeteringPointId = '735999260731000007'
  const wrongTenant = { ...forged, companyId: randomUUID() }
  await expect(persistUtiltsTransactionResults(wrongTenant)).rejects.toThrow('utilts_execution_actor_forbidden')
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(forged)).rejects.toThrow('utilts_regulating_object_owner_unavailable')
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  }
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  expect((await persistUtiltsTransactionResults(await f.prepare()))[0]).toMatchObject({ disposition: 'accepted', persistenceStatus: 'persisted' })
})
it('native S01 empty contract cannot turn an agency-89 point into positive aggregate authority', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S').replaceAll('GRIDEX2607E66001', 'S01EMPTY001')
  const clean = await f.insertSource(raw, 'S01')
  const input = await f.prepare(clean, false, false)
  expect(input.transactions[0]).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak', externalMeteringPointId: '735999260731000007' })
  expect(input.contracts[0].observations).toEqual([])
  const unsupported = await f.insertSource(clean.raw_payload!.replace('735999260731000007::9', '735999260731000007::89'), 'S01')
  const tokens = `gridex_utilts_binding.wire_tokens_v1(${lit(unsupported.raw_payload)})`
  expect(sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(${tokens},${lit(input.transactions[0].transactionId)})),'null'::jsonb)`)).toBeNull()
  const forged = { ...input, sourceMessageId: unsupported.id, rawPayload: unsupported.raw_payload! }
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(forged)).rejects.toThrow(forgedRefusal('consumption_identity_unsupported'))
    expect(snapshot(unsupported.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(unsupported.id)}`)).toBe(0)
  }
  // S01 is an aggregate outcome: the actual nonbilling processor must not
  // receive the individual customer/site/request links used by E66 fixtures.
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(unsupported.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  expect((await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: unsupported.id })).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id))
    FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(unsupported.id)}`))
    .toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(unsupported.id)}`)).toBe(0)
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect((await persistUtiltsTransactionResults(input))[0]).toMatchObject({ disposition: 'accepted', persistenceStatus: 'persisted' })
})
it('native E72 empty request refuses unowned agency 89 atomically and preserves actual held/positive retries', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(e72PointRequestMessage(f.ids.company, '89').raw_payload!), 'E72')
  const input = await f.prepare(source, false, false)
  expect(input.transactions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak', seriesKind: 'request', quantities: [] }])
  expect(input.contracts[0].observations).toEqual([])
  const tokens = `gridex_utilts_binding.wire_tokens_v1(${lit(source.raw_payload)})`
  expect(sql<string | null>(`SELECT coalesce(to_jsonb(gridex_utilts_binding.supported_point_v1(${tokens},${lit(input.transactions[0].transactionId)})),'null'::jsonb)`)).toBeNull()
  await expect(persistUtiltsTransactionResults({ ...input, companyId: randomUUID() })).rejects.toThrow('utilts_transaction_persistence_failed:utilts_source_binding_conflict') // tenant-scoped source before actor
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(persistUtiltsTransactionResults(input)).rejects.toThrow('utilts_consumption_identity_unsupported')
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
    expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  }
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = (id: string) => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: id })
  expect((await run(source.id)).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('tenant',company_id,'disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id))
    FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ tenant: f.ids.company, disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(snapshot(source.id)).toMatchObject({ series: null, contracts: null })
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  const before = snapshot(source.id)
  const receipt = sql(`SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(source.id)}`)
  expect(receipt).toBeTruthy()
  expect((await run(source.id)).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(sql(`SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(source.id)}`)).toEqual(receipt)
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  effects.ack.mockClear()
  const clean = await f.insertSource(ownIdentity(e72PointRequestMessage(f.ids.company).raw_payload!), 'E72')
  expect((await run(clean.id)).internalReviewRequired).toBe(false)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('tenant',company_id,'disposition',disposition,'plan',planned_response_type,'final',final_response_type))
    FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(clean.id)}`))
    .toEqual([{ tenant: f.ids.company, disposition: 'accepted', plan: 'positive_aperak', final: 'positive_aperak' }])
  expect(effects.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK' && call.outcome === 'positive')).toBe(true)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(clean.id)} AND series_kind='request'`)).toBe(1)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(clean.id)} AND contract->'observations'='[]'::jsonb`)).toBe(1)
  const cleanBefore = snapshot(clean.id)
  await run(clean.id)
  expect(snapshot(clean.id)).toEqual(cleanBefore)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
})
it.each(['missing', 'invalid-gs1', 'invalid-agency'] as const)('native E72 %s LOC+172 retains a guide-negative ACK and byte-stable retry without point effects', async defect => {
  const f = await seed()
  const raw = e72PointRequestMessage(f.ids.company).raw_payload!
    .replace("LOC+172+735999260731000007::9'", defect === 'missing' ? '' : defect === 'invalid-gs1' ? "LOC+172+735999260731000008::9'" : "LOC+172+735999260731000007::160'")
    .replace('UNT+14+1', defect === 'missing' ? 'UNT+13+1' : 'UNT+14+1')
  const source = await f.insertSource(raw, 'E72', 'test', '2026-10-15T20:00:00Z') // strict 25-A-4
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect((await run()).internalReviewRequired).toBe(false)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id))
    FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ disposition: 'guide_rejected', plan: 'negative_aperak', final: 'negative_aperak', series: null }])
  expect(snapshot(source.id)).toMatchObject({ series: null, contracts: null })
  const aperak = effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0]
  expect(aperak).toMatchObject({ outcome: 'negative' })
  expect(JSON.stringify(aperak?.draft)).toContain('209')
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily !== 'UTILTS_ERR' && !(call.ackFamily === 'APERAK' && call.outcome === 'positive'))).toBe(true)
  const before = snapshot(source.id)
  await run()
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
})
it('native inbound E73 (outbound-only in the source catalog) is held before receipt, positive ACK or effect, also on retry', async () => {
  const f = await seed()
  const cleanRaw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+E73::260')
    .replace('23-DDQ-E66-T', '23-DDQ-E66-S').replaceAll('GRIDEX2607E66001', 'E73POINT001')
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('../lib/ediel/flows/utiltsInboundPolicyProcessor')
  for (const raw of [cleanRaw, cleanRaw.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000007::89')]) {
    const source = await f.insertSource(raw, 'E73')
    // E73 is sent by suppliers to grid owners; this platform never receives it.
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source)
    expect(decision.applicationDecision).toBe('manual_review')
    expect(decision.decisionTrace.at(-1)).toContain('canonical_source_direction_not_allowed:E73:inbound:outbound')
    const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
    expect((await run()).internalReviewRequired).toBe(true)
    const before = snapshot(source.id)
    expect(before).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
    expect(sql(`SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND final_response_type IS NOT NULL`)).toBe(0)
    expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
    expect((await run()).internalReviewRequired).toBe(true)
    expect(snapshot(source.id)).toEqual(before)
  }
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
})
it('internal SQL storage failure rolls back receipt and ACK reservation, then permits an unchanged original retry', async () => {
  const f = await seed(), input = await f.prepare()
  const before = snapshot(f.original.id)
  const broken = structuredClone(input)
  broken.transactions[0].periodStart = 'invalid-internal-timestamp'
  await expect(persistUtiltsTransactionResults(broken)).rejects.toThrow('utilts_transaction_persistence_failed')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(f.original.id)}`)).toBe(0)
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  const retried = await persistUtiltsTransactionResults(input)
  expect(retried).toMatchObject([{ disposition: 'accepted', persistenceStatus: 'persisted', idempotentReplay: false }])
})
it('native E66 persists SG5 field 512 as the DTM+735 UTC instant and preserves it on exact retry', async () => {
  const f = await seed(), input = await f.prepare()
  expect(input.transactions[0].registrationDate).toBe('2026-06-30T23:20:00.000Z')
  expect(input.transactions[0].latestUpdateDate).toBeNull()
  const first = await persistUtiltsTransactionResults(input)
  expect(first).toMatchObject([{ disposition: 'accepted', persistenceStatus: 'persisted' }])
  const stored = sql(`SELECT jsonb_build_object('registration',registration_date='2026-06-30T23:20:00Z'::timestamptz,'latestAbsent',latest_update_date IS NULL,'rawRegistration',raw_transaction->>'registrationDate',
    'source',source_ediel_message_id,'tenant',company_id) FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)
  expect(stored).toEqual({ registration: true, latestAbsent: true,
    rawRegistration: '2026-06-30T23:20:00.000Z', source: f.original.id, tenant: f.ids.company })
  expect((await persistUtiltsTransactionResults(input))[0]).toMatchObject({ seriesId: first[0].seriesId, idempotentReplay: true })
  expect(sql(`SELECT jsonb_build_object('registration',registration_date='2026-06-30T23:20:00Z'::timestamptz,'latestAbsent',latest_update_date IS NULL,'rawRegistration',raw_transaction->>'registrationDate',
    'source',source_ediel_message_id,'tenant',company_id) FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)).toEqual(stored)
})
it('native E66 cannot borrow SG11 DTM+597 for missing SG5 field 512 or consume its values on retry', async () => {
  const f = await seed()
  const segments = f.original.raw_payload!.split('\n').filter(segment => segment !== "DTM+597:202607010020:203'")
  const unh = segments.findIndex(segment => segment.startsWith('UNH+'))
  const unt = segments.findIndex(segment => segment.startsWith('UNT+'))
  segments[unt] = `UNT+${unt - unh + 1}+1'`
  const source = await f.insertSource(segments.join('\n'))
  const first = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('512')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,
    'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ company: f.ids.company, disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native accepted S01 persists only SG5 field 532 and no individual consumption effect on retry', async () => {
  const f = await seed()
  const segments = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('DTM+597:202607010020:203', 'DTM+368:202607010020:203')
    .split('\n').filter(segment => !segment.startsWith('DTM+597:'))
  const unh = segments.findIndex(segment => segment.startsWith('UNH+'))
  const unt = segments.findIndex(segment => segment.startsWith('UNT+'))
  segments[unt] = `UNT+${unt - unh + 1}+1'`
  const source = await f.insertSource(ownIdentity(segments.join('\n')), 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const runtime = runUtiltsRuntimeForMessage(source), policy = resolveCanonicalMessagePolicy(source)!
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  const input: UtiltsBoundPersistenceInput & { actorUserId: string } = { actorUserId: f.ids.actor, companyId: f.ids.company, environment: source.environment, sourceMessageId: source.id,
    messageCode: 'S01', rawPayload: source.raw_payload!,
    contracts: await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches: [], dataRequest: null,
      fallback: { customerId: null, siteId: null, meteringPointId: null, gridOwnerId: null }, allowConsumption: false }),
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: 'S01', transactions: runtime.facts.transactions,
      rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches: [] }) }
  expect(input.transactions).toMatchObject([{ registrationDate: null, latestUpdateDate: '2026-06-30T23:20:00.000Z' }])
  const first = await persistUtiltsTransactionResults(input)
  expect(first).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted' }])
  const stored = sql(`SELECT jsonb_build_object('registrationAbsent',registration_date IS NULL,'latest',latest_update_date='2026-06-30T23:20:00Z'::timestamptz,
    'rawLatest',raw_transaction->>'latestUpdateDate','kind',series_kind,'tenant',company_id) FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)
  expect(stored).toEqual({ registrationAbsent: true, latest: true,
    rawLatest: '2026-06-30T23:20:00.000Z', kind: 'aggregate', tenant: f.ids.company })
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: source, boundOutcomes: first })
  await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: source, boundOutcomes: first, existingBillingUnderlayId: null })
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  expect((await persistUtiltsTransactionResults(input))[0]).toMatchObject({ seriesId: first[0].seriesId, idempotentReplay: true })
  expect(sql(`SELECT jsonb_build_object('registrationAbsent',registration_date IS NULL,'latest',latest_update_date='2026-06-30T23:20:00Z'::timestamptz,
    'rawLatest',raw_transaction->>'latestUpdateDate','kind',series_kind,'tenant',company_id) FROM public.meter_reading_series WHERE id=${lit(first[0].seriesId)}`)).toEqual(stored)
})
it('cross-environment equal legacy identity cannot reuse test consumption authority', async () => {
  const f = await seed(), first = await persistUtiltsTransactionResults(await f.prepare())
  const production = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'PROD'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'GRIDEX2607E66PRO'), 'E66', 'production')
  const next = await persistUtiltsTransactionResults(await f.prepare(production))
  expect(next[0].seriesId).not.toBe(first[0].seriesId)
  expect(next[0].consumptionContract?.environment).toBe('production')
})
it.each(['E30', 'S07'])('native %s control keeps the actual prepared consumption capability', async code => {
  const f = await seed(), application = code === 'E30' ? '23-MDR-E30-T' : '23-DDQ-S07-T'
  const raw = f.original.raw_payload!.replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : 'BGM+E30::260').replace(code === 'E30' ? "\nMEA+AAZ++KWH'" : '\u0000', '')
    .replace('23-DDQ-E66-T', application).replaceAll(f.original.interchange_reference!, code+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', code+'CONTROL001')
  const source = await f.insertSource(raw, code), input = await f.prepare(source, false, code === 'E30')
  const rows = await persistUtiltsTransactionResults(input)
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: source, boundOutcomes: rows })
  await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: source, boundOutcomes: rows, existingBillingUnderlayId: null })
  if (code === 'E30') {
    expect(effects.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '500', periodStart: '2026-06-30T23:00:00.000Z' }))
    expect(effects.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '500' }))
  } else {
    expect(rows[0].consumptionContract).toMatchObject({ observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } })
    expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
  }
})
it.each([{ resolution: '15:806', end: '202607010030', second: '202607010015', boundary: '2026-06-30T23:15:00.000Z' }, // U p36: E30 energy is quarter, month or year

  { resolution: '1:802', end: '202609010000', second: '202608010000', boundary: '2026-07-31T23:00:00.000Z' }])('native accepted E30 $resolution creates two distinct stored intervals', async fixture => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace('BGM+E66', 'BGM+E30').replace('23-DDQ-E66-T', '23-MDR-E30-T').replace('15:806', fixture.resolution)
    .replace('202607010000202607010015:719', `202607010000${fixture.end}:719`).split('\n').filter(line => line !== "MEA+AAZ++KWH'") // U s85: no SG5/MEA in E30
  const at = lines.findIndex(line => line.startsWith('UNT+'))
  lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", `DTM+597:${fixture.second}:203'`, "STS+7++21::260'")
  lines[at + 4] = `UNT+${at + 3}+1'`
  const source = await f.insertSource(lines.join('\n').replaceAll(f.original.interchange_reference!, 'E30'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'GRIDEX2607E66E30'), 'E30'), input = await f.prepare(source)
  expect(input.contracts[0].observations.map(o => o.quantity)).toEqual(['500', '7']) // exact decimal strings
  expect(input.contracts[0].observations[0].periodEnd).toBe(fixture.boundary)
  expect(input.contracts[0].observations[1].periodStart).toBe(fixture.boundary)
  const outcomes = await persistUtiltsTransactionResults(input)
  await realSinks()
  const stored = await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: source, boundOutcomes: outcomes })
  expect(stored).toHaveLength(2); expect(new Set(stored.map(row => row.id)).size).toBe(2)
  expect(sql(`SELECT jsonb_agg(value_kwh ORDER BY period_start) FROM public.metering_values WHERE company_id=${lit(f.ids.company)}`)).toEqual([500, 7])
  expect((await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: source, boundOutcomes: outcomes, existingBillingUnderlayId: null }))?.total_kwh).toBe(507)
})
it('JSONB key order is immaterial and wrong source code/environment fail internally', async () => {
  const f = await seed(), input = await f.prepare(), first = await persistUtiltsTransactionResults(input)
  const reordered = { ...input, contracts: input.contracts.map(c => Object.fromEntries(Object.entries(c).reverse()) as typeof c) }
  expect((await persistUtiltsTransactionResults(reordered))[0].seriesId).toBe(first[0].seriesId)
  await expect(persistUtiltsTransactionResults({ ...input, messageCode: 'E30' })).rejects.toThrow('utilts_consumption_binding_conflict:physical_quantity_unit'); expect((await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', { p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: f.original.id, p_message_code: 'E30', p_raw_payload: f.original.raw_payload!, p_actor_user_id: f.ids.actor, p_transactions: input.transactions.map((t, i) => ({ ...t, consumptionContract: input.contracts[i] })) })).error?.message).toMatch(/utilts_source_binding_conflict/)
  await expect(persistUtiltsTransactionResults({ ...input, environment: 'production' })).rejects.toThrow('utilts_source_binding_conflict')
  await expect(persistUtiltsTransactionResults({ ...input, companyId: randomUUID() })).rejects.toThrow('utilts_transaction_persistence_failed:utilts_source_binding_conflict') // tenant-scoped source before actor
})
it('distinguishable observation order is immutable, not a set comparison', async () => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace('202607010000202607010015:719', '202607010000202607010030:719').split('\n')
  const at = lines.findIndex(line => line.startsWith('UNT+'))
  lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", "DTM+597:202607010015:203'", "STS+7++21::260'")
  lines[at + 4] = `UNT+${at + 3}+1'`
  const source = await f.insertSource(lines.join('\n').replaceAll(f.original.interchange_reference!, 'ORDER'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'GRIDEX2607E66ORD')), input = await f.prepare(source)
  expect(input.contracts[0].observations.map(o => o.quantity)).toEqual(['500', '7'])
  await persistUtiltsTransactionResults(input); const before = snapshot(source.id)
  const changed = structuredClone(input)
  changed.contracts[0].observations.reverse().forEach((o, i) => { o.ordinal = i })
  await expect(persistUtiltsTransactionResults(changed)).rejects.toThrow('utilts_consumption_raw_conflict')
  expect(snapshot(source.id)).toEqual(before)
})
it('equivalent valid hour/minute wire spellings cannot replace a bound source', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!.replace('15:806', '1:805').replace('202607010000202607010015:719', '202607010000202607010100:719')
  const source = await f.insertSource(raw.replaceAll(f.original.interchange_reference!, 'HOUR'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'HOURE66001')), input = await f.prepare(source)
  await persistUtiltsTransactionResults(input); const before = snapshot(source.id)
  const changed = { ...source, raw_payload: source.raw_payload!.replace('1:805', '60:806') }, prepared = await f.prepare(changed)
  expect(prepared.contracts[0].observations[0].periodEnd).toBe(input.contracts[0].observations[0].periodEnd)
  await expect(persistUtiltsTransactionResults(prepared)).rejects.toThrow('utilts_source_binding_conflict')
  expect(snapshot(source.id)).toEqual(before)
})
it.each(['missing-field', 'extra-field', 'wrong-type', 'missing-member', 'duplicate-member', 'wrong-member', 'null-request-scope', 'numeric-request-scope', 'text-month', 'padded-customer'])('native rejects %s without minting source/ACK/series evidence', async kind => {
  const f = await seed(), input = await f.prepare()
  const payload = input.transactions.map((item, i) => ({ ...item, consumptionContract: structuredClone(input.contracts[i]) as unknown as Record<string, unknown> }))
  if (kind === 'missing-field') delete payload[0].consumptionContract.attributionVersion
  if (kind === 'extra-field') payload[0].consumptionContract.unapproved = true
  if (kind === 'wrong-type') payload[0].consumptionContract.observations = null
  if (kind === 'missing-member') payload.length = 0
  if (kind === 'duplicate-member') payload.push(structuredClone(payload[0]))
  if (kind === 'wrong-member') { payload[0].transactionId = 'UNSEEN'; payload[0].consumptionContract.transactionId = 'UNSEEN' }
  const billing = payload[0]?.consumptionContract.billing as Record<string, unknown> | undefined
  if (kind === 'null-request-scope') billing!.requestScope = null
  if (kind === 'numeric-request-scope') billing!.requestScope = 7
  if (kind === 'text-month') billing!.month = String(billing!.month)
  if (kind === 'padded-customer') billing!.customerId = ` ${billing!.customerId}`
  const result = sql<string>(`CREATE FUNCTION pg_temp.binding_input_probe() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.gridex_persist_utilts_consumption_v1(${lit(input.companyId)},'test',${lit(input.sourceMessageId)},'E66',${lit(input.rawPayload)},${lit(payload)}::jsonb,${lit(f.ids.actor)});
    RETURN 'UNSAFE_SUCCESS'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;
    SELECT to_jsonb(pg_temp.binding_input_probe());`)
  expect(result).toMatch(/^P0U01:utilts_/)
  expect(snapshot(input.sourceMessageId)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(input.sourceMessageId)}`)).toBe(0)
})
it('two physical IDE+24 occurrences with the same 505 stop before receipt, ACK and business effects on every attempt', async () => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  lines.splice(end, 0, ...lines.slice(start, end).map(line => line.replace('QTY+136:500', 'QTY+136:7')))
  lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.length - 2}+1'`
  const source = await f.insertSource(lines.join('\n'))
  expect(source.raw_payload!.match(/IDE\+24\+GRIDEX2607E66001'/g)).toHaveLength(2)
  const supported = await f.prepare()
  const forged = await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', {
    p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: source.id, p_message_code: 'E66', p_raw_payload: source.raw_payload!, p_actor_user_id: f.ids.actor,
    p_transactions: Array.from({ length: 2 }, () => ({ ...supported.transactions[0], consumptionContract: supported.contracts[0] })),
  })
  expect(forged.error?.message).toMatch(forgedRefusal('physical_membership_conflict'))
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id }))
      .rejects.toThrow()
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
    expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
    expect(effects.ack).not.toHaveBeenCalled(); expect(effects.outbound).not.toHaveBeenCalled()
    expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled()
    expect(effects.complete).not.toHaveBeenCalled()
  }
})
async function realSinks() {
  const meter = await vi.importActual<typeof import('@/lib/metering/normalizeMeteringValues')>('@/lib/metering/normalizeMeteringValues')
  const billing = await vi.importActual<typeof import('@/lib/cis/db-data')>('@/lib/cis/db-data')
  effects.meter.mockImplementation(meter.normalizeAndStoreMeteringValue)
  effects.bill.mockImplementation(billing.ingestBillingUnderlay)
}
function consumedCount(company: string) {
  return sql(`SELECT jsonb_build_object('meter',(SELECT count(*) FROM public.metering_values WHERE company_id=${lit(company)}),'billing',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${lit(company)}))`)
}
it('real downstream writers consume database-derived stored values and retry idempotently', async () => {
  const f = await seed(), input = await f.prepare(), rows = await persistUtiltsTransactionResults(input)
  await realSinks()
  const meter = await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })
  const billing = await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null })
  expect(meter).toHaveLength(1); expect(billing?.total_kwh).toBe(500)
  expect(sql(`SELECT jsonb_build_object('value',value_kwh,'customer',customer_id,'site',site_id,'point',metering_point_id,'grid',grid_owner_id) FROM public.metering_values WHERE id=${lit(meter[0].id)}`)).toEqual({ value: 500, customer: f.ids.customer, site: f.ids.site, point: f.ids.point, grid: f.ids.grid })
  await ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })
  expect((await createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null }))?.id).toBe(billing?.id)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
})
it.each(['month', 'year', 'currency', 'contributors', 'missing-contributors'])('full processor rejects changed billing %s after insert before completion', async field => {
  const f = await seed()
  await realSinks()
  effects.complete.mockRejectedValueOnce(new Error('synthetic_interruption_after_underlay_insert'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_underlay_insert')
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  const mutation = field === 'month' ? 'underlay_month=7' : field === 'year' ? 'underlay_year=2027'
    : field === 'currency' ? "currency='EUR'" : field === 'contributors' ? "payload=jsonb_set(payload,'{consumptionContracts,0,observations,0,quantity}','999'::jsonb)"
      : "payload=payload-'consumptionContracts'"
  sql(`UPDATE public.billing_underlays SET ${mutation} WHERE company_id=${lit(f.ids.company)}`)
  const afterMutation = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.complete.mockClear()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('utilts_consumption_existing_billing_conflict')
  expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(afterMutation)
})
it('full processor identical retry after underlay insert preserves row identity and legitimate workflow/audit changes', async () => {
  const f = await seed()
  await realSinks()
  effects.complete.mockRejectedValueOnce(new Error('synthetic_interruption_after_underlay_insert'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('synthetic_interruption_after_underlay_insert')
  sql(`UPDATE public.billing_underlays SET status='validated',updated_by=NULL,readiness_status='ready',payload=payload||'{"workflowNote":"reviewed"}'::jsonb WHERE company_id=${lit(f.ids.company)}`)
  const row = sql<{ id: string; status: string; updated_by: null }>(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.complete.mockClear()
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(replay.billingUnderlayId).toBe(row.id)
  expect(effects.complete).toHaveBeenCalledTimes(1)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(row)
})
it.each(['point-grid', 'point-site', 'point-customer-site', 'site-grid', 'request-grid'])('real downstream writers reject %s drift after persistence', async kind => {
  const f = await seed(), rows = await persistUtiltsTransactionResults(await f.prepare())
  if (kind === 'point-grid') sql(`UPDATE public.metering_points SET grid_owner_id=NULL WHERE id=${lit(f.ids.point)}`)
  if (kind === 'point-site') sql(`UPDATE public.metering_points SET site_id=NULL,customer_site_id=NULL WHERE id=${lit(f.ids.point)}`)
  if (kind === 'point-customer-site') {
    const site = randomUUID()
    sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,grid_owner_id) VALUES(${lit(site)},${lit(f.ids.company)},${lit(f.ids.customer)},'Other synthetic','consumption','active','SE',${lit(f.ids.grid)}); UPDATE public.metering_points SET customer_site_id=${lit(site)} WHERE id=${lit(f.ids.point)}`)
  }
  if (kind === 'site-grid') sql(`UPDATE public.customer_sites SET grid_owner_id=NULL WHERE id=${lit(f.ids.site)}`)
  if (kind === 'request-grid') sql(`UPDATE public.grid_owner_data_requests SET grid_owner_id=NULL WHERE id=${lit(f.ids.request)}`)
  await realSinks()
  const meter = await Promise.allSettled([ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows })])
  expect(meter[0].status).toBe('rejected')
  await expect(createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.original, boundOutcomes: rows, existingBillingUnderlayId: null })).rejects.toBeDefined()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
const sinkRpc = (input: UtiltsBoundPersistenceInput, sink: 'metering' | 'billing') => {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  return Promise.resolve(rpc(`gridex_consume_utilts_${sink}_v1`, { p_company_id: input.companyId, p_source_message_id: input.sourceMessageId, p_actor_id: null,
    ...(sink === 'metering' ? { p_transaction_id: 'GRIDEX2607E66001', p_observation_ordinal: 0, p_expected_contract: input.contracts[0] } : { p_expected_contracts: input.contracts }) }))
}
it.each(['metering', 'billing'] as const)('atomic %s writer refuses a mutated returned projection instead of reinterpreting it', async sink => {
  const f = await seed(), input = await f.prepare(); await persistUtiltsTransactionResults(input)
  const changed = structuredClone(input); changed.contracts[0].observations[0].quantity = 999
  const result = await sinkRpc(changed, sink)
  expect(result.error?.message).toContain('utilts_consumption_returned_contract_changed')
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['metering', 'billing'] as const)('atomic %s writer waits for concurrent ownership edit then rejects changed tuple', async sink => {
  const f = await seed(), input = await f.prepare(); await persistUtiltsTransactionResults(input)
  const editor = spawn('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const ready = new Promise<void>((resolve, reject) => {
    editor.stdout.on('data', data => { if (String(data).includes('OWNERSHIP_LOCKED')) resolve() })
    editor.once('error', reject); editor.once('exit', code => { if (code !== 0) reject(new Error(`ownership_editor_exit:${code}`)) })
  })
  editor.stdin.write(`BEGIN; UPDATE public.metering_points SET grid_owner_id=NULL WHERE id=${lit(f.ids.point)}; SELECT 'OWNERSHIP_LOCKED';\n`)
  await ready
  let pending: ReturnType<typeof sinkRpc> | undefined
  try {
    pending = sinkRpc(input, sink)
    let waiting = false
    for (let attempt = 0; attempt < 40; attempt++) {
      waiting = sql<boolean>(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%gridex_consume_utilts_${sink}_v1%')`)
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(waiting).toBe(true)
    editor.stdin.end('COMMIT;\n')
    const result = await pending
    expect(result.error?.message).toContain('utilts_consumption_point_ownership_changed')
    expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  } finally {
    if (!editor.stdin.writableEnded) editor.stdin.end('ROLLBACK;\n')
    await pending
  }
})
it.each(['direction', 'company_id', 'environment', 'message_code', 'sender_ediel_id'])('direct update cannot change sealed source %s', async field => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input)
  const changed = field === 'company_id' ? randomUUID() : field === 'direction' ? 'outbound' : field === 'environment' ? 'production' : field === 'message_code' ? 'E30' : '99999'
  const { error } = await supabaseService.from('ediel_messages').update({ [field]: changed }).eq('id', f.original.id)
  expect(error).not.toBeNull()
  const { data } = await supabaseService.from('ediel_messages').select('company_id,environment,direction,message_code,sender_ediel_id').eq('id', f.original.id).single()
  expect(data).toMatchObject({ company_id: f.ids.company, environment: 'test', direction: 'inbound', message_code: 'E66', sender_ediel_id: f.ids.issuer })
})
it('concurrent identical retries serialize to one contract/series and unchanged reserved ACK', async () => {
  const f = await seed(), input = await f.prepare()
  const attempts = await Promise.all(Array.from({ length: 4 }, () => persistUtiltsTransactionResults(input)))
  expect(new Set(attempts.map(rows => rows[0].seriesId)).size).toBe(1)
  expect(attempts.filter(rows => !rows[0].idempotentReplay)).toHaveLength(1)
  expect(sql(`SELECT jsonb_build_object('series',(SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(f.original.id)}),'contracts',(SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(f.original.id)}),'acks',(SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(f.original.id)}))`)).toEqual({ series: 1, contracts: 1, acks: 1 })
})
it('dedupe conflict after an earlier sibling insert rolls the entire batch back, never to ERR', async () => {
  const f = await seed(), input = await f.prepare()
  await persistUtiltsTransactionResults(input)
  const original = f.original.raw_payload!, start = original.indexOf('IDE+24'), end = original.indexOf('UNT+')
  const added = original.slice(start, end).replaceAll('GRIDEX2607E66001', 'EARLIER-SIBLING').replace('QTY+136:500', 'QTY+136:1')
  const raw = (original.slice(0, start) + added + original.slice(start).replace('QTY+136:500', 'QTY+136:999')).replaceAll(f.original.interchange_reference!, 'BATCH'+f.original.interchange_reference!)
  const segments = raw.split('\n'), unt = segments.findIndex(line => line.startsWith('UNT+'))
  segments[unt] = `UNT+${unt - 1}+1'`
  const source = await f.insertSource(segments.join('\n')), incoming = await f.prepare(source)
  const before = snapshot(f.original.id)
  await expect(persistUtiltsTransactionResults(incoming)).rejects.toThrow('utilts_consumption_raw_conflict')
  expect(snapshot(f.original.id)).toEqual(before)
  expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
})
it('private storage and old unbound function are unavailable to service callers', async () => {
  const f = await seed(), input = await f.prepare()
  const { error } = await supabaseService.rpc('gridex_persist_utilts_transactions_v1', {
    p_company_id: input.companyId, p_environment: input.environment, p_source_message_id: input.sourceMessageId, p_message_code: input.messageCode, p_transactions: input.transactions,
  })
  expect(error).not.toBeNull()
  expect(sql(`SELECT has_function_privilege('service_role','gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb)','EXECUTE')`)).toBe(false)
  expect(sql(`SELECT to_regprocedure('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)') IS NOT NULL`)).toBe(false)
  expect(sql(`SELECT has_function_privilege('authenticated','public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)','EXECUTE')`)).toBe(false)
  expect(sql(`SELECT has_function_privilege('service_role','gridex_utilts_binding.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb)','EXECUTE')`)).toBe(false)
  expect(sql(`SELECT has_table_privilege('service_role','gridex_utilts_binding.contracts','INSERT')`)).toBe(false)
  for (const role of ['anon', 'authenticated']) {
    expect(sql(`SELECT has_function_privilege(${lit(role)},'public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)','EXECUTE')`)).toBe(false)
    expect(sql(`SELECT has_function_privilege(${lit(role)},'public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb)','EXECUTE')`)).toBe(false)
  }
})

// Run this only against the frozen, completely replayed native database. OID
// dependencies and effective role ACLs are database observations; untracked
// string-body/dynamic calls are a separate installed-source inventory below.
const persistenceCatalogOwners = [
  ['public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)',
    '20261001110500_ediel_utilts_current_execution_actor.sql', 'public.gridex_persist_utilts_consumption_v1'],
  ['gridex_utilts_binding.require_execution_actor_v1(uuid,uuid)',
    '20261001110500_ediel_utilts_current_execution_actor.sql', 'gridex_utilts_binding.require_execution_actor_v1'],
  ['gridex_utilts_binding.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb)',
    '20261001051410_ediel_utilts_persist_reading_followup_owner.sql', 'public.gridex_persist_utilts_consumption_v1'],
  ['gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)',
    '20261001053437_ediel_utilts_rejected_reference_diagnostic_v3.sql', 'gridex_utilts_binding.persist_consumption_before_precision_v1'],
  ['gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb)',
    '20261001010230_ediel_utilts_lossless_transaction_reference_v2.sql', 'gridex_utilts_binding.persist_series_v1'],
  ['gridex_utilts_binding.persist_series_legacy_v1(uuid,text,uuid,text,jsonb)',
    '20260928181500_utilts_held_retry_stable_reservation.sql', 'gridex_utilts_binding.persist_series_v1'],
  ['gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)',
    '20261001010230_ediel_utilts_lossless_transaction_reference_v2.sql', 'gridex_utilts_binding.persist_series_v2'],
  ['public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb)',
    '20260923135706_ediel_utilts_consumption_binding_v1.sql', 'public.gridex_persist_utilts_transactions_v1'],
] as const

it('native catalog binds preserved UTILTS OIDs to the only actor-protected callable chain', () => {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const tree = execFileSync('git', ['rev-parse', `${revision}^{tree}`], { encoding: 'utf8' }).trim()
  const signatures = persistenceCatalogOwners.map(([signature]) => signature)
  const allowed = new Set<string>(signatures)
  const publicEntry = signatures[0]
  const privateOwners = signatures.filter(signature => signature.startsWith('gridex_utilts_binding.'))
  const catalog = sql<PersistenceCatalogReceipt>(`WITH RECURSIVE
   app_roots AS (SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')),
   set_roles(root_oid,role_oid,path) AS (
    SELECT oid,oid,ARRAY[oid] FROM app_roots
    UNION ALL SELECT s.root_oid,m.roleid,s.path||m.roleid FROM set_roles s JOIN pg_auth_members m ON m.member=s.role_oid
     WHERE coalesce((to_jsonb(m)->>'set_option')::boolean,true) AND NOT m.roleid=ANY(s.path)),
   effective_roles AS (SELECT DISTINCT root_oid,role_oid FROM set_roles),
   private_targets AS (SELECT to_regprocedure(signature)::oid AS oid,signature FROM unnest(ARRAY[${privateOwners.map(lit).join(',')}]) signature),
   reverse_dependants(target_oid,target,class_oid,object_oid,sub_id,kind,path) AS (
    SELECT t.oid,t.signature,d.classid,d.objid,d.objsubid,d.deptype,ARRAY[d.classid::text||':'||d.objid::text||':'||d.objsubid::text]
     FROM private_targets t JOIN pg_depend d ON d.refclassid='pg_proc'::regclass AND d.refobjid=t.oid
    UNION ALL SELECT r.target_oid,r.target,d.classid,d.objid,d.objsubid,d.deptype,r.path||(d.classid::text||':'||d.objid::text||':'||d.objsubid::text)
     FROM reverse_dependants r JOIN pg_depend d ON d.refclassid=r.class_oid AND d.refobjid=r.object_oid AND d.refobjsubid=r.sub_id
     WHERE NOT (d.classid::text||':'||d.objid::text||':'||d.objsubid::text)=ANY(r.path)),
   installed_functions AS (SELECT p.*,n.nspname,l.lanname,
     format('%I.%I(%s)',n.nspname,p.proname,regexp_replace(oidvectortypes(p.proargtypes),',\\s*',',','g')) AS signature
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
     WHERE n.nspname IN ('public','graphql_public') OR n.nspname LIKE 'gridex\\_%' ESCAPE '\\')
   SELECT jsonb_build_object(
    'serverVersion',version(),'serverVersionNumber',current_setting('server_version_num'),'database',current_database(),'capturedAt',clock_timestamp(),
    'databaseIdentity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
      'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'serverAddress',inet_server_addr()::text,
      'serverPort',inet_server_port(),'postmasterStartedAt',to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    'roles',(SELECT jsonb_agg(jsonb_build_object('root',a.rolname,'effectiveRole',r.rolname,'superuser',r.rolsuper,'createRole',r.rolcreaterole,
      'inheritedPrivileges',pg_has_role(a.oid,r.oid,'USAGE'),'setRoleAllowed',pg_has_role(a.oid,r.oid,'SET'),'setRolePath',(SELECT jsonb_agg(x.rolname ORDER BY v.ordinality)
       FROM unnest(s.path) WITH ORDINALITY v(oid,ordinality) JOIN pg_roles x ON x.oid=v.oid)) ORDER BY a.rolname,r.rolname)
      FROM set_roles s JOIN app_roots a ON a.oid=s.root_oid JOIN pg_roles r ON r.oid=s.role_oid),
    'roleMemberships',(SELECT coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('roleName',r.rolname,'memberName',u.rolname) ORDER BY r.rolname,u.rolname),'[]'::jsonb)
      FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid::bigint,'signature',p.signature,'name',p.proname,'schema',p.nspname,
      'owner',pg_get_userbyid(p.proowner),'language',p.lanname,'securityDefiner',p.prosecdef,'kind',p.prokind,'config',p.proconfig,
      'argumentNames',p.proargnames,'identityArguments',pg_get_function_identity_arguments(p.oid),'returnType',format_type(p.prorettype,NULL),
      'defaultCount',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),
      'source',p.prosrc,'definition',CASE WHEN p.prokind='a' THEN NULL ELSE pg_get_functiondef(p.oid) END,
      'aggregate',(SELECT to_jsonb(a) FROM pg_aggregate a WHERE a.aggfnoid=p.oid),
      'publicExecute',EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'),
      'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
       'privilege',acl.privilege_type,'grantable',acl.is_grantable) ORDER BY acl.grantee,acl.privilege_type)
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl)) ORDER BY p.signature),'[]'::jsonb) FROM installed_functions p),
    'roleMatrix',(SELECT coalesce(jsonb_agg(jsonb_build_object('root',a.rolname,'effectiveRole',r.rolname,'signature',p.signature,
      'execute',has_function_privilege(r.oid,p.oid,'EXECUTE'),'schemaUsage',has_schema_privilege(r.oid,p.pronamespace,'USAGE')) ORDER BY a.rolname,r.rolname,p.signature),'[]'::jsonb)
      FROM effective_roles s JOIN app_roots a ON a.oid=s.root_oid JOIN pg_roles r ON r.oid=s.role_oid CROSS JOIN installed_functions p),
    'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('targetOid',r.target_oid,'target',r.target,'classOid',r.class_oid,'objectOid',r.object_oid,
      'subId',r.sub_id,'kind',r.kind,'description',pg_describe_object(r.class_oid,r.object_oid,r.sub_id),'functionSignature',p.signature,'path',r.path)
      ORDER BY r.target,r.path),'[]'::jsonb) FROM reverse_dependants r LEFT JOIN installed_functions p ON r.class_oid='pg_proc'::regclass AND p.oid=r.object_oid),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',t.tgname,'enabled',t.tgenabled,
      'functionOid',t.tgfoid,'function',p.signature,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN installed_functions p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal),
    'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',p.polname,'command',p.polcmd,'roles',p.polroles,
      'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,c.relname,p.polname),'[]'::jsonb)
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR n.nspname LIKE 'gridex\\_%' ESCAPE '\\'),
    'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations));`, 32_000_000)
  const actual = new Map(catalog.functions.map(fn => [fn.signature, fn]))
  const expected = persistenceCatalogOwners.map(([signature, migration, functionName]) => ({ signature, migration, ...committedPersistenceBody(revision, migration, functionName) }))
  // Conservative named-call discovery supplies the late-bound callsite review.
  // It neither parses PL/pgSQL nor proves dynamically assembled SQL absent.
  const privateNames = privateOwners.map(signature => signature.slice(signature.indexOf('.') + 1, signature.indexOf('(')))
  const namedCallsites = catalog.functions.filter(fn => privateNames.some(name => fn.source.includes(name)))
  const dynamicDefinitions = catalog.functions.filter(fn => fn.language === 'plpgsql' && /\bEXECUTE\b/i.test(fn.source))
  const preupgradePath = process.env.GRIDEX_UTILTS_PREUPGRADE_CATALOG_PATH
  const before = preupgradePath ? JSON.parse(readFileSync(preupgradePath, 'utf8')) as {
    format: string; codeSha: string; codeTree: string; beforeMigrationVersion: string; predecessorSignature: string;
    oldPublic6Oid: number; sourceHash: string; serverVersionNumber: string; databaseIdentity: PersistenceCatalogReceipt['databaseIdentity'];
  } : null
  const databasePhase = process.env.GRIDEX_NATIVE_DATABASE_PHASE
  const predecessor = actual.get(signatures[2])
  const databaseIdentityKeys = ['systemIdentifier', 'databaseOid', 'serverAddress', 'serverPort', 'postmasterStartedAt'] as const
  const beforeMatches = before !== null && before.format === 'gridex_utilts_pre_actor_catalog_v1'
    && before.codeSha === revision && before.codeTree === tree && before.beforeMigrationVersion === '20261001110500'
    && before.predecessorSignature === 'public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'
    && Number.isSafeInteger(before.oldPublic6Oid) && before.oldPublic6Oid > 0 && before.oldPublic6Oid === predecessor?.oid
    && before.sourceHash === createHash('sha256').update(predecessor?.source ?? '').digest('hex')
    && before.serverVersionNumber === catalog.serverVersionNumber
    && databaseIdentityKeys.every(key => before.databaseIdentity?.[key] === catalog.databaseIdentity[key])
  const receiptPath = process.env.GRIDEX_UTILTS_CATALOG_RECEIPT_PATH || `/tmp/gridex-utilts-catalog-${revision}.json`
  const receipt = { format: 'gridex_utilts_native_catalog_v1', codeSha: revision, codeTree: tree,
    databasePhase: databasePhase || 'not_declared',
    oldPublic6Absent: !actual.has('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)'),
    observedPreservedOld6Oid: actual.get(signatures[2])?.oid ?? null, preupgradeOld6Oid: before?.oldPublic6Oid ?? null,
    preActorCatalog: before, preActorCatalogHash: preupgradePath ? createHash('sha256').update(readFileSync(preupgradePath)).digest('hex') : null,
    oidPreservationCompared: beforeMatches,
    expectedOwners: expected.map(({ body, ...source }) => ({ ...source, bodyHash: createHash('sha256').update(body).digest('hex') })),
    namedCallsites: namedCallsites.map(fn => fn.signature), dynamicDefinitions: dynamicDefinitions.map(fn => fn.signature),
    limitations: ['pg_depend does not record calls in string bodies or dynamically assembled SQL.',
      'Named-call discovery rejects unreviewed literal producer paths; it is not a PL/pgSQL parser or proof about computed identifiers.',
      'All installed public/gridex callable definitions, effective ACLs, triggers and policies are retained for separate source/phase review.',
      'OID preservation across upgrade requires the genuine pre-upgrade OID receipt.'], catalog }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
  console.info('EDIEL_UTILTS_NATIVE_CATALOG', JSON.stringify({ codeSha: revision, codeTree: tree, receiptPath,
    receiptHash: createHash('sha256').update(readFileSync(receiptPath)).digest('hex'),
    predecessorOid: receipt.observedPreservedOld6Oid, public7Oid: actual.get(publicEntry)?.oid,
    functionCount: catalog.functions.length, effectiveRoleCount: catalog.roles.length, dependencyCount: catalog.dependencies.length,
    oidPreservationCompared: receipt.oidPreservationCompared, dynamicDefinitionCount: dynamicDefinitions.length }))
  expect(catalog.roles.map(role => role.root)).toEqual(expect.arrayContaining(['anon', 'authenticated', 'service_role', 'authenticator']))
  expect(['clean', 'upgrade'], 'declare the actual native database phase').toContain(databasePhase)
  if (databasePhase === 'upgrade') expect(before, 'upgrade qualification requires the genuine pre110500 catalog receipt').not.toBeNull()
  if (before) {
    expect(before.format).toBe('gridex_utilts_pre_actor_catalog_v1')
    expect(before.codeSha).toBe(revision)
    expect(before.codeTree).toBe(tree)
    expect(before.beforeMigrationVersion).toBe('20261001110500')
    expect(before.predecessorSignature).toBe('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)')
    expect(Number.isSafeInteger(before.oldPublic6Oid) && before.oldPublic6Oid > 0).toBe(true)
    expect(before.serverVersionNumber).toBe(catalog.serverVersionNumber)
    expect(before.databaseIdentity).toEqual(catalog.databaseIdentity)
    expect(before.sourceHash).toBe(createHash('sha256').update(predecessor?.source ?? '').digest('hex'))
  }
  expect(catalog.functions.length).toBeGreaterThan(signatures.length)
  expect(receipt.oldPublic6Absent).toBe(true)
  expect(new Set(signatures.map(signature => actual.get(signature)?.oid)).size).toBe(signatures.length)
  for (const owner of expected) {
    const fn = actual.get(owner.signature)
    expect(fn, owner.signature).toBeDefined()
    expect(fn!.source, owner.signature).toBe(owner.body)
    expect(fn!.kind, owner.signature).toBe('f')
    expect(fn!.language, owner.signature).toBe('plpgsql')
    expect(fn!.securityDefiner, owner.signature).toBe(owner.signature !== 'public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb)')
    expect(fn!.owner, owner.signature).toBe(actual.get(publicEntry)!.owner)
    expect(fn!.publicExecute, owner.signature).toBe(false)
    expect(fn!.config, owner.signature).toContain(owner.signature.includes('persist_series_legacy_v1') || owner.signature.includes('persist_series_v2')
      || owner.signature.includes('persist_consumption_before_precision_v1') ? 'search_path=pg_catalog, public, extensions' : 'search_path=pg_catalog')
    expect(fn!.config!.every(setting => setting.startsWith('search_path=') || setting.toLowerCase() === 'timezone=utc'), owner.signature).toBe(true)
  }
  expect(actual.get(publicEntry)!.argumentNames).toEqual(['p_company_id', 'p_environment', 'p_source_message_id', 'p_message_code', 'p_raw_payload', 'p_transactions', 'p_actor_user_id'])
  expect(actual.get(publicEntry)!.defaultCount).toBe(1)
  expect(actual.get(publicEntry)!.defaults).toBe('NULL::uuid')
  for (const role of catalog.roles) {
    expect(role.setRoleAllowed, `${role.root}→${role.effectiveRole}: actual PostgreSQL SET privilege`).toBe(true)
    expect(role.superuser, `${role.root}→${role.effectiveRole}`).toBe(false)
    expect(role.createRole, `${role.root}→${role.effectiveRole}`).toBe(false)
    expect(role.effectiveRole, `${role.root} must not SET ROLE to a storage owner`).not.toBe(actual.get(publicEntry)!.owner)
    if (role.root === 'anon' || role.root === 'authenticated') expect(role.effectiveRole).not.toBe('service_role')
  }
  for (const row of catalog.roleMatrix.filter(row => allowed.has(row.signature))) {
    const permitted = row.signature === publicEntry && row.effectiveRole === 'service_role' && (row.root === 'service_role' || row.root === 'authenticator')
    expect(row.execute, `${row.root}→${row.effectiveRole}:${row.signature}`).toBe(permitted)
  }
  for (const dependency of catalog.dependencies) {
    expect(dependency.functionSignature, `unreviewed tracked dependant: ${dependency.description}`).not.toBeNull()
    expect(allowed.has(dependency.functionSignature!), `unreviewed tracked dependant: ${dependency.description}`).toBe(true)
  }
  for (const fn of namedCallsites) expect(allowed.has(fn.signature), `unreviewed late-bound named producer: ${fn.signature}`).toBe(true)
  if (before) {
    expect(actual.get(signatures[2])!.oid, 'renamed predecessor must preserve the genuine pre-upgrade public6 OID').toBe(before.oldPublic6Oid)
    expect(receipt.oidPreservationCompared).toBe(true)
  }
}, 30_000)
it.each(['missing-contract', 'corrupt-contract-hash', 'corrupt-raw-hash'])('native %s evidence cannot authorize replay', async kind => {
  const f = await seed(), input = await f.prepare(), rows = await persistUtiltsTransactionResults(input), before = snapshot(f.original.id)
  const payload = input.transactions.map((item, i) => ({ ...item, consumptionContract: input.contracts[i] }))
  const mutation = kind === 'missing-contract' ? `DELETE FROM gridex_utilts_binding.contracts WHERE series_id=${lit(rows[0].seriesId)};`
    : kind === 'corrupt-contract-hash' ? `UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('0',64) WHERE series_id=${lit(rows[0].seriesId)};`
      : `UPDATE public.meter_reading_series SET immutable_hash=repeat('0',64) WHERE id=${lit(rows[0].seriesId)};`
  const result = sql<string>(`BEGIN;
   ALTER TABLE gridex_utilts_binding.contracts DISABLE TRIGGER USER;
   ALTER TABLE public.meter_reading_series DISABLE TRIGGER USER;
   ${mutation}
   CREATE FUNCTION pg_temp.binding_corruption_probe() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.gridex_persist_utilts_consumption_v1(${lit(input.companyId)},'test',${lit(input.sourceMessageId)},'E66',${lit(input.rawPayload)},${lit(payload)}::jsonb,${lit(f.ids.actor)});
    RETURN 'UNSAFE_SUCCESS';
   EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;
   SELECT to_jsonb(pg_temp.binding_corruption_probe()); ROLLBACK;`)
  expect(result).toMatch(/^P0U01:utilts_/)
  expect(snapshot(f.original.id)).toEqual(before)
})

function sinkState(company: string) {
  return sql(`SELECT jsonb_build_object('meters',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.metering_values m WHERE company_id=${lit(company)}),
   'normalized',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.normalized_metering_values n WHERE company_id=${lit(company)}),
   'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.metering_value_sources l WHERE company_id=${lit(company)}))`)
}
it.each(['customer', 'site', 'customer-site', 'grid', 'request', 'resolution', 'read-at', 'reading-type', 'normalized-quantity', 'normalized-facility', 'normalized-resolution', 'normalized-site'])('R1 full processor refuses colliding stored %s before lineage/completion', async field => {
  const f = await seed(), initial = await f.prepare()
  await persistUtiltsTransactionResults(initial)
  expect((await sinkRpc(initial, 'metering')).error).toBeNull()
  if (field === 'customer') {
    const other = randomUUID()
    sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(other)},${lit(f.ids.company)},${lit(other)},'Other synthetic','private'); UPDATE public.metering_values SET customer_id=${lit(other)} WHERE company_id=${lit(f.ids.company)}`)
  } else {
    const updates: Record<string, string> = { site: 'site_id=NULL', 'customer-site': 'customer_site_id=NULL', grid: 'grid_owner_id=NULL', request: 'source_request_id=NULL', resolution: "resolution='PT1H'", 'read-at': "read_at=read_at+interval '1 minute'", 'reading-type': "reading_type='estimated'", 'normalized-quantity': 'quantity_kwh=501', 'normalized-facility': "facility_id='other'", 'normalized-resolution': "resolution='PT1H'", 'normalized-site': 'site_id=NULL' }
    sql(`UPDATE public.${field.startsWith('normalized') ? 'normalized_metering_values' : 'metering_values'} SET ${updates[field]} WHERE company_id=${lit(f.ids.company)}`)
  }
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'REUSE'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'GRIDEX2607E66REU'))
  await persistUtiltsTransactionResults(await f.prepare(source))
  const before = sinkState(f.ids.company), persisted = snapshot(source.id)
  await realSinks()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })).rejects.toThrow(/utilts_consumption_existing_(metering|normalized)_conflict/)
  expect(sinkState(f.ids.company)).toEqual(before)
  expect(snapshot(source.id)).toEqual(persisted)
  expect(effects.complete).not.toHaveBeenCalled(); expect(effects.ack).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
})
it('R1 identical different-source reuse preserves content and adds separate lineage', async () => {
  const f = await seed(), a = await f.prepare()
  await persistUtiltsTransactionResults(a)
  const first = await sinkRpc(a, 'metering'); expect(first.error).toBeNull()
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'EQUAL'+f.original.interchange_reference!).replaceAll('GRIDEX2607E66001', 'EQUALE66001')), b = await f.prepare(source)
  await persistUtiltsTransactionResults(b)
  const next = await sinkRpc(b, 'metering'); expect(next.error).toBeNull()
  expect((next.data as { id: string }).id).toBe((first.data as { id: string }).id)
  expect(sql(`SELECT count(*) FROM public.metering_value_sources WHERE company_id=${lit(f.ids.company)}`)).toBe(2)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 0 })
})
it('R1 environment collision cannot add lineage or overwrite an existing result', async () => {
  const f = await seed(), a = await f.prepare()
  await persistUtiltsTransactionResults(a); expect((await sinkRpc(a, 'metering')).error).toBeNull()
  const source = await f.insertSource(f.original.raw_payload!.replaceAll(f.original.interchange_reference!, 'ENV'+f.original.interchange_reference!), 'E66', 'production'), b = await f.prepare(source)
  await persistUtiltsTransactionResults(b)
  const before = sinkState(f.ids.company), persisted = snapshot(source.id)
  expect((await sinkRpc(b, 'metering')).error?.message).toContain('existing_metering_environment_conflict')
  expect(sinkState(f.ids.company)).toEqual(before); expect(snapshot(source.id)).toEqual(persisted)
})
async function realCompletion() {
  const db = await vi.importActual<typeof import('@/lib/cis/db-data')>('@/lib/cis/db-data')
  effects.complete.mockImplementation(db.syncGridOwnerDataRequestReceivedFromEdiel)
  const ediel = await vi.importActual<typeof import('@/lib/ediel/db')>('@/lib/ediel/db')
  effects.status.mockImplementation(ediel.updateEdielMessageStatus)
}
function requestState(request: string) {
  return sql<{ status: string; response_payload: { billingUnderlayId: string } }>(`SELECT to_jsonb(r) FROM public.grid_owner_data_requests r WHERE id=${lit(request)}`)
}
it.each(['completed', 'after-real-completion-before-ack', 'foreign-response-id', 'stale-response-id'])('R2 %s reuses verified underlay and preserves request/message/return lineage', async boundary => {
  const f = await seed()
  await realSinks(); await realCompletion()
  if (boundary === 'after-real-completion-before-ack') effects.ack.mockRejectedValueOnce(new Error('after_real_completion'))
  const first = processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  if (boundary === 'after-real-completion-before-ack') await expect(first).rejects.toThrow('after_real_completion')
  else await first
  const id = requestState(f.ids.request).response_payload.billingUnderlayId
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  if (boundary === 'foreign-response-id') {
    const foreign = await seed(); await persistUtiltsTransactionResults(await foreign.prepare())
    const bill = await sinkRpc(await foreign.prepare(), 'billing'); expect(bill.error).toBeNull()
    sql(`UPDATE public.grid_owner_data_requests SET response_payload=jsonb_set(response_payload,'{billingUnderlayId}',to_jsonb(${lit((bill.data as { id: string }).id)}::text)) WHERE id=${lit(f.ids.request)}`)
  }
  if (boundary === 'stale-response-id') sql(`UPDATE public.grid_owner_data_requests SET response_payload=jsonb_set(response_payload,'{billingUnderlayId}',to_jsonb(${lit(randomUUID())}::text)) WHERE id=${lit(f.ids.request)}`)
  sql(`UPDATE public.billing_underlays SET status='validated',updated_by=NULL,readiness_status='ready',payload=payload||'{"workflowNote":"reviewed"}'::jsonb WHERE id=${lit(id)}`)
  const billBefore = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE id=${lit(id)}`)
  effects.bill.mockClear()
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })
  expect(effects.bill).toHaveBeenCalledTimes(1); expect(replay.billingUnderlayId).toBe(id)
  expect(requestState(f.ids.request).response_payload.billingUnderlayId).toBe(id)
  expect(sql(`SELECT to_jsonb(parsed_payload->>'billingUnderlayId') FROM public.ediel_messages WHERE id=${lit(f.original.id)}`)).toBe(id)
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE id=${lit(id)}`)).toEqual(billBefore)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
})
it.each(['month', 'year', 'currency', 'contributors', 'missing-contributors'])('R2 populated response cannot bypass changed existing billing %s', async field => {
  const f = await seed(); await realSinks(); await realCompletion()
  effects.ack.mockRejectedValueOnce(new Error('after_real_completion'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('after_real_completion')
  const before = requestState(f.ids.request), persisted = snapshot(f.original.id)
  expect(before.response_payload.billingUnderlayId).toBeTruthy()
  const mutation = field === 'month' ? 'underlay_month=7' : field === 'year' ? 'underlay_year=2027'
    : field === 'currency' ? "currency='EUR'" : field === 'contributors' ? "payload=jsonb_set(payload,'{consumptionContracts,0,observations,0,quantity}','999'::jsonb)" : "payload=payload-'consumptionContracts'"
  sql(`UPDATE public.billing_underlays SET ${mutation} WHERE company_id=${lit(f.ids.company)}`)
  const billingBefore = sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)
  effects.ack.mockClear(); effects.complete.mockClear(); effects.status.mockClear()
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.original.id })).rejects.toThrow('existing_billing_conflict')
  expect(effects.complete).not.toHaveBeenCalled(); expect(effects.ack).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
  expect(requestState(f.ids.request)).toEqual(before); expect(snapshot(f.original.id)).toEqual(persisted)
  expect(sql(`SELECT to_jsonb(b) FROM public.billing_underlays b WHERE company_id=${lit(f.ids.company)}`)).toEqual(billingBefore)
})

it.each(['energy', 'readings', 'E30-energy', 'E30-readings', 'S07-policy'] as const)('R3 real %s processor holds agency89 text collision with no consumable series or functional ACK', async shape => {
  const f = await seed()
  const { observationHandoffMessage } = await import('../__tests__/helpers/utiltsObservationHandoff')
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const code = shape.startsWith('E30') ? 'E30' : shape === 'S07-policy' ? 'S07' : 'E66'
  let raw = shape.includes('readings') ? observationHandoffMessage('2026-10-01', f.ids.company).raw_payload! : f.original.raw_payload!
  raw = raw.replace('?+0200:406', '?+0100:406').replace('QTY+220:11000', 'QTY+220:10500')
    .replace('735999260731000007::9', '735999260731000007::89')
    .replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : `BGM+${code}::260`)
    .replace(/23-DDQ-E66-[ST]/g, code === 'E30' ? '23-MDR-E30-T' : `23-DDQ-${code}-T`).replace(code === 'E30' ? "\nMEA+AAZ++KWH'" : '\u0000', '') // U s85
  const source = await f.insertSource(ownIdentity(raw), code)
  await realSinks()
  const result = await (shape === 'S07-policy' ? processInboundUtiltsMessageByCanonicalPolicy : processInboundUtiltsMessage)({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.internalReviewRequired).toBe(true); expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`)).toEqual([{ disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound stores NAD receiver agency 208 guide rejection and no consumable series', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace(`NAD+MR+${f.ids.ediel}:SVK:260`, `NAD+MR+${f.ids.ediel}:SVK:999`)))
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('208')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`))
    .toEqual([{ disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound binds IDE qualifier 505 rejection to tenant and source without consumption on retry', async () => {
  const f = await seed()
  const source = await f.insertSource(f.original.raw_payload!.replace('IDE+24+GRIDEX2607E66001', 'IDE+25+GRIDEX2607E66001'))
  const supported = await f.prepare()
  const forged = await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', {
    p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: source.id, p_message_code: 'E66', p_raw_payload: source.raw_payload!, p_actor_user_id: f.ids.actor,
    p_transactions: supported.transactions.map((t, i) => ({ ...t, consumptionContract: supported.contracts[i] })),
  })
  expect(forged.error?.message).toMatch(forgedRefusal('consumption_identity_unsupported'))
  expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
  const first = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('505')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ company: f.ids.company, disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const prior = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(prior)
  await expect(finalizeUtiltsTransactionAck({ companyId: f.ids.company, environment: 'test', sourceMessageId: source.id,
    transactionId: 'GRIDEX2607E66001', responseType: 'negative_aperak', responseMessageId: randomUUID() }))
    .rejects.toThrow('utilts_transaction_ack_finalization_conflict')
  expect(snapshot(source.id)).toEqual(prior)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound persists field209 invalid GSRN with final negative ACK and stable retry', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000008::9')), 'E66', 'test', '2026-10-15T20:00:00Z') // strict 25-A-4
  const first = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('209')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ company: f.ids.company, disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const prior = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(prior)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each([['E30', 'invalid'], ['E30', 'missing'], ['S07', 'invalid'], ['S07', 'missing']] as const)(
  'native inbound holds %s LOC+172 %s at 209 through final ACK and retry', async (code, defect) => {
  const f = await seed(), application = code === 'E30' ? '23-MDR-E30-T' : '23-DDQ-S07-T'
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : 'BGM+E30::260')
    .replace('23-DDQ-E66-T', application)
    .replace('LOC+172+735999260731000007::9', defect === 'invalid' ? 'LOC+172+735999260731000008::9' : '')
  const source = await f.insertSource(ownIdentity(raw), code, 'test', '2026-10-15T20:00:00Z') // strict 25-A-4
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = code === 'S07' ? processInboundUtiltsMessageByCanonicalPolicy : processInboundUtiltsMessage
  const first = await run({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('209')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ company: f.ids.company, disposition: 'guide_rejected',
    plan: 'negative_aperak', final: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const prior = snapshot(source.id)
  await run({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(prior)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  })
it('native S01 stores supplied LOC+175 field533 rejection with no aggregate or individual effects on retry', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')
  const source = await f.insertSource(ownIdentity(raw), 'S01', 'test', '2026-10-15T20:00:00Z') // strict 25-A-4
  // An S01 aggregate source cannot borrow the fixture's individual customer/point link.
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  const first = await run()
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0].draft)).toContain('533')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ company: f.ids.company, disposition: 'guide_rejected',
    plan: 'negative_aperak', final: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  await run()
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native valid S01 LOC+175 holds its ACK/series until a distinct object owner exists, including retry', async () => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9').replaceAll('GRIDEX2607E66001', 'S01OBJECT001')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect((await run()).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ company: f.ids.company, disposition: 'internal_review', plan: 'none', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['object-first', 'point-first'] as const)(
  'native mixed S01 %s keeps the object held and the point sibling durable across retry', async order => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(start, end)
  const second = point.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  const object = (order === 'object-first' ? point : second).map(line =>
    line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9'))
  const sibling = order === 'object-first' ? second : point
  lines.splice(start, end - start, ...(order === 'object-first' ? [...object, ...sibling] : [...sibling, ...object]))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  const raw = lines.join('\n').replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.transactionDispositions.map(item => item.disposition)).toEqual(['accepted', 'accepted'])
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  const first = await run()
  expect(first.internalReviewRequired).toBe(true)
  const rows = sql<Array<{ id: string; disposition: string; plan: string; final: string | null; series: string | null }>>(`
   SELECT jsonb_agg(jsonb_build_object('id',source_transaction_id,'disposition',disposition,
    'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id) ORDER BY source_transaction_id)
   FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`)
  expect(rows).toHaveLength(2)
  const heldId = order === 'object-first' ? 'GRIDEX2607E66001' : 'GRIDEX2607E66002'
  const pointId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  expect(rows.find(row => row.id === heldId)).toMatchObject({ disposition: 'internal_review', plan: 'none', final: null, series: null })
  expect(rows.find(row => row.id === pointId)).toMatchObject({ disposition: 'accepted', plan: 'positive_aperak', final: 'positive_aperak', series: expect.any(String) })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(1)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(1)
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0].draft)).toContain(pointId)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['object-first', 'point-first'] as const)(
  'native mixed S01 %s resumes only the point ACK after an interruption, preserving the held object', async order => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(start, end)
  const second = point.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  const object = (order === 'object-first' ? point : second).map(line =>
    line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9'))
  const sibling = order === 'object-first' ? second : point
  lines.splice(start, end - start, ...(order === 'object-first' ? [...object, ...sibling] : [...sibling, ...object]))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  const raw = lines.join('\n').replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  const heldId = order === 'object-first' ? 'GRIDEX2607E66001' : 'GRIDEX2607E66002'
  const pointId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  const outcomes = () => sql<Array<{ id: string; disposition: string; plan: string; final: string | null; series: string | null }>>(`
   SELECT jsonb_agg(jsonb_build_object('id',source_transaction_id,'disposition',disposition,
    'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id) ORDER BY source_transaction_id)
   FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`)

  let aperakInterrupted = false
  effects.ack.mockImplementation(async ({ sourceMessage, ackFamily }: { sourceMessage: EdielMessageRow; ackFamily: string }) => {
    if (ackFamily === 'APERAK' && !aperakInterrupted) {
      aperakInterrupted = true
      throw new Error('after_mixed_s01_reservation_before_ack')
    }
    return { id: sourceMessage.id }
  })
  await expect(run()).rejects.toThrow('after_mixed_s01_reservation_before_ack')
  expect(outcomes().find(row => row.id === heldId)).toMatchObject({ disposition: 'internal_review', plan: 'none', final: null, series: null })
  expect(outcomes().find(row => row.id === pointId)).toMatchObject({ disposition: 'accepted', plan: 'positive_aperak', final: null, series: expect.any(String) })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(1)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(1)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const heldBefore = sql(`SELECT to_jsonb(a) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${lit(source.id)} AND source_transaction_id=${lit(heldId)}`)

  effects.ack.mockClear()
  expect((await run()).internalReviewRequired).toBe(true)
  expect(outcomes().find(row => row.id === heldId)).toMatchObject({ disposition: 'internal_review', plan: 'none', final: null, series: null })
  expect(outcomes().find(row => row.id === pointId)).toMatchObject({ disposition: 'accepted', plan: 'positive_aperak', final: 'positive_aperak', series: expect.any(String) })
  expect(sql(`SELECT to_jsonb(a) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${lit(source.id)} AND source_transaction_id=${lit(heldId)}`)).toEqual(heldBefore)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(1)
  expect(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0]).toMatchObject({ ackFamily: 'APERAK', outcome: 'positive',
    draft: { parsedPayload: { ackScope: 'transaction', relatedTransactionReference: pointId } } })
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  const completed = snapshot(source.id)
  effects.ack.mockClear()
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(completed)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['object-first', 'point-first'] as const)(
  'native mixed S01 %s keeps an unowned object held beside a negative guide sibling on retry', async order => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(start, end)
  const second = point.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  const object = (order === 'object-first' ? point : second).map(line =>
    line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9'))
  const rejected = (order === 'object-first' ? second : point).map(line =>
    line.replace('LOC+239+TES:SVK:260', 'LOC+239+ABCD:SVK:260'))
  lines.splice(start, end - start, ...(order === 'object-first' ? [...object, ...rejected] : [...rejected, ...object]))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  const raw = lines.join('\n').replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  expect(runUtiltsRuntimeForMessage(source).transactionDispositions.map(item => item.disposition))
    .toEqual(order === 'object-first' ? ['accepted', 'guide_rejected'] : ['guide_rejected', 'accepted'])
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect((await run()).internalReviewRequired).toBe(true)
  const rows = sql<Array<{ id: string; disposition: string; plan: string; final: string | null; series: string | null }>>(`
   SELECT jsonb_agg(jsonb_build_object('id',source_transaction_id,'disposition',disposition,
    'plan',planned_response_type,'final',final_response_type,'series',persisted_series_id) ORDER BY source_transaction_id)
   FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`)
  const heldId = order === 'object-first' ? 'GRIDEX2607E66001' : 'GRIDEX2607E66002'
  const rejectedId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  expect(rows.find(row => row.id === heldId)).toMatchObject({ disposition: 'internal_review', plan: 'none', final: null, series: null })
  expect(rows.find(row => row.id === rejectedId)).toMatchObject({ disposition: 'guide_rejected', plan: 'negative_aperak', final: 'negative_aperak', series: null })
  expect(rows).toHaveLength(2)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  const acks = effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')
  expect(acks).toHaveLength(1)
  expect(acks[0][0]).toMatchObject({ ackFamily: 'APERAK', outcome: 'negative',
    draft: { parsedPayload: { ackScope: 'transaction', relatedTransactionReference: rejectedId } } })
  expect(JSON.stringify(acks[0][0].draft)).toContain('260a')
  expect(effects.outbound).not.toHaveBeenCalled()
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each(['object-first', 'point-first'] as const)(
  'native mixed S01 %s rolls back the held reservation when its point sibling cannot persist, then retries', async order => {
  const f = await seed()
  const lines = f.original.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(start, end)
  const second = point.map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  const object = (order === 'object-first' ? point : second).map(line =>
    line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9'))
  const sibling = order === 'object-first' ? second : point
  lines.splice(start, end - start, ...(order === 'object-first' ? [...object, ...sibling] : [...sibling, ...object]))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  const raw = lines.join('\n').replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const source = await f.insertSource(raw, 'S01')
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  const suffix = randomUUID().replaceAll('-', '')
  sql(`CREATE FUNCTION public.native_mixed_s01_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'synthetic_mixed_s01_point_storage_failure'; END $$;
   CREATE TRIGGER native_mixed_s01_fail_${suffix} BEFORE INSERT ON public.meter_reading_series
   FOR EACH ROW WHEN (NEW.source_ediel_message_id=${lit(source.id)}::uuid)
   EXECUTE FUNCTION public.native_mixed_s01_fail_${suffix}();`)
  try {
    await expect(run()).rejects.toThrow('synthetic_mixed_s01_point_storage_failure')
    expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
    expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
    expect(effects.ack).not.toHaveBeenCalled(); expect(effects.outbound).not.toHaveBeenCalled()
    expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  } finally {
    sql(`DROP TRIGGER native_mixed_s01_fail_${suffix} ON public.meter_reading_series;
     DROP FUNCTION public.native_mixed_s01_fail_${suffix}();`)
  }
  expect((await run()).internalReviewRequired).toBe(true)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'final',final_response_type,'series',persisted_series_id)
   ORDER BY source_transaction_id) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual(order === 'object-first'
      ? [{ disposition: 'internal_review', final: null, series: null }, { disposition: 'accepted', final: 'positive_aperak', series: expect.any(String) }]
      : [{ disposition: 'accepted', final: 'positive_aperak', series: expect.any(String) }, { disposition: 'internal_review', final: null, series: null }])
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(1)
  expect(effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(1)
  expect(effects.complete).not.toHaveBeenCalled()
  const before = snapshot(source.id)
  expect((await run()).internalReviewRequired).toBe(true)
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each([
  ['E72', '23-MDR-E30-S', 'LOC+172', '209', 'invalid'],
  ['E72', '23-MDR-E30-S', 'LOC+172', '209', 'missing'],
  // Inbound E73 is outbound-only in the source catalog; see the E73 hold test.
  ['S06', '23-DDK-S01-S', 'LOC+175', '533', 'invalid'],
] as const)('native %s identity rejection retains final ACK and zero effects on retry', async (code, application, location, fieldCode, defect) => {
  const f = await seed()
  const raw = f.original.raw_payload!
    .replace('BGM+E66::260', `BGM+${code}${code === 'S06' ? ':SVK' : ':'}:260`)
    .replace('23-DDQ-E66-T', application)
    .replace('LOC+172+735999260731000007::9', defect === 'missing' ? '' : `${location}+735999260731000008::9`)
  const source = await f.insertSource(ownIdentity(raw), code, 'test', '2026-10-15T20:00:00Z') // strict 25-A-4
  sql(`UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL,grid_owner_data_request_id=NULL WHERE id=${lit(source.id)}`)
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const run = () => processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: f.ids.actor, edielMessageId: source.id })
  const first = await run()
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0].draft)).toContain(fieldCode)
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,
   'final',final_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results
   WHERE source_message_id=${lit(source.id)}`)).toEqual([{ company: f.ids.company, disposition: 'guide_rejected',
    plan: 'negative_aperak', final: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  await run()
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound persists supplied 260a grid-area guide rejection without a consumable series', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace('LOC+239+TES:SVK:260', 'LOC+239+ABCD:SVK:260')))
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('260a')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ company: f.ids.company, disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it.each([['232', '260c'], ['233', '260b']] as const)('native orphan LOC+%s persists negative %s and no consumption on retry', async (present, missing) => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace("LOC+239+TES:SVK:260'", `LOC+239+TES:SVK:260'\nLOC+${present}+ABC:SVK:260'`).split('\n')
  lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.length - 2}+1'`
  const source = await f.insertSource(lines.join('\n'))
  const first = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(first.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain(missing)
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',company_id,'disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`))
    .toEqual([{ company: f.ids.company, disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  const before = snapshot(source.id)
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native mixed IDE consumes only the accepted sibling before separate 260a ACKs and retries identically', async () => {
  const f = await seed()
  const lines = f.original.raw_payload!.replace('LOC+239+TES:SVK:260', 'LOC+239+ABCD:SVK:260').split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const close = lines.findIndex(line => line.startsWith('UNT+'))
  const sibling = lines.slice(start, close).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002').replace('LOC+239+ABCD:SVK:260', 'LOC+239+TES:SVK:260').replace('QTY+136:500', 'QTY+136:7'))
  lines.splice(close, 0, ...sibling)
  lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.length - 2}+1'`
  const source = await f.insertSource(lines.join('\n'))
  await realSinks()
  effects.ack.mockRejectedValueOnce(new Error('after_partial_consumption_before_ack'))
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id }))
    .rejects.toThrow('after_partial_consumption_before_ack')
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(effects.complete).not.toHaveBeenCalled()
  effects.ack.mockClear(); effects.meter.mockClear(); effects.bill.mockClear()
  const first = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('id',source_transaction_id,'disposition',disposition,'plan',planned_response_type,'series',persisted_series_id IS NOT NULL) ORDER BY source_transaction_id) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`))
    .toEqual([{ id: 'GRIDEX2607E66001', disposition: 'guide_rejected', plan: 'negative_aperak', series: false },
      { id: 'GRIDEX2607E66002', disposition: 'accepted', plan: 'positive_aperak', series: true }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(1)
  const aperaks = effects.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(2)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('260a')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(effects.meter).toHaveBeenCalledTimes(1)
  expect(effects.bill).toHaveBeenCalledTimes(1)
  expect(effects.meter.mock.calls[0][0]).toMatchObject({ companyId: f.ids.company, quantityKwh: 7, sourceTransactionReference: 'GRIDEX2607E66002' })
  expect(effects.meter.mock.invocationCallOrder[0]).toBeLessThan(effects.ack.mock.invocationCallOrder[0])
  expect(first.ingestedMeterValueIds).toHaveLength(1)
  expect(first.billingUnderlayId).toBeTruthy()
  expect(effects.complete).not.toHaveBeenCalled()
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  const before = snapshot(source.id)
  const second = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(second.ingestedMeterValueIds).toEqual(first.ingestedMeterValueIds)
  expect(second.billingUnderlayId).toBe(first.billingUnderlayId)
  expect(snapshot(source.id)).toEqual(before)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(effects.complete).not.toHaveBeenCalled()
})
it('native inbound holds a six-digit SVK receiver at field 208 for manual review with no consumable series', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace(`NAD+MR+${f.ids.ediel}:SVK:260`, `NAD+MR+${f.ids.ediel}0:SVK:260`)))
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  // The receiver id itself is unknown: no own legal identity can sign a reply,
  expect(result.internalReviewRequired).toBe(true) // so it is held for manual review
  expect(effects.ack).not.toHaveBeenCalled()
  expect(sql(`SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  expect(result.ackIds).toEqual([])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound holds an agency-305 GLN receiver at field 208 for manual review without consumption', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace(`NAD+MR+${f.ids.ediel}:SVK:260`, 'NAD+MR+7359990000014::305')))
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  // The receiver id itself is unknown: no own legal identity can sign a reply,
  expect(result.internalReviewRequired).toBe(true) // so it is held for manual review
  expect(effects.ack).not.toHaveBeenCalled()
  expect(sql(`SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)}`)).toBe(0)
  expect(result.ackIds).toEqual([])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('native inbound stores unknown header NAD role 509 rejection without consumable series', async () => {
  const f = await seed()
  const source = await f.insertSource(ownIdentity(f.original.raw_payload!.replace("NAD+DDQ'", "NAD+BAD'")))
  const result = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(result.ingestedMeterValueIds).toEqual([])
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(effects.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(effects.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('509')
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('disposition',disposition,'plan',planned_response_type,'series',persisted_series_id)) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND company_id=${lit(f.ids.company)}`))
    .toEqual([{ disposition: 'guide_rejected', plan: 'negative_aperak', series: null }])
  expect(sql(`SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=${lit(source.id)}`)).toBe(0)
  expect(consumedCount(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})
it('R3 direct persistence HTTP cannot mint agency89 authority from forged plain-ID accepted contract', async () => {
  const f = await seed(), supported = await f.prepare()
  const source = await f.insertSource(f.original.raw_payload!.replace('735999260731000007::9', '735999260731000007::89'))
  const { error } = await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', {
    p_company_id: f.ids.company, p_environment: 'test', p_source_message_id: source.id, p_message_code: 'E66', p_raw_payload: source.raw_payload!, p_actor_user_id: f.ids.actor,
    p_transactions: supported.transactions.map((t, i) => ({ ...t, consumptionContract: supported.contracts[i] })),
  })
  expect(error?.message).toMatch(forgedRefusal('consumption_identity_unsupported'))
  expect(snapshot(source.id)).toEqual({ acks: null, series: null, contracts: null })
  expect(sql(`SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id=${lit(source.id)}`)).toBe(0)
})
it.each([false, true])('R4 real permission/no-request processor holds failed write, earlier sibling committed=%s', async sibling => {
  const f = await seed(), permission = randomUUID()
  let source = f.original
  if (sibling) {
    const lines = f.original.raw_payload!.replace('BGM+E66', 'BGM+E30').replace('23-DDQ-E66-T', '23-MDR-E30-T')
      .replace('202607010000202607010015:719', '202607010000202607010030:719').split('\n')
    const at = lines.findIndex(line => line.startsWith('UNT+'))
    lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", "DTM+597:202607010015:203'", "STS+7++21::260'")
    lines[at + 4] = `UNT+${at + 3}+1'`
    source = await f.insertSource(ownIdentity(lines.join('\n')), 'E30')
  }
  sql(`UPDATE public.ediel_messages SET grid_owner_data_request_id=NULL WHERE company_id=${lit(f.ids.company)};
   DELETE FROM public.grid_owner_data_requests WHERE id=${lit(f.ids.request)};
   INSERT INTO public.metering_permissions(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,status)
   VALUES(${lit(permission)},${lit(f.ids.company)},${lit(f.ids.customer)},${lit(f.ids.site)},${lit(f.ids.site)},${lit(f.ids.point)},${lit(f.ids.grid)},'active');`)
  await realSinks()
  const actual = await vi.importActual<typeof import('@/lib/metering/normalizeMeteringValues')>('@/lib/metering/normalizeMeteringValues')
  let ordinal = 0
  effects.meter.mockImplementation(async input => {
    if (ordinal++ === (sibling ? 1 : 0)) {
      expect(sql(`SELECT count(*) FROM gridex_utilts_binding.contracts WHERE source_message_id=${lit(source.id)}`)).toBe(1)
      sql(`UPDATE public.metering_points SET site_id=NULL,customer_site_id=NULL WHERE id=${lit(f.ids.point)}`)
    }
    return actual.normalizeAndStoreMeteringValue(input)
  })
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })).rejects.toThrow('metering_not_stored')
  expect(effects.ack).not.toHaveBeenCalled(); expect(effects.complete).not.toHaveBeenCalled()
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated')).toBe(false)
  expect(consumedCount(f.ids.company)).toEqual({ meter: sibling ? 1 : 0, billing: 0 })
  expect(sql(`SELECT count(*) FROM public.ediel_ack_transaction_results WHERE source_message_id=${lit(source.id)} AND (finalized_at IS NOT NULL OR response_message_id IS NOT NULL)`)).toBe(0)
  const committed = sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.metering_values WHERE company_id=${lit(f.ids.company)}`)
  sql(`UPDATE public.metering_points SET site_id=${lit(f.ids.site)},customer_site_id=${lit(f.ids.site)} WHERE id=${lit(f.ids.point)}`)
  effects.meter.mockImplementation(actual.normalizeAndStoreMeteringValue)
  const replay = await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: source.id })
  expect(replay.ingestedMeterValueIds).toHaveLength(sibling ? 2 : 1)
  expect(replay.ingestedMeterValueIds).toEqual(expect.arrayContaining(committed))
  expect(effects.status.mock.calls.some(([call]) => call.status === 'validated' && call.parsedPayload?.matchedMeteringPermissionId === permission)).toBe(true)
  expect(effects.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK')).toBe(true)
})
it('C1 restored case history is tenant-classified with real RLS and client access closed', () => {
  expect(sql(`SELECT jsonb_build_object('kind',kind,'nullMeaning',null_company_meaning) FROM public.platform_table_classification WHERE table_name='customer_case_events'`)).toEqual({ kind: 'tenant', nullMeaning: null })
  expect(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_case_events'::regclass`)).toBe(true)
  expect(sql(`SELECT attnotnull FROM pg_attribute WHERE attrelid='public.customer_case_events'::regclass AND attname='company_id'`)).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    expect(sql(`SELECT has_table_privilege(${lit(role)},'public.customer_case_events','SELECT,INSERT,UPDATE,DELETE')`)).toBe(false)
  }
  expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid='public.customer_case_events'::regclass AND conname IN ('customer_case_events_case_owner_fk','customer_case_events_customer_company_fk') AND convalidated`)).toBe(2)
})


it('native prospective persistence and immutable replay require a current own operator', async () => {
  const f = await seed(), foreign = await seed(), input = await f.prepare()
  const args = { p_company_id: input.companyId, p_environment: input.environment, p_source_message_id: input.sourceMessageId,
    p_message_code: input.messageCode, p_raw_payload: input.rawPayload,
    p_transactions: input.transactions.map((item, i) => ({ ...item, consumptionContract: input.contracts[i] })) }
  const state = () => ({ bound: snapshot(f.original.id), receipts: sql(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)
    FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(f.original.id)}`) })
  const before = state()
  for (const actor of [undefined, null, foreign.ids.actor]) {
    const refused = await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', {
      ...args, ...(actor === undefined ? {} : { p_actor_user_id: actor }),
    })
    expect(refused.error).toMatchObject({ code: '42501', message: 'utilts_execution_actor_forbidden' })
    expect(state()).toEqual(before)
  }
  await persistUtiltsTransactionResults(input)
  const committed = state()
  sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${lit(f.ids.company)} AND user_id=${lit(f.ids.actor)}`)
  const replay = await nativePersistenceRpc('gridex_persist_utilts_consumption_v1', { ...args, p_actor_user_id: f.ids.actor })
  expect(replay.error).toMatchObject({ code: '42501', message: 'utilts_execution_actor_forbidden' })
  expect(state()).toEqual(committed)
  expect(effects.meter).not.toHaveBeenCalled(); expect(effects.bill).not.toHaveBeenCalled(); expect(effects.ack).not.toHaveBeenCalled()
})
