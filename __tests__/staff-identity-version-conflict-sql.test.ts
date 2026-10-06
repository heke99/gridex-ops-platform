import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { staffCapturedIdentityAuthoritySql } from './fixtures/staff-captured-identity-authority'

const capturedSchema = readFileSync('supabase/schema.sql', 'utf8')
const attributionMigration = readFileSync('supabase/migrations/20261004084204_staff_customer_write_attribution.sql', 'utf8')
const identityStart = attributionMigration.indexOf('CREATE OR REPLACE FUNCTION public.gridex_decide_customer_identity_change_v1(')
const identityPredecessor = attributionMigration.slice(identityStart, attributionMigration.indexOf('\nREVOKE ALL ON FUNCTION', identityStart))
const forward = readFileSync('supabase/migrations/20261005010327_customer_identity_version_conflict_http409.sql', 'utf8')
const signature = 'public.gridex_decide_customer_identity_change_v1(uuid,uuid,text,text,uuid,jsonb)'
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const customer = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const request = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
let db: PGlite
let predecessor: Awaited<ReturnType<typeof installedIdentity>>
let qualified: Awaited<ReturnType<typeof installedIdentity>>

function capturedFunction(name: string) {
  const start = capturedSchema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (start < 0) throw new Error(`Missing captured function: ${name}`)
  return capturedSchema.slice(start, capturedSchema.indexOf('\n\n--\n-- Name:', start))
}

function capturedTable(name: string) {
  const start = capturedSchema.indexOf(`CREATE TABLE public.${name} (`)
  if (start < 0) throw new Error(`Missing captured table: ${name}`)
  return capturedSchema.slice(start, capturedSchema.indexOf('\n);', start) + 3)
}

