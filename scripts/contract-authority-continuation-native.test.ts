import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const service = createClient(API, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anonymous = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) throw new Error('contract_authority_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 20_000 }).trim()) as T
}
async function user(tag: string) {
  // Synthetic credentials exist only in this disposable process. GoTrue is
  // real; no invitation/password email or external provider is invoked.
  const password = randomUUID() + 'A1!'
  const email = `contract-authority-${tag}-${randomUUID()}@example.invalid`
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true })
  expect(result.error).toBeNull()
  if (!result.data.user) throw new Error('contract_authority_auth_actor_missing')
  const id = result.data.user.id
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(id)},${quote(email)},'Synthetic contract actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active'; SELECT to_jsonb(id) FROM public.user_profiles WHERE id=${quote(id)};`)
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  expect(login.error).toBeNull()
  return { id, client }
}
function graph(a: string, b: string) {
  const scoped = `IN(${quote(a)},${quote(b)})`
  return sql<unknown>(`SELECT jsonb_build_object(
    'offers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_offers t WHERE company_id ${scoped}),
    'products',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_products t WHERE company_id ${scoped}),
    'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.tenant_contract_assignments t WHERE company_id ${scoped}),
    'versions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_product_versions t WHERE contract_product_id IN(SELECT id FROM public.contract_products WHERE company_id ${scoped})),
    'channels',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.tenant_contract_channels t WHERE assignment_id IN(SELECT id FROM public.tenant_contract_assignments WHERE company_id ${scoped})),
    'publications',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_publications t WHERE assignment_id IN(SELECT id FROM public.tenant_contract_assignments WHERE company_id ${scoped})),
    'publicationVersions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_publication_versions t WHERE contract_product_version_id IN(SELECT v.id FROM public.contract_product_versions v JOIN public.contract_products p ON p.id=v.contract_product_id WHERE p.company_id ${scoped})),
    'publicOffers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.public_contract_offers t WHERE company_id ${scoped}),
    'audit',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.audit_logs t WHERE company_id ${scoped}),
    'pricing',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.contract_price_snapshots t WHERE company_id ${scoped}));`)
}
async function draft(company: string, actor: string) {
  const result = await service.rpc('gridex_upsert_internal_contract_offer_v2', {
    p_company_id: company, p_offer_id: null, p_actor_user_id: actor,
    p_payload: { name: `Synthetic authority ${randomUUID()}`, slug: `authority-${randomUUID()}`, lifecycle_status: 'draft', contract_type: 'variable_hourly',
      customer_type: 'both', pricing_model: 'spot', energy_direction: 'consumption', terms_version: 'test-v1', spot_markup_ore_per_kwh: 4,
      monthly_fee_sek: 49, invoice_fee_sek: 19, default_binding_months: 0, default_notice_months: 1, automatic_renewal: true,
      automatic_renewal_term_months: 12, power_of_attorney_required: true, valid_from: '2026-09-30' },
    p_pricing_snapshot: { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption', interval_resolution: 'hourly',
      vat_rate: 0.25, price_areas: ['SE3'], base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
      price_components: [{ component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
        { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true }] },
  })
  expect(result.error).toBeNull(); expect(result.data).toMatchObject({ ok: true })
  const id = (result.data as { offer?: { id?: string } }).offer?.id
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  return id!
}
async function has(actor: string, company: string, permission = 'contracts.archive') {
  const result = await service.rpc('gridex_contract_actor_has_company_permission', { p_actor_user_id: actor, p_company_id: company, p_permission: permission })
  expect(result.error).toBeNull()
  return result.data
}

it('real GoTrue, Data API and contract RPCs enforce active authoritative and exact target-company grants', async () => {
  const a = randomUUID(), b = randomUUID(), role = randomUUID(), viewerRole = randomUUID(), globalRole = randomUUID(), fakeRole = randomUUID()
  const global = await user('global'), ordinary = await user('ordinary'), reverse = await user('reverse'), fake = await user('fake-global')
  const aliases = sql<string[]>(`SELECT to_jsonb(array_agg(key ORDER BY key)) FROM unnest(ARRAY['platformsuperadmin','platform_superadmin','platformadmin','superadmin']) AS candidate(key) WHERE NOT EXISTS(SELECT 1 FROM public.roles r WHERE r.key=candidate.key);`)
  if (!aliases || aliases.length < 2) throw new Error('contract_authority_fixture_platform_aliases_unavailable')
  const key = `contract_authority_${randomUUID().replaceAll('-', '')}`
  const viewerKey = `contract_authority_viewer_${randomUUID().replaceAll('-', '')}`
  sql(`INSERT INTO public.companies(id,name,status,operating_environment) VALUES(${quote(a)},'Synthetic contract company A','active','test'),(${quote(b)},'Synthetic contract company B','active','test');
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(role)},${quote(key)},'Synthetic company role','company'),(${quote(viewerRole)},${quote(viewerKey)},'Synthetic permissionless viewer','company'),(${quote(globalRole)},${quote(aliases[0])},'Synthetic global role','platform'),(${quote(fakeRole)},${quote(aliases[1])},'Synthetic malformed global role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(a)},${quote(ordinary.id)},'member','active',now()),(${quote(b)},${quote(ordinary.id)},'viewer','active',now()),(${quote(a)},${quote(reverse.id)},'viewer','active',now()),(${quote(b)},${quote(reverse.id)},'member','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role) VALUES(${quote(global.id)},NULL,${quote(globalRole)},${quote(aliases[0])}),(${quote(fake.id)},NULL,${quote(fakeRole)},${quote(aliases[1])}),(${quote(ordinary.id)},${quote(a)},${quote(role)},${quote(key)}),(${quote(ordinary.id)},${quote(b)},${quote(viewerRole)},${quote(viewerKey)}),(${quote(reverse.id)},${quote(b)},${quote(role)},${quote(key)}),(${quote(reverse.id)},${quote(a)},${quote(viewerRole)},${quote(viewerKey)});
    INSERT INTO public.permissions(key,name,description,category) SELECT key,key,'Synthetic contract authority','test' FROM unnest(ARRAY['contracts.archive','contracts.publish','pricing.publish']) AS candidate(key) ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${quote(role)},${quote(key)},id,key FROM public.permissions WHERE key IN('contracts.archive','contracts.publish','pricing.publish');
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${quote(fakeRole)},${quote(aliases[1])},id,key FROM public.permissions WHERE key='contracts.archive';
    SELECT to_jsonb(count(*)) FROM public.company_memberships WHERE user_id=${quote(ordinary.id)};`)
  const offerA = await draft(a, global.id), offerB = await draft(b, global.id)
  const before = graph(a,b)
  expect(sql<boolean>(`SELECT to_jsonb(public.gridex_contract_actor_has_company_permission(${quote(global.id)},${quote(b)},'contracts.archive'));`)).toBe(false)
  const context = await ordinary.client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: b })
  expect(context.error).toBeNull(); expect(context.data).toMatchObject({ authorized: true, is_platform_admin: false, selected_company_id: b })
  expect((context.data as { permissions: string[] }).permissions).not.toContain('contracts.archive')
  const reverseContext = await reverse.client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: a })
  expect(reverseContext.error).toBeNull(); expect(reverseContext.data).toMatchObject({ authorized: true, is_platform_admin: false, selected_company_id: a })
  expect((reverseContext.data as { permissions: string[] }).permissions).not.toContain('contracts.archive')
  expect(await has(ordinary.id,a)).toBe(true); expect(await has(ordinary.id,b)).toBe(false)
  expect(await has(reverse.id,b)).toBe(true); expect(await has(reverse.id,a)).toBe(false)
  const reverseDenied = await service.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: a, p_offer_id: offerA, p_mode: 'archive', p_actor_user_id: reverse.id, p_expected_preview_token: null })
  expect(reverseDenied.error?.code).toBe('42501'); expect(graph(a,b)).toEqual(before)
  for (const actor of [ordinary.id, fake.id]) {
    const denied = await service.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: b, p_offer_id: offerB, p_mode: 'archive', p_actor_user_id: actor, p_expected_preview_token: null })
    expect(denied.error?.code).toBe('42501'); expect(graph(a,b)).toEqual(before)
  }
  for (const client of [anonymous, ordinary.client]) {
    const denied = await client.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: b, p_offer_id: offerB, p_mode: 'archive', p_actor_user_id: global.id, p_expected_preview_token: null })
    expect(denied.error?.code).toBe('42501')
    const helperDenied = await client.rpc('gridex_contract_actor_has_company_permission', { p_actor_user_id: global.id, p_company_id: b, p_permission: 'contracts.archive' })
    expect(helperDenied.error?.code).toBe('42501'); expect(graph(a,b)).toEqual(before)
  }
  // The modern insertion guard must reject a tenant-bound platform label.
  sql(`DO $proof$ BEGIN BEGIN INSERT INTO public.user_roles(user_id,company_id,role_id,role) VALUES(${quote(fake.id)},${quote(b)},${quote(fakeRole)},${quote(aliases[1])}); RAISE EXCEPTION 'expected_tenant_platform_guard_denial'; EXCEPTION WHEN check_violation THEN IF SQLERRM NOT IN('tenant_bound_global_platform_role_forbidden','platform_role_must_be_global') THEN RAISE; END IF; END; END $proof$; SELECT to_jsonb(true);`)
  const grant = (permission: string, company: string | null = b) => sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${quote(ordinary.id)},${company ? quote(company) : 'NULL'},id,key FROM public.permissions WHERE key=${quote(permission)}; SELECT to_jsonb(true);`)
  grant('contracts.publish')
  const publishDenied = await service.rpc('gridex_publish_internal_contract_version', { p_company_id: b, p_offer_id: offerB, p_actor_user_id: ordinary.id })
  expect(publishDenied.error?.code).toBe('42501'); expect(publishDenied.error?.message).toBe('contract_permission_denied:pricing.publish')
  expect(graph(a,b)).toEqual(before)
  grant('pricing.publish'); expect(await has(ordinary.id,b,'pricing.publish')).toBe(true)
  grant('contracts.archive',null); expect(await has(ordinary.id,b)).toBe(true)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect) SELECT ${quote(ordinary.id)},${quote(b)},id,key,'deny' FROM public.permissions WHERE key='contracts.archive'; SELECT to_jsonb(true);`)
  expect(await has(ordinary.id,b)).toBe(true)
  for (const mutation of [
    `UPDATE public.company_memberships SET status='revoked' WHERE user_id=${quote(ordinary.id)} AND company_id=${quote(b)}`,
    `UPDATE public.company_memberships SET status='active' WHERE user_id=${quote(ordinary.id)} AND company_id=${quote(b)}; UPDATE public.user_permissions SET status='revoked' WHERE user_id=${quote(ordinary.id)} AND permission_key='contracts.archive' AND effect='allow'`,
    `UPDATE public.user_permissions SET status='active' WHERE user_id=${quote(ordinary.id)}; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=${quote(ordinary.id)}`,
    `UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=${quote(ordinary.id)}`,
    `UPDATE auth.users SET deleted_at=NULL WHERE id=${quote(ordinary.id)}; UPDATE public.user_profiles SET user_status='disabled' WHERE id=${quote(ordinary.id)}`,
  ]) { sql(`${mutation}; SELECT to_jsonb(true);`); expect(await has(ordinary.id,b)).toBe(false); expect(graph(a,b)).toEqual(before) }
  sql(`UPDATE public.user_profiles SET user_status='active' WHERE id=${quote(ordinary.id)}; SELECT to_jsonb(true);`)
  expect(await has(ordinary.id,b)).toBe(true)
  const archive = await service.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: b, p_offer_id: offerB, p_mode: 'archive', p_actor_user_id: ordinary.id, p_expected_preview_token: null })
  expect(archive.error).toBeNull(); expect(archive.data).toMatchObject({ ok: true, changed: true, code: 'contract_archived' })
  expect(sql<string>(`SELECT to_jsonb(lifecycle_status) FROM public.contract_offers WHERE id=${quote(offerA)};`)).toBe('draft')
  expect(sql<string>(`SELECT to_jsonb(lifecycle_status) FROM public.contract_offers WHERE id=${quote(offerB)};`)).toBe('archived')
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE company_id=${quote(b)} AND actor_user_id=${quote(ordinary.id)} AND action='contract.product.archived';`)).toBe(1)
  const repeat = await service.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: b, p_offer_id: offerB, p_mode: 'archive', p_actor_user_id: ordinary.id, p_expected_preview_token: null })
  expect(repeat.error).toBeNull(); expect(repeat.data).toMatchObject({ ok: true, changed: false })
  // Global actor path is preserved, but its own role activity is authoritative.
  expect(await has(global.id,a)).toBe(true)
  sql(`UPDATE public.roles SET is_active=false WHERE id=${quote(globalRole)}; SELECT to_jsonb(true);`)
  expect(await has(global.id,a)).toBe(false)
  sql(`UPDATE public.roles SET is_active=true WHERE id=${quote(globalRole)}; SELECT to_jsonb(true);`)
  const globalArchive = await service.rpc('gridex_remove_internal_contract_offer_v2', { p_company_id: a, p_offer_id: offerA, p_mode: 'archive', p_actor_user_id: global.id, p_expected_preview_token: null })
  expect(globalArchive.error).toBeNull(); expect(globalArchive.data).toMatchObject({ ok: true, changed: true })
  console.log('CONTRACT_AUTHORITY_NATIVE_PASS gotrue=true direct_low_privilege_denied=true exact_target=true denied_graph_unchanged=true correct_tenant_archive=true authoritative_role_scope=true')
})
