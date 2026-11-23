// claude-track3/017: readers of meter_reading_series.is_current after an
// equal-532 UTILTS version with different content. COMMITTING native suite on
// the disposable local stack: each run seeds its own synthetic tenant, actor,
// issuer and metering point (prefix t3-017-<run>). Seed and production-order
// preparation are taken from scripts/ediel-utilts-consumption-native.test.ts
// (seed/insertSource/prepare) and scripts/helpers/utiltsConsumptionParties.ts.
// Mode: SERIES_CURRENT_BASELINE=1 asserts the old persist_series_v2 body and
// the pre-fix outcome; default asserts the fixed outcome and requires
// 20261030130900 to be applied to the stack (never applied by this test).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { cleanE30SourceFixture } from './helpers/utiltsConsumptionSourceFixture'
import { energyHandoffMessage } from '../__tests__/helpers/utiltsObservationHandoff'
import { utiltsNativeSourceFixture, utiltsRecountUnt, utiltsTestEnvironmentWire } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { assertUtiltsConsumptionPartiesBound } from './helpers/utiltsConsumptionBoundParties'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults } from '@/lib/ediel/utilts/transactionPersistence'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { recordUtiltsFinalRuntime, recordUtiltsTechnicalReception, seedUtiltsConsumptionParties, setUtiltsReceiverRole, seedUtiltsIssuerHistoryGround } from './helpers/utiltsConsumptionParties'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PREIMAGE = 'afd313aca7c2ba1ef5022c766eb2852669042b6fc37c7fd3e8dffeb9624d712f'
const BASELINE = process.env.SERIES_CURRENT_BASELINE === '1'
const lit = (value: unknown) => value === null ? 'NULL' : "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T = unknown>(input: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_local_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 4000000 }).trim()
  if (result === 't' || result === 'f') return (result === 't') as T
  return result ? JSON.parse(result.split('\n').filter(Boolean).at(-1)!) as T : undefined as T
}

