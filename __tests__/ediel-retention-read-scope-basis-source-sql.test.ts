// sim: 20261029-3f1a8ab1/claude-track6/003
// F-RET-01 continuation. Actual SQL bodies run in isolated PGlite: the three
// affected public RPCs and their complete current authorization chain
// (permission_v1, record_permission_v1, record_read_actor_v1, actor_v1,
// invoice_file_actor_v1, finance_actor_v1, the five public/requested-change
// dependencies and ediel_retention_session_actor_v1) are taken from
// supabase/schema.sql and hash-pinned to the installed bodies, then the actual
// forward 20261030131200 is applied by the non-super installer exactly as in
// 20261019180500. Registry rows, the graph-lock port, auth.uid seam and the two
// basis builders (invoice_file_basis_v1/finance_basis_v1, not authorization) are
// SYNTHETIC ports. No SDK, GoTrue, Storage, backend or native evidence.
//
// Boundary mirrored from 20261003150100 + DB-05: the read scope admits a current
// explicit ediel.retention.read grant in an active/archived/pending_deletion/closed
// tenant; deleted_test_only/suspended/deleted tenants, missing grants, foreign
// tenants and missing class grants are refused.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const root = process.cwd()
const forward = readFileSync(join(root, 'supabase/migrations/20261030131200_ediel_retention_read_scope_basis_and_source.sql'), 'utf8')
const schema = readFileSync(join(root, 'supabase/schema.sql'), 'utf8')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function extract(name: string) {
  const tail = schema.slice(schema.indexOf('CREATE FUNCTION ' + name + '('))
  const m = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail)
  if (!m || !tail.startsWith('CREATE FUNCTION ' + name + '(')) throw Error('missing function ' + name)
  const start = m.index + m[0].length
  const end = tail.indexOf(m[1] + ';', start)
  return { name, definition: tail.slice(0, end + m[1].length + 1), body: tail.slice(start, end) }
}

// Installed (live stack 2026-10-30) prosrc hashes; schema.sql must still match them.
const pinned: Record<string, string> = {
  'gridex_ediel_retention.permission_v1': 'b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa',
  'gridex_ediel_retention.record_permission_v1': '90609c2ea24dbd62637fd83a5f654820dc2f235afae774019dc4cc61ac0dbcf3',
  'gridex_ediel_retention.record_read_actor_v1': '0e63edfb65c0fa9d81fd7f4c67c049244364867b3b017e8f8268835f8ad24bc4',
  'gridex_ediel_retention.actor_v1': '88a02a898d5d0b97e5da84cf71c763e81c2d7d409cf2229b45c0998db07ff785',
  'gridex_ediel_retention.invoice_file_actor_v1': 'd9ea2bfa9ecb070db90b93851763ea92991db48085fbdba9db71867b1b9de7b0',
  'gridex_ediel_retention.finance_actor_v1': '40026c9407b8a44457c6406289d598520d4ffd39f280e475ca991ac2cd6c3cea',
}
const targets = {
  source: { name: 'public.ediel_read_invoice_file_source_v1', sig: 'public.ediel_read_invoice_file_source_v1(uuid,uuid,text,uuid)', before: 'eb000f52fff8bfbcdcd044fadae79c160f0cea7e39bbb17d0176be2138039975', after: 'c2c766d1676b2c1e4152ee2148085def038c11c767a0946524dbc7cfa8d5348a' },
  invoiceBasis: { name: 'public.ediel_invoice_file_retention_basis_v1', sig: 'public.ediel_invoice_file_retention_basis_v1(uuid,uuid,text,uuid)', before: 'fdfa963e43abb682de06b46e0b1d42578a4de450aebbcf7643b4623d6275284e', after: 'f7d0571189f5fe797e76454b5b293b6d07eb3ae4b2ea3e655659b877d37efc5e' },
  financeBasis: { name: 'public.ediel_finance_copy_retention_basis_v1', sig: 'public.ediel_finance_copy_retention_basis_v1(uuid,uuid,text,text)', before: 'f18961afa6ffdb1bc42462ee33caa04e9f820e33d8f793b87172f6b940042b1f', after: '171f056055cacb7d37a1c29be711d0d81fb474dae4ffe1ddca07560a3703c495' },
} as const
const oldCase = "CASE WHEN gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.read') THEN 'ediel.retention.read' ELSE 'ediel.retention.review' END"
const newCase = "CASE WHEN gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'__read_scope__') THEN 'ediel.retention.read' ELSE 'ediel.retention.review' END"

