// Isolated snapshot-table fixture: not canonical replay or live parity evidence.
// Supply a pinned @electric-sql/pglite module through GRIDEX_PGLITE_MODULE.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.GRIDEX_PGLITE_MODULE
  ? pathToFileURL(resolve(process.env.GRIDEX_PGLITE_MODULE)).href : '@electric-sql/pglite');
// Freeze the pre-repair table so future authoritative snapshots do not erase the regression.
const ddl = readFileSync('scripts/sql/canonical-company-invitation-baseline.sql', 'utf8');
const migrationName = readdirSync('supabase/migrations').find(name => name.endsWith('_canonical_company_invitation_runtime_reconstruction.sql'));
const migration = readFileSync(`supabase/migrations/${migrationName}`, 'utf8');
const company = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const db = new PGlite();
let checks = 0;
const rejects = async (sql, code) => {
  await assert.rejects(db.exec(sql), error => error.code === code); checks++;
};
try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create table public.companies(id uuid primary key);
    insert into public.companies values('${company}'); insert into auth.users values('${user}'); ${ddl}
    alter table public.company_invitations add primary key(id);
    alter table public.company_invitations add constraint company_invitations_company_id_fkey foreign key(company_id) references public.companies(id) on delete restrict;
    alter table public.company_invitations enable row level security;
    insert into public.company_invitations(company_id,email,invitation_token,metadata) values('${company}','fixture@example.invalid','legacy-preserve','{"fixture":true}');`);
  const before = (await db.query('select * from public.company_invitations')).rows[0];
  const governance = 'select id, company_id, invited_user_id, invited_email, email, role_key, membership_role, status, created_at, accepted_at from public.company_invitations';
  const worker = 'select id,company_id,email,full_name,membership_role,role_key,status,token,invited_by,invited_user_id,metadata from public.company_invitations';
  const lookup = "select id,company_id,email,full_name,membership_role,role_key,status,invited_user_id,expires_at from public.company_invitations where accept_token_hash='fixture'";
  for (const sql of [governance,worker,lookup]) await rejects(sql, '42703');
  console.log('RED: 3 active runtime projections reject snapshot fixture with undefined columns');
  if (process.argv.includes('--baseline-only')) process.exit(0);
  await db.exec(migration);
  for (const sql of [governance,worker,lookup]) { await db.query(sql); checks++; }
  const after = (await db.query('select * from public.company_invitations')).rows[0];
  for (const key of Object.keys(before)) assert.deepEqual(after[key],before[key]); checks++;
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from public.company_invitations')).rows[0],after); checks++;
  await db.exec(`insert into public.company_invitations(company_id,email,full_name,membership_role,role_key,status,token,invited_by,invited_user_id,expires_at,accept_token_hash,idempotency_key,metadata)
    values('${company}','new@example.invalid','Fixture','member','customer_service_agent','pending',gen_random_uuid(),'${user}','${user}',now()+interval '14 days','fixture','fixture','{}');`); checks++;
  await rejects(`update public.company_invitations set membership_role='invalid'`, '23514');
  await rejects(`update public.company_invitations set status='invalid'`, '23514');
  await rejects(`update public.company_invitations set invited_by='20000000-0000-4000-8000-000000000002'`, '23503');
  await rejects(`update public.company_invitations set invited_user_id='20000000-0000-4000-8000-000000000002'`, '23503');
  await rejects(`update public.company_invitations set accept_token_hash='duplicate'`, '23505');
  await rejects(`update public.company_invitations set token='30000000-0000-4000-8000-000000000001'`, '23505');
  await rejects(`delete from public.companies where id='${company}'`, '23503');
  await db.exec(`delete from auth.users where id='${user}'`);
  assert.equal((await db.query("select count(*)::int as n from public.company_invitations where invited_by is not null or invited_user_id is not null")).rows[0].n,0); checks++;
  const security = (await db.query("select relrowsecurity from pg_class where oid='public.company_invitations'::regclass")).rows[0];
  assert.equal(security.relrowsecurity,true); checks++;
  console.log(`PASS: ${checks} assertions; runtime projections, canonical INSERT column shape, original row preservation, repeat apply, role/status checks, token/hash uniqueness, actor FKs, company RESTRICT and RLS flag preservation.`);
} finally { await db.close(); }
// Upgrade with divergent pre-existing data must fail without repair or partial DDL.
for (const scenario of [
  { column: 'membership_role text', value: "'not-a-role'", code: '23514' },
  { column: 'invited_by uuid', value: "'40000000-0000-4000-8000-000000000001'", code: '23503' },
]) {
  const upgrade = new PGlite();
  try {
    const columnName = scenario.column.split(' ')[0];
    await upgrade.exec(`create schema auth; create table auth.users(id uuid primary key); ${ddl}
      alter table public.company_invitations add column ${scenario.column};
      insert into public.company_invitations(company_id,email,${columnName}) values('${company}','invalid@example.invalid',${scenario.value});`);
    await assert.rejects(upgrade.exec(migration), error => error.code === scenario.code);
    await upgrade.exec('rollback');
    assert.equal((await upgrade.query(`select ${columnName} as value from public.company_invitations`)).rows[0].value, scenario.value.slice(1,-1));
    assert.equal((await upgrade.query("select count(*)::int as n from information_schema.columns where table_name='company_invitations' and column_name='token'")).rows[0].n,0);
  } finally { await upgrade.close(); }
}
console.log('PASS: 2 dirty-upgrade scenarios reject invalid data and roll back added columns without rewriting rows.');