async function seed() {
  const run = randomUUID().slice(0, 8)
  const ids = { company: randomUUID(), customer: randomUUID(), point: randomUUID(), site: randomUUID(), grid: randomUUID(), request: randomUUID(), actor: randomUUID(), ediel: '', issuer: '' }
  const facility = '735999260731000007' // template point; series identity is per tenant
  const { ediel, issuer } = seedUtiltsConsumptionParties(sql, lit, ids.actor)
  ids.ediel = ediel; ids.issuer = issuer
  const mail = `t3-017-${run}-${ids.actor}@example.invalid`
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},${lit(`t3-017-${run} synthetic`)},'active');
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
   VALUES(${lit(ids.actor)},'authenticated','authenticated',${lit(mail)},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at) VALUES(${lit(ids.actor)},${lit(mail)},'t3-017 synthetic actor','active',now(),now()) ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${lit(ids.company)},${lit(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(ids.actor)},${lit(ids.company)},id,key FROM public.permissions
    WHERE key IN('metering.write','communication.read','communication.write','communication.send');
   INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) SELECT ${lit(ids.company)},e,'electricity',true,clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'EdielId',${lit(ediel)},clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${lit(ids.company)},e,${lit(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'t3-017 synthetic','private');
   INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${lit(ids.grid)},${lit(ids.company)},${lit(ids.grid)},${lit(issuer)},'test',true,'active');
   INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'t3-017','consumption','active','SE',${lit(facility)},${lit(ids.grid)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(facility)},${lit(facility)},${lit(ids.grid)});
   INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(ids.request)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'billing_underlay');`)
  const template = energyHandoffMessage('2026-10-01', ids.company)
  const base = template.raw_payload!.replace('?+0200:406', '?+0100:406').replaceAll('735999260731000007', facility)
    .replace('+21660:ZZ+', `+${ediel}:ZZ+`).replace('NAD+MR+21660:SVK:260', `NAD+MR+${ediel}:SVK:260`)
    .replace('+91100:ZZ+', `+${issuer}:ZZ+`).replace('NAD+MS+91100:SVK:260', `NAD+MS+${issuer}:SVK:260`)
  assertUtiltsConsumptionPartiesBound(base, { ediel, issuer })
  const insertSource = async (raw: string) => {
    raw = cleanE30SourceFixture(raw, 'E66')
    setUtiltsReceiverRole(sql, lit, ids.company, ids.actor, 'E66')
    const sourceId = randomUUID(); raw = raw.replace(/(BGM\+[^+']*\+)[^+']+/, `$1M${sourceId.replaceAll('-', '').slice(0, 20)}`)
    const fixture = utiltsNativeSourceFixture(utiltsRecountUnt(utiltsTestEnvironmentWire(raw)), sourceId)
    const { id, parsed } = fixture
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
     SELECT ${lit(id)},${lit(ids.company)},${[ids.customer, ids.site, ids.point, ids.grid, ids.request].map(lit).join(',')},'test','inbound','edifact','UTILTS','E66','received',${lit(fixture.raw)},'{}','2026-10-01T20:00:00Z','{}',${lit(parsed.applicationReference)},${lit(issuer)},${lit(ediel)},${lit(parsed.interchangeReference)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
     FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.message_code='E66' AND profile.direction IN ('inbound','both') AND profile.is_enabled ORDER BY profile.profile_key LIMIT 1;`)
    seedUtiltsIssuerHistoryGround(sql, lit, id, ids.actor)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
    expect(error).toBeNull()
    await recordUtiltsTechnicalReception(data as unknown as EdielMessageRow, ids.actor)
    return data as unknown as EdielMessageRow
  }
  const dataRequest = { id: ids.request, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point, grid_owner_id: ids.grid, request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow
  const recorded = new Map<string, Awaited<ReturnType<typeof recordUtiltsFinalRuntime>>>()
  const prepare = async (source: EdielMessageRow) => {
    const policy = resolveCanonicalMessagePolicy(source)!
    if (!recorded.has(source.id)) recorded.set(source.id, await recordUtiltsFinalRuntime(source))
    const runtime = recorded.get(source.id)!
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    const matches = runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: ids.point, customerId: ids.customer, siteId: ids.site, gridOwnerId: ids.grid, externalMeteringPointId: t.meterPointId, externalGridAreaId: t.gridAreaId, matchStatus: 'matched' as const }))
    const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches, dataRequest, fallback: { customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point, gridOwnerId: ids.grid }, allowConsumption: true })
    return { actorUserId: ids.actor, companyId: ids.company, environment: source.environment, sourceMessageId: source.id, messageCode: source.message_code!, rawPayload: source.raw_payload!, contracts,
      transactions: buildUtiltsTransactionPersistencePayload({ messageCode: source.message_code, transactions: runtime.facts.transactions, rawSegments: runtime.facts.rawSegments, dispositions: runtime.transactionDispositions, matches }) }
  }
  // Version n (production order: each original arrives after the previous one
  // was persisted): own 505 transaction, own interchange, own 532 and quantity.
  let previous: EdielMessageRow | null = null
  const version = async (n: number, registered: string, qty: number) => {
    let raw = previous ? previous.raw_payload! : base
    const ref = previous ? previous.interchange_reference! : null
    raw = raw.replace(/IDE\+24\+[^']+/, `IDE+24+T3017${run}V${n}`.toUpperCase()).replace(/DTM\+597:\d{12}:203'(?=\nDTM\+354)/, `DTM+597:${registered}:203'`).replace(/QTY\+136:\d+/, `QTY+136:${qty}`)
    if (ref) raw = raw.replaceAll(ref, `V${n}${ref}`.slice(0, 14))
    previous = await insertSource(raw)
    return previous
  }
  return { ids, prepare, version }
}

type Outcome = { value_kwh?: number; error?: string }
const consume = (company: string, actor: string, series: string): Outcome => sql<Outcome>(`SET role service_role;
 DO $c$DECLARE s public.meter_reading_series%rowtype;r jsonb;BEGIN SELECT * INTO s FROM public.meter_reading_series WHERE id=${lit(series)};
  BEGIN r:=to_jsonb(public.gridex_consume_utilts_metering_v1(${lit(company)},s.source_ediel_message_id,s.source_transaction_reference,0,${lit(actor)},s.raw_transaction->'consumptionContract'));
  EXCEPTION WHEN OTHERS THEN r:=jsonb_build_object('error',SQLERRM);END;PERFORM set_config('t3017.out',r::text,false);END$c$;
 SELECT current_setting('t3017.out');`)
