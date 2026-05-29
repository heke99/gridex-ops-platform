import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { activeRulebookRules } from '@/lib/ediel/rulebook/rulebook'
import { STATIC_FIELD_RULES } from '@/lib/ediel/rulebook/fieldMatrix'
import { STATIC_CODE_RULES } from '@/lib/ediel/rulebook/codeRules'
import { listRulebookTestCases } from '@/lib/ediel/rulebook/testCaseMatcher'
import {
  activateRuleVersionAction,
  cloneRuleVersionToDraftAction,
  executeRulebookTestCaseAction,
  importStructuredTestDataAction,
  parseAndValidateRulebookPayloadAction,
  runRulebookRegressionAction,
  syncRulebookStaticRulesAction,
} from '@/app/admin/ediel/system-tests/actions'

export const dynamic = 'force-dynamic'

type TabKey =
  | 'overview'
  | 'suites'
  | 'cases'
  | 'runs'
  | 'versions'
  | 'fields'
  | 'builder'
  | 'parser'
  | 'ack'
  | 'testdata'
  | 'esco'
  | 'ai'
  | 'changes'

type SearchParams = Promise<{ tab?: string; q?: string; suite?: string; role?: string; family?: string; code?: string; subtype?: string }>

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Översikt' },
  { key: 'suites', label: 'Testsviter' },
  { key: 'cases', label: 'Testfall' },
  { key: 'runs', label: 'Testkörningar' },
  { key: 'versions', label: 'Regelversioner' },
  { key: 'fields', label: 'Fältmatris' },
  { key: 'builder', label: 'Meddelandebyggare' },
  { key: 'parser', label: 'Parser & validering' },
  { key: 'ack', label: 'ACK-regler' },
  { key: 'testdata', label: 'Testdata' },
  { key: 'esco', label: 'Energitjänsteföretag' },
  { key: 'ai', label: 'AI-lista' },
  { key: 'changes', label: 'Ändringslogg' },
]

function cardClassName() {
  return 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'
}

function inputClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'emerald' | 'amber' | 'red' | 'slate' }) {
  const classes: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${classes[tone]}`}>{children}</span>
}

function SubmitButton({ children, tone = 'emerald' }: { children: ReactNode; tone?: 'emerald' | 'slate' | 'red' }) {
  const classes: Record<typeof tone, string> = {
    emerald: 'bg-emerald-700 text-white hover:bg-emerald-800',
    slate: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    red: 'bg-red-700 text-white hover:bg-red-800',
  }
  return <button className={`rounded-xl px-3 py-2 text-xs font-bold ${classes[tone]}`}>{children}</button>
}

async function listRows(table: string, limit = 50) {
  const { data } = await supabaseService.from(table).select('*').order('created_at', { ascending: false }).limit(limit)
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function TabNav({ activeTab }: { activeTab: TabKey }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/ediel/system-tests?tab=${tab.key}`}
            className={`rounded-2xl px-3 py-2 text-sm font-bold transition ${activeTab === tab.key ? 'bg-emerald-700 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function RuleSyncCard() {
  return (
    <form action={syncRulebookStaticRulesAction} className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">Synka rulebook till databas</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">Skapar/uppdaterar regelversioner, fältregler, kodlistor, ACK-regler och testfall utan att duplicera.</p>
      <div className="mt-4"><SubmitButton>Synka statiska regler</SubmitButton></div>
    </form>
  )
}

function OverviewTab({ ruleVersions, testRuns }: { ruleVersions: Array<Record<string, unknown>>; testRuns: Array<Record<string, unknown>> }) {
  const staticRules = activeRulebookRules()
  const cases = listRulebookTestCases()
  const activeVersions = ruleVersions.filter((row) => row.status === 'active').length
  const draftVersions = ruleVersions.filter((row) => row.status === 'draft').length
  const failedRuns = testRuns.filter((row) => row.status === 'failed').length
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className={cardClassName()}><div className="text-sm font-bold text-slate-600">Statiska regler</div><div className="mt-2 text-3xl font-black">{staticRules.length}</div></div>
        <div className={cardClassName()}><div className="text-sm font-bold text-slate-600">Testfall</div><div className="mt-2 text-3xl font-black">{cases.length}</div></div>
        <div className={cardClassName()}><div className="text-sm font-bold text-slate-600">Aktiva versioner</div><div className="mt-2 text-3xl font-black">{activeVersions}</div></div>
        <div className={cardClassName()}><div className="text-sm font-bold text-slate-600">Draft/fel</div><div className="mt-2 text-3xl font-black">{draftVersions}/{failedRuns}</div></div>
      </div>
      <RuleSyncCard />
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Viktigaste runtime-regler</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Badge tone="emerald">23-DDQ-PRODAT</Badge><p className="mt-2 text-sm text-slate-700">Z01/Z02 och leverantörsbyte/grunddata.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Badge tone="emerald">23-DGI-PRODAT</Badge><p className="mt-2 text-sm text-slate-700">Z13/Z14/Z15/Z18 för mätvärdesåtkomst/ESCO.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Badge tone="red">Hard blocker</Badge><p className="mt-2 text-sm text-slate-700">Rulebook-fel stoppar outbound skick innan transport.</p></div>
        </div>
      </section>
    </div>
  )
}

function VersionsTab({ ruleVersions }: { ruleVersions: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-5">
      <RuleSyncCard />
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Regelversioner</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">Regel</th><th className="p-2">Status</th><th className="p-2">Regression</th><th className="p-2">Ändrad</th><th className="p-2">Åtgärder</th></tr></thead>
            <tbody>
              {ruleVersions.map((row) => (
                <tr key={String(row.id)} className="border-t border-slate-100">
                  <td className="p-2"><div className="font-bold text-slate-900">{text(row.message_family)} {text(row.message_code)}</div><div className="text-xs text-slate-500">{text(row.version_code)} · {text(row.application_reference)}</div></td>
                  <td className="p-2"><Badge tone={row.status === 'active' ? 'emerald' : row.status === 'draft' ? 'amber' : 'slate'}>{text(row.status)}</Badge></td>
                  <td className="p-2"><div>{text(row.last_regression_status)}</div><div className="text-xs text-slate-500">{text(row.last_regression_at).slice(0, 16)}</div></td>
                  <td className="p-2 text-xs text-slate-600">{text(row.latest_change_at ?? row.updated_at).slice(0, 16)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2">
                      <form action={cloneRuleVersionToDraftAction}><input type="hidden" name="ruleVersionId" value={String(row.id)} /><SubmitButton tone="slate">Klona</SubmitButton></form>
                      <form action={runRulebookRegressionAction}><input type="hidden" name="ruleVersionId" value={String(row.id)} /><input type="hidden" name="scope" value="all" /><SubmitButton>Regression</SubmitButton></form>
                      <form action={activateRuleVersionAction}><input type="hidden" name="ruleVersionId" value={String(row.id)} /><SubmitButton tone="red">Aktivera</SubmitButton></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

type TestCaseFilters = {
  q?: string
  suite?: string
  role?: string
  family?: string
  code?: string
  subtype?: string
}

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function filterTestCases(filters: TestCaseFilters, forced?: Partial<TestCaseFilters>) {
  const effective = { ...filters, ...forced }
  const q = norm(effective.q)
  return listRulebookTestCases().filter((testCase) => {
    if (effective.suite && testCase.suite !== effective.suite) return false
    if (effective.role && testCase.role !== effective.role) return false
    if (effective.family && testCase.family !== effective.family) return false
    if (effective.code && testCase.code !== effective.code) return false
    if (effective.subtype && String(testCase.subtype ?? '') !== effective.subtype) return false
    if (!q) return true
    const haystack = [testCase.testCaseCode, testCase.title, testCase.suite, testCase.role, testCase.family, testCase.code, testCase.subtype, testCase.processGroup].map((item) => String(item ?? '').toLowerCase()).join(' ')
    return haystack.includes(q)
  })
}

function uniqueValues(key: keyof ReturnType<typeof listRulebookTestCases>[number]) {
  return Array.from(new Set(listRulebookTestCases().map((testCase) => String(testCase[key] ?? '')).filter(Boolean))).sort()
}

function TestCaseFilterForm({ filters, forcedRole }: { filters: TestCaseFilters; forcedRole?: string }) {
  return (
    <section className={cardClassName()}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">Hitta testfall snabbt</h2>
          <p className="mt-1 text-sm text-slate-700">Filtrera på roll, familj, kod och undertyp. För UTILTS E66 energitjänsteföretag använder du UE1/UE2 eller U3.x.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/ediel/system-tests?tab=cases&role=energy_service_company&family=UTILTS&code=E66" className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">ESCO UTILTS E66</Link>
          <Link href="/admin/ediel/system-tests?tab=cases&q=UE1" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">UE1 KVART</Link>
          <Link href="/admin/ediel/system-tests?tab=cases&q=UE2" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">UE2 SCH</Link>
          <Link href="/admin/ediel/system-tests?tab=esco&family=UTILTS&code=E66" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">TGT U3.x</Link>
        </div>
      </div>
      <form className="mt-4 grid gap-3 md:grid-cols-6" action="/admin/ediel/system-tests" method="get">
        <input type="hidden" name="tab" value={forcedRole ? 'esco' : 'cases'} />
        <input name="q" defaultValue={filters.q ?? ''} className={inputClassName()} placeholder="Sök: UE1, E66, KVART..." />
        <select name="role" defaultValue={forcedRole ?? filters.role ?? ''} className={inputClassName()} disabled={Boolean(forcedRole)}>
          <option value="">Alla roller</option>
          {uniqueValues('role').map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {forcedRole ? <input type="hidden" name="role" value={forcedRole} /> : null}
        <select name="suite" defaultValue={filters.suite ?? ''} className={inputClassName()}>
          <option value="">Alla sviter</option>
          {uniqueValues('suite').map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="family" defaultValue={filters.family ?? ''} className={inputClassName()}>
          <option value="">Alla familjer</option>
          {uniqueValues('family').map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="code" defaultValue={filters.code ?? ''} className={inputClassName()}>
          <option value="">Alla koder</option>
          {uniqueValues('code').map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="subtype" defaultValue={filters.subtype ?? ''} className={inputClassName()}>
          <option value="">Alla undertyper</option>
          {uniqueValues('subtype').map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <div className="md:col-span-6 flex flex-wrap gap-2">
          <SubmitButton>Filtrera</SubmitButton>
          <Link href={`/admin/ediel/system-tests?tab=${forcedRole ? 'esco' : 'cases'}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">Rensa filter</Link>
        </div>
      </form>
    </section>
  )
}

