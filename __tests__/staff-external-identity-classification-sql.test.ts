import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const { buildStaffExternalIdentityFixture } = createRequire(import.meta.url)('../scripts/lib/staff-external-identity-sql-fixture.cjs') as { buildStaffExternalIdentityFixture(root: string): string }
const forwardPath = 'supabase/migrations/20261005160940_classify_tenant_staff_external_identity_tables.sql'
const tables = ['tenant_staff_actor_anchors', 'tenant_staff_identity_bindings', 'tenant_staff_identity_deliveries']
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const gate = source('scripts/sql/tenant-isolation-invariants.sql').replace(/^\\set.*$/gm, '')

async function catalog(db: PGlite, includeReplacedKeys = false) {
  return (await db.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'),
    'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'),
    'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE $1 OR c.conname<>ALL($2::text[])),
    'indexes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.indexrelid) FROM pg_index x JOIN pg_class c ON c.oid=x.indexrelid WHERE $1 OR c.relname<>ALL($2::text[])),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
    'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t),
    'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'private'::regnamespace)),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),
    'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m)) state`,
  [includeReplacedKeys, tables.map(table => `${table}_invitation_id_key`)])).rows[0].state
}

async function fixture() {
  const db = new PGlite()
  const schema = source('supabase/schema.sql')
  const table = schema.match(/CREATE TABLE public\.platform_table_classification \([\s\S]+?\n\);/)?.[0]
  const primaryKey = schema.match(/ALTER TABLE ONLY public\.platform_table_classification\s+ADD CONSTRAINT platform_table_classification_pkey[^;]*;/)?.[0]
  if (!table || !primaryKey) throw new Error('Missing actual classification catalog definitions')
  await db.exec(buildStaffExternalIdentityFixture(root))
  await db.exec(`${table}\n${primaryKey}
    ALTER TABLE public.platform_table_classification ENABLE ROW LEVEL SECURITY;
    -- Unrelated finite-fixture infrastructure is outside this regression's three
    -- actual tenant tables. Close its synthetic grants/RLS and classify it only
    -- in this disposable database before applying the complete frozen forward.
    DO $$ DECLARE item record; BEGIN
      FOR item IN SELECT c.oid::regclass name FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',item.name);
      END LOOP;
    END $$;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
    INSERT INTO public.platform_table_classification(table_name,kind,rationale)
      SELECT c.relname,'system','Unrelated synthetic fixture infrastructure, not a production classification.'
      FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r';`)
  await db.exec(source('supabase/migrations/20261005124901_tenant_staff_external_identity_bindings.sql'))
  return db
}

it('reproduces the exact missing classifications and reveals the invitation-index guard after truthful tenant classification', async () => {
  const db = await fixture()
  try {
    await expect(db.exec(gate)).rejects.toThrow('Tenant isolation invariants failed (3 breach(es))')
    for (const table of tables) {
      await expect(db.exec(gate)).rejects.toThrow(`F-6: table ${table} is not classified`)
    }
    await db.query(`INSERT INTO public.platform_table_classification(table_name,kind,rationale)
      SELECT unnest($1::text[]),'tenant','Diagnostic classification inside the disposable regression.'`, [tables])
    await expect(db.exec(gate)).rejects.toThrow('Tenant isolation invariants failed (3 breach(es))')
    for (const table of tables) {
      await expect(db.exec(gate)).rejects.toThrow(`F-8/F-10: unique index ${table}_invitation_id_key on tenant table ${table} is not scoped by company_id`)
    }
  } finally { await db.close() }
}, 30_000)

