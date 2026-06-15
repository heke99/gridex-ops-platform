import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getCompanyById, getCompanyGovernanceSummary } from '@/lib/tenant/governance'
import { getActorTestingSummary, getActorTestingStatusLabel, getProductionReadinessLabel } from '@/lib/ediel/actorTesting'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type TestRun = {
  id: string
  test_area: string | null
  test_case_code: string | null
  test_case_name: string | null
  environment: string | null
  status: string | null
  updated_at: string | null
  completed_at: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusBadge(status: string | null | undefined) {
  const tone = status === 'passed'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'failed' || status === 'blocked'
      ? 'border-red-200 bg-red-50 text-red-800'
      : status === 'running'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${tone}`}>{status ?? 'not_started'}</span>
}

async function listCompanyTestRuns(companyId: string): Promise<TestRun[]> {
  try {
    const { data, error } = await supabaseService
      .from('company_actor_test_runs')
      .select('id,test_area,test_case_code,test_case_name,environment,status,updated_at,completed_at')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(50)
    if (error) return []
    return (data ?? []) as TestRun[]
  } catch {
    return []
  }
}

export default async function CompanyTestingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const row = await getCompanyById(companyId)

  if (!row) {
    return <div className="p-8"><div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div></div>
  }

  const [company, summary, runs] = await Promise.all([
    getCompanyGovernanceSummary(row),
    getActorTestingSummary(companyId),
    listCompanyTestRuns(companyId),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Tester & certifiering · ${company.name}`}
        subtitle="Separat testyta. Live-/produktionsprofilen på bolagskortet ska hållas ren från testdata."
        userEmail={admin.email}
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/companies/${companyId}`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700">Till bolagskort</Link>
          <Link href={`/admin/platform/actor-testing/${companyId}`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800">Aktörstester</Link>
          <Link href={`/admin/platform/actor-testing/${companyId}/evidence`} className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-800">Bevispaket</Link>
          <Link href={`/admin/ediel/test-center?companyId=${companyId}`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700">Testcenter</Link>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Certifiering</p>
            <h2 className="mt-2 text-xl font-black text-emerald-950">{summary ? getActorTestingStatusLabel(summary.actorTestStatus) : 'Ej startad'}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-emerald-800">PRODAT/UTILTS/AGT-teststatus registreras på bolaget och används som underlag inför live.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Produktion</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{summary ? getProductionReadinessLabel(summary.productionReadiness) : 'Ej bedömd'}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Produktionsrutter, certifikat och BRP kontrolleras i go-live, inte i testytan.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Separation</p>
            <h2 className="mt-2 text-xl font-black text-amber-950">Testdata hålls separat</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-amber-900">Edielportal, test-BRP, testreceiver och testpayloads ska inte blandas in i live-bolagskortet.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Senaste testkörningar</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600"><tr><th className="px-4 py-3">Test</th><th className="px-4 py-3">Område</th><th className="px-4 py-3">Miljö</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Senast</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {runs.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center font-semibold text-slate-600">Inga separata testkörningar är registrerade ännu. Använd Aktörstester/Testcenter och registrera status på bolaget.</td></tr> : null}
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 font-black text-slate-900">{run.test_case_code ?? '–'}<div className="text-xs font-semibold text-slate-500">{run.test_case_name ?? ''}</div></td>
                    <td className="px-4 py-3 text-slate-700">{run.test_area ?? 'ediel'}</td>
                    <td className="px-4 py-3 text-slate-700">{run.environment ?? 'test'}</td>
                    <td className="px-4 py-3">{statusBadge(run.status)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(run.completed_at ?? run.updated_at)}</td>
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
