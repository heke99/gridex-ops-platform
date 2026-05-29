import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCaseByCode,
  getEdielTgtTestCases,
  type EdielTgtExpectedStep,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import { createEdielTgtRunFromTemplateAction, registerEdielFileAction } from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type Tone = 'emerald' | 'amber' | 'red' | 'slate'

function badgeClass(tone: Tone) {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(tone)}`}>{children}</span>
}

function statusTone(status: string | null | undefined): Tone {
  if (status === 'passed') return 'emerald'
  if (status === 'failed') return 'red'
  if (status === 'running' || status === 'draft' || status === 'in_progress') return 'amber'
  return 'slate'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return value.replace('T', ' ').slice(0, 16)
}

function findDefinition(testCaseCode: string): EdielTgtTestCaseDefinition | null {
  const code = decodeURIComponent(testCaseCode).trim().toUpperCase()
  return getEdielTgtTestCaseByCode('UTILTS', 'esco', code)
    ?? getEdielTgtTestCases().find((testCase) => testCase.testCaseCode.toUpperCase() === code)
    ?? null
}

function StartRunForm({ testCase }: { testCase: EdielTgtTestCaseDefinition }) {
  return (
    <form action={createEdielTgtRunFromTemplateAction}>
      <input type="hidden" name="testSuite" value={testCase.suite} />
      <input type="hidden" name="roleCode" value={testCase.roleCode} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
        Starta ny testkörning
      </button>
    </form>
  )
}

function StepCard({ step }: { step: EdielTgtExpectedStep }) {
  const tone: Tone = step.actor === 'gridex' ? 'emerald' : 'amber'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone={tone}>Steg {step.stepNo}</Badge>
          <Badge>{step.direction}</Badge>
          <Badge>{step.actor === 'gridex' ? 'Gridex' : 'Edielportalen'}</Badge>
          <Badge>{step.family} {step.code}</Badge>
          {step.outcome ? <Badge tone={step.outcome === 'positive' ? 'emerald' : 'red'}>{step.outcome}</Badge> : null}
          <Badge tone={step.required ? 'amber' : 'slate'}>{step.required ? 'obligatoriskt' : 'valfritt'}</Badge>
        </div>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-950">{step.title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-700">{step.description}</p>
    </div>
  )
}

export default async function SystemTestCasePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const testCaseCode = id
  const context = await requirePlatformAdminAccess()
  const testCase = findDefinition(testCaseCode)

  if (!testCase) {
    return (
      <div className="space-y-6">
        <AdminHeader
          title="Systemtest"
          subtitle="Testfallet hittades inte."
          userEmail={context.email}
          workspaceName="Plattformskontroll"
          workspaceMode="platform"
        />
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Okänt testfall: {decodeURIComponent(testCaseCode)}. Gå tillbaka till Systemtest och välj ett testfall från listan.
        </section>
        <Link href="/admin/ediel/system-tests" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Tillbaka till Systemtest
        </Link>
      </div>
    )
  }

  const [runs, messages] = await Promise.all([
    listEdielTestRuns().catch(() => []),
    listEdielMessages({ limit: 300 }).catch(() => []),
  ])

  const matchingRuns = runs.filter((run) =>
    run.test_suite === testCase.suite &&
    run.role_code === testCase.roleCode &&
    run.test_case_code === testCase.testCaseCode &&
    run.status !== 'cancelled'
  )
  const evaluations = matchingRuns.map((run) => evaluateEdielTgtRun(run, messages))
  const latest = evaluations[0] ?? null

  return (
    <div className="space-y-6">
      <AdminHeader
        title={`${testCase.testCaseCode} · ${testCase.title}`}
        subtitle="Körbart testfall med synkad run, payload-import och förväntad teknisk kedja."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="emerald">{testCase.suite}</Badge>
              <Badge>{testCase.roleCode === 'esco' ? 'Energitjänsteföretag' : testCase.roleCode}</Badge>
              <Badge>{testCase.approvalVersion}</Badge>
              {latest ? <Badge tone={statusTone(latest.computedStatus)}>{latest.computedStatus}</Badge> : <Badge>Inte påbörjad</Badge>}
            </div>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-700">{testCase.purpose}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StartRunForm testCase={testCase} />
            <Link href="/admin/ediel/system-tests" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Tillbaka
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        <h2 className="text-base font-semibold text-slate-950">Så kör du testet</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Klicka <strong>Starta ny testkörning</strong> i Gridex.</li>
          <li>Starta exakt samma testfall i Edielportalen: <strong>{testCase.testCaseCode}</strong>.</li>
          <li>När portalen skickar inbound UTILTS/PRODAT/ACK: importera filen här nedan eller kör mailbox-poll från Ediel-vyn.</li>
          <li>Importformuläret skickar med <strong>tgtTestCaseCode={testCase.testCaseCode}</strong>, så payloaden kopplas till rätt aktiv run och inte till fel E66-test.</li>
          <li>Kontrollera kedjan under Aktiva körningar. Gridex skapar nästa svar enligt förväntat steg.</li>
        </ol>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Importera portalens payload till detta testfall</h2>
        <p className="mt-1 text-sm text-slate-700">
          Använd detta när Edielportalen skickat inbound-filen. Formuläret låser synken till {testCase.testCaseCode} så U3.1.1/U3.1.2/U3.2.1/U3.2.2 inte blandas ihop.
        </p>
        <form action={registerEdielFileAction} className="mt-4 space-y-3">
          <input type="hidden" name="direction" value="inbound" />
          <input type="hidden" name="mode" value="tgt" />
          <input type="hidden" name="tgtTestCaseCode" value={testCase.testCaseCode} />
          <label className="block text-sm font-medium text-slate-700">
            EDIFACT-fil från Edielportalen
            <input name="edielFile" type="file" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Eller klistra in raw payload
            <textarea name="rawPayload" rows={8} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="UNA...UNB...UNH..." />
          </label>
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Importera och synka till {testCase.testCaseCode}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">Förväntad kedja</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {testCase.expectedSteps.map((step) => <StepCard key={step.stepNo} step={step} />)}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">Aktiva körningar</h2>
          <Badge tone={matchingRuns.length > 1 ? 'red' : matchingRuns.length === 1 ? 'amber' : 'slate'}>{matchingRuns.length} aktiva/historiska</Badge>
        </div>
        <div className="mt-4 space-y-3">
          {evaluations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">Ingen run finns ännu. Starta testkörning först.</div>
          ) : evaluations.map((evaluation) => (
            <div key={evaluation.testRun.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(evaluation.computedStatus)}>{evaluation.computedStatus}</Badge>
                  <Badge>{evaluation.passedSteps}/{evaluation.requiredSteps} steg</Badge>
                  <Badge tone={evaluation.missingRequiredSteps > 0 ? 'amber' : 'emerald'}>{evaluation.missingRequiredSteps} saknas</Badge>
                </div>
                <div className="text-xs text-slate-600">Skapad {formatDate(evaluation.testRun.created_at)}</div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {evaluation.matches.map((match) => (
                  <div key={match.step.stepNo} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={match.status === 'passed' ? 'emerald' : match.status === 'mismatch' ? 'red' : 'slate'}>{match.status}</Badge>
                      <Badge>Steg {match.step.stepNo}</Badge>
                      <Badge>{match.step.family} {match.step.code}</Badge>
                    </div>
                    <div className="mt-2 font-semibold text-slate-900">{match.step.title}</div>
                    {match.message ? (
                      <Link href={`/admin/ediel/messages/${match.message.id}`} className="mt-2 inline-flex text-emerald-700 underline">
                        Öppna kopplat meddelande
                      </Link>
                    ) : <div className="mt-2 text-slate-600">Väntar på meddelande.</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
