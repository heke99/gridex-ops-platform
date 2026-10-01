import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const transport = vi.hoisted(() => ({ requests: [] as Array<{ payload: Row; key: string }>, reject: false }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), unstable_rethrow: () => undefined }))
// Only the external partner boundary is replaced. Native company/customer,
// readiness, revision lock, pricing, graph creation, provider-request CAS,
// automation locks, invoice writes, audit and outbox code all run unchanged.
vi.mock('@/lib/integrations/billing/capway/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/integrations/billing/capway/client')>(),
  CapwayApticClient: class {
    constructor(config: { environment: string; baseUrl: string; authMode: string; apiKey: string }) {
      expect(config).toMatchObject({ environment: 'test', baseUrl: 'http://127.0.0.1:1', authMode: 'apikey', apiKey: 'synthetic-native-never-a-provider-key' })
    }
    async createInvoices(payloads: Row[], key: string) {
      expect(payloads).toHaveLength(1)
      transport.requests.push({ payload: structuredClone(payloads[0]), key })
      if (transport.reject) throw new Error('ETIMEDOUT synthetic native external boundary')
      return { invoiceGuids: [`synthetic-native-${String(payloads[0].externalReferenceCode)}`], invoiceNumber: 'SYNTHETIC-NATIVE' }
    }
    async postPurchase() { throw new Error('billing_native_unexpected_purchase') }
  },
}))

