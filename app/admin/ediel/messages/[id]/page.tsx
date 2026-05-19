// app/admin/ediel/messages/[id]/page.tsx

import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  getEdielMessageById,
  getEdielMessageAckStateById,
  listEdielMessageEvents,
  listAckMessagesForSource,
} from '@/lib/ediel/db'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import {
  getEdielRouteRuntimeByCommunicationRouteId,
  resolveInboundAcceptedVersionsRuntime,
  resolveOutboundMessageVersionRuntime,
  type ResolvedVersionWindow,
} from '@/lib/ediel/config'
import {
  cancelEdielMessageAction,
  createNegativeUtiltsResponseAction,
  deleteEdielMessageAction,
  processEdielOperationalMessageAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageEventRow, EdielMessageRow } from '@/lib/ediel/types'
import { evaluateProdatPortalReadiness } from '@/lib/ediel/prodatPortalReadiness'

export const dynamic = 'force-dynamic'

function tone(kind: 'emerald' | 'amber' | 'red' | 'slate'): string {
  if (kind === 'emerald') return 'bg-emerald-100 text-emerald-700'
  if (kind === 'amber') return 'bg-amber-100 text-amber-700'
  if (kind === 'red') return 'bg-red-100 text-red-700'
  return 'bg-slate-100 text-slate-700'
}

function badgeTone(
  status: string | null | undefined
): 'emerald' | 'amber' | 'red' | 'slate' {
  if (!status) return 'slate'
  if (
    [
      'acknowledged',
      'received',
      'aperak_received',
      'aperak_received_positive',
      'contrl_completed',
      'contrl_received',
      'utilts_err_received',
      'no_ack_required',
      'success',
      'info',
    ].includes(status)
  ) {
    return 'emerald'
  }
  if (
    [
      'queued',
      'prepared',
      'pending',
      'awaiting_contrl',
      'awaiting_aperak',
      'in_progress',
      'warning',
    ].includes(status)
  ) {
    return 'amber'
  }
  if (
    [
      'failed',
      'contrl_failed',
      'ack_overdue',
      'aperak_received_negative',
      'error',
    ].includes(status)
  ) {
    return 'red'
  }
  if (['sent', 'validated', 'parsed'].includes(status)) {
    return 'emerald'
  }
  return 'slate'
}

