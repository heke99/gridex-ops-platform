import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { createDashboardAlert, refreshDashboardAlerts, resolveDashboardAlert } from '@/lib/analytics/alerts'
import { enqueueTenantEmail, sendTenantEmailNow } from '@/lib/email/emailOutbox'
import { getOpsHealth } from '@/lib/ops/health'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'
import { proofSql as sql, quote, readFixture, saveFixture } from './customer-read-proof-native'

const env = 'GRIDEX_ANALYTICS_INCIDENT_FIXTURE_PATH'
const phase = process.env.GRIDEX_ANALYTICS_INCIDENT_PHASE ?? 'seed'
if (!['seed', 'verify_after_http', 'cleanup'].includes(phase)) throw new Error('analytics_incident_phase_invalid')
type Fixture = {
  companyA: string; companyB: string; clientA: string; clientB: string; outboxA: string; outboxB: string;
  providerKey: string; aggregate: string; entityAlert: unknown; quiet: unknown; secret: string;
  admin: { userId: string; email: string; password: string }; key: string;
}
const originalFetch = globalThis.fetch
let forbiddenFetches = 0
beforeAll(() => {
  globalThis.fetch = ((input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'http://127.0.0.1:54321') { forbiddenFetches++; throw new Error('analytics_incident_external_delivery_forbidden') }
    return originalFetch(input, options)
  }) as typeof fetch
})
afterAll(() => { globalThis.fetch = originalFetch })

function quietCompany(company: string) {
  const tables = ['companies', 'dashboard_alerts', 'data_quality_issues', 'tenant_email_outbox', 'integration_api_clients', 'company_capabilities',
    'customers', 'customer_contracts', 'customer_invoices', 'ediel_messages', 'ediel_outbox', 'customer_operation_jobs']
  return sql(`SELECT jsonb_build_object(${tables.map(table => `${quote(table)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
    FROM public.${table} t WHERE ${table === 'companies' ? 'id' : 'company_id'}=${quote(company)})`).join(',')});`)
}
async function uncertainHealthCount() {
  const health = await getOpsHealth()
  expect(health.schemaReady).toBe(true)
  const check = health.rows.find(row => row.check_key === 'queue:email_delivery_uncertain')
  if (!check) throw new Error('analytics_incident_real_uncertain_health_check_required')
  return check.issue_count
}
function row(outbox: string) {
  return sql<Record<string, unknown>>(`SELECT to_jsonb(q) FROM public.tenant_email_outbox q WHERE id=${quote(outbox)};`)
}

