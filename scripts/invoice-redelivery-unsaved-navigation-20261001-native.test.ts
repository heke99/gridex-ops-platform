import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
type Actor = { userId: string; sessionId: string; email: string }
type Context = { companyId: string; companyB: string; customerId: string; invoiceId: string;
  invoiceExportItemId: string; accountId: string; actorUserId: string; sessionId: string; expectedRevision: number; expectedOverrideRevision: number }
type Fixture = { context: Context; writer: Actor; reader: Actor; financialBefore: unknown; foreignBefore: unknown;
  identityBefore: unknown; customerBefore: unknown; decisionCount: number; eventCount: number; expectedReason: string }
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('redelivery_navigation_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: command, encoding: 'utf8', timeout: 20_000 }).trim()) as T
}
function identity(writer: Actor) {
  return sql<unknown>(`select jsonb_build_object('email',a.email,'confirmed',a.email_confirmed_at,'metadata',a.raw_user_meta_data,
    'profile',to_jsonb(p)) from auth.users a join public.user_profiles p on p.id=a.id where a.id=${quote(writer.userId)};`)
}
function financial(c: Context) {
  return sql<unknown>(`with invoice as(select * from public.customer_invoices where id=${quote(c.invoiceId)} and company_id=${quote(c.companyId)}),
    item as(select i.* from public.invoice_export_items i join invoice n on n.invoice_export_item_id=i.id and n.company_id=i.company_id)
    select jsonb_build_object('invoice',(select to_jsonb(n) from invoice n),'item',(select to_jsonb(i) from item i),
      'underlay',(select to_jsonb(u) from public.billing_underlays u join item i on i.billing_underlay_id=u.id and i.company_id=u.company_id),
      'pricing',(select to_jsonb(p) from public.pricing_runs p join item i on i.pricing_run_id=p.id and i.company_id=p.company_id),
      'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.customer_invoice_lines l where invoice_id=${quote(c.invoiceId)}),
      'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from public.customer_invoice_documents d where invoice_id=${quote(c.invoiceId)}));`)
}
function foreign(c: Context) {
  return sql<unknown>(`select jsonb_build_object('company',(select to_jsonb(c) from public.companies c where id=${quote(c.companyB)}),
    'customers',(select jsonb_agg(to_jsonb(c) order by id) from public.customers c where company_id=${quote(c.companyB)}),
    'decisions',(select count(*) from public.invoice_redelivery_decisions where company_id=${quote(c.companyB)}),
    'events',(select count(*) from public.domain_events where company_id=${quote(c.companyB)}));`)
}
async function realActor(tag: string): Promise<Actor> {
  const email = `redelivery-nav-${tag}-${randomUUID()}@example.invalid`
  const created = await supabaseService.auth.admin.createUser({ email, password: process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD!, email_confirm: true })
  if (created.error || !created.data.user) throw new Error('redelivery_navigation_real_auth_create_failed')
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await client.auth.signInWithPassword({ email, password: process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD! })
  expect(login.error).toBeNull()
  if (!login.data.session) throw new Error('redelivery_navigation_real_session_missing')
  const claims = JSON.parse(Buffer.from(login.data.session.access_token.split('.')[1], 'base64url').toString()) as { session_id: string; sub: string }
  expect(claims.sub).toBe(created.data.user.id)
  expect(claims.session_id).toMatch(/^[a-f0-9-]{36}$/)
  expect((await client.auth.getUser()).data.user?.email_confirmed_at).toBeTruthy()
  return { userId: created.data.user.id, sessionId: claims.session_id, email }
}
function replaceExactly(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('redelivery_navigation_trusted_seed_boundary_changed')
  return source.replace(before, after)
}
function realHistoricalSeed(writer: Actor, reader: Actor): Context {
  // Reuse only the frozen synthetic issued-graph prefix, before its first
  // decision. Real GoTrue identities/sessions replace the SQL-only actors;
  // no original fixture bytes or existing customer's identity are edited.
  const source = readFileSync(resolve(__dirname, 'invoice-redelivery-decision-20260930-native.sql'), 'utf8')
  if (createHash('sha256').update(source).digest('hex') !== '1be2857589eece2d915b0c916129cdc2a774682e297010f8e4e2cd53052c1cd3') {
    throw new Error('redelivery_navigation_frozen_history_source_changed')
  }
  const boundary = '  decision:=public.gridex_record_invoice_redelivery_decision_v1(command);'
  if (source.split(boundary).length !== 2) throw new Error('redelivery_navigation_trusted_history_boundary_missing')
  let seed = source.slice(0, source.indexOf(boundary))
  for (const [name, value] of [['staff', writer.userId], ['reader', reader.userId], ['session_staff', writer.sessionId], ['session_reader', reader.sessionId]]) {
    seed = replaceExactly(seed, `gen_random_uuid() as ${name}`, `${quote(value)}::uuid as ${name}`)
  }
  const authStart = seed.indexOf('insert into auth.users('), authEnd = seed.indexOf('insert into public.user_profiles(')
  if (authStart < 0 || authEnd <= authStart) throw new Error('redelivery_navigation_auth_seed_boundary_missing')
  seed = seed.slice(0, authStart) + seed.slice(authEnd)
  seed = replaceExactly(seed, "select id,id::text||'@example.invalid','Synthetic billing actor','active'",
    `select id,case when id=${quote(writer.userId)} then ${quote(writer.email)} else ${quote(reader.email)} end,'Synthetic billing actor','active'`)
  seed = replaceExactly(seed, "from unnest(array[:'staff'::uuid,:'reader'::uuid]) id;",
    "from unnest(array[:'staff'::uuid,:'reader'::uuid]) id on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,user_status='active';")
  seed = replaceExactly(seed, ":'staff'||'@example.invalid'", quote(writer.email))
  seed = replaceExactly(seed, "jsonb_build_object('email',actor::text||'@example.invalid')", `jsonb_build_object('email',${quote(writer.email)})`)
  const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: seed + `
    perform set_config('gridex.redelivery.navigation_context',(command||jsonb_build_object('invoiceExportItemId',item,
      'companyB',current_setting('gridex.billingtest.cb')))::text,true);
    end;$proof$;select current_setting('gridex.redelivery.navigation_context');commit;`, encoding: 'utf8', timeout: 20_000 })
    .trim().split('\n').filter(line => line.startsWith('{')).at(-1)
  if (!output) throw new Error('redelivery_navigation_history_context_missing')
  return JSON.parse(output) as Context
}
async function addCanonicalRole(companyId: string, actor: Actor, keys: string[]) {
  const roleId = randomUUID(), roleKey = `redelivery_nav_${roleId.replaceAll('-', '')}`
  sql(`insert into public.roles(id,key,name,scope) values(${quote(roleId)},${quote(roleKey)},'Synthetic redelivery navigation role','company');
    insert into public.user_roles(user_id,company_id,role_id,role,status,is_active)
      values(${quote(actor.userId)},${quote(companyId)},${quote(roleId)},${quote(roleKey)},'active',true);
    insert into public.permissions(key,name) select key,key from unnest(array[${keys.map(quote).join(',')}]::text[]) t(key) on conflict(key) do nothing;
    insert into public.role_permissions(role_id,role_key,permission_id,permission_key)
      select ${quote(roleId)},${quote(roleKey)},id,key from public.permissions where key in(${keys.map(quote).join(',')});select to_jsonb(true);`)
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  expect((await client.auth.signInWithPassword({ email: actor.email, password: process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD! })).error).toBeNull()
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
  expect(context.error).toBeNull()
  expect(context.data).toMatchObject({ authorized: true, selected_company_id: companyId })
  for (const key of keys) expect(context.data.permissions).toContain(key)
  return context.data as { permissions: string[] }
}

