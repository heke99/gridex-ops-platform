// Calls the actual native preparation INSERT through the actual installed
// website identity BEFORE/AFTER owners. PostgreSQL-core only, not GoTrue/native.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')
const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const revocation = readFileSync(resolve(__dirname, '../supabase/migrations/20260928101000_portal_revocation_write_guard.sql'), 'utf8')
const native = readFileSync(resolve(__dirname, 'customer-inbound-lifecycle-atomic-20261001.native.test.ts'), 'utf8')
const id = n => `fc820000-0000-4000-8000-${String(n).padStart(12, '0')}`
const f = { company: id(1), customer: id(2), site: id(3), point: id(4), contract: id(5), operation: id(6), reference: 'SYNTHETIC-REFERENCE', email: 'customer@example.invalid' }
const app = id(7), workflow = id(8), portalUser = id(9)
const quote = value => `'${value.replaceAll("'", "''")}'`
function table(name) {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl, `actual table absent:${name}`)
  return ddl
}
function fn(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `actual function absent:${name}`)
  const match = schema.slice(start).match(/AS (\$[^$]*\$)[\s\S]*?\1;/)
  assert.ok(match)
  return schema.slice(start, start + match.index + match[0].length)
}
function privateFn(name) {
  const match = revocation.match(new RegExp(`create function private\\.${name}\\(\\)[\\s\\S]*?\\$function\\$;`, 'i'))
  assert.ok(match, `actual private owner absent:${name}`)
  return match[0]
}
function index(name) {
  const ddl = schema.match(new RegExp(`CREATE UNIQUE INDEX ${name} [^;]+;`))?.[0]
  assert.ok(ddl, `actual index absent:${name}`)
  return ddl
}
function actualPreparationSql() {
  const body = native.match(/sql\(`(INSERT INTO public\.website_customer_applications[\s\S]*?SELECT to_jsonb\(true\);)`\)/)?.[1]
  assert.ok(body, 'actual native preparation SQL absent')
  return Function('quote', 'f', 'app', 'workflow', 'portalUser', `"use strict"; return \`${body}\``)(quote, f, app, workflow, portalUser)
}
async function fixture() {
  const db = new PGlite()
  await db.exec(`create schema auth; create schema private;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table public.companies(id uuid primary key,metadata jsonb default '{}');
    create table public.customers(id uuid primary key,company_id uuid not null);
    ${['website_customer_applications', 'customer_application_workflows', 'customer_portal_identities', 'customer_portal_accounts'].map(table).join('\n')}
    ${['website_customer_applications', 'customer_application_workflows', 'customer_portal_identities', 'customer_portal_accounts'].map(name => `alter table public.${name} add primary key(id);`).join('\n')}
    ${['customer_portal_identities_external_uidx', 'customer_portal_accounts_company_portal_user_uidx', 'customer_application_workflows_application_uidx'].map(index).join('\n')}
    alter table public.customer_portal_identities add foreign key(auth_user_id) references auth.users(id);
    alter table public.customer_portal_identities add foreign key(customer_portal_user_id) references auth.users(id);
    alter table public.customer_portal_accounts add foreign key(portal_user_id) references auth.users(id);
    ${fn('gridex_validate_website_application_portal_identity')}
    ${fn('gridex_commit_website_portal_identity')}
    ${privateFn('gridex_check_website_portal_account_v1')}
    ${privateFn('gridex_guard_portal_revocation_v1')}
    create trigger gridex_validate_website_application_portal_identity before insert or update of payload,portal_identity_required
      on public.website_customer_applications for each row execute function public.gridex_validate_website_application_portal_identity();
    create trigger website_application_atomic_portal_identity after insert or update on public.website_customer_applications
      for each row when(new.customer_id is not null) execute function public.gridex_commit_website_portal_identity();
    create trigger website_application_portal_account_active_guard after insert or update on public.website_customer_applications
      for each row when(new.customer_id is not null) execute function private.gridex_check_website_portal_account_v1();
    create trigger customer_portal_identity_revocation_guard before update on public.customer_portal_identities
      for each row execute function private.gridex_guard_portal_revocation_v1();
    create trigger customer_portal_account_revocation_guard before update on public.customer_portal_accounts
      for each row execute function private.gridex_guard_portal_revocation_v1();
    insert into public.companies(id) values('${f.company}');
    insert into public.customers values('${f.customer}','${f.company}');
    insert into auth.users values('${portalUser}','${f.email}',now());`)
  return db
}
async function snapshot(db) {
  return (await db.query(`select jsonb_build_object(${['website_customer_applications', 'customer_application_workflows', 'customer_portal_identities', 'customer_portal_accounts'].map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.${name} x)`).join(',')}) value`)).rows[0].value
}
test('actual native preparation commits its separate paired customer identity/account and exact workflow under pre-auth policy', async () => {
  const db = await fixture()
  try {
    await db.exec(actualPreparationSql())
    const state = await snapshot(db)
    assert.equal(state.website_customer_applications.length, 1)
    assert.equal(state.website_customer_applications[0].portal_identity_submission_mode, 'pre_auth_required')
    assert.equal(state.website_customer_applications[0].payload.auth_user_id, portalUser)
    assert.equal(state.website_customer_applications[0].payload.customer_portal_user_id, portalUser)
    assert.equal(state.customer_portal_identities.length, 1)
    assert.equal(state.customer_portal_identities[0].auth_user_id, portalUser)
    assert.equal(state.customer_portal_identities[0].customer_id, f.customer)
    assert.equal(state.customer_portal_identities[0].company_id, f.company)
    assert.equal(state.customer_portal_accounts.length, 1)
    assert.equal(state.customer_portal_accounts[0].portal_user_id, portalUser)
    assert.equal(state.customer_portal_accounts[0].role, 'owner')
    assert.equal(state.customer_portal_accounts[0].status, 'active')
    assert.equal(state.customer_portal_accounts[0].is_active, true)
    assert.equal(state.customer_application_workflows[0].operation_id, f.operation)
  } finally { await db.close() }
})
test('actual enabled before owner rejects omitted identity with no application/account/workflow effects', async () => {
  const db = await fixture()
  try {
    const before = await snapshot(db)
    await assert.rejects(db.exec(`insert into public.website_customer_applications(id,company_id,customer_id,external_customer_id)
      values('${app}','${f.company}','${f.customer}','${f.reference}')`), error => error.code === '23514' && error.message === 'portal_auth_identity_required')
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})
test('actual enabled after owners deny revoked owner account without recreating or mutating its identity', async () => {
  const db = await fixture()
  try {
    await db.exec(`insert into public.customer_portal_accounts(company_id,customer_id,portal_user_id,status,is_active,role)
      values('${f.company}','${f.customer}','${portalUser}','disabled',false,'owner')`)
    const before = await snapshot(db)
    await assert.rejects(db.exec(actualPreparationSql()), error => error.code === '23505' && error.message === 'website_portal_account_customer_conflict')
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})
