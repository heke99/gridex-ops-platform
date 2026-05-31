import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getDeviationRows } from '@/lib/analytics/db'
import { AnalyticsTabs, DeviationsTable, MetricCards } from '../_components'
import type { MetricCard } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

export default async function AnalyticsDeviationsPage() {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  if (!companyId) return <div className="p-8">Bolag saknas.</div>

  const rows = await getDeviationRows(companyId)
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
        <AnalyticsTabs active="deviations" />
        <MetricCards cards={cards} />
        <div className="flex justify-end">
          <Link href="/admin/analytics/export?report=data_quality_issues" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
            Exportera CSV
          </Link>
        </div>
        <DeviationsTable rows={rows} />
      </div>
    </div>
  )
}
