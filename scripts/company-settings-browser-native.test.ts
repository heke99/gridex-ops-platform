import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('settings_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 15_000 }).trim()) as T
}
async function actor(companyId: string, tag: string, permissions: string[]) {
  const email = `settings-${tag}-${companyId.slice(0, 8)}@example.invalid`
  const created = await supabaseService.auth.admin.createUser({ email, password: process.env.GRIDEX_SETTINGS_TEST_PASSWORD!, email_confirm: true, user_metadata: { full_name: 'Synthetic settings actor', phone: '+46700005000' } })
  if (created.error || !created.data.user) throw created.error ?? new Error('settings_fixture_auth_user_missing')
  const userId = created.data.user.id, roleId = randomUUID(), roleKey = `settings_${tag}_${companyId.slice(0, 8)}`
  const keys = permissions.map(quote).join(',')
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(userId)},${quote(email)},'Synthetic settings actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(roleId)},${quote(roleKey)},'Synthetic settings role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(companyId)},${quote(userId)},'member','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${quote(userId)},${quote(companyId)},${quote(roleId)},${quote(roleKey)},'active',true);
    INSERT INTO public.permissions(key,name,description,category) SELECT key,key,'Disposable settings fixture','test' FROM unnest(ARRAY[${keys}]::text[]) AS keys(key) ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${quote(roleId)},${quote(roleKey)},id,key FROM public.permissions WHERE key IN(${keys});
    SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE role_id=${quote(roleId)};`)
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password: process.env.GRIDEX_SETTINGS_TEST_PASSWORD! })
  expect(login.error).toBeNull()
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
  expect(context.error).toBeNull()
  expect(context.data).toMatchObject({ authorized: true, selected_company_id: companyId })
  for (const key of permissions) expect((context.data as { permissions: string[] }).permissions).toContain(key)
  return { userId, email }
}

it('seeds disposable settings actors and independently checks persisted browser effects', async () => {
  const fixturePath = resolve(process.env.GRIDEX_SETTINGS_FIXTURE_PATH!), temp = process.env.RUNNER_TEMP
  if (!temp || !fixturePath.startsWith(resolve(temp) + sep)) throw new Error('settings_fixture_must_stay_in_runner_temp')
  if (process.env.GRIDEX_SETTINGS_VERIFY_AFTER_BROWSER === '1') {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { companyA: string; companyB: string; foreignUserId: string; foreignEmail: string; sharedUserId: string; sharedIdentityBefore: unknown; sharedCompanyBBefore: unknown }
    const state = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'nameA',(SELECT name FROM public.companies WHERE id=${quote(fixture.companyA)}),
      'nameB',(SELECT name FROM public.companies WHERE id=${quote(fixture.companyB)}),
      'environmentA',(SELECT operating_environment FROM public.companies WHERE id=${quote(fixture.companyA)}),
      'environmentB',(SELECT operating_environment FROM public.companies WHERE id=${quote(fixture.companyB)}),
      'foreignEmail',(SELECT email FROM auth.users WHERE id=${quote(fixture.foreignUserId)}),
      'foreignName',(SELECT full_name FROM public.user_profiles WHERE id=${quote(fixture.foreignUserId)}),
      'foreignMemberships',(SELECT count(*) FROM public.company_memberships WHERE user_id=${quote(fixture.foreignUserId)}),
      'sharedIdentity',(SELECT jsonb_build_object('authEmail',a.email,'metadata',a.raw_user_meta_data,'profileEmail',p.email,'profileName',p.full_name,'profilePhone',p.phone) FROM auth.users a JOIN public.user_profiles p ON p.id=a.id WHERE a.id=${quote(fixture.sharedUserId)}),
      'sharedCompanyB',(SELECT jsonb_build_object('membership',(SELECT to_jsonb(m) FROM public.company_memberships m WHERE m.company_id=${quote(fixture.companyB)} AND m.user_id=${quote(fixture.sharedUserId)}),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.user_roles r WHERE r.company_id=${quote(fixture.companyB)} AND r.user_id=${quote(fixture.sharedUserId)}))),
      'sharedRoleA',(SELECT role_key FROM public.company_memberships WHERE company_id=${quote(fixture.companyA)} AND user_id=${quote(fixture.sharedUserId)}),
      'legalNameA',(SELECT legal_name FROM public.tenant_legal_profiles WHERE company_id=${quote(fixture.companyA)}));`)
    expect(state).toMatchObject({ nameA: 'Synthetic settings persisted', nameB: 'Synthetic settings company B', environmentA: 'test', environmentB: 'test', foreignEmail: fixture.foreignEmail, foreignName: 'Synthetic settings actor', foreignMemberships: 1, legalNameA: 'Synthetic settings company A', sharedIdentity: fixture.sharedIdentityBefore, sharedCompanyB: fixture.sharedCompanyBBefore, sharedRoleA: 'finance_readonly' })
    console.log('TENANTSERVICE_COMPANY_SETTINGS_NATIVE_PASS correct_company=true draft_validation=true persisted_reload=true foreign_identity_unchanged=true production_unchanged=true')
    return
  }
  const companyA = randomUUID(), companyB = randomUUID()
  sql(`INSERT INTO public.companies(id,name,legal_name,status,operating_environment,country_code) VALUES
    (${quote(companyA)},'Synthetic settings company A','Synthetic settings company A','active','test','SE'),
    (${quote(companyB)},'Synthetic settings company B','Synthetic settings company B','active','test','SE'); SELECT to_jsonb(count(*)) FROM public.companies WHERE id IN(${quote(companyA)},${quote(companyB)});`)
  const writer = await actor(companyA, 'writer', ['users.read', 'users.write', 'tenants.invite'])
  const reader = await actor(companyA, 'reader', ['users.read'])
  const foreign = await actor(companyB, 'foreign', ['users.read'])
  const shared = await actor(companyA, 'shared', ['users.read'])
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(companyB)},${quote(shared.userId)},'member','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) SELECT user_id,${quote(companyB)},role_id,role,status,is_active FROM public.user_roles WHERE company_id=${quote(companyA)} AND user_id=${quote(shared.userId)};
    SELECT to_jsonb(count(*)) FROM public.company_memberships WHERE user_id=${quote(shared.userId)};`)
  sql(`UPDATE public.user_profiles SET email='stale-settings-profile@example.invalid' WHERE id=${quote(shared.userId)}; SELECT to_jsonb(count(*)) FROM public.user_profiles WHERE id=${quote(shared.userId)};`)
  const sharedIdentityBefore = sql<unknown>(`SELECT jsonb_build_object('authEmail',a.email,'metadata',a.raw_user_meta_data,'profileEmail',p.email,'profileName',p.full_name,'profilePhone',p.phone) FROM auth.users a JOIN public.user_profiles p ON p.id=a.id WHERE a.id=${quote(shared.userId)};`)
  const sharedCompanyBBefore = sql<unknown>(`SELECT jsonb_build_object('membership',(SELECT to_jsonb(m) FROM public.company_memberships m WHERE m.company_id=${quote(companyB)} AND m.user_id=${quote(shared.userId)}),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.user_roles r WHERE r.company_id=${quote(companyB)} AND r.user_id=${quote(shared.userId)}));`)

  // The direct Data API boundary is separate from the browser's visible controls.
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  expect((await client.auth.signInWithPassword({ email: reader.email, password: process.env.GRIDEX_SETTINGS_TEST_PASSWORD! })).error).toBeNull()
  const denied = await client.rpc('gridex_update_company_and_rebuild_legal_profile', { p_company_id: companyA, p_actor_user_id: writer.userId, p_input: { name: 'Unauthorized settings change' }, p_mark_reviewed: false })
  expect(denied.error).not.toBeNull()
  expect(sql<string>(`SELECT to_jsonb(name) FROM public.companies WHERE id=${quote(companyA)};`)).toBe('Synthetic settings company A')
  writeFileSync(fixturePath, JSON.stringify({ companyA, companyB, writerEmail: writer.email, writerId: writer.userId, readerEmail: reader.email, foreignUserId: foreign.userId, foreignEmail: foreign.email, sharedUserId: shared.userId, sharedEmail: shared.email, sharedIdentityBefore, sharedCompanyBBefore }), { mode: 0o600 })
  console.log('TENANTSERVICE_COMPANY_SETTINGS_SEED_PASS reader_rpc_denied=true synthetic_test_environment=true')
})
