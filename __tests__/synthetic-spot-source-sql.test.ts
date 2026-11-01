import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Locked PGlite component: finite Auth/platform/permission-catalog ports below,
// not genuine GoTrue/PostgREST/native or full-main replay qualification.
const migrationPath = 'supabase/migrations/20261101192120_synthetic_spot_source_capture.sql'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), other = id(2), author = id(10), reviewer = id(11)
let db: PGlite
let command = 100
const key = () => id(command++)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function wire(month = '2026-01', resolution = 'PT60M') {
  const boundaries: Record<string, [string, string]> = {
    '1900-02': ['1900-01-31T23:00:00.000Z', '1900-02-28T23:00:00.000Z'],
    '2000-02': ['2000-01-31T23:00:00.000Z', '2000-02-29T23:00:00.000Z'],
    '2100-12': ['2100-11-30T23:00:00.000Z', '2100-12-31T23:00:00.000Z'],
    '2026-01': ['2025-12-31T23:00:00.000Z', '2026-01-31T23:00:00.000Z'],
    '2026-03': ['2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z'],
    '2026-10': ['2026-09-30T22:00:00.000Z', '2026-10-31T23:00:00.000Z'],
  }
  const [start, end] = boundaries[month]
  const step = resolution === 'PT15M' ? 900_000 : 3_600_000
  const intervals = []
  for (let at = Date.parse(start); at < Date.parse(end); at += step) {
    intervals.push({ start: new Date(at).toISOString(), end: new Date(at + step).toISOString(), priceSekPerKwh: intervals.length % 3 === 0 ? '-0.125000' : '0.00' })
  }
  return { schema: 'gridex-synthetic-spot-source-v1', declaration: 'SYNTHETIC_TEST_DATA_NOT_MARKET_ORIGINAL', sourceVersion: 'explicit-test-v1', billingMonth: month, civilZone: 'Europe/Stockholm', priceArea: 'SE3', resolution, currency: 'SEK_PER_KWH', intervals }
}
type Receipt = Record<string, unknown> & { source_id: string; latest_event_id: string; event_id: string }
async function capture(original = JSON.stringify(wire()), request = key(), actor = author, owner = company) {
  return (await db.query<{ result: Receipt }>('select public.gridex_capture_synthetic_spot_source_v1($1,$2,$3,$4) result', [owner, actor, request, Buffer.from(original).toString('base64')])).rows[0].result
}
async function read(source: string, actor = reviewer, owner = company, include = false) {
  return (await db.query<{ result: Receipt }>('select public.gridex_read_synthetic_spot_source_v1($1,$2,$3,$4) result', [owner, actor, source, include])).rows[0].result
}
async function review(source: string, previous: string, decision = 'review_capture', request = key(), actor = reviewer, reason = 'Independent synthetic capture review') {
  return (await db.query<{ result: Receipt }>('select public.gridex_review_synthetic_spot_source_v1($1,$2,$3,$4,$5,$6,$7) result', [company, actor, source, request, previous, decision, reason])).rows[0].result
}
async function counts() {
  return (await db.query('select (select count(*)::int from gridex_synthetic_spot_sources.originals) originals,(select count(*)::int from gridex_synthetic_spot_sources.events) events')).rows
}
async function rejected(action: () => Promise<unknown>, code = '22023') {
  await db.exec('savepoint refusal')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint refusal')
}

