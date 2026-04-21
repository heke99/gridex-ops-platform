// app/admin/ediel/messages/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  getEdielMessageById,
  listEdielMessageEvents,
} from '@/lib/ediel/db'
import { sendEdielMessageAction } from '@/app/admin/ediel/actions'
import type {
  EdielMessageEventRow,
  EdielMessageRow,
} from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

type CustomerRow = {
  id: string
  full_name: string | null
  company_name: string | null
  customer_number: string | null
}

type SiteRow = {
  id: string
  site_name: string | null
  status: string | null
}

type MeteringPointRow = {
  id: string
  meter_point_id: string | null
  metering_point_id: string | null
  status: string | null
}

type GridOwnerRow = {
  id: string
  name: string | null
  ediel_id: string | null
}

type RouteRow = {
  id: string
  route_name: string
  route_scope: string
  route_type: string
  target_system: string | null
  target_email: string | null
  is_active: boolean
}

type OutboundRow = {
  id: string
  status: string
  request_type: string
  source_type: string | null
  source_id: string | null
}

type SwitchRow = {
  id: string
  status: string
  request_type: string
  external_reference: string | null
}

type DataRequestRow = {
  id: string
  status: string
  request_scope: string
  external_reference: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value ?? '')
  }
}

function toneForStatus(
  status: string | null | undefined
): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
  if (status === 'acknowledged' || status === 'received' || status === 'parsed' || status === 'validated') {
    return 'green'
  }
  if (status === 'queued' || status === 'prepared' || status === 'draft' || status === 'pending') {
    return 'yellow'
  }
  if (status === 'failed' || status === 'cancelled' || status === 'rejected') {
    return 'red'
  }
  if (status === 'sent' || status === 'submitted') {
    return 'blue'
  }
  return 'slate'
}

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'yellow'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'red'
          ? 'bg-rose-100 text-rose-700'
          : tone === 'blue'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-700'

  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
}

function Field({
  label,
  value,
  href,
}: {
  label: string
  value: string | null | undefined
  href?: string
}) {
  const display = value && value.length > 0 ? value : '—'

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 break-all text-sm text-slate-900">
        {href && value ? (
          <Link href={href} className="text-indigo-700 underline-offset-2 hover:underline">
            {display}
          </Link>
        ) : (
          display
        )}
      </div>
    </div>
  )
}

