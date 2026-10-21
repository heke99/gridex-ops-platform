import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Hermetic SQL component: real historical functions and actual forward blocks.
// No mutable GEN/schema export, sibling worktree, Git, network or provider port.
// This does not prove the non-superuser owner envelope, whole replay, native
// concurrency, issuer/legal authority or actual production installation.
const migration = 'supabase/migrations/20261020184122_audit19_legacy_trigger_consumers_contract.sql'
const forward = existsSync(migration) ? readFileSync(migration, 'utf8') : ''
const historical = (name: string) => readFileSync('supabase/migrations/' + name, 'utf8')
const donor = historical('20261019180400_db05_qualified_audit19_cleanup.sql')
const oldCritical = historical('20260522_batch4e_switch_pdf_audit_rbac_completion.sql')
const oldCriticalTables = historical('20260520_batch_5_final_quality_handbook_alignment.sql')
const tenantDonor = historical('20260815233411_tenant_website_installation_completion_trigger_v1.sql')
const helper = 'gridex_ediel_retention.audit19_source_contract_v1(text)'
const tenant = 'private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()'
const critical = 'public.gridex_audit_critical_row_change()'
const beforeHash = '53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a'
const tenantHash = '38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180'
const criticalHash = 'c83228b7722adb500cb341597f174afeaf88e97cc5511acaf2e190a8c8ec812c'
const writer = 'public.ediel_review_decision_evidence_retention_v1'
const action = 'ediel.retention.decision_original_reviewed'
let db: PGlite

