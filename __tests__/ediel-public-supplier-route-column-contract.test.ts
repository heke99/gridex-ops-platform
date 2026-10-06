import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Finite PostgreSQL column compatibility regression. The three table/type DDLs,
// policies and ACLs are captured source; their auth functions are explicit deny
// ports. Public supplier APIs, registry/materializer authority and complete
// route readiness remain the separate genuine native contract consumer.
const root = resolve(import.meta.dirname, '..')
// Immutable pre-repair capture: supabase/schema.sql at Git
// f9d030f2dd7544ddc20e306d07f801f97a0e1588.
// Full source SHA256: 8dc63eaab63bae12a267e3e2a45c16c6bdb8d729b26e8e454791b66fcd08f38f.
// These 32 exact source statements are joined with two newlines; extracted SHA256:
// a807a162e3632e5ae62ddbd46c4ad7203590c33178fb1bd9bb8f84dd0af61d8a.
// Future canonical captures may include the repair; this baseline stays historical.
const schema = `CREATE TYPE public.ediel_environment_type AS ENUM (
    'tgt_test',
    'agt_test',
    'bilateral_test',
    'production'
);

CREATE TABLE public.electricity_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    org_number text,
    market_actor_code text,
    ediel_id text,
    contact_name text,
    email text,
    phone text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    is_own_supplier boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    verified_for_customer_flow boolean DEFAULT false NOT NULL,
    technical_owner_only boolean DEFAULT true NOT NULL,
    actor_registry_status text DEFAULT 'under_review'::text NOT NULL,
    platform_market_actor_id uuid,
    verification_status text,
    verification_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    route_status text,
    certificate_status text,
    can_start_supplier_switch boolean DEFAULT false NOT NULL,
    not_seen_in_latest_import boolean DEFAULT false NOT NULL,
    last_seen_in_import_at timestamp with time zone,
    verification_checked_at timestamp with time zone,
    verification_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT electricity_suppliers_own_requires_company CHECK (((NOT COALESCE(is_own_supplier, false)) OR (company_id IS NOT NULL)))
);

ALTER TABLE public.electricity_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY gridex_masterdata_authenticated_select_v1 ON public.electricity_suppliers FOR SELECT TO authenticated USING ((( SELECT public.gridex_has_permission(( SELECT auth.uid() AS uid), 'masterdata.read'::text) AS gridex_has_permission) OR ( SELECT public.gridex_has_permission(( SELECT auth.uid() AS uid), 'masterdata.write'::text) AS gridex_has_permission)));

CREATE POLICY tenant_lifecycle_delete_guard ON public.electricity_suppliers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_insert_guard ON public.electricity_suppliers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_select_guard ON public.electricity_suppliers AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT public.gridex_is_current_session_allowed() AS gridex_is_current_session_allowed) AND (( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR (company_id IN ( SELECT public.gridex_user_company_ids() AS gridex_user_company_ids)))));

CREATE POLICY tenant_lifecycle_update_guard ON public.electricity_suppliers AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.gridex_can_write_company(company_id)) WITH CHECK (public.gridex_can_write_company(company_id));

GRANT ALL ON TABLE public.electricity_suppliers TO authenticated;

GRANT ALL ON TABLE public.electricity_suppliers TO service_role;

CREATE TABLE public.communication_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    route_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    route_scope text DEFAULT 'supplier_switch'::text NOT NULL,
    route_type text DEFAULT 'ediel_partner'::text NOT NULL,
    grid_owner_id uuid,
    target_system text,
    endpoint text,
    target_email text,
    auth_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    supported_payload_version text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    environment_type public.ediel_environment_type,
    market_party_role text,
    counterparty_ediel_id text,
    CONSTRAINT communication_routes_ediel_ack_environment_required CHECK (((route_scope <> 'ediel_ack'::text) OR (environment_type IS NOT NULL))),
    CONSTRAINT communication_routes_route_scope_check CHECK ((route_scope = ANY (ARRAY['supplier_switch'::text, 'customer_masterdata'::text, 'meter_values'::text, 'metering_values'::text, 'billing_underlay'::text, 'metering_access'::text, 'ediel_ack'::text])))
);

ALTER TABLE public.communication_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY gridex_db1_communication_routes_insert ON public.communication_routes FOR INSERT WITH CHECK ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_write_company(company_id))));

CREATE POLICY gridex_db1_communication_routes_select ON public.communication_routes FOR SELECT USING ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_read_company(company_id))));

CREATE POLICY gridex_db1_communication_routes_update ON public.communication_routes FOR UPDATE USING ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_read_company(company_id)))) WITH CHECK ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_write_company(company_id))));

CREATE POLICY tenant_lifecycle_delete_guard ON public.communication_routes AS RESTRICTIVE FOR DELETE TO authenticated USING (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_insert_guard ON public.communication_routes AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_select_guard ON public.communication_routes AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT public.gridex_is_current_session_allowed() AS gridex_is_current_session_allowed) AND (( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR (company_id IN ( SELECT public.gridex_user_company_ids() AS gridex_user_company_ids)))));

CREATE POLICY tenant_lifecycle_update_guard ON public.communication_routes AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.gridex_can_write_company(company_id)) WITH CHECK (public.gridex_can_write_company(company_id));

GRANT ALL ON TABLE public.communication_routes TO authenticated;

GRANT ALL ON TABLE public.communication_routes TO service_role;

CREATE TABLE public.ediel_route_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    communication_route_id uuid,
    is_enabled boolean DEFAULT true NOT NULL,
    sender_ediel_id text,
    sender_sub_address text,
    sender_name text,
    receiver_ediel_id text,
    receiver_sub_address text,
    receiver_name text,
    application_reference text,
    smtp_host text,
    smtp_port integer,
    imap_host text,
    imap_port integer,
    mailbox text,
    encryption_mode text DEFAULT 'none'::text,
    payload_format text DEFAULT 'edifact'::text NOT NULL,
    default_message_version text,
    default_test_flag integer DEFAULT 1 NOT NULL,
    default_timezone integer DEFAULT 1 NOT NULL,
    environment text DEFAULT 'test'::text NOT NULL,
    message_standard text DEFAULT 'edifact'::text NOT NULL,
    ack_mode text DEFAULT 'default'::text NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    message_family text,
    message_code text,
    own_ediel_id text,
    own_subaddress text,
    counterparty_ediel_id text,
    counterparty_subaddress text,
    mailbox_id uuid,
    transport_type text,
    ack_policy text,
    is_active boolean,
    route_name text,
    route_type text DEFAULT 'email'::text NOT NULL,
    sender_subaddress text,
    receiver_subaddress text,
    smtp_profile_id uuid,
    actor_setting_id uuid,
    direction text,
    counterparty_role text,
    counterparty_id uuid,
    receiver_email text,
    transport_profile_id uuid,
    route_version integer DEFAULT 1 NOT NULL,
    is_test_route boolean,
    is_production_route boolean,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    receiver_source text,
    dynamic_receiver_strategy text,
    receiver_message_subaddress text,
    subaddress_required boolean DEFAULT false NOT NULL,
    business_code text,
    transport_mode text DEFAULT 'smtp_imap'::text NOT NULL,
    smtp_from text,
    smtp_to text,
    signing_mode text DEFAULT 'none'::text NOT NULL,
    tls_required boolean DEFAULT true NOT NULL,
    certificate_id uuid,
    allow_unencrypted_test boolean DEFAULT true NOT NULL,
    allow_unencrypted_production boolean DEFAULT false NOT NULL,
    allow_unencrypted_production_expires_at timestamp with time zone,
    allow_unencrypted_production_granted_by uuid,
    allow_unencrypted_production_reason text,
    security_policy_status text DEFAULT 'not_checked'::text NOT NULL,
    max_payload_bytes integer DEFAULT 10485760 NOT NULL,
    split_strategy text DEFAULT 'none'::text NOT NULL,
    production_mode text DEFAULT 'disabled'::text NOT NULL,
    party_id uuid,
    party_address_id uuid,
    transport_security_mode text,
    receiver_certificate_id uuid,
    certificate_required boolean DEFAULT false NOT NULL,
    smtp_provider text,
    certificate_environment text,
    transport_environment text,
    target_system text,
    is_production_ready boolean DEFAULT false NOT NULL,
    CONSTRAINT ediel_route_profiles_ack_mode_check CHECK ((ack_mode = ANY (ARRAY['default'::text, 'none'::text, 'contrl_only'::text, 'contrl_and_aperak'::text]))),
    CONSTRAINT ediel_route_profiles_production_mode_check CHECK ((production_mode = ANY (ARRAY['disabled'::text, 'shadow'::text, 'dry_run'::text, 'live'::text, 'active'::text]))),
    CONSTRAINT ediel_route_profiles_receiver_source_check CHECK (((receiver_source IS NULL) OR (receiver_source = ANY (ARRAY['fixed_counterparty'::text, 'selected_metering_point_grid_owner'::text, 'selected_customer_site_grid_owner'::text, 'selected_supplier_switch_grid_owner'::text, 'selected_data_request_grid_owner'::text, 'original_inbound_sender'::text, 'original_inbound_receiver'::text, 'explicit_counterparty_role'::text, 'manual_superadmin_only'::text]))))
);

ALTER TABLE public.ediel_route_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY gridex_db1_ediel_route_profiles_insert ON public.ediel_route_profiles FOR INSERT WITH CHECK ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_write_company(company_id))));

CREATE POLICY gridex_db1_ediel_route_profiles_select ON public.ediel_route_profiles FOR SELECT USING ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_read_company(company_id))));

CREATE POLICY gridex_db1_ediel_route_profiles_update ON public.ediel_route_profiles FOR UPDATE USING ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_read_company(company_id)))) WITH CHECK ((( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR ((company_id IS NOT NULL) AND public.gridex_can_write_company(company_id))));

CREATE POLICY tenant_lifecycle_delete_guard ON public.ediel_route_profiles AS RESTRICTIVE FOR DELETE TO authenticated USING (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_insert_guard ON public.ediel_route_profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.gridex_can_write_company(company_id));

CREATE POLICY tenant_lifecycle_select_guard ON public.ediel_route_profiles AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT public.gridex_is_current_session_allowed() AS gridex_is_current_session_allowed) AND (( SELECT public.gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR (company_id IN ( SELECT public.gridex_user_company_ids() AS gridex_user_company_ids)))));

CREATE POLICY tenant_lifecycle_update_guard ON public.ediel_route_profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.gridex_can_write_company(company_id)) WITH CHECK (public.gridex_can_write_company(company_id));

GRANT ALL ON TABLE public.ediel_route_profiles TO authenticated;

GRANT ALL ON TABLE public.ediel_route_profiles TO service_role;`
const migration = readFileSync(resolve(root,
  'supabase/migrations/20261006213222_ediel_public_supplier_route_column_contract.sql'), 'utf8')
