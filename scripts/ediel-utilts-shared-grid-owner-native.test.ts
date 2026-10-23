// reality-defects: F101
// FINDINGS F101 (reality world 2026-10-23, scenario F run 21): after a confirmed switch the grid
// owner's UTILTS E66 files were validated, but every bound consumption sink refused with
// utilts_consumption_grid_owner_changed, because gridex_utilts_binding.lock_attribution_v1
// required grid_owners.company_id = tenant. In the registry model (F41) the grid owner is a
// platform-shared row (company_id IS NULL) that the tenant's own site and metering point name
// (F58), so no metering value could ever be stored.
// Proved natively on the owned local stack with the real parser, canonical policy, preparation,
// persistence RPC, full UTILTS processor and the real metering/billing sinks:
// - a tenant point/site/request on a shared grid owner the tenant is bound to stores the E66;
// - a shared grid owner the tenant's data does not name is still refused;
// - another tenant's grid owner is still refused, even when the tenant's own rows name it.
// Synthetic data only.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from '../__tests__/helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture, utiltsRecountUnt, utiltsTestEnvironmentWire } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { assertUtiltsConsumptionPartiesBound } from './helpers/utiltsConsumptionBoundParties'
import { recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, seedUtiltsConsumptionParties, seedUtiltsIssuerHistoryGround, setUtiltsReceiverRole } from './helpers/utiltsConsumptionParties'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults } from '@/lib/ediel/utilts/transactionPersistence'
import { createBoundUtiltsBilling, ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

// Only external notifications (ACK send, request completion, status/event rows) are observed;
// the metering and billing sinks are the real writers.
const effects = vi.hoisted(() => ({ ack: vi.fn(), complete: vi.fn(), outbound: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(), syncGridOwnerDataRequestReceivedFromEdiel: effects.complete, findOpenOutboundBySource: effects.outbound }))
vi.mock('@/lib/ediel/core/kernel', async original => ({ ...await original<Record<string, unknown>>(), createCanonicalAckMessage: effects.ack }))
vi.mock('@/lib/ediel/db', async original => ({ ...await original<Record<string, unknown>>(), linkEdielMessage: vi.fn(), createEdielMessageEvent: vi.fn(), updateEdielMessageStatus: effects.status }))

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit = (value: unknown) => value === null ? 'NULL' : "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T = unknown>(input: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_local_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000, maxBuffer: 2000000 }).trim()
  if (result === 't' || result === 'f') return (result === 't') as T
  return result ? JSON.parse(result) as T : undefined as T
}
/** Runs SQL as the migration owner and returns the raised message, or null when it succeeded. */
function sqlError(input: string): string | null {
  try { sql(input); return null } catch (error) { return String((error as { stderr?: string }).stderr ?? error) }
}
const consumed = (company: string) => sql(`SELECT jsonb_build_object('meter',(SELECT count(*) FROM public.metering_values WHERE company_id=${lit(company)}),'billing',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${lit(company)}))`)
const sharedGridOwners: string[] = []
const insertGridOwner = (id: string, company: string | null, ediel: string) => {
  if (company === null) sharedGridOwners.push(id)
  sql(`INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${lit(id)},${lit(company)},${lit(`F101 synthetic ${id}`)},${lit(ediel)},'test',true,'active')`)
}

