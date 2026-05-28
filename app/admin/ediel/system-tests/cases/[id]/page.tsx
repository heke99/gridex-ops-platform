import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { deriveRulebookAckDecision, getBusinessProcessForMessage, expectedApplicationReferenceForProcess, RULEBOOK_TEST_CASES, listFieldRules } from '@/lib/ediel/rulebook'

export const dynamic = 'force-dynamic'

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function Badge({ children }: { children: string }) {
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">{children}</span>
}

export default async function EdielSystemTestCasePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePlatformAdminAccess()
  const { id } = await params
  const testCaseCode = decode(id)
  const testCase = RULEBOOK_TEST_CASES.find((item) => item.testCaseCode === testCaseCode)

  if (!testCase) {
    return (
      <div className="space-y-6 p-6">
        <AdminHeader title="Testfall saknas" subtitle="Rulebook hittade inte testfallet." userEmail={context.email} workspaceName="Plattformskontroll" workspaceMode="platform" />
        <Link href="/admin/ediel/system-tests" className="text-sm font-black text-emerald-700">Tillbaka till Systemtest</Link>
      </div>
    )
  }

  const process = getBusinessProcessForMessage({ family: testCase.family, code: testCase.messageCode })
  const appRef = expectedApplicationReferenceForProcess(process)
  const ack = deriveRulebookAckDecision({ family: testCase.family, code: testCase.messageCode, utiltsFunctionalError: testCase.expectedUtiltsErr === 'expected' })
  const fields = listFieldRules({ family: testCase.family, code: testCase.messageCode })

  return (
    <div className="space-y-6 p-6">
      <AdminHeader
        title={`${testCase.testCaseCode} · ${testCase.name}`}
        subtitle="Detaljerad rulebook-vy för testfall, process, ACK, fältmatris och förväntad teknisk kedja."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <Link href="/admin/ediel/system-tests" className="text-sm font-black text-emerald-700">← Tillbaka till Systemtest</Link>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-black uppercase text-slate-500">Roll</div><div className="mt-2 text-lg font-black text-slate-950">{testCase.actorRole}</div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-black uppercase text-slate-500">Meddelande</div><div className="mt-2 text-lg font-black text-slate-950">{testCase.family} {testCase.messageCode}{testCase.subtype ?? ''}</div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-black uppercase text-slate-500">Process</div><div className="mt-2 text-lg font-black text-slate-950">{process}</div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-black uppercase text-slate-500">Application Reference</div><div className="mt-2 text-lg font-black text-slate-950">{appRef ?? '—'}</div></div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Förväntad kedja</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black">Riktning</div><p className="mt-1 text-sm font-semibold text-slate-600">{testCase.direction}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black">CONTRL</div><p className="mt-1 text-sm font-semibold text-slate-600">{testCase.expectedContrl} / {ack.contrlStatus}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black">APERAK</div><p className="mt-1 text-sm font-semibold text-slate-600">{testCase.expectedAperak} / {ack.aperakStatus}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black">UTILTS_ERR</div><p className="mt-1 text-sm font-semibold text-slate-600">{testCase.expectedUtiltsErr} / {ack.utiltsErrStatus}</p></div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Fältmatris för testfallet</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-4 py-3">Fält</th><th className="px-4 py-3">Segment</th><th className="px-4 py-3">Krav</th><th className="px-4 py-3">Villkor</th></tr></thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {fields.length > 0 ? fields.map((item) => (
                <tr key={`${item.fieldKey}-${item.segmentPath}`}><td className="px-4 py-3 font-bold text-slate-950">{item.label}</td><td className="px-4 py-3 font-mono text-xs">{item.segmentPath}</td><td className="px-4 py-3"><Badge>{item.requirement}</Badge></td><td className="px-4 py-3 text-slate-600">{item.condition ?? '—'}</td></tr>
              )) : <tr><td className="px-4 py-3 text-slate-600" colSpan={4}>Inga specifika fältregler ännu. Generella rulebook-regler gäller.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
