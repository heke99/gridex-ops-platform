// Actual current canonical SQL in finite PostgreSQL RLS/role fixtures, whole
// additive forward and actual availability/signing/archive consumers. Existing
// signing authority and external email/storage/persistence are declared ports;
// this availability guard grants no signing/provider/legal authority. No native.
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { requireContractRecordsAvailable } from '@/lib/ediel/retention/customerRecordClasses'
import { sendOnlineContractSignatureRequest } from '@/lib/customer-contracts/onlineSigning'
import { archiveSignedCustomerContractPdf } from '@/lib/customer-contracts/documents'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), email: vi.fn(), company: vi.fn(), random: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('node:crypto', async () => { const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto'); return { ...actual, randomBytes: (n: number) => { io.random(n); return actual.randomBytes(n) } } })
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from, storage: { from: () => ({ upload: io.upload }) } } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => { throw Error('unexpected_authenticated_transport') } }))
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: io.email }))
vi.mock('@/lib/website/customerApplicationCommunication', () => ({ companyEmailContext: io.company }))
vi.mock('@/lib/auth/urls', () => ({ getBaseAppUrl: () => 'https://synthetic.invalid' }))
vi.mock('@/lib/customer-contracts/agreementPdf', () => ({ buildAgreementPdfAttachment: () => { throw Error('unexpected_pdf_builder') } }))
vi.mock('@/lib/customer-contracts/confirmationDelivery', () => ({ attemptContractConfirmationDelivery: () => { throw Error('unexpected_confirmation') }, listDueContractConfirmations: () => [], recordContractConfirmationFailure: () => { throw Error('unexpected_confirmation_failure') } }))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), contract: id(2), customer: id(3), actor: id(4), foreign: id(5), otherContract: id(6), request: id(7) }
const name = 'public.ediel_require_contract_records_available_v1'
const signature = `${name}(uuid,uuid)`
const owner = 'gridex_ediel_retention_owner'
const file = 'supabase/migrations/20261013040000_ops_api_contract_retention_guard_forward.sql'
const forward = () => existsSync(file) ? readFileSync(file, 'utf8') : ''
const schema = readFileSync('supabase/schema.sql', 'utf8')
const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
const canonical = schema.slice(start, schema.indexOf('\n--', start)).trim()
let db: PGlite
let effects: { preparations: unknown[]; marks: unknown[]; emails: unknown[]; uploads: unknown[]; documents: unknown[] }
type Row = Record<string, unknown>

