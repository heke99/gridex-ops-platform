import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  cancelEdielMessageAction,
  prepareSwitchZ03Action,
  prepareSwitchZ04Action,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type {
  EdielProdatCandidateIssue,
  EdielProdatProductionCandidate,
} from '@/lib/ediel/prodatContext'

type BadgeTone = 'slate' | 'green' | 'yellow' | 'red' | 'blue' | 'indigo'

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  const classes = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    yellow: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  }[tone]

  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${classes}`}>{children}</span>
}

function issueTone(issue: EdielProdatCandidateIssue): BadgeTone {
  if (issue.severity === 'error') return 'red'
  if (issue.severity === 'warning') return 'yellow'
  return 'blue'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function candidateMessageCount(messages: EdielMessageRow[], candidate: EdielProdatProductionCandidate, code: 'Z03' | 'Z04') {
  return messages.filter((message) =>
    message.switch_request_id === candidate.switchRequestId &&
    message.message_family === 'PRODAT' &&
    message.message_code === code &&
    message.status !== 'cancelled'
  ).length
}

function candidatePreparedMessages(messages: EdielMessageRow[], candidate: EdielProdatProductionCandidate) {
  return messages.filter((message) =>
    message.switch_request_id === candidate.switchRequestId &&
    message.message_family === 'PRODAT' &&
    message.status !== 'cancelled'
  )
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-xs font-semibold text-slate-900">{value ?? '—'}</div>
    </div>
  )
}

function ProductionCandidateCard({
  candidate,
  messages,
}: {
  candidate: EdielProdatProductionCandidate
  messages: EdielMessageRow[]
}) {
  const z03Count = candidateMessageCount(messages, candidate, 'Z03')
  const z04Count = candidateMessageCount(messages, candidate, 'Z04')
  const preparedMessages = candidatePreparedMessages(messages, candidate)
  const blockingIssues = candidate.issues.filter((issue) => issue.severity === 'error')
  const warningIssues = candidate.issues.filter((issue) => issue.severity !== 'error')

  return (
    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm open:ring-2 open:ring-emerald-100">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={candidate.readyForPortalOrProduction ? 'green' : 'red'}>
                {candidate.readyForPortalOrProduction ? 'redo för Ediel-utkast' : 'spärrad'}
              </Badge>
              <Badge>{candidate.requestType}</Badge>
              <Badge tone="blue">{candidate.switchStatus}</Badge>
              {z03Count > 0 ? <Badge tone="yellow">Z03 finns: {z03Count}</Badge> : <Badge tone="slate">ingen Z03</Badge>}
              {z04Count > 0 ? <Badge tone="yellow">Z04 finns: {z04Count}</Badge> : <Badge tone="slate">ingen Z04</Badge>}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-slate-950">{candidate.customerLabel}</h3>
            <p className="mt-1 text-xs text-slate-600">
              {candidate.siteLabel} · Anläggning {candidate.facilityId ?? 'saknas'} · Mätpunkt {candidate.meteringPointId ?? 'saknas'}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>Startdatum</div>
            <div className="mt-1 font-semibold text-slate-900">{formatDate(candidate.requestedStartDate)}</div>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Kund-ID/person/org" value={candidate.customerIdentifier} />
          <Field label="E-post" value={candidate.customerEmail} />
          <Field label="Anläggningsadress" value={candidate.siteAddress} />
          <Field label="Årsförbrukning" value={candidate.annualConsumptionKwh ? `${candidate.annualConsumptionKwh} kWh` : null} />
          <Field label="Nätägare" value={candidate.gridOwnerName} />
          <Field label="Nätägarens Ediel-ID" value={candidate.gridOwnerEdielId} />
          <Field label="Route" value={candidate.communicationRouteName} />
          <Field label="Route-typ" value={candidate.communicationRouteType} />
          <Field label="Fullmakt" value={candidate.powerOfAttorneyStatus} />
          <Field label="Fullmaktsreferens" value={candidate.powerOfAttorneyReference} />
          <Field label="Mätmetod/typ" value={candidate.meteringMethod} />
          <Field label="Rapporteringsfrekvens" value={candidate.readingFrequency} />
        </div>

        {blockingIssues.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold text-rose-950">Spärr innan skickning</div>
            <div className="mt-2 space-y-2">
              {blockingIssues.map((issue) => (
                <div key={issue.code} className="rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs text-rose-800">
                  <div className="font-semibold">{issue.title}</div>
                  <div className="mt-1">{issue.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <div className="font-semibold">Portal-ready check godkänd</div>
            <p className="mt-1">Kund, person/orgnummer, anläggning, mätpunkt, nätägare, route, startdatum och fullmakt finns. Systemet tillåter filutkast.</p>
          </div>
        )}

        {warningIssues.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {warningIssues.map((issue) => (
              <Badge key={issue.code} tone={issueTone(issue)}>{issue.title}</Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <form action={prepareSwitchZ03Action}>
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <input type="hidden" name="environment" value="test" />
            {candidate.communicationRouteId ? <input type="hidden" name="communicationRouteId" value={candidate.communicationRouteId} /> : null}
            <button
              disabled={!candidate.canCreateZ03}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Skapa Z03-utkast
            </button>
          </form>
          <form action={prepareSwitchZ04Action}>
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <input type="hidden" name="environment" value="test" />
            {candidate.communicationRouteId ? <input type="hidden" name="communicationRouteId" value={candidate.communicationRouteId} /> : null}
            <button
              disabled={!candidate.canCreateZ04}
              className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              Skapa Z04-utkast
            </button>
          </form>
          {candidate.customerId ? (
            <Link href={`/admin/customers/${candidate.customerId}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Öppna kundkort
            </Link>
          ) : null}
          <Link href={`/admin/operations/switches`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Öppna switchlista
          </Link>
        </div>

        {preparedMessages.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-900">Skapade utkast/meddelanden för detta ärende</div>
            <div className="mt-2 space-y-2">
              {preparedMessages.slice(0, 6).map((message) => (
                <div key={message.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{message.message_family}/{message.message_code}</span>
                    <span className="ml-2 text-slate-500">{message.status} · {message.external_reference ?? 'utan extern ref'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/ediel/messages/${message.id}`} className="font-semibold text-indigo-700 hover:underline">Öppna</Link>
                    {['draft', 'queued', 'prepared', 'failed'].includes(message.status) ? (
                      <form action={cancelEdielMessageAction}>
                        <input type="hidden" name="edielMessageId" value={message.id} />
                        <input type="hidden" name="reason" value="Avbrutet från kundstyrd Ediel-panel. Fel kund/underlag eller nytt utkast ska skapas. Historik behålls." />
                        <button className="font-semibold text-rose-700 hover:underline">Avbryt utkast</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  )
}

export default function EdielProductionProdatPanel({
  candidates,
  messages,
}: {
  candidates: EdielProdatProductionCandidate[]
  messages: EdielMessageRow[]
}) {
  const ready = candidates.filter((candidate) => candidate.readyForPortalOrProduction).length
  const blocked = candidates.length - ready

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Kundstyrd PRODAT för produktion och portaltest</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            Välj ett riktigt switchärende. Systemet kontrollerar kund, anläggning, mätpunkt, nätägare, route, startdatum och fullmakt innan Z03/Z04 får skapas. Felaktiga utkast avbryts utan att historiken raderas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">redo: {ready}</Badge>
          <Badge tone={blocked > 0 ? 'red' : 'green'}>spärrade: {blocked}</Badge>
          <Badge tone="blue">kandidater: {candidates.length}</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-semibold">1. Välj kundunderlag</div>
          <p className="mt-1">Utgå från ett switchärende så kund, avtal, anläggning och mätpunkt hänger ihop.</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <div className="font-semibold">2. Kontrollera spärrar</div>
          <p className="mt-1">Saknas personnummer, fullmakt, route eller mätpunkt blockeras filskapande direkt.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-semibold">3. Skapa utkast</div>
          <p className="mt-1">Utkastet sparas som Ediel-meddelande. Skickade meddelanden raderas aldrig; fel hanteras via avbruten status och auditspår.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {candidates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Inga switchärenden hittades. Skapa kund, anläggning, mätpunkt, fullmakt och switchärende först.
          </div>
        ) : (
          candidates.map((candidate) => (
            <ProductionCandidateCard key={candidate.switchRequestId} candidate={candidate} messages={messages} />
          ))
        )}
      </div>
    </section>
  )
}