import { changeCustomerBillingProfile, changeContractBillingOverride } from '@/lib/billing/billingProfileCommand'
import { evaluateBillingMonthInvoiceReadiness } from '@/lib/billing/invoiceReadiness'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'
import { sendInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256 } from '@/lib/billing/billingConfigurationSnapshot'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import CustomerBillingProfileCard from '@/components/admin/customers/CustomerBillingProfileCard'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API = 'http://127.0.0.1:54321'
const browserPhase = process.env.GRIDEX_BILLING_RECIPIENT_PHASE
if (browserPhase && !['browser-seed', 'browser-postcheck'].includes(browserPhase)) throw new Error('billing_recipient_unknown_phase')
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('billing_recipient_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 20_000 }).trim()) as T
}
async function until(predicate: () => boolean, reason: string) {
  const deadline = Date.now() + 20_000
  while (!predicate()) { if (Date.now() > deadline) throw new Error(reason); await new Promise(done => setTimeout(done, 75)) }
}
type Context = { companyId: string; customerId: string; invoiceId: string; actorUserId: string; sessionId: string }
function historicalSeed(): Context {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('billing_recipient_local_only')
  const source = readFileSync(resolve(__dirname, 'invoice-redelivery-decision-20260930-native.sql'), 'utf8')
  const boundary = source.indexOf('  decision:=public.gridex_record_invoice_redelivery_decision_v1(command);')
  if (boundary < 0) throw new Error('frozen_billing_history_seed_boundary_missing')
  const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: source.slice(0, boundary) + `
      perform set_config('gridex.billing.recipient_context',command::text,true);
    end;$proof$;
    select current_setting('gridex.billing.recipient_context');commit;`, encoding: 'utf8', timeout: 20_000,
  }).trim().split('\n').filter(line => line.startsWith('{')).at(-1)
  if (!output) throw new Error('native_billing_history_context_missing')
  return JSON.parse(output) as Context
}
function originalGraph(c: Context) {
  return sql<Row>(`with invoice as(select * from public.customer_invoices where id=${quote(c.invoiceId)} and company_id=${quote(c.companyId)}),
    item as(select i.* from public.invoice_export_items i join invoice n on n.invoice_export_item_id=i.id and n.company_id=i.company_id)
    select jsonb_build_object('invoice',(select to_jsonb(n) from invoice n),'item',(select to_jsonb(i) from item i),
      'underlay',(select to_jsonb(u) from public.billing_underlays u join item i on i.billing_underlay_id=u.id and i.company_id=u.company_id),
      'pricing',(select to_jsonb(p) from public.pricing_runs p join item i on i.pricing_run_id=p.id and i.company_id=p.company_id),
      'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.customer_invoice_lines l where invoice_id=${quote(c.invoiceId)}),
      'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from public.customer_invoice_documents d where invoice_id=${quote(c.invoiceId)}));`)
}
function actor(c: Context) { return { kind: 'ops' as const, userId: c.actorUserId, sessionId: c.sessionId, reason: 'Synthetic native saved billing recipient' } }
function draftSeed(c: Context) {
  const period = stockholmMonthBounds('2026-10')
  const drafts = [false, true].map(explicit => ({ explicit, contract: randomUUID(), site: randomUUID(), meter: randomUUID(),
    snapshot: randomUUID(), underlay: randomUUID(), pricing: randomUUID() }))
  sql(`update public.companies set org_number='556000-0000',legal_name='Synthetic Native Issuer',operating_environment='test',
      billing_settings='{"provider":"capway_aptic","environment":"test","payment_terms":{"due_days":20},"invoice_profile":{"id":"synthetic-native-billing","status":"active","distribution_method":"email","ocr_policy":"provider_generated","payment_reference_policy":"invoice_number"}}'
      where id=${quote(c.companyId)};
    insert into public.billing_provider_connections(company_id,provider,environment,status,settings,secret_reference)
      values(${quote(c.companyId)},'capway_aptic','test','active',
        '{"auth_mode":"apikey","base_url":"http://127.0.0.1:1","api_key_header":"x-synthetic-native","default_service":"Synthetic Native Invoice","default_financing_mode":"invoice_service"}',
        '{"api_key_env":"GRIDEX_BILLING_RECIPIENT_SYNTHETIC_KEY"}');select to_jsonb(true);`)
  for (const d of drafts) sql(`insert into public.customer_sites(id,company_id,customer_id,site_name,street,postal_code,city,country,price_area_code)
      values(${quote(d.site)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic native billing site','Synthetic Street','11111','Synthetic City','SE','SE3');
    insert into public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,status,price_area_code)
      values(${quote(d.meter)},${quote(c.companyId)},${quote(c.customerId)},${quote(d.site)},${quote(d.site)},${quote('735999'+d.meter.replaceAll('-','').slice(0,12))},'active','SE3');
    insert into public.customer_contracts(id,company_id,customer_id,customer_site_id,site_id,contract_name,status,vat_rate,price_area_used,invoice_email)
      values(${quote(d.contract)},${quote(c.companyId)},${quote(c.customerId)},${quote(d.site)},${quote(d.site)},${quote(d.explicit ? 'Synthetic explicit billing contract' : 'Synthetic inherited billing contract')},'active',0.25,'SE3',${d.explicit ? "'agency-original@example.invalid'" : 'null'});
    insert into public.contract_price_snapshots(id,company_id,contract_id,customer_id,pricing_model,snapshot_json)
      values(${quote(d.snapshot)},${quote(c.companyId)},${quote(d.contract)},${quote(c.customerId)},'spot','{"price_area":"SE3","vat_rate":0.25}');
    update public.customer_contracts set contract_price_snapshot_id=${quote(d.snapshot)} where id=${quote(d.contract)};
    insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,contract_id,customer_contract_id,status,start_date,end_date)
      values(${quote(c.companyId)},${quote(c.customerId)},${quote(d.meter)},${quote(d.contract)},${quote(d.contract)},'active','2026-10-01','2026-10-31');
    insert into public.normalized_metering_values(company_id,customer_id,customer_site_id,site_id,metering_point_id,period_start,period_end,quantity_kwh,quality_status,source_type)
      values(${quote(c.companyId)},${quote(c.customerId)},${quote(d.site)},${quote(d.site)},${quote(d.meter)},${quote(period.start)},${quote(period.end)},1,'actual','native_synthetic');
    insert into public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,customer_site_id,site_id,metering_point_id,
      underlay_year,underlay_month,status,readiness_status,total_kwh,missing_values_count,contract_price_snapshot_id,price_area,calculated_total_sek_inc_vat,billing_period_start,billing_period_end)
      values(${quote(d.underlay)},${quote(c.companyId)},${quote(c.customerId)},${quote(d.contract)},${quote(d.contract)},${quote(d.site)},${quote(d.site)},${quote(d.meter)},
        2026,10,'validated','ready',1,0,${quote(d.snapshot)},'SE3',125,'2026-10-01','2026-10-31');
    insert into public.pricing_runs(id,company_id,billing_underlay_id,customer_id,status,total_ex_vat,vat_amount,total_inc_vat,billing_period_start,billing_period_end)
      values(${quote(d.pricing)},${quote(c.companyId)},${quote(d.underlay)},${quote(c.customerId)},'success',100,25,125,'2026-10-01','2026-10-31');
    insert into public.pricing_preview_lines(company_id,pricing_run_id,billing_underlay_id,line_type,description,quantity,unit,unit_price_ex_vat,amount_ex_vat,vat_rate,vat_amount,amount_inc_vat)
      values(${quote(c.companyId)},${quote(d.pricing)},${quote(d.underlay)},'energy','Synthetic native electricity',1,'kWh',100,100,0.25,25,125);
    update public.pricing_runs set status='locked',locked_at=clock_timestamp() where id=${quote(d.pricing)};
    select to_jsonb(true);`)
  return drafts
}

