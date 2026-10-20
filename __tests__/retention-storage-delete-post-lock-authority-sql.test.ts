import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual guard/current/actor bodies and the actual three ordered BEFORE triggers
// execute SQL DELETEs. Finite permission/basis/receipt ports model authority loss
// at read/write boundaries; this is not native contention, Storage API, JWT,
// legal-original verification or authority-at-commit evidence. The qualified
// non-superuser installer envelope is separately preserved, not run here.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020163321_retention_storage_delete_post_lock_authority.sql', 'utf8')
const company = '10000000-0000-4000-8000-000000000001'
const otherCompany = '10000000-0000-4000-8000-000000000002'
const executor = '20000000-0000-4000-8000-000000000002'
const reviewer = '30000000-0000-4000-8000-000000000003'
const otherReviewer = '40000000-0000-4000-8000-000000000004'
const submitter = '50000000-0000-4000-8000-000000000005'
const blob = '60000000-0000-4000-8000-000000000006'
const contract = '70000000-0000-4000-8000-000000000007'
const first = '80000000-0000-4000-8000-000000000008'
const second = '90000000-0000-4000-8000-000000000009'
const path = 'synthetic/retained.pdf'
const routines = ['gridex_ediel_retention.storage_guard_v1', 'gridex_ediel_retention.contract_storage_guard_v1', 'gridex_ediel_retention.invoice_file_storage_guard_v1']
let db: PGlite

