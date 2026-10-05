import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isPlatformAdminContext } from '@/lib/admin/guards'
import {
  resolveOwnElectricitySupplier,
  setOwnElectricitySupplier,
} from '@/lib/masterdata/selfSupplier'

/**
 * Regression cover for the 2026-09-02 tenant isolation remediation.
 *
 * Each test names the finding it locks down. The database-level invariants
 * (unique key scoping, restrictive guards, role scope) are gated separately by
 * scripts/sql/tenant-isolation-invariants.sql. The finite SQL port below executes
 * that entire gate and the actual protected-birth predicate; it does not attest
 * native admission, custody, grants, concurrency or any particular CI row.
 */

type QueryCall = { table: string; filters: Record<string, unknown>; op: string }

function supabaseDouble(options: {
  rows?: Record<string, unknown[]>
  calls: QueryCall[]
}) {
  const rows = options.rows ?? {}

  function builder(table: string, op: string) {
    const call: QueryCall = { table, filters: {}, op }
    options.calls.push(call)

    const chain: Record<string, unknown> = {}
    const passthrough = [
      'select',
      'order',
      'limit',
      'ilike',
      'update',
      'insert',
      'or',
    ]

    for (const method of passthrough) {
      chain[method] = (...args: unknown[]) => {
        if (method === 'ilike') call.filters.ilike = args[0]
        if (method === 'or') call.filters.or = args[0]
        return chain
      }
    }

    chain.eq = (column: string, value: unknown) => {
      call.filters[column] = value
      return chain
    }

    chain.maybeSingle = async () => ({
      data: (rows[table] ?? [])[0] ?? null,
      error: null,
    })

    chain.single = async () => ({
      data: (rows[table] ?? [])[0] ?? null,
      error: null,
    })

    chain.then = undefined

    return chain
  }

  return {
    from: (table: string) => builder(table, 'query'),
    auth: {
      getUser: async () => ({ data: { user: { id: 'actor-1' } } }),
    },
  } as never
}

describe('F-9: the own electricity supplier is per tenant', () => {
  it('refuses to resolve an own supplier without a company', async () => {
    const calls: QueryCall[] = []
    await expect(
      resolveOwnElectricitySupplier(supabaseDouble({ calls }), null),
    ).rejects.toThrow(/Bolag krävs/)
    expect(calls).toHaveLength(0)
  })

  it('scopes the explicit lookup to the company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [{ id: 'supplier-a', name: 'Tenant A El', company_id: 'company-a' }],
      },
    })

    const result = await resolveOwnElectricitySupplier(client, 'company-a')

    expect(result.resolution).toBe('explicit_flag')
    expect(calls[0].table).toBe('electricity_suppliers')
    expect(calls[0].filters.company_id).toBe('company-a')
    expect(calls[0].filters.is_own_supplier).toBe(true)
  })

  it('never falls back to a hardcoded supplier name', async () => {
    const calls: QueryCall[] = []
    // No supplier rows and no company name: the old implementation matched
    // "Gridex" here and attributed every tenant's switches to one company.
    const client = supabaseDouble({ calls, rows: { companies: [{ name: null }] } })

    const result = await resolveOwnElectricitySupplier(client, 'company-b')

    expect(result.supplier).toBeNull()
    expect(result.resolution).toBe('not_found')
    for (const call of calls) {
      expect(JSON.stringify(call.filters)).not.toMatch(/gridex/i)
    }
  })

  it('clears the previous own supplier only inside the acting company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [
          { id: 'supplier-a', name: 'Tenant A El', company_id: 'company-a' },
        ],
      },
    })

    await setOwnElectricitySupplier(client, 'company-a', 'supplier-a')

    const clearing = calls.filter((call) => call.filters.is_own_supplier === true)
    expect(clearing.length).toBeGreaterThan(0)
    for (const call of clearing) {
      // The defect: this update ran unscoped and unmarked every other tenant's
      // supplier.
      expect(call.filters.company_id).toBe('company-a')
    }
  })

  it('refuses to claim a supplier owned by another company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [
          { id: 'supplier-x', name: 'Other tenant El', company_id: 'company-b' },
        ],
      },
    })

    await expect(
      setOwnElectricitySupplier(client, 'company-a', 'supplier-x'),
    ).rejects.toThrow(/tillhör ett annat bolag/)
  })
})