it.skipIf(Boolean(browserPhase)).each(['canonical', 'approved'] as const)('T14/T15/T16/T18/T44 native saved recipient/revision survives real readiness overlap and %s sender', async sender => {
  transport.requests = []
  transport.reject = false
  vi.stubEnv('GRIDEX_BILLING_RECIPIENT_SYNTHETIC_KEY', 'synthetic-native-never-a-provider-key')
  const c = historicalSeed(), original = originalGraph(c), drafts = draftSeed(c)
  const first = await changeCustomerBillingProfile({ companyId: c.companyId, customerId: c.customerId, actor: actor(c),
    expectedRevision: 1, idempotencyKey: `billing-recipient-first:${randomUUID()}`,
    changes: { recipient: 'Saved Native Recipient', email: 'saved-native@example.invalid', country: 'NO' } })
  expect(first.revision).toBe(2)
  const name = `billing_readiness_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
  const blocker = spawn('psql', [`${DB}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let output = ''
  blocker.stdout.setEncoding('utf8').on('data', part => { output += part })
  const exited = new Promise<number>((done, reject) => { blocker.once('error', reject); blocker.once('exit', code => done(code ?? -1)) })
  let pending: Promise<unknown> | null = null
  try {
    blocker.stdin.write(`begin;select id from public.customers where id=${quote(c.customerId)} and company_id=${quote(c.companyId)} for update;\n\\echo BILLING_RECIPIENT_CUSTOMER_HELD\n`)
    await until(() => output.includes('BILLING_RECIPIENT_CUSTOMER_HELD'), 'billing_recipient_customer_not_held')
    pending = evaluateBillingMonthInvoiceReadiness({ companyId: c.companyId, billingMonth: '2026-10' })
    // Keep an early preflight rejection handled while the independent observer
    // waits. The original promise remains available for the exact assertion.
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    // Observe the actual Data API RPC waiting on this exact blocker. Only one
    // native readiness call exists in this serial fixture; no inferred sleep.
    await until(() => {
      if (settled) throw new Error('billing_real_readiness_completed_before_expected_lock')
      return sql<boolean>(`select to_jsonb(exists(select 1 from pg_stat_activity w join pg_stat_activity b
      on b.application_name=${quote(name)} where w.wait_event_type='Lock' and b.pid=any(pg_blocking_pids(w.pid))
      and w.query like '%gridex_lock_billing_configuration_v2%'));`)
    }, 'billing_real_readiness_rpc_wait_not_observed')
    const change = { companyId: c.companyId, customerId: c.customerId, mode: 'ops', actorUserId: c.actorUserId,
      sessionId: c.sessionId, expectedRevision: 2, reason: 'Synthetic native profile change during actual readiness lock',
      idempotencyKey: `billing-recipient-overlap:${randomUUID()}`, changes: { recipient: 'Saved Concurrent Recipient', email: 'saved-concurrent@example.invalid', country: 'NO' } }
    blocker.stdin.end(`set local role service_role;select public.gridex_change_customer_billing_profile_v1(${quote(JSON.stringify(change))}::jsonb);commit;\n`)
    expect(await exited).toBe(0)
    await expect(pending).rejects.toMatchObject({ code: 'billing_profile_revision_conflict' })
    pending = null
    expect(sql<number>(`select to_jsonb(count(*)) from public.billing_underlays where id in(${drafts.map(d => quote(d.underlay)).join(',')}) and billing_configuration_snapshot is not null;`)).toBe(0)
  } finally {
    if (blocker.exitCode === null) blocker.kill('SIGTERM')
    if (pending) await pending.catch(() => undefined)
  }
  const ready = await evaluateBillingMonthInvoiceReadiness({ companyId: c.companyId, billingMonth: '2026-10' })
  expect(ready.readyUnderlayIds.sort()).toEqual(drafts.map(d => d.underlay).sort())
  const locked = sql<Array<{ id: string; snapshot: Row; hash: string }>>(`select jsonb_agg(jsonb_build_object('id',id,'snapshot',billing_configuration_snapshot,
    'hash',billing_configuration_snapshot_sha256) order by id) from public.billing_underlays where id in(${drafts.map(d => quote(d.underlay)).join(',')});`)
  for (const d of drafts) {
    const row = locked.find(row => row.id === d.underlay)!
    expect(row.hash).toBe(billingConfigurationSnapshotSha256(row.snapshot))
    expect(row.snapshot.effective_billing_profile).toMatchObject({ recipient: 'Saved Concurrent Recipient',
      email: d.explicit ? 'agency-original@example.invalid' : 'saved-concurrent@example.invalid', profileRevision: 3,
      contractOverrideRevision: 0, distributionMethod: 'email', address: { country: 'NO' },
      sources: { email: d.explicit ? 'contract_override' : 'customer_default' } })
  }
  await changeCustomerBillingProfile({ companyId: c.companyId, customerId: c.customerId, actor: actor(c), expectedRevision: 3,
    idempotencyKey: `billing-recipient-later:${randomUUID()}`, changes: { recipient: 'Later Live Recipient', email: 'later-live@example.invalid', country: 'DK' } })
  const explicit = drafts.find(d => d.explicit)!
  await changeContractBillingOverride({ companyId: c.companyId, customerId: c.customerId, contractId: explicit.contract, actor: actor(c),
    expectedRevision: 4, expectedOverrideRevision: 0, idempotencyKey: `billing-recipient-override-later:${randomUUID()}`,
    changes: { email: 'agency-later@example.invalid' }, inheritFields: [] })
  const prepared = await prepareInvoiceDraftsForReview({ companyId: c.companyId, billingMonth: '2026-10', actorUserId: c.actorUserId })
  expect(prepared).toMatchObject({ created: 2, failed: 0, blocked: 0 })
  const items = sql<Array<{ id: string; export_run_id: string; billing_underlay_id: string }>>(`select jsonb_agg(jsonb_build_object('id',id,'export_run_id',export_run_id,
    'billing_underlay_id',billing_underlay_id) order by id) from public.invoice_export_items where company_id=${quote(c.companyId)} and billing_underlay_id in(${drafts.map(d => quote(d.underlay)).join(',')});`)
  // Exercise the real approval function and its review hash. The canonical
  // sender case then resumes these genuinely approved, captured requests after
  // a synthetic transport timeout; no caller manufactures approval metadata.
  transport.reject = sender === 'canonical'
  const approval = await approveAndSendReadyInvoicesForMonth({ companyId: c.companyId, billingMonth: '2026-10', actorUserId: c.actorUserId })
  expect(approval).toMatchObject({ approved: 2, sent: sender === 'approved' ? 2 : 0, failed: sender === 'approved' ? 0 : 2 })
  transport.reject = false
  for (const item of items) {
    if (sender === 'canonical') {
      const result = await sendInvoiceExportRun({ companyId: c.companyId, exportRunId: item.export_run_id, actorUserId: c.actorUserId })
      expect(result.sent).toBe(1)
    }
    const d = drafts.find(d => d.underlay === item.billing_underlay_id)!
    const request = transport.requests.find(row => row.payload.externalReferenceCode === d.pricing)!
    const allRequests = transport.requests.filter(row => row.payload.externalReferenceCode === d.pricing)
    expect(allRequests).toHaveLength(sender === 'canonical' ? 2 : 1)
    if (sender === 'canonical') expect(allRequests[1]).toEqual(allRequests[0])
    expect(request.payload.customer).toMatchObject({ email: d.explicit ? 'agency-original@example.invalid' : 'saved-concurrent@example.invalid', countryCode: 'NO' })
    expect((request.payload.debts as Row[])[0]).toMatchObject({ receiverFullName: 'Saved Concurrent Recipient', receiverCountryCode: 'NO' })
    expect(request.payload.extraFields).toEqual(expect.arrayContaining([
      { name: 'gridex_billing_profile_revision', value: ['3'] }, { name: 'gridex_billing_override_revision', value: ['0'] },
    ]))
    const detail = await getInvoiceReviewDetail({ companyId: c.companyId, invoiceExportItemId: item.id })
    expect(detail.invoice?.invoice_address_snapshot).toMatchObject({ email: d.explicit ? 'agency-original@example.invalid' : 'saved-concurrent@example.invalid', profile_revision: 3, contract_override_revision: 0 })
    expect((detail.item.metadata as Row).approval).toMatchObject({ status: 'approved', approved_by: c.actorUserId, review_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
  }
  expect(transport.requests).toHaveLength(sender === 'canonical' ? 4 : 2)
  const current = sql<{ customer: Row; contracts: Row[] }>(`select jsonb_build_object('customer',(select to_jsonb(c) from public.customers c where id=${quote(c.customerId)}),
    'contracts',(select jsonb_agg(to_jsonb(c) order by id) from public.customer_contracts c where id in(${drafts.map(d => quote(d.contract)).join(',')})));`)
  const profile = resolveEffectiveBillingProfile({ companyId: c.companyId, customerId: c.customerId, customer: current.customer })
  const contracts = current.contracts.map(contract => ({ id: String(contract.id), name: 'Synthetic native contract', profile: resolveEffectiveBillingProfile({
    companyId: c.companyId, customerId: c.customerId, customer: current.customer, contract }) }))
  const html = renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile, contracts, canEdit: false, idempotencyKey: 'unused' }))
  expect(html).toContain('later-live@example.invalid'); expect(html).toContain('agency-later@example.invalid')
  expect(html).toContain('Profilrevision: 4'); expect(html).not.toContain('<form')
  expect(originalGraph(c)).toEqual(original)
  console.log(`BILLING_RECIPIENT_REVISION_NATIVE_PASS sender=${sender} actualReadinessWait=true staleLockEffects=0 storedRevision=3 defaultAndOverride=true originalGraph=unchanged externalTransport=mocked`)
})

