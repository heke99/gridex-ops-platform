import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Runs the actual complete single-DO installer over real pg_proc/ACL metadata.
// The account function is never invoked; no application/Auth tables or auth.uid
// implementation are installed. This is not native/provider installation proof.
// Immutable predecessor, independent of later generated schema exports.
const canonicalSource = readFileSync('supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020182423_anonymize_user_account_source_comment_alignment.sql', 'utf8')
const signature = 'public.anonymize_user_account(uuid)'
const observedHash = 'b4aa9802e9fd9152174fcd7de5948bb30bf21eab6a319b9559d73b5ca83c9e73'
const canonicalHash = '40ec063475b6a977585e58382358238b2ecf50c470c190d43a3c948f8cce4d97'
const upgradedHash = '410d33fda02e355323850769d063d7de3190c4aca7c82b33d64a4dc4be3e28e2'
const anchor = "  if to_regclass('auth.sessions') is not null then\n"
const comments = '  -- Revoke existing authenticated sessions without deleting the auth identity.\n'
  + '  -- The identity itself remains so the product can retain its established\n'
  + '  -- account-closure semantics while authorization state is removed atomically.\n'

// DECLARED_OBSERVED_SOURCE: exact metadata-only prosrc captured by ROOT from
// confirmed Ops target piidsfebjqjmnepdpnas; source receipt
// prod-targeted-anonymize-merge-bodies-rows.json SHA256
// aff64645716d1a7dc2a9c482ce6e7998e18dfc44c898febe239e445128d70e26.
// Only this noncustomer function-source row is retained here, pinned by hash.
const observedBody = "\nbegin\n  if auth.uid() is distinct from target_user_id then\n    raise exception using\n      errcode = '42501',\n      message = 'Can only anonymize your own account';\n  end if;\n\n  if exists (\n    select 1\n    from public.company_memberships membership\n    join public.companies company on company.id = membership.company_id\n    where membership.user_id = target_user_id\n      and coalesce(membership.status, 'active') = 'active'\n      and coalesce(\n        nullif(lower(membership.membership_role), ''),\n        nullif(lower(membership.role), ''),\n        nullif(lower(membership.role_key), '')\n      ) = 'owner'\n      and company.archived_at is null\n  ) then\n    raise exception using\n      errcode = 'P0001',\n      message = 'Active companies must be transferred or archived first';\n  end if;\n\n  if to_regclass('public.user_preferences') is not null then\n    execute 'delete from public.user_preferences where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.user_permission_overrides') is not null then\n    execute 'delete from public.user_permission_overrides where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.user_roles') is not null then\n    execute 'delete from public.user_roles where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.company_memberships') is not null then\n    execute 'delete from public.company_memberships where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.agency_members') is not null then\n    execute 'delete from public.agency_members where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.team_members') is not null then\n    execute 'delete from public.team_members where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.bankid_enrichment') is not null then\n    execute 'delete from public.bankid_enrichment where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.extension_data') is not null then\n    execute\n      'delete from public.extension_data where user_id = $1 and key = ''bankid_enrichment'''\n      using target_user_id;\n  end if;\n\n  if to_regclass('public.company_invitations') is not null\n     and exists (\n       select 1 from information_schema.columns\n       where table_schema = 'public'\n         and table_name = 'company_invitations'\n         and column_name = 'invited_user_id'\n     ) then\n    if exists (\n      select 1 from information_schema.columns\n      where table_schema = 'public'\n        and table_name = 'company_invitations'\n        and column_name = 'invited_user_id'\n        and is_nullable = 'YES'\n    ) then\n      execute 'update public.company_invitations set invited_user_id = null where invited_user_id = $1'\n        using target_user_id;\n    else\n      execute 'delete from public.company_invitations where invited_user_id = $1'\n        using target_user_id;\n    end if;\n  end if;\n\n  if to_regclass('auth.sessions') is not null then\n    execute 'delete from auth.sessions where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('auth.refresh_tokens') is not null\n     and exists (\n       select 1 from information_schema.columns\n       where table_schema = 'auth'\n         and table_name = 'refresh_tokens'\n         and column_name = 'user_id'\n     ) then\n    execute 'delete from auth.refresh_tokens where user_id::text = $1::text'\n      using target_user_id;\n  end if;\n\n  update public.user_profiles\n  set email = null,\n      full_name = null,\n      phone = null,\n      user_status = 'disabled',\n      active_company_id = null,\n      updated_at = now()\n  where id = target_user_id;\nend\n"

