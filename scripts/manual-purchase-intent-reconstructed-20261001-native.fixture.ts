import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import { buildPurchasePayload } from '@/lib/integrations/billing/capway/purchase'
import { manualPurchaseItemBinding, resolveManualPurchaseConfiguration, type ManualPurchaseCommand } from '@/lib/billing/manualPurchaseIntentReconstructed'
import { proofSql, quote } from './customer-read-proof-native'

export const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const tables = ['companies', 'customers', 'customer_contracts', 'billing_underlays', 'pricing_runs', 'pricing_preview_lines',
  'customer_invoices', 'customer_invoice_lines', 'customer_invoice_documents', 'invoice_export_items', 'invoice_export_runs',
  'invoice_export_attempts', 'billing_export_runs', 'billing_export_run_items', 'invoice_purchase_events', 'domain_events',
  'event_outbox', 'invoice_manual_purchase_intents'] as const
export const nativeResponse = { syntheticObservation: 'no-provider-network-performed' }
export function requireLocal() {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) {
    throw new Error('manual_purchase_native_local_only')
  }
}
function fingerprint(relation: string, where = '', projection = 'to_jsonb(r)') {
  return proofSql<string>(`SELECT to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(${projection}
    ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM ${relation} r ${where};`)
}
function original(companies: string[], actor?: string) {
  const where = `WHERE company_id IS NULL OR company_id NOT IN(${companies.map(quote).join(',')})`
  const rows = Object.fromEntries(tables.map(table => [table, fingerprint('public.' + table, table === 'companies'
    ? `WHERE id NOT IN(${companies.map(quote).join(',')})` : where)]))
  return { rows, users: fingerprint('auth.users', actor ? `WHERE id<>${quote(actor)}` : ''),
    profiles: fingerprint('public.user_profiles', actor ? `WHERE id<>${quote(actor)}` : ''),
    sessions: fingerprint('auth.sessions', actor ? `WHERE user_id<>${quote(actor)}` : ''),
    identities: fingerprint('auth.identities', actor ? `WHERE user_id<>${quote(actor)}` : '') }
}
function nativePrivateDirectory() {
  requireLocal()
  const path = mkdtempSync(join(realpathSync(process.env.RUNNER_TEMP!), 'manual-purchase-native.'))
  chmodSync(path, 0o700)
  return path
}
async function actor() {
  const email = `manual-purchase-native-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url')
  const created = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error('manual_purchase_native_auth_create_failed')
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data.session) throw new Error('manual_purchase_native_auth_login_failed')
  const user = await client.auth.getUser(), claims = await client.auth.getClaims()
  const sessionId = claims.data?.claims.session_id
  if (user.error || claims.error || user.data.user?.id !== created.data.user.id || claims.data?.claims.sub !== created.data.user.id
    || typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(sessionId) || !user.data.user.email_confirmed_at) {
    throw new Error('manual_purchase_native_real_session_required')
  }
  return { userId: created.data.user.id, sessionId, email, client }
}
export async function fixture() {
  requireLocal()
  const ids = Object.fromEntries(['company', 'foreign', 'customer', 'contract', 'underlay', 'price', 'run', 'item', 'invoice', 'connection', 'role',
    'foreignCustomer', 'foreignContract', 'foreignInvoice'].map(k => [k, randomUUID()]))
  const baseline = original([ids.company, ids.foreign]), writer = await actor(), privateDirectory = nativePrivateDirectory()
  const guid = `synthetic-native-purchase-${ids.item}`, key = `synthetic-native-request-${ids.item}`
  const calculation = { syntheticOriginal: 'native-command-only', pricingRunId: ids.price }
  const extra = (name: string, value: string) => ({ name, value: [value] })
  const capture = { externalReferenceCode: ids.price, invoiceDate: '2026-09-01T00:00:00.000Z',
    extraFields: [extra('gridex_company_id', ids.company), extra('gridex_pricing_run_id', ids.price), extra('gridex_financing_mode', 'invoice_service')],
    customer: { extraFields: [extra('gridex_customer_id', ids.customer)] }, debts: [{ invoiceDate: '2026-09-01T00:00:00.000Z',
      dueDate: '2026-09-21T00:00:00.000Z', originalPrincipal: 100, originalVat: 25, rounding: 0, currencyCode: 'SEK',
      extraFields: [extra('gridex_billing_underlay_id', ids.underlay)] }] }
  const roleKey = `manual_native_${ids.role.replaceAll('-', '')}`
  // Initial owned rows satisfy installed guards. No published trigger/function,
  // ACL, authority or role body is disabled/replaced. Prepared approval/capture
  // facts are modeled saved prerequisites, not execution of those producers.
  proofSql(`BEGIN;
    INSERT INTO public.companies(id,name,status) VALUES(${quote(ids.company)},'Synthetic manual purchase native A','active'),
      (${quote(ids.foreign)},'Synthetic quiet manual purchase native B','active');
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(writer.userId)},${quote(writer.email)},'Synthetic manual purchase actor','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,role,role_key,accepted_at,joined_at)
      VALUES(${quote(ids.company)},${quote(writer.userId)},'operations','active',true,'operations',${quote(roleKey)},now(),now());
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(ids.role)},${quote(roleKey)},'Synthetic manual purchase native role','company');
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
      VALUES(${quote(writer.userId)},${quote(ids.company)},${quote(ids.role)},${quote(roleKey)},'active',true);
    -- Clean replay does not seed these product catalog keys. Materialize only
    -- the two prerequisites; retain existing rows and grant only the owned role.
    INSERT INTO public.permissions(key,name,description,category)
      VALUES('billing.write','Synthetic manual purchase write','Disposable native fixture prerequisite','test'),
        ('billing.export','Synthetic manual purchase export','Disposable native fixture prerequisite','test')
      ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
      SELECT ${quote(ids.role)},${quote(roleKey)},id,key,'allow' FROM public.permissions WHERE key IN('billing.write','billing.export');
    DO $roles$ BEGIN IF (SELECT count(*) FROM public.role_permissions WHERE role_id=${quote(ids.role)})<>2
      THEN RAISE EXCEPTION 'manual_native_permission_prerequisite_missing'; END IF; END;$roles$;
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email)
      VALUES(${quote(ids.customer)},${quote(ids.company)},${quote(ids.customer)},'Synthetic manual purchase customer','private','Synthetic','Native',${quote(writer.email)});
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status,price_area_used)
      VALUES(${quote(ids.contract)},${quote(ids.company)},${quote(ids.customer)},'draft','SE3');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
      VALUES(${quote(ids.foreignCustomer)},${quote(ids.foreign)},${quote(ids.foreignCustomer)},'Synthetic quiet foreign customer','private');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status)
      VALUES(${quote(ids.foreignContract)},${quote(ids.foreign)},${quote(ids.foreignCustomer)},'draft');
    INSERT INTO public.customer_invoices(id,company_id,customer_id,customer_contract_id,contract_id,invoice_reference,status,amount_ex_vat,vat_amount,amount_inc_vat)
      VALUES(${quote(ids.foreignInvoice)},${quote(ids.foreign)},${quote(ids.foreignCustomer)},${quote(ids.foreignContract)},${quote(ids.foreignContract)},
        ${quote('synthetic-quiet-native-invoice-'+ids.foreignInvoice)},'draft',100,25,125);
    INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status,
      readiness_status,missing_values_count,total_kwh,price_area)
      VALUES(${quote(ids.underlay)},${quote(ids.company)},${quote(ids.customer)},${quote(ids.contract)},${quote(ids.contract)},2026,9,'validated','ready',0,1,'SE3');
    INSERT INTO public.pricing_runs(id,company_id,billing_underlay_id,customer_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
      VALUES(${quote(ids.price)},${quote(ids.company)},${quote(ids.underlay)},${quote(ids.customer)},'locked',clock_timestamp(),100,25,125);
    INSERT INTO public.invoice_export_runs(id,company_id,billing_month,status,environment,financing_mode)
      VALUES(${quote(ids.run)},${quote(ids.company)},'2026-09','sent','test','invoice_service');
    INSERT INTO public.invoice_export_items(id,company_id,export_run_id,customer_id,customer_contract_id,billing_underlay_id,pricing_run_id,
      status,environment,financing_mode,provider_invoice_guid,provider_invoice_id,provider_request_id,provider_idempotency_key,idempotency_key,
      request_payload,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,sent_at,provider_confirmed_at)
      VALUES(${quote(ids.item)},${quote(ids.company)},${quote(ids.run)},${quote(ids.customer)},${quote(ids.contract)},${quote(ids.underlay)},${quote(ids.price)},
      'sent','test','invoice_service',${quote(guid)},${quote(guid)},${quote(key)},${quote(key)},${quote(key)},${quote(JSON.stringify(capture))}::jsonb,100,25,125,1,clock_timestamp(),clock_timestamp());
    INSERT INTO public.customer_invoices(id,company_id,customer_id,customer_contract_id,contract_id,billing_underlay_id,invoice_export_item_id,
      canonical_export_item_id,partner_invoice_reference,invoice_reference,status,issued_at,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,
      price_area_code,calculation_snapshot,calculation_snapshot_sha256)
      VALUES(${quote(ids.invoice)},${quote(ids.company)},${quote(ids.customer)},${quote(ids.contract)},${quote(ids.contract)},${quote(ids.underlay)},${quote(ids.item)},
      ${quote(ids.item)},${quote(guid)},${quote('synthetic-native-invoice-'+ids.invoice)},'sent',clock_timestamp(),100,25,125,1,'SE3',
      ${quote(JSON.stringify(calculation))}::jsonb,public.canonical_json_sha256(${quote(JSON.stringify(calculation))}::jsonb));
    DO $approval$ DECLARE saved jsonb; BEGIN
      SELECT jsonb_build_object('status','approved','approved_at',clock_timestamp(),'approved_by',${quote(writer.userId)},
        'review_hash',private.gridex_manual_purchase_review_hash_v1(i,n,u),'calculation_snapshot_sha256',n.calculation_snapshot_sha256)
        INTO saved FROM public.invoice_export_items i JOIN public.customer_invoices n ON n.invoice_export_item_id=i.id
          JOIN public.billing_underlays u ON u.id=i.billing_underlay_id WHERE i.id=${quote(ids.item)};
      UPDATE public.invoice_export_items SET metadata=jsonb_build_object('approval',saved) WHERE id=${quote(ids.item)};
      UPDATE public.customer_invoices SET metadata=jsonb_build_object('approval',saved) WHERE id=${quote(ids.invoice)};
    END;$approval$;
    INSERT INTO public.customer_invoice_lines(company_id,customer_id,invoice_id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat)
      VALUES(${quote(ids.company)},${quote(ids.customer)},${quote(ids.invoice)},'Synthetic native original energy',1,100,100,25,125);
    INSERT INTO public.customer_invoice_documents(company_id,customer_id,invoice_id,file_path,file_name,mime_type,metadata)
      VALUES(${quote(ids.company)},${quote(ids.customer)},${quote(ids.invoice)},'synthetic/native/original.pdf','original.pdf','application/pdf',
        '{"qualification":"reference-only-no-physical-pdf"}');
    INSERT INTO public.billing_provider_connections(id,company_id,provider,environment,status,settings,secret_reference)
      VALUES(${quote(ids.connection)},${quote(ids.company)},'capway_aptic','test','ready',
        '{"base_url":"http://127.0.0.1:9","auth_mode":"apikey","api_key_header":"X-Synthetic-Key"}',
        '{"api_key_env":"GRIDEX_MANUAL_PURCHASE_NATIVE_SYNTHETIC_KEY"}');
    COMMIT; SELECT to_jsonb(true);`)
  const context = await writer.client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: ids.company })
  if (context.error || context.data?.authorized !== true || context.data?.selected_company_id !== ids.company
    || context.data?.user_id !== writer.userId || context.data?.is_platform_admin !== false
    || !context.data.permissions?.includes('billing.write') || !context.data.permissions?.includes('billing.export')) {
    throw new Error('manual_purchase_native_actual_context_unqualified')
  }
  if (JSON.stringify(original([ids.company, ids.foreign], writer.userId)) !== JSON.stringify(baseline)) {
    throw new Error('manual_purchase_native_seed_changed_original_graph')
  }
  const item = proofSql<Record<string, unknown>>(`SELECT to_jsonb(i) FROM public.invoice_export_items i WHERE id=${quote(ids.item)};`)
  let provider: Awaited<ReturnType<typeof resolveManualPurchaseConfiguration>>
  try { provider=await resolveManualPurchaseConfiguration(ids.company, 'test') }
  catch { throw new Error('manual_purchase_native_provider_configuration_prerequisite_failed') }
  const command: ManualPurchaseCommand = { companyId: ids.company, itemId: ids.item, actorUserId: writer.userId, sessionId: writer.sessionId,
    financingMode: 'factoring_without_recourse', payload: buildPurchasePayload({ financingMode: 'factoring_without_recourse', note: 'Synthetic native controlled observation' }),
    itemBinding: manualPurchaseItemBinding(item), connectionJson: provider.connectionJson }
  writeFileSync(join(privateDirectory, 'fixture.json'), JSON.stringify({ ids, actor: { userId: writer.userId, sessionId: writer.sessionId }, command, baseline }), { mode: 0o600, flag: 'wx' })
  const foreignGraph = () => Object.fromEntries(tables.map(table => [table, fingerprint('public.'+table,
    table==='companies'?`WHERE id=${quote(ids.foreign)}`:`WHERE company_id=${quote(ids.foreign)}`)]))
  const foreignBefore=foreignGraph()
  const originalUnchanged = () => JSON.stringify(original([ids.company, ids.foreign], writer.userId)) === JSON.stringify(baseline)
    && JSON.stringify(foreignGraph())===JSON.stringify(foreignBefore)
  const graphs = (preserveProjection = true) => Object.fromEntries(['invoice_export_items','customer_invoices','customer_invoice_lines','customer_invoice_documents',
    'billing_underlays','pricing_runs','customers','customer_contracts','invoice_export_runs'].map(table => [table,
      fingerprint('public.'+table,`WHERE company_id=${quote(ids.company)}`,table==='invoice_export_items' && !preserveProjection
        ? "to_jsonb(r)-'purchase_status'-'updated_at'" : 'to_jsonb(r)')]))
  const effects = () => proofSql<{ intents: number; events: number; audits: number; intentStatus: string | null }>(`SELECT jsonb_build_object(
    'intents',(SELECT count(*) FROM public.invoice_manual_purchase_intents WHERE company_id=${quote(ids.company)} AND invoice_export_item_id=${quote(ids.item)}),
    'events',(SELECT count(*) FROM public.invoice_purchase_events WHERE company_id=${quote(ids.company)} AND invoice_export_item_id=${quote(ids.item)}),
    'audits',(SELECT count(*) FROM public.domain_events WHERE company_id=${quote(ids.company)} AND event_type LIKE 'invoice.manual_purchase.%'),
    'intentStatus',(SELECT status FROM public.invoice_manual_purchase_intents WHERE company_id=${quote(ids.company)} AND invoice_export_item_id=${quote(ids.item)}));`)
  return { ids, writer, command, originalUnchanged, graphs, effects, privateDirectory }
}
export function callSql(name: 'claim' | 'complete', command: unknown) {
  return `SELECT public.gridex_${name==='claim'?'claim_manual_invoice_purchase':'complete_manual_invoice_purchase'}_v1(${quote(JSON.stringify(command))}::jsonb);`
}
export function session(label: string) {
  requireLocal()
  const name = `manual_purchase_${label}_${randomUUID().replaceAll('-','').slice(0,16)}`
  if (Buffer.byteLength(name)>63) throw new Error('manual_purchase_native_application_name_too_long')
  const child = spawn('psql', [`${DB}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'])
  let stdout='',stderr=''
  child.stdout.setEncoding('utf8').on('data', part => { stdout+=part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr+=part })
  const exited = new Promise<number>((done,reject) => { child.once('error',()=>reject(new Error('manual_purchase_native_psql_failed')));child.once('exit',code=>done(code??-1)) })
  return { name, child, exited, output:()=>stdout, code:()=>stderr.match(/ERROR:\s*([0-9A-Z]{5})\b/)?.[1]??'UNKNOWN' }
}
export async function until(predicate:()=>boolean, reason:string) {
  const deadline=Date.now()+15_000
  while(!predicate()) { if(Date.now()>deadline)throw new Error(reason);await new Promise(done=>setTimeout(done,75)) }
}
export async function blocked(waiter:ReturnType<typeof session>,owner:ReturnType<typeof session>) {
  await until(()=>proofSql<boolean>(`SELECT to_jsonb(exists(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity b
    ON b.application_name=${quote(owner.name)} WHERE w.application_name=${quote(waiter.name)} AND w.wait_event_type='Lock'
      AND b.pid=ANY(pg_blocking_pids(w.pid))));`),'manual_purchase_native_specific_wait_missing')
}
export function stop(...workers:Array<ReturnType<typeof session>>) {
  for(const worker of workers)if(worker.child.exitCode===null)worker.child.kill('SIGTERM')
}
