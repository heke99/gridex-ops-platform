import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual source-contract/trigger bodies run over selected actual DDL. This is a
// hermetic component test, not full-union replay, non-superuser owner-envelope,
// native concurrency, legal authority, or production installation evidence.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020180847_audit19_customer_support_consumer_contract.sql', 'utf8')
const ownerDonor = readFileSync('supabase/migrations/20261019180400_db05_qualified_audit19_cleanup.sql', 'utf8')
const helper = 'gridex_ediel_retention.audit19_source_contract_v1(text)'
const consumerName = 'public.gridex_create_customer_support_case_v1'
const consumer = consumerName + '(uuid,uuid,uuid,uuid,text,text,text,text)'
const helperBeforeHash = 'eb61a02ed9353d68bf7e4048a70c746a0cd97bd6fdbdfd7c12b98a553ed78a3d'
const helperAfterHash = '53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a'
const consumerHash = 'b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d'
const action = 'ediel.retention.decision_original_reviewed'
const writer = 'public.ediel_review_decision_evidence_retention_v1'
const writerHash = '9eea7976474ff7e16d1e022787eedce025d0b7a5617237860d82ac6bd502b5c5'
const oldBlobSlot = '"public.ediel_begin_blob_purge_v1":"e5b9584f96b87d8d7aa932e69a884f727dfcbdade3e0902451a341bcec230378"'
const newBlobSlot = '"public.ediel_begin_blob_purge_v1":"b5ac467ecbfd8f5565ed174d0050d28aa730e8c5f1183d525b8584a72b4fe711"'