type Ownership = 'shared' | 'foreign'
async function seed(ownership: Ownership) {
  const ids = { company: randomUUID(), other: randomUUID(), customer: randomUUID(), point: randomUUID(), site: randomUUID(), grid: randomUUID(), request: randomUUID(), actor: randomUUID(), ediel: '', issuer: '' }
  const { ediel, issuer } = seedUtiltsConsumptionParties(sql, lit, ids.actor)
  ids.ediel = ediel; ids.issuer = issuer
  const message = energyHandoffMessage('2026-10-01', ids.company)
  const raw = message.raw_payload!.replace('?+0200:406', '?+0100:406').replaceAll('260831181101', randomUUID().slice(0, 12).replaceAll('-', ''))
    .replace('+21660:ZZ+', `+${ediel}:ZZ+`).replace('NAD+MR+21660:SVK:260', `NAD+MR+${ediel}:SVK:260`)
    .replace('+91100:ZZ+', `+${issuer}:ZZ+`).replace('NAD+MS+91100:SVK:260', `NAD+MS+${issuer}:SVK:260`)
  assertUtiltsConsumptionPartiesBound(raw, { ediel, issuer })
  const email = `f101-${ids.actor}@example.invalid`
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'F101 shared grid owner synthetic','active'),(${lit(ids.other)},'F101 other tenant synthetic','active');
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
   VALUES(${lit(ids.actor)},'authenticated','authenticated',${lit(email)},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at) VALUES(${lit(ids.actor)},${lit(email)},'Synthetic F101 operator','active',now(),now()) ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${lit(ids.company)},${lit(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${lit(ids.actor)},${lit(ids.company)},id,key FROM public.permissions WHERE key IN('metering.write','communication.read','communication.write','communication.send');
   INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) SELECT ${lit(ids.company)},e,'electricity',true,clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'EdielId',${lit(ediel)},clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','private');`)
  // The registry model: one platform-shared grid owner row (company_id NULL). The foreign
  // case gives the same issuer to another tenant's own grid owner row instead.
  insertGridOwner(ids.grid, ownership === 'shared' ? null : ids.other, issuer)
  sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},'735999260731000007','735999260731000007',${lit(ids.grid)});
   INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(ids.request)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'billing_underlay');`)
  setUtiltsReceiverRole(sql, lit, ids.company, ids.actor, 'E66')
  const sourceId = randomUUID()
  const fixture = utiltsNativeSourceFixture(utiltsRecountUnt(utiltsTestEnvironmentWire(raw.replace(/(BGM\+[^+']*\+)[^+']+/, `$1M${sourceId.replaceAll('-', '').slice(0, 20)}`))), sourceId)
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
   SELECT ${lit(fixture.id)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},${lit(ids.request)},'test','inbound','edifact','UTILTS','E66','received',${lit(fixture.raw)},'{}','2026-10-01T20:00:00Z','{}',${lit(fixture.parsed.applicationReference)},${lit(issuer)},${lit(ediel)},${lit(fixture.parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
   FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
  seedUtiltsIssuerHistoryGround(sql, lit, fixture.id, ids.actor)
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', fixture.id).single()
  expect(error).toBeNull()
  const source = data as unknown as EdielMessageRow
  await recordUtiltsTechnicalReception(source, ids.actor)
  // The product's own preparation and persistence: the grid owner in the stored contract is the
  // one the tenant's metering point names.
  const persist = async () => {
    const runtime = await recordUtiltsFinalRuntime(source)
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: ids.point, customerId: ids.customer, siteId: ids.site, gridOwnerId: ids.grid, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
    const dataRequest = { id: ids.request, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point, grid_owner_id: ids.grid, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
    const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy: resolveCanonicalMessagePolicy(source)!, matches, dataRequest,
      fallback: { customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point, gridOwnerId: ids.grid }, allowConsumption: true })
    expect(contracts[0].metering).toMatchObject({ capability: 'write', gridOwnerId: ids.grid, meteringPointId: ids.point })
    return persistUtiltsTransactionResults({ actorUserId: ids.actor, companyId: ids.company, environment: source.environment, sourceMessageId: source.id, messageCode: 'E66', rawPayload: source.raw_payload!, contracts,
      transactions: buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) })
  }
  return { ids, source, persist }
}
/** Calls the installed attribution lock directly with the stored contract's attribution shape. */
function lockAttribution(company: string, attribution: Record<string, string | null>, billing = false) {
  return sqlError(`SELECT gridex_utilts_binding.lock_attribution_v1(${lit(company)},${lit({ capability: 'write', reason: null, customerId: null, siteId: null, customerSiteId: null, meteringPointId: null, gridOwnerId: null, sourceRequestId: null, ...attribution })}::jsonb,${billing})`)
}

beforeEach(() => {
  vi.clearAllMocks()
  effects.status.mockResolvedValue(null); effects.complete.mockResolvedValue(null); effects.outbound.mockResolvedValue(null)
  effects.ack.mockImplementation(async ({ sourceMessage }: { sourceMessage: EdielMessageRow }) => ({ id: sourceMessage.id }))
})
afterAll(() => {
  // Leave no synthetic platform-shared rows in the registry of the owned local world.
  if (sharedGridOwners.length) sql(`DELETE FROM public.grid_owners WHERE company_id IS NULL AND name LIKE 'F101 synthetic %' AND id IN (${sharedGridOwners.map(lit).join(',')})`)
})

it('full UTILTS processor stores the E66 consumption and billing underlay for a tenant point on a bound shared grid owner', async () => {
  const f = await seed('shared')
  expect(sql(`SELECT jsonb_build_object('company',company_id) FROM public.grid_owners WHERE id=${lit(f.ids.grid)}`)).toEqual({ company: null }) // platform-shared
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.source.id })
  expect(consumed(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  expect(sql(`SELECT jsonb_build_object('value',value_kwh,'customer',customer_id,'site',site_id,'point',metering_point_id,'grid',grid_owner_id) FROM public.metering_values WHERE company_id=${lit(f.ids.company)}`))
    .toEqual({ value: 500, customer: f.ids.customer, site: f.ids.site, point: f.ids.point, grid: f.ids.grid })
  expect(sql(`SELECT jsonb_build_object('kwh',total_kwh,'grid',grid_owner_id,'request',source_request_id) FROM public.billing_underlays WHERE company_id=${lit(f.ids.company)}`))
    .toEqual({ kwh: 500, grid: f.ids.grid, request: f.ids.request })
  expect(effects.complete).toHaveBeenCalled()
  // The operator's retry ("Återuppta hållna transaktioner") is idempotent on the same rows.
  await processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.source.id })
  expect(consumed(f.ids.company)).toEqual({ meter: 1, billing: 1 })
  // The binding is any tenant-owned row of this attribution that names the shared grid owner.
  expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, meteringPointId: f.ids.point, siteId: f.ids.site, customerSiteId: f.ids.site, gridOwnerId: f.ids.grid })).toBeNull()
  expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, siteId: f.ids.site, customerSiteId: f.ids.site, gridOwnerId: f.ids.grid })).toBeNull()
  const request = randomUUID() // a billing request without site or point names the grid owner on its own
  sql(`INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,grid_owner_id,request_scope) VALUES(${lit(request)},${lit(f.ids.company)},${lit(f.ids.customer)},${lit(f.ids.grid)},'billing_underlay')`)
  expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, gridOwnerId: f.ids.grid, sourceRequestId: request }, true)).toBeNull()
})

it('a shared grid owner that the tenant data does not name is still refused', async () => {
  const f = await seed('shared'), unbound = randomUUID()
  insertGridOwner(unbound, null, f.ids.issuer)
  // Directly: no tenant-owned point, site or request names this shared row.
  expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, gridOwnerId: unbound })).toMatch(/utilts_consumption_grid_owner_changed/)
  expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, gridOwnerId: unbound, sourceRequestId: f.ids.request }, true)).toMatch(/utilts_consumption_grid_owner_changed/)
  // A bound shared row is not borrowed by a customer whose own rows do not name it.
  const stranger = randomUUID()
  sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(stranger)},${lit(f.ids.company)},${lit(stranger)},'Synthetic stranger','private')`)
  expect(lockAttribution(f.ids.company, { customerId: stranger, gridOwnerId: f.ids.grid })).toMatch(/utilts_consumption_grid_owner_changed/)
  // End to end: the stored contract names the bound shared row; the tenant's rows then move to
  // another shared row, so the attributed grid owner is no longer the tenant's. Nothing is stored.
  const outcomes = await f.persist()
  sql(`UPDATE public.metering_points SET grid_owner_id=${lit(unbound)} WHERE id=${lit(f.ids.point)};
   UPDATE public.customer_sites SET grid_owner_id=${lit(unbound)} WHERE id=${lit(f.ids.site)};
   UPDATE public.grid_owner_data_requests SET grid_owner_id=${lit(unbound)} WHERE id=${lit(f.ids.request)};`)
  await expect(ingestBoundUtiltsMetering({ actorUserId: f.ids.actor, message: f.source, boundOutcomes: outcomes })).rejects.toThrow('utilts_consumption_binding_conflict:metering_not_stored')
  // The service sink itself, called with the stored contract, refuses in SQL as well.
  expect(sqlError(`SELECT public.gridex_consume_utilts_metering_v1(${lit(f.ids.company)},${lit(f.source.id)},c.transaction_id,0,${lit(f.ids.actor)},c.contract)
   FROM gridex_utilts_binding.contracts c WHERE c.source_message_id=${lit(f.source.id)}`)).toMatch(/utilts_consumption_(site|point)_ownership_changed/)
  await expect(createBoundUtiltsBilling({ actorUserId: f.ids.actor, message: f.source, boundOutcomes: outcomes, existingBillingUnderlayId: null })).rejects.toThrow('utilts_consumption_binding_conflict:billing_ownership_changed')
  expect(sqlError(`SELECT public.gridex_consume_utilts_billing_v1(${lit(f.ids.company)},${lit(f.source.id)},${lit(f.ids.actor)},
   (SELECT jsonb_agg(c.contract ORDER BY c.transaction_id) FROM gridex_utilts_binding.contracts c WHERE c.source_message_id=${lit(f.source.id)}))`)).toMatch(/utilts_consumption_(site|point)_ownership_changed/)
  expect(consumed(f.ids.company)).toEqual({ meter: 0, billing: 0 })
})

it("another tenant's grid owner is refused even when the tenant's own rows name it", async () => {
  const f = await seed('foreign')
  expect(sql(`SELECT jsonb_build_object('company',company_id) FROM public.grid_owners WHERE id=${lit(f.ids.grid)}`)).toEqual({ company: f.ids.other })
  await expect(processInboundUtiltsMessage({ actorUserId: f.ids.actor, edielMessageId: f.source.id })).rejects.toMatchObject({ message: expect.stringMatching(/utilts_consumption_grid_owner_changed/) })
  expect(consumed(f.ids.company)).toEqual({ meter: 0, billing: 0 })
  expect(effects.complete).not.toHaveBeenCalled()
  const attributions: Array<Record<string, string>> = [{ meteringPointId: f.ids.point, siteId: f.ids.site, customerSiteId: f.ids.site }, { siteId: f.ids.site, customerSiteId: f.ids.site }, {}]
  for (const attribution of attributions)
    expect(lockAttribution(f.ids.company, { customerId: f.ids.customer, gridOwnerId: f.ids.grid, sourceRequestId: f.ids.request, ...attribution }, true)).toMatch(/utilts_consumption_grid_owner_changed/)
})
