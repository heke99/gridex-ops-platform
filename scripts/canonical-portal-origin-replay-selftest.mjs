// Isolated source-effect regression; not a complete canonical replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const source = 'migrations/20260609150000_batch_6_sync_status_origin_fix.sql';
const accounting = spawnSync('python3', [new URL('scripts/gridex-replay-input-accounting.py', root).pathname], { encoding: 'utf8' });
const report = JSON.parse(accounting.stdout);
assert(!report.errors.length, report.errors.join('; '));
const row = report.migrations.find(item => item.path === source);
assert.equal(row?.classification, 'FULL_FILE_SELECTED', 'Whole reviewed source must remain selected after its early prerequisite');
assert.equal(row.execution[0].stage, 'timestamp');

const { PGlite } = await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const db = new PGlite();
try {
  const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8');
  const table = schema.match(/CREATE TABLE public\.customer_portal_identities \([\s\S]*?\n\);/)?.[0];
  assert(table, 'Committed canonical identity table must exist');
  await db.exec(table);
  await db.exec(`create table public.integration_api_clients (
    id integer primary key, company_id uuid, status text default 'active',
    allowed_origins text[] not null default '{}', metadata jsonb not null default '{}', updated_at timestamptz);
    insert into public.integration_api_clients(id,company_id,metadata,allowed_origins) values
      (1,'10000000-0000-0000-0000-000000000001','{"allowed_origins":["https://a.example"]}','{}'),
      (2,'10000000-0000-0000-0000-000000000002','{"allowed_origins":["https://b.example"]}',array['https://existing.example']),
      (3,'10000000-0000-0000-0000-000000000002','{"allowed_origins":"invalid"}','{}');
    insert into public.customer_portal_identities(company_id) values ('10000000-0000-0000-0000-000000000001');`);
  const before = (await db.query('select id,company_id,status,match_strength from public.customer_portal_identities')).rows;
  const body = readFileSync(new URL('supabase/' + source, root), 'utf8');
  for (let pass = 1; pass <= 2; pass++) {
    await db.exec(body);
    assert.deepEqual((await db.query('select id,company_id,status,match_strength from public.customer_portal_identities')).rows, before, 'Existing valid identities must not be relinked or reassigned');
    const clients = (await db.query('select id,allowed_origins from public.integration_api_clients order by id')).rows;
    assert.deepEqual(clients, [
      {id: 1, allowed_origins: ['https://a.example']},
      {id: 2, allowed_origins: ['https://existing.example']},
      {id: 3, allowed_origins: []},
    ]);
    const defaults = (await db.query("select column_name,column_default from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name in ('status','match_strength') order by column_name")).rows;
    assert.deepEqual(defaults, [{column_name:'match_strength',column_default:"'manual'::text"},{column_name:'status',column_default:"'pending_review'::text"}]);
    assert.equal((await db.query("select count(*)::int n from pg_indexes where schemaname='public' and indexname in ('integration_api_clients_company_status_idx','integration_api_clients_allowed_origins_gin_idx')")).rows[0].n, 2);
    console.log(`PASS ${pass}: complete source effects; origin backfill preserves explicit values; identity rows preserved; defaults/indexes verified`);
  }
  const fresh = (await db.query("insert into public.customer_portal_identities(company_id) values ('10000000-0000-0000-0000-000000000002') returning status,match_strength")).rows[0];
  assert.deepEqual(fresh, {status:'pending_review',match_strength:'manual'});
  console.log('PASS: full source selected; real SQL runs twice; fresh identity uses live-compatible default. Global replay remains unverified.');
} finally { await db.close(); }