it('applies the actual forward and passes the entire unchanged tenant-isolation gate', async () => {
  const db = await fixture()
  try {
    const before = await catalog(db)
    const previousRegistry = (await db.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows
    await db.exec(source(forwardPath))
    await expect(db.exec(gate)).resolves.toBeDefined()
    expect((await db.query<{ table_name: string; kind: string; null_company_meaning: string | null }>(
      'SELECT table_name,kind,null_company_meaning FROM public.platform_table_classification WHERE table_name=ANY($1::text[]) ORDER BY table_name', [tables])).rows)
      .toEqual(tables.map(table_name => ({ table_name, kind: 'tenant', null_company_meaning: null })))
    expect((await db.query<{ columns: string[] }>(`SELECT array_agg(a.attname ORDER BY k.ordinality) columns
      FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conname=ANY($1::text[]) GROUP BY c.conname ORDER BY c.conname`, [tables.map(table => `${table}_invitation_id_key`)])).rows)
      .toEqual(tables.map(() => ({ columns: ['invitation_id', 'company_id'] })))
    expect(await catalog(db)).toEqual(before)
    expect((await db.query('SELECT * FROM public.platform_table_classification WHERE table_name<>ALL($1::text[]) ORDER BY table_name', [tables])).rows).toEqual(previousRegistry)
    const correctedCatalog = await catalog(db, true)
    const correctedRegistry = (await db.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows
    await db.exec(source(forwardPath))
    expect(await catalog(db, true)).toEqual(correctedCatalog)
    expect((await db.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows).toEqual(correctedRegistry)
    await expect(db.exec(gate)).resolves.toBeDefined()
  } finally { await db.close() }
}, 30_000)

it('preserves duplicate-invitation rejection, foreign-company rejection, and multiple explicit NULL-invitation bindings', async () => {
  const db = await fixture()
  const company = '10000000-0000-4000-8000-000000000001'
  const foreignCompany = '10000000-0000-4000-8000-000000000002'
  const client = '20000000-0000-4000-8000-000000000001'
  const provider = '30000000-0000-4000-8000-000000000001'
  const invitation = '40000000-0000-4000-8000-000000000001'
  const unanchoredInvitation = '40000000-0000-4000-8000-000000000002'
  const actors = ['50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003']
  try {
    await db.query('INSERT INTO public.companies(id,name) VALUES($1,\'First synthetic company\'),($2,\'Foreign synthetic company\')', [company, foreignCompany])
    await db.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [actors])
    await db.query(`INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash) VALUES($1,$2,'Synthetic client','classification-test',repeat('a',64))`, [client, company])
    await db.query(`INSERT INTO public.tenant_customer_identity_providers(id,company_id,kind,display_name,issuer,audience,public_jwk) VALUES($1,$2,'tenant_key','Synthetic provider','https://tenant.example','staff','{}')`, [provider, company])
    await db.query(`INSERT INTO public.company_invitations(id,company_id,email) SELECT unnest($1::uuid[]),$2,'synthetic@example.invalid'`, [[invitation, unanchoredInvitation], company])
    const anchor = (actor: string, owner: string, invite = invitation) => db.query('INSERT INTO public.tenant_staff_actor_anchors(actor_user_id,company_id,invitation_id) VALUES($1,$2,$3)', [actor, owner, invite])
    const delivery = () => db.query<{ id: string }>(`INSERT INTO public.tenant_staff_identity_deliveries(company_id,api_client_id,provider_id,invitation_id,actor_user_id,local_auth_issuer,recipient_email,request_payload,request_hash)
      VALUES($1,$2,$3,$4,$5,'https://tenant.example/auth/v1','synthetic@example.invalid','{}',repeat('b',64)) RETURNING id`, [company, client, provider, invitation, actors[0]])
    await anchor(actors[0], company)
    const deliveryId = (await delivery()).rows[0].id
    const binding = () => db.query(`INSERT INTO public.tenant_staff_identity_bindings(company_id,api_client_id,provider_id,local_auth_issuer,local_user_id,actor_user_id,provider_configuration,invitation_id,delivery_id)
      VALUES($1,$2,$3,'https://tenant.example/auth/v1',gen_random_uuid(),$4,'{}',$5,$6)`, [company, client, provider, actors[0], invitation, deliveryId])
    await binding()
    await db.query(`INSERT INTO public.tenant_staff_identity_bindings(company_id,api_client_id,provider_id,local_auth_issuer,local_user_id,actor_user_id,provider_configuration)
      SELECT $1,$2,$3,'https://tenant.example/auth/v1',gen_random_uuid(),unnest($4::uuid[]),'{}'::jsonb`, [company, client, provider, actors.slice(1)])
    const storedRows = async () => (await db.query<{ rows: unknown }>(`SELECT jsonb_build_object(
      'anchors',(SELECT jsonb_agg(to_jsonb(t) ORDER BY actor_user_id) FROM public.tenant_staff_actor_anchors t),
      'deliveries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_staff_identity_deliveries t),
      'bindings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_staff_identity_bindings t)) rows`)).rows[0].rows
    const beforeRows = await storedRows()
    // Both states must admit and reject the same rows, not merely have similar DDL.
    for (const corrected of [false, true]) {
      if (corrected) await db.exec(source(forwardPath))
      await expect(anchor(actors[1], company)).rejects.toMatchObject({ code: '23505', constraint: 'tenant_staff_actor_anchors_invitation_id_key' })
      await expect(anchor(actors[1], foreignCompany, unanchoredInvitation)).rejects.toMatchObject({ code: '23503', constraint: 'tenant_staff_actor_anchors_invitation_id_company_id_fkey' })
      await expect(delivery()).rejects.toMatchObject({ code: '23505', constraint: 'tenant_staff_identity_deliveries_invitation_id_key' })
      await expect(binding()).rejects.toMatchObject({ code: '23505' })
      expect(await storedRows()).toEqual(beforeRows)
    }
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.tenant_staff_identity_bindings WHERE invitation_id IS NULL AND delivery_id IS NULL')).rows[0].count).toBe(2)
    await expect(db.query(`INSERT INTO public.tenant_staff_identity_bindings(company_id,api_client_id,provider_id,local_auth_issuer,local_user_id,actor_user_id,provider_configuration,invitation_id)
      VALUES($1,$2,$3,'https://tenant.example/auth/v1',gen_random_uuid(),$4,'{}',$5)`, [company, client, provider, actors[0], invitation])).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(gate)).resolves.toBeDefined()
  } finally { await db.close() }
}, 30_000)

for (const [description, drift, error] of [
  ['missing global parent primary key', 'ALTER TABLE public.company_invitations DROP CONSTRAINT company_invitations_pkey', 'parent_mismatch'],
  ['missing identity table', 'DROP TABLE public.tenant_staff_identity_bindings', 'table_missing'],
  ['nullable company', 'ALTER TABLE public.tenant_staff_identity_bindings ALTER COLUMN company_id DROP NOT NULL', 'company_fk_mismatch'],
  ['missing composite ownership FK', 'ALTER TABLE public.tenant_staff_identity_bindings DROP CONSTRAINT tenant_staff_identity_bindings_invitation_id_company_id_fkey', 'company_fk_mismatch'],
  ['unvalidated composite ownership FK', 'ALTER TABLE public.tenant_staff_identity_bindings DROP CONSTRAINT tenant_staff_identity_bindings_invitation_id_company_id_fkey; ALTER TABLE public.tenant_staff_identity_bindings ADD CONSTRAINT tenant_staff_identity_bindings_invitation_id_company_id_fkey FOREIGN KEY(invitation_id,company_id) REFERENCES public.company_invitations(id,company_id) NOT VALID', 'company_fk_mismatch'],
  ['unexpected unique key', 'ALTER TABLE public.tenant_staff_identity_bindings DROP CONSTRAINT tenant_staff_identity_bindings_invitation_id_key; ALTER TABLE public.tenant_staff_identity_bindings ADD CONSTRAINT tenant_staff_identity_bindings_invitation_id_key UNIQUE(invitation_id,actor_user_id)', 'unique_mismatch'],
  ['unexpected NULLS NOT DISTINCT uniqueness', 'ALTER TABLE public.tenant_staff_identity_bindings DROP CONSTRAINT tenant_staff_identity_bindings_invitation_id_key; ALTER TABLE public.tenant_staff_identity_bindings ADD CONSTRAINT tenant_staff_identity_bindings_invitation_id_key UNIQUE NULLS NOT DISTINCT(invitation_id)', 'unique_mismatch'],
  ['incoming invitation-only FK', 'CREATE TABLE public.synthetic_invitation_dependency(invitation_id uuid REFERENCES public.tenant_staff_identity_bindings(invitation_id))', 'unique_dependency'],
] as const) {
  it(`refuses ${description} atomically without classifying or altering earlier tables`, async () => {
    const db = await fixture()
    try {
      await db.exec(drift)
      const before = await catalog(db, true)
      const registry = (await db.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows
      await expect(db.exec(source(forwardPath))).rejects.toThrow(`staff_identity_classification_${error}`)
      expect(await catalog(db, true)).toEqual(before)
      expect((await db.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows).toEqual(registry)
    } finally { await db.close() }
  }, 30_000)
}