type BrowserFixture = {
  context: Context; foreign: Context; explicitContract: string; inheritedContract: string
  writerEmail: string; writerId: string; readerEmail: string; foreignWriterEmail: string
  original: Row; identities: Row; foreignOriginal: Row; foreignCustomer: Row; counts: Row
}
function fixturePath() {
  const temp = process.env.RUNNER_TEMP, path = process.env.GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH
  if (!temp || !path || !resolve(path).startsWith(resolve(temp) + sep)) throw new Error('billing_recipient_fixture_must_stay_in_runner_temp')
  return resolve(path)
}
function identitySnapshot(c: Context) {
  return sql<Row>(`select jsonb_build_object('customer',(select jsonb_build_object('email',email,'phone',phone,'contact_revision',contact_revision) from public.customers where id=${quote(c.customerId)} and company_id=${quote(c.companyId)}),
    'contacts',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_contacts t where company_id=${quote(c.companyId)} and customer_id=${quote(c.customerId)}),
    'ownerAuth',(select to_jsonb(u) from auth.users u where id=${quote(c.actorUserId)}),
    'ownerProfile',(select to_jsonb(u) from public.user_profiles u where id=${quote(c.actorUserId)}),
    'portalAccounts',(select jsonb_agg(to_jsonb(a) order by id) from public.customer_portal_accounts a where company_id=${quote(c.companyId)} and customer_id=${quote(c.customerId)}));`)
}
function commandCounts(c: Context, writer?: string) {
  return sql<Row>(`select jsonb_build_object('defaults',(select count(*) from public.canonical_command_results where company_id=${quote(c.companyId)} and command_type='customer.billing_profile.change.v1' and request_payload->>'customerId'=${quote(c.customerId)}),
    'overrides',(select count(*) from public.canonical_command_results where company_id=${quote(c.companyId)} and command_type='customer.billing_override.change.v1' and request_payload->>'customerId'=${quote(c.customerId)}),
    'audit',(select count(*) from public.canonical_audit_events where company_id=${quote(c.companyId)} and event_type='CUSTOMER_BILLING_PROFILE_COMMAND'${writer ? ` and actor_user_id=${quote(writer)}` : ''}),
    'outbox',(select count(*) from public.canonical_event_outbox where company_id=${quote(c.companyId)} and topic='customer.billing_profile.changed' and payload->>'customerId'=${quote(c.customerId)}));`)
}
async function browserActor(company: string, tag: string, write: boolean) {
  const password = process.env.GRIDEX_BILLING_RECIPIENT_PASSWORD
  if (!password) throw new Error('billing_recipient_synthetic_password_required')
  const service = createClient(API, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const email = `billing-recipient-${tag}-${randomUUID()}@example.invalid`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  expect(created.error).toBeNull()
  if (!created.data.user) throw new Error('billing_recipient_browser_actor_missing')
  const id = created.data.user.id, role = randomUUID(), key = `billing_recipient_${randomUUID().replaceAll('-', '')}`
  const permissions = ['customers.read', 'masterdata.read', 'billing_underlay.read', ...(write ? ['masterdata.write'] : [])]
  const keys = permissions.map(quote).join(',')
  sql(`insert into public.user_profiles(id,email,full_name,user_status) values(${quote(id)},${quote(email)},'Synthetic billing browser actor','active') on conflict(id) do update set user_status='active';
    insert into public.roles(id,key,name,scope) values(${quote(role)},${quote(key)},'Synthetic billing browser role','company');
    insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at) values(${quote(company)},${quote(id)},${quote(write ? 'operations' : 'viewer')},'active',now());
    insert into public.user_roles(user_id,company_id,role_id,role,status,is_active) values(${quote(id)},${quote(company)},${quote(role)},${quote(key)},'active',true);
    insert into public.permissions(key,name,description,category) select key,key,'Synthetic billing browser','test' from unnest(array[${keys}]::text[]) p(key) on conflict(key) do nothing;
    insert into public.role_permissions(role_id,role_key,permission_id,permission_key) select ${quote(role)},${quote(key)},id,key from public.permissions where key in(${keys});select to_jsonb(true);`)
  const auth = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  expect((await auth.auth.signInWithPassword({ email, password })).error).toBeNull()
  const context = await auth.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: company })
  expect(context.error).toBeNull(); expect(context.data).toMatchObject({ authorized: true, is_platform_admin: false, selected_company_id: company })
  for (const permission of permissions) expect((context.data as { permissions: string[] }).permissions).toContain(permission)
  return { id, email }
}

