// components/admin/ediel/EdielAgtWorkbenchPanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  createEdielAgtOutboundCommandAction,
  createEdielAgtResponsesForInboundAction,
  createEdielAgtRunAction,
} from '@/app/admin/ediel/actions'
import {
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
} from '@/lib/ediel/fileEngine'
import {
  isEdielAgtRunApprovalVersion,
  listEdielSupplierAgt2026Cases,
  type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/agtRegistry'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

type BadgeTone = 'slate' | 'emerald' | 'amber' | 'red'

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'red'
          ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}>
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

function findActiveRun(testRuns: EdielTestRunRow[], definition: EdielAgtTestCaseDefinition): EdielTestRunRow | null {
  return testRuns.find((run) =>
    isEdielAgtRunApprovalVersion(run.approval_version) &&
    (run.status === 'running' || run.status === 'draft') &&
    run.test_suite === definition.suite &&
    run.role_code === definition.roleCode &&
    run.test_case_code === definition.testCaseCode
  ) ?? null
}

function messageMatchesDefinition(message: EdielMessageRow, definition: EdielAgtTestCaseDefinition): boolean {
  if (message.direction !== 'inbound') return false
  if (message.status === 'cancelled') return false

  if (definition.scenario === 'portal_sends_actor_answers') {
    return message.message_family === definition.messageFamily && message.message_code === definition.messageCode
  }

  if (message.message_family === 'CONTRL' || message.message_family === 'APERAK') {
    const testMarker = `${definition.testCaseCode}`.toUpperCase()
    const raw = String(message.raw_payload ?? '').toUpperCase()
    const subject = String(message.subject ?? '').toUpperCase()
    const ref = String(message.external_reference ?? message.correlation_reference ?? '').toUpperCase()
    return raw.includes(testMarker) || subject.includes(testMarker) || ref.includes(testMarker)
  }

  return false
}

function recentCandidates(messages: EdielMessageRow[], definition: EdielAgtTestCaseDefinition): EdielMessageRow[] {
  return messages
    .filter((message) => messageMatchesDefinition(message, definition))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 4)
}