// DECLARED_PR873_DEFINITION: immutable head
// 57359838ff9ba75cd5ad4085ab0fb5cf7543fcec, forward
// 20261020164020_anonymize_user_profile_optional_columns.sql SHA256
// 0826b88190c925d215c33a512307725eb6e74d7114722a0f26982739dcd738d9.
// Clean fd4 predates873; this exact captured DDL makes the post873 no-op test
// self-contained, without private/sibling-worktree/Git/network dependencies.
const upgradedDefinition = "CREATE OR REPLACE FUNCTION public.anonymize_user_account(target_user_id uuid) RETURNS void\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'public', 'auth', 'pg_catalog', 'pg_temp'\n    AS $_$\ndeclare\n  profile_assignments text := 'email = null, full_name = null, user_status = ''disabled'', updated_at = now()';\nbegin\n  if auth.uid() is distinct from target_user_id then\n    raise exception using\n      errcode = '42501',\n      message = 'Can only anonymize your own account';\n  end if;\n\n  if exists (\n    select 1\n    from public.company_memberships membership\n    join public.companies company on company.id = membership.company_id\n    where membership.user_id = target_user_id\n      and coalesce(membership.status, 'active') = 'active'\n      and coalesce(\n        nullif(lower(membership.membership_role), ''),\n        nullif(lower(membership.role), ''),\n        nullif(lower(membership.role_key), '')\n      ) = 'owner'\n      and company.archived_at is null\n  ) then\n    raise exception using\n      errcode = 'P0001',\n      message = 'Active companies must be transferred or archived first';\n  end if;\n\n  if to_regclass('public.user_preferences') is not null then\n    execute 'delete from public.user_preferences where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.user_permission_overrides') is not null then\n    execute 'delete from public.user_permission_overrides where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.user_roles') is not null then\n    execute 'delete from public.user_roles where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.company_memberships') is not null then\n    execute 'delete from public.company_memberships where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.agency_members') is not null then\n    execute 'delete from public.agency_members where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.team_members') is not null then\n    execute 'delete from public.team_members where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.bankid_enrichment') is not null then\n    execute 'delete from public.bankid_enrichment where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('public.extension_data') is not null then\n    execute\n      'delete from public.extension_data where user_id = $1 and key = ''bankid_enrichment'''\n      using target_user_id;\n  end if;\n\n  if to_regclass('public.company_invitations') is not null\n     and exists (\n       select 1 from information_schema.columns\n       where table_schema = 'public'\n         and table_name = 'company_invitations'\n         and column_name = 'invited_user_id'\n     ) then\n    if exists (\n      select 1 from information_schema.columns\n      where table_schema = 'public'\n        and table_name = 'company_invitations'\n        and column_name = 'invited_user_id'\n        and is_nullable = 'YES'\n    ) then\n      execute 'update public.company_invitations set invited_user_id = null where invited_user_id = $1'\n        using target_user_id;\n    else\n      execute 'delete from public.company_invitations where invited_user_id = $1'\n        using target_user_id;\n    end if;\n  end if;\n\n  -- Revoke existing authenticated sessions without deleting the auth identity.\n  -- The identity itself remains so the product can retain its established\n  -- account-closure semantics while authorization state is removed atomically.\n  if to_regclass('auth.sessions') is not null then\n    execute 'delete from auth.sessions where user_id = $1'\n      using target_user_id;\n  end if;\n  if to_regclass('auth.refresh_tokens') is not null\n     and exists (\n       select 1 from information_schema.columns\n       where table_schema = 'auth'\n         and table_name = 'refresh_tokens'\n         and column_name = 'user_id'\n     ) then\n    execute 'delete from auth.refresh_tokens where user_id::text = $1::text'\n      using target_user_id;\n  end if;\n\n  -- Keep one update and all mandatory assignments. Only these two known\n  -- legacy columns are optional; required-column/type/constraint failures must\n  -- still roll back every preceding authorization/session cleanup operation.\n  if exists (\n    select 1 from pg_catalog.pg_attribute\n    where attrelid = pg_catalog.to_regclass('public.user_profiles')\n      and attname = 'phone' and attnum > 0 and not attisdropped\n  ) then\n    profile_assignments := profile_assignments || ', phone = null';\n  end if;\n  if exists (\n    select 1 from pg_catalog.pg_attribute\n    where attrelid = pg_catalog.to_regclass('public.user_profiles')\n      and attname = 'active_company_id' and attnum > 0 and not attisdropped\n  ) then\n    profile_assignments := profile_assignments || ', active_company_id = null';\n  end if;\n\n  -- All SQL fragments above are constants; the target identity stays bound.\n  execute 'update public.user_profiles set ' || profile_assignments || ' where id = $1'\n    using target_user_id;\nend\n$_$;"

