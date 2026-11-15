import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getEdielMessageById } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { gridexBusinessMessageLabel } from '@/lib/ediel/businessLabels'
import { formatAdminDateTime } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function statusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    draft: 'Utkast', queued: 'I kö', prepared: 'Förberett', sent: 'Skickat',
    received: 'Mottaget', awaiting_contrl: 'Väntar kvittens', awaiting_aperak: 'Väntar på mottagningsbesked',
    acknowledged: 'Mottagandet bekräftat', failed: 'Misslyckat', cancelled: 'Avbrutet',
    parsed: 'Inläst', validated: 'Kontrollerat',
  }
  return labels[String(status ?? '')] ?? 'Status behöver granskas'
}

function statusTone(status: string | null | undefined): string {
  const s = String(status ?? '')
  if (['sent', 'acknowledged', 'validated', 'received'].includes(s)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (['draft', 'queued', 'prepared', 'parsed', 'awaiting_contrl', 'awaiting_aperak'].includes(s)) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (['failed', 'cancelled'].includes(s)) return 'border-red-200 bg-red-50 text-red-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Pill({ text, tone }: { text: string; tone?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {text}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid min-w-0 gap-1 py-2 border-b border-slate-100 last:border-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-sm text-slate-800">{value ?? '—'}</span>
    </div>
  )
}

