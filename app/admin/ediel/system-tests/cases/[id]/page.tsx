import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { findRulebookTestCase } from '@/lib/ediel/rulebook/testCaseMatcher'
import { defaultApplicationReferenceForProcess } from '@/lib/ediel/rulebook/rulebook'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { executeRulebookTestCaseAction, runRulebookRegressionAction } from '@/app/admin/ediel/system-tests/actions'

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
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={executeRulebookTestCaseAction}>
              <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
              <input type="hidden" name="executionMode" value="start_portal" />
              <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Starta testkörning</button>
            </form>
            <form action={runRulebookRegressionAction}>
              <input type="hidden" name="scope" value={testCase.role === 'energy_service_company' && testCase.family === 'UTILTS' ? 'utilts_energy_service_company' : 'all'} />
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">Kör regression</button>
            </form>
          </div>
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
        <h2 className="text-lg font-black text-slate-950">Kör med faktisk payload</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          För UTILTS E66 KVART/SCH: starta testet i Edielportalen, låt portalen skicka inbound-meddelandet, kopiera/ladda upp payloaden här om du vill validera den direkt mot valt testfall.
        </p>
        <form action={executeRulebookTestCaseAction} className="mt-4 space-y-3">
          <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
          <input type="hidden" name="executionMode" value="validate_payload" />
          <textarea name="rawPayload" rows={10} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Klistra in UNA/UNB/UNH... eller UTILTS/APERAK/CONTRL-payload" />
          <input type="file" name="payloadFile" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Validera payload mot testfallet</button>
        </form>
      </section>
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Teknisk kedja som ska fyllas vid körning</h2>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify({ testCase, validation }, null, 2)}</pre>
      </section>
    </main>
  )
}