function Pill({ text }: { text: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone(badgeTone(text))}`}>
      {text}
    </span>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  )
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
}

function getDuplicateBlockEvents(events: EdielMessageEventRow[]): EdielMessageEventRow[] {
  return events.filter((event) => event.payload?.duplicateBlocked === true)
}

function getAckConflictEvents(events: EdielMessageEventRow[]): EdielMessageEventRow[] {
  return events.filter((event) => event.payload?.ackConflict === true)
}

function getIssueEvents(events: EdielMessageEventRow[]): EdielMessageEventRow[] {
  return events.filter(
    (event) =>
      event.payload?.duplicateBlocked === true ||
      event.payload?.ackConflict === true ||
      event.event_status === 'error'
  )
}

function isUtiltsErrAckMessage(message: EdielMessageRow): boolean {
  return (
    String(message.message_family) === 'UTILTS_ERR' ||
    (String(message.message_family) === 'UTILTS' &&
      String(message.message_code ?? '').toUpperCase() === 'ERR')
  )
}

function getVersionDiagnostics(validationReport: Record<string, unknown>) {
  const acceptedInboundVersions = asStringArray(validationReport.acceptedInboundVersions)
  const inboundVersionAccepted = validationReport.inboundVersionAccepted === true
  const inboundVersionRejected = validationReport.inboundVersionAccepted === false
  const inboundVersionCheckDate =
    typeof validationReport.inboundVersionCheckDate === 'string'
      ? validationReport.inboundVersionCheckDate
      : null
  const versionErrors = asStringArray(validationReport.versionErrors)

  return {
    acceptedInboundVersions,
    inboundVersionAccepted,
    inboundVersionRejected,
    inboundVersionCheckDate,
    versionErrors,
  }
}

function getCodeListDiagnostics(validationReport: Record<string, unknown>) {
  const codeListErrors = asStringArray(validationReport.codeListErrors)
  const codeValidationErrors = asStringArray(validationReport.codeValidationErrors)
  const invalidCodes = asStringArray(validationReport.invalidCodes)

  return {
    codeListErrors,
    codeValidationErrors,
    invalidCodes,
    hasIssues:
      codeListErrors.length > 0 ||
      codeValidationErrors.length > 0 ||
      invalidCodes.length > 0 ||
      validationReport.invalidCodeListUsage === true ||
      validationReport.invalidCodeUsage === true,
  }
}

function summarizeRouteRuntime(routeRuntime: Record<string, unknown> | null) {
  if (!routeRuntime) return []

  const routeName =
    typeof routeRuntime.routeName === 'string'
      ? routeRuntime.routeName
      : typeof routeRuntime.route_name === 'string'
        ? routeRuntime.route_name
        : null

  const receiverEdielId =
    typeof routeRuntime.receiverEdielId === 'string'
      ? routeRuntime.receiverEdielId
      : typeof routeRuntime.receiver_ediel_id === 'string'
        ? routeRuntime.receiver_ediel_id
        : null

  const applicationReference =
    typeof routeRuntime.applicationReference === 'string'
      ? routeRuntime.applicationReference
      : typeof routeRuntime.application_reference === 'string'
        ? routeRuntime.application_reference
        : null

  const transportType =
    typeof routeRuntime.transportType === 'string'
      ? routeRuntime.transportType
      : typeof routeRuntime.transport_type === 'string'
        ? routeRuntime.transport_type
        : null

  const defaultMessageVersion =
    typeof routeRuntime.defaultMessageVersion === 'string'
      ? routeRuntime.defaultMessageVersion
      : typeof routeRuntime.default_message_version === 'string'
        ? routeRuntime.default_message_version
        : null

  return [
    routeName ? `Route: ${routeName}` : null,
    receiverEdielId ? `Mottagare: ${receiverEdielId}` : null,
    applicationReference ? `Application ref: ${applicationReference}` : null,
    transportType ? `Transport: ${transportType}` : null,
    defaultMessageVersion ? `Route default version: ${defaultMessageVersion}` : null,
  ].filter((value): value is string => Boolean(value))
}

function renderVersionWindow(window: ResolvedVersionWindow | null) {
  if (!window) {
    return (
      <div className="text-sm text-slate-500">
        Ingen runtime-version kunde lösas för detta meddelande.
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Selected version</div>
        <div className="mt-2 text-sm text-slate-900">{window.selectedVersion ?? '—'}</div>
      </div>
      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Current / previous</div>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <div>Current: {window.currentVersion ?? '—'}</div>
          <div>Previous valid: {window.previousVersion ?? '—'}</div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 p-4 md:col-span-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">Accepted versions</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {window.acceptedVersions.length > 0 ? (
            window.acceptedVersions.map((version) => <Pill key={version} text={version} />)
          ) : (
            <span className="text-sm text-slate-500">Inga accepted versions rapporterade.</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default async function AdminEdielMessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const context = await requireAnyPermissionServer(['communication.read'])

  const [message, ackState, events] = await Promise.all([
    getEdielMessageById(id),
    getEdielMessageAckStateById(id),
    listEdielMessageEvents(id),
  ])

  if (!message) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AdminHeader
          title="Ediel message"
          subtitle="Meddelandet hittades inte."
          userEmail={context.email}
        />
        <div className="p-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Ingen rad hittades för detta meddelande.
          </div>
        </div>
      </div>
    )
  }

  const [relatedAckMessages, linkedMessage, routeRuntime, versionWindow] = await Promise.all([
    message.direction === 'inbound'
      ? listAckMessagesForSource({ sourceMessageId: message.id })
      : Promise.resolve([]),
    message.related_message_id
      ? getEdielMessageById(message.related_message_id)
      : Promise.resolve(null),
    message.communication_route_id
      ? getEdielRouteRuntimeByCommunicationRouteId(message.communication_route_id)
      : Promise.resolve(null),
    message.direction === 'inbound'
      ? resolveInboundAcceptedVersionsRuntime({
          family: message.message_family,
          code: String(message.message_code),
          standard: message.message_standard,
          date: message.message_received_at?.slice(0, 10) ?? message.created_at.slice(0, 10),
        })
      : resolveOutboundMessageVersionRuntime({
          family: message.message_family,
          code: String(message.message_code),
          standard: message.message_standard,
          date: message.message_created_at?.slice(0, 10) ?? message.created_at.slice(0, 10),
          fallback: message.message_version,
          environment: message.environment,
        }),
  ])

  const canonicalAckState = getCanonicalAckState(ackState ?? message)
  const duplicateBlockEvents = getDuplicateBlockEvents(events)
  const ackConflictEvents = getAckConflictEvents(events)
  const issueEvents = getIssueEvents(events)
  const versionDiagnostics = getVersionDiagnostics(message.validation_report ?? {})
  const codeListDiagnostics = getCodeListDiagnostics(message.validation_report ?? {})
  const routeSummary = summarizeRouteRuntime(
    routeRuntime && typeof routeRuntime === 'object'
      ? (routeRuntime as Record<string, unknown>)
      : null
  )
  const prodatPortalReadiness = evaluateProdatPortalReadiness(message)
  const hasContrlDraft = relatedAckMessages.some((ack) => ack.message_family === 'CONTRL')
  const hasAperakDraft = relatedAckMessages.some((ack) => ack.message_family === 'APERAK')
  const hasUtiltsErrDraft = relatedAckMessages.some(isUtiltsErrAckMessage)
  const hasAnyUtiltsTgtResponse = hasContrlDraft || hasAperakDraft || hasUtiltsErrDraft

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title={`Ediel ${message.message_family} ${message.message_code}`}
        subtitle="Detaljvy för canonical kernel, versionsmotor, route-beslut, ack chain och dedupe-spår."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap gap-2">
                <Pill text={message.status} />
                <Pill text={message.direction} />
                <Pill text={message.environment} />
                <Pill text={message.message_standard} />
                <Pill text={String(canonicalAckState)} />
              </div>

              <h1 className="mt-4 text-2xl font-semibold text-slate-900">
                {message.message_family} {message.message_code}
              </h1>

              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <div>Version: {message.message_version ?? '—'}</div>
                <div>External ref: {message.external_reference ?? '—'}</div>
                <div>Transaction ref: {message.transaction_reference ?? '—'}</div>
                <div>Interchange ref: {message.interchange_reference ?? '—'}</div>
                <div>Application ref: {message.application_reference ?? '—'}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(message.status === 'draft' || message.status === 'queued' || message.status === 'prepared') &&
              message.direction === 'outbound' ? (
                <form action={sendEdielMessageAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <input type="hidden" name="edielMessageId" value={message.id} />
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                    AGT/TGT skickas okrypterat som application/EDIFACT base64
                  </div>
                  <button
                    type="submit"
                    className="mt-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Skicka okrypterat EDIFACT
                  </button>
                </form>
              ) : null}

              {message.direction === 'inbound' && message.message_family === 'UTILTS' ? (
                hasAnyUtiltsTgtResponse ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    CONTRL/APERAK/UTILTS-ERR finns redan för detta inbound-meddelande. Engine körs inte igen för att undvika dubbletter. Skicka befintliga svar nedan eller radera fel testomgång först.
                  </div>
                ) : (
                  <form action={processEdielOperationalMessageAction}>
                    <input type="hidden" name="edielMessageId" value={message.id} />
                    <button
                      type="submit"
                      className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                    >
                      Kör UTILTS engine / skapa TGT-svar
                    </button>
                  </form>
                )
              ) : null}

              {message.status !== 'cancelled' ? (
                <form action={cancelEdielMessageAction}>
                  <input type="hidden" name="edielMessageId" value={message.id} />
                  <input type="hidden" name="reason" value="Dold från meddelandedetalj för renare Ediel-testvy." />
                  <button
                    type="submit"
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700"
                  >
                    Dölj från arbetsvy
                  </button>
                </form>
              ) : null}

              <form action={deleteEdielMessageAction}>
                <input type="hidden" name="edielMessageId" value={message.id} />
                <button
                  type="submit"
                  className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                >
                  Radera meddelande + svar
                </button>
              </form>

              {message.direction === 'inbound' && message.message_family === 'UTILTS' ? (
                <form action={createNegativeUtiltsResponseAction} className="flex flex-col gap-2">
                  <input type="hidden" name="edielMessageId" value={message.id} />
                  <input
                    type="text"
                    name="messageText"
                    placeholder="Anledning för UTILTS_ERR"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    Skapa UTILTS_ERR
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        {prodatPortalReadiness.checked ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">PRODAT portal-readiness</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Intern kontroll innan du testar filen i Edielportalen. Portalen är fortfarande facit, men denna panel fångar vanliga fel innan uppladdning.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill text={prodatPortalReadiness.readyForInternalFileTest ? 'intern test OK' : 'blockerad internt'} />
                <Pill text={prodatPortalReadiness.readyForPortalTrial ? 'portal-ready' : 'behöver granskning'} />
                <Pill text={`${prodatPortalReadiness.segmentCount} segment`} />
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                {prodatPortalReadiness.issues.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    Inga blockerande eller varningsflaggor hittades i intern portal-check.
                  </div>
                ) : (
                  prodatPortalReadiness.issues.map((issue) => (
                    <div
                      key={issue.code}
                      className={`rounded-2xl border p-4 text-sm ${
                        issue.severity === 'error'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : issue.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      <div className="font-semibold">{issue.title}</div>
                      <div className="mt-1 text-xs">{issue.description}</div>
                    </div>
                  ))
                )}
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-900">Exportvänlig EDIFACT-visning</div>
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
                  {prodatPortalReadiness.formattedPayload ?? 'Saknar raw_payload'}
                </pre>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 xl:col-span-2">
            <h2 className="text-lg font-semibold text-slate-900">Kernel / ack state</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Canonical ack state
                </div>
                <div className="mt-2">
                  <Pill text={String(canonicalAckState)} />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Ack deadline</div>
                <div className="mt-2 text-sm text-slate-700">{formatDate(message.ack_due_at)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">CONTRL</div>
                <div className="mt-2">
                  <Pill text={message.contrl_status ?? '—'} />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">APERAK</div>
                <div className="mt-2">
                  <Pill text={message.aperak_status ?? '—'} />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">UTILTS_ERR</div>
                <div className="mt-2">
                  <Pill text={message.utilts_err_status ?? '—'} />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Checks</div>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <div>Syntax: {message.syntax_check_status ?? '—'}</div>
                  <div>Functional: {message.functional_check_status ?? '—'}</div>
                  <div>Kräver CONTRL: {message.requires_contrl ? 'Ja' : 'Nej'}</div>
                  <div>Kräver APERAK: {message.requires_aperak ? 'Ja' : 'Nej'}</div>
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Länkar / relationer</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div>Route ID: {message.communication_route_id ?? '—'}</div>
              <div>Related message: {message.related_message_id ?? '—'}</div>
              <div>Outbound request: {message.outbound_request_id ?? '—'}</div>
              <div>Switch request: {message.switch_request_id ?? '—'}</div>
              <div>Grid owner data request: {message.grid_owner_data_request_id ?? '—'}</div>
              {linkedMessage ? (
                <Link
                  href={`/admin/ediel/messages/${linkedMessage.id}`}
                  className="block underline-offset-2 hover:underline"
                >
                  Öppna relaterat meddelande
                </Link>
              ) : null}
            </div>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Version runtime</h2>
            <div className="mt-4">{renderVersionWindow(versionWindow)}</div>

            {(versionDiagnostics.acceptedInboundVersions.length > 0 ||
              versionDiagnostics.versionErrors.length > 0 ||
              versionDiagnostics.inboundVersionRejected) ? (
              <div className="mt-4 rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
                {versionDiagnostics.acceptedInboundVersions.length > 0 ? (
                  <>
                    <div>Validation report accepted versions:</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {versionDiagnostics.acceptedInboundVersions.map((version) => (
                        <Pill key={version} text={version} />
                      ))}
                    </div>
                    <div className="mt-2">
                      Accepted: {versionDiagnostics.inboundVersionAccepted ? 'Ja' : 'Nej'}
                    </div>
                    <div>
                      Check date: {versionDiagnostics.inboundVersionCheckDate ?? '—'}
                    </div>
                  </>
                ) : null}

                {versionDiagnostics.versionErrors.length > 0 ? (
                  <div className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">
                    <div className="font-medium">Version errors</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {versionDiagnostics.versionErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Route runtime</h2>
            {routeSummary.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {routeSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 text-sm text-slate-500">Ingen route runtime hittades.</div>
            )}
            {routeRuntime ? (
              <div className="mt-4">
                <JsonBlock value={routeRuntime} />
              </div>
            ) : null}
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Ack chain</h2>
            {relatedAckMessages.length === 0 ? (
              <div className="mt-4 text-sm text-slate-500">
                Inga relaterade ack-meddelanden hittades.
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {relatedAckMessages.map((ack) => (
                  <li key={ack.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill text={ack.message_family} />
                      <Pill text={ack.status} />
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <div>ID: {ack.id}</div>
                      <div>Outcome: {ack.ack_outcome ?? String(ack.parsed_payload?.ackOutcome ?? '—')}</div>
                      <div>Syntax: {ack.syntax_check_status ?? '—'}</div>
                      <div>Functional: {ack.functional_check_status ?? '—'}</div>
                      <div>Created: {formatDate(ack.created_at)}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/admin/ediel/messages/${ack.id}`}
                        className="inline-block text-sm text-slate-700 underline-offset-2 hover:underline"
                      >
                        Öppna ack-meddelande
                      </Link>
                      {ack.direction === 'outbound' && ['draft', 'queued', 'prepared'].includes(String(ack.status)) ? (
                        <form action={sendEdielMessageAction}>
                          <input type="hidden" name="edielMessageId" value={ack.id} />
                          <button
                            type="submit"
                            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                          >
                            Skicka till Edielportalen
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Kodlist-/valideringsdiagnostik</h2>
            {!codeListDiagnostics.hasIssues ? (
              <div className="mt-4 text-sm text-slate-500">
                Inga kodlistsignaler hittades i validation report.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {codeListDiagnostics.codeListErrors.length > 0 ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <div className="text-sm font-medium text-red-700">Code list errors</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
                      {codeListDiagnostics.codeListErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {codeListDiagnostics.codeValidationErrors.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-medium text-amber-700">
                      Code validation errors
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
                      {codeListDiagnostics.codeValidationErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {codeListDiagnostics.invalidCodes.length > 0 ? (
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-sm font-medium text-slate-700">Invalid codes</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {codeListDiagnostics.invalidCodes.map((code) => (
                        <Pill key={code} text={code} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Issue events / dedupe</h2>

          {issueEvents.length === 0 ? (
            <div className="mt-4 text-sm text-slate-500">
              Inga duplicate-blocks, ack-konflikter eller error-events hittades för detta meddelande.
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {issueEvents.map((event) => (
                <li key={event.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill text={event.event_status} />
                    {typeof event.payload?.dedupeLayer === 'string' ? (
                      <Pill text={event.payload.dedupeLayer} />
                    ) : null}
                    {event.payload?.ackConflict === true ? <Pill text="ack_conflict" /> : null}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <div>{event.message ?? 'Issue event'}</div>
                    <div>Skapad: {formatDate(event.created_at)}</div>
                  </div>
                  <div className="mt-3">
                    <JsonBlock value={event.payload} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(duplicateBlockEvents.length > 0 || ackConflictEvents.length > 0) && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Duplicate-block count
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {duplicateBlockEvents.length}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Ack-conflict count
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {ackConflictEvents.length}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-700">Alla events</h3>
            <JsonBlock value={events} />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Payload / reports</h2>
          <div className="mt-4 grid gap-6 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Raw payload</h3>
              <JsonBlock value={message.raw_payload} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Parsed payload</h3>
              <JsonBlock value={message.parsed_payload} />
            </div>
            <div className="xl:col-span-2">
              <h3 className="mb-2 text-sm font-medium text-slate-700">Validation report</h3>
              <JsonBlock value={message.validation_report} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