const publicDeps = ['public.gridex_normalize_platform_role', 'public.gridex_get_user_permissions_in_company', 'public.gridex_actor_has_company_permission',
  'public.ediel_retention_lock_auth_actor_v1', 'gridex_requested_changes.scoped_permission_v1', 'public.ediel_retention_session_actor_v1'].map(extract)
const retentionDeps = Object.keys(pinned).map(extract)
const targetDefs = Object.values(targets).map((t) => extract(t.name))

const c = '10000000-0000-4000-8000-000000000001'
const foreign = '10000000-0000-4000-8000-000000000002'
const reader = '20000000-0000-4000-8000-000000000001'
const reviewer = '20000000-0000-4000-8000-000000000002'
const outsider = '20000000-0000-4000-8000-000000000003'
const foreigner = '20000000-0000-4000-8000-000000000004'
const target = '40000000-0000-4000-8000-000000000001'
const source = '50000000-0000-4000-8000-000000000001'
const invoiceClass = 'customer_invoice_document_pdf_bytes'
const financeClass = 'invoice_calculation_body'
const keys = ['ediel.retention.read', 'ediel.retention.review', 'ediel.retention.submit', 'ediel.retention.purge', 'ediel.retention.invoice_copy_evidence']
const procSQL = `SELECT p.oid::regprocedure::text sig,to_jsonb(p)-'prosrc' meta,p.prosrc FROM pg_proc p WHERE p.oid IN(${Object.values(targets).map((t) => `'${t.sig}'::regprocedure`).join(',')}) ORDER BY 1`
const othersSQL = `SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' meta FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'gridex_ediel_retention'::regnamespace,'gridex_requested_changes'::regnamespace) AND p.oid NOT IN(${Object.values(targets).map((t) => `'${t.sig}'::regprocedure`).join(',')}) ORDER BY p.oid`

async function one<T>(d: PGlite, query: string, params: unknown[] = []): Promise<T> {
  return (await d.query<T>(query, params)).rows[0]
}

