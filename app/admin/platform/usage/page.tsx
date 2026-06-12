import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listTenantUsageStats, type TenantUsageStatsRow } from '@/lib/tenant/usageStats'

export const dynamic = 'force-dynamic'

function total(rows: TenantUsageStatsRow[], key: keyof TenantUsageStatsRow): number {
  return rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key] as number : 0), 0)
}

function formatDate(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusTone(status: string | null): string {
  const normalized = String(status ?? '').toLowerCase()
  if (['active', 'live', 'production'].includes(normalized)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['paused', 'suspended', 'archived', 'pending_deletion'].includes(normalized)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function MetricCard({ label, value, hint, href }: { label: string; value: number | string; hint: string; href?: string }) {
  const content = (
    <div className="h-full rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-600">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">{hint}</div>
    </div>
  )

  return href ? <Link href={href}>{content}</Link> : content
}

function sortRows(rows: TenantUsageStatsRow[]): TenantUsageStatsRow[] {
  return [...rows].sort((a, b) => {
    const aRisk = a.customerBlockers + a.waitingInfoRequests + a.blockedBillingRows
    const bRisk = b.customerBlockers + b.waitingInfoRequests + b.blockedBillingRows
    if (aRisk !== bRisk) return bRisk - aRisk
    return a.companyName.localeCompare(b.companyName, 'sv')
  })
}

export default async function PlatformUsagePage() {
  const admin = await requirePlatformAdminAccess()
  const rows = await listTenantUsageStats()
  const sortedRows = sortRows(rows)
  const totals = {
    companies: rows.length,
    activeCompanies: rows.filter((row) => String(row.companyStatus ?? '').toLowerCase() === 'active').length,
    pausedCompanies: rows.filter((row) => ['paused', 'suspended', 'archived', 'pending_deletion'].includes(String(row.companyStatus ?? '').toLowerCase())).length,
    customers: total(rows, 'customers'),
    meteringPoints: total(rows, 'meteringPoints'),
    powerOfAttorneys: total(rows, 'powerOfAttorneys'),
    infoRequests: total(rows, 'infoRequests'),
    waitingInfoRequests: total(rows, 'waitingInfoRequests'),
    edielMessages: total(rows, 'edielMessages'),
    supplierSwitches: total(rows, 'supplierSwitches'),
    billingUnderlays: total(rows, 'billingUnderlays'),
    billingExportRuns: total(rows, 'billingExportRuns'),
    customerBlockers: total(rows, 'customerBlockers'),
    blockedBillingRows: total(rows, 'blockedBillingRows'),
    activeUsers: total(rows, 'activeUsers'),
    adminUsageEvents: total(rows, 'adminUsageEvents'),
    billableUsageEvents: total(rows, 'billableUsageEvents'),
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Usage & plattformsfakturering"
        subtitle="Bolagsstatistik för SaaS-fakturering och drift: kunder, anläggningar, fullmakter, Ediel, mätvärden, export och blockerare."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Plattform</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Usage som kan ligga till grund för SaaS-fakturering</h1>
              <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
                Den här sidan räknar per bolag och används för kontroll av volymer, driftuppgifter och framtida plattformsfakturering. Vanliga bolag ska inte se andra bolags statistik.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/platform/work-queue" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-black text-emerald-800 hover:bg-emerald-50">Plattformsarbetskö</Link>
              <Link href="/admin/platform/actor-testing" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Aktörstester</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Bolag" value={totals.companies} hint={`${totals.activeCompanies} aktiva · ${totals.pausedCompanies} pausade/blockerade`} href="/admin/companies" />
          <MetricCard label="Kunder" value={totals.customers} hint="Totalt antal kunder över alla tenants" />
          <MetricCard label="Mätpunkter" value={totals.meteringPoints} hint="Används som bas för drift- och faktureringsvolym" />
          <MetricCard label="Fullmakter" value={totals.powerOfAttorneys} hint="Signerade/registrerade fullmakter där tabellen finns" />
          <MetricCard label="Ediel" value={totals.edielMessages} hint="PRODAT, UTILTS, CONTRL och APERAK" />
          <MetricCard label="Aktiva användare" value={totals.activeUsers || total(rows, 'users')} hint="Medlemmar per tenant" />
          <MetricCard label="Usage events" value={totals.adminUsageEvents} hint={`${totals.billableUsageEvents} faktureringsbara`} href="/admin/platform/data-cleanup" />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Uppgiftsbegäran" value={totals.infoRequests} hint={`${totals.waitingInfoRequests} väntar på svar`} href="/admin/platform/work-queue?type=usage" />
          <MetricCard label="Leverantörsbyten" value={totals.supplierSwitches} hint="Alla switchärenden per tenant" />
          <MetricCard label="Faktureringsunderlag" value={totals.billingUnderlays} hint={`${totals.blockedBillingRows} blockerade export-/fakturarader`} />
          <MetricCard label="Exportkörningar" value={totals.billingExportRuns} hint="Billing/export runs över plattformen" />
          <MetricCard label="Öppna blockerare" value={totals.customerBlockers} hint="Kund-/operationsblockerare som kräver uppföljning" href="/admin/platform/work-queue?type=usage" />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-black text-slate-950">Usage per tenant</h2>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              Sorterad på blockerare och väntande uppgifter först. Alla räkningar görs tenant-scopat med company_id.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-6 py-4">Bolag</th>
                  <th className="px-6 py-4">Kunder</th>
                  <th className="px-6 py-4">Avtal</th>
                  <th className="px-6 py-4">Anläggningar</th>
                  <th className="px-6 py-4">Mätpunkter</th>
                  <th className="px-6 py-4">Fullmakter</th>
                  <th className="px-6 py-4">Uppgifter</th>
                  <th className="px-6 py-4">Ediel</th>
                  <th className="px-6 py-4">Fakturering</th>
                  <th className="px-6 py-4">Risk</th>
                  <th className="px-6 py-4">Usage</th>
                  <th className="px-6 py-4">Senast aktivitet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((row) => (
                  <tr key={row.companyId} className="align-top">
                    <td className="px-6 py-4">
                      <Link href={`/admin/companies/${row.companyId}`} className="font-black text-emerald-800 hover:underline">{row.companyName}</Link>
                      <div className="mt-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusTone(row.companyStatus)}`}>{row.companyStatus ?? 'okänd status'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">{row.customers}<div className="text-xs font-semibold text-slate-500">{row.activeCustomers} aktiva</div></td>
                    <td className="px-6 py-4">{row.contracts}</td>
                    <td className="px-6 py-4">{row.sites}</td>
                    <td className="px-6 py-4">{row.meteringPoints}</td>
                    <td className="px-6 py-4">{row.powerOfAttorneys}<div className="text-xs font-semibold text-slate-500">{row.authorizationScopes} scopes</div></td>
                    <td className="px-6 py-4">{row.infoRequests}<div className="text-xs font-semibold text-slate-500">{row.waitingInfoRequests} väntar</div></td>
                    <td className="px-6 py-4">{row.edielMessages}<div className="text-xs font-semibold text-slate-500">P {row.prodat} · U {row.utilts} · C {row.contrl} · A {row.aperak}</div></td>
                    <td className="px-6 py-4">{row.billingUnderlays}<div className="text-xs font-semibold text-slate-500">{row.billingExportRuns} exporter · {row.partnerExports} partner</div></td>
                    <td className="px-6 py-4">
                      <div>{row.customerBlockers} blockerare</div>
                      <div className="text-xs font-semibold text-slate-500">{row.openCustomerCases} driftuppgifter · {row.blockedBillingRows} fakturarader</div>
                    </td>
                    <td className="px-6 py-4">{row.adminUsageEvents}<div className="text-xs font-semibold text-slate-500">{row.billableUsageEvents} faktureringsbara</div></td>
                    <td className="px-6 py-4 text-slate-700">{formatDate(row.lastActivityAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={12} className="px-6 py-10 text-center text-slate-600">Inga tenants hittades.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Kontrollregler</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">Alla volymer filtreras per company_id.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">Saknade tabeller ger 0 i stället för att krascha usage-sidan.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">Fullmakter och fullmaktsscope visas separat så siffror inte blandas ihop.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">Blockerare och väntande uppgifter används som drift- och faktureringsrisk.</div>
          </div>
        </section>
      </div>
    </div>
  )
}
