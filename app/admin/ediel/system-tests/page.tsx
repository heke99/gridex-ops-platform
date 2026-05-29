import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCases,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import { createEdielTgtRunFromTemplateAction } from '@/app/admin/ediel/actions'

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

function caseGroup(testCase: EdielTgtTestCaseDefinition): string {
  const code = testCase.testCaseCode.toUpperCase()
  if (code.startsWith('U3.1')) return 'U3.1 - Korrekt UTILTS E66'
  if (code.startsWith('U3.2')) return 'U3.2 - Felaktig UTILTS E66'
  if (testCase.roleCode === 'esco' && testCase.suite === 'PRODAT') return 'ESCO PRODAT tillstånd'
  if (testCase.suite === 'UTILTS') return 'UTILTS övriga'
  return 'PRODAT övriga'
}

function casePriority(testCase: EdielTgtTestCaseDefinition): number {
  const code = testCase.testCaseCode.toUpperCase()
  if (code === 'U3.1.1') return 1
  if (code === 'U3.1.2') return 2
  if (code === 'U3.2.1') return 3
  if (code === 'U3.2.2') return 4
  if (testCase.roleCode === 'esco') return 10
  if (testCase.suite === 'UTILTS') return 20
  return 30
}

function compareCase(a: EdielTgtTestCaseDefinition, b: EdielTgtTestCaseDefinition) {
  const prio = casePriority(a) - casePriority(b)
  if (prio !== 0) return prio
  return a.testCaseCode.localeCompare(b.testCaseCode, 'sv')
}

function statusTone(status: string | null | undefined): Tone {
  if (status === 'passed') return 'emerald'
  if (status === 'failed') return 'red'
  if (status === 'running' || status === 'draft') return 'amber'
  return 'slate'
}

function portalStatusForCase(testCase: EdielTgtTestCaseDefinition, activeRuns: Awaited<ReturnType<typeof listEdielTestRuns>>) {
  const runs = activeRuns.filter((run) =>
    run.test_suite === testCase.suite &&
    run.role_code === testCase.roleCode &&
    run.test_case_code === testCase.testCaseCode &&
    run.status !== 'cancelled'
  )

  if (runs.some((run) => run.status === 'passed')) return { label: 'Klar', tone: 'emerald' as Tone }
  if (runs.some((run) => run.status === 'failed')) return { label: 'Fel', tone: 'red' as Tone }
  if (runs.some((run) => run.status === 'running' || run.status === 'draft')) return { label: 'Pågår', tone: 'amber' as Tone }
  return { label: 'Inte påbörjad', tone: 'slate' as Tone }
}

function StartRunForm({ testCase }: { testCase: EdielTgtTestCaseDefinition }) {
  return (
    <form action={createEdielTgtRunFromTemplateAction}>
      <input type="hidden" name="testSuite" value={testCase.suite} />
      <input type="hidden" name="roleCode" value={testCase.roleCode} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
        Starta testkörning
      </button>
    </form>
  )
}