async function fixture(installed = true, prepare = '') {
  const pg = new PGlite()
  await pg.exec(`create role anon;create role authenticated;create role authenticator;create role service_role;
    create role ${owner} nologin noinherit bypassrls;
    grant ${owner} to current_user with inherit false,set true;
    create schema gridex_ediel_retention authorization ${owner};
    revoke all on schema gridex_ediel_retention from public,anon,authenticated,authenticator,service_role;
    create table public.customer_contracts(id uuid primary key,company_id uuid not null);
    alter table public.customer_contracts enable row level security;
    grant all on public.customer_contracts to service_role;
    create table gridex_ediel_retention.record_tombstones(company_id uuid not null,contract_id uuid);
    alter table gridex_ediel_retention.record_tombstones owner to ${owner};
    alter table gridex_ediel_retention.record_tombstones enable row level security;
    alter table gridex_ediel_retention.record_tombstones force row level security;
    revoke all on gridex_ediel_retention.record_tombstones from public,anon,authenticated,authenticator,service_role;
  `)
  if (prepare) await pg.exec(prepare)
  if (installed && forward()) await pg.exec(forward())
  return pg
}
async function invoke(company: string | null, contract: string | null, role = 'service_role', pg = db) {
  if (!['service_role', 'anon', 'authenticated'].includes(role)) throw Error('undeclared_fixture_role')
  await pg.exec('savepoint read_guard')
  try {
    await pg.exec(`set local role ${role}`)
    const r = await pg.query(`select ${name}($1::uuid,$2::uuid)`, [company, contract])
    await pg.exec('reset role;release savepoint read_guard')
    return { data: r.rows[0], error: null }
  } catch (error) {
    await pg.exec('rollback to savepoint read_guard;reset role;release savepoint read_guard')
    return { data: null, error }
  }
}
async function snapshot(pg = db) {
  const fn = await pg.query(`select p.oid,to_jsonb(p) metadata,obj_description(p.oid,'pg_proc') description from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='ediel_require_contract_records_available_v1' order by p.oid`)
  const tables = await pg.query(`select oid,relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class
    where oid in('public.customer_contracts'::regclass,'gridex_ediel_retention.record_tombstones'::regclass) order by oid`)
  const schemas = await pg.query(`select oid,nspowner,nspacl from pg_namespace where nspname in('public','gridex_ediel_retention') order by oid`)
  const roles = await pg.query(`select oid,rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreaterole,rolcreatedb,rolreplication from pg_roles where rolname='${owner}'`)
  const columns = await pg.query(`select attrelid,attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated,attacl from pg_attribute
    where attrelid in(to_regclass('public.customer_contracts'),to_regclass('gridex_ediel_retention.record_tombstones'))
    and attnum>0 and not attisdropped order by attrelid,attnum`)
  const membership = await pg.query('select roleid,member,grantor,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor')
  return { fn: fn.rows, tables: tables.rows, schemas: schemas.rows, roles: roles.rows, columns: columns.rows, membership: membership.rows }
}
async function dataSnapshot() {
  return { contracts: (await db.query('select * from public.customer_contracts order by id')).rows,
    tombstones: (await db.query('select * from gridex_ediel_retention.record_tombstones order by company_id,contract_id')).rows }
}
function sdkTable(table: string) {
  let inserted: Row | null = null
  const q = { select: () => q, eq: () => q,
    insert: (row: Row) => { if (table !== 'customer_contract_documents') throw Error('undeclared_insert'); inserted = row; return q },
    single: async () => {
      if (table === 'customers') return { data: { full_name: 'Synthetic', email: 'synthetic@example.invalid', customer_number: 'synthetic' }, error: null }
      if (inserted) { const row = { id: id(30), ...inserted }; effects.documents.push(row); return { data: row, error: null } }
      throw Error(`undeclared_single:${table}`)
    },
    maybeSingle: async () => ({ data: table === 'company_email_templates' ? { id: id(20) } : null, error: null }) }
  if (!['customers', 'customer_contract_documents', 'company_email_templates'].includes(table)) throw Error(`undeclared_table:${table}`)
  return q
}
const send = (companyId = own.company, contractId = own.contract) => sendOnlineContractSignatureRequest({ companyId, contractId,
  customerId: own.customer, actorUserId: own.actor, recipientEmail: 'synthetic@example.invalid' })
const archive = (companyId = own.company, contractId = own.contract) => archiveSignedCustomerContractPdf({ companyId,
  customerContractId: contractId, pdfBuffer: Buffer.from('%PDF-1.4 synthetic fixture'), generationSnapshot: { declared: 'existing signed source' } })
async function noEffects(action: () => Promise<unknown>, code: string) {
  const before = await dataSnapshot()
  await expect(action()).rejects.toMatchObject({ code })
  expect(effects).toEqual({ preparations: [], marks: [], emails: [], uploads: [], documents: [] })
  expect(io.random).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  expect(await dataSnapshot()).toEqual(before)
}

