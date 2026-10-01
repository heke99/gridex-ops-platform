import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { listWebhookDeliveries, listWebhookSubscriptions } from '@/lib/admin/websiteIntegrationOps'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('webhook_ui_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000, maxBuffer: 32 * 1024 * 1024,
  }).trim()) as T
}
// ROW_FINGERPRINT_PROOF_BEGIN
function databaseRowsFingerprintSql(relation: string, predicate = ''): string {
  return `SELECT to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM ${relation} r ${predicate};`
}
// ROW_FINGERPRINT_PROOF_END
type Actor = { id: string; email: string; roleId: string }
type Resource = { companyId: string; subscriptionId: string; eventId: string; deliveryId: string }
type Fixture = { writer: Actor; reader: Actor; pausedWriter: Actor; resources: Resource[];
  original: Record<string, string>; ownedBefore: Record<string, unknown>; identityBefore: unknown }
const immutableTables = [
  'customers', 'customer_contracts', 'billing_underlays', 'pricing_runs', 'pricing_preview_lines',
  'customer_invoices', 'invoice_export_items', 'invoice_export_runs', 'invoice_export_attempts',
  'billing_export_runs', 'billing_export_run_items', 'invoice_purchase_events',
]
function originalSnapshot(actorIds: string[]): Record<string, string> {
  const snapshots: Record<string, string> = {}
  for (const table of immutableTables) {
    // Required real tables may not be silently replaced with an empty fixture.
    snapshots[table] = sql<string>(databaseRowsFingerprintSql(`public.${table}`))
  }
  const originalActors = actorIds.length ? `WHERE id NOT IN(${actorIds.map(quote).join(',')})` : ''
  snapshots.originalAuthUsers = sql<string>(databaseRowsFingerprintSql('auth.users', originalActors))
  snapshots.originalProfiles = sql<string>(databaseRowsFingerprintSql('public.user_profiles', originalActors))
  return snapshots
}
function identity(actorIds: string[]) {
  return sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'email',a.email,'confirmed',a.email_confirmed_at,
    'metadata',a.raw_user_meta_data,'banned',a.banned_until,'deleted',a.deleted_at,'profile',to_jsonb(p)) ORDER BY a.id),'[]'::jsonb)
    FROM auth.users a JOIN public.user_profiles p ON p.id=a.id WHERE a.id IN(${actorIds.map(quote).join(',')});`)
}
function ownedSnapshot(f: Pick<Fixture, 'resources'>): Record<string, unknown> {
  const companies = f.resources.map(row => quote(row.companyId)).join(',')
  return sql(`SELECT jsonb_build_object(
    'deliveries',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.webhook_deliveries d WHERE company_id IN(${companies})),
    'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.webhook_subscriptions s WHERE company_id IN(${companies})),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.domain_events e WHERE company_id IN(${companies})),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]'::jsonb) FROM public.event_outbox o JOIN public.domain_events e ON e.id=o.domain_event_id WHERE e.company_id IN(${companies})),
    'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.audit_logs a WHERE company_id IN(${companies})));`)
}
async function context(actor: Actor, companyId: string, expectedWrite: boolean) {
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email: actor.email, password: process.env.GRIDEX_WEBHOOK_UI_PASSWORD! })
  expect(login.error).toBeNull()
  expect(login.data.user?.id).toBe(actor.id)
  const receipt = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
  expect(receipt.error).toBeNull()
  expect(receipt.data).toMatchObject({ authorized: true, user_id: actor.id, selected_company_id: companyId, is_platform_admin: false })
  const permissions = (receipt.data as { permissions: string[] }).permissions
  expect(permissions).toContain('integrations.read')
  expect(permissions.includes('integrations.write')).toBe(expectedWrite)
  // The probe owns only its new session. Global sign-out would revoke the
  // browser's independent session and replace permission-loss with logout.
  expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull()
}
async function actor(companyId: string, tag: string, canWrite: boolean): Promise<Actor> {
  const email = `webhook-ui-${tag}-${companyId.slice(0, 8)}@example.invalid`
  const result = await supabaseService.auth.admin.createUser({ email, password: process.env.GRIDEX_WEBHOOK_UI_PASSWORD!,
    email_confirm: true, user_metadata: { full_name: 'Synthetic webhook actor' } })
  if (result.error || !result.data.user) throw new Error('webhook_ui_genuine_auth_creation_failed')
  const id = result.data.user.id, roleId = randomUUID(), roleKey = `webhook_ui_${tag}_${roleId.replaceAll('-', '')}`
  const keys = ['integrations.read', ...(canWrite ? ['integrations.write'] : [])].map(quote).join(',')
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(id)},${quote(email)},'Synthetic webhook actor','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope,is_active) VALUES(${quote(roleId)},${quote(roleKey)},'Synthetic webhook role','company',true);
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at)
      VALUES(${quote(companyId)},${quote(id)},'owner','active',true,now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${quote(id)},${quote(companyId)},${quote(roleId)},${quote(roleKey)},'active',true);
    INSERT INTO public.permissions(key,name,description,category) SELECT key,key,'Disposable webhook fixture','test' FROM unnest(ARRAY[${keys}]::text[]) AS keys(key) ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect) SELECT ${quote(roleId)},${quote(roleKey)},id,key,'allow'
      FROM public.permissions WHERE key IN(${keys}); SELECT to_jsonb(true);`)
  return { id, email, roleId }
}

it('uses genuine local Auth and independent whole-graph postchecks for the isolated ignore browser path', async () => {
  const path = resolve(process.env.GRIDEX_WEBHOOK_UI_FIXTURE_PATH!), temp = process.env.RUNNER_TEMP
  if (!temp || !path.startsWith(resolve(temp) + sep)) throw new Error('webhook_ui_fixture_must_stay_in_runner_temp')
  const phase = process.env.GRIDEX_WEBHOOK_UI_FIXTURE_PHASE ?? 'seed'
  if (!['seed', 'revoke-writer', 'restore-writer', 'post-browser', 'cleanup'].includes(phase)) throw new Error('webhook_ui_unknown_phase')
  if (phase === 'seed') {
    if (existsSync(path)) throw new Error('webhook_ui_fixture_already_exists')
    const original = originalSnapshot([])
    const resources = Array.from({ length: 3 }, () => ({ companyId: randomUUID(), subscriptionId: randomUUID(), eventId: randomUUID(), deliveryId: randomUUID() }))
    for (const [index, row] of resources.entries()) {
      sql(`INSERT INTO public.companies(id,name,legal_name,status,operating_environment,country_code)
        VALUES(${quote(row.companyId)},${quote(`Synthetic webhook company ${index}`)},${quote(`Synthetic webhook company ${index}`)},${quote(index === 2 ? 'paused' : 'active')},'test','SE');
        INSERT INTO public.webhook_subscriptions(id,company_id,name,endpoint_url,event_types,status)
        VALUES(${quote(row.subscriptionId)},${quote(row.companyId)},${quote(`Synthetic webhook subscription ${index}`)},'https://example.invalid/never-dispatch',ARRAY['webhook.test'],'paused');
        INSERT INTO public.domain_events(id,company_id,event_type,aggregate_type,aggregate_id,source,payload,idempotency_key)
        VALUES(${quote(row.eventId)},${quote(row.companyId)},'webhook.test','synthetic_ui',${quote(row.subscriptionId)},'synthetic_ui','{}',${quote(`webhook-ui-${row.eventId}`)});
        INSERT INTO public.webhook_deliveries(id,company_id,webhook_subscription_id,domain_event_id,event_type,status,attempts,max_attempts,next_attempt_at,idempotency_key,payload,target_url)
        VALUES(${quote(row.deliveryId)},${quote(row.companyId)},${quote(row.subscriptionId)},${quote(row.eventId)},'webhook.test','failed',1,8,'2999-01-01',${quote(`webhook-ui-${row.deliveryId}`)},'{"synthetic":"immutable"}','https://example.invalid/never-dispatch'); SELECT to_jsonb(true);`)
    }
    const writer = await actor(resources[0].companyId, 'writer', true), reader = await actor(resources[0].companyId, 'reader', false)
    const pausedWriter = await actor(resources[2].companyId, 'paused', true)
    await context(writer, resources[0].companyId, true); await context(reader, resources[0].companyId, false)
    await context(pausedWriter, resources[2].companyId, true)
    // This executes the existing production loaders against real PostgREST.
    // Absent legacy columns/relationships must block preparation, never get
    // manufactured by the fixture or turn into an empty-but-passing browser.
    for (const row of resources) {
      expect((await listWebhookSubscriptions({ companyId: row.companyId })).map(item => item.id)).toEqual([row.subscriptionId])
      expect((await listWebhookDeliveries({ companyId: row.companyId })).map(item => item.id)).toEqual([row.deliveryId])
    }
    expect(originalSnapshot([writer.id, reader.id, pausedWriter.id])).toEqual(original)
    const f: Fixture = { writer, reader, pausedWriter, resources, original,
      ownedBefore: {}, identityBefore: identity([writer.id, reader.id, pausedWriter.id]) }
    f.ownedBefore = ownedSnapshot(f)
    writeFileSync(path, JSON.stringify(f), { mode: 0o600 })
    console.log('WEBHOOK_UI_NATIVE_SEED_PASS genuine_auth=true canonical_writer_reader=true actual_loaders=true future_retry_paused_subscription=true')
    return
  }
  const f = JSON.parse(readFileSync(path, 'utf8')) as Fixture
  const actorIds = [f.writer.id, f.reader.id, f.pausedWriter.id], companyA = f.resources[0].companyId
  if (phase === 'revoke-writer' || phase === 'restore-writer') {
    const effect = phase === 'revoke-writer' ? 'deny' : 'allow'
    expect(sql<number>(`WITH changed AS (UPDATE public.role_permissions SET effect=${quote(effect)} WHERE role_id=${quote(f.writer.roleId)}
      AND permission_key='integrations.write' RETURNING id) SELECT count(*)::int FROM changed;`)).toBe(1)
    await context(f.writer, companyA, effect === 'allow')
    expect(originalSnapshot(actorIds)).toEqual(f.original)
    expect(ownedSnapshot(f)).toEqual(f.ownedBefore)
    expect(identity(actorIds)).toEqual(f.identityBefore)
    console.log(`WEBHOOK_UI_NATIVE_CURRENT_GRANT_${effect === 'allow' ? 'RESTORED' : 'REVOKED'} original_and_owned_graph_unchanged=true`)
    return
  }
  if (phase === 'post-browser') {
    await context(f.writer, companyA, true); await context(f.reader, companyA, false)
    expect(originalSnapshot(actorIds)).toEqual(f.original)
    expect(identity(actorIds)).toEqual(f.identityBefore)
    const actual = ownedSnapshot(f), before = f.ownedBefore
    expect(actual.subscriptions).toEqual(before.subscriptions); expect(actual.events).toEqual(before.events); expect(actual.outbox).toEqual(before.outbox)
    const prior = before.deliveries as Array<Record<string, unknown>>, after = actual.deliveries as Array<Record<string, unknown>>
    expect(after).toHaveLength(3)
    for (const old of prior) {
      const current = after.find(row => row.id === old.id)!
      if (old.id === f.resources[0].deliveryId) {
        expect(current).toMatchObject({ status: 'skipped', manual_status: 'ignored', manual_note: 'Manuellt hanterad från delivery UI' })
        expect(current.updated_at).not.toBe(old.updated_at)
        const omitted = ['status', 'manual_status', 'manual_note', 'updated_at']
        expect(Object.fromEntries(Object.entries(current).filter(([key]) => !omitted.includes(key))))
          .toEqual(Object.fromEntries(Object.entries(old).filter(([key]) => !omitted.includes(key))))
      } else expect(current).toEqual(old)
    }
    const priorAudits = before.audits as Array<Record<string, unknown>>, audits = actual.audits as Array<Record<string, unknown>>
    const added = audits.filter(row => !priorAudits.some(old => old.id === row.id))
    expect(audits.filter(row => priorAudits.some(old => old.id === row.id))).toEqual(priorAudits)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ company_id: companyA, actor_user_id: f.writer.id, action: 'webhook.delivery_ignored',
      entity_id: f.resources[0].deliveryId, new_values: { note: 'Manuellt hanterad från delivery UI' } })
    console.log('WEBHOOK_UI_NATIVE_POSTCHECK_PASS exact_one_ignore_and_audit=true foreign_original_finance_and_identity_unchanged=true no_event_or_queue_change=true')
    return
  }
  // Retain synthetic companies/legal versions and GoTrue actors until the
  // disposable stack teardown. Remove only this fixture's mutable queue graph.
  for (const row of f.resources) sql(`DELETE FROM public.webhook_deliveries WHERE id=${quote(row.deliveryId)} AND company_id=${quote(row.companyId)};
    DELETE FROM public.event_outbox WHERE domain_event_id=${quote(row.eventId)};
    DELETE FROM public.domain_events WHERE id=${quote(row.eventId)} AND company_id=${quote(row.companyId)} AND source='synthetic_ui';
    DELETE FROM public.webhook_subscriptions WHERE id=${quote(row.subscriptionId)} AND company_id=${quote(row.companyId)}; SELECT to_jsonb(true);`)
  expect(originalSnapshot(actorIds)).toEqual(f.original)
  console.log('WEBHOOK_UI_NATIVE_CLEANUP_PASS only_owned_mutable_webhook_graph_removed=true')
})