it('fresh real Auth fixture and independent durable postcheck qualify the redelivery navigation scenario', async () => {
  const fixturePath = resolve(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH!), temp = process.env.RUNNER_TEMP
  if (!temp || !fixturePath.startsWith(resolve(temp) + sep)) throw new Error('redelivery_navigation_fixture_must_stay_in_runner_temp')
  const phase = process.env.GRIDEX_REDELIVERY_NAVIGATION_PHASE
  if (!['browser-seed', 'browser-postcheck'].includes(phase ?? '')) throw new Error('redelivery_navigation_unknown_phase')
  if (phase === 'browser-postcheck') {
    const f = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture, c = f.context
    expect(financial(c)).toEqual(f.financialBefore)
    expect(foreign(c)).toEqual(f.foreignBefore)
    expect(identity(f.writer)).toEqual(f.identityBefore)
    expect(sql<unknown>(`select to_jsonb(c) from public.customers c where id=${quote(c.customerId)};`)).toEqual(f.customerBefore)
    const decisions = sql<Array<Record<string, unknown>>>(`select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]'::jsonb)
      from public.invoice_redelivery_decisions d where company_id=${quote(c.companyId)};`)
    expect(decisions).toHaveLength(f.decisionCount + 1)
    expect(decisions[0]).toMatchObject({ company_id: c.companyId, customer_id: c.customerId, invoice_id: c.invoiceId,
      account_id: c.accountId, actor_user_id: f.writer.userId, verified_auth_user_id: f.writer.userId,
      destination_email: f.writer.email, billing_profile_revision: 1, contract_override_revision: 0,
      reason: f.expectedReason, status: 'verified_delivery_decision', delivery_status: 'blocked_provider_adapter' })
    const audit = sql<Record<string, unknown>>(`select to_jsonb(e) from public.domain_events e where id=${quote(String(decisions[0].audit_event_id))};`)
    expect(audit).toMatchObject({ company_id: c.companyId, event_type: 'invoice.redelivery.decision_verified', actor_user_id: f.writer.userId,
      aggregate_id: decisions[0].id, payload: { delivery_status: 'blocked_provider_adapter' } })
    expect(sql<number>(`select to_jsonb(count(*)) from public.domain_events where company_id=${quote(c.companyId)};`)).toBe(f.eventCount + 1)
    console.log('REDELIVERY_NAVIGATION_NATIVE_POSTCHECK_PASS decision1=true original_financial_graph_unchanged=true foreign_unchanged=true identity_unchanged=true provider_delivery_blocked=true')
    return
  }
  const writer = await realActor('writer'), reader = await realActor('reader'), context = realHistoricalSeed(writer, reader)
  await addCanonicalRole(context.companyId, writer, ['billing_underlay.read', 'billing_underlay.export', 'masterdata.read', 'masterdata.write', 'customers.read'])
  const readerContext = await addCanonicalRole(context.companyId, reader, ['billing_underlay.read', 'masterdata.read', 'customers.read'])
  expect(readerContext.permissions).not.toContain('billing_underlay.export')
  const detail = await getInvoiceReviewDetail({ companyId: context.companyId, invoiceExportItemId: context.invoiceExportItemId })
  expect(detail.lifecycleStage).toBe('dispatched')
  expect(detail.invoice?.id).toBe(context.invoiceId)
  const profile = resolveEffectiveBillingProfile({ companyId: context.companyId, customerId: context.customerId,
    customer: detail.customer, contract: detail.contract })
  expect(profile).toMatchObject({ email: writer.email, distributionMethod: 'email', profileRevision: 1, contractOverrideRevision: 0, blockers: [] })
  expect(sql<Record<string, unknown>>(`select to_jsonb(a) from public.customer_portal_accounts a where id=${quote(context.accountId)};`))
    .toMatchObject({ company_id: context.companyId, customer_id: context.customerId, user_id: writer.userId, portal_user_id: writer.userId, status: 'active', is_active: true, role: 'owner' })
  const decisionCount = sql<number>(`select to_jsonb(count(*)) from public.invoice_redelivery_decisions where company_id=${quote(context.companyId)};`)
  expect(decisionCount).toBe(0)
  const fixture: Fixture = { context, writer, reader, financialBefore: financial(context), foreignBefore: foreign(context), identityBefore: identity(writer),
    customerBefore: sql<unknown>(`select to_jsonb(c) from public.customers c where id=${quote(context.customerId)};`), decisionCount,
    eventCount: sql<number>(`select to_jsonb(count(*)) from public.domain_events where company_id=${quote(context.companyId)};`),
    expectedReason: 'Synthetic browser separately verified delivery decision' }
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 })
  console.log('REDELIVERY_NAVIGATION_NATIVE_SEED_PASS real_auth=true current_owner=true scoped_reader=true actual_dispatched_detail=true decisions0=true')
})