it.skipIf(!browserPhase)('T44/U04/U18/U20 real Auth browser fixture and independent native saved-source postcheck', async () => {
  const path = fixturePath()
  if (browserPhase === 'browser-postcheck') {
    const f = JSON.parse(readFileSync(path, 'utf8')) as BrowserFixture, c = f.context
    const current = sql<{ customer: Row; contracts: Row[] }>(`select jsonb_build_object('customer',(select to_jsonb(t) from public.customers t where id=${quote(c.customerId)} and company_id=${quote(c.companyId)}),
      'contracts',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_contracts t where company_id=${quote(c.companyId)} and id in(${quote(f.explicitContract)},${quote(f.inheritedContract)})));`)
    expect(current.customer).toMatchObject({ billing_profile_revision: 3, billing_profile: {
      recipient: 'UI Later Saved Recipient', email: 'ui-default-later@example.invalid', country: 'NO', distributionMethod: 'email' } })
    const explicit = current.contracts.find(row => row.id === f.explicitContract)!, inherited = current.contracts.find(row => row.id === f.inheritedContract)!
    expect(explicit).toMatchObject({ billing_profile_override_revision: 1, billing_profile_override: { email: 'ui-agency@example.invalid' } })
    expect(inherited).toMatchObject({ billing_profile_override_revision: 2, billing_profile_override: {} })
    expect(Object.hasOwn(inherited.billing_profile_override as Row, 'email')).toBe(false)
    expect(resolveEffectiveBillingProfile({ companyId: c.companyId, customerId: c.customerId, customer: current.customer, contract: inherited })).toMatchObject({
      email: 'ui-default-later@example.invalid', sources: { email: 'customer_default' }, profileRevision: 3, contractOverrideRevision: 2 })
    expect(identitySnapshot(c)).toEqual(f.identities)
    expect(originalGraph(c)).toEqual(f.original); expect(originalGraph(f.foreign)).toEqual(f.foreignOriginal)
    expect(sql<Row>(`select to_jsonb(t) from public.customers t where id=${quote(f.foreign.customerId)} and company_id=${quote(f.foreign.companyId)};`)).toEqual(f.foreignCustomer)
    const all = commandCounts(c), own = commandCounts(c, f.writerId)
    expect(all).toEqual({ defaults: Number(f.counts.defaults) + 2, overrides: Number(f.counts.overrides) + 3,
      audit: Number(f.counts.audit) + 5, outbox: Number(f.counts.outbox) + 5 })
    expect(own.audit).toBe(5)
    expect(transport.requests).toHaveLength(0)
    console.log('BILLING_RECIPIENT_BROWSER_NATIVE_POSTCHECK_PASS currentRevision=3 defaultWrites=2 overrideWrites=3 draftConflictNoWrite=true inheritedFieldAbsent=true actorAudit=5 contactAuthPortalUnchanged=true originalGraphUnchanged=true foreignUnchanged=true providerCalls=0')
    return
  }
  const context = historicalSeed(), foreign = historicalSeed(), drafts = draftSeed(context)
  const writer = await browserActor(context.companyId, 'writer', true), reader = await browserActor(context.companyId, 'reader', false)
  const foreignWriter = await browserActor(foreign.companyId, 'foreign', true)
  const fixture: BrowserFixture = { context, foreign, explicitContract: drafts.find(row => row.explicit)!.contract,
    inheritedContract: drafts.find(row => !row.explicit)!.contract, writerEmail: writer.email, writerId: writer.id,
    readerEmail: reader.email, foreignWriterEmail: foreignWriter.email, original: originalGraph(context), identities: identitySnapshot(context),
    foreignOriginal: originalGraph(foreign), foreignCustomer: sql<Row>(`select to_jsonb(t) from public.customers t where id=${quote(foreign.customerId)} and company_id=${quote(foreign.companyId)};`), counts: commandCounts(context) }
  writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 })
  expect(transport.requests).toHaveLength(0)
  console.log('BILLING_RECIPIENT_BROWSER_NATIVE_SEED_PASS realGoTrue=true currentTenantPermissions=true fullOriginalIssuedGraph=true providerCalls=0')
})