export default async function AdminEdielMessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  const resolvedParams = await params
  const context = await requireAnyPermissionServer(['communication.read'])
  const supabase = await createSupabaseServerClient()

  const message = await getEdielMessageById(resolvedParams.id)
  if (!message) notFound()

  const [
    events,
    customerResult,
    siteResult,
    meteringPointResult,
    gridOwnerResult,
    routeResult,
    outboundResult,
    switchResult,
    dataRequestResult,
    relatedResult,
  ] = await Promise.all([
    listEdielMessageEvents(message.id),
    message.customer_id
      ? supabase
          .from('customers')
          .select('id, full_name, company_name, customer_number')
          .eq('id', message.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.site_id
      ? supabase
          .from('customer_sites')
          .select('id, site_name, status')
          .eq('id', message.site_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.metering_point_id
      ? supabase
          .from('metering_points')
          .select('id, meter_point_id, metering_point_id, status')
          .eq('id', message.metering_point_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.grid_owner_id
      ? supabase
          .from('grid_owners')
          .select('id, name, ediel_id')
          .eq('id', message.grid_owner_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.communication_route_id
      ? supabase
          .from('communication_routes')
          .select('id, route_name, route_scope, route_type, target_system, target_email, is_active')
          .eq('id', message.communication_route_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.outbound_request_id
      ? supabase
          .from('outbound_requests')
          .select('id, status, request_type, source_type, source_id')
          .eq('id', message.outbound_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.switch_request_id
      ? supabase
          .from('supplier_switch_requests')
          .select('id, status, request_type, external_reference')
          .eq('id', message.switch_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.grid_owner_data_request_id
      ? supabase
          .from('grid_owner_data_requests')
          .select('id, status, request_scope, external_reference')
          .eq('id', message.grid_owner_data_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.related_message_id
      ? supabase
          .from('ediel_messages')
          .select('id, direction, message_family, message_code, status, created_at')
          .eq('id', message.related_message_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (customerResult.error) throw customerResult.error
  if (siteResult.error) throw siteResult.error
  if (meteringPointResult.error) throw meteringPointResult.error
  if (gridOwnerResult.error) throw gridOwnerResult.error
  if (routeResult.error) throw routeResult.error
  if (outboundResult.error) throw outboundResult.error
  if (switchResult.error) throw switchResult.error
  if (dataRequestResult.error) throw dataRequestResult.error
  if (relatedResult.error) throw relatedResult.error

  const customer = (customerResult.data as CustomerRow | null) ?? null
  const site = (siteResult.data as SiteRow | null) ?? null
  const meteringPoint = (meteringPointResult.data as MeteringPointRow | null) ?? null
  const gridOwner = (gridOwnerResult.data as GridOwnerRow | null) ?? null
  const route = (routeResult.data as RouteRow | null) ?? null
  const outbound = (outboundResult.data as OutboundRow | null) ?? null
  const switchRequest = (switchResult.data as SwitchRow | null) ?? null
  const dataRequest = (dataRequestResult.data as DataRequestRow | null) ?? null
  const relatedMessage =
    (relatedResult.data as
      | {
          id: string
          direction: string
          message_family: string
          message_code: string
          status: string
          created_at: string
        }
      | null) ?? null

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title={`Ediel message ${message.message_family} ${message.message_code}`}
        subtitle="Detaljvy för payload, länkar, kvittenser, validering och händelser."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill text={message.direction} tone={message.direction === 'outbound' ? 'blue' : 'green'} />
              <Pill text={message.status} tone={toneForStatus(message.status)} />
              <Pill text={message.environment} tone={message.environment === 'production' ? 'red' : 'blue'} />
              <Pill text={message.message_family} tone="slate" />
              <Pill text={message.message_code} tone="yellow" />
            </div>

            {(message.status === 'queued' || message.status === 'prepared') ? (
              <form action={sendEdielMessageAction}>
                <input type="hidden" name="edielMessageId" value={message.id} />
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Skicka nu
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <Field label="Message ID" value={message.id} />
            <Field label="Version" value={message.message_version} />
            <Field label="Process" value={message.process_type} />
            <Field label="Subject" value={message.subject} />
            <Field label="External reference" value={message.external_reference} />
            <Field label="Transaction reference" value={message.transaction_reference} />
            <Field label="Correlation reference" value={message.correlation_reference} />
            <Field label="Interchange reference" value={message.interchange_reference} />
            <Field label="Mailbox" value={message.mailbox} />
            <Field label="Mailbox message ID" value={message.mailbox_message_id} />
            <Field label="File name" value={message.file_name} />
            <Field label="Mime type" value={message.mime_type} />
            <Field label="Sender Ediel ID" value={message.sender_ediel_id} />
            <Field label="Sender name" value={message.sender_name} />
            <Field label="Receiver Ediel ID" value={message.receiver_ediel_id} />
            <Field label="Receiver name" value={message.receiver_name} />
            <Field label="Created" value={formatDate(message.created_at)} />
            <Field label="Sent" value={formatDate(message.message_sent_at)} />
            <Field label="Received" value={formatDate(message.message_received_at)} />
            <Field label="Ack due" value={formatDate(message.ack_due_at)} />
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Kvittens och validering</h2>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Requires CONTRL" value={message.requires_contrl ? 'Ja' : 'Nej'} />
              <Field label="CONTRL status" value={message.contrl_status} />
              <Field label="Requires APERAK" value={message.requires_aperak ? 'Ja' : 'Nej'} />
              <Field label="APERAK status" value={message.aperak_status} />
              <Field label="UTILTS_ERR status" value={message.utilts_err_status} />
              <Field label="Syntax check" value={message.syntax_check_status} />
              <Field label="Functional check" value={message.functional_check_status} />
              <Field label="Failure reason" value={message.failure_reason} />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Kopplade objekt</h2>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field
                label="Customer"
                value={
                  customer
                    ? customer.company_name || customer.full_name || customer.customer_number || customer.id
                    : null
                }
                href={customer ? `/admin/customers/${customer.id}` : undefined}
              />
              <Field
                label="Site"
                value={site?.site_name ?? site?.id ?? null}
                href={customer && site ? `/admin/customers/${customer.id}` : undefined}
              />
              <Field
                label="Metering point"
                value={meteringPoint?.meter_point_id ?? meteringPoint?.metering_point_id ?? meteringPoint?.id ?? null}
                href={customer && meteringPoint ? `/admin/customers/${customer.id}` : undefined}
              />
              <Field label="Grid owner" value={gridOwner?.name ?? null} />
              <Field
                label="Route"
                value={route?.route_name ?? null}
                href={route ? '/admin/ediel/routes' : undefined}
              />
              <Field
                label="Outbound request"
                value={outbound?.id ?? null}
                href={outbound ? '/admin/outbound' : undefined}
              />
              <Field
                label="Switch request"
                value={switchRequest?.id ?? null}
                href={switchRequest ? `/admin/operations/switches/${switchRequest.id}` : undefined}
              />
              <Field
                label="Grid owner data request"
                value={dataRequest?.id ?? null}
                href={dataRequest ? `/admin/operations/grid-owner-requests/${dataRequest.id}` : undefined}
              />
              <Field
                label="Related message"
                value={
                  relatedMessage
                    ? `${relatedMessage.message_family} ${relatedMessage.message_code}`
                    : null
                }
                href={relatedMessage ? `/admin/ediel/messages/${relatedMessage.id}` : undefined}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Parsed payload</h2>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
              {prettyJson(message.parsed_payload)}
            </pre>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Validation report</h2>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
              {prettyJson(message.validation_report)}
            </pre>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Raw payload</h2>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100 whitespace-pre-wrap">
            {message.raw_payload ?? '—'}
          </pre>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Händelser</h2>

          <div className="mt-4 space-y-3">
            {(events as EdielMessageEventRow[]).length === 0 ? (
              <div className="text-sm text-slate-500">Inga events ännu.</div>
            ) : (
              (events as EdielMessageEventRow[]).map((event) => (
                <div key={event.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill text={event.event_type} tone="slate" />
                    <Pill text={event.event_status} tone={toneForStatus(event.event_status)} />
                    <span className="text-xs text-slate-500">
                      {formatDate(event.created_at)}
                    </span>
                  </div>

                  <div className="mt-3 text-sm text-slate-900">
                    {event.message ?? '—'}
                  </div>

                  <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                    {prettyJson(event.payload)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}