export default async function MessageDetailPage({ params }: Props) {
  const { id } = await params
  const access = await requireAdminPageKeyAccess('operations.tasks')
  const isPlatformAdmin = isPlatformAdminContext(access)
  const scope = await resolveAdminTenantReadScope(access)

  const message = await getEdielMessageById(id, { companyId: scope.companyId ?? undefined })
  if (!message || (!isPlatformAdmin && message.company_id !== scope.companyId)) notFound()

  // Fetch related customer if available
  type CustomerRow = { id: string; full_name?: string | null; customer_number?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }
  let customer: CustomerRow | null = null
  if (message.customer_id && message.company_id) {
    const { data } = await tenantSelect(message.company_id, 'customers', 'id,full_name,first_name,last_name,company_name,customer_number')
      .eq('id', message.customer_id)
      .maybeSingle()
    customer = data as CustomerRow | null
  }

  // Fetch related grid owner
  type GridOwnerRow = { id: string; name?: string | null }
  let gridOwner: GridOwnerRow | null = null
  if (message.grid_owner_id) {
    const { data } = await supabaseService
      .from('grid_owners')
      .select('id,name')
      .eq('id', message.grid_owner_id)
      .maybeSingle()
    gridOwner = data as GridOwnerRow | null
  }

  const customerLabel = customer
    ? (customer.company_name || customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.customer_number || 'Kunduppgifter saknas')
    : 'Kunduppgifter saknas'
  const messageLabel = gridexBusinessMessageLabel({ family: message.message_family, code: message.message_code }, isPlatformAdmin ? 'superadmin' : 'tenant')

  // Compute a plain-language status description for normal admins
  const nextAction = (() => {
    const s = String(message.status ?? '')
    if (s === 'draft') return 'Meddelandet är ett utkast och har inte skickats.'
    if (s === 'queued') return 'Meddelandet väntar i kö för utskick.'
    if (s === 'prepared') return 'Meddelandet är förberett. Väntar på godkänt utskick.'
    if (s === 'sent') return 'Meddelandet har skickats. Väntar på kvittens från mottagaren.'
    if (['awaiting_contrl', 'awaiting_aperak'].includes(s)) return 'Väntar på kvittens från nätägaren.'
    if (s === 'acknowledged') return 'Mottagandet har bekräftats. Kontrollera kundens ärende för att se om ett affärssvar återstår.'
    if (s === 'received') return 'Meddelandet har tagits emot.'
    if (s === 'failed') return 'Meddelandet kunde inte hanteras. Kontakta support om du behöver hjälp.'
    if (s === 'cancelled') return 'Meddelandet är avbrutet.'
    if (s === 'parsed') return 'Meddelandet har lästs in.'
    if (s === 'validated') return 'Meddelandets innehåll har kontrollerats.'
    return 'Meddelandets status behöver granskas.'
  })()

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title={messageLabel}
        subtitle="Meddelande"
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Back link */}
        <Link href="/admin/messages" className="text-sm text-emerald-700 hover:underline">
          ← Tillbaka till Meddelanden
        </Link>

        {/* Status summary */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Pill
              text={statusLabel(message.status)}
              tone={statusTone(message.status)}
            />
            <Pill
              text={message.direction === 'outbound' ? 'Utgående' : 'Inkommande'}
              tone={message.direction === 'outbound' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-purple-200 bg-purple-50 text-purple-700'}
            />
            {isPlatformAdmin ? <Pill text={messageLabel} /> : null}
          </div>

          {nextAction ? (
            <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {nextAction}
            </p>
          ) : null}
        </section>

        {/* Key information — visible to all admins */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Information</h2>
          <InfoRow label="Datum" value={formatAdminDateTime(message.message_sent_at ?? message.message_received_at ?? message.created_at)} />
          <InfoRow label="Kund" value={customerLabel ?? '—'} />
          <InfoRow label="Motpart (nätägare)" value={gridOwner?.name ?? 'Nätägaruppgifter saknas'} />
          {isPlatformAdmin && message.failure_reason ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span className="font-semibold">Felorsak: </span>{message.failure_reason}
            </div>
          ) : null}
        </section>

        {/* Customer link */}
        {customer ? (
          <Link
            href={`/admin/customers/${message.customer_id}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Öppna kundkort →
          </Link>
        ) : null}

        {/* Timeline for normal admins */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Tidslinje</h2>
          <div className="space-y-3">
            {message.created_at ? <div className="grid min-w-0 gap-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-slate-500">Skapat</span><span>{formatAdminDateTime(message.created_at)}</span></div> : null}
            {message.message_sent_at ? <div className="grid min-w-0 gap-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-slate-500">Skickat</span><span>{formatAdminDateTime(message.message_sent_at)}</span></div> : null}
            {message.message_received_at ? <div className="grid min-w-0 gap-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-slate-500">Mottaget</span><span>{formatAdminDateTime(message.message_received_at)}</span></div> : null}
            {message.acknowledged_at ? <div className="grid min-w-0 gap-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-slate-500">Mottagandet bekräftat</span><span>{formatAdminDateTime(message.acknowledged_at)}</span></div> : null}
            {message.failed_at ? <div className="grid min-w-0 gap-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-slate-500">Misslyckades</span><span>{formatAdminDateTime(message.failed_at)}</span></div> : null}
          </div>
        </section>

        {/* Technical details — platform admin only */}
        {isPlatformAdmin ? (
          <details className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              Tekniska detaljer (plattformsadministratör)
            </summary>
            <div className="mt-4 space-y-4">
              <InfoRow label="Avsändare Ediel-ID" value={message.sender_ediel_id} />
              <InfoRow label="Mottagare Ediel-ID" value={message.receiver_ediel_id} />
              <InfoRow label="Referens" value={message.external_reference ?? message.transaction_reference} />

              <div className="space-y-0 divide-y divide-slate-100">
                <InfoRow label="message_id" value={message.id} />
                <InfoRow label="outbound_request_id" value={message.outbound_request_id} />
                <InfoRow label="grid_owner_data_request_id" value={message.grid_owner_data_request_id} />
                <InfoRow label="communication_route_id" value={message.communication_route_id} />
                <InfoRow label="message_family" value={message.message_family} />
                <InfoRow label="message_code" value={message.message_code} />
                <InfoRow label="message_version" value={message.message_version} />
                <InfoRow label="environment" value={message.environment} />
                <InfoRow label="ack_status" value={message.ack_status} />
                <InfoRow label="contrl_status" value={message.contrl_status} />
                <InfoRow label="aperak_status" value={message.aperak_status} />
                <InfoRow label="interchange_reference" value={message.interchange_reference} />
                <InfoRow label="transaction_reference" value={message.transaction_reference} />
                <InfoRow label="company_id" value={message.company_id} />
              </div>

              {/* Validation report */}
              {message.validation_report && Object.keys(message.validation_report).length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-500">Valideringsrapport</p>
                  <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-green-300">
                    {JSON.stringify(message.validation_report, null, 2)}
                  </pre>
                </div>
              ) : null}

              {/* Raw EDIFACT payload */}
              {message.raw_payload ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-500">Rådata (EDIFACT)</p>
                  <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-green-300 whitespace-pre-wrap break-all">
                    {message.raw_payload}
                  </pre>
                </div>
              ) : null}

              {/* Parsed payload */}
              {message.parsed_payload && Object.keys(message.parsed_payload).length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-500">Tolkat innehåll</p>
                  <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-blue-200">
                    {JSON.stringify(message.parsed_payload, null, 2)}
                  </pre>
                </div>
              ) : null}

              {/* Links */}
              <div className="flex flex-wrap gap-3">
                {message.outbound_request_id ? (
                  <Link
                    href={`/admin/outbound?q=${message.outbound_request_id}`}
                    className="rounded-2xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Visa utskick
                  </Link>
                ) : null}
                <Link
                  href={`/admin/ediel/messages/${message.id}`}
                  className="rounded-2xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Öppna i Ediel-meddelandevy
                </Link>
              </div>
            </div>
          </details>
        ) : null}
      </main>
    </div>
  )
}