function definition(sql: string, name: string, optional = false) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\(`, 'm').exec(sql)
  if (!start) { if (optional) return ''; throw new Error('Missing source function: ' + name) }
  const after = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/.exec(after)!
  const end = after.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Unterminated function: ' + name)
  return after.slice(0, end + delimiter[1].length + 1)
}
function table(name: string) {
  const start = schema.indexOf('CREATE TABLE ' + name + ' (')
  if (start < 0) throw new Error('Missing source table: ' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
function taggedBlock(tag: string) {
  const start = forward.indexOf(`DO $${tag}$`)
  if (start < 0) return ''
  return forward.slice(start, forward.indexOf(`$${tag}$;`, start + tag.length + 5) + tag.length + 3)
}
async function mode(value: string) { await db.query("select set_config('fixture.storage_mode',$1,true)", [value]) }
async function profiles() {
  return (await db.query(`select to_jsonb(p)-'prosrc' as profile from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname||'.'||p.proname=any($1::text[]) order by p.oid`, [routines])).rows
}
async function snapshot() {
  return (await db.query<{ state: unknown }>(`select jsonb_build_object('objects',(select jsonb_agg(to_jsonb(t) order by bucket_id,name) from storage.objects t),
    'blob',(select coalesce(jsonb_agg(to_jsonb(t) order by target_id),'[]') from gridex_ediel_retention.blob_events t),
    'contract',(select coalesce(jsonb_agg(to_jsonb(t) order by target_id),'[]') from gridex_ediel_retention.record_events t),
    'invoice',(select coalesce(jsonb_agg(to_jsonb(t) order by source_id),'[]') from gridex_ediel_retention.invoice_file_events t)) as state`)).rows[0].state
}
async function remove(bucket: string) { await db.query('delete from storage.objects where bucket_id=$1 and name=$2', [bucket, path]) }
async function denied(bucket: string, selected: string) {
  await mode(selected)
  const before = await snapshot()
  await db.exec('savepoint attempted_delete')
  try { await expect(remove(bucket)).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|P0001)$/) }) }
  finally { await db.exec('rollback to savepoint attempted_delete;release savepoint attempted_delete') }
  expect(await snapshot()).toEqual(before)
}
async function capture(kind: 'blob' | 'contract') {
  const bucket = kind === 'blob' ? 'ediel-files' : 'customer-contract-documents'
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, path])
  if (kind === 'blob') await db.query(`insert into gridex_ediel_retention.blob_tombstones(retention_class,target_id,company_id,message_id,decision_id,review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id)
    values('transport_raw_mime_bytes',$1,$2,$1,$1,$1,repeat('a',64),repeat('b',64),12,$3,$4)`, [blob, company, path, executor])
  else await db.query(`insert into gridex_ediel_retention.record_tombstones(retention_class,target_id,company_id,customer_id,decision_id,review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id,journal_retain_until,journal_purpose_reference)
    values('contract_signed_pdf_bytes',$1,$2,$1,$1,$1,repeat('a',64),repeat('b',64),12,$3,$4,clock_timestamp()+interval '1 year','component only')`, [contract, company, path, executor])
  return bucket
}
async function invoiceCopies(bucket = 'billing-exports') {
  await db.query('insert into storage.objects(bucket_id,name) select $1,$2 where not exists(select from storage.objects where bucket_id=$1 and name=$2)', [bucket, path])
  await db.query(`insert into gridex_ediel_retention.invoice_file_sources(id,company_id,retention_class,target_id,target_hash,storage_object_id,storage_bucket,storage_path,source_hash,byte_length,captured_by)
    values($1,$3,'customer_invoice_pdf_bytes',$1,repeat('b',64),$1,$5,$6,repeat('a',64),12,$7),
    ($2,$4,'customer_invoice_pdf_bytes',$2,repeat('b',64),$2,$5,$6,repeat('a',64),12,$7)`, [first, second, company, otherCompany, bucket, path, executor])
  await db.query(`insert into gridex_ediel_retention.invoice_file_tombstones(source_id,company_id,decision_id,review_id,actor_user_id,journal_retain_until,journal_purpose_reference)
    values($1,$3,$1,$1,$5,clock_timestamp()+interval '1 year','component only'),($2,$4,$2,$2,$5,clock_timestamp()+interval '1 year','component only')`, [first, second, company, otherCompany, executor])
}

describe('actual composed Storage DELETE guards repeat selected authority', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create schema auth;create schema fixture;create schema storage;create schema gridex_ediel_retention;
      create role anon;create role authenticated;create role service_role;create role gridex_ediel_retention_owner nologin noinherit bypassrls;
      create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
      create table public.permissions(id int);create table public.roles(id int);create table public.user_roles(id int);create table public.role_permissions(id int);
      create table public.user_permissions(id int);create table public.user_permission_overrides(id int);
      create table public.companies(id uuid,status text);create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
      create table public.user_profiles(id uuid,user_status text);create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
      create table public.customer_contract_documents(storage_bucket text,storage_path text);
      create table public.ediel_message_payloads(encrypted_payload_ref text,metadata jsonb);
      create function auth.uid() returns uuid language sql stable as $$select '${executor}'::uuid$$;
      create table fixture.authority(company uuid,actor uuid,permission text,allowed boolean,primary key(company,actor,permission));
      create table fixture.visits(stage text,target uuid,n int);
      create function gridex_ediel_retention.permission_v1(c uuid,actor uuid,wanted text) returns boolean language sql as $$
        select coalesce((select allowed from fixture.authority a where a.company=$1 and a.actor=$2 and a.permission=$3),false)$$;
      create function gridex_ediel_retention.record_permission_v1(c uuid,actor uuid,k text) returns boolean language sql as $$
        select gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.contract_pdf')$$;
      create function fixture.boundary(stage text,target uuid default null) returns void language plpgsql as $$
      declare selected text:=current_setting('fixture.storage_mode',true);who uuid;wanted text;c uuid;counter int;begin
        update fixture.visits v set n=n+1 where v.stage=$1 and v.target is not distinct from $2 returning n into counter;
        if not found then insert into fixture.visits values(stage,target,1);counter:=1;end if;
        c:=case when target='${second}'::uuid then '${otherCompany}'::uuid else '${company}'::uuid end;
        if selected=stage||'_executor' then who:='${executor}';wanted:='ediel.retention.purge';
        elsif selected=stage||'_class' then who:='${executor}';wanted:=case when stage like 'invoice%' then 'ediel.retention.invoice_copy_evidence' when stage like 'contract%' then 'ediel.retention.contract_pdf' else 'ediel.retention.mime_bytes' end;
        elsif selected=stage||'_reviewer' then who:=case when target='${second}'::uuid then '${otherReviewer}'::uuid else '${reviewer}'::uuid end;wanted:='ediel.retention.review';
        elsif selected=stage||'_reviewer_class' then who:=case when target='${second}'::uuid then '${otherReviewer}'::uuid else '${reviewer}'::uuid end;wanted:=case when stage like 'invoice%' then 'ediel.retention.invoice_copy_evidence' when stage like 'contract%' then 'ediel.retention.contract_pdf' else 'ediel.retention.mime_bytes' end;
        elsif selected like 'contract_after_scope_%' and stage='invoice_scope' then
          who:=case when selected like '%reviewer%' then '${reviewer}'::uuid else '${executor}'::uuid end;
          wanted:=case when selected like '%reviewer_class' or selected like '%_class' then 'ediel.retention.contract_pdf' when selected like '%reviewer' then 'ediel.retention.review' else 'ediel.retention.purge' end;
        elsif selected='second_event_first_reviewer' and stage='invoice_event' and target='${second}'::uuid then c:='${company}';who:='${reviewer}';wanted:='ediel.retention.review';
        elsif selected='second_event_first_executor' and stage='invoice_event' and target='${second}'::uuid then c:='${company}';who:='${executor}';wanted:='ediel.retention.purge';
        elsif selected in('second_final_receipt_first_reviewer','second_final_receipt_first_reviewer_class') and stage='invoice_receipt' and target='${second}'::uuid and counter>=3 then
          c:='${company}';who:='${reviewer}';wanted:=case when selected like '%reviewer_class' then 'ediel.retention.invoice_copy_evidence' else 'ediel.retention.review' end;
        elsif selected=stage||'_replace_review' and stage in('blob_basis','contract_basis') then
          if stage='blob_basis' then insert into gridex_ediel_retention.blob_reviews(id,decision_id,actor_user_id,outcome,reason) select 'a0000000-0000-4000-8000-00000000000a',target,'${reviewer}','approved','later finite review' where not exists(select from gridex_ediel_retention.blob_reviews where id='a0000000-0000-4000-8000-00000000000a');
          else insert into gridex_ediel_retention.record_reviews(id,decision_id,actor_user_id,outcome,reason) select 'a0000000-0000-4000-8000-00000000000a',target,'${reviewer}','approved','later finite review' where not exists(select from gridex_ediel_retention.record_reviews where id='a0000000-0000-4000-8000-00000000000a');end if;return;
        else return;end if;
        update fixture.authority a set allowed=false where a.company=c and a.actor=who and a.permission=wanted;
      end$$;`)
    for (const name of ['blob_decisions', 'blob_reviews', 'blob_tombstones', 'blob_events', 'record_decisions', 'record_reviews', 'record_tombstones', 'record_events', 'invoice_file_sources', 'invoice_file_decisions', 'invoice_file_reviews', 'invoice_file_tombstones', 'invoice_file_events']) {
      await db.exec(table('gridex_ediel_retention.' + name))
    }
    await db.exec(`create function gridex_ediel_retention.blob_basis_v1(c uuid,k text,target uuid) returns jsonb language plpgsql as $$begin perform fixture.boundary('blob_basis',target);return jsonb_build_object('targetHash',repeat('b',64),'storagePath','${path}');end$$;
      create function gridex_ediel_retention.record_basis_v1(c uuid,k text,target uuid) returns jsonb language plpgsql as $$begin perform fixture.boundary('contract_basis',target);return jsonb_build_object('targetHash',repeat('b',64),'storagePath','${path}');end$$;
      create function gridex_ediel_retention.blob_receipt_v1(d gridex_ediel_retention.blob_decisions) returns jsonb language plpgsql as $$begin perform fixture.boundary('blob_receipt',d.id);return jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day');end$$;
      create function gridex_ediel_retention.record_receipt_v1(d gridex_ediel_retention.record_decisions) returns jsonb language plpgsql as $$begin perform fixture.boundary('contract_receipt',d.id);return jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day');end$$;
      create function gridex_ediel_retention.invoice_file_basis_v1(c uuid,k text,target uuid) returns jsonb language plpgsql as $$begin perform fixture.boundary('invoice_basis',target);return jsonb_build_object('targetHash',repeat('b',64),'sourceHash',repeat('a',64),'scopeHash',repeat('c',64),'allIncludedScopesClosed',true,'periodStart','2020-01-01','periodEnd','2020-02-01');end$$;
      create function gridex_ediel_retention.invoice_file_receipt_v1(d gridex_ediel_retention.invoice_file_decisions) returns jsonb language plpgsql as $$begin perform fixture.boundary('invoice_receipt',d.id);return jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day','periodStart','2020-01-01','periodEnd','2020-02-01');end$$;
      create function gridex_ediel_retention.invoice_file_shared_scope_v1(bucket text,path text) returns setof gridex_ediel_retention.invoice_file_sources language plpgsql as $$begin
        perform fixture.boundary('invoice_scope');return query select * from gridex_ediel_retention.invoice_file_sources s where s.storage_bucket=$1 and s.storage_path=$2;end$$;
      create function fixture.event_boundary() returns trigger language plpgsql as $$begin
        perform fixture.boundary(case TG_TABLE_NAME when 'blob_events' then 'blob_event' when 'record_events' then 'contract_event' else 'invoice_event' end,
          case when TG_TABLE_NAME='invoice_file_events' then (to_jsonb(new)->>'source_id')::uuid else (to_jsonb(new)->>'target_id')::uuid end);return new;end$$;
      create trigger fixture_blob_event after insert on gridex_ediel_retention.blob_events for each row execute function fixture.event_boundary();
      create trigger fixture_record_event after insert on gridex_ediel_retention.record_events for each row execute function fixture.event_boundary();
      create trigger fixture_invoice_event after insert on gridex_ediel_retention.invoice_file_events for each row execute function fixture.event_boundary();`)
    for (const name of ['public.ediel_retention_lock_auth_actor_v1', 'public.ediel_retention_session_actor_v1', 'gridex_ediel_retention.actor_v1', 'gridex_ediel_retention.class_permission_v1', 'gridex_ediel_retention.record_actor_v1', 'gridex_ediel_retention.invoice_file_actor_v1', 'gridex_ediel_retention.blob_current_v1', 'gridex_ediel_retention.record_current_review_v1', 'gridex_ediel_retention.invoice_file_current_v1', ...routines]) await db.exec(definition(schema, name))
    await db.exec('grant usage,create on schema public,gridex_ediel_retention to gridex_ediel_retention_owner;grant usage on schema auth,storage,fixture to gridex_ediel_retention_owner;grant all on all tables in schema public,auth,storage,fixture,gridex_ediel_retention to gridex_ediel_retention_owner;')
    for (const name of routines) await db.exec(`alter function ${name}() owner to gridex_ediel_retention_owner;revoke all on function ${name}() from public,anon,authenticated,service_role;`)
    for (const file of ['20261001012305_ediel_customer_record_class_retention.sql', '20261001000700_ediel_message_content_and_mime_retention.sql', '20261001071000_ediel_invoice_file_copy_class_retention.sql']) {
      const trigger = readFileSync('supabase/migrations/' + file, 'utf8').match(/^CREATE TRIGGER \w+ BEFORE INSERT OR UPDATE OR DELETE ON storage\.objects[^;]+;/m)
      if (!trigger) throw new Error('Actual storage trigger missing: ' + file)
      await db.exec(trigger[0])
    }
  }, 30_000)
  beforeEach(async () => {
    await db.exec('begin')
    const before = await profiles()
    const preflight = taggedBlock('retention_storage_body_preflight');if (preflight) await db.exec(preflight)
    const profileSnapshot = forward.match(/^CREATE TEMPORARY TABLE gridex_retention_storage_function_scope[\s\S]*?;\n/m)?.[0]
    if (profileSnapshot) await db.exec(profileSnapshot)
    for (const name of routines) { const replacement = definition(forward, name, true);if (replacement) await db.exec(replacement) }
    const preserved = taggedBlock('retention_storage_profiles_preserved');if (preserved) await db.exec(preserved)
    expect(await profiles()).toEqual(before)
    await mode('valid')
    await db.exec(`insert into public.companies values('${company}','archived'),('${otherCompany}','archived');
      insert into auth.users(id) values('${executor}'),('${reviewer}'),('${otherReviewer}');
      insert into public.user_profiles select id,'active' from auth.users;
      insert into public.company_memberships select c.id,u.id,'active',true,clock_timestamp() from public.companies c cross join auth.users u;
      insert into fixture.authority select c.id,u.id,p,true from public.companies c cross join auth.users u cross join unnest(array['ediel.retention.purge','ediel.retention.review','ediel.retention.mime_bytes','ediel.retention.contract_pdf','ediel.retention.invoice_copy_evidence']) p;
      insert into gridex_ediel_retention.blob_decisions(id,company_id,retention_class,target_id,message_id,source_hash,target_hash,document_bytes,document_hash,submitted_by)
        values('${blob}','${company}','transport_raw_mime_bytes','${blob}','${blob}',repeat('a',64),repeat('b',64),'x',encode(sha256('x'::bytea),'hex'),'${submitter}');
      insert into gridex_ediel_retention.blob_reviews(id,decision_id,actor_user_id,outcome,reason) values('${blob}','${blob}','${reviewer}','approved','component only');
      insert into gridex_ediel_retention.record_decisions(id,company_id,retention_class,target_id,customer_id,source_hash,target_hash,document_bytes,document_hash,submitted_by)
        values('${contract}','${company}','contract_signed_pdf_bytes','${contract}','${contract}',repeat('a',64),repeat('b',64),'x',encode(sha256('x'::bytea),'hex'),'${submitter}');
      insert into gridex_ediel_retention.record_reviews(id,decision_id,actor_user_id,outcome,reason) values('${contract}','${contract}','${reviewer}','approved','component only');
      insert into gridex_ediel_retention.invoice_file_decisions(id,company_id,retention_class,target_id,source_id,source_hash,target_hash,scope_hash,document_bytes,document_hash,submitted_by)
        values('${first}','${company}','customer_invoice_pdf_bytes','${first}','${first}',repeat('a',64),repeat('b',64),repeat('c',64),'x',encode(sha256('x'::bytea),'hex'),'${submitter}'),
        ('${second}','${otherCompany}','customer_invoice_pdf_bytes','${second}','${second}',repeat('a',64),repeat('b',64),repeat('c',64),'x',encode(sha256('x'::bytea),'hex'),'${submitter}');
      insert into gridex_ediel_retention.invoice_file_reviews(id,decision_id,actor_user_id,outcome,reason) values('${first}','${first}','${reviewer}','approved','component only'),('${second}','${second}','${otherReviewer}','approved','component only');`)
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('preserves the actual three-trigger order and private trigger-function ACLs', async () => {
    expect((await db.query<{ tgname: string }>("select tgname from pg_trigger where tgrelid='storage.objects'::regclass order by tgname")).rows.map(r => r.tgname))
      .toEqual(['contract_retention_storage_guard', 'ediel_retention_storage_guard', 'invoice_file_retention_storage_guard'])
    for (const name of routines) for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, name + '()'])).rows[0].allowed).toBe(false)
    }
  })
  it.each(['blob', 'contract'] as const)('deletes an authorized %s object and records its authorization', async kind => {
    const bucket = await capture(kind);await remove(bucket)
    expect((await db.query('select * from storage.objects')).rows).toEqual([])
    expect((await db.query(`select kind from gridex_ediel_retention.${kind === 'blob' ? 'blob' : 'record'}_events`)).rows).toEqual([{ kind: 'storage_delete_authorized' }])
  })
  it('deletes two shared invoice copies only with both company-specific authorities', async () => {
    await invoiceCopies();await remove('billing-exports')
    expect((await db.query('select * from storage.objects')).rows).toEqual([])
    expect((await db.query('select source_id from gridex_ediel_retention.invoice_file_events order by source_id')).rows).toEqual([{ source_id: first }, { source_id: second }])
  })
  it.each(['blob_basis_executor', 'blob_basis_class', 'blob_basis_reviewer', 'blob_basis_reviewer_class', 'blob_event_executor', 'blob_event_class', 'blob_event_reviewer', 'blob_event_reviewer_class'])('rolls back MIME DELETE and events after %s', async selected => {
    const bucket = await capture('blob');await denied(bucket, selected)
  })
  it.each(['contract_basis_executor', 'contract_basis_class', 'contract_basis_reviewer', 'contract_basis_reviewer_class', 'contract_event_executor', 'contract_event_class', 'contract_event_reviewer', 'contract_event_reviewer_class'])('rolls back contract DELETE and events after %s', async selected => {
    const bucket = await capture('contract');await denied(bucket, selected)
  })
  it.each(['contract_after_scope_executor', 'contract_after_scope_class', 'contract_after_scope_reviewer', 'contract_after_scope_reviewer_class'])('the later invoice guard rejects %s even with no invoice copies', async selected => {
    const bucket = await capture('contract');await denied(bucket, selected)
  })
  it.each(['invoice_receipt_executor', 'invoice_receipt_class', 'invoice_receipt_reviewer', 'invoice_receipt_reviewer_class', 'invoice_event_executor', 'invoice_event_class', 'invoice_event_reviewer', 'invoice_event_reviewer_class', 'second_event_first_reviewer', 'second_event_first_executor', 'second_final_receipt_first_reviewer', 'second_final_receipt_first_reviewer_class'])('rolls back every shared-copy DELETE and event after %s', async selected => {
    await invoiceCopies();await denied('billing-exports', selected)
  })
  it('composes contract and invoice custody for the same actual storage row', async () => {
    const bucket = await capture('contract');await invoiceCopies(bucket);await remove(bucket)
    expect((await db.query('select * from storage.objects')).rows).toEqual([])
    expect((await db.query<{ n: number }>('select count(*)::int n from gridex_ediel_retention.invoice_file_events')).rows[0].n).toBe(2)
  })
  it.each(['blob', 'contract'] as const)('retains %s INSERT/UPDATE immutability and requires current review for an existing object', async kind => {
    const bucket = await capture(kind)
    const before = await snapshot()
    await db.exec('savepoint immutable_object')
    await expect(db.query('update storage.objects set name=$1 where bucket_id=$2', [path + '.changed', bucket])).rejects.toBeDefined()
    await db.exec('rollback to savepoint immutable_object')
    await expect(db.query('insert into storage.objects values($1,$2)', [bucket, path])).rejects.toBeDefined()
    await db.exec('rollback to savepoint immutable_object;release savepoint immutable_object')
    await db.query('update fixture.authority set allowed=false where actor=$1 and permission=$2', [reviewer, 'ediel.retention.review'])
    await denied(bucket, 'valid');expect(await snapshot()).toEqual(before)
  })
  it('does not invent custody for unrelated buckets or require an actor for an unrelated object', async () => {
    await db.exec("insert into storage.objects values('unrelated','synthetic/retained.pdf')")
    await db.exec('update fixture.authority set allowed=false');await remove('unrelated')
    expect((await db.query('select * from storage.objects')).rows).toEqual([])
  })
  it.each(['blob', 'contract'] as const)('binds the %s review selected before basis rather than accepting a later replacement', async kind => {
    const bucket = await capture(kind);await denied(bucket, kind + '_basis_replace_review')
  })
  it.each(['blob', 'contract'] as const)('preserves an already-current %s review newer than the original tombstone review', async kind => {
    const bucket = await capture(kind)
    await db.query(`insert into gridex_ediel_retention.${kind === 'blob' ? 'blob' : 'record'}_reviews(id,decision_id,actor_user_id,outcome,reason)
      values('a0000000-0000-4000-8000-00000000000a',$1,$2,'approved','new current review before DELETE')`, [kind === 'blob' ? blob : contract, reviewer])
    await remove(bucket);expect((await db.query('select * from storage.objects')).rows).toEqual([])
  })
  it('keeps missing native tombstone and invoice immutability barriers', async () => {
    await invoiceCopies()
    await db.exec('savepoint immutable_invoice')
    await expect(db.query('update storage.objects set name=$1 where bucket_id=$2', [path + '.changed', 'billing-exports'])).rejects.toBeDefined()
    await db.exec('rollback to savepoint immutable_invoice;release savepoint immutable_invoice')
    await db.query('delete from gridex_ediel_retention.invoice_file_tombstones where source_id=$1', [first])
    await denied('billing-exports', 'valid')
  })
  it('still holds uncaptured native MIME and referenced contract objects', async () => {
    await db.exec("insert into storage.objects values('ediel-files','transport/uncaptured.eml'),('customer-contract-documents','synthetic/retained.pdf')")
    await db.query('insert into public.customer_contract_documents values($1,$2)', ['customer-contract-documents', path])
    await denied('customer-contract-documents', 'valid')
    await db.exec('savepoint missing_mime')
    await expect(db.exec("delete from storage.objects where name='transport/uncaptured.eml'")).rejects.toMatchObject({ message: 'ediel_storage_native_class_purge_required' })
    await db.exec('rollback to savepoint missing_mime')
  })
  it.each(['body', 'ACL', 'owner', 'search_path'] as const)('fails closed instead of repairing unexpected %s metadata', async drift => {
    const preflight = taggedBlock('retention_storage_body_preflight');expect(preflight).not.toBe('')
    for (const name of routines) await db.exec(definition(schema, name).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    await db.exec(preflight)
    const signature = routines[0] + '()'
    if (drift === 'body') await db.exec(definition(schema, routines[0]).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('END$$;', () => '-- changed\nEND$$;'))
    else if (drift === 'ACL') await db.exec(`grant execute on function ${signature} to anon`)
    else if (drift === 'owner') await db.exec(`alter function ${signature} owner to postgres`)
    else await db.exec(`alter function ${signature} set search_path=public`)
    const changed = await profiles();await db.exec('savepoint refused_metadata')
    await expect(db.exec(preflight)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint refused_metadata');expect(await profiles()).toEqual(changed)
  })
  it.each(['disabled', 'renamed'] as const)('refuses an unexpected %s trigger profile', async drift => {
    const preflight = taggedBlock('retention_storage_body_preflight');expect(preflight).not.toBe('')
    for (const name of routines) await db.exec(definition(schema, name).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    await db.exec(preflight)
    if (drift === 'disabled') await db.exec('alter table storage.objects disable trigger invoice_file_retention_storage_guard')
    else await db.exec('alter trigger invoice_file_retention_storage_guard on storage.objects rename to earlier_invoice_guard')
    await db.exec('savepoint refused_trigger');await expect(db.exec(preflight)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint refused_trigger')
  })
})
