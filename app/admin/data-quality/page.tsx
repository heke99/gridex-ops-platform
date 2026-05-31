import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type QualityIssueRow = {
  company_id: string | null
  entity_id: string
  customer_id: string | null
  entity_type: string
  issue_key: string
  severity: string
  message: string
  evidence: Record<string, unknown>
}

type WebhookIssueRow = {
  id: string
  company_id: string
  event_type: string
  status: string
  attempts: number
  failure_reason: string | null
  created_at: string
}

type EmailDomainRow = {
  id: string
  company_id: string
  domain: string
  status: string
  spf_status: string
  dkim_status: string
  dmarc_status: string
  failure_reason: string | null
}

function isMissingReadinessSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code)
}

async function safeRows<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query
  if (error) {
    if (isMissingReadinessSchema(error)) return []
    throw error
  }
  return data ?? []
}

function StatCard({ label, value, hint, tone = 'slate' }: { label: string; value: number; hint: string; tone?: 'slate' | 'amber' | 'red' | 'emerald' }) {
  const styles = {
    slate: 'border-slate-200 bg-white',
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
    emerald: 'border-emerald-200 bg-emerald-50',
  }

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${styles[tone]}`}>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{hint}</p>
    </div>
  )
}

function IssueBadge({ severity }: { severity: string }) {
  const className = severity === 'critical'
    ? 'border-red-200 bg-red-50 text-red-800'
    : severity === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${className}`}>{severity}</span>
}

export default async function DataQualityPage() {
  const admin = await requireAdminPageKeyAccess('operations.integrity')
  const scope = await resolveAdminTenantReadScope(admin)

  let qualityQuery = supabaseService
    .from('customer_data_quality_open_issues')
    .select('*')
    .order('severity', { ascending: true })
    .limit(100)
  let webhookQuery = supabaseService
    .from('webhook_deliveries')
    .select('id, company_id, event_type, status, attempts, failure_reason, created_at')
    .in('status', ['failed', 'dead_letter'])
    .order('created_at', { ascending: false })
    .limit(50)
  let emailQuery = supabaseService
    .from('tenant_email_domains')
    .select('id, company_id, domain, status, spf_status, dkim_status, dmarc_status, failure_reason')
    .neq('status', 'verified')
    .order('created_at', { ascending: false })
    .limit(50)

  if (scope.companyId) {
    qualityQuery = qualityQuery.eq('company_id', scope.companyId)
    webhookQuery = webhookQuery.eq('company_id', scope.companyId)
    emailQuery = emailQuery.eq('company_id', scope.companyId)
  }

  const [qualityIssues, webhookIssues, emailDomains] = await Promise.all([
    safeRows<QualityIssueRow>(qualityQuery),
    safeRows<WebhookIssueRow>(webhookQuery),
    safeRows<EmailDomainRow>(emailQuery),
  ])

  const criticalIssues = qualityIssues.filter((issue) => issue.severity === 'critical').length
  const warningIssues = qualityIssues.filter((issue) => issue.severity === 'warning').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Data quality"
        subtitle="Felaktiga kundfält, saknade fullmakter, trasiga webhooks och e-postdomäner som behöver åtgärdas."
        userEmail={admin.email}
        workspaceName={scope.companyName}
        workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Kritiska kundfel" value={criticalIssues} hint="Personnummer, orgnummer eller data som blockerar automation." tone={criticalIssues > 0 ? 'red' : 'emerald'} />
          <StatCard label="Varningar" value={warningIssues} hint="Postnummer, e-post eller saknade underlag." tone={warningIssues > 0 ? 'amber' : 'emerald'} />
          <StatCard label="Webhook-fel" value={webhookIssues.length} hint="Misslyckade eller dead-letter-leveranser." tone={webhookIssues.length > 0 ? 'red' : 'emerald'} />
          <StatCard label="E-postdomäner" value={emailDomains.length} hint="Domäner som inte är verifierade för bolagets avsändare." tone={emailDomains.length > 0 ? 'amber' : 'emerald'} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-950">Kunddata</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">Öppna kunden och rätta fältet innan nästa automatiska steg.</p>
            </div>
            <Link href="/admin/operations/integrity" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">
              Operations integrity
            </Link>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Problem</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Åtgärd</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qualityIssues.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">Inga öppna kunddatafel hittades.</td></tr> : null}
                {qualityIssues.map((issue) => (
                  <tr key={`${issue.entity_type}:${issue.entity_id}:${issue.issue_key}`}>
                    <td className="px-4 py-3"><IssueBadge severity={issue.severity} /></td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{issue.message}</td>
                    <td className="px-4 py-3 text-slate-600">{issue.entity_type} · {issue.issue_key}</td>
                    <td className="px-4 py-3">
                      {issue.customer_id ? <Link href={`/admin/customers/${issue.customer_id}`} className="font-black text-emerald-700 hover:text-emerald-900">Öppna kund</Link> : 'Manuell kontroll'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Webhook-fel</h2>
            <div className="mt-4 space-y-3">
              {webhookIssues.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga misslyckade webhooks.</p> : null}
              {webhookIssues.map((issue) => (
                <div key={issue.id} className="rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="font-black text-red-900">{issue.event_type} · {issue.status}</p>
                  <p className="mt-1 text-sm font-semibold text-red-800">Försök: {issue.attempts}. {issue.failure_reason ?? 'Okänt fel.'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">E-postdomäner</h2>
            <div className="mt-4 space-y-3">
              {emailDomains.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Alla registrerade domäner är verifierade.</p> : null}
              {emailDomains.map((domain) => (
                <div key={domain.id} className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="font-black text-amber-950">{domain.domain} · {domain.status}</p>
                  <p className="mt-1 text-sm font-semibold text-amber-900">SPF {domain.spf_status}, DKIM {domain.dkim_status}, DMARC {domain.dmarc_status}</p>
                  {domain.failure_reason ? <p className="mt-1 text-sm text-amber-900">{domain.failure_reason}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
