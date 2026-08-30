import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadTenantIntegrityDashboard, type TenantIntegritySeverity } from '@/lib/tenant/integrity'
import { runTenantIntegrityAuditAction } from './actions'

export const dynamic = 'force-dynamic'

const severityLabel: Record<TenantIntegritySeverity, string> = {
  critical: 'Kritisk',
  high: 'Hög',
  medium: 'Medium',
  low: 'Låg',
  info: 'Info',
}

const severityClass: Record<TenantIntegritySeverity, string> = {
  critical: 'border-red-300 bg-red-50 text-red-900',
  high: 'border-orange-300 bg-orange-50 text-orange-900',
  medium: 'border-amber-300 bg-amber-50 text-amber-900',
  low: 'border-sky-300 bg-sky-50 text-sky-900',
  info: 'border-slate-300 bg-slate-50 text-slate-800',
}

function formatDate(value: string | null): string {
  if (!value) return 'Ej körd'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(new Date(value))
}

function companyStatusLabel(status: string): string {
  if (status === 'healthy') return 'Konsekvent'
  if (status === 'critical') return 'Kritisk'
  if (status === 'attention') return 'Kräver åtgärd'
  if (status === 'warning') return 'Varning'
  if (status === 'failed') return 'Auditfel'
  if (status === 'running') return 'Körs'
  return 'Ej auditerad'
}