// VH history coverage over own synthetic delivery/object rows; returns the series ids it read.
const coverage = (company: string, facility: string, product: string) => sql<string[]>(`BEGIN;
 SET LOCAL session_replication_role=replica;
 INSERT INTO gridex_vh_history.deliveries(company_id,permission_id,environment,customer_id,opening_source_message_id,original_message_id,opening_payload_hash,original_payload_hash,legal_esco_id,legal_dso_id)
  VALUES(${lit(company)},'00000000-0000-4000-8000-000000003017','test',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),repeat('b',64),'esco','dso');
 INSERT INTO gridex_vh_history.objects(company_id,permission_id,site_id,point,product,permission_reference,period_start,period_end,approved_site,authorization_basis,basis_hash)
  VALUES(${lit(company)},'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018',${lit(facility)},${lit(product)},'t3-017','2026-06-01T00:00:00Z','2026-08-01T00:00:00Z','{}','{}',encode(sha256(convert_to(jsonb_build_array('{}'::jsonb,'{}'::jsonb)::text,'UTF8')),'hex'));
 SET LOCAL session_replication_role=origin;
 SELECT to_jsonb(ARRAY(SELECT DISTINCT x[1] FROM regexp_matches(gridex_vh_history.coverage_v1(${lit(company)},'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018')::text,'"seriesId": "([0-9a-f-]+)"','g') x));
 ROLLBACK;`)

it('equal-532 v3 with other content: readers keep the 600 head (claude-track3/017)', async () => {
  const body = sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(prosrc,'UTF8')),'hex')) FROM pg_proc WHERE oid='gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)'::regprocedure`)
  if (BASELINE) expect(body).toBe(PREIMAGE)
  else expect(body, 'migration_20261030130900_not_applied_to_stack').not.toBe(PREIMAGE)
  const f = await seed()
  const v1 = await f.version(1, '202607010020', 500)
  const p1 = await persistUtiltsTransactionResults(await f.prepare(v1))
  expect(consume(f.ids.company, f.ids.actor, p1[0].seriesId!)).toMatchObject({ value_kwh: 500 })
  const v2 = await f.version(2, '202607010040', 600), v2Input = await f.prepare(v2), p2 = await persistUtiltsTransactionResults(v2Input)
  expect(consume(f.ids.company, f.ids.actor, p2[0].seriesId!)).toMatchObject({ value_kwh: 600 })
  const v3 = await f.version(3, '202607010040', 700)
  const p3 = await persistUtiltsTransactionResults(await f.prepare(v3))
  const s = sql<{ facility: string; product: string; heads: string[] }>(`SELECT jsonb_build_object('facility',external_metering_point_id,'product',product_id,
   'heads',(SELECT jsonb_agg(h.id) FROM public.meter_reading_series h WHERE h.company_id=s.company_id AND h.external_metering_point_id=s.external_metering_point_id AND h.is_current)) FROM public.meter_reading_series s WHERE id=${lit(p2[0].seriesId)}`)
  const replayV2 = await persistUtiltsTransactionResults(v2Input).then(r => r[0], (e: Error) => ({ error: e.message }))
  const consumeV2 = consume(f.ids.company, f.ids.actor, p2[0].seriesId!)
  const consumeV3 = consume(f.ids.company, f.ids.actor, p3[0].seriesId!)
  const reviews = sql<number>(`SELECT count(*) FROM public.ediel_manual_review_items WHERE company_id=${lit(f.ids.company)} AND ediel_message_id=${lit(v3.id)} AND issue_type='utilts_series_version_conflict' AND status='open'`)
  const read = coverage(f.ids.company, s.facility, s.product)
  if (BASELINE) {
    // Pre-fix defect: the refused equal-532 v3 holds the current flag.
    expect(p3[0].versionState).toBe('current')
    expect(s.heads).toEqual([p3[0].seriesId])
    expect(consumeV3.error).toMatch(/utilts_consumption_correction_not_newer/)
    expect(read).toEqual([p3[0].seriesId])
    expect(reviews).toBe(0)
    return
  }
  expect(p3[0]).toMatchObject({ persistenceStatus: 'persisted', versionState: 'late_older_history' })
  expect(s.heads).toEqual([p2[0].seriesId])
  expect(replayV2).toMatchObject({ seriesId: p2[0].seriesId, idempotentReplay: true, versionState: 'current' })
  expect(consumeV2).toMatchObject({ value_kwh: 600 })
  expect(consumeV2.error ?? '').not.toMatch(/head_ambiguous/)
  expect(read).toEqual([p2[0].seriesId])
  expect(reviews).toBe(1)
}, 600_000)
