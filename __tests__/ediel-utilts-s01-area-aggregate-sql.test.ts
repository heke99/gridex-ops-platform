import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults } from '@/lib/ediel/utilts/transactionPersistence'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { s01L359AggregateWire } from '../scripts/helpers/utiltsS01AggregateFixture'
const captured = vi.hoisted(() => ({ transactions: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({supabaseService:{rpc:vi.fn((_name: string,args: {p_transactions:unknown}) => {
  captured.transactions=args.p_transactions
  return Promise.resolve({data:null,error:{message:'fixture_payload_captured'}})
})}}))

// Executes the actual persistence, decimal, contract and stored-return owners.
// Finite external authority ports below do not prove native RLS, provider,
// concurrent sessions, reception provenance or legal eSett certification.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrationPath = 'supabase/migrations/20261023201053_ediel_s01_area_aggregate_identity.sql'
const company = '10000000-0000-4000-8000-000000000001'
const source = '20000000-0000-4000-8000-000000000001'
const guideHash = 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2'
let db: PGlite
function definition(name: string) {
  const start = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (start < 0) throw Error('Missing actual routine ' + name)
  const tail = schema.slice(start), delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(tail)!
  let ddl = tail.slice(0, tail.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length) + delimiter[1].length + 1)
  // GEN later replaces the canonical bodies. Retain the exact immutable
  // predecessor embedded in this forward migration for the RED side.
  const pins: Record<string,string> = {
    'gridex_utilts_binding.persist_consumption_before_precision_v1':'ac53c3f07f74dc8829e4b5d8d6407c7b96f57f5a8c4d44147ab660b62c06c892',
    'gridex_utilts_binding.stored_contract_v1':'0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9',
  }
  if (pins[name] && existsSync(migrationPath)) {
    const patches = readFileSync(migrationPath,'utf8').match(/DO \$patch\$[\s\S]*?END \$patch\$;/g) ?? []
    const patch = patches.find(p => p.includes("'"+name+'('))
    const old = patch?.match(/old_body:=\$old\$([\s\S]*?)\$old\$/)?.[1]
    if (!old || createHash('sha256').update(old).digest('hex') !== pins[name]) throw Error('Unqualified predecessor '+name)
    const begin = delimiter.index + delimiter[0].length, end = ddl.indexOf(delimiter[1]+';',begin)
    ddl = ddl.slice(0,begin)+old+ddl.slice(end)
  }
  return ddl
}
function table(name: string) {
  const start = schema.indexOf('CREATE TABLE ' + name + ' (')
  if (start < 0) throw Error('Missing actual table ' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
const routines = [
  'esco_local_time_v1','wire_tokens_v1','source_context_v1','canonical_decimal_v2','exact_keys_v1','absolute_v1',
  'valid_transaction_reference_v2','validate_contract_base_v1','validate_legacy_contract_v1','validate_contract_v1',
  'missing_source_quality_v2','validate_decimal_source_v2','unowned_regulating_object_v1','supported_point_v1',
  'validate_rejected_contract_v3','valid_rejected_item_v3','legacy_retry_item_v1','persist_series_v2','persist_series_v1','persist_consumption_before_precision_v1','stored_contract_v1','decimal_rules_v1','preserve_committed_projection_v1','persist_consumption_before_actor_v1',
]
function wire(id = 'L359-A', latest = '202607010100') {
  return ["UNA:+.? '",'UNH+M+UTILTS:D:02B:UN:E5SE5A', 'BGM+S01:SVK:260+DOC+9+AB', 'DTM+735:?+0100:406',
    'MKS+23+E03::260','NAD+MS+SYNTHETIC:SVK:260','NAD+MR+BRP:SVK:260','NAD+DDK', `IDE+24+${id}`,
    'LOC+239+TES:SVK:260','LIN+++8716867000030:::9',
    'PIA+1+Z04:PC:SVK:260+U46:PT:SVK:260+Z02:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260',
    'DTM+324:202606010000202607010000:719',`DTM+368:${latest}:203`,'DTM+354:1:802',
    'STS+7++E43::260','MEA+AAZ++KWH','CCI+++E02::260','CAV+E01::260','SEQ++1','QTY+136:1','UNT+22+M',
  ].map((s, i) => i === 0 ? s : s + "'").join('\n')
}
function item(id = 'L359-A', latest = '2026-07-01T00:00:00.000Z') {
  const attribution = { capability:'skip', reason:'aggregate',customerId:null as string | null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null }
  return { transactionId:id,disposition:'accepted',responseType:'positive_aperak',issueCodes:[],seriesKind:'aggregate',
    meteringPointId:null,externalMeteringPointId:null as string | null,gridAreaId:'TES',productId:'8716867000030',
    periodStart:'2026-05-31T23:00:00.000Z',periodEnd:'2026-06-30T23:00:00.000Z',registrationDate:null,
    latestUpdateDate:latest,resolution:'1',unit:'KWH',reasonForTransaction:'E43',quantities:[{qualifier:'136',value:'1',raw:'QTY+136:1',observationId:'1'}],
    consumptionContract:{ version:2,projectionVersion:'utilts-consumption-v2',attributionVersion:'tenant-match-v1',companyId:company,
      environment:'test',messageCode:'S01',transactionId:id,seriesKind:'aggregate',profileKey:null,profileVersion:null,rulePackHash:null,guideRevision:'25-A-5',
      interpretation:{localPeriodStart:'2026-06-01T00:00:00',localPeriodEnd:'2026-07-01T00:00:00',localRegistration:null,
        resolutionValue:'1',resolutionFormat:'802',timezoneRaw:'+0100',timezoneFormat:'406',offsetMinutes:60,timestampPolicy:'no-consumption-v1'},
      observations:[],metering:attribution,billing:{...attribution,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[],sourceType:'ediel_utilts' },
  }
}
async function seed(raw = wire(), sid = source, code = 'S01') {
  await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) values($1,$2,'test','inbound','UTILTS',$4,$3)`, [sid,company,raw,code])
  const basis = {version:'25-A-5:r5',snapshot:{version:'25-A-5:r5',rulePack:{market:'electricity',family:'UTILTS',guide_version:'25-A-5',guide_revision:'5'},guideSources:[{source_type:'technical_guide',revision:'25-A-5',source_hash:guideHash,source_locator:'https://www.ediel.se/Portal/Document/3364'}]}}
  await db.query(`insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)`,[sid,company,raw,JSON.stringify(basis)])
}
async function persist(raw = wire(), transactions: unknown[] = [item()], sid = source, tenant = company) {
  return (await db.query<{result: Record<string, unknown>[]}>(`select gridex_utilts_binding.persist_consumption_before_precision_v1($1,'test',$2,'S01',$3,$4::jsonb) result`,[tenant,sid,raw,JSON.stringify(transactions)])).rows[0].result
}
async function effects() {
  return (await db.query<{state: Record<string, number>}>(`select jsonb_build_object('receipts',(select count(*) from gridex_utilts_binding.receipts),'acks',(select count(*) from public.ediel_ack_transaction_results),'series',(select count(*) from public.meter_reading_series),'values',(select count(*) from public.meter_reading_values),'contracts',(select count(*) from gridex_utilts_binding.contracts)) state`)).rows[0].state
}
async function denied(operation: () => Promise<unknown>, message: string) {
  const before = await effects()
  await db.exec('savepoint negative_case')
  try { await expect(operation()).rejects.toThrow(message) }
  finally { await db.exec('rollback to savepoint negative_case; release savepoint negative_case') }
  expect(await effects()).toEqual(before)
}
async function forward() { await db.exec('begin'); await db.exec(readFileSync(migrationPath,'utf8')) }
async function publicPersist(raw = wire(), transactions: unknown[] = [item()], sid = source, code = 'S01') {
  await db.exec('set local role service_role')
  const answer = (await db.query<{result: Record<string, unknown>[]}>(`select public.gridex_persist_utilts_consumption_v1($1,'test',$2,$3,$4,$5::jsonb,null) result`,[company,sid,code,raw,JSON.stringify(transactions)])).rows[0].result
  await db.exec('reset role')
  return answer
}
async function boot() {
  db = new PGlite()
  await db.exec(`create schema gridex_utilts_binding;create schema gridex_ediel_source_rules;create schema extensions;
    create function public.digest(value bytea, algorithm text) returns bytea language sql immutable as $$select case when algorithm='sha256' then sha256(value) end$$;`)
  for (const name of ['public.ediel_messages','public.ediel_ack_transaction_results','public.meter_reading_series','public.meter_reading_values','gridex_utilts_binding.receipts','gridex_utilts_binding.contracts','gridex_ediel_source_rules.receipts']) await db.exec(table(name))
  await db.exec(`alter table public.ediel_messages add primary key(id);
    alter table public.ediel_ack_transaction_results add unique(company_id,environment,source_message_id,source_transaction_id);
    alter table public.meter_reading_series add primary key(id);alter table public.meter_reading_series add unique(company_id,dedupe_key);
    alter table gridex_utilts_binding.receipts add primary key(source_message_id);
    alter table gridex_utilts_binding.contracts add primary key(series_id);`)
  for (const routine of routines) await db.exec(definition('gridex_utilts_binding.' + routine))
  for (const name of ['gridex_guard_meter_reading_series_tenant','gridex_guard_immutable_meter_reading_series','gridex_guard_meter_reading_value_tenant','gridex_guard_immutable_meter_reading_value']) await db.exec(definition('public.' + name))
  await db.exec(`create trigger meter_reading_series_tenant_guard before insert or update on public.meter_reading_series for each row execute function public.gridex_guard_meter_reading_series_tenant();
    create trigger meter_reading_series_immutable_guard before delete or update on public.meter_reading_series for each row execute function public.gridex_guard_immutable_meter_reading_series();
    create trigger meter_reading_values_tenant_guard before insert or update on public.meter_reading_values for each row execute function public.gridex_guard_meter_reading_value_tenant();
    create trigger meter_reading_values_immutable_guard before delete or update on public.meter_reading_values for each row execute function public.gridex_guard_immutable_meter_reading_value();`)
  await db.exec(definition('gridex_ediel_source_rules.require_v1'))
  // Finite external authority ports: the actual actor wrapper and public return
  // owner execute, but this harness does not reproduce their external graphs.
  await db.exec(`create role service_role;create role anon;create role authenticated;
    create schema gridex_received_sources;create schema gridex_ediel_inbound_context;create schema gridex_received_reading_expectations;
    create function gridex_utilts_binding.lock_storage_graph_v1() returns void language sql as $$select$$;
    create function gridex_utilts_binding.require_execution_actor_v1(uuid,uuid) returns void language plpgsql as $$begin
      if current_setting('fixture.actor',true)='deny' then raise exception 'fixture_actor_denied' using errcode='42501';end if;end$$;
    create function gridex_utilts_binding.require_current_esco_storage_v1(uuid,text,uuid,jsonb) returns void language sql as $$select$$;
    create function gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) returns void language sql as $$select$$;
    create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language sql as $$select '{"actorRole":"balance_responsible"}'::jsonb$$;
    create function gridex_received_reading_expectations.consider_utilts_source_v1(uuid,text,uuid) returns void language sql as $$select$$;`)
  await db.exec(definition('public.gridex_persist_utilts_consumption_v1'))

  for (const name of ['persist_consumption_before_precision_v1','stored_contract_v1']) {
    const signature = name === 'stored_contract_v1' ? '(uuid,uuid,text)' : '(uuid,text,uuid,text,text,jsonb)'
    await db.exec(`revoke all on function gridex_utilts_binding.${name}${signature} from public`)
  }
}
describe('actual SQL source-only L359 area persistence', () => {
  beforeAll(boot, 30_000)
  afterAll(async () => { await db?.close() })
  afterEach(async () => { await db.exec('rollback') })
  it('reproduces the real predecessor defect, then admits a source-only aggregate through the forward owner', async () => {
    await db.exec('begin')
    await seed()
    await denied(() => persist(), 'utilts_consumption_identity_unsupported')
    expect(await effects()).toEqual({receipts:0,acks:0,series:0,values:0,contracts:0})
    if (existsSync(migrationPath)) await db.exec(readFileSync(migrationPath,'utf8'))
    const result = await persist()
    expect(result[0].persistenceStatus).toBe('persisted')
    const series = (await db.query<Record<string, unknown>>('select * from public.meter_reading_series')).rows[0]
    expect(series.metering_point_id).toBeNull()
    expect(series.external_metering_point_id).toBeNull()
    expect(series.time_series_product).toEqual({PC:'Z04',PT:'U46',OT:'Z02',LOD:'Z58',BAP:'Z05'})
    expect((await db.query<Record<string, unknown>>(`select gridex_utilts_binding.stored_contract_v1($1,$2,'L359-A') result`,[company,source])).rows[0].result).toEqual(item().consumptionContract)
    expect(await persist()).toEqual([expect.objectContaining({idempotentReplay:true,seriesId:result[0].seriesId})])
    expect(await effects()).toEqual({receipts:1,acks:1,series:1,values:1,contracts:1})
  })
  it.each([
    ['PC', (raw: string) => raw.replace('Z04:PC','Z05:PC')],
    ['PT', (raw: string) => raw.replace('U46:PT','U44:PT')],
    ['OT', (raw: string) => raw.replace('Z02:OT','Z01:OT')],
    ['BAP', (raw: string) => raw.replace('Z05:BAP','Z04:BAP')],
    ['LOD', (raw: string) => raw.replace('Z58:LOD','Z13:LOD')],
    ['PIA namespace', (raw: string) => raw.replace('Z04:PC:SVK:260','Z04:PC::260')],
    ['duplicate component', (raw: string) => raw.replace('U46:PT','U46:PC')],
    ['duplicate PIA', (raw: string) => raw.replace("DTM+324", "PIA+1+Z04:PC:SVK:260'DTM+324")],
    ['borrowed area', (raw: string) => raw.replace("LOC+239+TES:SVK:260'",'')],
    ['post-SEQ area', (raw: string) => raw.replace("LOC+239+TES:SVK:260'",'').replace('QTY+136:1',"LOC+239+TES:SVK:260'QTY+136:1")],
    ['point', (raw: string) => raw.replace('LOC+239',"LOC+172+POINT::9'LOC+239")],
    ['regulating object', (raw: string) => raw.replace('LOC+239',"LOC+175+OBJECT::9'LOC+239")],
    ['party', (raw: string) => raw.replace('LIN+++',"NAD+DDQ+SYNTHETIC:SVK:260'LIN+++")],
    ['LIN', (raw: string) => raw.replace('8716867000030','8716867000023')],
    ['phase', (raw: string) => raw.replace('E03::260','E02::260')],
    ['settlement', (raw: string) => raw.replace('CAV+E01','CAV+E02')],
    ['resolution', (raw: string) => raw.replace('354:1:802','354:1:805')],
    ['non-month period', (raw: string) => raw.replace('202606010000202607010000','202606020000202607010000')],
  ])('refuses source identity defect: %s without durable effects', async (_label, alter) => {
    await forward(); const raw = alter(wire()); await seed(raw)
    await denied(() => persist(raw), 'utilts_consumption_identity_unsupported')
  })
  it.each(['gridAreaId','meteringPointId','externalMeteringPointId','productId','periodStart','latestUpdateDate','timeSeriesProduct'])('refuses forged/stale item field %s', async field => {
    await forward(); await seed()
    const changed: Record<string, unknown> = structuredClone(item())
    changed[field] = field === 'timeSeriesProduct' ? {PC:'Z99'} : field === 'periodStart' || field === 'latestUpdateDate' ? '2026-06-01T00:00:00.000Z' : 'FORGED'
    await denied(() => persist(wire(),[changed]), 'utilts_s01_area_identity_conflict')
  })
  it('requires the immutable named Swedish U5 primary source', async () => {
    await forward();await seed()
    await db.exec(`update gridex_ediel_source_rules.receipts set evidence=jsonb_set(evidence,'{snapshot,guideSources,0,source_hash}','"wrong"')`)
    await denied(() => persist(), 'utilts_s01_area_source_basis_unavailable')
  })
  it('rejects mismatched protected source hashes and tenant scope', async () => {
    await forward();await seed()
    await denied(() => persist(wire(),[item()],source,'10000000-0000-4000-8000-000000000002'), 'utilts_source_binding_conflict')
    await db.exec(`update gridex_ediel_source_rules.receipts set payload_sha256=repeat('0',64)`)
    await denied(() => persist(), 'ediel_source_rule_pack_basis_required')
  })
  it('does not grant aggregate data an individual or economic sink', async () => {
    await forward();await seed();const changed = item()
    changed.consumptionContract.metering.customerId = company
    await denied(() => persist(wire(),[changed]), 'utilts_s01_area_identity_conflict')
  })
  it('executes the actual public return owner, preserves newer head and marks late/replayed history', async () => {
    await forward();await seed()
    const first = await publicPersist();expect(first[0].versionState).toBe('current')
    const newerSource = '20000000-0000-4000-8000-000000000002', newerRaw = wire('L359-B','202607010300')
    await seed(newerRaw,newerSource)
    const newer = await publicPersist(newerRaw,[item('L359-B','2026-07-01T02:00:00.000Z')],newerSource)
    expect(newer[0].versionState).toBe('current')
    const oldSource = '20000000-0000-4000-8000-000000000003', oldRaw = wire('L359-C','202607010200')
    await seed(oldRaw,oldSource)
    expect((await publicPersist(oldRaw,[item('L359-C','2026-07-01T01:00:00.000Z')],oldSource))[0].versionState).toBe('late_older_history')
    expect((await publicPersist())[0]).toEqual(expect.objectContaining({idempotentReplay:true,versionState:'late_older_history',seriesId:first[0].seriesId}))
    expect((await db.query<Record<string, unknown>>('select id from public.meter_reading_series where is_current')).rows).toEqual([{id:newer[0].seriesId}])
    expect(await effects()).toEqual({receipts:3,acks:3,series:3,values:3,contracts:3})
  })
  it('keeps the current execution actor boundary on the unchanged public entry point', async () => {
    await forward();await seed();await db.exec("select set_config('fixture.actor','deny',true)")
    await denied(() => publicPersist(), 'fixture_actor_denied')
  })
  it('preserves an exact committed historical point replay but refuses a fresh point S01', async () => {
    await db.exec('begin')
    const pointRaw = wire().replace('LOC+239',"LOC+172+POINT::9'LOC+239"), pointItem = item()
    pointItem.externalMeteringPointId='POINT'
    await seed(pointRaw)
    const old = await persist(pointRaw,[pointItem])
    await db.exec(readFileSync(migrationPath,'utf8'))
    expect((await persist(pointRaw,[pointItem]))[0]).toEqual(expect.objectContaining({idempotentReplay:true,seriesId:old[0].seriesId}))
    const fresh = '20000000-0000-4000-8000-000000000002';await seed(pointRaw,fresh)
    await denied(() => persist(pointRaw,[pointItem],fresh), 'utilts_consumption_identity_unsupported')
  })
  it('does not change the E66 supported-point owner', async () => {
    await forward();const raw = wire().replace('BGM+S01','BGM+E66').replace('LOC+239',"LOC+172+POINT::9'LOC+239")
    const point = item();point.externalMeteringPointId='POINT';point.seriesKind='actual';point.consumptionContract.seriesKind='actual';point.consumptionContract.messageCode='E66'
    await seed(raw,source,'E66')
    expect((await publicPersist(raw,[point],source,'E66'))[0]).toEqual(expect.objectContaining({persistenceStatus:'persisted',versionState:'current'}))
  })
  it('rolls back a valid sibling and every response reservation on a later invalid IDE', async () => {
    await forward()
    const sibling = wire('L359-B').slice(wire('L359-B').indexOf('IDE+24'),wire('L359-B').indexOf('UNT+'))
    const raw = wire().replace('UNT+22+M',sibling+'UNT+40+M');await seed(raw)
    const invalid = item('L359-B');invalid.quantities[0].value='2'
    await denied(() => persist(raw,[item(),invalid]), 'utilts_consumption_decimal_source_conflict')
  })
  it('rejects a foreign historical product cohort under the same LIN/area/month', async () => {
    await forward();await seed();const oldSource='20000000-0000-4000-8000-000000000002'
    await seed(wire('OLD').replace('Z58:LOD','Z13:LOD'),oldSource)
    await db.query(`insert into public.meter_reading_series(company_id,source_ediel_message_id,grid_area_id,period_start,period_end,resolution,dedupe_key,message_code,series_kind,product_id,raw_transaction) values($1,$2,'TES','2026-05-31T23:00Z','2026-06-30T23:00Z','1','unqualified','S01','aggregate','8716867000030',$3)`,[company,oldSource,JSON.stringify(item('OLD'))])
    await denied(() => persist(), 'utilts_s01_area_cohort_unavailable')
  })

  it.each(['body','owner ACL','search path'])('refuses an unqualified installer predecessor: %s', async kind => {
    await db.exec('begin')
    if (kind==='body') await db.exec(`create or replace function gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_transaction text) returns jsonb language plpgsql set search_path to pg_catalog,public,extensions as $$begin return '{}'::jsonb;end$$`)
    if (kind==='owner ACL') await db.exec('grant execute on function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) to service_role')
    if (kind==='search path') await db.exec('alter function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) set search_path to public')
    await denied(() => db.exec(readFileSync(migrationPath,'utf8')), 'utilts_s01_area_predecessor_unqualified')
    expect((await db.query<Record<string, unknown>>(`select to_regprocedure('gridex_utilts_binding.s01_l359_area_identity_v1(jsonb,text)') result`)).rows[0].result).toBeNull()
  })
  it('rolls back actual first-sibling writes when a later durable write fails', async () => {
    await forward()
    const sibling = wire('L359-B').slice(wire('L359-B').indexOf('IDE+24'),wire('L359-B').indexOf('UNT+'))
    const raw = wire().replace('UNT+22+M',sibling+'UNT+40+M');await seed(raw)
    await db.exec(`create function public.fixture_later_value_failure() returns trigger language plpgsql as $$begin
      if exists(select from public.meter_reading_series s where s.id=new.series_id and s.source_transaction_reference='L359-B') then
       if (select count(*) from public.meter_reading_values)<>1 then raise exception 'fixture_first_write_not_exercised';end if;
       raise exception 'fixture_second_write_failure';end if;return new;end$$;
      create trigger fixture_later_value_failure before insert on public.meter_reading_values for each row execute function public.fixture_later_value_failure();`)
    await denied(() => publicPersist(raw,[item(),item('L359-B')]), 'fixture_second_write_failure')
    expect(await effects()).toEqual({receipts:0,acks:0,series:0,values:0,contracts:0})
  })
  it('binds contract interpretation to the physical month and declared offset', async () => {
    await forward();await seed();const changed=item();changed.consumptionContract.interpretation.offsetMinutes=120
    await denied(() => persist(wire(),[changed]), 'utilts_s01_area_identity_conflict')
  })
  it('uses local fixed-offset calendar arithmetic across short and long months', async () => {
    await forward()
    for (const [start,end,latest] of [['202607010000','202608010000','202608010100'],['202602010000','202603010000','202603010100'],['202612010000','202701010000','202701010100']]) {
      const raw=wire('CALENDAR',latest).replace('202606010000202607010000',start+end)
      const result=(await db.query<Record<string, unknown>>(`select gridex_utilts_binding.s01_l359_area_identity_v1(gridex_utilts_binding.wire_tokens_v1($1),'CALENDAR') result`,[raw])).rows[0].result
      expect(result).toEqual(expect.objectContaining({gridAreaId:'TES'}))
    }
  })

  it('accepts the actual policy/preparation/adapter contract without changing its guide revision', async () => {
    await forward()
    const original=energyHandoffMessage('2026-10-15',company)
    const raw=s01L359AggregateWire(original.raw_payload!,[{transactionId:'L359-A',latestUpdateDate:'202607010100',quantity:'1'}])
    const message={...original,id:source,message_code:'S01',application_reference:'23-DDK-S01-S',raw_payload:raw,
      customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null}
    await seed(raw)
    const policy=resolveCanonicalMessagePolicy(message)!
    const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
    expect(runtime.validation.ok,JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.transactionDispositions).toMatchObject([{transactionId:'L359-A',disposition:'accepted',responseType:'positive_aperak'}])
    const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'S01',transactions:runtime.facts.transactions,
      dispositions:runtime.transactionDispositions,matches:[],rawSegments:runtime.facts.rawSegments})
    expect(transactions[0]).toMatchObject({resolution:'1',periodStart:'2026-05-31T23:00:00.000Z',periodEnd:'2026-06-30T23:00:00.000Z',latestUpdateDate:'2026-07-01T00:00:00.000Z',meteringPointId:null,externalMeteringPointId:null})
    const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,
      fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:false})
    expect(policy.guide.guideRevision).toBe('25-A-5')
    expect(contracts[0]).toMatchObject({guideRevision:'25-A-5',observations:[],metering:{capability:'skip'},billing:{capability:'skip'}})
    await expect(persistUtiltsTransactionResults({companyId:company,environment:'test',sourceMessageId:source,messageCode:'S01',rawPayload:raw,transactions,contracts,actorUserId:company})).rejects.toThrow('fixture_payload_captured')
    expect(captured.transactions).toBeInstanceOf(Array)
    expect((captured.transactions as Record<string,unknown>[])[0].consumptionContract).toEqual(contracts[0])
    const result=await publicPersist(raw,captured.transactions as unknown[])
    expect(result[0]).toEqual(expect.objectContaining({persistenceStatus:'persisted',versionState:'current',consumptionContract:contracts[0]}))
    expect((await db.query<{result:unknown}>(`select gridex_utilts_binding.stored_contract_v1($1,$2,'L359-A') result`,[company,source])).rows[0].result).toEqual(contracts[0])
  })

  it('requires physical PIA slots PC/PT/OT/LOD/BAP even when a service DTO claims a valid tuple', async () => {
    await forward()
    const raw=wire().replace('Z04:PC:SVK:260+U46:PT:SVK:260','U46:PT:SVK:260+Z04:PC:SVK:260')
    await seed(raw)
    expect.soft((await db.query<{identity:unknown}>(`select gridex_utilts_binding.s01_l359_area_identity_v1(gridex_utilts_binding.wire_tokens_v1($1),'L359-A') identity`,[raw])).rows[0].identity).toBeNull()
    const forged={...item(),timeSeriesProduct:{PC:'Z04',PT:'U46',OT:'Z02',LOD:'Z58',BAP:'Z05'}}
    await denied(() => publicPersist(raw,[forged]), 'utilts_consumption_identity_unsupported')
    expect(await effects()).toEqual({receipts:0,acks:0,series:0,values:0,contracts:0})
  })

  it('refuses observation quality on source-qualified L359 andelstal in both helper and public RPC', async () => {
    await forward()
    const raw=wire().replace("QTY+136:1'", "QTY+136:1'STS+8+56'")
    await seed(raw)
    expect.soft((await db.query<{identity:unknown}>(`select gridex_utilts_binding.s01_l359_area_identity_v1(gridex_utilts_binding.wire_tokens_v1($1),'L359-A') identity`,[raw])).rows[0].identity).toBeNull()
    const supplied={...item(),quantities:item().quantities.map(q=>({...q,quality:'56'}))}
    await denied(() => publicPersist(raw,[supplied]), 'utilts_consumption_identity_unsupported')
    expect(await effects()).toEqual({receipts:0,acks:0,series:0,values:0,contracts:0})
  })

})