function CaseCard({
  definition,
  messages,
  testRuns,
}: {
  definition: EdielAgtTestCaseDefinition
  messages: EdielMessageRow[]
  testRuns: EdielTestRunRow[]
}) {
  const activeRun = findActiveRun(testRuns, definition)
  const candidates = recentCandidates(messages, definition)
  const actorSendsFirst = definition.scenario === 'actor_sends_and_receives_ack'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={definition.suite === 'PRODAT' ? 'emerald' : 'emerald'}>{definition.suite}</Badge>
            <Badge tone="emerald">{definition.testCaseCode}</Badge>
            {definition.messageVariant ? <Badge>{definition.messageVariant}</Badge> : null}
            {activeRun ? <Badge tone="amber">aktiv run</Badge> : <Badge>inte startad i systemet</Badge>}
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950">{definition.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{definition.purpose}</p>
        </div>
        {activeRun ? (
          <div className="text-right text-xs text-slate-500">
            <div>{activeRun.status}</div>
            <div>{formatDateTime(activeRun.started_at ?? activeRun.created_at)}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
        {definition.agtInstruction}
      </div>

      <div className="mt-4 grid gap-2">
        {definition.expectedSteps.map((step) => (
          <div key={`${definition.testCaseCode}-${step.stepNo}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-700">
            <Badge tone={step.actor === 'actor' ? 'emerald' : 'emerald'}>Steg {step.stepNo}</Badge>
            <span className="font-medium">{step.actor === 'actor' ? 'Leverantören/systemet' : 'Edielportalen'}</span>
            <span>{step.direction}</span>
            <span>{step.family} {step.code}</span>
            <span className="text-slate-500">{step.title}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <form action={createEdielAgtRunAction} className="rounded-2xl border border-slate-200 p-3">
          <input type="hidden" name="testSuite" value={definition.suite} />
          <input type="hidden" name="testCaseCode" value={definition.testCaseCode} />
          <button type="submit" className="w-full rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Starta AGT-run i systemet
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Starta samma testfall i Edielportalen först eller direkt efter. Bara ett portaltest åt gången.
          </p>
        </form>

        {actorSendsFirst ? (
          <form action={createEdielAgtOutboundCommandAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <input type="hidden" name="testRunId" value={activeRun?.id ?? ''} />
            <input type="hidden" name="testCaseCode" value={definition.testCaseCode} />
            <button type="submit" className="w-full rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Generera + skicka outbound AGT
            </button>
            <p className="mt-2 text-xs leading-5 text-emerald-800">
              Gäller {definition.messageFamily} {definition.messageCode}. Payload renderas vid skick och sparas därefter som audit/logg.
            </p>
          </form>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-semibold text-emerald-950">Vänta på inbound från portalen</div>
            <p className="mt-2 text-xs leading-5 text-emerald-800">
              Importera portalens {definition.messageFamily} {definition.messageCode} med motorläge AGT. Skapa sedan CONTRL + negativt svar från inbound-raden här.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-slate-900">Senaste matchande inbound</div>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Ingen matchande inbound hittad ännu.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {candidates.map((message) => (
              <div key={message.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="emerald">inbound</Badge>
                    <Badge>{message.message_family} {message.message_code}</Badge>
                    <Badge>{message.status}</Badge>
                    <span className="text-slate-500">{formatDateTime(message.created_at)}</span>
                  </div>
                  <Link href={`/admin/ediel/messages/${message.id}`} className="text-xs font-semibold text-emerald-700 hover:underline">
                    Öppna
                  </Link>
                </div>
                <div className="mt-2 break-all text-xs text-slate-500">
                  FR {message.sender_ediel_id ?? '—'} → DO {message.receiver_ediel_id ?? '—'} · ref {message.external_reference ?? message.interchange_reference ?? '—'}
                </div>
                {!actorSendsFirst ? (
                  <form action={createEdielAgtResponsesForInboundAction} className="mt-3">
                    <input type="hidden" name="sourceMessageId" value={message.id} />
                    <input type="hidden" name="testRunId" value={activeRun?.id ?? ''} />
                    <input type="hidden" name="testCaseCode" value={definition.testCaseCode} />
                    <button type="submit" className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                      Skapa AGT-svar för detta inbound
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function EdielAgtWorkbenchPanel({
  messages,
  testRuns,
}: {
  messages: EdielMessageRow[]
  testRuns: EdielTestRunRow[]
}) {
  const prodatCases = listEdielSupplierAgt2026Cases({ suite: 'PRODAT' })
  const utiltsCases = listEdielSupplierAgt2026Cases({ suite: 'UTILTS' })
  const activeAgtRuns = testRuns.filter((run) => isEdielAgtRunApprovalVersion(run.approval_version) && (run.status === 'running' || run.status === 'draft'))

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="emerald">AGT 2026A</Badge>
          <Badge tone="emerald">Aktiv leverantör från AGT-runtime</Badge>
          <Badge tone="emerald">Portal {EDIEL_TGT_TESTSYSTEM_EDIEL_ID}</Badge>
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-950">Leverantörstest mot Edielportalen</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Denna vy är separat från Gridcore/TGT. Leverantören skickar och kvitterar med aktivt Ediel-id från AGT-runtime. Motparten är Edielportalen {EDIEL_TGT_TESTSYSTEM_EDIEL_ID} / {EDIEL_TGT_TESTSYSTEM_EMAIL}. PRODAT använder den sender-subadress som är sparad på aktiv tenantprofil och receiver-subadress {EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}; UTILTS använder ingen subadress.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">PRODAT</div>
            <div className="mt-1 text-sm text-slate-900">L1, L2, L3, L4, L5, L7</div>
          </div>
          <div className="rounded-2xl bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">UTILTS</div>
            <div className="mt-1 text-sm text-slate-900">UL1, UL2, UL3, UL4, UL6</div>
          </div>
          <div className="rounded-2xl bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktiva AGT-runs</div>
            <div className="mt-1 text-sm text-slate-900">{activeAgtRuns.length}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="emerald">PRODAT leverantör</Badge>
          <span className="text-sm text-slate-600">L1 och L7 genereras och skickas direkt. L2-L5 besvarar portalens inbound.</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {prodatCases.map((definition) => (
            <CaseCard key={definition.testCaseCode} definition={definition} messages={messages} testRuns={testRuns} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="emerald">UTILTS leverantör</Badge>
          <span className="text-sm text-slate-600">Inbound från portalen ska få positiv CONTRL och negativ UTILTS/UTILTS_ERR.</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {utiltsCases.map((definition) => (
            <CaseCard key={definition.testCaseCode} definition={definition} messages={messages} testRuns={testRuns} />
          ))}
        </div>
      </div>
    </section>
  )
}