async function fresh(apply = false): Promise<PGlite> {
  const d = new PGlite()
  // Bootstrap OID10 renamed to supabase_admin is the only privileged GIVEN setup principal.
  await d.exec(`CREATE ROLE fixture_setup_admin LOGIN SUPERUSER;SET SESSION AUTHORIZATION fixture_setup_admin;ALTER ROLE postgres RENAME TO supabase_admin;SET SESSION AUTHORIZATION supabase_admin;
 CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE BYPASSRLS;
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;
 ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO postgres;
 CREATE SCHEMA auth AUTHORIZATION supabase_admin;CREATE SCHEMA gridex_ediel_ack_replay AUTHORIZATION postgres;CREATE SCHEMA gridex_requested_changes AUTHORIZATION postgres;CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
 -- Declared auth seam (same shape as other forward tests).
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
 CREATE TABLE public.user_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
 CREATE TABLE public.roles(id uuid,key text,name text,is_active boolean);
 CREATE TABLE public.user_roles(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
 CREATE TABLE public.role_permissions(id uuid DEFAULT gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.admin_users(user_id uuid,role text,is_active boolean);
 -- Declared lock-only port: no authority/identity decision is replaced.
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;
 -- Private retention tables reduced to the columns the actual bodies read.
 CREATE TABLE gridex_ediel_retention.record_class_catalog(retention_class text PRIMARY KEY,permission_key text NOT NULL);
 CREATE TABLE gridex_ediel_retention.finance_class_catalog(retention_class text PRIMARY KEY,permission_key text NOT NULL);
 CREATE TABLE gridex_ediel_retention.invoice_file_sources(id uuid PRIMARY KEY,company_id uuid NOT NULL,retention_class text NOT NULL,target_id uuid NOT NULL,source_hash text NOT NULL,byte_length bigint NOT NULL,captured_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE gridex_ediel_retention.invoice_file_tombstones(source_id uuid PRIMARY KEY);
 -- Declared basis-builder ports (not authorization): return a marker only.
 CREATE FUNCTION gridex_ediel_retention.invoice_file_basis_v1(c uuid,k text,target uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('port','invoice_file_basis','retentionClass',k)$$;
 CREATE FUNCTION gridex_ediel_retention.finance_basis_v1(c uuid,k text,target text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('port','finance_basis','retentionClass',k)$$;`)
  for (const x of [...publicDeps, ...retentionDeps, ...targetDefs]) await d.exec(x.definition)
  await d.exec(`DO $$DECLARE r record;BEGIN
 FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',r.relname);END LOOP;
 FOR r IN SELECT p.oid::regprocedure target FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'gridex_requested_changes'::regnamespace,'gridex_ediel_ack_replay'::regnamespace) LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.target);END LOOP;
 FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='gridex_ediel_retention'::regnamespace AND c.relkind='r' LOOP EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',r.relname);END LOOP;
 FOR r IN SELECT p.oid::regprocedure target FROM pg_proc p WHERE p.pronamespace='gridex_ediel_retention'::regnamespace LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',r.target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.target);END LOOP;
 END$$;
 ${Object.values(targets).map((t) => `ALTER FUNCTION ${t.sig} OWNER TO gridex_ediel_retention_owner;REVOKE ALL ON FUNCTION ${t.sig} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${t.sig} TO authenticated;`).join('\n ')}
 GRANT USAGE ON SCHEMA auth TO postgres,gridex_ediel_retention_owner;GRANT SELECT,UPDATE ON auth.users TO postgres;GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
 GRANT USAGE ON SCHEMA public,gridex_requested_changes,gridex_ediel_ack_replay,gridex_ediel_retention TO gridex_ediel_retention_owner;
 GRANT USAGE ON SCHEMA gridex_ediel_retention TO postgres;
 GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO gridex_ediel_retention_owner;
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
 SET SESSION AUTHORIZATION postgres;GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;`)
  if (apply) await d.exec(forward)
  return d
}

async function admin(d: PGlite, statements: string) {
  await d.exec('SET SESSION AUTHORIZATION supabase_admin')
  try { await d.exec(statements) } finally { await d.exec('SET SESSION AUTHORIZATION postgres') }
}

async function seed(d: PGlite) {
  const grant = (user: string, company: string, granted: string[]) => granted.map((k) =>
    `INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) SELECT '${user}','${company}',id,key,true,'active','allow' FROM public.permissions WHERE key='${k}';`).join('')
  await admin(d, `TRUNCATE auth.users,public.user_profiles,public.companies,public.company_memberships,public.permissions,public.user_permissions,public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides,public.admin_users,gridex_ediel_retention.record_class_catalog,gridex_ediel_retention.finance_class_catalog,gridex_ediel_retention.invoice_file_tombstones,gridex_ediel_retention.invoice_file_sources;
 INSERT INTO auth.users SELECT u,NULL,NULL,clock_timestamp() FROM unnest(ARRAY['${reader}','${reviewer}','${outsider}','${foreigner}']::uuid[]) u;
 INSERT INTO public.user_profiles SELECT u,'active',NULL FROM unnest(ARRAY['${reader}','${reviewer}','${outsider}','${foreigner}']::uuid[]) u;
 INSERT INTO public.companies VALUES('${c}','archived',true),('${foreign}','active',true);
 INSERT INTO public.company_memberships SELECT '${c}',u,'active',true,clock_timestamp() FROM unnest(ARRAY['${reader}','${reviewer}','${outsider}']::uuid[]) u;
 INSERT INTO public.company_memberships VALUES('${foreign}','${foreigner}','active',true,clock_timestamp());
 INSERT INTO public.permissions SELECT gen_random_uuid(),k,k,true FROM unnest(ARRAY[${keys.map((k) => `'${k}'`).join(',')}]) k;
 ${grant(reader, c, ['ediel.retention.read', 'ediel.retention.invoice_copy_evidence'])}
 ${grant(reviewer, c, ['ediel.retention.review', 'ediel.retention.invoice_copy_evidence'])}
 ${grant(outsider, c, ['ediel.retention.invoice_copy_evidence'])}
 ${grant(foreigner, foreign, ['ediel.retention.read', 'ediel.retention.invoice_copy_evidence'])}
 INSERT INTO gridex_ediel_retention.finance_class_catalog VALUES('${financeClass}','ediel.retention.invoice_copy_evidence');
 INSERT INTO gridex_ediel_retention.invoice_file_sources(id,company_id,retention_class,target_id,source_hash,byte_length) VALUES('${source}','${c}','${invoiceClass}','${target}','${'a'.repeat(64)}',42);`)
}

