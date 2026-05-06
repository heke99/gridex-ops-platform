import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { listEdielMessages } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  pollMailboxAction,
  processEdielOperationalMessageAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type SearchParams = {
  family?: string
  direction?: string
  status?: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function badgeClass(value: string | null | undefined): string {
  if (!value) return 'border-slate-200 bg-slate-50 text-slate-700'
  if (['validated', 'acknowledged', 'sent', 'received', 'parsed'].includes(value)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (['draft', 'prepared', 'queued'].includes(value)) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  if (['failed', 'cancelled'].includes(value)) {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ children, value }: { children: ReactNode; value?: string | null }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(value ?? String(children))}`}>
      {children}
    </span>
  )
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> {
  return getRecord(getRecord(value)[key])
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isSendableAck(message: EdielMessageRow): boolean {
  return (
    message.direction === 'outbound' &&
    ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(message.message_family) &&
    ['draft', 'queued', 'prepared'].includes(message.status)
  )
}

function isInboundUtiltsCandidate(message: EdielMessageRow): boolean {
  return (
    message.direction === 'inbound' &&
    message.message_family === 'UTILTS' &&
    ['S02', 'S03', 'E66', 'E30', 'E31'].includes(String(message.message_code)) &&
    ['received', 'parsed', 'validated', 'failed'].includes(message.status)
  )
}

function runtimeHint(message: EdielMessageRow): string {
  const validationReport = getRecord(message.validation_report)
  const utiltsRuntime = getNestedRecord(validationReport, 'utiltsRuntime')
  const ackPlan = getNestedRecord(utiltsRuntime, 'ackPlan')
  const validation = getNestedRecord(utiltsRuntime, 'validation')

  if (Object.keys(utiltsRuntime).length === 0) return 'runtime ej körd'

  const parts = [
    validation.ok === true ? 'validation OK' : getString(validation.issueType) ?? 'validation ej OK',
    ackPlan.shouldSendContrl === true ? `CONTRL ${getString(ackPlan.contrlOutcome) ?? ''}`.trim() : null,
    ackPlan.shouldSendAperak === true ? `APERAK ${getString(ackPlan.aperakOutcome) ?? ''}`.trim() : null,
    ackPlan.shouldSendUtiltsErr === true ? 'UTILTS-ERR' : null,
  ].filter(Boolean)

  return parts.join(' · ')
}

function messageReferences(message: EdielMessageRow): string {
  const parsed = getRecord(message.parsed_payload)
  const facts = getRecord(parsed.utiltsRuntimeFacts)
  const refs = [
    getString(facts.interchangeReference) ?? message.interchange_reference,
    getString(facts.documentReference) ?? message.external_reference,
    getString(facts.transactionReference) ?? getString(facts.transactionId) ?? message.transaction_reference,
  ].filter(Boolean)
  return refs.length > 0 ? refs.join(' / ') : '—'
}

function MessageCard({
  message,
  relatedAcks,
}: {
  message: EdielMessageRow
  relatedAcks: EdielMessageRow[]
}) {
  const isInboundUtilts = isInboundUtiltsCandidate(message)
  const sendable = isSendableAck(message)
  const meterPoint =
    getString(getRecord(message.parsed_payload).meteringPointId) ??
    getString(getRecord(message.parsed_payload).meterPointId) ??
    getString(getRecord(getRecord(message.parsed_payload).utiltsRuntimeFacts).meterPointId) ??
    '—'

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge value={message.direction}>{message.direction}</Badge>
            <Badge value={message.message_family}>{message.message_family}</Badge>
            <Badge value={message.status}>{message.status}</Badge>
          </div>
          <h2 className="mt-2 text-sm font-semibold text-slate-950">
            {message.message_family} {message.message_code}
          </h2>
          <div className="mt-1 break-all text-xs text-slate-500">{message.id}</div>
        </div>
        <Link
          href={`/admin/ediel/messages/${message.id}`}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Öppna detalj
        </Link>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
        <div>Skapad: {formatDate(message.created_at)}</div>
        <div>Mottagen/skickad: {formatDate(message.message_received_at ?? message.message_sent_at)}</div>
        <div>Sender → receiver: {message.sender_ediel_id ?? '—'} → {message.receiver_ediel_id ?? '—'}</div>
        <div>App ref: {message.application_reference ?? '—'}</div>
        <div>Referenser: {messageReferences(message)}</div>
        <div>Anläggning: {message.metering_point_id ?? meterPoint}</div>
      </div>

      {isInboundUtilts ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xs font-semibold text-emerald-900">UTILTS TGT-kandidat</div>
          <div className="mt-1 text-xs text-emerald-800">{runtimeHint(message)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={processEdielOperationalMessageAction}>
              <input type="hidden" name="edielMessageId" value={message.id} />
              <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                Kör engine / skapa TGT-svar
              </button>
            </form>
            <Link
              href={`/admin/ediel/messages/${message.id}`}
              className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
            >
              Se ack chain
            </Link>
          </div>
        </div>
      ) : null}

      {sendable ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-900">Redo att skickas till Edielportalen</div>
          <form action={sendEdielMessageAction} className="mt-3">
            <input type="hidden" name="edielMessageId" value={message.id} />
            <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
              Preflight + skicka
            </button>
          </form>
        </div>
      ) : null}

      {relatedAcks.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-900">Relaterade svar</div>
          <div className="mt-2 space-y-2">
            {relatedAcks.map((ack) => (
              <div key={ack.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{ack.message_family}</span>{' '}
                  <span className="text-slate-500">{ack.status} · {ack.ack_outcome ?? '—'}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/ediel/messages/${ack.id}`} className="text-indigo-700 underline-offset-2 hover:underline">
                    Öppna
                  </Link>
                  {isSendableAck(ack) ? (
                    <form action={sendEdielMessageAction}>
                      <input type="hidden" name="edielMessageId" value={ack.id} />
                      <button className="font-semibold text-slate-900 underline-offset-2 hover:underline">
                        Skicka
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  )
}

export default async function AdminEdielMessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const context = await requireAnyPermissionServer(['communication.read'])
  const params = await searchParams
  const family = params.family && params.family !== 'ALL' ? params.family : undefined
  const direction = params.direction === 'inbound' || params.direction === 'outbound' ? params.direction : undefined
  const status = params.status && params.status !== 'ALL' ? params.status : undefined

  const messages = await listEdielMessages({
    family,
    direction,
    status,
    limit: 200,
  })

  const relatedBySource = new Map<string, EdielMessageRow[]>()
  for (const row of messages) {
    if (row.related_message_id && ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family)) {
      const current = relatedBySource.get(row.related_message_id) ?? []
      current.push(row)
      relatedBySource.set(row.related_message_id, current)
    }
  }

  const inboundUtiltsCount = messages.filter(isInboundUtiltsCandidate).length
  const sendableAckCount = messages.filter(isSendableAck).length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel-meddelanden"
        subtitle="Hitta inkommande UTILTS, skapa TGT-svar och skicka CONTRL/APERAK/UTILTS-ERR från samma vy."
        userEmail={context.email}
      />

      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-emerald-950">Snabbflöde för U1.1.1 UTILTS-S02</h1>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                1) Starta testet i Edielportalen. 2) Hämta IMAP. 3) Öppna inbound UTILTS S02 här. 4) Kör engine/skapa TGT-svar. 5) Skicka CONTRL och APERAK från relaterade svar.
              </p>
            </div>
            <form action={pollMailboxAction}>
              <input type="hidden" name="limit" value="20" />
              <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
                Hämta IMAP nu
              </button>
            </form>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">Visade meddelanden</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{messages.length}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <div className="text-sm text-slate-500">Inbound UTILTS-kandidater</div>
            <div className="mt-2 text-3xl font-semibold text-emerald-700">{inboundUtiltsCount}</div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white p-4">
            <div className="text-sm text-slate-500">ACK redo att skickas</div>
            <div className="mt-2 text-3xl font-semibold text-amber-700">{sendableAckCount}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <form className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Family</label>
              <select name="family" defaultValue={family ?? 'ALL'} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="ALL">Alla</option>
                <option value="UTILTS">UTILTS</option>
                <option value="CONTRL">CONTRL</option>
                <option value="APERAK">APERAK</option>
                <option value="UTILTS_ERR">UTILTS_ERR</option>
                <option value="PRODAT">PRODAT</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Direction</label>
              <select name="direction" defaultValue={direction ?? 'ALL'} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="ALL">Alla</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
              <select name="status" defaultValue={status ?? 'ALL'} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="ALL">Alla</option>
                <option value="received">received</option>
                <option value="parsed">parsed</option>
                <option value="validated">validated</option>
                <option value="draft">draft</option>
                <option value="queued">queued</option>
                <option value="prepared">prepared</option>
                <option value="sent">sent</option>
                <option value="failed">failed</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Filtrera
              </button>
              <Link href="/admin/ediel/messages?family=UTILTS&direction=inbound" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                UTILTS inbound
              </Link>
            </div>
          </form>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {messages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
              Inga meddelanden hittades med valda filter.
            </div>
          ) : (
            messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                relatedAcks={relatedBySource.get(message.id) ?? []}
              />
            ))
          )}
        </section>
      </main>
    </div>
  )
}
