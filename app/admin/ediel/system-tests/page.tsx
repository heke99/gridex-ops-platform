import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import {
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
  GRIDEX_TGT_EDIEL_ID,
} from '@/lib/ediel/fileEngine'
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCases,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import { createEdielTgtRunFromTemplateAction } from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type Tone = 'emerald' | 'amber' | 'red' | 'slate' | 'blue'
type TestRunList = Awaited<ReturnType<typeof listEdielTestRuns>>
type FilterPacket = 'all' | 'u3' | 'u31' | 'u32' | 'esco' | 'utilts' | 'prodat' | 'l' | 'e' | 'ul' | 'ue' | 'agt' | 'tgt'
type FilterStatus = 'all' | 'not_started' | 'running' | 'passed' | 'failed'

function badgeClass(tone: Tone) {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700'
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(tone)}`}>{children}</span>
}

function isU3(testCase: EdielTgtTestCaseDefinition): boolean {
  return testCase.roleCode === 'esco' && testCase.suite === 'UTILTS' && testCase.testCaseCode.toUpperCase().startsWith('U3.')
}

function caseGroup(testCase: EdielTgtTestCaseDefinition): string {
  const code = testCase.testCaseCode.toUpperCase()
  if (code.startsWith('U3.1')) return 'U3.1 - Korrekt UTILTS E66'
  if (code.startsWith('U3.2')) return 'U3.2 - Felaktig UTILTS E66'
  if (testCase.roleCode === 'esco' && testCase.suite === 'PRODAT') return 'ESCO PRODAT tillstånd'
  if (testCase.roleCode === 'esco' && testCase.suite === 'UTILTS') return 'ESCO UTILTS övriga'
  if (testCase.suite === 'UTILTS') return 'UTILTS leverantör'
  return 'PRODAT leverantör'
}

function casePriority(testCase: EdielTgtTestCaseDefinition): number {
  const code = testCase.testCaseCode.toUpperCase()
  if (code === 'U3.1.1') return 1
  if (code === 'U3.1.2') return 2
  if (code === 'U3.2.1') return 3
  if (code === 'U3.2.2') return 4
  if (testCase.roleCode === 'esco' && testCase.suite === 'UTILTS') return 10
  if (testCase.roleCode === 'esco' && testCase.suite === 'PRODAT') return 20
  if (testCase.suite === 'UTILTS') return 30
  return 40
}

function compareCase(a: EdielTgtTestCaseDefinition, b: EdielTgtTestCaseDefinition) {
  const prio = casePriority(a) - casePriority(b)
  if (prio !== 0) return prio
  return a.testCaseCode.localeCompare(b.testCaseCode, 'sv')
}

function normalizePacket(value: string | undefined): FilterPacket {
  const normalized = String(value ?? 'u3').toLowerCase()
  if (normalized === 'all' || normalized === 'u3' || normalized === 'u31' || normalized === 'u32' || normalized === 'esco' || normalized === 'utilts' || normalized === 'prodat' || normalized === 'l' || normalized === 'e' || normalized === 'ul' || normalized === 'ue' || normalized === 'agt' || normalized === 'tgt') return normalized
  return 'u3'
}

function normalizeStatus(value: string | undefined): FilterStatus {
  const normalized = String(value ?? 'all').toLowerCase()
  if (normalized === 'all' || normalized === 'not_started' || normalized === 'running' || normalized === 'passed' || normalized === 'failed') return normalized
  return 'all'
}

function statusTone(status: string | null | undefined): Tone {
  if (status === 'passed') return 'emerald'
  if (status === 'failed') return 'red'
  if (status === 'running' || status === 'draft') return 'amber'
  if (status === 'not_started') return 'slate'
  return 'slate'
}

function runsForCase(testCase: EdielTgtTestCaseDefinition, runs: TestRunList) {
  return runs.filter((run) =>
    run.test_suite === testCase.suite &&
    run.role_code === testCase.roleCode &&
    run.test_case_code === testCase.testCaseCode &&
    run.status !== 'cancelled'
  )
}

function statusForCase(testCase: EdielTgtTestCaseDefinition, activeRuns: TestRunList): { key: FilterStatus; label: string; tone: Tone } {
  const runs = runsForCase(testCase, activeRuns)
  if (runs.some((run) => run.status === 'passed')) return { key: 'passed', label: 'Klar', tone: 'emerald' }
  if (runs.some((run) => run.status === 'failed')) return { key: 'failed', label: 'Fel', tone: 'red' }
  if (runs.some((run) => run.status === 'running' || run.status === 'draft')) return { key: 'running', label: 'Pågår', tone: 'amber' }
  return { key: 'not_started', label: 'Inte påbörjad', tone: 'slate' }
}

function testDirectionLabel(testCase: EdielTgtTestCaseDefinition): string {
  const first = testCase.expectedSteps[0]
  if (!first) return 'Testkedja saknas'
  if (first.direction === 'inbound' && first.actor === 'portal') return 'Portal → Gridex'
  if (first.direction === 'outbound' && first.actor === 'gridex') return 'Gridex → Portal'
  return `${first.actor} ${first.direction}`
}

function expectedResponseLabel(testCase: EdielTgtTestCaseDefinition): string {
  const required = testCase.expectedSteps.filter((step) => step.required && step.actor === 'gridex' && step.direction === 'outbound')
  if (required.some((step) => step.family === 'UTILTS_ERR')) return 'Svar: positiv CONTRL + UTILTS_ERR'
  const aperak = required.find((step) => step.family === 'APERAK')
  if (aperak?.outcome === 'negative') return 'Svar: positiv CONTRL + negativ APERAK'
  if (aperak?.outcome === 'positive') return 'Svar: positiv CONTRL + positiv APERAK'
  if (required.some((step) => step.family === 'CONTRL')) return 'Svar: CONTRL'
  return 'Svar enligt kedja'
}

function matchesPacket(testCase: EdielTgtTestCaseDefinition, packet: FilterPacket): boolean {
  const code = testCase.testCaseCode.toUpperCase()
  if (packet === 'all') return true
  if (packet === 'u3') return isU3(testCase)
  if (packet === 'u31') return isU3(testCase) && code.startsWith('U3.1')
  if (packet === 'u32') return isU3(testCase) && code.startsWith('U3.2')
  if (packet === 'esco') return testCase.roleCode === 'esco'
  if (packet === 'utilts') return testCase.suite === 'UTILTS'
  if (packet === 'prodat') return testCase.suite === 'PRODAT'
  if (packet === 'e') return testCase.roleCode === 'esco' && testCase.suite === 'PRODAT' && (/^E\d/i.test(code) || code.startsWith('8.') || code.startsWith('9.'))
  if (packet === 'ue') return testCase.roleCode === 'esco' && testCase.suite === 'UTILTS' && (code.startsWith('UE') || code.startsWith('U3.'))
  if (packet === 'l') return testCase.roleCode === 'supplier' && testCase.suite === 'PRODAT' && code.startsWith('L')
  if (packet === 'ul') return testCase.roleCode === 'supplier' && testCase.suite === 'UTILTS' && code.startsWith('UL')
  if (packet === 'agt') return code.startsWith('L') || code.startsWith('UL') || code.startsWith('UE') || code.startsWith('E')
  if (packet === 'tgt') return !code.startsWith('L') && !code.startsWith('UL') && !code.startsWith('UE')
  return true
}

function matchesQuery(testCase: EdielTgtTestCaseDefinition, q: string): boolean {
  if (!q) return true
  return [
    testCase.testCaseCode,
    testCase.title,
    testCase.purpose,
    testCase.suite,
    testCase.roleCode,
    testCase.testDataHint,
    caseGroup(testCase),
    expectedResponseLabel(testCase),
  ]
    .join(' ')
    .toUpperCase()
    .includes(q)
}

function IdentityPanel() {
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Aktörsidentitet för TGT/U3</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">Gridex/GridCore kör testet som Ediel-ID {GRIDEX_TGT_EDIEL_ID}</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-blue-900">
            För U3 UTILTS E66 är detta portal → aktör. Edielportalen skickar inbound till Gridex/GridCore. Systemets TGT-aktör är {GRIDEX_TGT_EDIEL_ID}; motparten är Edielportalen {EDIEL_TGT_TESTSYSTEM_EDIEL_ID} ({EDIEL_TGT_TESTSYSTEM_EMAIL}).
          </p>
        </div>
        <div className="grid gap-2 text-xs text-blue-950 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-200 bg-white p-3">
            <div className="font-semibold">System / aktör</div>
            <div>Ediel-ID: {GRIDEX_TGT_EDIEL_ID}</div>
            <div>Roll: Energitjänsteföretag</div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white p-3">
            <div className="font-semibold">Motpart</div>
            <div>Ediel-ID: {EDIEL_TGT_TESTSYSTEM_EDIEL_ID}</div>
            <div>{EDIEL_TGT_TESTSYSTEM_EMAIL}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function QuickFilters({ packet, status, q }: { packet: FilterPacket; status: FilterStatus; q: string }) {
  const base = `/admin/ediel/system-tests?status=${encodeURIComponent(status)}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const items: Array<{ key: FilterPacket; label: string }> = [
    { key: 'u3', label: 'U3 alla' },
    { key: 'u31', label: 'U3.1 korrekta' },
    { key: 'u32', label: 'U3.2 felaktiga' },
    { key: 'esco', label: 'Alla energitjänsteföretag' },
    { key: 'e', label: 'E3–E8 PRODAT ESCO' },
    { key: 'ue', label: 'UE1–UE2 UTILTS ESCO' },
    { key: 'l', label: 'L1–L7 Leverantör AGT' },
    { key: 'ul', label: 'UL1–UL6 UTILTS AGT' },
    { key: 'utilts', label: 'Alla UTILTS' },
    { key: 'prodat', label: 'Alla PRODAT' },
    { key: 'all', label: 'Alla testfall' },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={`${base}&packet=${item.key}`}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${packet === item.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
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

function TestCard({ testCase, activeRuns }: { testCase: EdielTgtTestCaseDefinition; activeRuns: TestRunList }) {
  const status = statusForCase(testCase, activeRuns)
  const caseRuns = runsForCase(testCase, activeRuns)
  const activeCount = caseRuns.filter((run) => run.status === 'running' || run.status === 'draft').length
  const latestRun = caseRuns[0]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={isU3(testCase) ? 'blue' : 'emerald'}>{testCase.testCaseCode}</Badge>
            <Badge>{testCase.suite}</Badge>
            <Badge>{testCase.roleCode === 'esco' ? 'Energitjänsteföretag' : testCase.roleCode}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {activeCount > 1 ? <Badge tone="red">{activeCount} aktiva — kör bara en åt gången</Badge> : null}
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950">{testCase.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{testCase.purpose}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="font-semibold text-slate-900">Riktning</div>
          <div>{testDirectionLabel(testCase)}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="font-semibold text-slate-900">Förväntat Gridex-svar</div>
          <div>{expectedResponseLabel(testCase)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
        {testCase.testDataHint}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{caseRuns.length} körning(ar)</span>
        <span>Senaste: {latestRun?.created_at ? latestRun.created_at.replace('T', ' ').slice(0, 16) : '—'}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StartRunForm testCase={testCase} />
        <Link href={`/admin/ediel/system-tests/cases/${encodeURIComponent(testCase.testCaseCode)}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Öppna & kör
        </Link>
      </div>
    </div>
  )
}

function ProgressSummary({ cases, runs }: { cases: EdielTgtTestCaseDefinition[]; runs: TestRunList }) {
  const total = cases.length
  const passed = cases.filter((testCase) => statusForCase(testCase, runs).key === 'passed').length
  const failed = cases.filter((testCase) => statusForCase(testCase, runs).key === 'failed').length
  const running = cases.filter((testCase) => statusForCase(testCase, runs).key === 'running').length
  const notStarted = Math.max(0, total - passed - failed - running)
  const percent = total > 0 ? Math.round((passed / total) * 100) : 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Status för filtrerat urval</div>
          <div className="mt-1 text-xs text-slate-600">{passed}/{total} klara · {percent}%</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="emerald">{passed} klara</Badge>
          <Badge tone={running > 0 ? 'amber' : 'slate'}>{running} pågår</Badge>
          <Badge tone={failed > 0 ? 'red' : 'slate'}>{failed} fel</Badge>
          <Badge>{notStarted} ej påbörjade</Badge>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export default async function EdielSystemTestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; suite?: string; role?: string; packet?: string; status?: string }>
}) {
  const context = await requirePlatformAdminAccess()
  const query = searchParams ? await searchParams : {}
  const q = String(query.q ?? '').trim().toUpperCase()
  const suite = String(query.suite ?? '').trim().toUpperCase()
  const role = String(query.role ?? '').trim().toLowerCase()
  const packet = normalizePacket(query.packet)
  const status = normalizeStatus(query.status)

  const [testRuns, messages] = await Promise.all([
    listEdielTestRuns().catch(() => []),
    listEdielMessages({ limit: 300 }).catch(() => []),
  ])
  const testRunsForCards = testRuns as TestRunList

  const allCore = getEdielTgtTestCases().filter((testCase) => testCase.scope === 'core')
  const u3Cases = allCore.filter(isU3).sort(compareCase)
  const filteredCases = allCore
    .filter((testCase) => !suite || testCase.suite === suite)
    .filter((testCase) => !role || testCase.roleCode === role)
    .filter((testCase) => matchesPacket(testCase, packet))
    .filter((testCase) => matchesQuery(testCase, q))
    .filter((testCase) => status === 'all' || statusForCase(testCase, testRuns).key === status)
    .sort(compareCase)

  const evaluations = testRuns
    .filter((run) => run.status !== 'cancelled')
    .map((run) => evaluateEdielTgtRun(run, messages))
  const allPassed = evaluations.filter((evaluation) => evaluation.computedStatus === 'passed').length
  const allFailed = evaluations.filter((evaluation) => evaluation.computedStatus === 'failed').length
  const allRunning = testRuns.filter((run) => run.status === 'running' || run.status === 'draft').length

  const groups = Array.from(new Set(filteredCases.map(caseGroup)))

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel Systemtest"
        subtitle="Körbara TGT-/AGT-testfall med filtrering, aktörsidentitet och tydlig synk mot inbound/outbound-kedjan."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <IdentityPanel />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Primärt testpaket nu</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">UTILTS E66 för energitjänsteföretag</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Dessa fyra U3-testfall är huvudflödet nu. Starta bara ett U3-test åt gången, starta samma test i Edielportalen och importera/polla portalens inbound UTILTS E66. Dold synknyckel är testfallskoden, till exempel U3.1.1.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="emerald">{allPassed} klara</Badge>
            <Badge tone={allFailed > 0 ? 'red' : 'slate'}>{allFailed} fel</Badge>
            <Badge tone={allRunning > 0 ? 'amber' : 'slate'}>{allRunning} aktiva</Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {u3Cases.map((testCase) => (
            <TestCard key={testCase.testCaseCode} testCase={testCase} activeRuns={testRunsForCards} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Filtrera testfall</h2>
            <p className="mt-1 text-sm text-slate-700">Snabbfiltren nedan gör att du direkt hittar U3.1.1, U3.1.2, U3.2.1 och U3.2.2 utan att bläddra bland alla leverantörstester.</p>
          </div>
          <Link href="/admin/ediel/agt" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Öppna AGT-vy
          </Link>
        </div>

        <div className="mt-4">
          <QuickFilters packet={packet} status={status} q={q} />
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-6">
          <input type="hidden" name="packet" value={packet} />
          <input name="q" defaultValue={q} placeholder="Sök U3.1.1, E66, SCH, kvart" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
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
          <select name="status" defaultValue={status} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="all">Alla statusar</option>
            <option value="not_started">Inte påbörjad</option>
            <option value="running">Pågår</option>
            <option value="passed">Klar</option>
            <option value="failed">Fel</option>
          </select>
          <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Filtrera</button>
        </form>
      </section>

      <ProgressSummary cases={filteredCases} runs={testRuns} />

      {filteredCases.length === 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Inga testfall matchar filtreringen. Välj “U3 alla” eller rensa sökningen.
        </section>
      ) : null}

      {groups.map((group) => {
        const items = filteredCases.filter((testCase) => caseGroup(testCase) === group)
        return (
          <section key={group} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">{group}</h2>
              <Badge>{items.length} testfall</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((testCase) => (
                <TestCard key={`${testCase.suite}-${testCase.roleCode}-${testCase.testCaseCode}`} testCase={testCase} activeRuns={testRunsForCards} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
