import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrationPath = 'supabase/migrations/20261004205603_staff_customer_retention_read_prerequisite.sql'
const migration = readFileSync(migrationPath, 'utf8')
const tables = ['record_class_catalog', 'record_decisions', 'record_reviews', 'record_tombstones']
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const address = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
let db: PGlite
let emptyDatabase: Awaited<ReturnType<PGlite['dumpDataDir']>>

function capturedFunction(name: string) {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
  const delimiter = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  if (start < 0 || !delimiter) throw new Error(`Missing captured function ${name}`)
  const end = schema.indexOf(`${delimiter[1]};`, start + delimiter.index + delimiter[0].length)
  return schema.slice(start, end + delimiter[1].length + 1)
}
function capturedTables() {
  return tables.map(table => {
    const start = schema.indexOf(`CREATE TABLE gridex_ediel_retention.${table} (`)
    const end = schema.indexOf('\n);', start)
    const constraints = [...schema.matchAll(new RegExp(`ALTER TABLE ONLY gridex_ediel_retention\\.${table}\\s+ADD CONSTRAINT [\\s\\S]*?;`, 'g'))].map(match => match[0]).join('\n')
    return `${schema.slice(start, end + 3)}\n${constraints}`
  }).join('\n')
}
const old = readFileSync('supabase/migrations/20261001012305_ediel_customer_record_class_retention.sql', 'utf8')
const classMetadata = old.slice(old.indexOf('INSERT INTO gridex_ediel_retention.record_class_catalog VALUES'), old.indexOf('-- This is an immutable native class-to-owner mapping'))

beforeAll(async () => {
  // Fresh PGlite initialization starts in template1 regardless of database.
  // Reopen its untouched snapshot to exercise real database ACLs in postgres.
  const bootstrap = new PGlite()
  emptyDatabase = await bootstrap.dumpDataDir()
  await bootstrap.close()
})
beforeEach(async () => {
  db = new PGlite({ database: 'postgres', loadDataDir: emptyDatabase })
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;
    CREATE ROLE hosted_migration LOGIN CREATEROLE BYPASSRLS;
    GRANT CREATE ON DATABASE postgres TO hosted_migration WITH GRANT OPTION;
    GRANT anon,authenticated,service_role TO hosted_migration WITH INHERIT FALSE,SET TRUE;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,is_anonymous boolean);
    CREATE TABLE public.companies(id uuid PRIMARY KEY,name text,status text); CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid,customer_type text,status text,full_name text);
    CREATE TABLE public.customer_contracts(id uuid PRIMARY KEY);
    CREATE SCHEMA gridex_received_sources;
    ${capturedFunction('gridex_received_sources.reject_mutation')}
    REVOKE ALL ON SCHEMA gridex_received_sources FROM PUBLIC,anon,authenticated,service_role;
    REVOKE ALL ON FUNCTION gridex_received_sources.reject_mutation() FROM PUBLIC,anon,authenticated,service_role;
    GRANT USAGE ON SCHEMA public,gridex_received_sources TO hosted_migration WITH GRANT OPTION;
    GRANT EXECUTE ON FUNCTION gridex_received_sources.reject_mutation() TO hosted_migration;
    GRANT CREATE ON SCHEMA public TO hosted_migration WITH GRANT OPTION;
    GRANT SELECT,UPDATE ON public.customers TO hosted_migration WITH GRANT OPTION;
    GRANT REFERENCES ON public.customers,public.companies,auth.users TO hosted_migration;
    GRANT USAGE ON SCHEMA auth TO hosted_migration;
    INSERT INTO auth.users(id) VALUES('${actor}'); INSERT INTO companies(id) VALUES('${company}');
    INSERT INTO customers(id,company_id) VALUES('${customer}','${company}'); SET ROLE hosted_migration;`)
})
afterEach(async () => { await db.close() })

async function apply() {
  try { await db.exec(migration) } catch (error) { await db.exec('ROLLBACK'); throw error }
}
async function seedJournal() {
  await db.exec(`RESET ROLE;
    INSERT INTO gridex_ediel_retention.record_decisions(id,company_id,retention_class,target_id,customer_id,source_hash,target_hash,document_bytes,document_hash,submitted_by)
      VALUES('${address}','${company}','customer_address_history','${address}','${customer}',repeat('a',64),repeat('b',64),'a'::bytea,encode(sha256('a'::bytea),'hex'),'${actor}');
    INSERT INTO gridex_ediel_retention.record_reviews(id,decision_id,actor_user_id,outcome,reason) VALUES('${address}','${address}','${actor}','approved','Synthetic native proof');
    INSERT INTO gridex_ediel_retention.record_tombstones(retention_class,target_id,company_id,customer_id,decision_id,review_id,source_hash,target_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference)
      VALUES('customer_address_history','${address}','${company}','${customer}','${address}','${address}',repeat('a',64),repeat('b',64),1,'${actor}','2030-01-01Z','Synthetic native proof');
    SET ROLE hosted_migration;`)
}
async function snapshot() {
  const catalog = await db.query(`SELECT n.nspname,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_ediel_retention' ORDER BY c.relname`)
  const rpc = await db.query("SELECT proowner,proacl,prosrc,proconfig FROM pg_proc WHERE oid=to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')")
  return JSON.stringify({ catalog: catalog.rows, rpc: rpc.rows })
}

