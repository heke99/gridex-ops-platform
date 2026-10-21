import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual begin/current/source-contract bodies execute over finite SQL tables.
// Permission/basis/receipt ports model authority changing at a wait boundary;
// they are not native contention, signed legal originals, JWT or Storage proof.
// The production migration's non-superuser install envelope is not bypassed or
// attested here: only its explicitly selected source/body blocks are installed.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020155348_retention_purge_post_lock_authority.sql', 'utf8')
// Immutable pre-forward sources remain valid after genuine GEN adoption.
const historical = {
  content: readFileSync('supabase/migrations/20261001000700_ediel_message_content_and_mime_retention.sql', 'utf8'),
  classAuthority: readFileSync('supabase/migrations/20261001000710_ediel_archived_tenant_retention_class_authority.sql', 'utf8'),
  invoice: readFileSync('supabase/migrations/20261001071000_ediel_invoice_file_copy_class_retention.sql', 'utf8'),
  audit19: readFileSync('supabase/migrations/20261019180400_db05_qualified_audit19_cleanup.sql', 'utf8'),
}
const company = '10000000-0000-4000-8000-000000000001'
const executor = '20000000-0000-4000-8000-000000000002'
const reviewer = '30000000-0000-4000-8000-000000000003'
const secondReviewer = '40000000-0000-4000-8000-000000000004'
const submitter = '50000000-0000-4000-8000-000000000005'
const blob = '60000000-0000-4000-8000-000000000006'
const blobReview = '70000000-0000-4000-8000-000000000007'
const first = '80000000-0000-4000-8000-000000000008'
const second = '90000000-0000-4000-8000-000000000009'
const firstReview = 'a0000000-0000-4000-8000-00000000000a'
const secondReview = 'b0000000-0000-4000-8000-00000000000b'
const routines = [
  'public.ediel_begin_blob_purge_v1',
  'public.ediel_begin_invoice_file_purge_v1',
  'gridex_ediel_retention.invoice_file_current_v1',
  'gridex_ediel_retention.audit19_source_contract_v1',
]
let db: PGlite