type Fn = keyof typeof targets
const calls: Record<Fn, string> = {
  source: `SELECT public.ediel_read_invoice_file_source_v1($1,$2,'${invoiceClass}','${target}') v`,
  invoiceBasis: `SELECT public.ediel_invoice_file_retention_basis_v1($1,$2,'${invoiceClass}','${target}') v`,
  financeBasis: `SELECT public.ediel_finance_copy_retention_basis_v1($1,$2,'${financeClass}','${target}') v`,
}

// Calls the actual public RPC as the authenticated JWT actor (auth.uid()=who).
async function call(d: PGlite, fn: Fn, who: string, company = c): Promise<Record<string, unknown>> {
  await d.exec('SET SESSION AUTHORIZATION supabase_admin')
  try {
    await d.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [who])
    await d.exec('SET ROLE authenticated')
    return (await one<{ v: Record<string, unknown> }>(d, calls[fn], [company, who])).v
  } finally {
    await d.exec('RESET ROLE;SET SESSION AUTHORIZATION postgres')
  }
}
const fns = Object.keys(targets) as Fn[]
const expected: Record<Fn, Record<string, unknown>> = {
  source: { sourceId: source, retentionClass: invoiceClass, targetId: target, byteLength: 42, bytesAvailable: true, authority: 'none' },
  invoiceBasis: { port: 'invoice_file_basis', retentionClass: invoiceClass },
  financeBasis: { port: 'finance_basis', retentionClass: financeClass },
}