describe('entire customer retention read prerequisite forward', () => {
  it('creates the exact private read dependencies under a nonsuper CREATEROLE/BYPASSRLS migration role', async () => {
    expect((await db.query('SELECT rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows).toEqual([{ rolsuper: false, rolcreaterole: true, rolbypassrls: true }])
    await apply()
    expect((await db.query("SELECT to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')::text AS rpc")).rows[0]).toEqual({ rpc: 'ediel_customer_record_tombstones_v1(uuid,uuid)' })
    await db.exec('SET ROLE service_role')
    expect((await db.query('SELECT public.ediel_customer_record_tombstones_v1($1,$2) AS result', [company, customer])).rows).toEqual([{ result: [] }])
  })
  it('allows an unchanged-source outer transaction rehearsal to roll back every new object and grant', async () => {
    const before = await snapshot()
    await db.exec(`BEGIN;\n${migration}\nROLLBACK;`)
    expect(await snapshot()).toBe(before)
    expect((await db.query("SELECT to_regrole('gridex_ediel_retention_owner')::text AS owner,to_regnamespace('gridex_ediel_retention')::text AS namespace,to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')::text AS rpc")).rows[0]).toEqual({ owner: null, namespace: null, rpc: null })
  })
  it('executes the entire mandatory native rollback guard against the actual qualified SQL', async () => {
    await apply()
    await db.exec('RESET ROLE')
    const native = readFileSync('scripts/staff-customer-retention-read-prerequisite-regression.sql', 'utf8')
      .replace(/^\\i :staff_retention_read_sql$/gm, () => migration)
      .replace(/^[ \t]*\\[^\n]*$/gm, '')
    expect(native.split(migration)).toHaveLength(3)
    await db.exec(native)
    expect((await db.query("SELECT count(*)::integer AS count FROM gridex_ediel_retention.record_tombstones")).rows[0]).toEqual({ count: 0 })
  })
  it('returns native tombstone arrays with exact company/customer binding and rejects foreign scope', async () => {
    await apply(); await seedJournal(); await db.exec('SET ROLE service_role')
    expect((await db.query('SELECT public.ediel_customer_record_tombstones_v1($1,$2) AS result', [company, customer])).rows[0]).toMatchObject({ result: [{ retentionClass: 'customer_address_history', targetId: address, sourceHash: 'a'.repeat(64), personalDataAvailable: false }] })
    await expect(db.query('SELECT public.ediel_customer_record_tombstones_v1($1,$2)', [actor, customer])).rejects.toThrow('customer_record_customer_scope_required')
  })
  it('keeps direct app-role table access and non-service RPC execution denied', async () => {
    await apply()
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query(`SELECT bool_or(has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_ediel_retention' AND c.relkind='r'`, [role])).rows[0]).toEqual({ allowed: false })
      await db.exec(`SET ROLE ${role}`)
      await expect(db.query('SELECT * FROM gridex_ediel_retention.record_tombstones')).rejects.toMatchObject({ code: '42501' })
      if (role !== 'service_role') await expect(db.query('SELECT public.ediel_customer_record_tombstones_v1($1,$2)', [company, customer])).rejects.toMatchObject({ code: '42501' })
      await db.exec('RESET ROLE; SET ROLE hosted_migration')
    }
  })
  it('retains every FK and check and rejects invalid native journal references', async () => {
    await apply(); await seedJournal(); await db.exec('RESET ROLE')
    await expect(db.exec(`INSERT INTO gridex_ediel_retention.record_tombstones SELECT retention_class,'${actor}',company_id,customer_id,contract_id,'${actor}',review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id,journal_retain_until,journal_purpose_reference,created_at FROM gridex_ediel_retention.record_tombstones`)).rejects.toMatchObject({ code: '23503' })
    await expect(db.exec(`INSERT INTO gridex_ediel_retention.record_decisions(id,company_id,retention_class,target_id,customer_id,source_hash,target_hash,document_hash,submitted_by) VALUES('${actor}','${company}','customer_address_history','${actor}','${customer}',repeat('a',64),repeat('b',64),repeat('c',64),'${actor}')`)).rejects.toMatchObject({ code: '23514' })
  })
  it('preserves native append-only UPDATE/DELETE/TRUNCATE guards on all four tables', async () => {
    await apply(); await seedJournal(); await db.exec('RESET ROLE')
    for (const table of tables) {
      await expect(db.exec(`UPDATE gridex_ediel_retention.${table} SET ${table === 'record_class_catalog' || table === 'record_tombstones' ? 'retention_class=retention_class' : 'id=id'}`)).rejects.toMatchObject({ code: '23514' })
      await expect(db.exec(`DELETE FROM gridex_ediel_retention.${table}`)).rejects.toMatchObject({ code: '23514' })
      await expect(db.exec(`TRUNCATE gridex_ediel_retention.${table} CASCADE`)).rejects.toMatchObject({ code: '23514' })
    }
  })
  it('is a true no-op on repeat application and preserves the public CREATE boundary', async () => {
    await apply()
    const before = await snapshot()
    await apply()
    expect(await snapshot()).toBe(before)
    expect((await db.query("SELECT has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS allowed, has_database_privilege('gridex_ediel_retention_owner',current_database(),'CREATE') AS database_create")).rows[0]).toEqual({ allowed: false, database_create: false })
  })
  it('verifies an existing captured canonical catalog without replacing its stronger custody guard or privileges', async () => {
    await db.exec(`CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;
      GRANT gridex_ediel_retention_owner TO hosted_migration WITH INHERIT FALSE,SET TRUE;
      CREATE SCHEMA gridex_ediel_retention;
      GRANT USAGE,CREATE ON SCHEMA gridex_ediel_retention TO gridex_ediel_retention_owner;
      ${capturedTables()} ${classMetadata}
      ${capturedFunction('gridex_ediel_retention.record_decisions_original_guard_v1')}
      ${capturedFunction('public.ediel_customer_record_tombstones_v1')}
      GRANT USAGE,CREATE ON SCHEMA public TO gridex_ediel_retention_owner;
      GRANT USAGE ON SCHEMA gridex_received_sources TO gridex_ediel_retention_owner;
      GRANT SELECT,UPDATE ON customers TO gridex_ediel_retention_owner;
      ALTER FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) OWNER TO gridex_ediel_retention_owner;
      ALTER FUNCTION gridex_ediel_retention.record_decisions_original_guard_v1() OWNER TO gridex_ediel_retention_owner;
      REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;
      REVOKE ALL ON SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role;
      SET ROLE gridex_ediel_retention_owner;
      REVOKE ALL ON FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) TO service_role;
      SET ROLE hosted_migration;`)
    for (const table of tables) await db.exec(`ALTER TABLE gridex_ediel_retention.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE gridex_ediel_retention.${table} FORCE ROW LEVEL SECURITY;
      CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.${table} FOR EACH ROW EXECUTE FUNCTION ${table === 'record_decisions' ? 'gridex_ediel_retention.record_decisions_original_guard_v1' : 'gridex_received_sources.reject_mutation'}();
      CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON gridex_ediel_retention.${table} FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
      ALTER TABLE gridex_ediel_retention.${table} OWNER TO gridex_ediel_retention_owner;`)
    await db.exec('GRANT CREATE ON DATABASE postgres TO gridex_ediel_retention_owner; ALTER SCHEMA gridex_ediel_retention OWNER TO gridex_ediel_retention_owner; REVOKE CREATE ON DATABASE postgres FROM gridex_ediel_retention_owner; GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner')
    const before = await snapshot()
    await apply()
    expect(await snapshot()).toBe(before)
    expect((await db.query("SELECT has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS allowed")).rows[0]).toEqual({ allowed: true })
  })
  it.each(['schema_only', 'role_only', 'wrong_role', 'missing_guard'])('fails closed on %s before creating or repairing any object', async variant => {
    await db.exec('RESET ROLE')
    if (variant === 'schema_only') await db.exec('CREATE SCHEMA gridex_ediel_retention')
    if (variant === 'role_only') await db.exec('CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS')
    if (variant === 'wrong_role') await db.exec('CREATE ROLE gridex_ediel_retention_owner LOGIN')
    if (variant === 'missing_guard') await db.exec('DROP FUNCTION gridex_received_sources.reject_mutation()')
    await db.exec('SET ROLE hosted_migration')
    await expect(apply()).rejects.toThrow(/staff_retention_read_/)
    expect((await db.query("SELECT to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')::text AS rpc")).rows[0]).toEqual({ rpc: null })
  })
  it.each(['column', 'constraint', 'owner', 'acl'])('rejects incompatible existing %s without repairing or weakening it', async variant => {
    await apply(); await db.exec('RESET ROLE')
    if (variant === 'column') await db.exec('ALTER TABLE gridex_ediel_retention.record_tombstones ALTER COLUMN source_hash TYPE varchar')
    if (variant === 'constraint') await db.exec('ALTER TABLE gridex_ediel_retention.record_tombstones DROP CONSTRAINT record_tombstones_review_id_fkey')
    if (variant === 'owner') await db.exec('ALTER TABLE gridex_ediel_retention.record_tombstones OWNER TO postgres')
    if (variant === 'acl') await db.exec('GRANT SELECT ON gridex_ediel_retention.record_tombstones TO authenticated')
    const before = await snapshot()
    await db.exec('SET ROLE hosted_migration')
    await expect(apply()).rejects.toThrow(/staff_retention_read_/)
    expect(await snapshot()).toBe(before)
  })
})