if (phase === 'seed') it('actual tenant refresh and stale delivery incident create one bounded alert and hold uncertain delivery', async () => {
  const companyA = randomUUID(), companyB = randomUUID(), clientA = randomUUID(), clientB = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status,external_tenant_reference) VALUES
    (${quote(companyA)},'Synthetic analytics incident A','active',${quote(`incident-${companyA}`)}),
    (${quote(companyB)},'Synthetic analytics quiet B','active',${quote(`incident-${companyB}`)}); SELECT to_jsonb(true);`)
  const email = `analytics-incident-admin-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('base64url')
  const user = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  expect(user.error).toBeNull(); if (!user.data.user) throw new Error('analytics_incident_current_admin_missing')
  const userId = user.data.user.id, tokenA = generateIntegrationApiToken(), tokenB = generateIntegrationApiToken()
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(userId)},${quote(email)},'Synthetic incident operator','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(userId)},'platform_admin',true);
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,role,is_active,accepted_at,role_key)
      VALUES(${quote(companyA)},${quote(userId)},'company_admin','active','company_admin',true,now(),'company_admin');
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,launch_ready,launch_blockers) VALUES
      (${quote(clientA)},${quote(companyA)},'Synthetic incident control client',${quote(tokenA.keyPrefix)},${quote(tokenA.secretHash)},'active',ARRAY['api_contracts.read'],false,'[{"code":"canonical_readiness_pending"}]'),
      (${quote(clientB)},${quote(companyB)},'Synthetic quiet control client',${quote(tokenB.keyPrefix)},${quote(tokenB.secretHash)},'active',ARRAY['api_contracts.read'],false,'[{"code":"canonical_readiness_pending"}]');
    INSERT INTO public.data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message)
      VALUES(${quote(companyA)},'ediel_message',${quote(randomUUID())},'failed_ediel_message','critical','Synthetic held incident'); SELECT to_jsonb(true);`)
  await createDashboardAlert({ companyId: companyA, alertType: 'failed_ediel_message', entityType: 'ediel_message', entityId: randomUUID(), title: 'Synthetic explicit entity alert' })
  await createDashboardAlert({ companyId: companyB, alertType: 'data_quality', title: 'Synthetic quiet tenant alert' })
  const explicit = sql(`SELECT to_jsonb(a) FROM public.dashboard_alerts a WHERE company_id=${quote(companyA)} AND entity_type='ediel_message';`)
  const a = await enqueueTenantEmail({ companyId: companyA, to: 'recipient@example.invalid', from: 'sender@example.invalid',
    subject: 'Synthetic incident delivery hold', html: '<p>Synthetic delivery hold</p>', emailType: 'analytics_incident' })
  const providerKey = a.provider_idempotency_key
  if (!providerKey) throw new Error('analytics_incident_real_provider_key_required')
  const b = await enqueueTenantEmail({ companyId: companyB, to: 'quiet@example.invalid', from: 'sender@example.invalid',
    subject: 'Synthetic quiet delayed intent', html: '<p>Synthetic quiet intent</p>', emailType: 'analytics_incident', delayMinutes: 1440 })
  const quiet = quietCompany(companyB)
  for (let attempt = 0; attempt < 2; attempt++) await refreshDashboardAlerts(companyA)
  const aggregate = sql<{ id: string; title: string }>(`SELECT to_jsonb(a) FROM public.dashboard_alerts a
    WHERE company_id=${quote(companyA)} AND alert_type='failed_ediel_message' AND entity_type='company_aggregate' AND entity_id=${quote(companyA)} AND status='open';`)
  expect(aggregate.title).toBe('1 Ediel-meddelanden har misslyckats')
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.dashboard_alerts WHERE company_id=${quote(companyA)} AND entity_type='company_aggregate';`)).toBe(1)
  expect(sql(`SELECT to_jsonb(a) FROM public.dashboard_alerts a WHERE company_id=${quote(companyA)} AND entity_type='ediel_message';`)).toEqual(explicit)
  expect(quietCompany(companyB)).toEqual(quiet)
  const initialCount = await uncertainHealthCount()
  // Synthetic interruption state, with the real enqueue provider key intact.
  sql(`UPDATE public.tenant_email_outbox SET status='processing',locked_at=clock_timestamp()-interval '16 minutes',locked_by='synthetic-interrupted-worker',
    lock_token=${quote(randomUUID())},attempts=1 WHERE id=${quote(a.id)} AND company_id=${quote(companyA)}; SELECT to_jsonb(true);`)
  const claim = await supabaseService.rpc('gridex_claim_tenant_email_outbox_fair_v1', { p_company_id: companyA, p_limit: 1, p_claim_token: randomUUID() })
  expect(claim.error).toBeNull(); expect(claim.data).toEqual([])
  const uncertain = row(a.id)
  expect(uncertain).toMatchObject({ status: 'delivery_uncertain', attempts: 1, provider_message_id: null, lock_token: null,
    failure_reason: 'delivery_uncertain_after_stale_processing_lock', provider_idempotency_key: a.provider_idempotency_key })
  expect(await uncertainHealthCount()).toBe(initialCount + 1)
  await expect(sendTenantEmailNow(a.id)).resolves.toMatchObject({ ok: false })
  expect(row(a.id)).toEqual(uncertain); expect(quietCompany(companyB)).toEqual(quiet); expect(forbiddenFetches).toBe(0)
  saveFixture(env, { companyA, companyB, clientA, clientB, outboxA: a.id, outboxB: b.id, providerKey,
    aggregate: aggregate.id, entityAlert: explicit, quiet, secret: randomBytes(32).toString('base64url'), admin: { userId, email, password }, key: tokenA.token } satisfies Fixture)
  console.log('ANALYTICS_AGGREGATE_INCIDENT_NATIVE_PASS refreshes=2 aggregate=1 explicit_entity_unchanged=true quiet_tenant_unchanged=true actual_health_increment=1 stale_claim_uncertain=true blind_resend_denied=true provider_calls=0')
})