const tables = ['electricity_suppliers', 'communication_routes', 'ediel_route_profiles'] as const
const columns = [
  ['electricity_suppliers', 'customer_service_email', 'text', 'YES', null],
  ['electricity_suppliers', 'switching_email', 'text', 'YES', null],
  ['electricity_suppliers', 'contract_email', 'text', 'YES', null],
  ['electricity_suppliers', 'website', 'text', 'YES', null],
  ['communication_routes', 'route_group', 'text', 'YES', null],
  ['communication_routes', 'supported_message_families', 'jsonb', 'NO', "'[]'::jsonb"],
  ['communication_routes', 'supported_message_codes', 'jsonb', 'NO', "'[]'::jsonb"],
  ['ediel_route_profiles', 'environment_type', 'ediel_environment_type', 'YES', null],
] as const
const company = '11111111-1111-4111-8111-111111111111'
const ids = ['22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
let db: PGlite
let previousRows: unknown[]
let previousSecurity: unknown
let previousColumns: unknown

function captured(pattern: RegExp): string {
  const match = schema.match(pattern)?.[0]
  if (!match) throw new Error(`captured_schema_statement_missing:${pattern}`)
  return match
}

async function rowsWithoutNewColumns() {
  return Promise.all(tables.map(async table => {
    const removed = columns.filter(column => column[0] === table).map(column => column[1])
    return (await db.query(`SELECT to_jsonb(t) - $1::text[] AS row FROM public.${table} t ORDER BY id`, [removed])).rows
  }))
}

async function columnCatalog() {
  return (await db.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string; column_default: string | null }>(`SELECT table_name,column_name,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])
    ORDER BY table_name,ordinal_position`, [tables])).rows.filter(row =>
    !columns.some(column => column[0] === row.table_name && column[1] === row.column_name))
}

