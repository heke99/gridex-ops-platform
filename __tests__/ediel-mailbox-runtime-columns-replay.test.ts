// Source-only reconstruction: actual page/save/poll-finish with finite SDK and isolated SQL.
// No IMAP/SMTP/provider, shared database, readiness approval or scenario acceptance.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const port = vi.hoisted(() => ({ db: null as unknown as PGlite, audits: 0 }))
const actor = '14200000-0000-4000-8000-000000000001'
const mailbox = '14200000-0000-4000-8000-000000000002'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: async () => ({ userId: '14200000-0000-4000-8000-000000000001', email: 'synthetic@example.invalid' }),
  requirePlatformAdminActionAccess: async () => ({ userId: '14200000-0000-4000-8000-000000000001' }),
}))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller', () => ({ processQueuedInboundProcessingJobs: vi.fn(), runInboundEdielMailEngine: vi.fn(), syncActiveInboundProcessingJobForMessage: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  let columns = '*', operation = 'select', payload: Record<string, unknown> = {}, rowLimit: number | undefined
  const filters: Array<[string, unknown]> = []
  const ident = (value: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error('invalid fixture identifier'); return '"' + value + '"' }
  const execute = async (single = false) => {
    if (table !== 'ediel_mailboxes') {
      if (table === 'audit_logs' && operation === 'insert') port.audits++
      return { data: single ? null : [], error: null, count: 0 }
    }
    const args: unknown[] = []
    let statement = ''
    if (operation !== 'select') {
      args.push(JSON.stringify(payload)); const keys = Object.keys(payload).map(ident).join(',')
      statement = operation === 'insert'
        ? `insert into public.ediel_mailboxes (${keys}) select ${keys} from jsonb_populate_record(null::public.ediel_mailboxes,$1::jsonb)`
        : `update public.ediel_mailboxes set (${keys})=(select ${keys} from jsonb_populate_record(null::public.ediel_mailboxes,$1::jsonb))`
    } else statement = `select ${columns} from public.ediel_mailboxes`
    if (filters.length) statement += ' where ' + filters.map(([key, value]) => {
      if (value === null) return ident(key) + ' is null'
      args.push(value); return ident(key) + '=$' + args.length
    }).join(' and ')
    if (operation !== 'select') statement += ' returning ' + columns
    else if (rowLimit !== undefined) statement += ' limit ' + rowLimit
    try {
      const result = await port.db.query(statement, args)
      // PostgREST returns JSON timestamp strings, unlike PGlite's native Date values.
      const rows = JSON.parse(JSON.stringify(result.rows)) as Record<string, unknown>[]
      if (single && rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
      return { data: single ? rows[0] ?? null : rows, error: null }
    } catch (error) { return { data: null, error } }
  }
  const query = {
    select: (value = '*') => { columns = value; return query },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    is: (key: string, value: null) => { filters.push([key, value]); return query },
    order: () => query, or: () => query,
    limit: (value: number) => { rowLimit = value; return query },
    insert: (value: Record<string, unknown>) => { operation = 'insert'; payload = value; return query },
    update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return query },
    maybeSingle: () => execute(true), single: () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
  }
  return query
} } }))
import InboundMailPage from '@/app/admin/inbound-mail/page'
import { saveSharedMailboxProfileAction } from '@/app/admin/inbound-mail/actions'
import { markMailboxPollFinished } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
const migration = 'supabase/migrations/20261107034000_ediel_mailbox_runtime_columns_reconstruction.sql'
// Immutable authentic predecessor, not the moving generated schema after repair.
// Copied byte-exact from this Git version/blob; inline avoids shallow-CI history
// dependencies and adds no foreign fixture path. No DDL is inferred or invented.
const predecessor = {
  version: 'f23c1dc0c58f8bb1a55b83d8409e5712177b51b6:supabase/schema.sql',
  blob: '4bfce63c56c3292ea13f1546ac4018c770084c1a',
  schemaSHA256: 'a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc',
  ddlSHA256: '2265088913fa44cb7e4d0189e9c89efc085e107821ad6ba972a768600eb2c4d3',
  ddl: String.raw`CREATE TABLE public.ediel_mailboxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    environment text DEFAULT 'test'::text NOT NULL,
    mailbox_name text NOT NULL,
    email_address text,
    imap_host text,
    imap_port integer DEFAULT 993 NOT NULL,
    username text,
    secret_reference text,
    is_active boolean DEFAULT true NOT NULL,
    poll_interval_minutes integer DEFAULT 5 NOT NULL,
    last_polled_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mailbox_type text DEFAULT 'shared'::text NOT NULL,
    transport_mode text DEFAULT 'smtp_imap'::text NOT NULL,
    tls_required boolean DEFAULT true NOT NULL,
    smtp_from text,
    smtp_to text,
    signing_mode text DEFAULT 'none'::text NOT NULL,
    encryption_mode text DEFAULT 'none'::text NOT NULL,
    certificate_id uuid,
    security_status text DEFAULT 'not_checked'::text NOT NULL,
    clock_skew_ms integer,
    last_time_sync_check_at timestamp with time zone,
    provider text,
    is_shared_platform_mailbox boolean DEFAULT false NOT NULL,
    CONSTRAINT ediel_mailboxes_secret_reference_check CHECK (((secret_reference IS NULL) OR (secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@'::text)))
);`,
}
const ddl = predecessor.ddl
if (createHash('sha256').update(ddl).digest('hex') !== predecessor.ddlSHA256) {
  throw new Error('mailbox_predecessor_ddl_hash_mismatch')
}
const repair = async () => { if (existsSync(migration)) await port.db.exec(readFileSync(migration, 'utf8')) }
const values = async () => (await port.db.query<{value: Record<string, unknown>}>('select to_jsonb(m) value from public.ediel_mailboxes m order by id')).rows
const columns = async () => (await port.db.query<{name:string}>("select attname name from pg_attribute where attrelid='public.ediel_mailboxes'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(row=>row.name)
beforeAll(async () => { port.db = new PGlite() }, 30000)
afterAll(async () => { await port.db?.close() })
beforeEach(async () => {
  await port.db.exec('drop table if exists public.ediel_mailboxes cascade; drop view if exists public.ediel_mailboxes;')
  await port.db.exec(ddl)
  await port.db.query(`insert into public.ediel_mailboxes(id,mailbox_name,email_address,username,secret_reference,metadata,locked_by,locked_at) values ($1,'Synthetic shared','synthetic@example.invalid','synthetic@example.invalid','env:SYNTHETIC_IMAP_PASS','{"scope":"platform_shared","imap_secure":true,"smtp_secure":true}','owned-lease',now())`, [mailbox])
  port.audits = 0
})
it('characterizes the actual canonical missing-column failure before any reconstruction', async () => {
  await expect(port.db.query('select smtp_host,smtp_port from public.ediel_mailboxes')).rejects.toMatchObject({code:'42703'})
})
it('actual platform page renders its full canonical mailbox projection after repair', async () => {
  await repair(); const html = renderToStaticMarkup(await InboundMailPage())
  expect(html).toContain('Synthetic shared'); expect(html).toContain('synthetic@example.invalid')
})
function form(id?: string) {
  const input = new FormData()
  for (const [key,value] of Object.entries({mailbox_name:'Configured synthetic',email_address:'synthetic@example.invalid',environment:'test',imap_host:'imap.example.invalid',imap_port:'993',imap_secure:'true',username:'synthetic@example.invalid',secret_reference:'env:SYNTHETIC_IMAP_PASS',smtp_host:'smtp.example.invalid',smtp_port:'465',smtp_secure:'true',smtp_from:'synthetic@example.invalid',smtp_to:'recipient@example.invalid',smtp_username:'synthetic@example.invalid',smtp_secret_reference:'env:SYNTHETIC_SMTP_PASS'})) input.set(key,value)
  if (id) input.set('mailbox_id',id)
  return input
}
it.each(['insert','update'])('actual platform save %s persists SMTP, actor and IMAP security without a transport call', async mode => {
  await repair(); await saveSharedMailboxProfileAction(form(mode==='update'?mailbox:undefined))
  const row = (await port.db.query<Record<string,unknown>>("select * from public.ediel_mailboxes where mailbox_name='Configured synthetic'")).rows[0]
  expect(row).toMatchObject({smtp_host:'smtp.example.invalid',smtp_port:465,smtp_from:'synthetic@example.invalid',smtp_to:'recipient@example.invalid',updated_by:actor,company_id:null,imap_host:'imap.example.invalid',secret_reference:'env:SYNTHETIC_IMAP_PASS'})
  expect(row.metadata).toMatchObject({scope:'platform_shared',imap_secure:true,smtp_secure:true,smtp_secret_reference:'env:SYNTHETIC_SMTP_PASS'})
  if(mode==='insert') expect(row.created_by).toBe(actor)
  expect(port.audits).toBe(1)
})
it('actual poll completion preserves its lease CAS and writes a real success timestamp', async () => {
  await repair()
  const claim = (await port.db.query<{id:string;locked_by:string;locked_at:string}>('select id,locked_by,locked_at::text from public.ediel_mailboxes')).rows[0]
  expect(await markMailboxPollFinished({claim,ok:true})).toBe(true)
  const row = (await port.db.query<{last_successful_poll_at:string;locked_by:null;locked_at:null}>('select last_successful_poll_at,locked_by,locked_at from public.ediel_mailboxes')).rows[0]
  expect(row.last_successful_poll_at).toBeTruthy();expect(row.locked_by).toBeNull();expect(row.locked_at).toBeNull()
})
it('reconstruction is idempotent, adds no business success and preserves table security/catalogue', async () => {
  await port.db.exec("alter table public.ediel_mailboxes enable row level security;create policy retained_service on public.ediel_mailboxes using(false);create index retained_mailbox_name on public.ediel_mailboxes(mailbox_name);")
  const before=await values();await repair();const once=await values();await repair();expect(await values()).toEqual(once)
  const row=once[0].value as Record<string,unknown>;const original=before[0].value as Record<string,unknown>
  for(const key of Object.keys(original)) expect(row[key]).toEqual(original[key])
  for(const key of ['smtp_host','smtp_port','last_successful_poll_at','created_by','updated_by'])expect(row[key]).toBeNull()
  expect((await port.db.query("select relrowsecurity from pg_class where oid='public.ediel_mailboxes'::regclass")).rows[0]).toEqual({relrowsecurity:true})
  expect((await port.db.query("select count(*)::int n from pg_policy where polrelid='public.ediel_mailboxes'::regclass and polname='retained_service'")).rows[0]).toEqual({n:1})
  expect((await port.db.query("select to_regclass('public.retained_mailbox_name') is not null ok")).rows[0]).toEqual({ok:true})
})
it.each(['none','587'])('preserves known source-defined SMTP default %s and saved values', async mode => {
  await port.db.exec('alter table public.ediel_mailboxes add column smtp_host text, add column smtp_port integer'+(mode==='587'?' default 587':''))
  await port.db.query("update public.ediel_mailboxes set smtp_host='retained.example.invalid',smtp_port=465 where id=$1",[mailbox]);await repair()
  expect((await port.db.query('select smtp_host,smtp_port from public.ediel_mailboxes')).rows[0]).toEqual({smtp_host:'retained.example.invalid',smtp_port:465})
  expect((await port.db.query<{value:string|null}>("select pg_get_expr(d.adbin,d.adrelid) value from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.ediel_mailboxes'::regclass and a.attname='smtp_port'")).rows[0].value).toBe(mode==='587'?'587':null)
})
it.each(['smtp_host integer','smtp_port text','updated_by text','last_successful_poll_at timestamp without time zone','created_by uuid default gen_random_uuid()','smtp_port integer default 25',"smtp_host text not null default 'unknown'"])('rejects unsupported partial column %s before adding any other column', async column => {
  await port.db.exec('alter table public.ediel_mailboxes add column '+column);const before=await columns();await expect(repair()).rejects.toThrow('mailbox_runtime_column_unknown');expect(await columns()).toEqual(before)
})
it('refuses a missing canonical mailbox relation without synthesizing a replacement', async () => {
  await port.db.exec('drop table public.ediel_mailboxes');await expect(repair()).rejects.toThrow('mailbox_runtime_prerequisite_missing')
})
