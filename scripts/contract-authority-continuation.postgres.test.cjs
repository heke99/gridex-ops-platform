// Exact contract SQL in PostgreSQL-core; not a full Supabase/history/RLS proof.
// Node22 + NODE_PATH containing @electric-sql/pglite. No network/dispatch.
const assert = require('node:assert/strict')
const { readdirSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const migration = '20260930221813_contract_authoritative_platform_and_target_scope.sql'
const directory = resolve(__dirname, '../supabase/migrations')
const candidate = readFileSync(resolve(directory, migration), 'utf8')
const baseline = process.env.GRIDEX_CONTRACT_AUTHORITY_BASELINE === '1'
function latestFunction(name) {
  const expression = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?as (\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1;`, 'i')
  const versions = readdirSync(directory).filter(file => /^\d{14}_.+\.sql$/.test(file) && file < migration).sort()
    .map(file => ({ file, sql: readFileSync(resolve(directory, file), 'utf8').match(expression)?.[0] })).filter(value => value.sql)
  assert.ok(versions.length, `latest baseline SQL absent: ${name}`)
  return versions.at(-1).sql
}
const callers = [
  'gridex_archive_contract_product', 'gridex_assert_contract_channel_permission', 'gridex_cleanup_unused_contract_drafts',
  'gridex_close_contract_product', 'gridex_copy_contract_offer_v1', 'gridex_create_internal_customer_contract_v1',
  'gridex_delete_unused_contract', 'gridex_delete_unused_contract_v2', 'gridex_pause_contract_channels',
  'gridex_prepare_customer_contract_signature_request_v1', 'gridex_preview_delete_unused_contract_v2',
  'gridex_publish_contract_channel', 'gridex_publish_internal_contract_version', 'gridex_remove_internal_contract_offer',
  'gridex_remove_internal_contract_offer_v2', 'gridex_restore_archived_contract', 'gridex_set_contract_channel_permission',
  'gridex_unpublish_contract_channel', 'gridex_upsert_internal_contract_offer', 'gridex_upsert_internal_contract_offer_v2',
  'gridex_finalize_admin_imported_signed_agreement_v1',
]
const A = 'ea630000-0000-4000-8000-000000000001', B = 'ea630000-0000-4000-8000-000000000002'
const actor = 'ea630000-0000-4000-8000-000000000011', globalActor = 'ea630000-0000-4000-8000-000000000012'
const offerA = 'ea630000-0000-4000-8000-000000000021', offerB = 'ea630000-0000-4000-8000-000000000022'
const role = 'ea630000-0000-4000-8000-000000000031', globalRole = 'ea630000-0000-4000-8000-000000000032'
const archivePermission = 'ea630000-0000-4000-8000-000000000041'
const tables = ['user_profiles','admin_users','roles','user_roles','permissions','role_permissions','user_permissions','company_memberships',
  'contract_offers','contract_products','tenant_contract_channels','tenant_contract_assignments','contract_product_versions',
  'contract_publication_versions','contract_publications','public_contract_offers','audit_logs']
const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
function actualTable(name) {
  const sql = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(sql, `actual table definition absent: ${name}`)
  return sql
}
async function fixture() {
  const db = new PGlite()
  await db.exec(`create schema auth; create schema private; create role service_role bypassrls; create role authenticated; create role anon;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table public.companies(id uuid primary key,status text default 'active',is_active boolean default true,is_paused boolean default false);
    ${tables.map(actualTable).join('\n')}
    set check_function_bodies=off;
    ${['gridex_normalize_platform_role','gridex_get_user_permissions','gridex_has_permission','gridex_contract_actor_has_permission',
      'gridex_assert_contract_permission','gridex_contract_actor_can_operate_company','canonical_actor_is_platform_admin',
      'gridex_contract_readiness_blocker_v2','gridex_validate_contract_readiness_v2','gridex_normalize_audit_context_v1',...callers].map(latestFunction).join('\n')}
    create trigger audit_logs_normalize_context_v1 before insert or update on public.audit_logs for each row execute function public.gridex_normalize_audit_context_v1();
    set check_function_bodies=on;
    insert into public.companies(id) values('${A}'),('${B}');
    insert into auth.users(id) values('${actor}'),('${globalActor}');
    insert into public.user_profiles(id) values('${actor}'),('${globalActor}');
    insert into public.roles(id,key,name,scope) values('${role}','contract_fixture','Synthetic company role','company'),('${globalRole}','platform_admin','Platform admin','platform');
    insert into public.user_roles(user_id,company_id,role_id,role) values('${actor}','${A}','${role}','contract_fixture'),('${globalActor}',null,'${globalRole}','platform_admin');
    insert into public.company_memberships(company_id,user_id) values('${A}','${actor}'),('${B}','${actor}');
    insert into public.permissions(id,key,name) values('${archivePermission}','contracts.archive','contracts.archive');
    insert into public.role_permissions(role_id,permission_id) values('${role}','${archivePermission}');
    insert into public.contract_products(id,company_id,product_code,name,product_category,status) values('${offerA}','${A}','synthetic-A','Synthetic A','electricity','draft'),('${offerB}','${B}','synthetic-B','Synthetic B','electricity','draft');
    insert into public.contract_offers(id,company_id,contract_product_id,name,lifecycle_status,vat_rate) values('${offerA}','${A}','${offerA}','Synthetic A','draft',0.25),('${offerB}','${B}','${offerB}','Synthetic B','draft',0.25);
    select set_config('request.jwt.claim.role','service_role',false);`)
  if (!baseline) {
    assert.ok(candidate.includes('gridex_contract_actor_has_company_permission'), 'candidate must contain scoped SQL authority')
    // The unexecuted 19 other real caller bodies require the full native
    // schema. Keep them exact for catalog patch/OID verification; only the
    // actual archive/readiness/helper paths below are compiled and executed.
    await db.exec('set check_function_bodies=off')
    await db.exec(candidate)
    await db.exec('set check_function_bodies=on')
  }
  return db
}
async function graph(db) {
  return (await db.query(`select jsonb_build_object(${['contract_offers','contract_products','tenant_contract_channels','tenant_contract_assignments',
    'contract_product_versions','contract_publication_versions','contract_publications','public_contract_offers','audit_logs']
    .map(table => `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${table} t)`).join(',')}) as value`)).rows[0].value
}
async function archive(db, company = B, user = actor) {
  return (await db.query(`select public.gridex_remove_internal_contract_offer_v2('${company}','${company === A ? offerA : offerB}','archive','${user}',null) as value`)).rows[0].value
}
async function has(db, permission = 'contracts.archive') {
  return (await db.query(`select public.gridex_contract_actor_has_company_permission('${actor}','${B}','${permission}') as value`)).rows[0].value
}
test('legacy company-bound platform role label does not elevate actor or archive another tenant', async () => {
  const db = await fixture()
  try {
    // Deliberately reconstructed legacy state: modern user-role insertion guards
    // are NOT asserted bypassable by this focused fixture.
    await db.exec(`update public.user_roles set role='platform_admin' where user_id='${actor}'; delete from public.role_permissions where role_id='${role}'`)
    assert.equal((await db.query(`select public.canonical_actor_is_platform_admin('${actor}') as value`)).rows[0].value, false)
    const elevated = (await db.query(`select public.gridex_contract_actor_has_permission('${actor}','contracts.archive') as value`)).rows[0].value
    if (baseline) {
      const outcome = await archive(db)
      const observed = await graph(db)
      assert.equal(outcome.changed, true)
      assert.equal(observed.contract_offers.find(row => row.id === offerB).lifecycle_status, 'archived')
      assert.equal(observed.audit_logs[0].company_id, B)
      console.log('BASELINE_LEGACY_LABEL_EFFECT canonical_platform=false helper=true B_offer=archived B_product=archived audit_rows=1')
    }
    assert.equal(elevated, false)
    const before = await graph(db)
    await assert.rejects(archive(db), error => error.code === '42501')
    assert.deepEqual(await graph(db), before)
  } finally { await db.close() }
})
test('A permission plus B viewer membership cannot archive B; exact B allow changes only B', async () => {
  const db = await fixture()
  try {
    const before = await graph(db)
    if (baseline) {
      const unauthorized = await archive(db)
      const observed = await graph(db)
      assert.equal(unauthorized.changed, true)
      assert.equal(observed.contract_offers.find(row => row.id === offerB).lifecycle_status, 'archived')
      assert.deepEqual(observed.contract_offers.find(row => row.id === offerA), before.contract_offers.find(row => row.id === offerA))
      console.log('BASELINE_CROSS_SCOPE_EFFECT A_permission_only=true B_membership_only=true B_offer=archived B_product=archived audit_rows=1')
      assert.equal(unauthorized.changed, false, 'target-company permission must deny the actual archive')
    }
    await assert.rejects(archive(db), error => error.code === '42501')
    assert.deepEqual(await graph(db), before)
    await db.exec(`insert into public.user_permissions(user_id,company_id,permission_id) values('${actor}','${B}','${archivePermission}')`)
    const outcome = await archive(db)
    assert.equal(outcome.ok, true); assert.equal(outcome.changed, true)
    const after = await graph(db)
    assert.deepEqual(after.contract_offers.find(row => row.id === offerA), before.contract_offers.find(row => row.id === offerA))
    assert.equal(after.contract_offers.find(row => row.id === offerB).lifecycle_status, 'archived')
    assert.equal(after.contract_products.find(row => row.id === offerB).status, 'archived')
    assert.equal(after.audit_logs.length, 1); assert.equal(after.audit_logs[0].company_id, B); assert.equal(after.audit_logs[0].actor_user_id, actor)
    assert.equal((await archive(db)).changed, false)
  } finally { await db.close() }
})
test('global role requires platform definition and activity; genuine global authority survives', async () => {
  const db = await fixture()
  try {
    assert.equal((await archive(db, B, globalActor)).ok, true)
    await db.exec(`update public.roles set scope='company' where id='${globalRole}'`)
    const before = await graph(db)
    await assert.rejects(archive(db, A, globalActor), error => error.code === '42501')
    assert.deepEqual(await graph(db), before)
    await db.exec(`update public.roles set scope='platform',is_active=false where id='${globalRole}'`)
    await assert.rejects(archive(db, A, globalActor), error => error.code === '42501')
  } finally { await db.close() }
})
test('exact target positive union preserves legacy direct allow and rejects revoked membership or inactive grant', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    assert.equal(await has(db), false)
    await db.exec(`insert into public.user_permissions(user_id,company_id,permission_id,effect) values('${actor}',null,'${archivePermission}','allow'),('${actor}','${B}','${archivePermission}','deny')`)
    assert.equal(await has(db), true)
    await db.exec(`update public.company_memberships set status='revoked' where company_id='${B}' and user_id='${actor}'`)
    assert.equal(await has(db), false)
    await db.exec(`update public.company_memberships set status='active' where company_id='${B}' and user_id='${actor}'; update public.user_permissions set is_active=false where effect='allow'`)
    assert.equal(await has(db), false)
  } finally { await db.close() }
})
test('actor binding and active Auth/profile/target are required before actual archive effects', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    await db.exec(`insert into public.user_permissions(user_id,company_id,permission_id) values('${actor}','${B}','${archivePermission}'); select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${globalActor}',false)`)
    const before = await graph(db)
    await assert.rejects(archive(db), error => error.code === '42501')
    assert.deepEqual(await graph(db), before)
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`)
    assert.equal(await has(db), true)
    for (const mutation of [
      `update auth.users set banned_until=now()+interval '1 day' where id='${actor}'`,
      `update auth.users set banned_until=null,deleted_at=now() where id='${actor}'`,
      `update auth.users set deleted_at=null where id='${actor}'; update public.user_profiles set user_status='disabled' where id='${actor}'`,
      `update public.user_profiles set user_status='active' where id='${actor}'; update public.companies set status='inactive' where id='${B}'`,
    ]) {
      await db.exec(mutation); assert.equal(await has(db), false)
      await assert.rejects(archive(db), error => error.code === '42501'); assert.deepEqual(await graph(db), before)
    }
  } finally { await db.close() }
})

test('B publication requires both B contract and pricing permissions; A pricing cannot satisfy B', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    const contract = 'ea630000-0000-4000-8000-000000000042', pricing = 'ea630000-0000-4000-8000-000000000043'
    await db.exec(`insert into public.permissions(id,key,name) values('${contract}','contracts.publish','contracts.publish'),('${pricing}','pricing.publish','pricing.publish');
      insert into public.role_permissions(role_id,permission_id) values('${role}','${contract}'),('${role}','${pricing}');
      insert into public.user_permissions(user_id,company_id,permission_id) values('${actor}','${B}','${contract}')`)
    const before = await graph(db)
    await assert.rejects(db.query(`select public.gridex_publish_internal_contract_version('${B}','${offerB}','${actor}')`), error => error.code==='42501' && error.message==='contract_permission_denied:pricing.publish')
    assert.deepEqual(await graph(db), before)
    await db.exec(`insert into public.user_permissions(user_id,company_id,permission_id) values('${actor}','${B}','${pricing}')`)
    assert.equal(await has(db, 'contracts.publish'), true); assert.equal(await has(db, 'pricing.publish'), true)
    // An existing archived status supplies a deterministic honest business
    // refusal after authority. This is not a complete publication fixture.
    await db.exec(`update public.contract_offers set lifecycle_status='archived' where id='${offerB}'`)
    const beforeBlocked = await graph(db)
    const blocked = (await db.query(`select public.gridex_publish_internal_contract_version('${B}','${offerB}','${actor}') as value`)).rows[0].value
    assert.equal(blocked.ok,false); assert.equal(blocked.code,'contract_version_not_publishable')
    assert.deepEqual(await graph(db), beforeBlocked)
  } finally { await db.close() }
})

test('ordinary role grants are active and exact-target; no malformed global grant fallback', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    await db.exec(`insert into public.user_roles(user_id,company_id,role_id,role) values('${actor}','${B}','${role}','contract_fixture')`)
    assert.equal(await has(db),true)
    await db.exec(`update public.roles set is_active=false where id='${role}'`)
    assert.equal(await has(db),false)
    await db.exec(`update public.roles set is_active=true where id='${role}'; update public.user_roles set status='revoked' where company_id='${B}' and user_id='${actor}'`)
    assert.equal(await has(db),false)
    await db.exec(`update public.user_roles set status='active',is_active=false where company_id='${B}' and user_id='${actor}'`)
    assert.equal(await has(db),false)
    await db.exec(`update public.roles set scope='company' where id='${globalRole}'; insert into public.role_permissions(role_id,permission_id) values('${globalRole}','${archivePermission}')`)
    assert.equal((await db.query(`select public.gridex_contract_actor_has_company_permission('${globalActor}','${B}','contracts.archive') as value`)).rows[0].value,false)
  } finally { await db.close() }
})

test('legacy active admin_users authority survives and low-privilege direct helpers are not callable', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    await db.exec(`delete from public.user_roles where user_id='${globalActor}'; insert into public.admin_users(user_id,role,is_active) values('${globalActor}','super_admin',true)`)
    assert.equal((await archive(db,B,globalActor)).changed,true)
    await db.exec(`update public.admin_users set is_active=false where user_id='${globalActor}'`)
    await assert.rejects(archive(db,A,globalActor),error=>error.code==='42501')
    for (const lowRole of ['anon','authenticated']) {
      await db.exec(`set role ${lowRole}`)
      await assert.rejects(db.query(`select public.gridex_contract_actor_has_company_permission('${actor}','${B}','contracts.archive')`),error=>error.code==='42501')
      await db.exec('reset role')
    }
  } finally { await db.close() }
})

test('missing request role/actor returns false and cannot bypass an assertion through SQL NULL', { skip: baseline }, async () => {
  const db = await fixture()
  try {
    await db.exec(`insert into public.user_permissions(user_id,company_id,permission_id) values('${actor}','${B}','${archivePermission}');
      select set_config('request.jwt.claim.role','',false); select set_config('request.jwt.claim.sub','',false)`)
    assert.equal(await has(db),false)
    const before = await graph(db)
    await assert.rejects(archive(db),error=>error.code==='42501')
    assert.deepEqual(await graph(db),before)
  } finally { await db.close() }
})
