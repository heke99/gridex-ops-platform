// components/admin/ediel/EdielTgtWorkbenchPanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  attachEdielMessageToTestRunAction,
  createEdielTgtRunFromTemplateAction,
  createEdielTgtDraftAction,
  markEdielTgtRunStatusAction,
} from '@/app/admin/ediel/actions'
import {
  evaluateEdielTgtRun,
  getEdielTgtCoverageSummary,
  getEdielTgtNextAction,
  getEdielTgtTestCases,
  type EdielTgtRunEvaluation,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import {
  getEdielTgtTestDataForCase,
  type EdielTgtCaseTestData,
  type EdielTgtCaseTestDataGroup,
} from '@/lib/ediel/tgtTestData'
import { getEdielTgtDraftOptionsForCase } from '@/lib/ediel/tgtEdifact'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue' | 'indigo' }) {
  const classes = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    yellow: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  }[tone]

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${classes}`}>
      {children}
    </span>
  )
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusTone(status: EdielTgtRunEvaluation['computedStatus']): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'passed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'in_progress') return 'yellow'
  if (status === 'not_mapped') return 'red'
  return 'slate'
}

function definitionTone(status: EdielTgtTestCaseDefinition['status']): 'green' | 'yellow' {
  return status === 'ready_for_file_engine' ? 'green' : 'yellow'
}

function getRecentMessageOptions(messages: EdielMessageRow[]) {
  return messages
    .filter((message) => ['manual_upload', 'email', 'smtp', 'api'].includes(message.transport_type))
    .slice(0, 80)
}

function selectedValuesForGroup(group: EdielTgtCaseTestDataGroup, values: Record<string, string>) {
  return group.columns
    .map((column) => ({ column, value: values[column.name] }))
    .filter((entry) => entry.value && entry.value.trim().length > 0)
}

function TestDataGroupTable({ group }: { group: EdielTgtCaseTestDataGroup }) {
  const visibleFields = group.fields.slice(0, 16)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-950">{group.block.entityLabel}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {group.block.sourceSheet} · {group.block.sourceWorkbook}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {group.columns.map((column) => (
            <Badge key={`${group.block.entityLabel}-${column.name}`}>{column.name}</Badge>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-2 py-2 font-semibold">Fält</th>
              <th className="min-w-[180px] px-2 py-2 font-semibold">Namn</th>
              <th className="min-w-[260px] px-2 py-2 font-semibold">Testdata</th>
            </tr>
          </thead>
          <tbody>
            {visibleFields.map((field) => {
              const entries = selectedValuesForGroup(group, field.values)
              return (
                <tr key={`${group.block.entityLabel}-${field.fieldCode}-${field.fieldName}`} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">{field.fieldCode}</td>
                  <td className="px-2 py-2 text-slate-700">{field.fieldName}</td>
                  <td className="px-2 py-2 text-slate-600">
                    <div className="space-y-1">
                      {entries.length === 0 ? (
                        <span>—</span>
                      ) : (
                        entries.map((entry) => (
                          <div key={`${field.fieldCode}-${entry.column.name}`}>
                            <span className="font-medium text-slate-800">{entry.column.name}:</span> {entry.value}
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {group.fields.length > visibleFields.length ? (
        <div className="mt-2 text-[11px] text-slate-500">
          Visar {visibleFields.length} prioriterade fält av {group.fields.length}. Fullständig raddata finns i importregistret.
        </div>
      ) : null}
    </div>
  )
}

function TestDataSummary({ data }: { data: EdielTgtCaseTestData | null }) {
  if (!data || data.groups.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
        Ingen importerad Excel-testdata är kopplad till detta testfall ännu.
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-indigo-950">{data.title}</div>
          <div className="mt-1 text-xs text-indigo-800">{data.sourceNote}</div>
        </div>
        <Badge tone="indigo">Excel-import</Badge>
      </div>
      <div className="mt-3 space-y-3">
        {data.groups.map((group) => (
          <TestDataGroupTable key={`${group.block.sourceSheet}-${group.block.entityLabel}`} group={group} />
        ))}
      </div>
    </div>
  )
}

function CoverageDashboard({ evaluations, definitions }: { evaluations: EdielTgtRunEvaluation[]; definitions: EdielTgtTestCaseDefinition[] }) {
  const summary = getEdielTgtCoverageSummary(evaluations, definitions)
  const cells: Array<[string, string, 'slate' | 'green' | 'yellow' | 'red' | 'blue']> = [
    ['Körningar', String(summary.totalRuns), 'slate' as const],
    ['Godkända', String(summary.passedRuns), 'green' as const],
    ['Fel/mismatch', String(summary.failedRuns), summary.failedRuns > 0 ? 'red' as const : 'slate' as const],
    ['Pågår', String(summary.inProgressRuns), 'yellow' as const],
    ['Core-mallar körda', `${summary.coreCasesWithRuns}/${summary.totalCoreCases}`, summary.coreCasesWithoutRuns === 0 ? 'green' as const : 'yellow' as const],
  ]

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">TGT coverage och Batch 5 driftläge</h3>
          <p className="mt-1 text-xs text-slate-600">
            Detta är kontrollpanelen för att se om filmotorn är redo för slutgodkännande och praktisk drift. Den ersätter inte Edielportalens facit, men visar vad Gridex själv har verifierat.
          </p>
        </div>
        <Badge tone={summary.readyForFinalApproval ? 'green' : 'yellow'}>
          {summary.readyForFinalApproval ? 'redo för portal-kontroll' : 'inte komplett ännu'}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cells.map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950">
              {value}
              <Badge tone={tone}>{tone}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Batch5RunbookPanel() {
  return (
    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
      <div className="font-semibold">Batch 5 driftregler för filbaserad motor</div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl bg-white/70 p-3">
          <div className="font-medium">När Gridex skapar en fil</div>
          <p className="mt-1 text-xs text-blue-900">Skapa utkast, kontrollera validatorn, öppna meddelandesidan, exportera/klistra filen i Edielportalen och markera test run när portalen har svarat.</p>
        </div>
        <div className="rounded-xl bg-white/70 p-3">
          <div className="font-medium">När Edielportalen svarar</div>
          <p className="mt-1 text-xs text-blue-900">Importera svaret i filmotorn, koppla det mot rätt TGT-steg och följ nästa instruktion i guided mode.</p>
        </div>
        <div className="rounded-xl bg-white/70 p-3">
          <div className="font-medium">Vid negativ kvittens</div>
          <p className="mt-1 text-xs text-blue-900">Stoppa flödet, öppna meddelandet, läs ERC/FTX eller CONTRL-status och skapa inte nytt svar på samma transaktion innan felet är förstått.</p>
        </div>
        <div className="rounded-xl bg-white/70 p-3">
          <div className="font-medium">Vid slutgodkännande</div>
          <p className="mt-1 text-xs text-blue-900">Kör bara ett slutgodkännande-test åt gången och kontrollera både Gridex workbench och Edielportalens testlogg innan du markerar run som godkänd.</p>
        </div>
      </div>
    </div>
  )
}

function GuidedNextActionPanel({ evaluation }: { evaluation: EdielTgtRunEvaluation }) {
  const nextAction = getEdielTgtNextAction(evaluation)
  const tone = nextAction.tone

  return (
    <div className={`mt-4 rounded-2xl border p-4 ${tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-950' : tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-950' : tone === 'yellow' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-950'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide">Nästa steg</div>
          <div className="mt-1 text-sm font-semibold">{nextAction.title}</div>
          <p className="mt-1 text-xs">{nextAction.description}</p>
        </div>
        <Badge tone={tone}>{nextAction.kind}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {evaluation.definition && nextAction.canGenerateDraft && nextAction.stepNo ? (
          <form action={createEdielTgtDraftAction}>
            <input type="hidden" name="testSuite" value={evaluation.definition.suite} />
            <input type="hidden" name="roleCode" value={evaluation.definition.roleCode} />
            <input type="hidden" name="testCaseCode" value={evaluation.definition.testCaseCode} />
            <input type="hidden" name="stepNo" value={nextAction.stepNo} />
            <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
            <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
              Skapa fil för steg {nextAction.stepNo}
            </button>
          </form>
        ) : null}

        <form action={markEdielTgtRunStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
          <select name="status" className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700">
            <option value="running">Markera som pågående</option>
            <option value="passed">Markera som godkänd i Gridex</option>
            <option value="failed">Markera som felad</option>
            <option value="cancelled">Avbryt run</option>
          </select>
          <input name="failureReason" placeholder="Kommentar vid fel/avbrott" className="min-w-[180px] rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700" />
          <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
            Uppdatera status
          </button>
        </form>
      </div>
    </div>
  )
}