describe('F-7: platform admin is decided by the database', () => {
  it('trusts the authoritative flag over the role names', () => {
    // A role literally named super_admin, but the database says it is scoped to a
    // company and therefore not a platform admin.
    expect(
      isPlatformAdminContext({
        roles: ['super_admin'],
        permissions: [],
        isPlatformAdmin: false,
      }),
    ).toBe(false)

    expect(
      isPlatformAdminContext({
        roles: ['viewer'],
        permissions: [],
        isPlatformAdmin: true,
      }),
    ).toBe(true)
  })

  it('falls back to role names only when no flag is supplied', () => {
    expect(isPlatformAdminContext({ roles: ['super_admin'], permissions: [] })).toBe(true)
    expect(isPlatformAdminContext({ roles: ['viewer'], permissions: [] })).toBe(false)
  })
})

describe('F-1: the guard carries the company its permissions were resolved for', () => {
  it('exposes companyId on the guard result type', async () => {
    // A compile-time contract as much as a runtime one: permissions are only
    // meaningful together with the company they were resolved for.
    const guard = {
      userId: 'user-1',
      email: null,
      permissions: ['billing.write'],
      roles: ['finance_readonly'],
      isAdmin: true,
      isPlatformAdmin: false,
      companyId: 'company-a',
    }

    expect(guard.companyId).toBe('company-a')
    expect(isPlatformAdminContext(guard)).toBe(false)
  })
})