function companyStatusClass(status: string): string {
  if (status === 'healthy') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'critical') return 'border-red-300 bg-red-50 text-red-900'
  if (status === 'attention') return 'border-orange-300 bg-orange-50 text-orange-900'
  if (status === 'warning') return 'border-amber-300 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function TenantIntegrityPage() {
  const admin = await requirePlatformAdminAccess()
  const { companies, findings, rules, runs } = await loadTenantIntegrityDashboard()
  const companyNameById = new Map(companies.map((company) => [company.company_id, company.company_name || company.company_id]))

  const critical = companies.reduce((total, company) => total + (company.critical_count ?? 0), 0)
  const high = companies.reduce((total, company) => total + (company.high_count ?? 0), 0)
  const releaseGate = findings.filter((finding) => finding.enforcement_mode === 'release_gate').length
  const healthyCompanies = companies.filter((company) => company.integrity_status === 'healthy').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Tenant-integritet"
        subtitle="Canonical audit av tenant, användare, RBAC, kundgraf, outbound och Ediel. Auditorn rapporterar avvikelser men skriver aldrig om affärsdata automatiskt."
        userEmail={admin.email}
      />

      <main className="space-y-6 p-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Tenants" value={companies.length} />
          <Metric label="Konsekventa" value={healthyCompanies} />
          <Metric label="Kritiska fynd" value={critical} tone={critical > 0 ? 'danger' : 'ok'} />
          <Metric label="Höga fynd" value={high} tone={high > 0 ? 'warning' : 'ok'} />
          <Metric label="Release-gate fynd" value={releaseGate} tone={releaseGate > 0 ? 'warning' : 'ok'} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Kör integritetsaudit</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Global körning kontrollerar alla tenants. Du kan också köra en tenant separat efter en ändring eller korrigering. Resultaten sparas med audit-historik och evidens.
              </p>
            </div>
            <form action={runTenantIntegrityAuditAction} className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-slate-600">
                Scope
                <select name="scope" defaultValue="all" className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                  <option value="all">Alla kontroller</option>
                  <option value="access">Användare & RBAC</option>
                  <option value="operations">Kund & operations</option>
                  <option value="ediel">Ediel</option>
                </select>
              </label>
              <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                Kör global audit
              </button>
            </form>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Tenant-status</h2>
              <p className="mt-1 text-sm text-slate-600">Senaste effektiva audit per tenant. En ny tenant-specifik körning supersedar äldre globala resultat för just den tenanten.</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="py-2 pr-4">Bolag</th>
                  <th className="py-2 pr-4">Bolagsstatus</th>
                  <th className="py-2 pr-4">Integritet</th>
                  <th className="py-2 pr-4">Fynd</th>
                  <th className="py-2 pr-4">Senast auditerad</th>
                  <th className="py-2 text-right">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.company_id} className="border-b border-slate-100 align-middle">
                    <td className="py-3 pr-4 font-semibold text-slate-950">{company.company_name || company.company_id}</td>
                    <td className="py-3 pr-4 text-slate-600">{company.company_status || '–'}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${companyStatusClass(company.integrity_status)}`}>
                        {companyStatusLabel(company.integrity_status)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {company.finding_count ?? 0}
                      {(company.critical_count ?? 0) > 0 ? <span className="ml-2 text-xs font-semibold text-red-700">{company.critical_count} kritiska</span> : null}
                      {(company.high_count ?? 0) > 0 ? <span className="ml-2 text-xs font-semibold text-orange-700">{company.high_count} höga</span> : null}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{formatDate(company.audited_at)}</td>
                    <td className="py-3 text-right">
                      <form action={runTenantIntegrityAuditAction}>
                        <input type="hidden" name="companyId" value={company.company_id} />
                        <input type="hidden" name="scope" value="all" />
                        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                          Kör om
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Aktuella fynd</h2>
          <p className="mt-1 text-sm text-slate-600">Fynd innehåller endast teknisk evidens och canonical IDs. Ingen automatisk datakorrigering görs härifrån.</p>
          <div className="mt-4 space-y-3">
            {findings.map((finding) => (
              <article key={finding.id} className={`rounded-2xl border p-4 ${severityClass[finding.severity]}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-current/20 bg-white/60 px-2 py-0.5 text-xs font-bold">{severityLabel[finding.severity]}</span>
                      <span className="font-mono text-xs font-semibold">{finding.rule_key}</span>
                      <span className="text-xs">{finding.enforcement_mode === 'release_gate' ? 'Release gate' : 'Audit'}</span>
                    </div>
                    <h3 className="mt-2 font-semibold">{finding.title}</h3>
                    <p className="mt-1 text-sm">{finding.message}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p>{finding.company_id ? companyNameById.get(finding.company_id) || finding.company_id : 'Globalt'}</p>
                    <p className="mt-1 opacity-75">{finding.entity_type} · {finding.entity_id || '–'}</p>
                  </div>
                </div>
                {finding.remediation_hint ? (
                  <div className="mt-3 rounded-xl border border-current/15 bg-white/60 p-3 text-sm">
                    <span className="font-semibold">Rekommenderad åtgärd:</span> {finding.remediation_hint}
                  </div>
                ) : null}
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-semibold">Visa teknisk evidens</summary>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-slate-100">{JSON.stringify(finding.evidence, null, 2)}</pre>
                </details>
              </article>
            ))}
            {findings.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-900">
                Inga aktuella integritetsavvikelser hittades i senaste effektiva audit.
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Canonical regelregister</h2>
            <div className="mt-4 space-y-2">
              {rules.map((rule) => (
                <div key={rule.rule_key} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-slate-500">{rule.rule_key}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{rule.title}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityClass[rule.severity]}`}>{severityLabel[rule.severity]}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{rule.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Senaste körningar</h2>
            <div className="mt-4 space-y-2">
              {runs.map((run) => (
                <div key={run.id} className="rounded-2xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">{run.company_id ? companyNameById.get(run.company_id) || run.company_id : 'Alla tenants'}</span>
                    <span className="text-xs font-semibold text-slate-500">{run.scope}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{formatDate(run.started_at)}</span>
                    <span>Status: {run.status}</span>
                    <span>Fynd: {run.finding_count}</span>
                    <span>Kritiska: {run.critical_count}</span>
                    <span>Höga: {run.high_count}</span>
                  </div>
                  {run.error_message ? <p className="mt-2 text-xs font-medium text-red-700">{run.error_message}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'ok' | 'warning' | 'danger' }) {
  const className = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-900'
    : tone === 'warning'
      ? 'border-orange-200 bg-orange-50 text-orange-900'
      : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-slate-200 bg-white text-slate-950'

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  )
}