beforeAll(async () => { db = await fixture() }, 30_000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  vi.clearAllMocks(); effects = { preparations: [], marks: [], emails: [], uploads: [], documents: [] }
  vi.stubGlobal('fetch', () => { throw Error('network_forbidden_finite_guard_component') })
  await db.exec('begin')
  await db.query('insert into public.customer_contracts values($1,$2),($3,$4)', [own.contract, own.company, own.otherContract, own.foreign])
  io.from.mockImplementation(sdkTable)
  io.company.mockResolvedValue({ name: 'Synthetic', supportEmail: 'synthetic@example.invalid' })
  io.email.mockImplementation(async (input: unknown) => { effects.emails.push(input); return { ok: true } })
  io.upload.mockImplementation(async (...input: unknown[]) => { effects.uploads.push(input); return { data: {}, error: null } })
  io.rpc.mockImplementation(async (rpc: string, args: Row) => {
    if (rpc === 'ediel_require_contract_records_available_v1') return invoke(args.p_company_id as string, args.p_contract_id as string)
    // Existing canonical signing authority is an external successful port, not
    // authority created by the availability guard. Its actual caller stays real.
    if (rpc === 'gridex_prepare_customer_contract_signature_request_v1') {
      effects.preparations.push(structuredClone(args))
      return { data: { ok: true, request_id: own.request, company_id: args.p_company_id, customer_id: args.p_customer_id,
        contract_id: args.p_contract_id, contract_name: 'Synthetic contract', status: 'pending_signature', recipient_email: args.p_recipient_email,
        expires_at: args.p_expires_at, channel: args.p_channel, offer_reference: 'synthetic', contract_publication_version_id: id(11),
        price_plan_version_id: id(12), legal_bundle_version_id: id(13), contract_price_snapshot_id: id(14) }, error: null }
    }
    if (rpc === 'gridex_mark_customer_contract_signature_request_sent_v1') { effects.marks.push(args); return { data: {}, error: null } }
    throw Error(`undeclared_rpc:${rpc}`)
  })
})
afterEach(async () => { await db.exec('rollback'); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('installed canonical availability permits the actual signing consumer before its existing preparation/email ports', async () => {
  const before = await dataSnapshot(); await send()
  expect(effects.preparations).toHaveLength(1); expect(effects.emails).toHaveLength(1); expect(effects.marks).toHaveLength(1)
  expect(effects.uploads).toEqual([]); expect(await dataSnapshot()).toEqual(before)
})
it('installed canonical availability permits the actual signed archive consumer before storage/persistence', async () => {
  const before = await dataSnapshot(); const result = await archive()
  expect(result.company_id).toBe(own.company); expect(effects.uploads).toHaveLength(1); expect(effects.documents).toHaveLength(1)
  expect(effects.preparations).toEqual([]); expect(await dataSnapshot()).toEqual(before)
})
it.each(['sign', 'archive'] as const)('own contract tombstone refuses actual %s before token/preparation/email/storage/persistence', async kind => {
  await db.query('insert into gridex_ediel_retention.record_tombstones values($1,$2)', [own.company, own.contract])
  await noEffects(kind === 'sign' ? send : archive, 'P0001')
})
it.each(['sign', 'archive'] as const)('actual %s refuses foreign-company/foreign-contract/missing scope without any effect', async kind => {
  for (const [company, contract] of [[own.foreign, own.contract], [own.company, own.otherContract], [own.company, id(99)]]) {
    await noEffects(() => (kind === 'sign' ? send : archive)(company, contract), 'P0001')
  }
})
it('unrelated tombstones cannot block the owned contract', async () => {
  await db.query('insert into gridex_ediel_retention.record_tombstones values($1,$2),($3,$4)', [own.foreign, own.contract, own.company, own.otherContract])
  await requireContractRecordsAvailable({ companyId: own.company, contractId: own.contract })
  expect(effects.preparations).toEqual([])
})
it.each([[null, own.contract], [own.company, null], [null, null]])('PostgreSQL null scope %s/%s refuses without data writes', async (company, contract) => {
  const before = await dataSnapshot(); expect(await invoke(company, contract)).toMatchObject({ error: { code: 'P0001' } }); expect(await dataSnapshot()).toEqual(before)
})
it.each(['anon', 'authenticated'])('ordinary %s cannot invoke the service-only guard', async role => {
  expect(await invoke(own.company, own.contract, role)).toMatchObject({ error: { code: '42501' } })
})
it('a missing guard still fails closed in both actual consumers before any downstream port', async () => {
  await db.exec(`drop function ${signature}`)
  await noEffects(send, '42883'); await noEffects(archive, '42883')
})
it('real FOR SHARE needs UPDATE as well as SELECT even with canonical private BYPASSRLS owner', async () => {
  if (!forward()) await db.exec(canonical)
  await db.exec(`grant create on schema public to ${owner};alter function ${signature} owner to ${owner};
    revoke create on schema public from ${owner};revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;
    grant select on public.customer_contracts to ${owner};revoke update on public.customer_contracts from ${owner}`)
  expect(await invoke(own.company, own.contract)).toMatchObject({ error: { code: '42501' } })
  await db.exec(`grant update on public.customer_contracts to ${owner}`)
  expect((await invoke(own.company, own.contract)).error).toBeNull()
})
it('whole forward replays with exact current function/table/schema/role metadata no-op and no row writes', async () => {
  const pg = await fixture()
  try { const before = await snapshot(pg); await pg.exec(forward()); expect(await snapshot(pg)).toEqual(before) }
  finally { await pg.close() }
}, 30_000)

it('independently installed actual canonical source is a strict metadata no-op for the forward', async () => {
  const pg = await fixture(false)
  try {
    await pg.exec(`grant select,update on public.customer_contracts to ${owner};
      grant create on schema public to ${owner};set role ${owner};${canonical}
      revoke all on function ${signature} from public,anon,authenticated,authenticator;
      grant execute on function ${signature} to service_role;
      reset role;revoke create on schema public from ${owner};`)
    const before = await snapshot(pg)
    await pg.exec(forward())
    expect(await snapshot(pg)).toEqual(before)
  } finally { await pg.close() }
}, 30_000)

it.each(['body', 'acl', 'overload', 'present-overload', 'owner-login', 'owner-inherit', 'owner-bypass', 'private-column', 'private-schema', 'public-rls', 'private-rls', 'volatility', 'search-path', 'security', 'grant-option', 'function-owner', 'missing-lock-grant'] as const)(
  'whole forward refuses noncanonical %s without repairing existing objects', async kind => {
    const pg = await fixture()
    try {
      if (kind === 'body') await pg.exec(`create or replace function ${name}(p_company_id uuid,p_contract_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$begin null;end$$`)
      if (kind === 'acl') await pg.exec(`grant execute on function ${signature} to authenticated`)
      if (kind === 'overload') { await pg.exec(`drop function ${signature}`); await pg.exec(`create function ${name}(text,text) returns void language plpgsql as $$begin null;end$$`) }
      if (kind === 'present-overload') await pg.exec(`create function ${name}(text,text) returns void language plpgsql as $$begin null;end$$`)
      if (kind === 'owner-login') await pg.exec(`alter role ${owner} login`)
      if (kind === 'owner-inherit') await pg.exec(`alter role ${owner} inherit`)
      if (kind === 'owner-bypass') await pg.exec(`alter role ${owner} nobypassrls`)
      if (kind === 'private-column') await pg.exec('alter table gridex_ediel_retention.record_tombstones alter column contract_id type text using contract_id::text')
      if (kind === 'private-schema') await pg.exec('grant usage on schema gridex_ediel_retention to service_role')
      if (kind === 'public-rls') await pg.exec('alter table public.customer_contracts disable row level security')
      if (kind === 'private-rls') await pg.exec('alter table gridex_ediel_retention.record_tombstones no force row level security')
      if (kind === 'volatility') await pg.exec(`alter function ${signature} stable`)
      if (kind === 'search-path') await pg.exec(`alter function ${signature} set search_path=public,pg_catalog`)
      if (kind === 'security') await pg.exec(`alter function ${signature} security invoker`)
      if (kind === 'grant-option') await pg.exec(`grant execute on function ${signature} to service_role with grant option`)
      if (kind === 'function-owner') await pg.exec(`alter function ${signature} owner to current_user`)
      if (kind === 'missing-lock-grant') await pg.exec(`revoke update on public.customer_contracts from ${owner}`)
      const before = await snapshot(pg)
      await expect(pg.exec(forward())).rejects.toThrow()
      await pg.exec('rollback'); expect(await snapshot(pg)).toEqual(before)
    } finally { await pg.close() }
  }, 30_000)

it.each(['membership', 'missing-column', 'uuid-column', 'contract-privilege', 'contract-column-grant-option', 'private-table-acl'] as const)(
  'absent-only forward refuses unsafe %s prerequisites with no function or privilege repair', async kind => {
    const pg = await fixture(false)
    try {
      if (kind === 'membership') await pg.exec(`grant ${owner} to authenticated with inherit false,set true`)
      if (kind === 'missing-column') await pg.exec('alter table gridex_ediel_retention.record_tombstones drop column contract_id')
      if (kind === 'uuid-column') await pg.exec('alter table public.customer_contracts alter column company_id type text using company_id::text')
      if (kind === 'contract-privilege') await pg.exec(`grant insert on public.customer_contracts to ${owner}`)
      if (kind === 'contract-column-grant-option') await pg.exec(`grant select(id) on public.customer_contracts to ${owner} with grant option`)
      if (kind === 'private-table-acl') await pg.exec('grant select on gridex_ediel_retention.record_tombstones to service_role')
      const before = await snapshot(pg)
      await expect(pg.exec(forward())).rejects.toThrow()
      await pg.exec('rollback'); expect(await snapshot(pg)).toEqual(before)
    } finally { await pg.close() }
  }, 30_000)

it('a driver with safe SET membership but no schema/table grant authority cannot install', async () => {
  const pg = await fixture(false)
  try {
    await pg.exec(`create role restricted_migration nologin noinherit;grant ${owner} to restricted_migration with inherit false,set true`)
    const before = await snapshot(pg)
    await pg.exec('set role restricted_migration')
    await expect(pg.exec(forward())).rejects.toThrow('ops_api_contract_guard_migration_grant_authority_required')
    await pg.exec('rollback;reset role'); expect(await snapshot(pg)).toEqual(before)
  } finally { await pg.close() }
}, 30_000)

it('a non-superuser migration owner with safe SET but no inherited private schema access can install and replay', async () => {
  const pg = await fixture(false)
  try {
    await pg.exec(`create role bounded_migration nologin noinherit nosuperuser nobypassrls;
      grant ${owner} to bounded_migration with inherit false,set true;
      alter schema public owner to bounded_migration;
      alter table public.customer_contracts owner to bounded_migration;`)
    await pg.exec('set role bounded_migration')
    await pg.exec(forward())
    await pg.exec('reset role'); const before = await snapshot(pg)
    await pg.exec('set role bounded_migration'); await pg.exec(forward()); await pg.exec('reset role')
    expect(await snapshot(pg)).toEqual(before)
  } finally { await pg.close() }
}, 30_000)

it('a failed final ACL check rolls back a newly created function and both narrow table grants', async () => {
  const pg = await fixture(false)
  try {
    // Default function ACLs are external catalog state, not repaired by this forward.
    await pg.exec(`create role unexpected_executor;alter default privileges for role ${owner} grant execute on functions to unexpected_executor`)
    const before = await snapshot(pg)
    await expect(pg.exec(forward())).rejects.toThrow('ops_api_contract_guard_canonical_metadata_required')
    await pg.exec('rollback'); expect(await snapshot(pg)).toEqual(before)
  } finally { await pg.close() }
}, 30_000)

it('ownership handoff restores an existing private-owner public CREATE grant exactly', async () => {
  const pg = await fixture(false, `grant create on schema public to ${owner}`)
  try {
    const before = (await snapshot(pg)).schemas
    await pg.exec(forward())
    expect((await snapshot(pg)).schemas).toEqual(before)
    expect((await pg.query(`select md5(prosrc) body from pg_proc where oid=to_regprocedure('${signature}')`)).rows).toEqual([{ body: 'fb147a8c9fa9e10f7f4e1c6ee8a8ecb3' }])
  } finally { await pg.close() }
}, 30_000)

it('the complete absent-only install rolls back function and narrow grants on transaction rollback', async () => {
  const pg = await fixture(false)
  try {
    const before = await snapshot(pg); await pg.exec('begin'); await pg.exec(forward()); await pg.exec('rollback')
    expect(await snapshot(pg)).toEqual(before)
  } finally { await pg.close() }
}, 30_000)