// CAPTURED_SUPPORT_DEFINITION: inserted below from immutable PR867 head
// d6ccedc8e747441606bc157aa471c1c166067b8e, forward SHA256
// 6de2dca407e9fe7e9276ec485ab3e98056f1dffd6bd17d5356affd93d2ee2d45.
// Clean fd4 main predates that additive forward. This declared fixture pins its
// actual function bytes; no sibling worktree, Git, network, or generated export
// is used by the test. The case command itself is not invoked in this fixture.
const capturedSupportDefinition = "create function public.gridex_create_customer_support_case_v1(\n  p_company_id uuid, p_customer_id uuid, p_api_client_id uuid, p_portal_identity_id uuid,\n  p_title text, p_message text, p_category text, p_idempotency_key text\n) returns jsonb\nlanguage plpgsql security definer\nset search_path = pg_catalog\nset lock_timeout = '2s'\nset statement_timeout = '5s'\nas $$\ndeclare\n  v_case public.customer_cases%rowtype;\n  v_case_id uuid;\n  v_now timestamptz;\n  v_reused boolean;\n  v_reference text;\n  v_category text := coalesce(nullif(btrim(p_category), ''), 'support');\n  v_next_action text := 'Supportärendet ska triageras inom tenantens ordinarie ärendeflöde.';\n  v_assessment jsonb;\n  v_payload jsonb;\n  v_count integer;\nbegin\n  if p_company_id is null or p_customer_id is null or p_api_client_id is null\n    or p_title is null or length(btrim(p_title)) not between 1 and 180\n    or p_message is null or length(btrim(p_message)) not between 1 and 8000\n    or length(v_category) > 120 or p_idempotency_key is null\n    or length(btrim(p_idempotency_key)) not between 1 and 200 then\n    raise exception 'support_customer_command_invalid' using errcode = '22023';\n  end if;\n  perform 1 from public.customers where id = p_customer_id and company_id = p_company_id\n    and merged_into_customer_id is null for key share;\n  if not found then raise exception 'support_customer_not_found' using errcode = 'P0002'; end if;\n  insert into gridex_private.customer_support_quota_guards(company_id, customer_id)\n    values (p_company_id, p_customer_id)\n    on conflict (company_id, customer_id) do update\n      set revision = gridex_private.customer_support_quota_guards.revision + 1;\n  v_now := clock_timestamp();\n\n  -- Same-key replay precedes quota; neither another case nor another audit is\n  -- charged. The old unique support key remains the physical dedupe boundary.\n  select * into v_case from public.customer_cases\n    where company_id = p_company_id and customer_id = p_customer_id\n      and metadata->>'support_idempotency_key' = btrim(p_idempotency_key) for update;\n  v_reused := found;\n  if v_reused then\n    if v_case.source is distinct from 'tenant_support_customer_portal'\n      or v_case.case_type <> 'other' or v_case.metadata->>'support_case' is distinct from 'true'\n      or v_case.metadata->>'opened_by' is distinct from 'customer'\n      or v_case.metadata->>'description_visibility' is distinct from 'customer'\n      or v_case.billing_blocked or v_case.billing_manual_review or v_case.cancellation_required then\n      raise exception 'support_case_replay_scope_mismatch' using errcode = '23505';\n    end if;\n  else\n    select count(*) into v_count from (\n      select 1 from public.customer_cases\n        where company_id = p_company_id and customer_id = p_customer_id\n          and metadata->>'support_case' = 'true' and metadata->>'opened_by' = 'customer'\n          and created_at >= v_now - interval '24 hours' limit 50\n    ) recent;\n    if v_count >= 50 then raise exception 'support_case_quota_exceeded' using errcode = 'P0001'; end if;\n    v_case_id := gen_random_uuid();\n    v_assessment := jsonb_build_object('isWithdrawal', false, 'withdrawalDeadlineAt', null,\n      'withdrawalPossible', false, 'switchCanBeStopped', false, 'cancellationRequired', false,\n      'cancellationStatus', 'not_required', 'scenario', 'not_withdrawal', 'nextAction', v_next_action,\n      'billingBlocked', false, 'billingManualReview', false, 'breakFeeFlagged', false);\n    -- Fixed non-operational 'other' support policy matches the established\n    -- shared command. No caller may supply withdrawal/operational flags.\n    insert into public.customer_cases(id, company_id, customer_id, case_type, status, priority,\n      title, description, reason_category, source, metadata, next_action,\n      billing_blocked, billing_manual_review, cancellation_required, cancellation_status,\n      withdrawal_possible, switch_can_be_stopped, withdrawal_scenario, break_fee_flagged,\n      created_by, updated_by, created_at, updated_at)\n    values (v_case_id, p_company_id, p_customer_id, 'other', 'open', 'normal', btrim(p_title), btrim(p_message),\n      v_category, 'tenant_support_customer_portal', jsonb_build_object('support_case', true,\n        'support_channel', 'customer_portal', 'support_idempotency_key', btrim(p_idempotency_key),\n        'description_visibility', 'customer', 'opened_by', 'customer', 'api_client_id', p_api_client_id,\n        'portal_identity_id', p_portal_identity_id, 'prodatSentAt', null, 'assessment', v_assessment),\n      v_next_action, false, false, false, 'not_required', false, false, 'not_withdrawal', false,\n      null, null, v_now, v_now) returning * into v_case;\n    insert into public.customer_case_events(company_id, customer_case_id, customer_id, event_type,\n      event_status, message, payload, created_by)\n    values (p_company_id, v_case.id, p_customer_id, 'created', 'info',\n      'Annan orsak registrerat. ' || v_next_action, jsonb_build_object('assessment', v_assessment), null);\n    -- Match the old shared command's action, attribution and pre-reference row.\n    insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, new_values, metadata)\n    values (p_company_id, null, 'customer_case', v_case.id::text, 'customer_case_registered',\n      to_jsonb(v_case), jsonb_build_object('customer_id', p_customer_id));\n  end if;\n\n  v_reference := 'support_case_' || substr(translate(rtrim(encode(sha256(convert_to(\n    'gridex-public-reference:v1:' || p_company_id::text || ':support_case:' || v_case.id::text,\n    'UTF8')), 'base64'), '='), '+/', '-_'), 1, 32);\n  if v_case.metadata->>'support_public_reference' is distinct from v_reference then\n    update public.customer_cases set metadata = metadata || jsonb_build_object('support_public_reference', v_reference)\n      where id = v_case.id and company_id = p_company_id and customer_id = p_customer_id returning * into v_case;\n  end if;\n  if not exists (select 1 from public.customer_case_events where company_id = p_company_id\n    and customer_id = p_customer_id and customer_case_id = v_case.id and event_type = 'support_customer_message') then\n    -- Repair only the retained original body, never new replay input or an\n    -- unqualified internal case. New commands cannot leave a partial first body.\n    if v_case.description is null or length(btrim(v_case.description)) not between 1 and 8000 then\n      raise exception 'support_legacy_repair_unavailable' using errcode = 'P0001';\n    end if;\n    v_payload := jsonb_build_object('visibility', 'customer', 'author_type', 'customer', 'channel', 'customer_portal',\n      'api_client_id', v_case.metadata->'api_client_id', 'portal_identity_id', v_case.metadata->'portal_identity_id');\n    insert into public.customer_case_events(company_id, customer_case_id, customer_id, event_type,\n      event_status, message, payload, created_by, created_at)\n    values (p_company_id, v_case.id, p_customer_id, 'support_customer_message', 'info', v_case.description, v_payload, null, v_now);\n  end if;\n  -- Existing policy: opening a case has the 50/day gate. Its first message\n  -- contributes to later hourly counts but opening has no extra 150/hour gate.\n  return jsonb_build_object('case', to_jsonb(v_case), 'reused', v_reused);\nend;\n$$;"