function definition(sql: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\(`, 'i').exec(sql)
  if (!start) throw new Error('Missing immutable function ' + name)
  const rest = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(rest)
  if (!delimiter) throw new Error('Missing function delimiter')
  const end = rest.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  return rest.slice(0, end + delimiter[1].length + 1)
}
function body(sql: string) {
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(sql)!
  const start = delimiter.index + delimiter[0].length
  return sql.slice(start, sql.indexOf(delimiter[1] + ';', start))
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const originalHelper = definition(donor, helper.split('(')[0])
// Immutable 804 ->865 ->11 source derivation, independently pinned to53726.
// The two literal additions below are the frozen11 change; no future migration
// file or generated schema is read to construct this predecessor fixture.
const predecessor = originalHelper
  .replace('"public.ediel_begin_blob_purge_v1":"e5b9584f96b87d8d7aa932e69a884f727dfcbdade3e0902451a341bcec230378"',
    '"public.ediel_begin_blob_purge_v1":"b5ac467ecbfd8f5565ed174d0050d28aa730e8c5f1183d525b8584a72b4fe711"')
  .replace('}$contracts$::jsonb;', ',"public.gridex_create_customer_support_case_v1":"b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d"}$contracts$::jsonb;')
  .replace('}$signatures$::jsonb;', ',"public.gridex_create_customer_support_case_v1":"public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)"}$signatures$::jsonb;')
const tenantDefinition = definition(tenantDonor, tenant.split('(')[0])
const criticalDefinition = definition(oldCritical, critical.split('(')[0])
const writerDefinition = definition(historical('20261001064500_ediel_retention_decision_original_class_workflows.sql'), writer)
  .replace('BEGIN', 'BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();')
const criticalTables = [...new Set([oldCriticalTables, oldCritical].flatMap(sql =>
  [.../foreach t in array array\[([\s\S]*?)\]\s*loop/i.exec(sql)![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])))].sort()
function block(tag: string) {
  const start = forward.indexOf(`DO $${tag}$`)
  if (start < 0) return '' // Real predecessor rejection supplies meaningful RED.
  const end = forward.indexOf(`$${tag}$;`, start + tag.length + 5)
  return forward.slice(start, end + tag.length + 3)
}
function map(s: string, tag: string): Record<string, string> {
  return JSON.parse(s.split('$' + tag + '$')[1]) as Record<string, string>
}
const stripMaps = (s: string) => s.replace(/\$contracts\$[\s\S]*?\$contracts\$/, '<HASH_MAP>')
  .replace(/\$signatures\$[\s\S]*?\$signatures\$/, '<SIGNATURE_MAP>')
async function source(signature: string) {
  return (await db.query<{ prosrc: string }>('select prosrc from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosrc
}
async function profiles() {
  return (await db.query(`select jsonb_agg(case when p.oid=to_regprocedure($1) then to_jsonb(p)-'prosrc' else to_jsonb(p) end order by p.oid) as profiles
    from pg_proc p where p.oid=any(array[to_regprocedure($1)::oid,to_regprocedure($2)::oid,to_regprocedure($3)::oid])`, [helper, tenant, critical])).rows
}
async function triggers() {
  return (await db.query(`select jsonb_agg(to_jsonb(t) order by t.oid) as profiles from pg_trigger t
    where t.tgfoid=any(array[to_regprocedure($1)::oid,to_regprocedure($2)::oid])`, [tenant, critical])).rows
}
async function qualify(selectedAction = action) {
  return (await db.query<{ result: Record<string, string> }>(`select gridex_ediel_retention.audit19_source_contract_v1($1) as result`, [selectedAction])).rows[0].result
}
async function apply(check = true) {
  await db.exec(block('audit19_legacy_preflight'))
  const snapshot = /CREATE TEMPORARY TABLE gridex_audit19_legacy_function_scope\b[\s\S]*?;/.exec(forward)
  await db.exec(snapshot?.[0] ?? '')
  await db.exec(block('audit19_legacy_consumer_slots'))
  if (check) await db.exec(block('audit19_legacy_profiles_preserved'))
}
async function rejectedApply() {
  const old = await source(helper), oldProfiles = await profiles(), oldTriggers = await triggers()
  await db.exec('savepoint failed_install')
  let caught: { code?: string; message?: string } | undefined
  try { await apply() } catch (error) {
    caught = error as typeof caught
    await db.exec('rollback to savepoint failed_install')
  }
  await db.exec('release savepoint failed_install')
  expect(caught).toMatchObject({ code: '42501' })
  expect(caught?.message).toMatch(/audit19_legacy/)
  expect(await source(helper)).toBe(old)
  expect(await profiles()).toEqual(oldProfiles)
  expect(await triggers()).toEqual(oldTriggers)
}
async function appendBody(signature: string) {
  const old = await source(signature)
  const ddl = (await db.query<{ ddl: string }>('select pg_get_functiondef($1::regprocedure) as ddl', [signature])).rows[0].ddl
  await db.exec(ddl.replace(old, old + '\n-- changed source\n'))
}

describe('audit19 qualifies only the two known legacy trigger consumers', () => {
  beforeAll(async () => {
    expect(hash(body(originalHelper))).toBe('3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b')
    expect(hash(body(predecessor))).toBe(beforeHash)
    expect(hash(body(tenantDefinition))).toBe(tenantHash)
    expect(hash(body(criticalDefinition))).toBe(criticalHash)
    expect(hash(body(writerDefinition))).toBe('9eea7976474ff7e16d1e022787eedce025d0b7a5617237860d82ac6bd502b5c5')
    expect(criticalTables).toHaveLength(40)
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create role gridex_ediel_retention_owner nologin noinherit bypassrls;
      create schema gridex_ediel_retention authorization gridex_ediel_retention_owner;
      create schema private;create schema auth;create schema extensions;
      grant usage on schema private to service_role;
      revoke create on schema public from public;
      create table public.audit_logs(id uuid default gen_random_uuid(),company_id uuid,actor_user_id uuid,
        entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb default '{}',
        created_at timestamptz default now(),updated_at timestamptz default now(),actor_type text,
        system_actor text,request_id text,correlation_id text,resource_type text,resource_id text,previous_status text,new_status text);
      create table gridex_ediel_retention.audit19_approvals_v1(company_id uuid,target_audit_id uuid,
        source_commitment text,receipt jsonb,receipt_hash text,reviewer_user_id uuid,approved_at timestamptz,
        execution_actor_id uuid,expires_at timestamptz);
      create table gridex_ediel_retention.decision_evidence_policies(id uuid);
      create table public.tenant_website_installation_receipts(id uuid);
      create table public.integration_api_clients(id uuid,company_id uuid,profile_key text,status text,
        deleted_at timestamptz,revoked_at timestamptz,launch_ready boolean,launch_blockers jsonb,metadata jsonb);
      alter table public.integration_api_clients enable row level security;`)
    // Small selected table ports; the actual tenant completion path is not
    // invoked. The actual critical trigger and normalizer are invoked below.
    for (const name of criticalTables) await db.exec(`create table public.${name}(id uuid default gen_random_uuid(),company_id uuid,marker integer,status text);alter table public.${name} enable row level security`)
    await db.exec(definition(historical('20260727040000_contract_security_energy_direction_api_completion.sql'), 'public.gridex_normalize_audit_context_v1'))
    await db.exec(definition(historical('20261005130000_hard_delete_guard_companies_customers.sql'), 'public.gridex_guard_history_truncate_v1'))
    await db.exec(definition(donor, 'gridex_ediel_retention.audit19_guard_v1'))
    await db.exec(writerDefinition)
    await db.exec(predecessor)
    await db.exec(tenantDefinition)
    await db.exec(criticalDefinition)
    await db.exec(`alter function ${helper} owner to gridex_ediel_retention_owner;
      revoke all on function ${helper} from public,anon,authenticated,service_role;
      revoke all on function ${tenant} from public,anon,authenticated,service_role;
      revoke all on function ${critical} from public,anon,authenticated,service_role;
      grant execute on function ${critical} to service_role;
      alter function ${critical} set search_path=public,auth,extensions;
      create trigger audit_logs_normalize_context_v1 before insert or update on public.audit_logs
        for each row execute function public.gridex_normalize_audit_context_v1();
      create trigger gridex_history_truncate_guard before truncate on public.audit_logs
        for each statement execute function public.gridex_guard_history_truncate_v1();
      create trigger audit19_owner_delete_guard_v1 before delete on public.audit_logs
        for each row execute function gridex_ediel_retention.audit19_guard_v1();
      create trigger audit19_a9_guard_v1 before insert or update or delete on gridex_ediel_retention.audit19_approvals_v1
        for each row execute function gridex_ediel_retention.audit19_guard_v1();`)
    const tenantTrigger = /create trigger integration_api_clients_tenant_website_receipt_completion[\s\S]*?execute function [^;]+;/i.exec(tenantDonor)![0]
    await db.exec(tenantTrigger)
    for (const name of criticalTables) await db.exec(`create trigger gridex_audit_${name} after insert or update or delete on public.${name} for each row execute function public.gridex_audit_critical_row_change()`)
  }, 30_000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('the real predecessor rejects the actual legacy consumers', async () => {
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('qualifies the exact known legacy consumers with the original writer result', async () => {
    await apply()
    expect(await qualify()).toEqual({ sourceVersion: '7f7d827987896f949f35b9da5801a79fbc1bceb6', writerFunction: writer, writerBodyHash: '9eea7976474ff7e16d1e022787eedce025d0b7a5617237860d82ac6bd502b5c5' })
  })
  it.each([[false, false], [false, true], [true, false], [true, true]])('qualifies independent optional absence tenant=%s critical=%s', async (tenantPresent, criticalPresent) => {
    if (!tenantPresent) await db.exec(`drop function ${tenant} cascade`)
    if (!criticalPresent) await db.exec(`drop function ${critical} cascade`)
    await apply()
    expect((await qualify()).writerFunction).toBe(writer)
  })
  it('adds exactly two entries to both maps and preserves all other helper bytes', async () => {
    await apply()
    const after = await source(helper)
    expect(stripMaps(after)).toBe(stripMaps(body(predecessor)))
    for (const tag of ['contracts', 'signatures']) {
      const old = map(body(predecessor), tag), current = map(after, tag)
      expect(Object.keys(old)).toHaveLength(92)
      expect(Object.keys(current)).toHaveLength(94)
      expect(current[tenant.split('(')[0]]).toBe(tag === 'contracts' ? tenantHash : tenant)
      expect(current[critical.split('(')[0]]).toBe(tag === 'contracts' ? criticalHash : critical)
      delete current[tenant.split('(')[0]];delete current[critical.split('(')[0]]
      expect(current).toEqual(old)
    }
    expect(after.match(/to_regprocedure\('/g)).toHaveLength(16)
  })
  it('preserves all three OIDs and metadata, both legacy bodies and all41 triggers', async () => {
    const oldProfiles = await profiles(), oldTriggers = await triggers()
    await apply()
    expect(await profiles()).toEqual(oldProfiles)
    expect(await triggers()).toEqual(oldTriggers)
    expect(hash(await source(tenant))).toBe(tenantHash)
    expect(hash(await source(critical))).toBe(criticalHash)
  })
  it('preserves ordinary actual critical audit INSERT and normalization', async () => {
    await apply()
    await db.exec('insert into public.customers(marker) values(7)')
    const result = await db.query<{ action: string; actor_type: string; resource_type: string; new_values: { marker: number } }>('select action,actor_type,resource_type,new_values from public.audit_logs')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ action: 'customers_insert', actor_type: 'system', resource_type: 'customers', new_values: { marker: 7 } })
  })
  it.each(['tenant_website.installation_completed', 'customers_insert'])('never admits legacy action %s for retirement', async selected => {
    await apply()
    await expect(qualify(selected)).rejects.toMatchObject({ code: '42501', message: 'audit19_supported_source_contract_required' })
  })
  it.each([helper, tenant, critical])('rejects unknown body %s atomically', async signature => {
    await appendBody(signature);await rejectedApply()
  })
  it('rejects the old804 helper rather than rebasing an unqualified predecessor', async () => {
    await db.exec(originalHelper.replace(/CREATE FUNCTION/i, 'CREATE OR REPLACE FUNCTION'));await rejectedApply()
  })
  it.each([tenant, critical])('rejects extra overload of %s', async signature => {
    await db.exec(`create function ${signature.replace('()', '(text)')} returns jsonb language sql as $$select '{}'::jsonb$$`)
    await rejectedApply()
  })
  it.each([tenant, critical])('rejects a legacy named trigger footprint when its consumer %s is absent', async signature => {
    await db.exec(`drop function ${signature} cascade`)
    const relation = signature === tenant ? 'integration_api_clients' : 'customers'
    const name = signature === tenant ? 'integration_api_clients_tenant_website_receipt_completion' : 'gridex_audit_customers'
    await db.exec(`create trigger ${name} after update on public.${relation} for each row execute function public.gridex_normalize_audit_context_v1()`)
    await rejectedApply()
  })
  it.each([tenant, critical])('rejects wrong header and privilege variants of %s', async signature => {
    const mutations = [
      `alter function ${signature} security invoker`, `alter function ${signature} set search_path=pg_catalog`,
      `alter function ${signature} owner to service_role`, `alter function ${signature} immutable`,
      `alter function ${signature} strict`, `alter function ${signature} cost 101`,
      `grant execute on function ${signature} to public`, `grant execute on function ${signature} to authenticated`,
      signature === tenant ? `grant execute on function ${signature} to service_role` : `revoke execute on function ${signature} from service_role`,
    ]
    for (const mutation of mutations) {
      await db.exec('savepoint header_variant');await db.exec(mutation);await rejectedApply()
      await db.exec('rollback to savepoint header_variant;release savepoint header_variant')
    }
  })
  it.each([
    `alter function ${helper} security definer`, `alter function ${helper} set search_path=public`,
    `alter function ${helper} owner to postgres`, `grant execute on function ${helper} to public`,
    `grant execute on function ${helper} to authenticated`, `grant execute on function ${helper} to service_role`,
    `grant execute on function ${critical} to service_role with grant option`,
  ])('rejects a changed prerequisite or grant option: %s', async mutation => {
    await db.exec(mutation);await rejectedApply()
  })
  it.each([
    'grant usage on schema private to authenticated', 'grant create on schema private to service_role',
    'grant create on schema public to authenticated',
  ])('rejects changed namespace authority: %s', async mutation => {
    await db.exec(mutation);await rejectedApply()
  })
  it.each(['disabled', 'missing', 'extra', 'WHEN', 'arguments', 'columns', 'timing'])('rejects critical trigger drift %s', async variant => {
    const table = 'public.customers', name = 'gridex_audit_customers'
    if (variant === 'disabled') await db.exec(`alter table ${table} disable trigger ${name}`)
    else if (variant === 'extra') await db.exec(`create trigger fixture_extra after insert on ${table} for each row execute function ${critical}`)
    else {
      await db.exec(`drop trigger ${name} on ${table}`)
      if (variant !== 'missing') await db.exec(`create trigger ${name} ${variant === 'timing' ? 'before' : 'after'} ${variant === 'columns' ? 'update of marker' : 'insert or update or delete'} on ${table} for each row ${variant === 'WHEN' ? 'when(true)' : ''} execute function public.gridex_audit_critical_row_change(${variant === 'arguments' ? "'extra'" : ''})`)
    }
    await rejectedApply()
  })
  it.each(['disabled', 'missing', 'extra', 'WHEN', 'columns'])('rejects tenant trigger drift %s', async variant => {
    const table = 'public.integration_api_clients', name = 'integration_api_clients_tenant_website_receipt_completion'
    if (variant === 'disabled') await db.exec(`alter table ${table} disable trigger ${name}`)
    else if (variant === 'extra') await db.exec(`create trigger fixture_extra after update on ${table} for each row execute function ${tenant}`)
    else {
      await db.exec(`drop trigger ${name} on ${table}`)
      if (variant !== 'missing') await db.exec(`create trigger ${name} after update ${variant === 'columns' ? 'of status' : 'of launch_ready,launch_blockers,metadata,status'} on ${table} for each row ${variant === 'WHEN' ? '' : "when(new.profile_key='tenant_website' and new.status='active' and new.launch_ready is true)"} execute function ${tenant}`)
    }
    await rejectedApply()
  })
  it('rolls back the replacement after a late preservation failure', async () => {
    const old = await source(helper), oldProfiles = await profiles()
    await db.exec('savepoint late_failure');await apply(false)
    expect(await source(helper)).not.toBe(old)
    await db.exec(`grant execute on function ${tenant} to authenticated`)
    await expect(db.exec(block('audit19_legacy_profiles_preserved'))).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint late_failure;release savepoint late_failure')
    expect(await source(helper)).toBe(old);expect(await profiles()).toEqual(oldProfiles)
  })
  it('still rejects newly unknown semantic consumers', async () => {
    await apply();await db.exec(`create function public.fixture_unknown_consumer() returns bigint language sql as $$select count(*) from public.audit_logs$$`)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('still rejects changed legacy bodies after installation', async () => {
    await apply();await appendBody(critical)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('still rejects incoming audit foreign keys', async () => {
    await apply();await db.exec('alter table public.audit_logs add primary key(id);create table public.fixture_fk(id uuid references public.audit_logs(id))')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_incoming_FK_unsupported' })
  })
  it('still rejects an incoming audit composite column', async () => {
    await apply();await db.exec('create table public.fixture_composite(a public.audit_logs)')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_incoming_composite_unsupported' })
  })
  it('still rejects an additional audit trigger', async () => {
    await apply();await db.exec('create trigger fixture_extra before insert on public.audit_logs for each row execute function public.gridex_normalize_audit_context_v1()')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_trigger_unsupported' })
  })
  it('retains the existing finite owner envelope with no public CREATE and includes private namespace restoration', () => {
    function section(sql: string, name: string) {
      const start = sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_BEGIN`)
      return sql.slice(start, sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_END`, start))
    }
    for (const name of ['SCOPE', 'RESTORE']) {
      const expected = section(donor, name).replaceAll('gridex_db05_install_scope', 'gridex_audit19_legacy_install_scope')
        .replaceAll("IN('public','gridex_ediel_retention')", "IN('public','private','gridex_ediel_retention')")
        .replace(" IF NOT has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') THEN GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;END IF;", ' -- No new public-function owner transfer; no temporary public CREATE.')
        .replace(' IF NOT before_row.owner_public_create THEN REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;END IF;', ' -- No temporary public CREATE was introduced.')
      expect(section(forward, name)).toBe(expected)
    }
    expect(forward.trim()).toMatch(/^--[\s\S]*\nBEGIN;/)
    expect(forward.trim()).toMatch(/COMMIT;$/)
    expect(forward).not.toMatch(/(?:UPDATE|LOCK\s+TABLE)\s+(?:pg_catalog\.)?pg_proc\b/i)
  })
})
