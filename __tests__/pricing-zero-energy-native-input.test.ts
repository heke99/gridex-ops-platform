import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = 'supabase/migrations/20261101212734_zero_energy_interval_price_input.sql'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), underlay = id(2), contract = id(3), snapshot = id(4), item = id(5)
let db: PGlite
function actualFunction(name: string) {
  const rest = schema.slice(schema.indexOf(`CREATE FUNCTION public.${name}(`)), tag = /AS (\$[^$]*\$)/.exec(rest)!
  const end = rest.indexOf(tag[1], tag.index + tag[0].length) + tag[1].length
  return rest.slice(0, end) + ';'
}
function actualTable(name: string) {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  if (!ddl) throw new Error('Missing actual table')
  return ddl
}
async function fixture(target: PGlite) {
  // Actual main function bodies/table DDL; finite contract/tenant/digest/source-
  // binding ports only. No GoTrue, native stack or full-main trigger proof.
  await target.exec(`create role anon;create role authenticated;create role service_role;
    create schema extensions;create schema gridex_billing_source;
    create table gridex_billing_source.underlay_bindings(company_id uuid,underlay_id uuid);
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create table public.customer_contracts(id uuid primary key,company_id uuid,status text,contract_type text);`)
  for (const table of ['billing_underlays', 'contract_price_snapshots', 'billing_underlay_items', 'spot_price_intervals', 'company_market_price_sources', 'pricing_runs', 'pricing_preview_lines', 'pricing_interval_evidence']) {
    await target.exec(actualTable(table))
    if (table !== 'company_market_price_sources') await target.exec(`alter table public.${table} add primary key(id)`)
  }
  await target.exec(`insert into public.customer_contracts values('${contract}','${company}','active','variable_hourly');
    insert into public.contract_price_snapshots(id,company_id,contract_id,base_price_components_snapshot,snapshot_json,snapshot_hash)
    values('${snapshot}','${company}','${contract}','[{"source_type":"spot","weight_percent":100}]','{"interval_resolution":"hourly"}','${'a'.repeat(64)}');
    insert into public.billing_underlays(id,company_id,contract_id,contract_price_snapshot_id,underlay_year,underlay_month,billing_period_start,billing_period_end,total_kwh,price_area)
    values('${underlay}','${company}','${contract}','${snapshot}',2026,1,'2026-01-01','2026-02-01',0,'SE3');
    insert into public.billing_underlay_items(id,company_id,billing_underlay_id,period_start,period_end,quantity,unit)
    values('${item}','${company}','${underlay}','2025-12-31T23:00:00Z','2026-01-01T00:00:00Z',0,'kWh');`)
  await target.exec(actualFunction('gridex_read_interval_pricing_snapshot_v1'))
  await target.exec(actualFunction('gridex_persist_pricing_run'))
  await target.exec(`revoke all on function public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb),public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
    grant execute on function public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb),public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) to service_role;`)
}
const feeResult = () => ({ status: 'success', total_ex_vat: 39, vat_amount: 9.75, total_inc_vat: 48.75, lines: [{ line_type: 'fixed_fee', description: 'Existing fee', quantity: 1, unit: 'month', unit_price_ex_vat: 39, amount_ex_vat: 39, vat_rate: 0.25, vat_amount: 9.75, amount_inc_vat: 48.75 }], interval_evidence: [] })
async function persist(result: Record<string, unknown> = feeResult(), target = db) {
  return target.query('select public.gridex_persist_pricing_run($1,$2,$3::jsonb) id', [company, underlay, JSON.stringify(result)])
}
async function read(target = db) {
  return (await target.query<{ result: { receipt: Record<string, unknown>; items: unknown[]; prices: unknown[]; policies: unknown[] } }>(`select public.gridex_read_interval_pricing_snapshot_v1($1,$2,'2025-12-31T23:00:00Z','2026-01-31T23:00:00Z','SE3','hourly',to_jsonb(u)) result from public.billing_underlays u where id=$2`, [company, underlay])).rows[0].result
}
async function denied(action: () => Promise<unknown>, code = '23514') {
  await db.exec('savepoint refusal');await expect(action()).rejects.toMatchObject({ code });await db.exec('rollback to savepoint refusal')
}
beforeAll(async () => { db = new PGlite();await fixture(db);await db.exec(readFileSync(migration, 'utf8')) }, 30_000)
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { if (db) await db.close() })
it('requires native receipt for actual zero interval-spot despite caller omitting every spot/evidence flag', async () => {
  await denied(() => persist())
})