beforeAll(async () => {
  db = new PGlite()
  // The decision uses its qualified historical SQL so a fresh generated capture
  // cannot skip the predecessor branch. Masking and staff authorization use captured SQL.
  // These finite tables supply their real columns; no authorization function is mocked.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active boolean);
    CREATE TABLE company_memberships(company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE admin_users(user_id uuid,role text,is_active boolean);
    CREATE TABLE roles(id uuid PRIMARY KEY,key text,name text,is_active boolean);
    CREATE TABLE user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
    CREATE TABLE permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),personal_number text,org_number text,updated_at timestamptz);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,actor_type text,system_actor text,entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb,request_id text,correlation_id text,resource_type text,resource_id text);`)
  await db.exec(capturedTable('customer_identity_change_requests'))
  await db.exec(capturedTable('customer_identity_change_events'))
  await db.exec(`ALTER TABLE customer_identity_change_requests ADD PRIMARY KEY(id);
    ALTER TABLE customer_identity_change_events ADD PRIMARY KEY(id);`)
  await db.exec(staffCapturedIdentityAuthoritySql(capturedSchema))
  for (const name of ['gridex_normalize_platform_role', 'canonical_actor_is_platform_admin',
    'gridex_staff_normalize_role_v1', 'gridex_staff_role_profile_v1', 'gridex_staff_actor_permissions_v1',
    'gridex_staff_assert_write_actor_v1', 'gridex_mask_identity_number']) {
    await db.exec(capturedFunction(name))
  }
  await db.exec(identityPredecessor)
  await db.exec(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)
  predecessor = await installedIdentity()
  await db.exec(forward)
  qualified = await installedIdentity()
}, 20_000)

afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies VALUES('${company}','active',true),('${foreignCompany}','active',true);
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO user_profiles VALUES('${actor}','active');
    INSERT INTO company_memberships VALUES('${company}','${actor}','company_admin','company_admin','active',true,now());
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_customers.write']);
    INSERT INTO customers VALUES('${customer}','${company}','19121212-1212',NULL,'2026-10-04T10:00:00Z');
    INSERT INTO customer_identity_change_requests(id,company_id,customer_id,field,previous_value,new_value,reason,requested_by,approval_required,status,source_channel,api_client_id)
      VALUES('${request}','${company}','${customer}','personal_number','19121212-1212','20000101-0008','Synthetic correction','${actor}',false,'pending_customer_approval','staff_api','${client}');
    INSERT INTO customer_identity_change_events(company_id,customer_id,request_id,event_type,actor_kind,actor_user_id,field,previous_value_masked,new_value_masked)
      VALUES('${company}','${customer}','${request}','requested','staff','${actor}','personal_number','••••1212','••••0008');`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function decisionState() {
  return (await db.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'customers', (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM customers c),
    'requests', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM customer_identity_change_requests r),
    'events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM customer_identity_change_events e),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM audit_logs a)
  ) AS state`)).rows[0].state
}

async function installedIdentity() {
  return (await db.query<{ body: string; definition: string; metadata: unknown }>(`SELECT
    p.prosrc AS body, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
    FROM pg_proc p WHERE p.oid='${signature}'::regprocedure`)).rows[0]
}

async function applyForward() {
  await db.exec('SAVEPOINT identity_conflict_forward')
  try {
    await db.exec(forward)
    await db.exec('RELEASE SAVEPOINT identity_conflict_forward')
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT identity_conflict_forward; RELEASE SAVEPOINT identity_conflict_forward')
    throw error
  }
}

async function requireCustomerApproval() {
  await db.exec(`UPDATE customer_identity_change_requests SET approval_required=true,
    affected_contract_count=1,recipient_email='synthetic@example.invalid',token_hash=repeat('a',64),expires_at=now()+interval '1 day'`)
}

async function decide(options: { companyId?: string; requestId?: string; decidedBy?: string; outcome?: string; acceptance?: unknown; role?: string } = {}) {
  const decidedBy = options.decidedBy ?? 'staff'
  await db.exec('SAVEPOINT identity_decision')
  try {
    await db.exec(`SET LOCAL ROLE ${options.role ?? 'service_role'}`)
    const result = await db.query<{ result: Record<string, unknown> }>(`SELECT public.gridex_decide_customer_identity_change_v1($1,$2,$3,$4,$5,$6) AS result`, [
      options.companyId ?? company, options.requestId ?? request, options.outcome ?? 'applied',
      decidedBy, decidedBy === 'staff' ? actor : null, options.acceptance ?? null,
    ])
    await db.exec('RESET ROLE; RELEASE SAVEPOINT identity_decision')
    return result.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT identity_decision; RESET ROLE; RELEASE SAVEPOINT identity_decision')
    throw error
  }
}

describe('staff immediate identity application uses a nonretryable optimistic conflict', () => {
  it('refuses a registered tenant actor without an explicit binding before any identity decision effect', async () => {
    await db.exec(`UPDATE integration_api_clients SET metadata='{"staff_tenant_auth":{"url":"https://abcdefghijklmnopqrst.supabase.co"}}'::jsonb`)
    const before = await decisionState()
    await expect(decide()).rejects.toMatchObject({ code: '42501', message: 'staff_identity_binding_missing' })
    expect(await decisionState()).toEqual(before)
  })

  it.each(['personal_number', 'org_number'])('returns PT409 for %s changed after request creation and preserves every decision effect', async field => {
    if (field === 'org_number') {
      await db.exec("UPDATE customers SET org_number='5599990001'; UPDATE customer_identity_change_requests SET field='org_number',previous_value='5599990001',new_value='5599990002'")
    }
    await db.exec(`UPDATE customers SET ${field}='19811218-9876'`)
    // The earlier request and requested event are already committed in the real
    // multi-call path; only this decision transaction must leave them unchanged.
    const before = await decisionState()
    const error = await decide().then(() => null, error => error)
    expect(await decisionState()).toEqual(before)
    expect(error).toMatchObject({ code: 'PT409', message: 'identity_change_stale' })
  })

  it('preserves the same nonretryable stale conflict for the existing customer approval path', async () => {
    await requireCustomerApproval()
    await db.exec("UPDATE customer_identity_change_requests SET source_channel='ops'; UPDATE customers SET personal_number='19811218-9876'")
    const before = await decisionState()
    const error = await decide({ decidedBy: 'customer' }).then(() => null, error => error)
    expect(await decisionState()).toEqual(before)
    expect(error).toMatchObject({ code: 'PT409', message: 'identity_change_stale' })
  })

  it('applies a permitted staff change once, records masked attribution and rejects a second decision', async () => {
    await expect(decide()).resolves.toEqual({ status: 'applied', request_id: request, customer_id: customer, field: 'personal_number' })
    expect((await db.query('SELECT personal_number FROM customers')).rows[0]).toEqual({ personal_number: '20000101-0008' })
    expect((await db.query('SELECT status,decided_by FROM customer_identity_change_requests')).rows[0]).toEqual({ status: 'applied', decided_by: 'staff' })
    const events = (await db.query('SELECT event_type,actor_user_id,previous_value_masked,new_value_masked,detail FROM customer_identity_change_events ORDER BY created_at,id')).rows
    expect(events).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ event_type: 'applied', actor_user_id: actor,
      previous_value_masked: '••••1212', new_value_masked: '••••0008',
      detail: expect.objectContaining({ channel: 'staff_api', api_client_id: client, originating_staff_actor_user_id: actor }) }))
    const audits = (await db.query('SELECT actor_user_id,action,old_values,new_values,metadata FROM audit_logs')).rows
    expect(audits).toEqual([expect.objectContaining({ actor_user_id: actor, action: 'customer_identity_change_applied',
      old_values: { personal_number: '••••1212' }, new_values: { personal_number: '••••0008' },
      metadata: expect.objectContaining({ channel: 'staff_api', api_client_id: client, originating_staff_actor_user_id: actor }) })])
    const completed = await decisionState()
    await expect(decide()).rejects.toMatchObject({ code: '55000', message: 'identity_change_not_pending' })
    expect(await decisionState()).toEqual(completed)
  })

  it('still requires customer approval before a staff application', async () => {
    await requireCustomerApproval()
    const before = await decisionState()
    await expect(decide()).rejects.toMatchObject({ code: '42501', message: 'identity_change_requires_customer_approval' })
    expect(await decisionState()).toEqual(before)
  })

  it('still requires every takeover acceptance confirmation', async () => {
    await requireCustomerApproval()
    await db.exec(`UPDATE customer_identity_change_requests SET source_channel='ops',takeover_required=true,
      takeover_snapshot='{"contracts":[],"terms":[]}',takeover_snapshot_sha256=repeat('b',64)`)
    const before = await decisionState()
    await expect(decide({ decidedBy: 'customer', acceptance: { snapshot_sha256: 'b'.repeat(64),
      confirmations: { identity: true, contracts: true, terms: false } } })).rejects.toMatchObject({ code: '42501', message: 'identity_change_takeover_acceptance_required' })
    expect(await decisionState()).toEqual(before)
  })

  it.each([
    ["UPDATE company_memberships SET role_key='finance_readonly'", 'staff_api_actor_not_authorized'],
    ['UPDATE integration_api_clients SET revoked_at=now()', 'staff_api_client_not_in_scope'],
    ['UPDATE auth.users SET banned_until=now()+interval \'1 hour\'', 'staff_api_actor_inactive'],
    [`INSERT INTO user_permissions(company_id,user_id,permission_key,status,is_active,effect) VALUES('${company}','${actor}','customers.write','active',true,'deny')`, 'staff_api_actor_not_authorized'],
  ])('keeps current staff eligibility fail closed: %s', async (change, message) => {
    await db.exec(change)
    const before = await decisionState()
    await expect(decide()).rejects.toMatchObject({ code: '42501', message })
    expect(await decisionState()).toEqual(before)
  })

  it('never finds another company request', async () => {
    const before = await decisionState()
    await expect(decide({ companyId: foreignCompany })).rejects.toMatchObject({ code: 'P0002', message: 'identity_change_not_found' })
    expect(await decisionState()).toEqual(before)
  })

  it.each(['anon', 'authenticated'])('keeps the decision RPC inaccessible to %s', async role => {
    const before = await decisionState()
    await expect(decide({ role })).rejects.toMatchObject({ code: '42501' })
    expect(await decisionState()).toEqual(before)
  })
})

describe('the guarded identity conflict forward preserves canonical function custody', () => {
  it('changes only the optimistic error line and preserves all function metadata', () => {
    expect(qualified.metadata).toEqual(predecessor.metadata)
    expect(qualified.body).toBe(predecessor.body.replace(
      "RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = '40001';",
      "RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = 'PT409';",
    ))
  })

  it('can reapply the entire unchanged source without touching the function or successful decision effects', async () => {
    await decide()
    const functionBefore = await installedIdentity()
    const effectsBefore = await decisionState()
    await applyForward()
    expect(await installedIdentity()).toEqual(functionBefore)
    expect(await decisionState()).toEqual(effectsBefore)
  })

  it.each([
    ["'identity_change_stale'", "'unrecognized_identity_conflict'"],
    ["r.api_client_id,'customers.write');", "r.api_client_id,'masterdata.write');"],
    ["r.source_channel='staff_api'", "r.source_channel='ops'"],
  ])('rejects an incompatible function body without altering it: %s', async (needle, replacement) => {
    const installed = await installedIdentity()
    await db.exec(installed.definition.replace(installed.body, installed.body.replace(needle, replacement)))
    const incompatible = await installedIdentity()
    await expect(applyForward()).rejects.toMatchObject({ message: 'identity_version_conflict_predecessor_mismatch' })
    expect(await installedIdentity()).toEqual(incompatible)
  })

  it('rejects invoker mode even when the predecessor body is authentic', async () => {
    const installed = await installedIdentity()
    await db.exec(installed.definition.replace(installed.body, predecessor.body))
    await db.exec(`ALTER FUNCTION ${signature} SECURITY INVOKER`)
    const incompatible = await installedIdentity()
    await expect(applyForward()).rejects.toMatchObject({ message: 'identity_version_conflict_predecessor_mismatch' })
    expect(await installedIdentity()).toEqual(incompatible)
  })
})
