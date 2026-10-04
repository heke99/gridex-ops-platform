import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const original = readFileSync('supabase/migrations/20261004084204_staff_customer_write_attribution.sql', 'utf8')
const contact = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.gridex_customer_contact_change_v1('),
  original.indexOf('CREATE OR REPLACE FUNCTION public.gridex_decide_customer_identity_change_v1('))
const policy = readFileSync('supabase/migrations/20261004083640_staff_user_commands.sql', 'utf8')
const strictGuard = readFileSync('supabase/migrations/20261004093111_staff_write_actor_guard.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261004114944_staff_contact_profile_authority.sql', 'utf8')
const capturedSchema = readFileSync('supabase/schema.sql', 'utf8')
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const customer = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const foreignCustomer = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const permission = '11111111-1111-4111-8111-111111111111'
const version = '2026-10-04T10:00:00Z'
let db: PGlite
let beforeMetadata: unknown
let afterMetadata: unknown
let beforeBody: string
let afterBody: string

function capturedFunction(name: string) {
  const start = capturedSchema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (start < 0) throw new Error(`Missing captured production function: ${name}`)
  const end = capturedSchema.indexOf('\n\n--\n-- Name:', start)
  return capturedSchema.slice(start, end)
}

beforeAll(async () => {
  db = new PGlite()
  // These finite tables retain the columns/constraints used by the actual SQL.
  // No permission, authorization, contact write or audit function is stubbed.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active boolean);
    CREATE TABLE company_memberships(company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE admin_users(user_id uuid,role text,is_active boolean);
    CREATE TABLE roles(id uuid PRIMARY KEY,key text,name text,is_active boolean);
    CREATE TABLE user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
    CREATE TABLE role_permissions(role_id uuid,permission_id uuid,effect text);
    CREATE TABLE permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE user_permission_overrides(company_id uuid,user_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),customer_type text,status text,first_name text,last_name text,full_name text,company_name text,personal_number text,org_number text,email text,phone text,invoice_email text,preferred_language text,apartment_number text,metadata jsonb,updated_at timestamptz,merged_into_customer_id uuid);
    CREATE TABLE customer_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,type text,name text,email text,phone text,title text,is_primary boolean,created_at timestamptz DEFAULT now());
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb);
    CREATE TABLE domain_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id text,subject_customer_id uuid,actor_user_id uuid,source text,idempotency_key text,payload jsonb,UNIQUE(company_id,idempotency_key));
    CREATE TABLE event_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,domain_event_id uuid REFERENCES domain_events(id),destination_type text,destination_key text,status text,attempts integer,max_attempts integer,available_at timestamptz,payload jsonb);`)
  for (const name of ['gridex_normalize_platform_role', 'canonical_actor_is_platform_admin',
    'gridex_get_user_permissions_in_company', 'gridex_actor_has_company_permission']) {
    await db.exec(capturedFunction(name))
  }
  await db.exec(policy.slice(0, policy.indexOf('CREATE FUNCTION public.gridex_assert_staff_command_v1')) + 'COMMIT;')
  await db.exec(strictGuard)
  await db.exec(contact)
  await db.exec(`REVOKE ALL ON FUNCTION gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) TO service_role;`)
  beforeMetadata = (await metadata()).rows[0]
  beforeBody = (await db.query<{ prosrc: string }>(`SELECT prosrc FROM pg_proc WHERE oid='public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'::regprocedure`)).rows[0].prosrc
  await db.exec(forward)
  afterMetadata = (await metadata()).rows[0]
  afterBody = (await db.query<{ prosrc: string }>(`SELECT prosrc FROM pg_proc WHERE oid='public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'::regprocedure`)).rows[0].prosrc
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies VALUES('${company}','active',true),('${foreignCompany}','active',true);
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO user_profiles VALUES('${actor}','active');
    INSERT INTO company_memberships VALUES('${company}','${actor}','company_admin','company_admin','active',true,now());
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_customers.write']);
    INSERT INTO customers(id,company_id,status,email,updated_at) VALUES
      ('${customer}','${company}','active','before@example.invalid','${version}'),
      ('${foreignCustomer}','${foreignCompany}','active','foreign@example.invalid','${version}');`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

