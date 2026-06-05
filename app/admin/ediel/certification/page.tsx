import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { certificationSummary, EDIEL_BATCH4_CERTIFICATION_CASES, type EdielCertificationCase } from '@/lib/ediel/rulebook/testCaseRuleRegistry'

export const dynamic = 'force-dynamic'

function statusTone(status: EdielCertificationCase['status']): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-900'
  return 'border-amber-200 bg-amber-50 text-amber-900'
}

function nextStep(testCase: EdielCertificationCase): string {
  if (testCase.status === 'approved') return 'Skyddad regression'
  if (testCase.testCaseCode === 'E7') return 'Åtgärda Z15V-negativ APERAK och kör om'
  if (testCase.status === 'pending') return 'Kör readiness och starta test i portalen'
  return 'Granska portalens expected/actual'
}

function CaseTable({ title, cases }: { title: string; cases: EdielCertificationCase[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Certifiering</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">{title}</h2>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">{cases.length} testfall</span>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
            <tr>
              <th className="px-4 py-3">Testfall</th>
              <th className="px-4 py-3">Meddelande</th>
              <th className="px-4 py-3">Riktning</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Senaste beslut</th>
              <th className="px-4 py-3">Nästa steg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {cases.map((testCase) => (
              <tr key={testCase.testCaseCode}>
                <td className="px-4 py-3 font-black text-slate-950">{testCase.testCaseCode}<div className="text-xs font-semibold text-slate-500">{testCase.portalTestId ?? '—'}</div></td>
                <td className="px-4 py-3 font-semibold text-slate-800">{testCase.messageFamily} {testCase.messageCode}{testCase.variant ? `-${testCase.variant}` : ''}</td>
                <td className="px-4 py-3 font-semibold text-slate-700">{testCase.direction === 'actor_to_portal' ? 'Gridex → Portal' : 'Portal → Gridex'}</td>
                <td className="px-4 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(testCase.status)}`}>{testCase.status}</span></td>
                <td className="px-4 py-3 font-semibold text-slate-700">{testCase.expectedContrl} CONTRL + {testCase.expectedBusinessOutcome} {testCase.expectedBusinessResponseFamily}</td>
                <td className="px-4 py-3 font-semibold text-slate-700">{nextStep(testCase)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function EdielCertificationPage() {
  const context = await requirePlatformAdminAccess()
  const summary = certificationSummary()
  const supplierProdat = EDIEL_BATCH4_CERTIFICATION_CASES.filter((item) => item.profileKey === 'supplier_prodat_agt')
  const supplierUtilts = EDIEL_BATCH4_CERTIFICATION_CASES.filter((item) => item.profileKey === 'supplier_utilts_agt')
  const energyProdat = EDIEL_BATCH4_CERTIFICATION_CASES.filter((item) => item.profileKey === 'energy_service_prodat_agt')
  const energyUtilts = EDIEL_BATCH4_CERTIFICATION_CASES.filter((item) => item.profileKey === 'energy_service_utilts_agt')

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel certifiering"
        subtitle="Enkel översikt över L/UL/E/UE-testfall. Testfall är regression och facit, inte produktionslogik."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Batch 4 · Certification</p>
              <h1 className="mt-2 text-3xl font-black text-slate-950">Samma engine för test och produktion</h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
                Godkända tester låses som golden regression. E7 är aktivt fixmål. E4, E8, UE1 och UE2 ligger som readiness.
              </p>
            </div>
            <Link href="/admin/ediel/rule-profiles" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Regelprofiler</Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Totalt</div><div className="mt-1 text-2xl font-black text-slate-950">{summary.total}</div></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-900">Godkända</div><div className="mt-1 text-2xl font-black text-emerald-950">{summary.approved}</div></div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4"><div className="text-xs font-black uppercase tracking-[0.14em] text-red-900">Fixmål</div><div className="mt-1 text-2xl font-black text-red-950">{summary.failed}</div></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-black uppercase tracking-[0.14em] text-amber-900">Pending</div><div className="mt-1 text-2xl font-black text-amber-950">{summary.pending}</div></div>
          </div>
        </section>

        <CaseTable title="Leverantör · PRODAT" cases={supplierProdat} />
        <CaseTable title="Leverantör · UTILTS" cases={supplierUtilts} />
        <CaseTable title="Energitjänsteföretag · PRODAT" cases={energyProdat} />
        <CaseTable title="Energitjänsteföretag · UTILTS" cases={energyUtilts} />
      </main>
    </div>
  )
}