function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function definition(sql: string) {
  const start = /^CREATE(?: OR REPLACE)? FUNCTION public\.anonymize_user_account\(/im.exec(sql)
  if (!start) throw new Error('Missing actual account function')
  const rest = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(rest)
  if (!delimiter) throw new Error('Missing actual function delimiter')
  const end = rest.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Unterminated actual function')
  return rest.slice(0, end + delimiter[1].length + 1)
}
function body(sql: string) {
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(sql)
  if (!delimiter) throw new Error('Missing actual body')
  const start = delimiter.index + delimiter[0].length
  return sql.slice(start, sql.indexOf(delimiter[1] + ';', start))
}
const canonicalDefinition = definition(canonicalSource)
const canonicalBody = body(canonicalDefinition)
let db: PGlite
async function install(selected: 'observed' | 'canonical' | 'upgraded') {
  const ddl = selected === 'upgraded' ? upgradedDefinition
    : canonicalDefinition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replace(canonicalBody, selected === 'observed' ? observedBody : canonicalBody)
  await db.exec(ddl)
}
async function metadata() {
  return (await db.query<{ profile: Record<string, unknown>; source: string; xmin: string }>(`select
    to_jsonb(p)-'prosrc' as profile,p.prosrc as source,p.xmin::text as xmin
    from pg_catalog.pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0]
}
async function apply() { await db.exec(forward) }
async function rejectedApply(code = '55000', message = /account_closure_comment_alignment/) {
  const before = await metadata()
  await db.exec('savepoint rejected_alignment')
  let error: { code?: string; message?: string } | undefined
  try { await apply() } catch (caught) {
    error = caught as typeof error
    await db.exec('rollback to savepoint rejected_alignment')
  }
  await db.exec('release savepoint rejected_alignment')
  expect(error?.code).toBe(code)
  expect(error?.message).toMatch(message)
  expect(await metadata()).toEqual(before)
}

describe('exact account-source comment alignment before unmodified873', () => {
  beforeAll(async () => {
    expect(hash(canonicalSource)).toBe('915f097ae92cfc56423b4047e1b31433bb293bb2d56f505b7584c563a89a33a2')
    expect(hash(canonicalBody)).toBe(canonicalHash)
    expect(hash(observedBody)).toBe(observedHash)
    expect(hash(body(upgradedDefinition))).toBe(upgradedHash)
    db = new PGlite()
    await db.exec(`create schema auth;
      create role anon;create role authenticated;create role service_role;
      create role fixture_other_owner nologin;
      create role fixture_migration nologin nosuperuser inherit;
      grant postgres to fixture_migration;
      grant usage,create on schema public to fixture_other_owner,fixture_migration;`)
    await install('observed')
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
      grant execute on function ${signature} to authenticated,service_role;`)
  }, 30_000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('pins the observed source difference to exactly three comment lines, not a code-token change', () => {
    expect(Buffer.byteLength(comments)).toBe(235)
    expect(canonicalBody.split(comments)).toHaveLength(2)
    expect(observedBody.split(anchor)).toHaveLength(2)
    expect(observedBody.replace(anchor, comments + anchor)).toBe(canonicalBody)
    expect(canonicalBody.replace(comments, '')).toBe(observedBody)
    const withoutComments = (source: string) => source.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    expect(withoutComments(canonicalBody)).toBe(withoutComments(observedBody))
  })
  it('aligns actual b4aa source to canonical40ec without invoking the account function', async () => {
    await apply()
    expect((await metadata()).source).toBe(canonicalBody)
    expect(hash((await metadata()).source)).toBe(canonicalHash)
    expect((await db.query(`select to_regclass('public.user_profiles') is null as absent,
      to_regprocedure('auth.uid()') is null as no_runtime`)).rows[0]).toEqual({ absent: true, no_runtime: true })
  })
  it('preserves OID, owner, ACL and every other pg_proc attribute during actual replacement', async () => {
    const before = await metadata()
    await apply()
    const after = await metadata()
    expect(after.profile).toEqual(before.profile)
    expect(after.source).toBe(observedBody.replace(anchor, comments + anchor))
    expect(after.source).not.toBe(before.source)
  })
  it.each(['canonical', 'upgraded'] as const)('makes known %s a true no-op, including the catalog tuple xmin', async selected => {
    await install(selected)
    const before = await metadata()
    await apply()
    expect(await metadata()).toEqual(before)
    expect(hash(before.source)).toBe(selected === 'canonical' ? canonicalHash : upgradedHash)
  })
  it('replays its own canonical result as a true no-op', async () => {
    await apply()
    expect(hash((await metadata()).source)).toBe(canonicalHash)
    const before = await metadata()
    await apply()
    expect(await metadata()).toEqual(before)
  })
  it('runs the complete installer as a nonsuperuser with existing function-owner membership', async () => {
    await db.exec('set local role fixture_migration')
    expect((await db.query(`select rolsuper from pg_roles where rolname=current_user`)).rows[0]).toEqual({ rolsuper: false })
    const before = await metadata()
    await apply()
    expect((await metadata()).profile).toEqual(before.profile)
    expect(hash((await metadata()).source)).toBe(canonicalHash)
    await db.exec('reset role')
  })
  it.each([
    ['unknown comment', observedBody + '\n-- not separately qualified\n'],
    ['code change', observedBody.replace('Can only anonymize your own account', 'Different account closure policy')],
  ])('rejects %s source without a new baseline', async (_label, changed) => {
    await db.exec(canonicalDefinition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace(canonicalBody, changed))
    await rejectedApply()
  })
  it.each([
    ['invoker', `alter function ${signature} security invoker`],
    ['search path', `alter function ${signature} set search_path=public`],
    ['unexpected config', `alter function ${signature} set statement_timeout='5s'`],
    ['strict', `alter function ${signature} strict`],
    ['stable', `alter function ${signature} stable`],
    ['parallel safe', `alter function ${signature} parallel safe`],
    ['cost', `alter function ${signature} cost 200`],
    ['leakproof', `alter function ${signature} leakproof`],
    ['owner', `alter function ${signature} owner to fixture_other_owner`],
    ['PUBLIC execute', `grant execute on function ${signature} to public`],
    ['anon execute', `grant execute on function ${signature} to anon`],
    ['authenticated revoke', `revoke execute on function ${signature} from authenticated`],
    ['service revoke', `revoke execute on function ${signature} from service_role`],
    ['service grant option', `grant execute on function ${signature} to service_role with grant option`],
    ['additional grantee', `grant execute on function ${signature} to fixture_other_owner`],
    ['overload', `create function public.anonymize_user_account(text) returns void language plpgsql as $$begin null;end$$`],
  ])('rejects changed %s header/owner/ACL/signature profile', async (_label, mutation) => {
    await db.exec(mutation)
    await rejectedApply()
  })
  it.each(['canonical', 'upgraded'] as const)('validates header/ACL before the known %s no-op', async selected => {
    await install(selected)
    await db.exec(`grant execute on function ${signature} to anon`)
    await rejectedApply()
  })
  it('rejects missing UUID signature instead of creating an account function', async () => {
    await db.exec(`drop function ${signature}`)
    await db.exec('savepoint missing_signature')
    await expect(apply()).rejects.toMatchObject({ code: '42883' })
    await db.exec('rollback to savepoint missing_signature;release savepoint missing_signature')
    expect((await db.query(`select to_regprocedure($1) is null as missing`, [signature])).rows[0]).toEqual({ missing: true })
  })
  it('rejects a wrong input signature instead of replacing it', async () => {
    await db.exec(`drop function ${signature};create function public.anonymize_user_account(target_user_id text)
      returns void language plpgsql as $$begin null;end$$`)
    await db.exec('savepoint wrong_signature')
    await expect(apply()).rejects.toMatchObject({ code: '42883' })
    await db.exec('rollback to savepoint wrong_signature;release savepoint wrong_signature')
    expect((await db.query(`select to_regprocedure($1) is null as missing`, [signature])).rows[0]).toEqual({ missing: true })
  })
  it('rolls back actual replacement and ACL effects if a later full-metadata check fails', async () => {
    await db.exec(`create function public.fixture_alignment_metadata_drift() returns event_trigger language plpgsql as $$
      begin grant execute on function public.anonymize_user_account(uuid) to anon;end$$;
      create event trigger fixture_alignment_drift on ddl_command_end when tag in ('CREATE FUNCTION')
      execute function public.fixture_alignment_metadata_drift();`)
    const before = await metadata()
    await rejectedApply()
    expect(await metadata()).toEqual(before)
    expect(hash((await metadata()).source)).toBe(observedHash)
  })
  it('does not rewrite qualified canonical source when a CREATE-function trigger would cause drift', async () => {
    await install('canonical')
    await db.exec(`create function public.fixture_noop_metadata_drift() returns event_trigger language plpgsql as $$
      begin grant execute on function public.anonymize_user_account(uuid) to anon;end$$;
      create event trigger fixture_noop_drift on ddl_command_end when tag in ('CREATE FUNCTION')
      execute function public.fixture_noop_metadata_drift();`)
    const before = await metadata()
    await apply()
    expect(await metadata()).toEqual(before)
  })
  it('uses a single atomic DO with ordinary catalog reads and no system-catalog write/lock', () => {
    expect(forward.match(/^DO \$account_comment_alignment\$/gm)).toHaveLength(1)
    expect(forward.trim()).toMatch(/\$account_comment_alignment\$;$/)
    expect(forward).not.toMatch(/(?:UPDATE|LOCK\s+TABLE)\s+(?:pg_catalog\.)?pg_proc\b/i)
    expect(forward).not.toMatch(/^\s*(?:ALTER\s+FUNCTION|GRANT|REVOKE)\b/im)
  })
})