function TestCard({ testCase, activeRuns }: { testCase: EdielTgtTestCaseDefinition; activeRuns: Awaited<ReturnType<typeof listEdielTestRuns>> }) {
  const status = portalStatusForCase(testCase, activeRuns)
  const activeCount = activeRuns.filter((run) =>
    run.test_suite === testCase.suite &&
    run.role_code === testCase.roleCode &&
    run.test_case_code === testCase.testCaseCode &&
    (run.status === 'running' || run.status === 'draft')
  ).length

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="emerald">{testCase.testCaseCode}</Badge>
            <Badge>{testCase.suite}</Badge>
            <Badge>{testCase.roleCode === 'esco' ? 'Energitjänsteföretag' : testCase.roleCode}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {activeCount > 1 ? <Badge tone="red">{activeCount} aktiva — rensa gamla</Badge> : null}
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950">{testCase.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{testCase.purpose}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
        {testCase.testDataHint}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StartRunForm testCase={testCase} />
        <Link href={`/admin/ediel/system-tests/cases/${encodeURIComponent(testCase.testCaseCode)}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Öppna test
        </Link>
      </div>
    </div>
  )
}

export default async function EdielSystemTestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; suite?: string; role?: string }>
}) {
  const context = await requirePlatformAdminAccess()
  const query = searchParams ? await searchParams : {}
  const q = String(query.q ?? '').trim().toUpperCase()
  const suite = String(query.suite ?? '').trim().toUpperCase()
  const role = String(query.role ?? '').trim().toLowerCase()

  const [testRuns, messages] = await Promise.all([
    listEdielTestRuns().catch(() => []),
    listEdielMessages({ limit: 300 }).catch(() => []),
  ])

  const definitions = getEdielTgtTestCases()
    .filter((testCase) => testCase.scope === 'core')
    .filter((testCase) => !suite || testCase.suite === suite)
    .filter((testCase) => !role || testCase.roleCode === role)
    .filter((testCase) => {
      if (!q) return true
      return [testCase.testCaseCode, testCase.title, testCase.purpose, testCase.suite, testCase.roleCode]
        .join(' ')
        .toUpperCase()
        .includes(q)
    })
    .sort(compareCase)

  const u3Cases = getEdielTgtTestCases()
    .filter((testCase) => testCase.roleCode === 'esco' && testCase.suite === 'UTILTS' && testCase.testCaseCode.startsWith('U3.'))
    .sort(compareCase)

  const evaluations = testRuns
    .filter((run) => run.status !== 'cancelled')
    .map((run) => evaluateEdielTgtRun(run, messages))
  const passed = evaluations.filter((evaluation) => evaluation.computedStatus === 'passed').length
  const failed = evaluations.filter((evaluation) => evaluation.computedStatus === 'failed').length
  const running = testRuns.filter((run) => run.status === 'running' || run.status === 'draft').length

  const groups = Array.from(new Set(definitions.map(caseGroup)))

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel Systemtest"
        subtitle="Körbara TGT-/AGT-testfall med tydlig filtrering, run-status och synk mot inkommande/utgående Ediel-meddelanden."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Primärt testpaket nu</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">UTILTS E66 för energitjänsteföretag</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Starta ett U3-test i Gridex, starta samma test i Edielportalen och importera/polla portalens inbound UTILTS E66. Systemet kopplar då payloaden till rätt aktiv run och skapar nästa svar enligt testkedjan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="emerald">{passed} klara</Badge>
            <Badge tone={failed > 0 ? 'red' : 'slate'}>{failed} fel</Badge>
            <Badge tone={running > 0 ? 'amber' : 'slate'}>{running} aktiva</Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {u3Cases.map((testCase) => (
            <TestCard key={testCase.testCaseCode} testCase={testCase} activeRuns={testRuns} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Filtrera testfall</h2>
            <p className="mt-1 text-sm text-slate-700">Använd sökningen för U3.1.1, U3.1.2, U3.2.1, U3.2.2, E66, SCH, kvart eller energitjänsteföretag.</p>
          </div>
          <Link href="/admin/ediel/agt" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Öppna AGT-vy
          </Link>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-4">
          <input name="q" defaultValue={q} placeholder="Sök testfall, t.ex. U3.1.1 eller E66" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select name="suite" defaultValue={suite} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Alla sviter</option>
            <option value="PRODAT">PRODAT</option>
            <option value="UTILTS">UTILTS</option>
            <option value="AI_LIST">AI-lista</option>
          </select>
          <select name="role" defaultValue={role} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Alla roller</option>
            <option value="supplier">Leverantör</option>
            <option value="esco">Energitjänsteföretag</option>
            <option value="grid_owner">Nätägare</option>
          </select>
          <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Filtrera</button>
        </form>
      </section>

      {groups.map((group) => {
        const items = definitions.filter((testCase) => caseGroup(testCase) === group)
        return (
          <section key={group} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">{group}</h2>
              <Badge>{items.length} testfall</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((testCase) => (
                <TestCard key={`${testCase.suite}-${testCase.roleCode}-${testCase.testCaseCode}`} testCase={testCase} activeRuns={testRuns} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
