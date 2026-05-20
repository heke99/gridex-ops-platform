import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listAckMessagesForSource, listEdielMessages } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
 deleteEdielMessageAction,
 pollMailboxAction,
 processEdielOperationalMessageAction,
 sendEdielMessageAction,
} from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type RowWithAcks = {
 message: EdielMessageRow
 ackMessages: EdielMessageRow[]
}

function firstParam(value: string | string[] | undefined): string | null {
 if (Array.isArray(value)) return value[0] ?? null
 return value ?? null
}

function asObject(value: unknown): Record<string, unknown> {
 return value && typeof value === 'object' && !Array.isArray(value)
 ? (value as Record<string, unknown>)
 : {}
}

function asString(value: unknown): string | null {
 return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function formatDate(value: string | null | undefined): string {
 if (!value) return '—'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return date.toLocaleString('sv-SE')
}

function statusTone(status: string | null | undefined): string {
 if (!status) return 'border-slate-200 bg-slate-50 text-slate-700'
 if (['sent', 'acknowledged', 'validated', 'received'].includes(status)) {
 return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 }
 if (['draft', 'queued', 'prepared', 'parsed', 'awaiting_contrl', 'awaiting_aperak'].includes(status)) {
 return 'border-amber-200 bg-amber-50 text-amber-700'
 }
 if (['failed', 'cancelled'].includes(status)) {
 return 'border-red-200 bg-red-50 text-red-700'
 }
 return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Pill({ text }: { text: string | null | undefined }) {
 const label = text && text.length > 0 ? text : '—'
 return (
 <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(label)}`}>
 {label}
 </span>
 )
}

function messageVersion(message: EdielMessageRow): string {
 if (message.message_version) return message.message_version
 const parsed = asObject(message.parsed_payload)
 const runtime = asObject(parsed.utiltsRuntimeFacts)
 return (
 asString(runtime.messageVersion) ??
 asString(asObject(parsed.normalizedMeteringPayload).messageVersion) ??
 'utan version'
 )
}

function transactionReference(message: EdielMessageRow): string {
 if (message.transaction_reference) return message.transaction_reference
 const parsed = asObject(message.parsed_payload)
 const runtime = asObject(parsed.utiltsRuntimeFacts)
 return (
 asString(runtime.transactionReference) ??
 asString(runtime.transactionId) ??
 asString(asObject(parsed.normalizedMeteringPayload).transactionReference) ??
 '—'
 )
}

function interchangeReference(message: EdielMessageRow): string {
 if (message.interchange_reference) return message.interchange_reference
 const parsed = asObject(message.parsed_payload)
 const runtime = asObject(parsed.utiltsRuntimeFacts)
 return (
 asString(runtime.interchangeReference) ??
 asString(asObject(parsed.normalizedMeteringPayload).interchangeReference) ??
 '—'
 )
}

function canSend(message: EdielMessageRow): boolean {
 return message.direction === 'outbound' && ['draft', 'queued', 'prepared'].includes(String(message.status))
}

function hasAckFamily(acks: EdielMessageRow[], family: string): boolean {
 return acks.some((ack) => ack.message_family === family)
}

function isUtiltsErrAck(ack: EdielMessageRow): boolean {
 return (
 String(ack.message_family) === 'UTILTS_ERR' ||
 (String(ack.message_family) === 'UTILTS' && String(ack.message_code).toUpperCase() === 'ERR')
 )
}

function isAckLikeMessage(message: EdielMessageRow): boolean {
 return (
 String(message.message_family) === 'CONTRL' ||
 String(message.message_family) === 'APERAK' ||
 String(message.message_family) === 'UTILTS_ERR' ||
 (String(message.message_family) === 'UTILTS' && String(message.message_code).toUpperCase() === 'ERR')
 )
}

function shouldShowAsOwnMessageCard(message: EdielMessageRow, explicitFamilyFilter: string | undefined): boolean {
 // In the normal message overview, generated ACK/response messages should be
 // shown on the source inbound card via related_message_id. This prevents one
 // inbound UTILTS/PRODAT from appearing as three separate cards after CONTRL
 // and APERAK are created. Direct ACK filters still show ACK messages for
 // troubleshooting.
 if (explicitFamilyFilter) return true
 if (message.related_message_id && isAckLikeMessage(message)) return false
 return true
}

export default async function AdminEdielMessagesPage({
 searchParams,
}: {
 searchParams?: Promise<SearchParams> | SearchParams
}) {
 const context = await requireAdminPageKeyAccess('ediel.workspace')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = isPlatformAdmin ? null : companyScope.companyId
 const resolvedSearchParams = searchParams ? await searchParams : {}
 const family = firstParam(resolvedSearchParams.family) ?? undefined
 const directionParam = firstParam(resolvedSearchParams.direction)
 const direction = directionParam === 'inbound' || directionParam === 'outbound' ? directionParam : undefined
 const status = firstParam(resolvedSearchParams.status) ?? undefined

 const messages = await listEdielMessages({
 family,
 direction,
 status,
 companyId,
 limit: 100,
 })

 const topLevelMessages = messages.filter((message) => shouldShowAsOwnMessageCard(message, family))

 const rows: RowWithAcks[] = await Promise.all(
 topLevelMessages.map(async (message) => ({
 message,
 ackMessages:
 message.direction === 'inbound'
 ? await listAckMessagesForSource({ sourceMessageId: message.id, companyId })
 : [],
 }))
 )

 return (
 <div className="min-h-screen bg-slate-50">
 <AdminHeader
 title="Ediel meddelanden"
 subtitle="Inbox, outbox, payload och ACK-kedjor. Fokus på att svara korrekt utan att röra engine-reglerna."
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <main className="space-y-6 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h1 className="text-xl font-semibold text-slate-900">Meddelandevy</h1>
 <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
 Hämta IMAP, öppna rätt inbound PRODAT/UTILTS och skapa svar från samma kort. CONTRL, APERAK och UTILTS_ERR visas kopplade till källmeddelandet så testkedjan blir lätt att följa.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <form action={pollMailboxAction}>
 <button
 type="submit"
 className="rounded-2xl bg-white border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
 >
 Hämta IMAP nu
 </button>
 </form>
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-2 text-sm">
 <Link href="/admin/ediel/messages" className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50">Alla</Link>
 <Link href="/admin/ediel/messages?family=PRODAT&direction=inbound" className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Inbound PRODAT</Link>
 <Link href="/admin/ediel/messages?family=UTILTS&direction=inbound" className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Inbound UTILTS</Link>
 <Link href="/admin/ediel/messages?direction=outbound&status=draft" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">Outbound drafts</Link>
 <Link href="/admin/ediel/messages?status=failed" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">Felade</Link>
 <Link href="/admin/ediel/messages?family=CONTRL" className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50">CONTRL</Link>
 <Link href="/admin/ediel/messages?family=APERAK" className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50">APERAK</Link>
 </div>
 </section>

 <section className="space-y-3">
 {rows.length === 0 ? (
 <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
 Inga Ediel-meddelanden hittades för filtret.
 </div>
 ) : (
 rows.map(({ message, ackMessages }) => {
 const isInboundUtilts = message.direction === 'inbound' && message.message_family === 'UTILTS'
 const hasContrl = hasAckFamily(ackMessages, 'CONTRL')
 const hasAperak = hasAckFamily(ackMessages, 'APERAK')
 const hasUtiltsErr = ackMessages.some(isUtiltsErrAck)
 const hasTgtResponse = hasContrl || hasAperak || hasUtiltsErr

 return (
 <article key={message.id} className="rounded-3xl border border-slate-200 bg-white p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div className="min-w-0 flex-1">
 <div className="text-xs text-slate-700">{formatDate(message.created_at)}</div>
 <div className="mt-2 flex flex-wrap items-center gap-2">
 <span className="text-lg font-semibold text-slate-900">
 {message.message_family} {message.message_code}
 </span>
 <Pill text={messageVersion(message)} />
 <Pill text={message.application_reference} />
 <Pill text={message.direction} />
 <Pill text={message.status} />
 </div>

 {isInboundUtilts ? (
 <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
 Inbound UTILTS: {hasTgtResponse ? 'Svar finns redan. Skicka befintlig CONTRL/APERAK/UTILTS_ERR nedan.' : 'Öppna eller kör engine från kortet för att skapa svar.'}
 </div>
 ) : null}

 <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
 <div>External: <span className="break-all font-medium text-slate-800">{message.external_reference ?? '—'}</span></div>
 <div>Transaction: <span className="break-all font-medium text-slate-800">{transactionReference(message)}</span></div>
 <div>Interchange: <span className="break-all font-medium text-slate-800">{interchangeReference(message)}</span></div>
 </div>

 {ackMessages.length > 0 ? (
 <div className="mt-4 flex flex-wrap gap-3">
 {ackMessages.map((ack) => (
 <div key={ack.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
 <div className="flex flex-wrap gap-2">
 <Pill text={`${ack.message_family} ${ack.message_code}`} />
 <Pill text={ack.status} />
 </div>
 <div className="mt-2 flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${ack.id}`} className="text-xs font-semibold text-slate-700 underline-offset-2 hover:underline">
 Öppna
 </Link>
 {canSend(ack) ? (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={ack.id} />
 <button type="submit" className="text-xs font-semibold text-emerald-700 hover:underline">
 Skicka
 </button>
 </form>
 ) : null}
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="mt-3 text-sm text-slate-700">Inga relaterade svar ännu.</div>
 )}
 </div>

 <div className="flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Öppna
 </Link>

 {isInboundUtilts && !hasTgtResponse ? (
 <form action={processEdielOperationalMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button type="submit" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
 Kör engine / skapa svar
 </button>
 </form>
 ) : null}

 {canSend(message) ? (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button type="submit" className="rounded-2xl bg-white border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
 Skicka
 </button>
 </form>
 ) : null}

 <form action={deleteEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button type="submit" className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">
 Radera
 </button>
 </form>
 </div>
 </div>
 </article>
 )
 })
 )}
 </section>
 </main>
 </div>
 )
}