let db: PGlite
function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function definition(sql: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\(`, 'im').exec(sql)
  if (!start) throw new Error('Missing actual function: ' + name)
  const rest = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(rest)
  if (!delimiter) throw new Error('Missing function delimiter')
  const end = rest.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Unterminated function')
  return rest.slice(0, end + delimiter[1].length + 1)
}
function body(sql: string) {
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(sql)
  if (!delimiter) throw new Error('Missing body')
  const start = delimiter.index + delimiter[0].length
  return sql.slice(start, sql.indexOf(delimiter[1] + ';', start))
}
function table(name: string) {
  const start = schema.indexOf('CREATE TABLE ' + name + ' (')
  if (start < 0) throw new Error('Missing actual table: ' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
function block(tag: string) {
  const start = forward.indexOf(`DO $${tag}$`)
  if (start < 0) return '' // Empty official forward deliberately exposes RED.
  const end = forward.indexOf(`$${tag}$;`, start + tag.length + 5)
  if (end < 0) throw new Error('Unterminated forward block')
  return forward.slice(start, end + tag.length + 3)
}
function section(sql: string, name: string) {
  const start = sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_BEGIN`)
  const end = sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_END`, start)
  return start < 0 || end < 0 ? '' : sql.slice(start, end)
}
function map(source: string, tag: string): Record<string, string> {
  return JSON.parse(source.split('$' + tag + '$')[1]) as Record<string, string>
}
const originalHelper = definition(ownerDonor, 'gridex_ediel_retention.audit19_source_contract_v1')
const predecessor = originalHelper.replace(oldBlobSlot, newBlobSlot)
function stripMaps(source: string) {
  return source.replace(/\$contracts\$.*?\$contracts\$/s, '<HASH_MAP>')
    .replace(/\$signatures\$.*?\$signatures\$/s, '<SIGNATURE_MAP>')
}
async function source(signature: string) {
  return (await db.query<{ prosrc: string }>('select prosrc from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosrc
}
async function profiles() {
  return (await db.query<{ profile: unknown }>(`select to_jsonb(p)-'prosrc' as profile from pg_proc p
    where oid=any(array[$1::regprocedure::oid,$2::regprocedure::oid]) order by oid`, [helper, consumer])).rows
}
async function qualify(selectedAction = action) {
  return (await db.query<{ result: { sourceVersion: string; writerFunction: string; writerBodyHash: string } }>(
    `select ${helper.slice(0, helper.indexOf('('))}($1) as result`, [selectedAction])).rows[0].result
}
async function apply(includePostcheck = true) {
  await db.exec(block('audit19_support_preflight'))
  const snapshot = /CREATE TEMPORARY TABLE gridex_audit19_support_function_scope\b[\s\S]*?;/.exec(forward)
  await db.exec(snapshot?.[0] ?? '')
  await db.exec(block('audit19_support_consumer_slot'))
  if (includePostcheck) await db.exec(block('audit19_support_profiles_preserved'))
}
async function rejectedApply() {
  const before = await profiles()
  const beforeBody = await source(helper)
  await db.exec('savepoint failed_install')
  let error: { code?: string; message?: string } | undefined
  try { await apply() } catch (caught) {
    error = caught as typeof error
    await db.exec('rollback to savepoint failed_install')
  }
  await db.exec('release savepoint failed_install')
  expect(error?.code).toBe('42501')
  expect(error?.message).toMatch(/audit19_support/)
  expect(await profiles()).toEqual(before)
  expect(await source(helper)).toBe(beforeBody)
}
async function appendBody(signature: string) {
  const old = await source(signature)
  const actual = (await db.query<{ ddl: string }>('select pg_get_functiondef($1::regprocedure) as ddl', [signature])).rows[0].ddl
  await db.exec(actual.replace(old, old + '\n-- unqualified source change\n'))
}

describe('audit19 qualifies exactly the new customer-support source consumer', () => {
  beforeAll(async () => {
    expect(hash(body(originalHelper))).toBe('3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b')
    expect(hash(body(predecessor))).toBe(helperBeforeHash)
    expect(hash(body(capturedSupportDefinition))).toBe(consumerHash)
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create role gridex_ediel_retention_owner nologin noinherit bypassrls;
      create schema gridex_ediel_retention authorization gridex_ediel_retention_owner;`)
    for (const name of ['public.audit_logs', 'public.customer_cases', 'gridex_ediel_retention.audit19_approvals_v1',
      'gridex_ediel_retention.decision_evidence_policies']) await db.exec(table(name))
    for (const name of ['public.gridex_normalize_audit_context_v1', 'public.gridex_guard_history_truncate_v1',
      'gridex_ediel_retention.audit19_guard_v1', writer]) await db.exec(definition(schema, name))
    await db.exec(predecessor)
    await db.exec(capturedSupportDefinition)
    await db.exec(`alter function ${helper} owner to gridex_ediel_retention_owner;
      revoke all on function ${helper} from public,anon,authenticated,service_role;
      revoke all on function ${consumer} from public,anon,authenticated,service_role;
      grant execute on function ${consumer} to service_role;`)
    // The three audit_logs and A9 triggers are exact exported DDL, not stubs.
    for (const name of ['audit19_owner_delete_guard_v1', 'audit_logs_normalize_context_v1', 'audit19_a9_guard_v1']) {
      const trigger = new RegExp(`^CREATE TRIGGER ${name} .*;$`, 'm').exec(schema)
      if (!trigger) throw new Error('Missing actual trigger: ' + name)
      await db.exec(trigger[0])
    }
    const truncate = /^CREATE TRIGGER gridex_history_truncate_guard .* ON public\.audit_logs .*;$/m.exec(schema)
    if (!truncate) throw new Error('Missing actual audit truncate trigger')
    await db.exec(truncate[0])
  }, 30_000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('demonstrates the actual post865 helper rejects the exact new867 consumer', async () => {
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('qualifies the exact consumer and retains the existing writer source result', async () => {
    await apply()
    expect(await qualify()).toEqual({ sourceVersion: '7f7d827987896f949f35b9da5801a79fbc1bceb6', writerFunction: writer, writerBodyHash: writerHash })
  })
  it('changes only the two additive map entries; all91, owned16, writerCASE and sourceVersion stay exact', async () => {
    await apply()
    const after = await source(helper)
    expect(hash(after)).toBe(helperAfterHash)
    expect(stripMaps(after)).toBe(stripMaps(body(predecessor)))
    for (const tag of ['contracts', 'signatures']) {
      const beforeMap = map(body(predecessor), tag)
      const afterMap = map(after, tag)
      expect(Object.keys(beforeMap)).toHaveLength(91)
      expect(Object.keys(afterMap)).toHaveLength(92)
      expect(afterMap[consumerName]).toBe(tag === 'contracts' ? consumerHash : consumer)
      delete afterMap[consumerName]
      expect(afterMap).toEqual(beforeMap)
    }
    expect(after.match(/to_regprocedure\('/g)).toHaveLength(16)
  })
  it('preserves both OIDs and every pg_proc attribute except the intended helper prosrc', async () => {
    const before = await profiles()
    await apply()
    expect(await profiles()).toEqual(before)
    expect(hash(await source(consumer))).toBe(consumerHash)
    expect(hash(await source(helper))).toBe(helperAfterHash)
  })
  it('does not make support registration an eligible retention writer', async () => {
    await apply()
    await expect(qualify('customer_case_registered')).rejects.toMatchObject({ code: '42501', message: 'audit19_supported_source_contract_required' })
  })
  it('keeps actual ordinary audit INSERT/normalization working independently of retirement qualification', async () => {
    await apply()
    const result = await db.query<{ actor_type: string; system_actor: string; resource_type: string }>(`insert into public.audit_logs(entity_type,entity_id,action)
      values('customer_case','synthetic','customer_case_registered') returning actor_type,system_actor,resource_type`)
    expect(result.rows[0]).toEqual({ actor_type: 'system', system_actor: 'unspecified_system_actor', resource_type: 'customer_case' })
  })
  it.each(['helper', 'consumer'] as const)('rejects unknown %s body without replacing anything', async selected => {
    await appendBody(selected === 'helper' ? helper : consumer)
    await rejectedApply()
  })
  it('rejects the pre865 helper instead of silently rebasing it', async () => {
    await db.exec(originalHelper.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    await rejectedApply()
  })
  it('rejects missing support prerequisite', async () => {
    await db.exec(`drop function ${consumer}`)
    await db.exec('savepoint missing_prerequisite')
    await expect(db.exec(block('audit19_support_preflight'))).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint missing_prerequisite;release savepoint missing_prerequisite')
    expect(hash(await source(helper))).toBe(helperBeforeHash)
  })
  it.each([
    ['helper definer', `alter function ${helper} security definer`],
    ['helper search path', `alter function ${helper} set search_path=public`],
    ['helper owner', `alter function ${helper} owner to postgres`],
    ['helper public execute', `grant execute on function ${helper} to public`],
    ['helper authenticated execute', `grant execute on function ${helper} to authenticated`],
    ['support invoker', `alter function ${consumer} security invoker`],
    ['support search path', `alter function ${consumer} set search_path=public`],
    ['support timeout', `alter function ${consumer} set lock_timeout='3s'`],
    ['support owner', `alter function ${consumer} owner to gridex_ediel_retention_owner`],
    ['support public execute', `grant execute on function ${consumer} to public`],
    ['support authenticated execute', `grant execute on function ${consumer} to authenticated`],
    ['support service revoke', `revoke execute on function ${consumer} from service_role`],
    ['support grant option', `grant execute on function ${consumer} to service_role with grant option`],
    ['support extra overload', `create function ${consumerName}(text) returns jsonb language sql as $$select '{}'::jsonb$$`],
  ])('rejects changed %s header/ACL/shape', async (_label, mutation) => {
    await db.exec(mutation)
    await rejectedApply()
  })
  it('rejects an already replaced helper as an unknown predecessor, not a new baseline', async () => {
    await apply()
    await rejectedApply()
  })
  it('rolls back the replacement if a later metadata-preservation check fails', async () => {
    const before = await profiles()
    await db.exec('savepoint atomic_install')
    await apply(false)
    expect(hash(await source(helper))).toBe(helperAfterHash)
    await db.exec(`grant execute on function ${helper} to authenticated`)
    await expect(db.exec(block('audit19_support_profiles_preserved'))).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint atomic_install;release savepoint atomic_install')
    expect(await profiles()).toEqual(before)
    expect(hash(await source(helper))).toBe(helperBeforeHash)
  })
  it('still rejects a newly unknown audit consumer', async () => {
    await apply()
    await db.exec(`create function public.fixture_unknown_consumer() returns bigint language sql as $$select count(*) from public.audit_logs$$`)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('still rejects a changed qualified support body after installation', async () => {
    await apply()
    await appendBody(consumer)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('still rejects an incoming audit foreign key', async () => {
    await apply()
    await db.exec(`alter table public.audit_logs add primary key(id);create table public.fixture_audit_fk(id uuid references public.audit_logs(id))`)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_incoming_FK_unsupported' })
  })
  it('still rejects an incoming audit composite column', async () => {
    await apply()
    await db.exec('create table public.fixture_audit_composite(a public.audit_logs)')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_incoming_composite_unsupported' })
  })
  it('still rejects an additional audit trigger', async () => {
    await apply()
    await db.exec('create trigger fixture_extra before insert on public.audit_logs for each row execute function public.gridex_normalize_audit_context_v1()')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_trigger_unsupported' })
  })
  it('still requires the actual enabled A9 guard', async () => {
    await apply()
    await db.exec('alter table gridex_ediel_retention.audit19_approvals_v1 disable trigger audit19_a9_guard_v1')
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_actual_A9_guard_required' })
  })
  it('copies the qualified owner install/restore boundary with only private scope-name and no-public-CREATE specialization', () => {
    const oldScope = section(ownerDonor, 'SCOPE').replaceAll('gridex_db05_install_scope', 'gridex_audit19_support_install_scope')
      .replace(" IF NOT has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') THEN GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;END IF;", ' -- No new public-function owner transfer; no temporary public CREATE.')
    const oldRestore = section(ownerDonor, 'RESTORE').replaceAll('gridex_db05_install_scope', 'gridex_audit19_support_install_scope')
      .replace(' IF NOT before_row.owner_public_create THEN REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;END IF;', ' -- No temporary public CREATE was introduced.')
    expect(section(forward, 'SCOPE')).toBe(oldScope)
    expect(section(forward, 'RESTORE')).toBe(oldRestore)
    expect(forward.trim()).toMatch(/^--[\s\S]*\nBEGIN;/)
    expect(forward.trim()).toMatch(/COMMIT;$/)
    expect(forward).not.toMatch(/(?:UPDATE|LOCK\s+TABLE)\s+(?:pg_catalog\.)?pg_proc\b/i)
  })
})
