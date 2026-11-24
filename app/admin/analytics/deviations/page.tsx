import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { getDeviationRows } from '@/lib/analytics/db'
import { deviationPage, OPEN_DEVIATIONS_REPORT } from '@/lib/analytics/deviationPagination'
import { AnalyticsUnavailable, AnalyticsTabs, DeviationsTable, MetricCards } from '../_components'
import type { MetricCard } from '@/lib/analytics/types'
import { monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

export default async function AnalyticsDeviationsPage({ searchParams }: { searchParams?: Promise<{ page?: string | string[]; month?: string }> } = {}) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  if (!companyId) return <div className="p-8">Bolag saknas.</div>

  const rows = await getDeviationRows(companyId).catch(() => null)
  if (!rows) return <AnalyticsUnavailable />
  const params = await searchParams
  const month = typeof params?.month === 'string' ? monthStart(params.month) : undefined
  const { page, lastPage, displayed } = deviationPage(rows, params?.page)
  const exportQuery = new URLSearchParams({ report: OPEN_DEVIATIONS_REPORT, page: String(page), expected_company_id: companyId })
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams({ page: String(nextPage) })
    if (month) query.set('month', month.slice(0, 7))
    return `?${query}`
  }
  const canReadCustomers = scope.isPlatformAdmin || admin.permissions.some(permission => ['customers.read', 'masterdata.read'].includes(permission))
  const count = (type: string) => rows.filter((row) => row.type === type).length
  const cards: MetricCard[] = [
    { key: 'missing_values', label: 'Saknade mätvärden', value: String(count('Saknade mätvärden')), hint: 'Mätvärden saknas för perioden', status: count('Saknade mätvärden') ? 'critical' : 'ok' },
    { key: 'missing_zone', label: 'Saknat SE-område', value: String(count('Saknat SE-område')), hint: 'Kräver komplettering', status: count('Saknat SE-område') ? 'warning' : 'ok' },
    { key: 'missing_owner', label: 'Saknad nätägare', value: String(count('Saknad nätägare')), hint: 'Påverkar prognos och begäran', status: count('Saknad nätägare') ? 'warning' : 'ok' },
    { key: 'forecast', label: 'Prognosavvikelse', value: String(count('Prognosavvikelse')), hint: 'Diff mot faktiskt utfall', status: count('Prognosavvikelse') ? 'warning' : 'ok' },
    { key: 'failed_ediel', label: 'Misslyckade Ediel-meddelanden', value: String(count('Misslyckade Ediel-meddelanden')), hint: 'PRODAT, UTILTS, CONTRL eller APERAK', status: count('Misslyckade Ediel-meddelanden') ? 'critical' : 'ok' },
    { key: 'slow_owner', label: 'Långsam nätägarsvarstid', value: String(count('Långsam nätägarsvarstid')), hint: 'Svar saknas efter 72 timmar', status: count('Långsam nätägarsvarstid') ? 'warning' : 'ok' },
    { key: 'incomplete_customer', label: 'Ofullständig kunddata', value: String(count('Ofullständig kunddata')), hint: 'Kunddata behöver kompletteras', status: count('Ofullständig kunddata') ? 'warning' : 'ok' },
    { key: 'all', label: 'Öppna avvikelser', value: String(rows.length), hint: 'Totalt att följa upp', status: rows.length ? 'warning' : 'ok' },
  ]

  return (
    <div className="min-h-screen">
      <AdminHeader title="Avvikelser" subtitle="Datakvalitet och operativa varningar som påverkar statistik och prognos." userEmail={admin.email} workspaceName={scope.companyName} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="deviations" month={month} />
        <MetricCards cards={cards} />
        <div className="flex justify-end">
          <a href={`/admin/analytics/export?${exportQuery}`} download className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
            Exportera sidan som CSV
          </a>
        </div>
        <p className="text-sm text-slate-600">{rows.length} öppna avvikelser i det fullständigt inlästa aktuella underlaget. Visar {displayed.length} på sida {page}. Historisk månadsstatistik är ett separat underlag.</p>
        <DeviationsTable rows={displayed} canReadCustomers={canReadCustomers} />
        <nav aria-label="Sidor med avvikelser" className="flex gap-4">{page > 1 ? <Link href={pageHref(page - 1)} className="underline">Föregående</Link> : null}{page < lastPage ? <Link href={pageHref(page + 1)} className="underline">Nästa</Link> : null}</nav>
      </div>
    </div>
  )
}