describe('F-3: only protected technical originals and their own diagnostics may be unattributed', () => {
  let db: PGlite
  const gate = readFileSync('scripts/sql/tenant-isolation-invariants.sql', 'utf8')
    .replace(/^\\set ON_ERROR_STOP on\r?\n/m, '')
  const sourceId = '00000000-0000-4000-8000-000000000001'
  const mailId = '00000000-0000-4000-8000-000000000002'
  const foreignId = '00000000-0000-4000-8000-000000000003'
  const businessFields = [
    'customer_id', 'site_id', 'metering_point_id', 'grid_owner_id', 'party_id',
    'party_address_id', 'resolved_grid_owner_id', 'resolved_counterparty_id',
    'operation_id', 'intent_id', 'source_operation_id', 'outbound_request_id',
    'switch_request_id', 'grid_owner_data_request_id', 'grid_owner_information_request_id',
    'partner_export_id', 'related_message_id', 'communication_route_id', 'canonical_rule_pack_id',
  ]
  const intakeMigration = 'supabase/migrations/20261005043923_ediel_unattributed_technical_intake.sql'

  // Install complete production definitions, never a test verdict or substitute
  // authority. Only the surrounding table/custody state is a declared finite port.
  function definition(file: string, name: string) {
    const sql = readFileSync(file, 'utf8')
    const escaped = name.replaceAll('.', '\\.')
    const match = sql.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\([\\s\\S]*?\\$\\$;`, 'i'))
    if (!match) throw new Error(`Missing SQL definition: ${name}`)
    return match[0]
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA gridex_utilts_binding;
      CREATE SCHEMA gridex_ediel_technical_ack;
      CREATE SCHEMA gridex_unattributed_intake;
      REVOKE ALL ON SCHEMA gridex_unattributed_intake FROM PUBLIC, anon, authenticated, service_role;
      CREATE TABLE public.platform_table_classification (
        table_name text PRIMARY KEY, kind text NOT NULL,
        null_company_meaning text,
        CHECK (kind IN ('tenant','platform_shared','mixed','system')),
        CHECK (kind <> 'mixed' OR length(btrim(null_company_meaning)) > 0)
      );
      CREATE TABLE public.ediel_messages (
        id uuid PRIMARY KEY, company_id uuid, resolved_company_id uuid,
        direction text, message_standard text, message_family text, message_code text,
        environment text, message_received_at timestamptz, inbound_email_message_id uuid,
        mailbox_message_id text, raw_payload text, execution_context_snapshot jsonb DEFAULT '{}',
        ${businessFields.map(field => `${field} uuid`).join(',')}
      );
      CREATE TABLE gridex_unattributed_intake.technical_births (
        source_message_id uuid PRIMARY KEY, inbound_email_message_id uuid NOT NULL UNIQUE,
        parse_result_id uuid NOT NULL UNIQUE, payload_hash text NOT NULL,
        environment text NOT NULL, received_at timestamptz NOT NULL, physical_envelope jsonb NOT NULL,
        message_family text NOT NULL, message_code text NOT NULL, actor_user_id uuid NOT NULL,
        birth_transaction bigint NOT NULL
      );
      CREATE TABLE public.ediel_message_events (id uuid PRIMARY KEY, company_id uuid, ediel_message_id uuid, message_id uuid);
      CREATE TABLE public.ediel_unresolved_items (
        id uuid PRIMARY KEY, company_id uuid, source_message_id uuid, environment text,
        ediel_message_id uuid, inbound_email_message_id uuid
      );
      CREATE TABLE public.ordinary_tenant_rows (id uuid PRIMARY KEY, company_id uuid);
      CREATE TABLE public.roles (id uuid PRIMARY KEY, key text, name text);
      CREATE TABLE public.user_roles (id uuid PRIMARY KEY, role_id uuid, company_id uuid);
      INSERT INTO public.platform_table_classification(table_name,kind)
      SELECT c.relname, CASE WHEN c.relname IN ('platform_table_classification','roles') THEN 'system' ELSE 'tenant' END
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r';
      DO $$ DECLARE t record; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r' LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
        END LOOP;
      END $$;
    `)
    await db.exec(definition('supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', 'gridex_utilts_binding.wire_tokens_v1'))
    await db.exec(definition('supabase/migrations/20260930221910_ediel_complete_technical_header_observation.sql', 'gridex_ediel_technical_ack.envelope'))
    await db.exec(definition(intakeMigration, 'gridex_unattributed_intake.sha_v1'))
    await db.exec(definition(intakeMigration, 'gridex_unattributed_intake.is_birth_v1'))
    await db.exec(definition('supabase/migrations/20260727010000_contract_flow_integrity_completion.sql', 'public.gridex_normalize_platform_role'))
  }, 20_000)

  beforeEach(async () => {
    await db.exec('BEGIN')
    await db.query(`INSERT INTO public.ediel_messages(id,direction,message_standard,message_family,message_code,
      environment,message_received_at,inbound_email_message_id,mailbox_message_id,raw_payload)
      VALUES($1,'inbound','edifact','PRODAT','Z04','production','2026-10-05T00:00:00Z',$2::uuid,$2::uuid::text,$3)`,
    [sourceId, mailId, "UNB+UNOC:3+12345:14+54321:14+261005:0000+F3PORT'UNH+1+PRODAT:D:96B:UN'BGM+Z04'"])
    await db.query(`INSERT INTO gridex_unattributed_intake.technical_births
      SELECT id,inbound_email_message_id,$1,gridex_unattributed_intake.sha_v1(raw_payload),environment,
        message_received_at,gridex_ediel_technical_ack.envelope(raw_payload),message_family,message_code,$1,txid_current()
      FROM public.ediel_messages WHERE id=$2`, [foreignId, sourceId])
  })
  afterEach(async () => { await db.exec('ROLLBACK') })
  afterAll(async () => { await db?.close() })

  it('accepts a source recognized by the actual birth predicate without rewriting it', async () => {
    const before = await db.query('SELECT to_jsonb(m) AS original FROM public.ediel_messages m')
    expect((await db.query<{ birth: boolean }>('SELECT gridex_unattributed_intake.is_birth_v1(m,false) AS birth FROM public.ediel_messages m')).rows)
      .toEqual([{ birth: true }])
    await expect(db.exec(gate)).resolves.toBeDefined()
    expect(await db.query('SELECT to_jsonb(m) AS original FROM public.ediel_messages m')).toEqual(before)
  })

  it('accepts diagnostics using their actual own parent keys and the same unresolved environment', async () => {
    await db.query('INSERT INTO public.ediel_message_events(id,ediel_message_id) VALUES($1,$2)', [foreignId, sourceId])
    await db.query("INSERT INTO public.ediel_unresolved_items(id,source_message_id,environment) VALUES($1,$2,'production')", [foreignId, sourceId])
    await expect(db.exec(gate)).resolves.toBeDefined()
  })

  it.each([
    ['missing private birth', 'DELETE FROM gridex_unattributed_intake.technical_births'],
    ['changed hash', "UPDATE gridex_unattributed_intake.technical_births SET payload_hash=repeat('0',64)"],
    ['changed physical header', "UPDATE gridex_unattributed_intake.technical_births SET physical_envelope='{}'"],
    ['foreign original', `UPDATE gridex_unattributed_intake.technical_births SET source_message_id='${foreignId}'`],
    ['foreign mail', `UPDATE gridex_unattributed_intake.technical_births SET inbound_email_message_id='${foreignId}'`],
    ['changed environment', "UPDATE gridex_unattributed_intake.technical_births SET environment='test'"],
    ['changed receive time', "UPDATE gridex_unattributed_intake.technical_births SET received_at=received_at+interval '1 second'"],
    ['changed family', "UPDATE public.ediel_messages SET message_family='APERAK'"],
    ['changed code', "UPDATE public.ediel_messages SET message_code='Z03'"],
    ['outbound direction', "UPDATE public.ediel_messages SET direction='outbound'"],
    ['legacy noncanonical source', "UPDATE public.ediel_messages SET message_standard='ai_list',message_family='AI_LIST'"],
    ['borrowed legal attribution', `UPDATE public.ediel_messages SET resolved_company_id='${foreignId}'`],
    ['foreign mailbox', `UPDATE public.ediel_messages SET mailbox_message_id='${foreignId}'`],
    ['business context', "UPDATE public.ediel_messages SET execution_context_snapshot='{\"companyId\":\"borrowed\"}'"],
    ['NULL context', 'UPDATE public.ediel_messages SET execution_context_snapshot=NULL'],
    ['unqualified raw NULL tombstone', 'UPDATE public.ediel_messages SET raw_payload=NULL'],
    ['missing authority function', 'DROP FUNCTION gridex_unattributed_intake.is_birth_v1(public.ediel_messages,boolean)'],
  ])('rejects %s', async (_label, mutation) => {
    await db.exec(mutation)
    await expect(db.exec(gate)).rejects.toThrow(/F-3: tenant table ediel_messages holds 1 row/)
  })

  it.each(businessFields)('rejects a source carrying %s', async field => {
    await db.query(`UPDATE public.ediel_messages SET ${field}=$1`, [foreignId])
    await expect(db.exec(gate)).rejects.toThrow(/F-3: tenant table ediel_messages holds 1 row/)
  })

  it.each(['ediel_message_events', 'ediel_unresolved_items'])('does not borrow alternate keys for %s', async table => {
    if (table === 'ediel_message_events') {
      await db.query('INSERT INTO public.ediel_message_events(id,message_id) VALUES($1,$2)', [foreignId, sourceId])
    } else {
      await db.query("INSERT INTO public.ediel_unresolved_items(id,ediel_message_id,inbound_email_message_id,environment) VALUES($1,$2,$3,'production')", [foreignId, sourceId, mailId])
    }
    await expect(db.exec(gate)).rejects.toThrow(new RegExp(`F-3: tenant table ${table} holds 1 row`))
  })

  it.each(['ediel_message_events', 'ediel_unresolved_items'])('rejects a missing actual parent for %s', async table => {
    const parentKey = table === 'ediel_message_events' ? 'ediel_message_id' : 'source_message_id'
    await db.query(`INSERT INTO public.${table}(id,${parentKey}) VALUES($1,$2)`, [foreignId, foreignId])
    await expect(db.exec(gate)).rejects.toThrow(new RegExp(`F-3: tenant table ${table} holds 1 row`))
  })

  it.each(['ediel_message_events', 'ediel_unresolved_items'])('rejects an unattributed child of a tenant-owned parent for %s', async table => {
    await db.query('UPDATE public.ediel_messages SET company_id=$1', [foreignId])
    const parentKey = table === 'ediel_message_events' ? 'ediel_message_id' : 'source_message_id'
    await db.query(`INSERT INTO public.${table}(id,${parentKey}) VALUES($1,$2)`, [foreignId, sourceId])
    await expect(db.exec(gate)).rejects.toThrow(new RegExp(`F-3: tenant table ${table} holds 1 row`))
  })

  it.each(['test', null])('rejects unresolved environment %s', async environment => {
    await db.query('INSERT INTO public.ediel_unresolved_items(id,source_message_id,environment) VALUES($1,$2,$3)', [foreignId, sourceId, environment])
    await expect(db.exec(gate)).rejects.toThrow(/F-3: tenant table ediel_unresolved_items holds 1 row/)
  })

  it('retains the NULL rejection for ordinary tenant tables', async () => {
    await db.query('INSERT INTO public.ordinary_tenant_rows(id) VALUES($1)', [foreignId])
    await expect(db.exec(gate)).rejects.toThrow(/F-3: tenant table ordinary_tenant_rows holds 1 row/)
  })

  it('keeps the RLS enabled gate active', async () => {
    await db.exec('ALTER TABLE public.ediel_messages DISABLE ROW LEVEL SECURITY')
    await expect(db.exec(gate)).rejects.toThrow(/F-6: table ediel_messages has row level security disabled/)
  })

  it('keeps restrictive company guards mandatory when a client can reach the table', async () => {
    await db.exec('GRANT SELECT ON public.ediel_messages TO authenticated')
    await expect(db.exec(gate)).rejects.toThrow(/F-6: ediel_messages is reachable by a client role but has no restrictive company guard/)
  })

  it('keeps inconsistent platform role scope rejected', async () => {
    await db.query("INSERT INTO public.roles(id,key) VALUES($1,'super_admin')", [foreignId])
    await db.query('INSERT INTO public.user_roles(id,role_id,company_id) VALUES($1,$1,$1)', [foreignId])
    await expect(db.exec(gate)).rejects.toThrow(/F-7: 1 user_role row/)
  })
})
