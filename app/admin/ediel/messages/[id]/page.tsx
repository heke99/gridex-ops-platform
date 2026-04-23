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
  createNegativeUtiltsResponseAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageEventRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function tone(kind: 'green' | 'yellow' | 'red' | 'blue' | 'slate'): string {
  if (kind === 'green') return 'bg-emerald-100 text-emerald-700'
  if (kind === 'yellow') return 'bg-amber-100 text-amber-700'
  if (kind === 'red') return 'bg-rose-100 text-rose-700'
  if (kind === 'blue') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-700'
}

function badgeTone(
  status: string | null | undefined
): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
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
    return 'green'
  }
  if (
    ['queued', 'prepared', 'pending', 'awaiting_contrl', 'awaiting_aperak', 'in_progress', 'warning'].includes(status)
  ) {
    return 'yellow'
  }
  if (
    ['failed', 'contrl_failed', 'ack_overdue', 'aperak_received_negative', 'error'].includes(status)
  ) {
    return 'red'
  }
  if (['sent', 'validated', 'parsed'].includes(status)) {
    return 'blue'
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
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function getDuplicateBlockEvents(events: EdielMessageEventRow[]): EdielMessageEventRow[] {
  return events.filter((event) => {
    const dedupeLayer =
      typeof event.payload?.dedupeLayer === 'string' ? event.payload.dedupeLayer : null
    if (dedupeLayer) return true
    return typeof event.message === 'string' && event.message.toLowerCase().includes('blockerad')
  })
}

function getVersionDiagnostics(validationReport: Record<string, unknown>) {
  const acceptedInboundVersions = asStringArray(validationReport.acceptedInboundVersions)
  const inboundVersionAccepted = validationReport.inboundVersionAccepted === true
  const inboundVersionCheckDate =
    typeof validationReport.inboundVersionCheckDate === 'string'
      ? validationReport.inboundVersionCheckDate
      : null

  return {
    acceptedInboundVersions,
    inboundVersionAccepted,
    inboundVersionCheckDate,
  }
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
    message.related_message_id ? getEdielMessageById(message.related_message_id) : Promise.resolve(null),
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
  const versionDiagnostics = getVersionDiagnostics(message.validation_report ?? {})

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
              {(message.status === 'queued' || message.status === 'prepared') &&
              message.direction === 'outbound' ? (
                <form action={sendEdielMessageAction}>
                  <input type="hidden" name="edielMessageId" value={message.id} />
                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Skicka nu
                  </button>
                </form>
              ) : null}

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
            <h2 className="text-lg font-semibold text-slate-900">Länkar</h2>
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Version runtime</h2>
          <div className="mt-4">{renderVersionWindow(versionWindow)}</div>

          {versionDiagnostics.acceptedInboundVersions.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
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
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Route runtime</h2>
            {routeRuntime ? <div className="mt-4"><JsonBlock value={routeRuntime} /></div> : (
              <div className="mt-4 text-sm text-slate-500">Ingen route runtime hittades.</div>
            )}
          </article>

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
                      <div>Syntax: {ack.syntax_check_status ?? '—'}</div>
                      <div>Functional: {ack.functional_check_status ?? '—'}</div>
                      <div>Created: {formatDate(ack.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Dedupe / events</h2>

          {duplicateBlockEvents.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-medium text-amber-800">
                Duplicate-block events
              </div>
              <ul className="mt-3 space-y-3">
                {duplicateBlockEvents.map((event) => (
                  <li key={event.id} className="rounded-xl bg-white p-3 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{event.message ?? 'Blockerad'}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(event.created_at)}
                    </div>
                    <div className="mt-2">
                      <JsonBlock value={event.payload} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4">
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