if (phase === 'verify_after_http') it('actual reviewed recovery retains its provider key and one company lease without sending', async () => {
  const f = readFixture<Fixture>(env)
  expect(row(f.outboxA)).toMatchObject({ status: 'queued', attempts: 1, provider_message_id: null, provider_idempotency_key: f.providerKey })
  const recoveredAudit = sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.audit_logs a
    WHERE entity_id=${quote(f.outboxA)} AND action='email_delivery_uncertain_requeued';`)
  expect(recoveredAudit).toHaveLength(1)
  expect(recoveredAudit[0]).toMatchObject({ company_id: f.companyA, actor_user_id: f.admin.userId, entity_type: 'tenant_email_outbox' })
  const client = sql(`SELECT jsonb_build_object('status',status,'launch_ready',launch_ready) FROM public.integration_api_clients WHERE id=${quote(f.clientA)};`)
  expect(client).toEqual({ status: 'active', launch_ready: false })
  const pauseAudit = sql(`SELECT coalesce(jsonb_agg(action ORDER BY created_at),'[]') FROM public.audit_logs WHERE company_id=${quote(f.companyA)} AND entity_id=${quote(f.clientA)};`)
  expect(pauseAudit).toEqual(['api_client.paused', 'api_client.active'])
  expect(quietCompany(f.companyB)).toEqual(f.quiet)
  const token = randomUUID()
  const first = await supabaseService.rpc('gridex_claim_tenant_email_outbox_fair_v1', { p_company_id: f.companyA, p_limit: 1, p_claim_token: token })
  expect(first.error).toBeNull(); expect(first.data).toHaveLength(1)
  expect(first.data?.[0]).toMatchObject({ id: f.outboxA, company_id: f.companyA, status: 'processing', lock_token: token, provider_idempotency_key: f.providerKey })
  const second = await supabaseService.rpc('gridex_claim_tenant_email_outbox_fair_v1', { p_company_id: f.companyA, p_limit: 1, p_claim_token: randomUUID() })
  expect(second.error).toBeNull(); expect(second.data).toEqual([])
  expect(row(f.outboxA)).toMatchObject({ attempts: 1, provider_message_id: null, provider_idempotency_key: f.providerKey })
  await resolveDashboardAlert(f.aggregate, f.companyB)
  expect(sql(`SELECT to_jsonb(status) FROM public.dashboard_alerts WHERE id=${quote(f.aggregate)};`)).toBe('open')
  await resolveDashboardAlert(f.aggregate, f.companyA)
  expect(sql(`SELECT jsonb_build_object('status',status,'resolved',resolved_at IS NOT NULL) FROM public.dashboard_alerts WHERE id=${quote(f.aggregate)};`)).toEqual({ status: 'resolved', resolved: true })
  expect(sql(`SELECT to_jsonb(a) FROM public.dashboard_alerts a WHERE company_id=${quote(f.companyA)} AND entity_type='ediel_message';`)).toEqual(f.entityAlert)
  expect(quietCompany(f.companyB)).toEqual(f.quiet); expect(forbiddenFetches).toBe(0)
  console.log('ANALYTICS_INCIDENT_RECOVERY_NATIVE_PASS actual_operator_audit_company_actor=true stable_provider_key=true scoped_claims=1 second_claim=0 quiet_tenant_unchanged=true alarm_resolved_scoped=true provider_dispatch=0 full_api_resume=false')
})

if (phase === 'cleanup') it('holds only this fixture remaining email intents before later workers', () => {
  const f = readFixture<Fixture>(env)
  sql(`UPDATE public.tenant_email_outbox SET status='cancelled',locked_at=NULL,locked_by=NULL,lock_token=NULL
    WHERE company_id IN(${quote(f.companyA)},${quote(f.companyB)}) AND status IN('queued','processing','delivery_uncertain'); SELECT to_jsonb(true);`)
})
