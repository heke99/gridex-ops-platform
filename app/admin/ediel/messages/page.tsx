import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import { listAckMessagesForSource, listEdielMessages } from '@/lib/ediel/db'
import {
  deleteAllEdielMessagesAction,
  deleteEdielMessageAction,
  pollMailboxAction,
  processEdielOperationalMessageAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

type SearchParams = {
  family?: string
  direction?: string
  status?: string
}

type Tone = 'slate' | 'green' | 'yellow' | 'red' | 'blue' | 'purple'

function toneClass(tone: Tone): string {
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (tone === 'yellow') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'red') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (tone === 'purple') return 'border-purple-200 bg-purple-50 text-purple-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass(tone)}`}>
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

function directionTone(direction: string): Tone {
  if (direction === 'inbound') return 'blue'
  if (direction === 'outbound') return 'purple'
  return 'slate'
}

function statusTone(status: string): Tone {
  if (['sent', 'received', 'acknowledged', 'validated', 'parsed'].includes(status)) return 'green'
  if (['queued', 'prepared', 'pending', 'draft'].includes(status)) return 'yellow'
  if (['failed', 'cancelled', 'rejected'].includes(status)) return 'red'
  return 'slate'
}

function ackTone(state: string): Tone {
  if (state.includes('accepted') || state.includes('acknowledged') || state.includes('completed')) return 'green'
  if (state.includes('awaiting') || state.includes('pending')) return 'yellow'
  if (state.includes('rejected') || state.includes('failed') || state.includes('overdue')) return 'red'
  return 'slate'
}

function isUtiltsInbound(message: EdielMessageRow): boolean {
  return message.direction === 'inbound' && message.message_family === 'UTILTS'
}

function isSendable(message: EdielMessageRow): boolean {
  return message.direction === 'outbound' && ['queued', 'prepared'].includes(String(message.status))
}

async function getAckMap(messages: EdielMessageRow[]): Promise<Map<string, EdielMessageRow[]>> {
  const inboundMessages = messages.filter((message) => message.direction === 'inbound')
  const pairs = await Promise.all(
    inboundMessages.map(async (message) => {
      const ackMessages = await listAckMessagesForSource({ sourceMessageId: message.id })
      return [message.id, ackMessages] as const
    }),
  )

  return new Map(pairs)
}

function filterHref(params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const suffix = query.toString()
  return suffix ? `/admin/ediel/messages?${suffix}` : '/admin/ediel/messages'
}

export default async function AdminEdielMessagesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams
}) {
  const context = await requireAnyPermissionServer([
    'communication.read',
    'communication.write',
  ])
  const resolvedSearchParams = await searchParams
  const family = typeof resolvedSearchParams?.family === 'string' ? resolvedSearchParams.family : undefined
  const status = typeof resolvedSearchParams?.status === 'string' ? resolvedSearchParams.status : undefined
  const directionRaw = typeof resolvedSearchParams?.direction === 'string' ? resolvedSearchParams.direction : undefined
  const direction = directionRaw === 'inbound' || directionRaw === 'outbound' ? directionRaw : undefined

  const messages = await listEdielMessages({
    family: family || undefined,
    direction,
    status: status || undefined,
    limit: 250,
  })
  const ackMap = await getAckMap(messages)

  const inboundUtiltsCount = messages.filter(isUtiltsInbound).length
  const outboundReadyCount = messages.filter(isSendable).length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel meddelanden"
        subtitle="Enkel lista för inbound, TGT-svar, skick och radering. Använd denna vy när du testar UTILTS/PRODAT mot Edielportalen."
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Meddelanden</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Öppna inbound UTILTS, kör engine för att skapa CONTRL/APERAK/UTILTS-ERR och skicka sedan svaren till portalen. Radering här är hård radering från Ediel-testvyn.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="blue">{messages.length} visas</Badge>
                <Badge tone="green">{inboundUtiltsCount} inbound UTILTS</Badge>
                <Badge tone="yellow">{outboundReadyCount} redo att skickas</Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <form action={pollMailboxAction}>
                <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  Hämta IMAP nu
                </button>
              </form>
              <form action={deleteAllEdielMessagesAction}>
                <button className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100">
                  Radera alla meddelanden
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" href="/admin/ediel/messages">
              Alla
            </Link>
            <Link className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100" href={filterHref({ family: 'UTILTS', direction: 'inbound' })}>
              Inbound UTILTS
            </Link>
            <Link className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-800 hover:bg-purple-100" href={filterHref({ direction: 'outbound' })}>
              Outbound
            </Link>
            <Link className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100" href={filterHref({ status: 'queued' })}>
              Queued
            </Link>
            <Link className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100" href={filterHref({ status: 'prepared' })}>
              Prepared
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tid</th>
                  <th className="px-4 py-3">Meddelande</th>
                  <th className="px-4 py-3">Riktning/status</th>
                  <th className="px-4 py-3">Referenser</th>
                  <th className="px-4 py-3">Relaterade svar</th>
                  <th className="px-4 py-3">Knappar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      Inga Ediel-meddelanden hittades.
                    </td>
                  </tr>
                ) : (
                  messages.map((message) => {
                    const ackMessages = ackMap.get(message.id) ?? []
                    const ackState = String(getCanonicalAckState(message))
                    return (
                      <tr key={message.id} className="align-top hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                          {formatDateTime(message.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {message.message_family} {message.message_code}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {message.message_version ?? 'utan version'} · {message.application_reference ?? 'utan app-ref'}
                          </div>
                          {isUtiltsInbound(message) ? (
                            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                              Inbound UTILTS: öppna eller kör engine för TGT-svar.
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={directionTone(message.direction)}>{message.direction}</Badge>
                            <Badge tone={statusTone(message.status)}>{message.status}</Badge>
                            <Badge tone={ackTone(ackState)}>{ackState}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div>External: {message.external_reference ?? '—'}</div>
                          <div>Transaction: {message.transaction_reference ?? '—'}</div>
                          <div>Interchange: {message.interchange_reference ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          {ackMessages.length === 0 ? (
                            <div className="text-xs text-slate-500">Inga relaterade svar ännu.</div>
                          ) : (
                            <div className="space-y-2">
                              {ackMessages.map((ack) => (
                                <div key={ack.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone="slate">{ack.message_family} {ack.message_code}</Badge>
                                    <Badge tone={statusTone(ack.status)}>{ack.status}</Badge>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Link href={`/admin/ediel/messages/${ack.id}`} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                      Öppna
                                    </Link>
                                    {isSendable(ack) ? (
                                      <form action={sendEdielMessageAction}>
                                        <input type="hidden" name="edielMessageId" value={ack.id} />
                                        <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">
                                          Skicka
                                        </button>
                                      </form>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Öppna
                            </Link>
                            {isUtiltsInbound(message) ? (
                              <form action={processEdielOperationalMessageAction}>
                                <input type="hidden" name="edielMessageId" value={message.id} />
                                <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                                  Kör engine / skapa TGT-svar
                                </button>
                              </form>
                            ) : null}
                            {isSendable(message) ? (
                              <form action={sendEdielMessageAction}>
                                <input type="hidden" name="edielMessageId" value={message.id} />
                                <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                                  Skicka
                                </button>
                              </form>
                            ) : null}
                            <form action={deleteEdielMessageAction}>
                              <input type="hidden" name="edielMessageId" value={message.id} />
                              <button className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100">
                                Radera
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