async function securityCatalog() {
  const names = [tables]
  const relations = (await db.query(`SELECT relname,relrowsecurity,relforcerowsecurity,relacl::text
    FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname`, names)).rows
  const policies = (await db.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles::text,
    pg_get_expr(p.polqual,p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,p.polname`, names)).rows
  const constraints = (await db.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`, names)).rows
  return { relations, policies, constraints }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.gridex_has_permission(uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.gridex_can_read_company(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.gridex_user_is_platform_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.gridex_is_current_session_allowed() RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.gridex_user_company_ids() RETURNS SETOF uuid LANGUAGE sql AS 'SELECT NULL::uuid WHERE false';
    GRANT USAGE ON SCHEMA auth TO authenticated;`)
  await db.exec(captured(/CREATE TYPE public\.ediel_environment_type AS ENUM \([\s\S]+?\n\);/))
  for (const table of tables) {
    await db.exec(captured(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]+?\\n\\);`)))
    const policies = schema.match(new RegExp(`^CREATE POLICY [^\\n]+ ON public\\.${table} [^\\n]+;$`, 'gm'))
    const grants = schema.match(new RegExp(`^GRANT [^\\n]+ ON TABLE public\\.${table} TO [^\\n]+;$`, 'gm'))
    if (!policies?.length || !grants?.length) throw new Error(`captured_security_missing:${table}`)
    await db.exec([captured(new RegExp(`^ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;$`, 'm')),
      ...policies, ...grants].join('\n'))
  }
  // Existing administrative rows contain no accepted Ediel/business authority.
  await db.query("INSERT INTO electricity_suppliers(id,company_id,name,notes,is_own_supplier) VALUES($1,$2,'Retained supplier','Retained note',false)", [ids[0], company])
  await db.query("INSERT INTO communication_routes(id,company_id,route_name,auth_config,metadata) VALUES($1,$2,'Retained route','{\"retained\":true}','{\"marker\":\"old\"}')", [ids[1], company])
  await db.query("INSERT INTO ediel_route_profiles(id,company_id,route_name,environment,production_mode,is_production_ready,metadata) VALUES($1,$2,'Retained profile','test','disabled',false,'{\"marker\":\"old\"}')", [ids[2], company])
  previousRows = await rowsWithoutNewColumns()
  previousSecurity = await securityCatalog()
  previousColumns = await columnCatalog()
  // Reproduce actual PostgreSQL absence, rather than checking migration text.
  for (const [table, column] of columns) {
    await expect(db.query(`SELECT ${column} FROM public.${table} LIMIT 0`)).rejects.toMatchObject({ code: '42703' })
  }
  await db.exec(migration)
}, 30_000)

