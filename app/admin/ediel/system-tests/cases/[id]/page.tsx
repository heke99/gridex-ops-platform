import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { findRulebookTestCase } from '@/lib/ediel/rulebook/testCaseMatcher'
import { defaultApplicationReferenceForProcess } from '@/lib/ediel/rulebook/rulebook'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { runRulebookRegressionAction } from '@/app/admin/ediel/system-tests/actions'

export const dynamic = 'force-dynamic'

function cardClassName() {
  return 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'
}

export default async function SystemTestCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdminAccess()
  const { id } = await params
  const testCase = findRulebookTestCase(decodeURIComponent(id))

  if (!testCase) {
    return (
      <main className="space-y-6">
        <AdminHeader title="Testfall saknas" subtitle="Rulebook hittade inget testfall med den här koden." />
        <Link href="/admin/ediel/system-tests?tab=cases" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Tillbaka</Link>
      </main>
    )
  }

  const appRef = defaultApplicationReferenceForProcess(testCase.processGroup as never, testCase.family)
  const validation = validateRulebookMessage({
    family: testCase.family,
    code: testCase.code,
    processGroup: testCase.processGroup,
    applicationReference: appRef,
    mode: 'test',
  })

  return (
    <main className="space-y-6">
      <AdminHeader title={`${testCase.testCaseCode} · ${testCase.title}`} subtitle="Detaljerad rulebook-vy för testfall, processgrupp, ACK-förväntan och validering." />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className={cardClassName()}>
          <h2 className="text-lg font-black text-slate-950">Testfall</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div><dt className="font-bold text-slate-600">Svit</dt><dd>{testCase.suite}</dd></div>
            <div><dt className="font-bold text-slate-600">Roll</dt><dd>{testCase.role}</dd></div>
            <div><dt className="font-bold text-slate-600">Meddelande</dt><dd>{testCase.family} {testCase.code} {testCase.subtype ?? ''}</dd></div>
            <div><dt className="font-bold text-slate-600">Processgrupp</dt><dd>{testCase.processGroup}</dd></div>
            <div><dt className="font-bold text-slate-600">Application Reference</dt><dd>{appRef ?? '—'}</dd></div>
          </dl>
        </section>
        <section className={cardClassName()}>
          <h2 className="text-lg font-black text-slate-950">Förväntad kvittens</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div><dt className="font-bold text-slate-600">CONTRL</dt><dd>{testCase.expectedContrl}</dd></div>
            <div><dt className="font-bold text-slate-600">APERAK</dt><dd>{testCase.expectedAperak}</dd></div>
            <div><dt className="font-bold text-slate-600">UTILTS_ERR</dt><dd>{testCase.expectedUtiltsErr}</dd></div>
          </dl>
          <form action={runRulebookRegressionAction} className="mt-4">
            <input type="hidden" name="scope" value="all" />
            <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Kör regression</button>
          </form>
        </section>
        <section className={cardClassName()}>
          <h2 className="text-lg font-black text-slate-950">Validering</h2>
          <div className={`mt-4 rounded-2xl border p-4 text-sm ${validation.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {validation.ok ? 'Rulebook-validering är grön.' : 'Rulebook-validering blockerar.'}
          </div>
          <div className="mt-3 space-y-2">
            {validation.issues.map((issue) => (
              <div key={`${issue.code}-${issue.description}`} className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                <div className="font-bold text-slate-950">{issue.code} · {issue.title}</div>
                <div>{issue.description}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Teknisk kedja som ska fyllas vid körning</h2>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify({ testCase, validation }, null, 2)}</pre>
      </section>
    </main>
  )
}
