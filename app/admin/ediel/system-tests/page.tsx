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

type SearchParams = Promise<{ tab?: string }>

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

function CasesTab() {
  const cases = listRulebookTestCases()
  return (
    <section className={cardClassName()}>
      <h2 className="text-lg font-black text-slate-950">Testfall</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {cases.map((testCase) => (
          <Link key={testCase.testCaseCode} href={`/admin/ediel/system-tests/cases/${encodeURIComponent(testCase.testCaseCode)}`} className="rounded-2xl border border-slate-200 p-4 hover:bg-slate-50">
            <div className="flex flex-wrap items-center gap-2"><Badge>{testCase.suite}</Badge><Badge tone={testCase.role === 'energy_service_company' ? 'emerald' : 'slate'}>{testCase.role}</Badge></div>
            <div className="mt-3 font-black text-slate-950">{testCase.testCaseCode} · {testCase.title}</div>
            <div className="mt-1 text-sm text-slate-700">{testCase.family} {testCase.code} · {testCase.processGroup}</div>
          </Link>
        ))}
      </div>
    </section>
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
      {activeTab === 'cases' ? <CasesTab /> : null}
      {activeTab === 'runs' ? <RunsTab testRuns={testRuns} /> : null}
      {activeTab === 'versions' ? <VersionsTab ruleVersions={ruleVersions} /> : null}
      {activeTab === 'fields' ? <StaticTableTab title="Fältmatris" rows={STATIC_FIELD_RULES as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'builder' ? <StaticTableTab title="Meddelandebyggare / styrregler" rows={activeRulebookRules() as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'parser' ? <ParserTab /> : null}
      {activeTab === 'ack' ? <StaticTableTab title="ACK-regler" rows={activeRulebookRules().map((rule) => ({ family: rule.family, code: rule.code, requiresContrl: rule.requiresContrl, requiresAperak: rule.requiresAperak, requiresUtiltsErr: rule.requiresUtiltsErr, negativeAperakOnError: rule.negativeAperakOnError }))} /> : null}
      {activeTab === 'testdata' ? <TestDataTab dataSets={dataSets} /> : null}
      {activeTab === 'esco' ? <StaticTableTab title="Energitjänsteföretag / berättigad part" rows={listRulebookTestCases().filter((testCase) => testCase.role === 'energy_service_company') as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'ai' ? <StaticTableTab title="AI/BI-lista" rows={[...STATIC_CODE_RULES.filter((rule) => rule.codeList === 'AI_BI_FORMATS'), { rule: 'AI-lista skapar avvikelselista och får inte ersätta PRODAT-flöde.' }] as unknown as Array<Record<string, unknown>>} /> : null}
      {activeTab === 'changes' ? <StaticTableTab title="Ändringslogg" rows={changeLogs} /> : null}
      <RegressionPanel />
    </main>
  )
}