afterAll(async () => { await db?.close() })

describe('public supplier and route column compatibility', () => {
  it.each(columns)('restores %s.%s with its historical definition', async (table, column, type, nullable, defaultValue) => {
    await expect(db.query(`SELECT ${column} FROM public.${table} LIMIT 0`)).resolves.toMatchObject({ rows: [] })
    expect((await db.query(`SELECT udt_name,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column])).rows)
      .toEqual([{ udt_name: type, is_nullable: nullable, column_default: defaultValue }])
  })

  it('retains prior rows, old columns, captured policies, ACLs and constraints across repeated application', async () => {
    expect(await rowsWithoutNewColumns()).toEqual(previousRows)
    expect(await columnCatalog()).toEqual(previousColumns)
    expect(await securityCatalog()).toEqual(previousSecurity)
    const firstRows = await Promise.all(tables.map(async table =>
      (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows))
    await db.exec(migration)
    expect(await Promise.all(tables.map(async table =>
      (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows))).toEqual(firstRows)
    expect(await columnCatalog()).toEqual(previousColumns)
    expect(await securityCatalog()).toEqual(previousSecurity)
  })

  it('accepts the four supplier contact values including nulls without changing supplier authority', async () => {
    await db.exec('BEGIN;')
    try {
      const result = await db.query(`UPDATE electricity_suppliers SET customer_service_email=$1,
        switching_email=$2,contract_email=$3,website=$4 WHERE id=$5
        RETURNING customer_service_email,switching_email,contract_email,website,is_own_supplier`,
      ['service@example.invalid', 'switch@example.invalid', null, 'https://example.invalid', ids[0]])
      expect(result.rows).toEqual([{ customer_service_email: 'service@example.invalid', switching_email: 'switch@example.invalid',
        contract_email: null, website: 'https://example.invalid', is_own_supplier: false }])
    } finally { await db.exec('ROLLBACK;') }
  })

  it('defaults route capability metadata to empty arrays and supports precise selected values', async () => {
    expect((await db.query(`SELECT route_group,supported_message_families,supported_message_codes
      FROM communication_routes WHERE id=$1`, [ids[1]])).rows)
      .toEqual([{ route_group: null, supported_message_families: [], supported_message_codes: [] }])
    await db.exec('BEGIN;')
    try {
      expect((await db.query(`UPDATE communication_routes SET route_group='grid_owner',
        supported_message_families='["PRODAT"]',supported_message_codes='["Z03"]' WHERE id=$1
        RETURNING route_group,supported_message_families,supported_message_codes`, [ids[1]])).rows)
        .toEqual([{ route_group: 'grid_owner', supported_message_families: ['PRODAT'], supported_message_codes: ['Z03'] }])
      await expect(db.query('UPDATE communication_routes SET supported_message_codes=NULL WHERE id=$1', [ids[1]]))
        .rejects.toMatchObject({ code: '23502' })
    } finally { await db.exec('ROLLBACK;') }
  })

  it('leaves existing profile environment unassigned and enforces the actual environment enum', async () => {
    expect((await db.query('SELECT environment_type,production_mode,is_production_ready FROM ediel_route_profiles WHERE id=$1', [ids[2]])).rows)
      .toEqual([{ environment_type: null, production_mode: 'disabled', is_production_ready: false }])
    await db.exec('BEGIN;')
    try {
      expect((await db.query("UPDATE ediel_route_profiles SET environment_type='agt_test' WHERE id=$1 RETURNING environment_type,production_mode,is_production_ready", [ids[2]])).rows)
        .toEqual([{ environment_type: 'agt_test', production_mode: 'disabled', is_production_ready: false }])
      await expect(db.query("UPDATE ediel_route_profiles SET environment_type='test' WHERE id=$1", [ids[2]]))
        .rejects.toMatchObject({ code: '22P02' })
    } finally { await db.exec('ROLLBACK;') }
  })

  it('keeps captured authenticated read and write denial under the finite deny ports', async () => {
    await db.exec('BEGIN; SET LOCAL ROLE authenticated;')
    try {
      for (const table of tables) expect((await db.query(`SELECT id FROM public.${table}`)).rows).toEqual([])
      await expect(db.query("INSERT INTO communication_routes(company_id,route_name) VALUES($1,'Denied route')", [company]))
        .rejects.toMatchObject({ code: '42501' })
    } finally { await db.exec('ROLLBACK;') }
    expect(await rowsWithoutNewColumns()).toEqual(previousRows)
  })
})