function DraftOptionPanel({
  testCase,
  testRunId,
  compact = false,
}: {
  testCase: EdielTgtTestCaseDefinition
  testRunId?: string | null
  compact?: boolean
}) {
  const options = getEdielTgtDraftOptionsForCase(
    testCase.suite,
    testCase.roleCode,
    testCase.testCaseCode
  )
  const generatable = options.filter((option) => option.canGenerate)

  if (generatable.length === 0) {
    return compact ? null : (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Det finns inga Gridex-steg att generera för detta testfall. Importera filerna från Edielportalen i stället.
      </div>
    )
  }

  return (
    <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3'}>
      {!compact ? (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-emerald-950">Skapa TGT-filutkast</div>
            <div className="mt-1 text-xs text-emerald-800">
              Systemet skapar ett filutkast med Gridex Ediel-ID 21660, Edielportalen 91100 och rätt TGT-standardvärden. Edielportalen är fortfarande slutligt facit.
            </div>
          </div>
          <Badge tone="green">Batch 4D</Badge>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {generatable.map((option) => (
          <form key={`${testCase.testCaseCode}-${option.stepNo}`} action={createEdielTgtDraftAction}>
            <input type="hidden" name="testSuite" value={testCase.suite} />
            <input type="hidden" name="roleCode" value={testCase.roleCode} />
            <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
            <input type="hidden" name="stepNo" value={option.stepNo} />
            {testRunId ? <input type="hidden" name="testRunId" value={testRunId} /> : null}
            <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
              Skapa steg {option.stepNo}: {option.family}/{option.code}
              {option.outcome ? ` ${option.outcome}` : ''}
            </button>
          </form>
        ))}
      </div>
    </div>
  )
}

function TestCaseCard({ testCase }: { testCase: EdielTgtTestCaseDefinition }) {
  const testData = getEdielTgtTestDataForCase(testCase.suite, testCase.roleCode, testCase.testCaseCode)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="indigo">{testCase.suite}</Badge>
            <Badge tone="blue">{testCase.testCaseCode}</Badge>
            <Badge>{testCase.roleCode}</Badge>
            <Badge tone={definitionTone(testCase.status)}>{testCase.status}</Badge>
            {testData ? <Badge tone="green">testdata kopplad</Badge> : <Badge tone="yellow">utan testdata</Badge>}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-950">{testCase.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{testCase.purpose}</p>
        </div>
        <form action={createEdielTgtRunFromTemplateAction}>
          <input type="hidden" name="testSuite" value={testCase.suite} />
          <input type="hidden" name="roleCode" value={testCase.roleCode} />
          <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
          <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            Skapa test run
          </button>
        </form>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <div><span className="font-semibold text-slate-800">Testdata:</span> {testCase.testDataHint}</div>
        <div className="mt-1"><span className="font-semibold text-slate-800">Version:</span> {testCase.approvalVersion}</div>
      </div>

      <TestDataSummary data={testData} />

      <DraftOptionPanel testCase={testCase} />

      <div className="mt-3 space-y-2">
        {testCase.expectedSteps.map((step) => (
          <div key={step.stepNo} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-slate-700">
              {step.stepNo}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900">{step.title}</div>
              <div className="mt-1 text-slate-600">{step.description}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{step.direction}</Badge>
                <Badge>{step.family}</Badge>
                <Badge>{step.code}</Badge>
                {step.outcome ? <Badge tone={step.outcome === 'positive' ? 'green' : 'red'}>{step.outcome}</Badge> : null}
                <Badge tone={step.required ? 'blue' : 'slate'}>{step.required ? 'obligatorisk' : 'alternativ'}</Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunEvaluationCard({
  evaluation,
  messages,
}: {
  evaluation: EdielTgtRunEvaluation
  messages: EdielMessageRow[]
}) {
  const options = getRecentMessageOptions(messages)
  const testData = evaluation.definition
    ? getEdielTgtTestDataForCase(
        evaluation.definition.suite,
        evaluation.definition.roleCode,
        evaluation.definition.testCaseCode
      )
    : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="indigo">{evaluation.testRun.test_suite}</Badge>
            <Badge tone="blue">{evaluation.testRun.test_case_code}</Badge>
            <Badge>{evaluation.testRun.role_code}</Badge>
            <Badge tone={statusTone(evaluation.computedStatus)}>{evaluation.computedStatus}</Badge>
            {testData ? <Badge tone="green">testdata</Badge> : null}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-950">
            {evaluation.definition?.title ?? evaluation.testRun.title ?? 'Ej mappat testfall'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Skapad {formatDateTime(evaluation.testRun.created_at)} · DB-status {evaluation.testRun.status}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {evaluation.passedSteps}/{evaluation.requiredSteps} obligatoriska steg klara
        </div>
      </div>

      <GuidedNextActionPanel evaluation={evaluation} />

      {testData ? (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">
          <div className="font-semibold">{testData.title}</div>
          <div className="mt-1">{testData.sourceNote}</div>
        </div>
      ) : null}

      {evaluation.definition ? (
        <div className="mt-4 space-y-2">
          {evaluation.matches.map((match) => (
            <div key={match.step.stepNo} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={match.status === 'passed' ? 'green' : match.status === 'mismatch' ? 'red' : 'yellow'}>
                      {match.status}
                    </Badge>
                    <Badge>Steg {match.step.stepNo}</Badge>
                    <Badge>{match.step.direction}</Badge>
                    <Badge>{match.step.family}</Badge>
                    <Badge>{match.step.code}</Badge>
                    {match.step.outcome ? <Badge>{match.step.outcome}</Badge> : null}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{match.step.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{match.step.description}</div>
                  {match.issues.length > 0 ? (
                    <div className="mt-2 text-xs text-rose-700">{match.issues.join(' · ')}</div>
                  ) : null}
                  {match.message ? (
                    <Link
                      href={`/admin/ediel/messages/${match.message.id}`}
                      className="mt-2 inline-block text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
                    >
                      Öppna matchat meddelande
                    </Link>
                  ) : null}
                </div>
                <form action={attachEdielMessageToTestRunAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
                  <input type="hidden" name="stepNo" value={match.step.stepNo} />
                  <input type="hidden" name="expectedDirection" value={match.step.direction} />
                  <input type="hidden" name="expectedFamily" value={match.step.family} />
                  <input type="hidden" name="expectedCode" value={match.step.code} />
                  <select name="edielMessageId" className="max-w-[260px] rounded-xl border border-slate-300 px-2 py-2 text-xs">
                    <option value="">Koppla meddelande manuellt…</option>
                    {options.map((message) => (
                      <option key={message.id} value={message.id}>
                        {message.direction} · {message.message_family}/{String(message.message_code)} · {formatDateTime(message.created_at)}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    Koppla
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          Testfallet finns inte i Batch 4C-registret ännu. Skapa det via en av mallarna ovan för automatisk stegutvärdering.
        </div>
      )}
    </div>
  )
}

export default function EdielTgtWorkbenchPanel({
  messages,
  testRuns,
}: {
  messages: EdielMessageRow[]
  testRuns: EdielTestRunRow[]
}) {
  const definitions = getEdielTgtTestCases()
  const coreDefinitions = definitions.filter((definition) => definition.scope === 'core')
  const evaluations = testRuns
    .filter((run) => run.test_suite === 'PRODAT' || run.test_suite === 'UTILTS')
    .slice(0, 10)
    .map((run) => evaluateEdielTgtRun(run, messages))
  const linkedTestDataCount = coreDefinitions.filter((definition) =>
    Boolean(getEdielTgtTestDataForCase(definition.suite, definition.roleCode, definition.testCaseCode))
  ).length

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Batch 4E–5 · TGT guided mode, generator och driftkontroll</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            Workbenchen visar nästa steg, testdata, EDIFACT-utkast, portalimport och driftstatus. Använd den som säkert arbetsflöde för filbaserad TGT innan SMTP/ECP byggs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">PRODAT testkunder</Badge>
          <Badge tone="green">UTILTS testanläggningar</Badge>
          <Badge tone="green">EDIFACT-utkast</Badge>
          <Badge tone="blue">{linkedTestDataCount}/{coreDefinitions.length} mallar med testdata</Badge>
          <Badge tone="blue">filbaserat</Badge>
        </div>
      </div>

      
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Kör bara ett slutgodkännande-test åt gången mot Edielportalen. Om portalen väntar på flera filer av samma typ kan den koppla inkommande fil till fel testfall.
      </div>

      <CoverageDashboard evaluations={evaluations} definitions={coreDefinitions} />
      <Batch5RunbookPanel />

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-950">Rekommenderade startmallar</h3>
          <div className="space-y-4">
            {coreDefinitions.map((definition) => (
              <TestCaseCard key={`${definition.suite}-${definition.roleCode}-${definition.testCaseCode}`} testCase={definition} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-950">Senaste TGT-runs</h3>
          <div className="space-y-4">
            {evaluations.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Inga TGT-runs ännu. Skapa första via en mall till vänster.
              </div>
            ) : (
              evaluations.map((evaluation) => (
                <RunEvaluationCard key={evaluation.testRun.id} evaluation={evaluation} messages={messages} />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