describe('F-RET-01 read scope for invoice-file source and invoice/finance basis (actual forward applied)', () => {
  let db: PGlite
  const setStatus = (status: string) => admin(db, `UPDATE public.companies SET status='${status}' WHERE id='${c}'`)
  beforeAll(async () => { db = await fresh(true) }, 120_000)
  beforeEach(async () => { await seed(db) }, 30_000)
  afterAll(async () => { await db?.close() })

  it.each(fns)('(a) archived read-only member reads %s through the read scope', async (fn) => {
    expect(await call(db, fn, reader)).toMatchObject(expected[fn])
  }, 30_000)

  it.each(['active', 'pending_deletion', 'closed'])('(a) read-only member reads all three in a %s tenant', async (status) => {
    await setStatus(status)
    for (const fn of fns) expect(await call(db, fn, reader)).toMatchObject(expected[fn])
  }, 30_000)

  it.each(fns)('(b) member without ediel.retention.read (and without review) is refused on %s', async (fn) => {
    await expect(call(db, fn, outsider)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)

  it.each(fns)('(b) read grant without the exact class grant is still refused on %s', async (fn) => {
    await admin(db, `DELETE FROM public.user_permissions WHERE user_id='${reader}' AND permission_key='ediel.retention.invoice_copy_evidence'`)
    await expect(call(db, fn, reader)).rejects.toThrow(/invoice_file_current_exact_class_required|finance_retention_current_exact_class_required/)
  }, 30_000)

  it.each(fns)('(b) explicit current DENY of ediel.retention.read refuses %s', async (fn) => {
    await admin(db, `INSERT INTO public.user_permission_overrides VALUES('${reader}','${c}','ediel.retention.read',true,'deny',clock_timestamp()-interval '1 minute',NULL)`)
    await expect(call(db, fn, reader)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)

  it.each(fns)('(c) foreign-tenant reader is refused on %s for the other tenant', async (fn) => {
    await expect(call(db, fn, foreigner, c)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)

  it.each(fns)('(c) caller cannot act for another actor id on %s', async (fn) => {
    // JWT actor is the outsider; the supplied p_actor_user_id is the reader.
    await db.exec('SET SESSION AUTHORIZATION supabase_admin')
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [outsider])
      await db.exec('SET ROLE authenticated')
      await expect(db.query(calls[fn], [c, reader])).rejects.toThrow(/retention_current_read_actor_required/)
    } finally { await db.exec('RESET ROLE;SET SESSION AUTHORIZATION postgres') }
  }, 30_000)

  it.each(fns)('(d) reviewer without read keeps the review path on %s', async (fn) => {
    expect(await call(db, fn, reviewer)).toMatchObject(expected[fn])
    // The review branch is still enforced by actor_v1: without review it is refused.
    await admin(db, `DELETE FROM public.user_permissions WHERE user_id='${reviewer}' AND permission_key='ediel.retention.review'`)
    await expect(call(db, fn, reviewer)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)

  it.each(['deleted_test_only', 'suspended', 'deleted'])('(e) %s tenant refuses the read-only member on all three', async (status) => {
    await setStatus(status)
    for (const fn of fns) await expect(call(db, fn, reader)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)

  it('(e) inactive membership refuses the read-only member', async () => {
    await admin(db, `UPDATE public.company_memberships SET is_active=false WHERE user_id='${reader}'`)
    for (const fn of fns) await expect(call(db, fn, reader)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
  }, 30_000)
})

describe('F-RET-01 read scope forward installation', () => {
  it('schema.sql dependency and predecessor bodies are the installed hash-pinned bodies', () => {
    for (const x of retentionDeps) expect(sha(x.body), x.name).toBe(pinned[x.name])
    for (const t of Object.values(targets)) expect(sha(extract(t.name).body), t.name).toBe(t.before)
  })

  it('predecessor (without the forward) refuses the archived read-only member on all three', async () => {
    const d = await fresh(false)
    try {
      await seed(d)
      for (const fn of fns) await expect(call(d, fn, reader)).rejects.toThrow(/ediel_retention_current_actor_forbidden/)
      // Active tenants were never affected.
      await admin(d, `UPDATE public.companies SET status='active' WHERE id='${c}'`)
      for (const fn of fns) expect(await call(d, fn, reader)).toMatchObject(expected[fn])
    } finally { await d.close() }
  }, 60_000)

  it('forward swaps only the CASE predicate and preserves OID/owner/ACL/security/search_path and all other bodies', async () => {
    const d = await fresh(false)
    try {
      const before = (await d.query<{ sig: string; meta: unknown; prosrc: string }>(procSQL)).rows
      const others = (await d.query(othersSQL)).rows
      await d.exec(forward)
      const after = (await d.query<{ sig: string; meta: unknown; prosrc: string }>(procSQL)).rows
      expect(after.map((r) => r.meta)).toEqual(before.map((r) => r.meta))
      for (const [i, row] of after.entries()) {
        const spec = Object.values(targets).find((t) => t.sig === row.sig || t.sig.endsWith(row.sig))!
        expect(sha(before[i].prosrc)).toBe(spec.before)
        expect(sha(row.prosrc)).toBe(spec.after)
        expect(row.prosrc.split(newCase)).toHaveLength(2)
        expect(row.prosrc).not.toContain("permission_v1(p_company_id,p_actor_user_id,'ediel.retention.read')")
        expect(row.prosrc.split(newCase).join(oldCase)).toBe(before[i].prosrc)
      }
      expect((await d.query(othersSQL)).rows).toEqual(others)
      expect((await one<{ v: boolean }>(d, "SELECT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') v")).v).toBe(false)
    } finally { await d.close() }
  }, 60_000)

  it('an unexpected predecessor body aborts the whole forward with nothing changed', async () => {
    const d = await fresh(false)
    try {
      // Drift only the last target; the first two must roll back too.
      await admin(d, `CREATE OR REPLACE FUNCTION public.ediel_finance_copy_retention_basis_v1(p_company_id uuid,p_actor_user_id uuid,p_retention_class text,p_target_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RETURN NULL;END$$`)
      const before = (await d.query(procSQL)).rows
      await expect(d.exec(forward)).rejects.toThrow(/fret01_read_scope_exact_predecessor_required/)
      await d.exec('ROLLBACK')
      expect((await d.query(procSQL)).rows).toEqual(before)
      expect((await one<{ v: boolean }>(d, "SELECT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') v")).v).toBe(false)
    } finally { await d.close() }
  }, 60_000)
})