it('returns a native metering-only receipt without any policy/price SELECT, retaining actual fee values', async () => {
  await db.exec('alter table public.spot_price_intervals rename to hidden_price_input;alter table public.company_market_price_sources rename to hidden_policy_input')
  const input = await read()
  expect(input.prices).toEqual([]);expect(input.policies).toEqual([])
  expect(input.receipt).toMatchObject({ input_kind: 'metering_only_zero_consumption_v1', item_count: 1, price_count: 0, policy_count: 0 })
  await db.exec('alter table public.hidden_price_input rename to spot_price_intervals;alter table public.hidden_policy_input rename to company_market_price_sources')
  await persist({ ...feeResult(), interval_input_snapshot: input.receipt })
  expect((await db.query('select total_ex_vat::text amount,vat_amount::text vat,total_inc_vat::text total from public.pricing_runs')).rows).toEqual([{ amount: '39', vat: '9.75', total: '48.75' }])
  expect((await db.query('select count(*)::int n from public.pricing_interval_evidence')).rows).toEqual([{ n: 0 }])
})
it.each([
  "quantity=1", "quantity=1e-1000", "quantity=-1", "quantity='NaN'", "quantity='Infinity'", "quantity='-Infinity'", "quantity_kwh=1e-1000", "quantity_kwh='NaN'", "quantity_kwh='Infinity'", "quantity=1,quantity_kwh=0", "unit='unknown'", "unit=''", "period_end=period_start+interval '30 minutes'", "period_start='-infinity'", "period_end='infinity'", "period_start='2025-12-31T22:00:00Z'",
])('rejects every malformed/hidden-positive actual item without changing obligation: %s', async assignment => {
  await db.exec(`update public.billing_underlay_items set ${assignment}`)
  await denied(() => persist()) // no caller flag can turn native obligation off
  await denied(() => read()) // exact SQL NUMERIC check precedes wire serialization
  expect((await db.query('select count(*)::int n from public.pricing_runs')).rows).toEqual([{ n: 0 }])
})
it.each(['kWh', 'Wh', 'MWh', ' KWH '])('normalizes actual zero %s without a commodity value', async unit => {
  await db.query('update public.billing_underlay_items set unit=$1,quantity_kwh=0', [unit])
  const input = await read();await persist({ ...feeResult(), interval_input_snapshot: input.receipt })
  expect(input.prices).toEqual([])
})
it('does not hide positive items behind status filters or cancelling sums', async () => {
  await db.exec(`update public.billing_underlay_items set quantity=1,status='excluded';insert into public.billing_underlay_items(id,company_id,billing_underlay_id,period_start,period_end,quantity,unit) values('${id(6)}','${company}','${underlay}','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z',-1,'kWh')`)
  await denied(() => read());await denied(() => persist())
})
it('rejects missing rows and preserves original NOT NULL quantity/unit constraints', async () => {
  await denied(() => db.exec('update public.billing_underlay_items set quantity=null'), '23502')
  await denied(() => db.exec('update public.billing_underlay_items set unit=null'), '23502')
  await db.exec('delete from public.billing_underlay_items')
  await denied(() => read());await denied(() => persist())
})
it('requires empty native marker/counts and forbids fabricated price/policy/evidence arrays', async () => {
  const input = await read()
  for (const changes of [{ input_kind: undefined }, { input_kind: 'priced' }, { price_count: 1 }, { policy_count: 1 }]) {
    await denied(() => persist({ ...feeResult(), interval_input_snapshot: { ...input.receipt, ...changes } }))
  }
  for (const field of ['prices', 'policies', 'interval_evidence']) {
    await denied(() => persist({ ...feeResult(), interval_input_snapshot: input.receipt, [field]: [{ price: 0 }] }))
  }
})
it('rechecks actual rows after read even if a mutation remains numerically zero', async () => {
  const input = await read();await db.exec("update public.billing_underlay_items set unit='Wh'")
  await denied(() => persist({ ...feeResult(), interval_input_snapshot: input.receipt }), '40001')
})
it('price/policy changes are not hidden price inputs to the metering-only fingerprint', async () => {
  const input = await read()
  await db.exec(`insert into public.company_market_price_sources(company_id,source_key) values('${company}','not-used');insert into public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution) values('not-used','SE3','2025-12-31T23:00:00Z','2026-01-01T00:00:00Z',999,'hourly')`)
  expect((await read()).receipt).toEqual(input.receipt)
  await persist({ ...feeResult(), interval_input_snapshot: input.receipt })
})
it('uses immutable component vectors rather than mutable underlay or caller selectors', async () => {
  await db.exec(`update public.billing_underlays set pricing_snapshot='{"interval_resolution":"monthly","base_price_components_snapshot":[{"source_type":"fixed","weight_percent":100}]}'`)
  await denied(() => persist())
  const input = await read()
  await denied(() => persist({ ...feeResult(), interval_input_snapshot: { ...input.receipt, price_area: 'SE1' } }))
  await denied(() => persist({ ...feeResult(), interval_input_snapshot: { ...input.receipt, period_start: '2026-01-01T00:00:00Z' } }))
})
it('genuine fixed-only immutable vectors do not acquire a spot receipt obligation', async () => {
  await db.exec(`update public.contract_price_snapshots set base_price_components_snapshot='[{"source_type":"fixed","weight_percent":100}]'`)
  await persist()
})
it.each(["base_price_components_snapshot='[]'", "base_price_components_snapshot='[{\"source_type\":\"unknown\"}]'", "base_price_components_snapshot='[{\"source_type\":\"spot\",\"price_area\":\"SE1\",\"weight_percent\":100}]'"])('fails closed for unknown or inapplicable canonical zero contract: %s', async change => {
  await db.exec(`update public.contract_price_snapshots set ${change}`)
  await denied(() => persist());await denied(() => read())
})
it('quarterly zero requires physical quarter-hour geometry and supports its real native marker', async () => {
  await db.exec(`update public.contract_price_snapshots set snapshot_json='{"interval_resolution":"quarterly"}';update public.customer_contracts set contract_type='variable_quarterly'`)
  await denied(() => db.query(`select public.gridex_read_interval_pricing_snapshot_v1($1,$2,'2025-12-31T23:00:00Z','2026-01-31T23:00:00Z','SE3','quarterly',to_jsonb(u)) from public.billing_underlays u where id=$2`, [company, underlay]))
  await db.exec("update public.billing_underlay_items set period_end=period_start+interval '15 minutes'")
  const result = (await db.query<{ result: { receipt: Record<string, unknown> } }>(`select public.gridex_read_interval_pricing_snapshot_v1($1,$2,'2025-12-31T23:00:00Z','2026-01-31T23:00:00Z','SE3','quarterly',to_jsonb(u)) result from public.billing_underlays u where id=$2`, [company, underlay])).rows[0].result
  await persist({ ...feeResult(), interval_input_snapshot: result.receipt })
})
async function catalog(target: PGlite) {
  return (await target.query<{ oid: number; proname: string; proacl: string | null; proconfig: string[]; prosecdef: boolean; provolatile: string; body_md5: string }>("select oid,proname,proacl::text,proconfig,prosecdef,provolatile,md5(prosrc) body_md5 from pg_proc where oid in ('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure,'public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb)'::regprocedure) order by proname")).rows
}
it('preserves actual OIDs/ACL/config and supports only exact known target replay', async () => {
  const target = new PGlite()
  try {
    await fixture(target);const before = await catalog(target)
    await target.exec(readFileSync(migration, 'utf8'));const after = await catalog(target)
    const identity = (rows: Awaited<ReturnType<typeof catalog>>) => rows.map(row => [row.oid, row.proname, row.proacl, row.proconfig, row.prosecdef, row.provolatile])
    expect(identity(after)).toEqual(identity(before))
    await target.exec(readFileSync(migration, 'utf8'));expect(await catalog(target)).toEqual(after)
    await target.exec("grant execute on function public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb) to anon")
    await expect(target.exec(readFileSync(migration, 'utf8'))).rejects.toMatchObject({ message: 'zero_interval_function_contract_changed' })
    await target.exec('rollback')
  } finally { await target.close() }
}, 30_000)
it('behavioral baseline accepts omitted zero receipt; corrected source rejects it', async () => {
  const target = new PGlite()
  try {
    await fixture(target);expect((await persist(feeResult(), target)).rows).toHaveLength(1)
  } finally { await target.close() }
}, 30_000)
it('preserves byte-equivalent nonzero priced snapshot, negative and reverse zero branches', async () => {
  const target = new PGlite()
  try {
    await fixture(target);await target.exec(`update public.billing_underlays set total_kwh=1;update public.billing_underlay_items set quantity=1;insert into public.company_market_price_sources(company_id,source_key) values('${company}','normal');insert into public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution) values('normal','SE3','2025-12-31T23:00:00Z','2026-01-01T00:00:00Z',1.25,'hourly')`)
    const before = await read(target);await target.exec(readFileSync(migration, 'utf8'));expect(await read(target)).toEqual(before)
    for (const change of ["total_kwh=-1", "total_kwh=0,energy_direction='consumption_correction',settlement_type='credit_invoice'", "total_kwh=0,energy_direction='production',settlement_type='self_billing'"]) {
      await target.exec(`update public.billing_underlays set ${change}`)
      expect((await read(target)).receipt).not.toHaveProperty('input_kind')
    }
  } finally { await target.close() }
}, 30_000)
it('rolls back the first function replacement if the second predecessor has drifted', async () => {
  const target = new PGlite()
  try {
    await fixture(target)
    await target.exec(actualFunction('gridex_persist_pricing_run').replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('  v_rows integer;', '  v_rows integer; -- unqualified drift'))
    const before = await catalog(target)
    await expect(target.exec(readFileSync(migration, 'utf8'))).rejects.toMatchObject({ message: 'zero_interval_function_predecessor_changed' })
    await target.exec('rollback');expect(await catalog(target)).toEqual(before)
  } finally { await target.close() }
}, 30_000)

it.each(['unsupported', 'HOURLY', 'quarter_hour'])('fails closed before item/caller flags for unknown immutable resolution %j', async resolution => {
  await db.query("update public.contract_price_snapshots set snapshot_json=jsonb_build_object('interval_resolution',$1::text)", [resolution])
  await denied(() => persist())
  await denied(() => read())
  expect((await db.query('select count(*)::int n from public.pricing_runs')).rows).toEqual([{ n: 0 }])
})

it('preserves recognized monthly and empty-to-contract resolution fallback', async () => {
  await db.exec(`update public.contract_price_snapshots set snapshot_json='{"interval_resolution":"monthly"}'`)
  await persist()
  await db.exec(`update public.contract_price_snapshots set snapshot_json='{"interval_resolution":""}'`)
  const input = await read()
  expect(input.receipt.input_kind).toBe('metering_only_zero_consumption_v1')
})
