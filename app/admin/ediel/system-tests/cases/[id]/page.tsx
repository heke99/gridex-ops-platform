import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listEdielMessages, listEdielMessagesByIds, listEdielTestRunMessages, listEdielTestRuns } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import {
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
  GRIDEX_TGT_EDIEL_ID,
} from '@/lib/ediel/fileEngine'
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCaseByCode,
  getEdielTgtTestCases,
  type EdielTgtExpectedStep,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import { createEdielTgtRunFromTemplateAction } from '@/app/admin/ediel/actions'
import {
  createAndSendSystemTestAckAction,
  deleteSystemTestRunAction,
  pollAndSyncTgtSystemTestMailboxAction,
  softDeleteSystemTestMessageAction,
  unlinkSystemTestMessageAction,
  validateSystemTestPayloadAction,
} from '@/app/admin/ediel/system-tests/actions'

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


function identityText(testCase: EdielTgtTestCaseDefinition): string {
  const first = testCase.expectedSteps[0]
  if (first?.direction === 'inbound' && first.actor === 'portal') {
    return `Inbound från Edielportalen ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID} till Gridex/GridCore ${GRIDEX_TGT_EDIEL_ID}.`
  }
  if (first?.direction === 'outbound' && first.actor === 'gridex') {
    return `Outbound från Gridex/GridCore ${GRIDEX_TGT_EDIEL_ID} till Edielportalen ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.`
  }
  return `Systemets TGT Ediel-ID är ${GRIDEX_TGT_EDIEL_ID}; Edielportalen är ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.`
}