async function installFinitePrerequisites(target: PGlite) {
  await target.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create table public.companies(id uuid primary key,status text,is_active boolean);
    create table public.user_profiles(id uuid primary key,user_status text);
    create table public.company_memberships(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
    create table public.permissions(id uuid primary key default gen_random_uuid(),key text,is_active boolean);
    create table public.admin_users(user_id uuid,is_active boolean,role text);
    create table public.roles(id uuid primary key,key text,name text,is_active boolean);
    create table public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
    create table public.role_permissions(role_id uuid,permission_id uuid);
    create table public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
    create table public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
    create table public.component_permission_grants(actor uuid,company uuid,permission text);
    create function public.gridex_get_user_permissions_in_company(a uuid,c uuid) returns text[] language sql as $$select coalesce(array_agg(permission),'{}'::text[]) from public.component_permission_grants where actor=a and company=c$$;
    create function public.canonical_actor_is_platform_admin(a uuid) returns boolean language sql as $$select exists(select from public.admin_users where user_id=a and is_active)$$;
    insert into auth.users values('${author}',now(),null,null,false),('${reviewer}',now(),null,null,false);
    insert into public.user_profiles values('${author}','active'),('${reviewer}','active');
    insert into public.companies values('${company}','active',true),('${other}','active',true);
    insert into public.company_memberships(company_id,user_id,status,is_active,accepted_at) values('${company}','${author}','active',true,now()),('${company}','${reviewer}','active',true,now());
    insert into public.permissions(key,is_active) values('pricing.write',true),('pricing.read',true);
    insert into public.component_permission_grants values('${author}','${company}','pricing.write'),('${reviewer}','${company}','pricing.write');
    create table public.spot_price_sources(id int primary key,marker text); insert into public.spot_price_sources values(1,'existing-market-original');
    create table public.company_market_price_sources(id int primary key,marker text); insert into public.company_market_price_sources values(1,'existing-policy');
    create table public.spot_price_intervals(id int primary key,marker text); insert into public.spot_price_intervals values(1,'existing-price');
    create table public.pricing_runs(id int primary key,marker text); insert into public.pricing_runs values(1,'locked-pricing');
    create table public.customer_invoices(id int primary key,marker text); insert into public.customer_invoices values(1,'existing-invoice');
    create table public.spot_price_daily_summaries(id int primary key,marker text); insert into public.spot_price_daily_summaries values(1,'existing-summary');`)
  const canonical = readFileSync('supabase/migrations/20261012235455_ops_api_atomic_permission_and_direction_guards.sql', 'utf8')
  const start = canonical.indexOf('CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(')
  const end = canonical.indexOf('CREATE OR REPLACE FUNCTION public.gridex_create_partner_contract_v1(', start)
  await target.exec(canonical.slice(start, end))
}

beforeAll(async () => {
  db = new PGlite()
  await installFinitePrerequisites(db)
  await db.exec(readFileSync(migrationPath, 'utf8'))
}, 30_000)
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { if (db) await db.close() })

describe('raw SQL capture boundary', () => {
  it('derives exact immutable original hash, physical coverage, tuple and capture-only receipt', async () => {
    const original = JSON.stringify(wire()), receipt = await capture(original)
    expect(receipt).toMatchObject({ original_sha256: sha(original), source_version: 'explicit-test-v1', billing_month: '2026-01', price_area: 'SE3', resolution: 'PT60M', interval_count: 744, expected_interval_count: 744, covered_minutes: 44640, original_byte_length: Buffer.byteLength(original), consumer_enabled: false, status: 'captured', replayed: false, period_start: '2025-12-31T23:00:00.000Z', period_end: '2026-01-31T23:00:00.000Z' })
    const downloaded = await read(receipt.source_id, reviewer, company, true)
    expect(Buffer.from(downloaded.original_base64 as string, 'base64').toString()).toBe(original)
    expect(await counts()).toEqual([{ originals: 1, events: 1 }])
    const clock = await db.query<{ actual_time: boolean }>("select captured_at between now()-interval '1 minute' and clock_timestamp() and e.created_at between captured_at and clock_timestamp() actual_time from gridex_synthetic_spot_sources.originals s join gridex_synthetic_spot_sources.events e on e.id=s.capture_event_id")
    expect(clock.rows[0].actual_time).toBe(true)
  })
})

describe('SQL independent schema, decimals and Stockholm coverage', () => {
  it.each([
    ['wrong schema', (w: ReturnType<typeof wire>) => { w.schema = 'pretend-market'; }],
    ['undeclared original', (w: ReturnType<typeof wire>) => { w.declaration = 'MARKET_ORIGINAL'; }],
    ['foreign caller field', (w: ReturnType<typeof wire>) => { Object.assign(w, { companyId: other }); }],
    ['unknown source key', (w: ReturnType<typeof wire>) => { Object.assign(w, { captureTime: '2020-01-01' }); }],
    ['unicode version', (w: ReturnType<typeof wire>) => { w.sourceVersion = 'påhitt'; }],
    ['normalized version', (w: ReturnType<typeof wire>) => { w.sourceVersion = ' v1'; }],
    ['unsupported zone', (w: ReturnType<typeof wire>) => { w.civilZone = 'UTC'; }],
    ['foreign area', (w: ReturnType<typeof wire>) => { w.priceArea = 'NO1'; }],
    ['unsupported resolution', (w: ReturnType<typeof wire>) => { w.resolution = 'PT30M'; }],
    ['wrong currency', (w: ReturnType<typeof wire>) => { w.currency = 'EUR_PER_MWH'; }],
    ['invalid month', (w: ReturnType<typeof wire>) => { w.billingMonth = '2026-13'; }],
    ['too old year', (w: ReturnType<typeof wire>) => { w.billingMonth = '1899-12'; }],
    ['too future year', (w: ReturnType<typeof wire>) => { w.billingMonth = '2101-01'; }],
    ['gap', (w: ReturnType<typeof wire>) => { w.intervals.splice(50, 1); }],
    ['duplicate', (w: ReturnType<typeof wire>) => { w.intervals[50] = { ...w.intervals[49] }; }],
    ['reordered', (w: ReturnType<typeof wire>) => { [w.intervals[49], w.intervals[50]] = [w.intervals[50], w.intervals[49]]; }],
    ['wrong duration', (w: ReturnType<typeof wire>) => { w.intervals[0].end = '2025-12-31T23:15:00.000Z'; }],
    ['out of period', (w: ReturnType<typeof wire>) => { w.intervals[0].start = '2025-12-31T22:00:00.000Z'; }],
    ['fake timezone', (w: ReturnType<typeof wire>) => { w.intervals[0].start = '2026-01-01T00:00:00.000+01:00'; }],
    ['hour24', (w: ReturnType<typeof wire>) => { w.intervals[0].end = '2025-12-31T24:00:00.000Z'; }],
    ['invalid civil date', (w: ReturnType<typeof wire>) => { w.intervals[0].start = '2026-02-30T23:00:00.000Z'; }],
    ['missing milliseconds', (w: ReturnType<typeof wire>) => { w.intervals[0].start = '2025-12-31T23:00:00Z'; }],
    ['extra interval key', (w: ReturnType<typeof wire>) => { Object.assign(w.intervals[0], { hash: 'caller-controlled' }); }],
  ] as const)('rejects direct RPC %s without any archive/event writes', async (_name, change) => {
    const w = wire(); change(w)
    await rejected(() => capture(JSON.stringify(w)))
    expect(await counts()).toEqual([{ originals: 0, events: 0 }])
  })

  it.each(['-0', '-0.000000', '01', '+1', '1e-2', 'NaN', '100001', '-100000.000001', '0.0000001'])('rejects lexical/range price %s', async price => {
    const w = wire(); w.intervals[0].priceSekPerKwh = price
    await rejected(() => capture(JSON.stringify(w)))
  })
  it('preserves legitimate negative, zero and boundary decimal spellings', async () => {
    const w = wire(); ['-100000.000000', '100000', '0.000000', '-0.000001'].forEach((price, n) => { w.intervals[n].priceSekPerKwh = price })
    const original = JSON.stringify(w), result = await capture(original)
    expect(result.original_sha256).toBe(sha(original))
    expect(Buffer.from((await read(result.source_id, reviewer, company, true)).original_base64 as string, 'base64').toString()).toBe(original)
  })
  it.each([true, null, 1])('rejects non-string price %s, not adapter-normalized coercion', async value => {
    const w = wire(); Object.assign(w.intervals[0], { priceSekPerKwh: value })
    await rejected(() => capture(JSON.stringify(w)))
  })
  it.each(['top', 'interval', 'unknown-nested'])('rejects duplicate JSON keys recursively at %s', async kind => {
    let original = JSON.stringify(wire())
    if (kind === 'top') original = original.replace('"schema":', '"schema":"duplicate","schema":')
    if (kind === 'interval') original = original.replace('"priceSekPerKwh":', '"priceSekPerKwh":"9","priceSekPerKwh":')
    if (kind === 'unknown-nested') original = original.replace('{', '{"rogue":{"x":1,"x":2},')
    await rejected(() => capture(original))
  })
  it.each(['null', '[]', '{}', '{"x":"\\u0000"}', '{"x":"\\ud800"}', '{"x":NaN}', '{"x":Infinity}', '"scalar"'])('rejects invalid schema JSON %s', async raw => { await rejected(() => capture(raw)) })
  it('rejects invalid UTF8, oversized originals and malformed base64 without writes', async () => {
    for (const base64 of [Buffer.from([0xc3, 0x28]).toString('base64'), Buffer.alloc(1048577, 32).toString('base64'), 'invalid!']) {
      await rejected(() => db.query('select public.gridex_capture_synthetic_spot_source_v1($1,$2,$3,$4)', [company, author, key(), base64]))
    }
    expect(await counts()).toEqual([{ originals: 0, events: 0 }])
  })
  it.each([['2026-03', 2972, 92], ['2026-10', 2980, 100]] as const)('retains every physical quarter-hour in %s including %i intervals and DST day %i', async (month, count, dayCount) => {
    const w = wire(month, 'PT15M'), receipt = await capture(JSON.stringify(w))
    expect(receipt.interval_count).toBe(count)
    const day = month === '2026-03' ? ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'] : ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z']
    expect(w.intervals.filter(i => i.start >= day[0] && i.start < day[1])).toHaveLength(dayCount)
    expect(receipt.covered_minutes).toBe(count * 15)
    const fake = { ...w, sourceVersion: 'fake-flat-calendar', intervals: [...w.intervals] }
    fake.intervals.pop()
    await rejected(() => capture(JSON.stringify(fake)))
  })
  it.each([['1900-02', 672], ['2000-02', 696], ['2100-12', 744]] as const)('derives boundary/leap calendar %s with %i physical hours', async (month, count) => {
    const receipt = await capture(JSON.stringify(wire(month)))
    expect(receipt.interval_count).toBe(count)
    expect(receipt.billing_month).toBe(month)
    expect(receipt.consumer_enabled).toBe(false)
  })
  it('uses raw SQL semantics without rewriting whitespace or reordered JSON bytes', async () => {
    const original = JSON.stringify(wire(), null, 2), result = await capture(original)
    expect(result.original_sha256).toBe(sha(original))
    expect(Buffer.from((await read(result.source_id, reviewer, company, true)).original_base64 as string, 'base64').toString()).toBe(original)
  })
})

describe('current scoped authorization and immutable grants', () => {
  it.each([
    "update public.company_memberships set accepted_at=now()+interval '1 day' where user_id='ACTOR'",
    "update auth.users set email_confirmed_at=now()+interval '1 day' where id='ACTOR'",
    "update auth.users set email_confirmed_at=null where id='ACTOR'",
    "update auth.users set deleted_at=now() where id='ACTOR'",
    "update auth.users set banned_until=now()+interval '1 hour' where id='ACTOR'",
    "update auth.users set is_anonymous=true where id='ACTOR'",
    "update public.user_profiles set user_status='inactive' where id='ACTOR'",
    "update public.companies set status='suspended' where id='COMPANY'",
    "update public.companies set is_active=false where id='COMPANY'",
    "update public.company_memberships set accepted_at=null where user_id='ACTOR'",
    "update public.company_memberships set is_active=false where user_id='ACTOR'",
    "update public.company_memberships set status='revoked' where user_id='ACTOR'",
    "insert into public.admin_users values('ACTOR',true,'super_admin')",
    "delete from public.component_permission_grants where actor='ACTOR'",
    "update public.permissions set is_active=false where key='pricing.write'",
    "insert into public.user_permissions(user_id,company_id,permission_key,is_active,status,effect) values('ACTOR','COMPANY','pricing.write',true,'active','deny')",
    "insert into public.user_permission_overrides(user_id,company_id,permission_key,is_active,effect) values('ACTOR',null,'pricing.write',true,'deny')",
  ])('denies current identity/permission mutation %s before any capture', async sql => {
    await db.exec(sql.replaceAll('ACTOR', author).replaceAll('COMPANY', company))
    await rejected(() => capture(), '42501')
    expect(await counts()).toEqual([{ originals: 0, events: 0 }])
  })
  it('denies foreign company and unknown user, and honors read-only permission without write', async () => {
    await rejected(() => capture(undefined, key(), author, other), '42501')
    await rejected(() => capture(undefined, key(), id(999)), '42501')
    const source = await capture()
    await db.exec(`delete from public.component_permission_grants where actor='${reviewer}';insert into public.component_permission_grants values('${reviewer}','${company}','pricing.read');`)
    expect((await read(source.source_id)).source_id).toBe(source.source_id)
    await rejected(() => review(source.source_id, source.latest_event_id), '42501')
  })
  it('returns the same absence for unknown and foreign source IDs', async () => {
    const source = await capture()
    await db.exec(`insert into public.company_memberships(company_id,user_id,status,is_active,accepted_at) values('${other}','${reviewer}','active',true,now());insert into public.component_permission_grants values('${reviewer}','${other}','pricing.read');`)
    await rejected(() => read(source.source_id, reviewer, other), 'P0002')
    await rejected(() => read(id(999), reviewer, other), 'P0002')
  })
  it('reconciles an unknown capture outcome by actual own request key without mutation retry', async () => {
    const request = key(), original = JSON.stringify(wire()), source = await capture(original, request)
    const result = (await db.query<{ result: Receipt }>('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,true,$3) result', [company, author, request])).rows[0].result
    expect(result).toMatchObject({ source_id: source.source_id, original_sha256: sha(original), replayed: false })
    expect(Buffer.from(result.original_base64 as string, 'base64').toString()).toBe(original)
    expect(await counts()).toEqual([{ originals: 1, events: 1 }])
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,false,$3)', [company, reviewer, request]), 'P0002')
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,false,$3)', [company, author, key()]), 'P0002')
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,$3,false,$4)', [company, author, source.source_id, request]))
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,false,null)', [company, author]))
    await db.exec(`insert into public.company_memberships(company_id,user_id,status,is_active,accepted_at) values('${other}','${author}','active',true,now());insert into public.component_permission_grants values('${author}','${other}','pricing.read');`)
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,false,$3)', [other, author, request]), 'P0002')
    await db.exec(`insert into public.user_permission_overrides(user_id,company_id,permission_key,is_active,effect) values('${author}','${company}','pricing.write',true,'deny')`)
    await rejected(() => db.query('select public.gridex_read_synthetic_spot_source_v1($1,$2,null,false,$3)', [company, author, request]), '42501')
    expect(await counts()).toEqual([{ originals: 1, events: 1 }])
  })
  it('revokes all direct private access and grants exactly the three public service RPCs', async () => {
    const functions = [
      'public.gridex_capture_synthetic_spot_source_v1(uuid,uuid,uuid,text)',
      'public.gridex_read_synthetic_spot_source_v1(uuid,uuid,uuid,boolean,uuid)',
      'public.gridex_review_synthetic_spot_source_v1(uuid,uuid,uuid,uuid,uuid,text,text)',
    ]
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const fn of functions) expect((await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, fn])).rows[0].allowed).toBe(role === 'service_role')
      expect((await db.query<{ allowed: boolean }>('select has_schema_privilege($1,\'gridex_synthetic_spot_sources\',\'USAGE\') allowed', [role])).rows[0].allowed).toBe(false)
      expect((await db.query<{ allowed: boolean }>('select has_table_privilege($1,\'gridex_synthetic_spot_sources.originals\',\'SELECT,INSERT,UPDATE,DELETE,TRUNCATE\') allowed', [role])).rows[0].allowed).toBe(false)
    }
    const rls = await db.query('select relrowsecurity,relforcerowsecurity from pg_class where oid in (\'gridex_synthetic_spot_sources.originals\'::regclass,\'gridex_synthetic_spot_sources.events\'::regclass)')
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }, { relrowsecurity: true, relforcerowsecurity: true }])
    await db.exec('set local role service_role')
    expect((await capture()).consumer_enabled).toBe(false)
    await rejected(() => db.query('select * from gridex_synthetic_spot_sources.originals'), '42501')
    await db.exec('reset role')
  })
})

describe('atomic capture commands and independent hash-linked review', () => {
  it('replays only same actor/key/exact bytes and rejects separate version collision', async () => {
    const original = JSON.stringify(wire()), request = key(), first = await capture(original, request)
    expect(await capture(original, request)).toEqual({ ...first, replayed: true })
    const changed = wire(); changed.intervals[0].priceSekPerKwh = '1'
    await rejected(() => capture(JSON.stringify(changed), request), '23505')
    await rejected(() => capture(original), '23505')
    await rejected(() => capture(original, key(), reviewer), '23505')
    expect(await counts()).toEqual([{ originals: 1, events: 1 }])
  })
  it('appends independent review, enforces predecessor and replays old command with current head', async () => {
    const source = await capture(), request = key()
    await rejected(() => review(source.source_id, source.latest_event_id, 'review_capture', key(), author), '42501')
    const accepted = await review(source.source_id, source.latest_event_id, 'review_capture', request)
    expect(accepted).toMatchObject({ status: 'reviewed_capture_only', consumer_enabled: false, decision: 'review_capture', replayed: false })
    await rejected(() => review(source.source_id, source.latest_event_id, 'hold'), '23505')
    await rejected(() => review(source.source_id, accepted.latest_event_id, 'review_capture'), '23505')
    const held = await review(source.source_id, accepted.latest_event_id, 'hold')
    const replay = await review(source.source_id, source.latest_event_id, 'review_capture', request)
    expect(replay).toMatchObject({ event_id: accepted.event_id, decision: 'review_capture', latest_event_id: held.latest_event_id, status: 'held', replayed: true })
    await rejected(() => review(source.source_id, source.latest_event_id, 'hold', request), '23505')
    const rejectedSource = await review(source.source_id, held.latest_event_id, 'reject')
    await rejected(() => review(source.source_id, rejectedSource.latest_event_id, 'hold'), '23505')
    expect(await counts()).toEqual([{ originals: 1, events: 4 }])
    const rows = (await db.query<{ event_number: number; previous_event_id: string | null; previous_event_sha256: string | null; id: string; event_sha256: string }>('select * from gridex_synthetic_spot_sources.events order by event_number')).rows
    expect(rows.map(r => Number(r.event_number))).toEqual([1, 2, 3, 4])
    rows.slice(1).forEach((event, i) => { expect(event.previous_event_id).toBe(rows[i].id); expect(event.previous_event_sha256).toBe(rows[i].event_sha256) })
    const digestCheck = await db.query<{ valid: boolean }>(`select bool_and(event_sha256=encode(sha256(convert_to(jsonb_build_object('original_sha256',(select original_sha256 from gridex_synthetic_spot_sources.originals where originals.id=events.source_id),'id',id,'source_id',source_id,'company_id',company_id,'actor_user_id',actor_user_id,'request_key',request_key,'event_number',event_number,'decision',decision,'reason',reason,'expected_previous_event_id',expected_previous_event_id,'previous_event_id',previous_event_id,'previous_event_sha256',previous_event_sha256,'created_at',created_at)::text,'UTF8')),'hex')) valid from gridex_synthetic_spot_sources.events`)
    expect(digestCheck.rows[0].valid).toBe(true)
  })
  it('checks current authorization again for an exact previously accepted review command', async () => {
    const source = await capture(), request = key()
    await review(source.source_id, source.latest_event_id, 'hold', request)
    await db.exec(`insert into public.user_permission_overrides(user_id,company_id,permission_key,is_active,effect) values('${reviewer}','${company}','pricing.write',true,'deny')`)
    await rejected(() => review(source.source_id, source.latest_event_id, 'hold', request), '42501')
    expect(await counts()).toEqual([{ originals: 1, events: 2 }])
  })
  it.each(['approve', 'reviewed_capture_only', '', null])('rejects undeclared decision %s', async decision => {
    const source = await capture()
    await rejected(() => review(source.source_id, source.latest_event_id, decision as string))
  })
  it('scopes review keys across sources and rejects changed reason/predecessor without exposing SQL details', async () => {
    const source = await capture(), request = key()
    await review(source.source_id, source.latest_event_id, 'hold', request)
    await rejected(() => review(source.source_id, source.latest_event_id, 'hold', request, reviewer, 'Changed reason'), '23505')
    const otherWire = wire(); otherWire.sourceVersion = 'another-test-version'
    const second = await capture(JSON.stringify(otherWire))
    await rejected(() => review(second.source_id, second.latest_event_id, 'hold', request), '23505')
    await db.exec('savepoint safe_error')
    await expect(capture()).rejects.toMatchObject({ code: '23505', message: 'synthetic_spot_capture_conflict' })
    await db.exec('rollback to savepoint safe_error')
    expect(await counts()).toEqual([{ originals: 2, events: 3 }])
  })
  it.each(['', 'x'.repeat(501)])('rejects invalid review reason length %s', async reason => {
    const source = await capture()
    await rejected(() => review(source.source_id, source.latest_event_id, 'hold', key(), reviewer, reason))
  })
  it('protects original and event update/delete/truncate even from ordinary owner DML', async () => {
    await capture()
    await db.exec('set constraints all immediate')
    for (const table of ['originals', 'events']) {
      for (const sql of [`update gridex_synthetic_spot_sources.${table} set actor_user_id='${reviewer}'`, `delete from gridex_synthetic_spot_sources.${table}`, `truncate gridex_synthetic_spot_sources.${table} cascade`]) await rejected(() => db.exec(sql), '55000')
    }
    expect(await counts()).toEqual([{ originals: 1, events: 1 }])
  })
  it('rejects the second same-predecessor submission and preserves every existing market/financial sentinel', async () => {
    await db.exec('commit') // finite queued autocommit calls; each RPC is its own transaction
    const markers = ['spot_price_sources', 'company_market_price_sources', 'spot_price_intervals', 'spot_price_daily_summaries', 'pricing_runs', 'customer_invoices']
    const before = await Promise.all(markers.map(async table => (await db.query(`select * from public.${table} order by id`)).rows))
    const source = await capture()
    // PGlite queues one backend: concurrent submissions exercise command semantics,
    // not a claim of real multiconnection PostgreSQL locking qualification.
    const result = await Promise.allSettled([review(source.source_id, source.latest_event_id, 'hold'), review(source.source_id, source.latest_event_id, 'reject')])
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(await counts()).toEqual([{ originals: 1, events: 2 }])
    for (const [i, table] of markers.entries()) expect((await db.query(`select * from public.${table} order by id`)).rows).toEqual(before[i])
    await db.exec('begin')
  })
})


describe('canonical psql-style migration failure atomicity', () => {
  const rpcSignatures = [
    'public.gridex_capture_synthetic_spot_source_v1(uuid,uuid,uuid,text)',
    'public.gridex_read_synthetic_spot_source_v1(uuid,uuid,uuid,boolean,uuid)',
    'public.gridex_review_synthetic_spot_source_v1(uuid,uuid,uuid,uuid,uuid,text,text)',
  ]
  async function throughPublicCreation(target: PGlite, legacyUnwrapped: boolean) {
    const migration = readFileSync(migrationPath, 'utf8')
    const boundary = migration.indexOf('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_synthetic_spot_sources')
    if (boundary < 0) throw new Error('Missing actual final migration ACL boundary')
    const actualPrefix = migration.slice(0, boundary)
    // Negative control only: reproduce the prior unwrapped forward. Production
    // always executes its original BEGIN/COMMIT bytes unchanged.
    const prefix = legacyUnwrapped ? actualPrefix.replace(/^BEGIN;\r?\n/m, '') : actualPrefix
    await target.exec(prefix)
    expect((await target.query<{ present: boolean }>("select to_regnamespace('gridex_synthetic_spot_sources') is not null present")).rows[0].present).toBe(true)
    for (const fn of rpcSignatures) {
      expect((await target.query<{ granted: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') granted", [fn])).rows[0].granted).toBe(true)
    }
    // Separate protocol roundtrip: matches canonical psql -f's failure boundary,
    // rather than wrapping a synthetic whole migration in a test transaction.
    await expect(target.exec('select 1/0')).rejects.toMatchObject({ code: '22012' })
    await target.exec('rollback')
  }
  it('reproduces the unwrapped-prefix partial schema and default-PUBLIC privileged RPC exposure', async () => {
    const target = new PGlite()
    try {
      await installFinitePrerequisites(target)
      await throughPublicCreation(target, true)
      expect((await target.query<{ present: boolean }>("select to_regnamespace('gridex_synthetic_spot_sources') is not null present")).rows[0].present).toBe(true)
      for (const fn of rpcSignatures) {
        expect((await target.query<{ exposed: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') exposed,prosecdef from pg_proc where oid=$1::regprocedure", [fn])).rows[0]).toMatchObject({ exposed: true, prosecdef: true })
      }
      await target.exec('set role anon')
      const impersonated = await target.query<{ result: Receipt }>('select public.gridex_capture_synthetic_spot_source_v1($1,$2,$3,$4) result', [company, author, key(), Buffer.from(JSON.stringify(wire())).toString('base64')])
      expect(impersonated.rows[0].result).toMatchObject({ status: 'captured', consumer_enabled: false })
      await target.exec('reset role')
    } finally { await target.close() }
  }, 30_000)
  it('rolls back the actual wrapped prefix after next-roundtrip failure, leaving no private schema or public RPCs', async () => {
    const target = new PGlite()
    try {
      await installFinitePrerequisites(target)
      await throughPublicCreation(target, false)
      expect((await target.query<{ absent: boolean }>("select to_regnamespace('gridex_synthetic_spot_sources') is null absent")).rows[0].absent).toBe(true)
      for (const fn of rpcSignatures) {
        expect((await target.query<{ absent: boolean }>('select to_regprocedure($1) is null absent', [fn])).rows[0].absent).toBe(true)
      }
    } finally { await target.close() }
  }, 30_000)
})
