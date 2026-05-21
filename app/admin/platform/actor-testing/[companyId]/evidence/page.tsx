import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { ACTOR_TEST_CASES, getActorTestingSummary, getActorTestStatusLabel } from '@/lib/ediel/actorTesting'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

export default async function EvidencePage({ params }: { params: Promise<{ companyId: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const summary = await getActorTestingSummary(companyId)

  if (!summary) {
    return <div className="p-8">Bolaget hittades inte.</div>
  }

  const resultsByKey = new Map(summary.results.map((result) => [result.test_key, result]))

  return (
    <div className="min-h-screen">
      <AdminHeader title={`Bevispaket · ${summary.company.name}`} subtitle="Underlag för aktörstest, portalstatus, payload och audit. Export kan tas från tabellen eller rå payload per rad." userEmail={admin.email} workspaceMode="platform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <Link href={`/admin/platform/actor-testing/${summary.company.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Tillbaka till bolagskort</Link>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <Info label="Bolag" value={summary.company.name} />
            <Info label="Orgnummer" value={summary.company.org_number} />
            <Info label="Ediel-id" value={summary.company.ediel_id ?? summary.company.production_ediel_id} />
            <Info label="BRP" value={summary.company.brp_ediel_id ?? summary.company.brp_name} />
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-6 py-4">Testfall</th>
                  <th className="px-6 py-4">Test-ID</th>
                  <th className="px-6 py-4">Riktning</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Portalstatus</th>
                  <th className="px-6 py-4">Tidpunkt</th>
                  <th className="px-6 py-4">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ACTOR_TEST_CASES.map((testCase) => {
                  const result = resultsByKey.get(testCase.key)
                  return (
                    <tr key={testCase.key} className="align-top">
                      <td className="px-6 py-4 font-semibold text-slate-950">{testCase.label}</td>
                      <td className="px-6 py-4">{testCase.testId ?? '–'}</td>
                      <td className="px-6 py-4">{testCase.direction === 'actor_to_portal' ? 'Aktör → Portal' : 'Portal → Aktör'}</td>
                      <td className="px-6 py-4">{getActorTestStatusLabel(result?.status)}</td>
                      <td className="px-6 py-4">{result?.portal_status ?? '–'}</td>
                      <td className="px-6 py-4">{formatDate(result?.latest_run_at)}</td>
                      <td className="px-6 py-4"><pre className="max-h-40 max-w-xl overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">{result?.raw_payload ?? 'Ingen rå payload sparad.'}</pre></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-slate-950">{value?.trim() || '–'}</div>
    </div>
  )
}