function expectedResponseText(testCase: EdielTgtTestCaseDefinition): string {
  const gridexOutbound = testCase.expectedSteps.filter((step) => step.actor === 'gridex' && step.direction === 'outbound' && step.required)
  if (gridexOutbound.some((step) => step.family === 'UTILTS_ERR')) return 'Förväntat svar från Gridex: positiv CONTRL + UTILTS_ERR.'
  const aperak = gridexOutbound.find((step) => step.family === 'APERAK')
  if (aperak?.outcome === 'negative') return 'Förväntat svar från Gridex: positiv CONTRL + negativ APERAK.'
  if (aperak?.outcome === 'positive') return 'Förväntat svar från Gridex: positiv CONTRL + positiv APERAK.'
  if (gridexOutbound.some((step) => step.family === 'CONTRL')) return 'Förväntat svar från Gridex: CONTRL enligt kedjan.'
  return 'Förväntat svar följer stegen nedan.'
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


function AckActionForm({
  sourceMessageId,
  testRunId,
  testCase,
  ackFamily,
  outcome,
  label,
  tone = 'slate',
  stepNo,
}: {
  sourceMessageId: string
  testRunId: string
  testCase: EdielTgtTestCaseDefinition
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome: 'positive' | 'negative'
  label: string
  tone?: Tone
  stepNo?: number | null
}) {
  return (
    <form action={createAndSendSystemTestAckAction}>
      <input type="hidden" name="sourceMessageId" value={sourceMessageId} />
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <input type="hidden" name="ackFamily" value={ackFamily} />
      <input type="hidden" name="outcome" value={outcome} />
      <input type="hidden" name="sendNow" value="true" />
      {stepNo ? <input type="hidden" name="stepNo" value={String(stepNo)} /> : null}
      <button type="submit" className={`rounded-xl border px-3 py-2 text-xs font-semibold ${badgeClass(tone)} hover:bg-white`}>
        {label}
      </button>
    </form>
  )
}

function UnlinkMessageForm({ testRunId, testCaseCode, edielMessageId, linkId }: { testRunId: string; testCaseCode: string; edielMessageId: string; linkId?: string | null }) {
  return (
    <form action={unlinkSystemTestMessageAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="edielMessageId" value={edielMessageId} />
      {linkId ? <input type="hidden" name="linkId" value={linkId} /> : null}
      <button type="submit" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
        Koppla loss
      </button>
    </form>
  )
}

function SoftDeleteMessageForm({ testRunId, testCaseCode, edielMessageId }: { testRunId: string; testCaseCode: string; edielMessageId: string }) {
  return (
    <form action={softDeleteSystemTestMessageAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="edielMessageId" value={edielMessageId} />
      <input type="hidden" name="reason" value="Soft delete från testfallssidan. Felkopplat eller felaktigt testmeddelande." />
      <button type="submit" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
        Soft delete
      </button>
    </form>
  )
}

function DeleteRunForm({ testRunId, testCaseCode }: { testRunId: string; testCaseCode: string }) {
  return (
    <form action={deleteSystemTestRunAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="reason" value="Testkörning rensad från testfallssidan innan ny portaltestkörning." />
      <button type="submit" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
        Radera/lossa testkörning
      </button>
    </form>
  )
}

function safeJsonPreview(value: unknown, maxLength = 900): string {
  try {
    const text = JSON.stringify(value ?? {}, null, 2)
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
  } catch {
    return 'Kunde inte visa payload.'
  }
}

function expectedAckStep(testCase: EdielTgtTestCaseDefinition, family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR', outcome?: 'positive' | 'negative') {
  return testCase.expectedSteps.find((step) =>
    step.actor === 'gridex' &&
    step.direction === 'outbound' &&
    step.family === family &&
    (!outcome || step.outcome === outcome)
  ) ?? testCase.expectedSteps.find((step) => step.actor === 'gridex' && step.direction === 'outbound' && step.family === family)
}

function shouldOfferAperak(messageFamily: string | null | undefined) {
  return messageFamily === 'PRODAT' || messageFamily === 'UTILTS'
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
  const runDetails = await Promise.all(matchingRuns.map(async (run) => {
    const links = await listEdielTestRunMessages({ testRunId: run.id }).catch(() => [])
    const linkMessageRows = await listEdielMessagesByIds(links.map((link) => link.ediel_message_id)).catch(() => [])
    const messagesById = new Map(linkMessageRows.map((message) => [message.id, message]))
    let artifactRows: Array<Record<string, unknown>> = []
    try {
      const artifactResult = await supabaseService
        .from('ediel_test_artifacts')
        .select('*')
        .eq('test_run_id', run.id)
        .order('created_at', { ascending: false })
        .limit(8)

      if (!artifactResult.error || artifactResult.error.code === '42P01') {
        artifactRows = (artifactResult.data ?? []) as Array<Record<string, unknown>>
      }
    } catch {
      artifactRows = []
    }

    return {
      runId: run.id,
      links: links.map((link) => ({ link, message: messagesById.get(link.ediel_message_id) ?? null })),
      artifacts: artifactRows,
    }
  }))
  const runDetailById = new Map(runDetails.map((detail) => [detail.runId, detail]))

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
              <Badge>System Ediel-ID {GRIDEX_TGT_EDIEL_ID}</Badge>
              <Badge>Portal {EDIEL_TGT_TESTSYSTEM_EDIEL_ID}</Badge>
              {latest ? <Badge tone={statusTone(latest.computedStatus)}>{latest.computedStatus}</Badge> : <Badge>Inte påbörjad</Badge>}
            </div>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-700">{testCase.purpose}</p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <div className="font-semibold">Ediel-identitet</div>
                <div>{identityText(testCase)}</div>
                <div className="mt-1 text-xs">Portalens e-post: {EDIEL_TGT_TESTSYSTEM_EMAIL}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
                <div className="font-semibold">Förväntad respons</div>
                <div>{expectedResponseText(testCase)}</div>
              </div>
            </div>
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
          <li>Klicka <strong>Starta ny testkörning</strong> i Gridex. Kör bara ett U3-test åt gången.</li>
          <li>Starta exakt samma testfall i Edielportalen: <strong>{testCase.testCaseCode}</strong>.</li>
          <li>Kontrollera att portalens fil gäller rätt mottagare: Gridex/GridCore Ediel-ID <strong>{GRIDEX_TGT_EDIEL_ID}</strong>.</li>
          <li>När portalen skickar inbound UTILTS/PRODAT/ACK: klicka på <strong>Importera via IMAP och synka</strong> här nedan. Knappen pollar IMAP direkt från testfallssidan.</li>
          <li>Importformuläret skickar med <strong>tgtTestCaseCode={testCase.testCaseCode}</strong>, så payloaden kopplas till rätt aktiv run och inte till fel E66-test.</li>
          <li>Kontrollera kedjan under Aktiva körningar. Gridex skapar nästa svar enligt förväntat steg.</li>
        </ol>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">Importera via IMAP och synka till detta testfall</h2>
        <p className="mt-1 text-sm leading-6 text-blue-950">
          Använd detta när Edielportalen har skickat inbound-filen. Knappen pollar IMAP direkt, importerar olästa Ediel-meddelanden och låser synken till <strong>{testCase.testCaseCode}</strong> så U3.1.1/U3.1.2/U3.2.1/U3.2.2 inte blandas ihop.
        </p>
        <form action={pollAndSyncTgtSystemTestMailboxAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-end">
          <input type="hidden" name="testSuite" value={testCase.suite} />
          <input type="hidden" name="roleCode" value={testCase.roleCode} />
          <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
          <input type="hidden" name="tgtTestCaseCode" value={testCase.testCaseCode} />
          <label className="block text-sm font-medium text-slate-700">
            IMAP-mapp / mailbox
            <input name="mailbox" defaultValue="INBOX" className="mt-1 block w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Max antal
            <input name="limit" defaultValue="10" inputMode="numeric" className="mt-1 block w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
          </label>
          <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            Importera via IMAP och synka till {testCase.testCaseCode}
          </button>
        </form>
        <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3 text-xs leading-5 text-blue-950">
          Om IMAP saknar inställningar eller lösenord skapas en misslyckad testkörning med felorsak i stället för att sidan kraschar.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Payload-validator</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-700">
              Använd denna innan du skickar eller efter IMAP-import för att se parsed family/code, fältfel, fel Application Reference och förväntad ACK. Resultatet sparas som artifact på aktiv testkörning om en finns.
            </p>
          </div>
          <Badge>2.5A</Badge>
        </div>
        <form action={validateSystemTestPayloadAction} className="mt-4 grid gap-3">
          <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
          {latest?.testRun.id ? <input type="hidden" name="testRunId" value={latest.testRun.id} /> : null}
          <textarea name="rawPayload" rows={8} placeholder="Klistra in EDIFACT/XML/AI-lista här" className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" />
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block text-sm font-medium text-slate-700">
              Eller ladda upp payloadfil
              <input type="file" name="payloadFile" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Validera payload mot {testCase.testCaseCode}
            </button>
          </div>
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
          ) : evaluations.map((evaluation) => {
            const detail = runDetailById.get(evaluation.testRun.id)
            const contrlPositiveStep = expectedAckStep(testCase, 'CONTRL', 'positive')
            const contrlNegativeStep = expectedAckStep(testCase, 'CONTRL', 'negative')
            const positiveAperakStep = expectedAckStep(testCase, 'APERAK', 'positive')
            const negativeAperakStep = expectedAckStep(testCase, 'APERAK', 'negative')
            const utiltsErrStep = expectedAckStep(testCase, 'UTILTS_ERR', 'negative')

            return (
            <div key={evaluation.testRun.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(evaluation.computedStatus)}>{evaluation.computedStatus}</Badge>
                  <Badge>{evaluation.passedSteps}/{evaluation.requiredSteps} steg</Badge>
                  <Badge tone={evaluation.missingRequiredSteps > 0 ? 'amber' : 'emerald'}>{evaluation.missingRequiredSteps} saknas</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs text-slate-600">Skapad {formatDate(evaluation.testRun.created_at)}</div>
                  <DeleteRunForm testRunId={evaluation.testRun.id} testCaseCode={testCase.testCaseCode} />
                </div>
              </div>
              {evaluation.testRun.failure_reason ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <strong>Senaste fel:</strong> {evaluation.testRun.failure_reason}
                </div>
              ) : null}
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

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">Testkopplade meddelanden</h3>
                  <Badge>{detail?.links.length ?? 0} kopplingar</Badge>
                </div>
                <div className="mt-3 space-y-3">
                  {!detail || detail.links.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Inga testkopplade meddelanden ännu. Polla IMAP eller koppla meddelande från meddelandevyn.</div>
                  ) : detail.links.map(({ link, message }) => (
                    <div key={link.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge tone={message?.direction === 'inbound' ? 'amber' : 'emerald'}>{message?.direction ?? 'okänd'}</Badge>
                          <Badge>{message?.message_family ?? link.expected_family} {message?.message_code ?? link.expected_code}</Badge>
                          <Badge>{message?.status ?? '—'}</Badge>
                          {link.step_no ? <Badge>Steg {link.step_no}</Badge> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {message ? <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna</Link> : null}
                          {message ? <UnlinkMessageForm testRunId={evaluation.testRun.id} testCaseCode={testCase.testCaseCode} edielMessageId={message.id} linkId={link.id} /> : null}
                          {message ? <SoftDeleteMessageForm testRunId={evaluation.testRun.id} testCaseCode={testCase.testCaseCode} edielMessageId={message.id} /> : null}
                        </div>
                      </div>
                      {message?.direction === 'inbound' && message.message_family !== 'CONTRL' ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <AckActionForm sourceMessageId={message.id} testRunId={evaluation.testRun.id} testCase={testCase} ackFamily="CONTRL" outcome="positive" stepNo={contrlPositiveStep?.stepNo ?? contrlNegativeStep?.stepNo ?? null} label="Skapa & skicka positiv CONTRL" tone="emerald" />
                          <AckActionForm sourceMessageId={message.id} testRunId={evaluation.testRun.id} testCase={testCase} ackFamily="CONTRL" outcome="negative" stepNo={contrlNegativeStep?.stepNo ?? contrlPositiveStep?.stepNo ?? null} label="Skapa & skicka negativ CONTRL" tone="red" />
                          {shouldOfferAperak(message.message_family) && positiveAperakStep ? <AckActionForm sourceMessageId={message.id} testRunId={evaluation.testRun.id} testCase={testCase} ackFamily="APERAK" outcome="positive" stepNo={positiveAperakStep.stepNo} label="Skapa & skicka positiv APERAK" tone="emerald" /> : null}
                          {shouldOfferAperak(message.message_family) && negativeAperakStep ? <AckActionForm sourceMessageId={message.id} testRunId={evaluation.testRun.id} testCase={testCase} ackFamily="APERAK" outcome="negative" stepNo={negativeAperakStep.stepNo} label="Skapa & skicka negativ APERAK" tone="red" /> : null}
                          {message.message_family === 'UTILTS' && utiltsErrStep ? <AckActionForm sourceMessageId={message.id} testRunId={evaluation.testRun.id} testCase={testCase} ackFamily="UTILTS_ERR" outcome="negative" stepNo={utiltsErrStep.stepNo} label="Skapa & skicka UTILTS_ERR" tone="red" /> : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">Decision trace / artifacts</h3>
                  <Badge>{detail?.artifacts.length ?? 0} artifacts</Badge>
                </div>
                <div className="mt-3 space-y-3">
                  {!detail || detail.artifacts.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Inga artifacts ännu. Kör IMAP-synk eller Payload-validator.</div>
                  ) : detail.artifacts.map((artifact) => (
                    <details key={String(artifact.id ?? `${artifact.artifact_type}-${artifact.created_at}`)} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                      <summary className="cursor-pointer font-semibold text-slate-900">
                        {String(artifact.artifact_type ?? 'artifact')} · {String(artifact.title ?? '')} · {formatDate(typeof artifact.created_at === 'string' ? artifact.created_at : null)}
                      </summary>
                      <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-50">{safeJsonPreview(artifact.payload)}</pre>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          )
          })}
        </div>
      </section>
    </div>
  )
}