function metadata() {
  return db.query(`SELECT to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
    WHERE p.oid='public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'::regprocedure`)
}

async function applyForwardWithinFixture() {
  // Keep the migration's actual DO block inside this test's rollback boundary.
  await db.exec('SAVEPOINT contact_forward')
  try {
    await db.exec(forward.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, ''))
    await db.exec('RELEASE SAVEPOINT contact_forward')
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT contact_forward; RELEASE SAVEPOINT contact_forward')
    throw error
  }
}

async function write(options: { kind?: string; channel?: string | null; customerId?: string; companyId?: string; key?: string; expectedVersion?: string | null } = {}) {
  const kind = options.kind ?? 'staff'
  const channel = options.channel === undefined ? 'staff_api' : options.channel
  await db.exec('SAVEPOINT contact_write')
  try {
    const r = await db.query<{ result: { changed?: boolean; replayed: boolean; domain_event_id?: string } }>(`SELECT
      gridex_customer_contact_change_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`, [
      options.companyId ?? company, options.customerId ?? customer, kind,
      kind === 'staff' ? actor : null, channel === 'ops' || channel === 'phone' ? null : client,
      kind === 'customer_portal' ? 'synthetic-portal' : null, channel,
      options.expectedVersion === undefined ? version : options.expectedVersion,
      { email: 'after@example.invalid' }, { name: 'Synthetic contact', email: 'contact@example.invalid' }, options.key ?? 'contact-key',
    ])
    await db.exec('RELEASE SAVEPOINT contact_write')
    return r.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT contact_write; RELEASE SAVEPOINT contact_write')
    throw error
  }
}

async function legacyAllowed() {
  return (await db.query<{ allowed: boolean }>('SELECT gridex_actor_has_company_permission($1,$2,$3) AS allowed',
    [actor, company, 'masterdata.write'])).rows[0].allowed
}

async function countWrites() {
  return (await db.query<{ audit: number; events: number; outbox: number; contacts: number; email: string }>(`SELECT
    (SELECT count(*)::integer FROM audit_logs) AS audit,
    (SELECT count(*)::integer FROM domain_events) AS events,
    (SELECT count(*)::integer FROM event_outbox) AS outbox,
    (SELECT count(*)::integer FROM customer_contacts) AS contacts,
    (SELECT email FROM customers WHERE id='${customer}') AS email`)).rows[0]
}

async function allowLegacy() {
  await db.exec(`INSERT INTO permissions VALUES('${permission}','masterdata.write','Master data',true);
    INSERT INTO user_permissions(company_id,user_id,permission_id,effect,status,is_active)
    VALUES('${company}','${actor}','${permission}','allow','active',true);`)
}