function executionHint(testCase: ReturnType<typeof listRulebookTestCases>[number]) {
  if (testCase.family === 'UTILTS' && testCase.role === 'energy_service_company') {
    return 'Portal → aktör. Starta testet i Edielportalen, låt portalen skicka inbound UTILTS E66, poll/importera mailbox och validera payloaden mot körningen.'
  }
  if (testCase.family === 'PRODAT' && testCase.processGroup === 'metering_access') {
    return 'Mätvärdesåtkomst/berättigad part. Kontrollera att Application Reference är 23-DGI-PRODAT och att flödet inte går via supplier_switch.'
  }
  return 'Kör regeltest eller öppna testfallet för detaljerad payload-validering.'
}

function TestCaseCard({ testCase }: { testCase: ReturnType<typeof listRulebookTestCases>[number] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{testCase.suite}</Badge>
        <Badge tone={testCase.role === 'energy_service_company' ? 'emerald' : 'slate'}>{testCase.role === 'energy_service_company' ? 'Energitjänsteföretag' : testCase.role}</Badge>
        <Badge tone={testCase.family === 'UTILTS' ? 'amber' : 'slate'}>{testCase.family} {testCase.code}{testCase.subtype ? ` ${testCase.subtype}` : ''}</Badge>
      </div>
      <div className="mt-3 font-black text-slate-950">{testCase.testCaseCode} · {testCase.title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{executionHint(testCase)}</p>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
        <div><span className="font-bold text-slate-800">Process:</span> {testCase.processGroup}</div>
        <div><span className="font-bold text-slate-800">CONTRL:</span> {testCase.expectedContrl}</div>
        <div><span className="font-bold text-slate-800">APERAK/ERR:</span> {testCase.expectedAperak} / {testCase.expectedUtiltsErr}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={executeRulebookTestCaseAction}>
          <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
          <input type="hidden" name="executionMode" value="start_portal" />
          <SubmitButton>{testCase.family === 'UTILTS' ? 'Starta testkörning' : 'Starta test'}</SubmitButton>
        </form>
        <Link href={`/admin/ediel/system-tests/cases/${encodeURIComponent(testCase.testCaseCode)}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">Öppna & validera payload</Link>
      </div>
    </div>
  )
}

function CasesTab({ filters }: { filters: TestCaseFilters }) {
  const cases = filterTestCases(filters)
  return (
    <div className="space-y-5">
      <TestCaseFilterForm filters={filters} />
      <section className={cardClassName()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">Testfall</h2>
          <Badge tone="emerald">{cases.length} träffar</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {cases.map((testCase) => <TestCaseCard key={testCase.testCaseCode} testCase={testCase} />)}
          {cases.length === 0 ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Inga testfall matchar filtren. Rensa filter eller sök på UE1, UE2, U3.1.1 eller E66.</div> : null}
        </div>
      </section>
    </div>
  )
}

function EscoTab({ filters }: { filters: TestCaseFilters }) {
  const cases = filterTestCases(filters, { role: 'energy_service_company' })
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <h2 className="text-lg font-black text-emerald-950">Snabbstart: UTILTS E66 för energitjänsteföretag</h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">För KVART/SCH är testet normalt portal → aktör. Starta testkörningen här, starta motsvarande test i Edielportalen och kontrollera sedan inbound/ACK-kedjan i Testkörningar eller Parser & validering.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['UE1', 'UE2', 'U3.1.1', 'U3.1.2', 'U3.2.1', 'U3.2.2'].map((code) => (
            <form key={code} action={executeRulebookTestCaseAction}>
              <input type="hidden" name="testCaseCode" value={code} />
              <input type="hidden" name="executionMode" value="start_portal" />
              <SubmitButton>{code}</SubmitButton>
            </form>
          ))}
        </div>
      </section>
      <TestCaseFilterForm filters={filters} forcedRole="energy_service_company" />
      <section className={cardClassName()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">Energitjänsteföretag / berättigad part</h2>
          <Badge tone="emerald">{cases.length} träffar</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {cases.map((testCase) => <TestCaseCard key={testCase.testCaseCode} testCase={testCase} />)}
        </div>
      </section>
    </div>
  )
}

function RunsTab({ testRuns }: { testRuns: Array<Record<string, unknown>> }) {
  return (
    <section className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">Testkörningar</h2>
      <div className="mt-4 space-y-3">
        {testRuns.map((run) => (
          <div key={String(run.id)} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={run.status === 'passed' ? 'emerald' : run.status === 'failed' ? 'red' : 'amber'}>{text(run.status)}</Badge><Badge>{text(run.test_suite)}</Badge></div>
            <div className="mt-2 font-bold text-slate-950">{text(run.title)}</div>
            <div className="mt-1 text-xs text-slate-600">{text(run.test_case_code)} · {text(run.created_at).slice(0, 16)}</div>
            {run.failure_reason ? <p className="mt-2 text-sm text-red-700">{text(run.failure_reason)}</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function ParserTab() {
  return (
    <section className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">Parser & validering</h2>
      <p className="mt-2 text-sm text-slate-700">Klistra in PRODAT, APERAK, CONTRL, UTILTS, UTILTS_ERR eller AI/BI-lista. Resultatet sparas som testkörning och artifact.</p>
      <form action={parseAndValidateRulebookPayloadAction} className="mt-4 space-y-3">
        <textarea name="rawPayload" rows={12} className={inputClassName()} placeholder="UNA:+.? 'UNB+..." />
        <input type="file" name="payloadFile" className={inputClassName()} />
        <SubmitButton>Kör parser och rulebook-validering</SubmitButton>
      </form>
    </section>
  )
}

function TestDataTab({ dataSets }: { dataSets: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-5">
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Strukturerad testdata-import</h2>
        <p className="mt-2 text-sm text-slate-700">Importer sparar data strukturerat till kunder, anläggningar, mätpunkter, expected ACK, expected values och field values.</p>
        <form action={importStructuredTestDataAction} className="mt-4 space-y-3">
          <input name="title" className={inputClassName()} placeholder="Namn på dataset" />
          <textarea name="testDataText" rows={8} className={inputClassName()} placeholder="Klistra in semikolonseparerad testdata" />
          <input type="file" name="testDataFile" className={inputClassName()} />
          <SubmitButton>Importera strukturerat</SubmitButton>
        </form>
      </section>
      <section className={cardClassName()}>
        <h2 className="text-lg font-black text-slate-950">Importerade dataset</h2>
        <div className="mt-4 space-y-2">
          {dataSets.map((row) => <div key={String(row.id)} className="rounded-xl border border-slate-200 p-3"><div className="font-bold">{text(row.title)}</div><div className="text-xs text-slate-600">{text(row.row_count)} rader · {text(row.created_at).slice(0, 16)}</div></div>)}
        </div>
      </section>
    </div>
  )
}

function StaticTableTab({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <section className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 p-4 text-sm">
            <pre className="whitespace-pre-wrap break-words text-xs text-slate-700">{JSON.stringify(row, null, 2)}</pre>
          </div>
        ))}
      </div>
    </section>
  )
}

function RegressionPanel() {
  return (
    <section className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">Regression före aktivering</h2>
      <form action={runRulebookRegressionAction} className="mt-4 flex flex-wrap gap-2">
        <select name="scope" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="all">Alla</option>
          <option value="prodat_supplier">PRODAT leverantör</option>
          <option value="prodat_energy_service_company">PRODAT ESCO</option>
          <option value="utilts_supplier">UTILTS leverantör</option>
          <option value="utilts_energy_service_company">UTILTS ESCO</option>
          <option value="ack">ACK</option>
          <option value="ai_list">AI-lista</option>
        </select>
        <SubmitButton>Kör regression</SubmitButton>
      </form>
    </section>
  )
}

export default async function EdielSystemTestsPage({ searchParams }: { searchParams?: SearchParams }) {
  await requirePlatformAdminAccess()
  const query = searchParams ? await searchParams : {}
  const requestedTab = String(query.tab ?? 'overview') as TabKey
  const activeTab = TABS.some((tab) => tab.key === requestedTab) ? requestedTab : 'overview'
  const filters: TestCaseFilters = {
    q: typeof query.q === 'string' ? query.q : undefined,
    suite: typeof query.suite === 'string' ? query.suite : undefined,
    role: typeof query.role === 'string' ? query.role : undefined,
    family: typeof query.family === 'string' ? query.family : undefined,
    code: typeof query.code === 'string' ? query.code : undefined,
    subtype: typeof query.subtype === 'string' ? query.subtype : undefined,
  }

  const [ruleVersions, testRuns, dataSets, changeLogs] = await Promise.all([
    listRows('ediel_rule_versions', 100),
    listRows('ediel_test_runs', 30),
    listRows('ediel_test_data_sets', 20),
    listRows('ediel_rule_change_logs', 30),
  ])

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Ediel Systemtest & Regelcenter"
        subtitle="Rulebook, parser, fältmatris, testfall, regression och ESCO/berättigad part-flöden för superadmin."
      />
      <TabNav activeTab={activeTab} />
      {activeTab === 'overview' ? <OverviewTab ruleVersions={ruleVersions} testRuns={testRuns} /> : null}
      {activeTab === 'suites' ? <StaticTableTab title="Testsviter" rows={Array.from(new Set(listRulebookTestCases().map((testCase) => testCase.suite))).map((suite) => ({ suite, cases: listRulebookTestCases().filter((testCase) => testCase.suite === suite).length }))} /> : null}
      {activeTab === 'cases' ? <CasesTab filters={filters} /> : null}
      {activeTab === 'runs' ? <RunsTab testRuns={testRuns} /> : null}
      {activeTab === 'versions' ? <VersionsTab ruleVersions={ruleVersions} /> : null}
      {activeTab === 'fields' ? <StaticTableTab title="Fältmatris" rows={STATIC_FIELD_RULES as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'builder' ? <StaticTableTab title="Meddelandebyggare / styrregler" rows={activeRulebookRules() as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'parser' ? <ParserTab /> : null}
      {activeTab === 'ack' ? <StaticTableTab title="ACK-regler" rows={activeRulebookRules().map((rule) => ({ family: rule.family, code: rule.code, requiresContrl: rule.requiresContrl, requiresAperak: rule.requiresAperak, requiresUtiltsErr: rule.requiresUtiltsErr, negativeAperakOnError: rule.negativeAperakOnError }))} /> : null}
      {activeTab === 'testdata' ? <TestDataTab dataSets={dataSets} /> : null}
      {activeTab === 'esco' ? <EscoTab filters={filters} /> : null}
      {activeTab === 'ai' ? <StaticTableTab title="AI/BI-lista" rows={[...STATIC_CODE_RULES.filter((rule) => rule.codeList === 'AI_BI_FORMATS'), { rule: 'AI-lista skapar avvikelselista och får inte ersätta PRODAT-flöde.' }] as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'changes' ? <StaticTableTab title="Ändringslogg" rows={changeLogs} /> : null}
      <RegressionPanel />
    </main>
  )
}
