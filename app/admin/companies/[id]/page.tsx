import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireCompanyScopedAdminAccess } from '@/lib/admin/guards'
import {
  getCompanyById,
  getCompanyStatusCopy,
  normalizeCompanyStatus,
} from '@/lib/tenant/governance'
import {
  getCompanyBillingStatistics,
  resolveCompanyStatisticsRange,
} from '@/lib/tenant/companyStatistics'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function metricTone(value: number) {
  if (value === 0) return 'border-slate-200 bg-white text-slate-800'
  if (value < 5) return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  return 'border-emerald-300 bg-emerald-100 text-emerald-950'
}

export default async function CompanyDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const admin = await requireCompanyScopedAdminAccess(id, { anyOf: ['tenants.read', 'reports.read', 'users.read'] })
  const company = await getCompanyById(id)

  if (!company) {
    return (
      <div className="space-y-6 p-8">
        <Link href={admin.isPlatformAdmin ? '/admin/companies' : '/admin/company-settings'} className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">
          Tillbaka
        </Link>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  const status = normalizeCompanyStatus(company.status)
  const statusCopy = getCompanyStatusCopy(status)
  const range = resolveCompanyStatisticsRange(query)
  const statistics = await getCompanyBillingStatistics(company.id, range)
  const mainTotals = statistics.totals.slice(0, 12)
  const billingTotals = statistics.totals.slice(12)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`${company.name} · bolagsvy`}
        subtitle={admin.isPlatformAdmin
          ? 'Superadmin-vy för tenantstatus, volymer och faktureringsgrundande statistik.'
          : 'Bolagsvy med endast det egna bolagets statistik och driftdata.'}
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={admin.isPlatformAdmin ? '/admin/companies' : '/admin/company-settings'} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Tillbaka
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusCopy.tone}`}>{statusCopy.label}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {company.org_number ?? 'Orgnummer saknas'}
            </span>
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
            <p className="text-sm font-medium text-slate-700">Bolag</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">{company.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">{statusCopy.description}</p>
            {company.status_reason ? (
              <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Senaste anledning: {company.status_reason}
              </p>
            ) : null}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Kontakt</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">{company.primary_contact_name ?? 'Kontaktperson saknas'}</p>
            <p className="mt-1 break-all text-sm text-slate-700">{company.primary_contact_email ?? 'E-post saknas'}</p>
            <p className="mt-1 text-sm text-slate-700">{company.phone ?? 'Telefon saknas'}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Senast uppdaterad</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{formatDate(company.updated_at)}</p>
            <p className="mt-2 text-sm text-slate-700">Skapad {formatDate(company.created_at)}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Statistikperiod</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">{statistics.range.label}</h2>
              <p className="mt-1 text-sm text-slate-700">{statistics.range.from} till {statistics.range.to}</p>
            </div>
            <form className="flex flex-wrap items-end gap-3">
              <select name="range" defaultValue={statistics.range.key} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm">
                <option value="current_month">Denna månad</option>
                <option value="previous_month">Förra månaden</option>
                <option value="last_3_months">Senaste 3 månaderna</option>
                <option value="last_12_months">Senaste 12 månaderna</option>
                <option value="custom">Egen period</option>
              </select>
              <input name="from" type="date" defaultValue={statistics.range.from} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
              <input name="to" type="date" defaultValue={statistics.range.to} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
              <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Filtrera</button>
            </form>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {mainTotals.map((metric) => (
            <div key={metric.key} className={`rounded-3xl border p-5 shadow-sm ${metricTone(metric.value)}`}>
              <p className="text-sm font-medium opacity-85">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
              <p className="mt-2 text-xs leading-5 opacity-80">{metric.description}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Faktureringsgrundande volymer</h2>
            <p className="mt-1 text-sm text-slate-700">
              Det här fakturerar inte ännu, men ger datagrunden för framtida prissättning per kund, anläggning, mätpunkt, fullmakt, Ediel-meddelande eller export.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {billingTotals.map((metric) => (
                <div key={metric.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{metric.label}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-700">{metric.billingHint ?? metric.description}</p>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm font-semibold text-emerald-900">{metric.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Användare per roll</h2>
              <div className="mt-4 space-y-2">
                {statistics.roleBreakdown.length === 0 ? (
                  <p className="text-sm text-slate-700">Inga aktiva användare hittades.</p>
                ) : (
                  statistics.roleBreakdown.map((row) => (
                    <div key={row.role} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                      <span className="font-medium text-slate-800">{row.role}</span>
                      <span className="font-semibold text-slate-950">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Genvägar</h2>
              <div className="mt-4 grid gap-2">
                <Link href={`/admin/companies/${company.id}/users`} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Hantera bolagets användare</Link>
                <Link href="/admin/company-settings" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Bolagsinställningar</Link>
                <Link href="/admin/ediel/settings" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ediel-aktörsprofil</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Volym per månad</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Månad</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Kunder</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Ediel</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Mätvärden</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Fullmakter</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Underlag</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Exporter</th>
                </tr>
              </thead>
              <tbody>
                {statistics.monthlyVolumes.map((row) => (
                  <tr key={row.month} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-950">{row.month}</td>
                    <td className="px-4 py-3 text-slate-700">{row.customers}</td>
                    <td className="px-4 py-3 text-slate-700">{row.edielMessages}</td>
                    <td className="px-4 py-3 text-slate-700">{row.meteringValues}</td>
                    <td className="px-4 py-3 text-slate-700">{row.authorizations}</td>
                    <td className="px-4 py-3 text-slate-700">{row.billingUnderlays}</td>
                    <td className="px-4 py-3 text-slate-700">{row.partnerExports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