describe('staff API contact authority uses its fresh company role profile instead of the legacy resolver', () => {
  it('reproduces the historical full contact SQL rejecting a valid profile-only staff actor', async () => {
    await db.exec(contact)
    expect(await legacyAllowed()).toBe(false)
    await expect(write()).rejects.toMatchObject({ code: '42501', message: 'contact_change_actor_not_authorized' })
    expect(await countWrites()).toEqual({ audit: 0, events: 0, outbox: 0, contacts: 0, email: 'before@example.invalid' })
  })

  it('writes with a valid company profile even when the actual legacy resolver is false', async () => {
    expect(await legacyAllowed()).toBe(false)
    await expect(write()).resolves.toMatchObject({ changed: true, replayed: false })
    expect(await countWrites()).toEqual({ audit: 1, events: 1, outbox: 1, contacts: 1, email: 'after@example.invalid' })
    const r = await db.query<{ company_id: string; actor_user_id: string; source: string; audit: Record<string, unknown>; event: Record<string, unknown> }>(`SELECT
      a.company_id,a.actor_user_id,d.source,a.metadata AS audit,d.payload AS event
      FROM audit_logs a JOIN domain_events d ON d.company_id=a.company_id AND d.aggregate_id=a.entity_id`)
    expect(r.rows[0]).toMatchObject({ company_id: company, actor_user_id: actor, source: 'staff_api',
      audit: { channel: 'staff_api', actor_type: 'staff', api_client_id: client },
      event: { channel: 'staff_api', actor_user_id: actor, api_client_id: client } })
  })

  it('uses only a company-scoped allow override and still lets deny defeat the profile', async () => {
    await db.exec(`UPDATE company_memberships SET role_key='finance_readonly';
      INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active) VALUES
      (NULL,'${actor}','masterdata.write','allow','active',true),
      ('${foreignCompany}','${actor}','masterdata.write','allow','active',true);`)
    await expect(write()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      VALUES('${company}','${actor}','masterdata.write','allow','active',true)`)
    expect(await legacyAllowed()).toBe(false)
    await expect(write()).resolves.toMatchObject({ changed: true })
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      VALUES('${company}','${actor}','masterdata.write','deny','active',true)`)
    await expect(write({ key: 'new-key', expectedVersion: null })).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    expect((await countWrites()).audit).toBe(1)
  })

  it.each([
    ['UPDATE integration_api_clients SET revoked_at=now()', 'staff_api_client_not_in_scope'],
    ["UPDATE integration_api_clients SET scopes=ARRAY['*','staff_cases.write']", 'staff_api_client_not_in_scope'],
    [`UPDATE integration_api_clients SET company_id='${foreignCompany}'`, 'staff_api_client_not_in_scope'],
    ["UPDATE company_memberships SET role_key='finance_readonly'", 'staff_api_actor_not_authorized'],
    ["UPDATE company_memberships SET status='disabled',is_active=false", 'staff_api_actor_inactive'],
    ['UPDATE company_memberships SET accepted_at=NULL', 'staff_api_actor_inactive'],
    ["UPDATE user_profiles SET user_status='disabled'", 'staff_api_actor_inactive'],
    ["UPDATE auth.users SET banned_until=now()+interval '1 hour'", 'staff_api_actor_inactive'],
  ])('rejects before contact/audit writes when current eligibility changes: %s', async (change, message) => {
    await db.exec(change)
    await expect(write()).rejects.toMatchObject({ code: '42501', message })
    expect(await countWrites()).toEqual({ audit: 0, events: 0, outbox: 0, contacts: 0, email: 'before@example.invalid' })
  })

  it('denies a low role even if the legacy resolver would authorize a platform administrator', async () => {
    await db.exec(`INSERT INTO permissions VALUES('${permission}','masterdata.write','Master data',true);
      INSERT INTO admin_users VALUES('${actor}','super_admin',true);
      UPDATE company_memberships SET role_key='finance_readonly'`)
    expect(await legacyAllowed()).toBe(true)
    await expect(write()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
  })

  it('rechecks the staff guard before an idempotent replay and never adds another audit', async () => {
    await write()
    await expect(write()).resolves.toMatchObject({ replayed: true })
    await db.exec('UPDATE integration_api_clients SET revoked_at=now()')
    await expect(write()).rejects.toMatchObject({ message: 'staff_api_client_not_in_scope' })
    expect((await countWrites()).audit).toBe(1)
  })

  it('cannot bypass company/customer ownership, optimistic versions or staff actor-kind validation', async () => {
    await expect(write({ companyId: foreignCompany })).rejects.toMatchObject({ message: 'staff_api_actor_inactive' })
    await expect(write({ customerId: foreignCustomer })).rejects.toMatchObject({ code: 'P0002', message: 'customer_not_found_in_scope' })
    await expect(write({ expectedVersion: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ code: '40001', message: 'contact_change_version_conflict' })
    await expect(write({ kind: 'customer_portal' })).rejects.toMatchObject({ message: 'contact_change_staff_api_actor_invalid' })
    expect((await countWrites()).audit).toBe(0)
  })

  it.each([null, 'unrecognized_channel'])('still rejects an invalid or absent channel: %s', async (channel) => {
    await expect(write({ channel })).rejects.toMatchObject({ code: '22023', message: 'contact_change_channel_invalid' })
    expect((await countWrites()).audit).toBe(0)
  })

  it.each(['ops', 'phone'])('preserves the actual legacy permission outcome and OPS audit for %s', async (channel) => {
    await expect(write({ channel })).rejects.toMatchObject({ message: 'contact_change_actor_not_authorized' })
    await allowLegacy()
    expect(await legacyAllowed()).toBe(true)
    await expect(write({ channel })).resolves.toMatchObject({ changed: true })
    const r = await db.query<{ source: string; channel: string; actor: string; client: string | null }>(`SELECT
      d.source,a.metadata->>'channel' AS channel,a.actor_user_id AS actor,a.metadata->>'api_client_id' AS client
      FROM domain_events d JOIN audit_logs a ON a.company_id=d.company_id`)
    expect(r.rows[0]).toEqual({ source: 'ops', channel, actor, client: null })
  })

  it('preserves customer API writes without introducing the staff permission resolver', async () => {
    await db.exec('UPDATE company_memberships SET is_active=false; UPDATE integration_api_clients SET revoked_at=now()')
    await expect(write({ kind: 'customer_portal', channel: 'customer_api' })).resolves.toMatchObject({ changed: true })
    const r = await db.query<{ source: string; actor: string | null; channel: string; kind: string; client: string }>(`SELECT
      d.source,a.actor_user_id AS actor,a.metadata->>'channel' AS channel,a.metadata->>'actor_type' AS kind,
      a.metadata->>'api_client_id' AS client FROM domain_events d JOIN audit_logs a ON a.company_id=d.company_id`)
    expect(r.rows[0]).toEqual({ source: 'customer_api', actor: null, channel: 'customer_api', kind: 'customer_portal_account', client })
  })

  it('rolls back the whole contact mutation if atomic audit insertion fails', async () => {
    await db.exec(`CREATE FUNCTION fail_contact_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit_unavailable';END$$;
      CREATE TRIGGER fail_contact_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_contact_audit()`)
    await expect(write()).rejects.toMatchObject({ message: 'audit_unavailable' })
    expect(await countWrites()).toEqual({ audit: 0, events: 0, outbox: 0, contacts: 0, email: 'before@example.invalid' })
  })

  it('preserves the existing function identity, invoker mode, owner, configuration and ACL', () => {
    expect(afterMetadata).toEqual(beforeMetadata)
    expect(afterBody).toBe(beforeBody.replace("  IF p_actor_kind='staff'\n     AND NOT coalesce(public.gridex_actor_has_company_permission",
      "  IF p_actor_kind='staff'\n     AND p_channel <> 'staff_api'\n     AND NOT coalesce(public.gridex_actor_has_company_permission"))
  })

  it('can reapply the forward without any second body or permission change', async () => {
    await applyForwardWithinFixture()
    await expect(write()).resolves.toMatchObject({ changed: true })
    expect((await metadata()).rows[0]).toEqual(afterMetadata)
  })

  it.each([
    ["p_channel NOT IN ('ops','customer_api','phone','staff_api') OR p_channel IS NULL", "p_channel NOT IN ('ops','customer_api','phone','staff_api')"],
    ["IF p_actor_kind IS DISTINCT FROM 'staff' THEN", "IF false THEN"],
    ["p_api_client_id,'masterdata.write');", "p_api_client_id,'customers.write');"],
    ["PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'masterdata.write');", "NULL;"],
  ])('refuses an unexpected contact predecessor before changing its SQL: %s', async (needle, replacement) => {
    await db.exec(contact.replace(needle, replacement))
    const unchanged = (await db.query('SELECT prosrc FROM pg_proc WHERE oid=\'public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)\'::regprocedure')).rows[0]
    await expect(applyForwardWithinFixture()).rejects.toMatchObject({ message: 'staff_contact_profile_guard_predecessor_mismatch' })
    expect((await db.query('SELECT prosrc FROM pg_proc WHERE oid=\'public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)\'::regprocedure')).rows[0]).toEqual(unchanged)
  })

  it('refuses to skip the legacy resolver if the staff guard was moved after replay', async () => {
    const guardStart = contact.indexOf("  IF p_channel NOT IN ('ops'")
    const guardEnd = contact.indexOf('  FOR v_key IN SELECT jsonb_object_keys', guardStart)
    const guardBlock = contact.slice(guardStart, guardEnd)
    await db.exec(contact.replace(guardBlock, '').replace('  SELECT * INTO v_customer', guardBlock + '  SELECT * INTO v_customer'))
    await expect(applyForwardWithinFixture()).rejects.toMatchObject({ message: 'staff_contact_profile_guard_predecessor_mismatch' })
  })
})