function definition(sql: string, name: string, optional = false): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\(`, 'im').exec(sql)
  if (!start) {
    if (optional) return ''
    throw new Error('Missing source function: ' + name)
  }
  const after = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(after)
  if (!delimiter) throw new Error('Missing function delimiter: ' + name)
  const end = after.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Unterminated function: ' + name)
  return after.slice(0, end + delimiter[1].length + 1)
}

function replaceOnce(source: string, old: string, replacement: string) {
  if (source.split(old).length !== 2) throw new Error('Historical source anchor must occur exactly once')
  return source.replace(old, replacement)
}
function predecessor(name: string) {
  const expected: Record<string, string> = {
    'public.ediel_begin_blob_purge_v1': 'e5b9584f96b87d8d7aa932e69a884f727dfcbdade3e0902451a341bcec230378',
    'public.ediel_begin_invoice_file_purge_v1': '897064c598486fd654ed7eb31433a1e61b9436241ca1e9d6caa9ca4ee428ffda',
    'gridex_ediel_retention.invoice_file_current_v1': 'd719359fff25150bdd326b0df579385a4d6f1975e45d88023695d58ddff19c9d',
    'gridex_ediel_retention.audit19_source_contract_v1': '3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b',
  }
  if (!(name in expected)) return definition(schema, name)
  let ddl: string
  if (name === 'public.ediel_begin_blob_purge_v1') {
    ddl = definition(historical.content, name)
    // Exactly the two literal begin-blob substitutions in immutable 00710.
    ddl = replaceOnce(ddl, "IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required' USING ERRCODE='42501';END IF;", '')
    ddl = replaceOnce(ddl, 'PERFORM id FROM public.ediel_messages WHERE', "IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;PERFORM id FROM public.ediel_messages WHERE")
  } else ddl = definition(name.endsWith('audit19_source_contract_v1') ? historical.audit19 : historical.invoice, name)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(ddl)!
  const start = delimiter.index + delimiter[0].length
  const actual = createHash('sha256').update(ddl.slice(start, ddl.indexOf(delimiter[1] + ';', start))).digest('hex')
  if (actual !== expected[name]) throw new Error('Unqualified historical predecessor: ' + name)
  return ddl
}

function taggedBlock(tag: string): string {
  const start = forward.indexOf(`DO $${tag}$`)
  if (start < 0) return ''
  const end = forward.indexOf(`$${tag}$;`, start + tag.length + 5)
  if (end < 0) throw new Error('Unterminated forward block: ' + tag)
  return forward.slice(start, end + tag.length + 3)
}

async function mode(value: string) {
  await db.query("select set_config('fixture.retention_mode',$1,true)", [value])
}
async function snapshot() {
  return (await db.query<{ state: unknown }>(`select jsonb_build_object(
    'messages',(select jsonb_agg(to_jsonb(t) order by id) from public.ediel_messages t),
    'payloads',(select jsonb_agg(to_jsonb(t) order by ediel_message_id) from public.ediel_message_payloads t),
    'sources',(select jsonb_agg(to_jsonb(t) order by source_message_id) from gridex_received_sources.sources t),
    'blobs',(select coalesce(jsonb_agg(to_jsonb(t) order by target_id),'[]') from gridex_ediel_retention.blob_tombstones t),
    'invoices',(select coalesce(jsonb_agg(to_jsonb(t) order by source_id),'[]') from gridex_ediel_retention.invoice_file_tombstones t),
    'audits',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.audit_logs t)) as state`)).rows[0].state
}
async function begin(kind: 'blob' | 'invoice', actor = executor) {
  return (await db.query<{ result: { status: string; replay: boolean } }>(
    `select public.ediel_begin_${kind === 'blob' ? 'blob' : 'invoice_file'}_purge_v1($1,$2,$3) as result`,
    [company, actor, kind === 'blob' ? blob : first])).rows[0].result
}
async function denied(kind: 'blob' | 'invoice', selectedMode: string) {
  const before = await snapshot()
  await mode(selectedMode)
  await db.exec('savepoint attempt')
  let result: { status: string } | undefined
  let error: { code?: string; message?: string } | undefined
  try { result = await begin(kind) } catch (caught) {
    error = caught as typeof error
    await db.exec('rollback to savepoint attempt')
  }
  await db.exec('release savepoint attempt')
  if (error) {
    expect(error.code).toMatch(/^(42501|P0001)$/)
    expect(error.message).toMatch(/retention|invoice_file/)
  } else expect(result?.status).toBe('held')
  expect(await snapshot()).toEqual(before)
}

async function metadata() {
  return (await db.query(`select n.nspname,p.proname,p.proowner::regrole::text as owner,
    p.proacl::text,p.prosecdef,p.proconfig,p.proargnames,p.proargtypes::text,
    p.prorettype::regtype::text,p.proretset,p.proisstrict,p.provolatile,p.proparallel
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname||'.'||p.proname=any($1::text[]) order by n.nspname,p.proname`, [routines])).rows
}

describe('retention begin repeats authority after SQL wait/effect boundaries', () => {
  beforeAll(async () => {
    for (const [name, expected] of Object.entries({ content: '3bd194eff1595b35b79478b7a1875bb0c042691956baae1e192c729f9af307e2', classAuthority: 'f959f8fa359b3eee07fa6530580bf06e477cb1f6423be891cd9938f6f114e461', invoice: '1b07b113b8e48923326c6d2d0fce0dea0f5fdb515a76161c345b94b538ffa9e9', audit19: '18fcbbb3c0e8e5181539fcf1b33f54f7867cac18fe1e65a27a1898371cddde47' })) {
      expect(createHash('sha256').update(historical[name as keyof typeof historical]).digest('hex')).toBe(expected)
    }
    db = new PGlite()
    await db.exec(`create schema auth;create schema fixture;create schema gridex_ediel_retention;create schema gridex_received_sources;
      create role anon;create role authenticated;create role service_role;
      create role gridex_ediel_retention_owner nologin noinherit bypassrls;
      create table public.permissions(id int);create table public.roles(id int);create table public.user_roles(id int);
      create table public.role_permissions(id int);create table public.user_permissions(id int);create table public.user_permission_overrides(id int);
      create table public.companies(id uuid,status text);
      create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
      create table public.user_profiles(id uuid,user_status text);
      create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select '${executor}'::uuid$$;
      create table fixture.authority(actor uuid,permission text,allowed boolean,primary key(actor,permission));
      create function gridex_ediel_retention.permission_v1(c uuid,actor uuid,wanted text) returns boolean language plpgsql as $$
      declare permitted boolean;begin
        select a.allowed into permitted from fixture.authority a where a.actor=$2 and a.permission=wanted;
        if actor='${executor}'::uuid and current_setting('fixture.retention_mode',true)='entry_revoke_executor' and wanted='ediel.retention.purge'
          or actor='${executor}'::uuid and current_setting('fixture.retention_mode',true)='entry_revoke_class' and wanted='ediel.retention.original_bytes' then
          update fixture.authority a set allowed=false where a.actor=$2 and a.permission=wanted;
        end if;return coalesce(permitted,false);end$$;
      create function fixture.boundary(stage text,target uuid default null) returns void language plpgsql as $$
      declare selected text:=current_setting('fixture.retention_mode',true);who uuid;wanted text;begin
        if selected=stage||'_executor' then who:='${executor}';wanted:='ediel.retention.purge';
        elsif selected=stage||'_class' then who:='${executor}';wanted:=case when stage like 'invoice%' then 'ediel.retention.invoice_copy_evidence' else 'ediel.retention.original_bytes' end;
        elsif selected=stage||'_reviewer' then who:='${reviewer}';wanted:='ediel.retention.review';
        elsif selected=stage||'_reviewer_class' then who:='${reviewer}';wanted:=case when stage like 'invoice%' then 'ediel.retention.invoice_copy_evidence' else 'ediel.retention.original_bytes' end;
        elsif selected='second_copy_revoke_first_reviewer' and stage='invoice_basis' and target='${second}'::uuid then who:='${reviewer}';wanted:='ediel.retention.review';
        else return;end if;
        update fixture.authority set allowed=false where actor=who and permission=wanted;
      end$$;
      create table gridex_ediel_retention.blob_decisions(id uuid,company_id uuid,retention_class text,target_id uuid,message_id uuid,source_hash text,target_hash text,submitted_by uuid);
      create table gridex_ediel_retention.blob_reviews(id uuid,decision_id uuid,actor_user_id uuid,outcome text,created_at timestamptz);
      create table gridex_ediel_retention.blob_tombstones(retention_class text,target_id uuid,company_id uuid,message_id uuid,decision_id uuid,review_id uuid,source_hash text,target_hash text,public_content_hash text,byte_length bigint,storage_path text,actor_user_id uuid,created_at timestamptz,primary key(retention_class,target_id));
      create table gridex_ediel_retention.blob_events(retention_class text,target_id uuid,kind text,actor_user_id uuid);
      create table public.ediel_messages(id uuid,company_id uuid,raw_payload text,parsed_payload jsonb,validation_report jsonb,metadata jsonb);
      create table public.ediel_message_payloads(company_id uuid,ediel_message_id uuid,raw_payload text,encrypted_payload bytea);
      create table gridex_received_sources.sources(company_id uuid,source_message_id uuid,raw_payload text,retention_purged_at timestamptz);
      create table public.audit_logs(actor_user_id uuid,company_id uuid,entity_type text,entity_id text,action text,metadata jsonb);
      create function gridex_ediel_retention.blob_receipt_v1(d gridex_ediel_retention.blob_decisions) returns jsonb language plpgsql as $$begin
        perform fixture.boundary('blob_receipt',d.id);return jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day');end$$;
      create function gridex_ediel_retention.blob_basis_v1(c uuid,k text,target uuid) returns jsonb language plpgsql as $$begin
        perform fixture.boundary('blob_basis',target);return jsonb_build_object('targetHash',repeat('b',64),'sourceHash',repeat('a',64),'publicContentHash',repeat('c',64),'byteLength',12,'storagePath','synthetic/retained');end$$;
      create function fixture.audit_boundary() returns trigger language plpgsql as $$begin perform fixture.boundary('blob_audit');return new;end$$;
      create trigger fixture_audit_boundary after insert on public.audit_logs for each row execute function fixture.audit_boundary();
      create table gridex_ediel_retention.invoice_file_sources(id uuid,company_id uuid,retention_class text,target_id uuid,source_hash text,target_hash text,storage_bucket text,storage_path text,byte_length bigint);
      create table gridex_ediel_retention.invoice_file_decisions(id uuid,company_id uuid,retention_class text,target_id uuid,source_id uuid,source_hash text,target_hash text,scope_hash text,submitted_by uuid,created_at timestamptz);
      create table gridex_ediel_retention.invoice_file_reviews(id uuid,decision_id uuid,actor_user_id uuid,outcome text,created_at timestamptz);
      create table gridex_ediel_retention.invoice_file_events(source_id uuid,kind text,actor_user_id uuid);
      create table gridex_ediel_retention.invoice_file_tombstones(source_id uuid primary key,company_id uuid,decision_id uuid,review_id uuid,actor_user_id uuid,journal_retain_until timestamptz,journal_purpose_reference text);
      create function gridex_ediel_retention.invoice_file_shared_scope_v1(bucket text,path text) returns setof gridex_ediel_retention.invoice_file_sources language sql as $$select * from gridex_ediel_retention.invoice_file_sources where storage_bucket=bucket and storage_path=path$$;
      create function gridex_ediel_retention.invoice_file_basis_v1(c uuid,k text,target uuid) returns jsonb language plpgsql as $$begin
        perform fixture.boundary('invoice_basis',target);return jsonb_build_object('targetHash',repeat('b',64),'sourceHash',repeat('a',64),'scopeHash',repeat('c',64),'allIncludedScopesClosed',true,'periodStart','2020-01-01','periodEnd','2020-02-01');end$$;
      create function gridex_ediel_retention.invoice_file_receipt_v1(d gridex_ediel_retention.invoice_file_decisions) returns jsonb language plpgsql as $$begin
        perform fixture.boundary('invoice_receipt',d.id);return jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day','journalRetainUntil',clock_timestamp()+interval '1 year','journalPurposeReference','synthetic component only','periodStart','2020-01-01','periodEnd','2020-02-01');end$$;
      create function fixture.invoice_insert_boundary() returns trigger language plpgsql as $$begin perform fixture.boundary('invoice_insert',new.source_id);return new;end$$;
      create trigger fixture_invoice_insert_boundary after insert on gridex_ediel_retention.invoice_file_tombstones for each row execute function fixture.invoice_insert_boundary();`)
    for (const name of ['public.ediel_retention_lock_auth_actor_v1', 'public.ediel_retention_session_actor_v1', 'gridex_ediel_retention.actor_v1', 'gridex_ediel_retention.class_permission_v1', 'gridex_ediel_retention.invoice_file_actor_v1', 'gridex_ediel_retention.blob_current_v1', 'public.gridex_normalize_audit_context_v1', 'public.gridex_guard_history_truncate_v1', 'gridex_ediel_retention.audit19_guard_v1', ...routines]) {
      await db.exec(predecessor(name))
    }
    await db.exec(`grant usage,create on schema public,gridex_ediel_retention to gridex_ediel_retention_owner;
      grant usage on schema auth,fixture,gridex_received_sources to gridex_ediel_retention_owner;
      grant all on all tables in schema public,auth,fixture,gridex_ediel_retention,gridex_received_sources to gridex_ediel_retention_owner;`)
    for (const name of routines) {
      const signature = name + (name.endsWith('invoice_file_current_v1') ? '(gridex_ediel_retention.invoice_file_decisions)' : name.endsWith('audit19_source_contract_v1') ? '(text)' : '(uuid,uuid,uuid)')
      await db.exec(`alter function ${signature} owner to gridex_ediel_retention_owner;revoke all on function ${signature} from public,anon,authenticated,service_role;`)
      if (name.startsWith('public.')) await db.exec(`grant execute on function ${signature} to authenticated`)
    }
  }, 30_000)

  beforeEach(async () => {
    await db.exec('begin')
    const before = await metadata()
    const preflight = taggedBlock('retention_begin_body_preflight')
    if (preflight) await db.exec(preflight)
    const profiles = forward.match(/^CREATE TEMPORARY TABLE gridex_retention_begin_function_scope[\s\S]*?;\n/m)?.[0]
    if (profiles) await db.exec(profiles)
    for (const name of routines) {
      const replacement = definition(forward, name, true)
      if (replacement) await db.exec(replacement)
    }
    const slot = taggedBlock('retention_begin_audit19_slot')
    if (slot) await db.exec(slot)
    const preserved = taggedBlock('retention_begin_profiles_preserved')
    if (preserved) await db.exec(preserved)
    expect(await metadata()).toEqual(before)
    await db.exec(`insert into public.companies values('${company}','archived');
      insert into auth.users(id) values('${executor}'),('${reviewer}'),('${secondReviewer}');
      insert into public.user_profiles values('${executor}','active'),('${reviewer}','active'),('${secondReviewer}','active');
      insert into public.company_memberships select '${company}',id,'active',true,clock_timestamp() from auth.users;
      insert into fixture.authority select u.id,p,true from auth.users u cross join unnest(array['ediel.retention.purge','ediel.retention.review','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.invoice_copy_evidence']) p;
      insert into gridex_ediel_retention.blob_decisions values('${blob}','${company}','received_ediel_message_content','${blob}','${blob}',repeat('a',64),repeat('b',64),'${submitter}');
      insert into gridex_ediel_retention.blob_reviews values('${blobReview}','${blob}','${reviewer}','approved',clock_timestamp());
      insert into public.ediel_messages values('${blob}','${company}','original raw','{"original":true}','{"original":true}','{"original":true}');
      insert into public.ediel_message_payloads values('${company}','${blob}','original raw',decode('616263','hex'));
      insert into gridex_received_sources.sources values('${company}','${blob}','original raw',null);
      insert into gridex_ediel_retention.invoice_file_sources select id,'${company}','customer_invoice_pdf_bytes',id,repeat('a',64),repeat('b',64),'billing-exports','companies/${company}/synthetic.pdf',12 from unnest(array['${first}'::uuid,'${second}'::uuid]) id;
      insert into gridex_ediel_retention.invoice_file_decisions select id,'${company}',retention_class,id,id,repeat('a',64),repeat('b',64),repeat('c',64),'${submitter}',clock_timestamp() from gridex_ediel_retention.invoice_file_sources;
      insert into gridex_ediel_retention.invoice_file_reviews values('${firstReview}','${first}','${reviewer}','approved',clock_timestamp()),('${secondReview}','${second}','${secondReviewer}','approved',clock_timestamp());`)
    await mode('valid')
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('purges received SQL content only when executor and reviewer remain authorized', async () => {
    expect(await begin('blob')).toMatchObject({ status: 'purged', replay: false })
    expect((await db.query('select raw_payload,parsed_payload from public.ediel_messages')).rows)
      .toEqual([{ raw_payload: null, parsed_payload: {} }])
    expect((await db.query<{ n: number }>('select count(*)::int n from gridex_ediel_retention.blob_tombstones')).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.audit_logs')).rows[0].n).toBe(1)
  })
  it.each(['blob_receipt_executor', 'blob_receipt_class', 'blob_basis_executor', 'blob_basis_class', 'blob_basis_reviewer', 'blob_basis_reviewer_class', 'blob_audit_executor', 'blob_audit_class', 'blob_audit_reviewer', 'blob_audit_reviewer_class'])(
    'leaves every blob SQL effect unchanged after %s loses authority', async selected => { await denied('blob', selected) })

  it('creates both selected invoice-copy tombstones under current authority', async () => {
    expect(await begin('invoice')).toMatchObject({ status: 'storage_purge_pending', replay: false })
    expect((await db.query('select source_id,review_id from gridex_ediel_retention.invoice_file_tombstones order by source_id')).rows)
      .toEqual([{ source_id: first, review_id: firstReview }, { source_id: second, review_id: secondReview }])
  })
  it.each(['invoice_receipt_executor', 'invoice_receipt_class', 'invoice_receipt_reviewer', 'invoice_receipt_reviewer_class', 'second_copy_revoke_first_reviewer', 'invoice_insert_executor', 'invoice_insert_class', 'invoice_insert_reviewer', 'invoice_insert_reviewer_class'])(
    'rolls back every invoice tombstone after %s loses authority', async selected => { await denied('invoice', selected) })

  it.each(['ediel.retention.review', 'ediel.retention.invoice_copy_evidence'])(
    'the invoice current helper rechecks reviewer %s after its receipt port', async permission => {
      await mode(permission.endsWith('review') ? 'invoice_receipt_reviewer' : 'invoice_receipt_reviewer_class')
      expect((await db.query<{ current: string | null }>('select gridex_ediel_retention.invoice_file_current_v1(d) as current from gridex_ediel_retention.invoice_file_decisions d where id=$1', [first])).rows[0].current)
        .toBeNull()
    })

  it.each(['blob', 'invoice'] as const)('preserves completed %s replay without reactivating old policy', async kind => {
    if (kind === 'blob') {
      await begin('blob')
    } else await db.query("insert into gridex_ediel_retention.invoice_file_events(source_id,kind) values($1,'storage_object_absent')", [first])
    await db.exec(`update fixture.authority set allowed=false where actor='${reviewer}'`)
    const before = await snapshot()
    expect(await begin(kind)).toMatchObject({ status: 'purged', replay: true })
    expect(await snapshot()).toEqual(before)
  })
  it.each(['blob', 'invoice'] as const)('requires fresh executor authority before completed %s replay', async kind => {
    if (kind === 'blob') await begin('blob')
    else await db.query("insert into gridex_ediel_retention.invoice_file_events(source_id,kind) values($1,'storage_object_absent')", [first])
    await denied(kind, 'entry_revoke_executor')
  })
  it('requires the current blob class again before completed replay', async () => {
    await begin('blob')
    await denied('blob', 'entry_revoke_class')
  })

  it('keeps the exact audit19 map slot aligned without accepting other changed consumers', async () => {
    const rows = (await db.query<{ name: string; hash: string; body: string }>(`select n.nspname||'.'||p.proname as name,
      encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash,prosrc as body
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1::text[])`, [routines])).rows
    const current = rows.find(r => r.name.endsWith('audit19_source_contract_v1'))!
    const baseline = predecessor('gridex_ediel_retention.audit19_source_contract_v1')
    const parse = (body: string) => JSON.parse(body.match(/\$contracts\$([\s\S]*?)\$contracts\$/)![1]) as Record<string, string>
    const expected = parse(baseline)
    expected['public.ediel_begin_blob_purge_v1'] = rows.find(r => r.name === 'public.ediel_begin_blob_purge_v1')!.hash
    expect(parse(current.body)).toEqual(expected)
    // The real guard must pass its consumer-hash loop and then fail closed on
    // our deliberately unqualified one-trigger audit fixture, not bless it.
    await db.exec('savepoint source_contract')
    await expect(db.query("select gridex_ediel_retention.audit19_source_contract_v1('unsupported')"))
      .rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_trigger_unsupported' })
    await db.exec('rollback to savepoint source_contract')
  })
  it('preserves caller identity and anonymous RPC revocation', async () => {
    await db.exec('savepoint caller_identity')
    await expect(begin('blob', submitter)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint caller_identity; set local role anon')
    await expect(begin('blob')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint caller_identity')
    expect((await db.query<{ n: number }>('select count(*)::int n from gridex_ediel_retention.blob_tombstones')).rows[0].n).toBe(0)
  })
  it.each(['body', 'ACL', 'owner', 'search_path'] as const)('refuses to overwrite an unexpected old %s profile', async drift => {
    const preflight = taggedBlock('retention_begin_body_preflight')
    expect(preflight).not.toBe('')
    for (const name of routines) await db.exec(predecessor(name).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    await db.exec(preflight)
    const signature = 'public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)'
    if (drift === 'body') await db.exec(predecessor('public.ediel_begin_blob_purge_v1')
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('END$$;', () => '-- divergent source\nEND$$;'))
    else if (drift === 'ACL') await db.exec(`grant execute on function ${signature} to anon`)
    else if (drift === 'owner') await db.exec(`alter function ${signature} owner to postgres`)
    else await db.exec(`alter function ${signature} set search_path=public`)
    const changed = await metadata()
    await db.exec('savepoint refused_profile')
    await expect(db.exec(preflight)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint refused_profile')
    expect(await metadata()).toEqual(changed)
  })
})
