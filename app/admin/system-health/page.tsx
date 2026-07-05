import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { humanizeLaunchError, safeCount } from '@/lib/launch/readiness'
import { supabaseService } from '@/lib/supabase/service'
import { runProductionConsistencyChecks, type ReconciliationCheckResult } from '@/lib/ops/reconciliation'
import { requeueUncertainEmailAction } from './actions'

export const dynamic = 'force-dynamic'

type ErrorRow = {
  company_id: string | null
  id: string
  source_table: string
  error_key: string
  status: string
  severity: string
  recommended_action: string | null
  created_at: string
}

function tone(severity: string) {
  if (['critical', 'blocking', 'error'].includes(severity)) return 'border-red-200 bg-red-50 text-red-800'
  if (['warning', 'warn'].includes(severity)) return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Card({ label, value, hint, danger = false }: { label: string; value: number; hint: string; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${danger && value > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  )
}

type UncertainEmailRow = {
  id: string
  company_id: string | null
  to_email?: string | null
  recipient_email?: string | null
  subject?: string | null
  delivery_uncertain_at?: string | null
  last_error?: string | null
}

// Platform-operator recovery list: delivery_uncertain rows have no automatic
// retry by design (the provider may already have accepted the interrupted
// send) — an operator reviews and requeues them here.
async function loadUncertainEmails(): Promise<Array<UncertainEmailRow & { kind: 'tenant' | 'manual' }>> {
  const [tenant, manual] = await Promise.all([
    supabaseService
      .from('tenant_email_outbox')
      .select('id,company_id,to_email,subject,delivery_uncertain_at,last_error')
      .eq('status', 'delivery_uncertain')
      .order('delivery_uncertain_at', { ascending: true })
      .limit(20)
      .then((result) => (result.error ? [] : ((result.data ?? []) as UncertainEmailRow[]))),
    supabaseService
      .from('manual_email_outbox')
      .select('id,company_id,recipient_email,subject,delivery_uncertain_at,last_error')
      .eq('status', 'delivery_uncertain')
      .order('delivery_uncertain_at', { ascending: true })
      .limit(20)
      .then((result) => (result.error ? [] : ((result.data ?? []) as UncertainEmailRow[]))),
  ])
  return [
    ...tenant.map((row) => ({ ...row, kind: 'tenant' as const })),
    ...manual.map((row) => ({ ...row, kind: 'manual' as const })),
  ]
}

async function loadErrors(companyId: string | null, isPlatformAdmin: boolean) {
  let query = supabaseService
    .from('gridex_launch_error_summary_v')
    .select('company_id,id,source_table,error_key,status,severity,recommended_action,created_at')
    .neq('status', 'resolved')
    .order('created_at', { ascending: false })
    .limit(50)

  if (!isPlatformAdmin && companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error && ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return [] as ErrorRow[]
  if (error) throw error
  return (data ?? []) as ErrorRow[]
}

export default async function SystemHealthPage() {
  const context = await requireAdminPageAccess(['admin.dashboard.read'])
  const isPlatformAdmin = isPlatformAdminContext(context)
  const scope = await getOperationalCompanyScope(context.userId)
  const companyId = isPlatformAdmin ? null : scope.companyId

  const [
    apiErrors,
    webhookFailures,
    rateLimitEvents,
    edielFailures,
    unresolvedInbound,
    blockedOutbound,
    billingBlocked,
    missingRoutes,
    importIssues,
    emailFailures,
    dbSecurityWarnings,
    failedJobs,
    errors,
    reconciliation,
  ] = await Promise.all([
    safeCount('integration_api_requests', companyId, [{ column: 'status_code', operator: 'in', value: [400, 401, 403, 404, 409, 422, 429, 500] }]).catch(() => 0),
    safeCount('webhook_deliveries', companyId, [{ column: 'status', operator: 'in', value: ['failed', 'dead_letter'] }]).catch(() => 0),
    safeCount('integration_api_rate_limit_events', companyId).catch(() => safeCount('integration_api_requests', companyId, [{ column: 'error_code', operator: 'eq', value: 'rate_limited' }]).catch(() => 0)),
    safeCount('ediel_messages', companyId, [{ column: 'status', operator: 'in', value: ['failed', 'blocked'] }]).catch(() => 0),
    safeCount('ediel_messages', companyId, [{ column: 'status', operator: 'eq', value: 'unresolved' }]).catch(() => 0),
    safeCount('ediel_messages', companyId, [{ column: 'direction', operator: 'eq', value: 'outbound' }, { column: 'status', operator: 'in', value: ['blocked', 'failed'] }]).catch(() => 0),
    safeCount('billing_underlays', companyId, [{ column: 'readiness_status', operator: 'in', value: ['blocked', 'failed', 'needs_review'] }]).catch(() => 0),
    safeCount('gridex_route_readiness_v', null, [{ column: 'readiness_status', operator: 'in', value: ['critical_missing_route', 'recommended_missing_route', 'not_sendable', 'needs_review'] }]).catch(() => 0),
    safeCount('platform_actor_import_issues', null, [{ column: 'status', operator: 'eq', value: 'open' }]).catch(() => 0),
    safeCount('communication_logs', companyId, [{ column: 'status', operator: 'in', value: ['failed', 'bounced'] }]).catch(() => 0),
    safeCount('gridex_launch_db_security_warnings_v', null, [{ column: 'severity', operator: 'in', value: ['critical', 'warning'] }]).catch(() => 0),
    // Real stuck-job sources: e-mail outboxes with failed/uncertain deliveries.
    // (The legacy event_outbox queue had no processor and was removed from the
    // emit path — counting it here only produced a permanently red metric.)
    Promise.all([
      safeCount('tenant_email_outbox', companyId, [{ column: 'status', operator: 'in', value: ['failed', 'delivery_uncertain'] }]).catch(() => 0),
      safeCount('manual_email_outbox', companyId, [{ column: 'status', operator: 'in', value: ['failed', 'delivery_uncertain'] }]).catch(() => 0),
    ]).then(([tenantOutbox, manualOutbox]) => tenantOutbox + manualOutbox),
    loadErrors(companyId, isPlatformAdmin),
    runProductionConsistencyChecks({ companyId }).catch(() => ({
      checks: [] as ReconciliationCheckResult[],
      criticalCount: 0,
      warningCount: 0,
    })),
  ])

  const uncertainEmails = isPlatformAdmin ? await loadUncertainEmails() : []

  return (
    <main className="space-y-6">
      <AdminHeader
        title="System Health"
        subtitle="Launch-kontroll för API, webhooks, Ediel, mail, route-readiness, billing och datakvalitet."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Card label="API-fel" value={apiErrors} hint="Externa API-anrop med felstatus" danger />
        <Card label="Webhook-fel" value={webhookFailures} hint="Retries/failure i webhook deliveries" danger />
        <Card label="Rate limit" value={rateLimitEvents} hint="Ska hanteras med backoff/cooldown" danger />
        <Card label="Ediel-fel" value={edielFailures} hint="Blockerade eller misslyckade meddelanden" danger />
        <Card label="Unresolved inbound" value={unresolvedInbound} hint="Kräver tenant/route-matchning" danger />
        <Card label="Blocked outbound" value={blockedOutbound} hint="Ska inte skickas före readiness" danger />
        <Card label="Billing blockers" value={billingBlocked} hint="Fakturering får inte gå på overifierad data" danger />
        <Card label="Route blockers" value={missingRoutes} hint="Actor routes saknas/verifieras" danger />
        <Card label="Import issues" value={importIssues} hint="Actor/masterdata-konflikter" danger />
        <Card label="Mailfel" value={emailFailures} hint="Kundmail och switch-notiser" danger />
        <Card label="DB-varningar" value={dbSecurityWarnings} hint="RLS, anon grants och security-definer" danger />
        <Card label="Failed jobs" value={failedJobs} hint="Outbox/jobb som behöver retry eller manuell åtgärd" danger />
      </section>

      {isPlatformAdmin && uncertainEmails.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Osäkra e-postleveranser</h2>
          <p className="mt-1 text-sm text-amber-900">
            Utskick som avbröts efter att transporten kan ha accepterat dem. Granska transportloggen och köa om — providerns idempotensnyckel förhindrar dubbelutskick.
          </p>
          <div className="mt-3 divide-y divide-amber-200/60">
            {uncertainEmails.map((row) => (
              <div key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">
                    {row.subject ?? '(utan ämne)'} · {row.to_email ?? row.recipient_email ?? 'okänd mottagare'}
                  </div>
                  <div className="text-xs text-slate-600">
                    {row.kind === 'tenant' ? 'Kundmail' : 'Manuell nätägarmail'} · osäker sedan {row.delivery_uncertain_at ?? 'okänt'}
                  </div>
                </div>
                <form action={requeueUncertainEmailAction}>
                  <input type="hidden" name="outbox_id" value={row.id} />
                  <input type="hidden" name="outbox_kind" value={row.kind} />
                  <button type="submit" className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
                    Köa om efter granskning
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Avstämningar (produktion)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Konsistenskontroller för avtal, leverantörsbyten, fakturaunderlag och exporter. {reconciliation.criticalCount} kritiska och {reconciliation.warningCount} varningar just nu.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Kontroll</th>
                <th className="px-3 py-3">Antal</th>
                <th className="px-3 py-3">Beskrivning</th>
                <th className="px-3 py-3">Exempel-id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reconciliation.checks.map((check) => (
                <tr key={check.key} className={check.count > 0 ? (check.severity === 'critical' ? 'bg-red-50/50' : 'bg-amber-50/50') : ''}>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs font-medium ${check.count > 0 ? tone(check.severity) : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                      {check.error ? 'fel' : check.count > 0 ? check.severity : 'ok'}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-900">{check.label}</td>
                  <td className="px-3 py-3 text-slate-700">{check.error ? '–' : check.count}</td>
                  <td className="px-3 py-3 text-slate-600">{check.error ? `Kontrollen kunde inte köras (${check.error}).` : check.description}</td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-500">{check.sampleIds.join(', ') || '–'}</td>
                </tr>
              ))}
              {reconciliation.checks.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Avstämningarna kunde inte köras.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Senaste öppna fel</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Allvar</th>
                <th className="px-3 py-3">Källa</th>
                <th className="px-3 py-3">Fel</th>
                <th className="px-3 py-3">Nästa åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {errors.map((row) => (
                <tr key={`${row.source_table}-${row.id}`}>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-medium ${tone(row.severity)}`}>{row.severity}</span></td>
                  <td className="px-3 py-3 text-slate-700">{row.source_table}</td>
                  <td className="px-3 py-3 font-medium text-slate-900">{humanizeLaunchError(row.error_key)}</td>
                  <td className="px-3 py-3 text-slate-700">{row.recommended_action ?? humanizeLaunchError(row.error_key)}</td>
                </tr>
              ))}
              {errors.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Inga öppna launch-fel hittades.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
