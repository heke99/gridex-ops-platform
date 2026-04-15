// components/admin/customers/CustomerEdielOperationsCard.tsx

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listCommunicationRoutes } from '@/lib/cis/db'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import type { CommunicationRouteRow, GridOwnerDataRequestRow } from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import {
  pollMailboxAction,
  prepareSwitchZ03Action,
  prepareSwitchZ09Action,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'

type EdielMessageSummaryRow = {
  id: string
  direction: 'inbound' | 'outbound'
  message_family: string
  message_code: string
  status: string
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  external_reference: string | null
  transaction_reference: string | null
  switch_request_id: string | null
  grid_owner_data_request_id: string | null
  communication_route_id: string | null
  related_message_id: string | null
  created_at: string
  sent_at: string | null
  message_received_at: string | null
}

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusTone(status: string | null | undefined): string {
  if (!status) {
    return 'bg-slate-100 text-slate-700'
  }

  if (
    ['validated', 'acknowledged', 'completed', 'accepted', 'sent'].includes(status)
  ) {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (['failed', 'cancelled', 'rejected'].includes(status)) {
    return 'bg-rose-100 text-rose-700'
  }

  if (['queued', 'prepared', 'received', 'parsed'].includes(status)) {
    return 'bg-amber-100 text-amber-700'
  }

  return 'bg-slate-100 text-slate-700'
}

function meteringPointName(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

function latestSwitchPerSite(
  sites: CustomerSiteRow[],
  requests: SupplierSwitchRequestRow[]
): SupplierSwitchRequestRow[] {
  return sites
    .map((site) =>
      requests
        .filter((request) => request.site_id === site.id)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0] ?? null
    )
    .filter((row): row is SupplierSwitchRequestRow => Boolean(row))
}

function gridOwnerForRequest(
  request: SupplierSwitchRequestRow,
  gridOwners: GridOwnerRow[]
): GridOwnerRow | null {
  if (!request.grid_owner_id) return null
  return gridOwners.find((row) => row.id === request.grid_owner_id) ?? null
}

function routeForGridOwner(
  routes: CommunicationRouteRow[],
  gridOwnerId: string | null,
  scope: 'supplier_switch' | 'meter_values'
): CommunicationRouteRow | null {
  const exact =
    routes.find(
      (route) =>
        route.route_scope === scope &&
        route.route_type === 'ediel_partner' &&
        route.grid_owner_id === gridOwnerId &&
        route.is_active
    ) ?? null

  if (exact) return exact

  return (
    routes.find(
      (route) =>
        route.route_scope === scope &&
        route.route_type === 'ediel_partner' &&
        route.grid_owner_id === null &&
        route.is_active
    ) ?? null
  )
}

export default async function CustomerEdielOperationsCard({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  switchRequests,
  dataRequests,
}: Props) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [routes, edielMessagesRaw] = await Promise.all([
    listCommunicationRoutes({
      routeType: 'ediel_partner',
    }),
    supabase
      .from('ediel_messages')
      .select(
        'id,direction,message_family,message_code,status,sender_ediel_id,receiver_ediel_id,external_reference,transaction_reference,switch_request_id,grid_owner_data_request_id,communication_route_id,related_message_id,created_at,sent_at,message_received_at'
      )
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (edielMessagesRaw.error) {
    throw edielMessagesRaw.error
  }

  const edielMessages = (edielMessagesRaw.data ?? []) as EdielMessageSummaryRow[]
  const latestSwitches = latestSwitchPerSite(sites, switchRequests)
  const openDataRequests = dataRequests
    .filter((row) => ['pending', 'sent', 'received'].includes(row.status))
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

  const routeProfiles = await Promise.all(
    routes.map((route) => getEdielRouteProfileByCommunicationRouteId(route.id))
  )
  const routeProfileMap = new Map(
    routeProfiles
      .filter(Boolean)
      .map((profile) => [profile!.communication_route_id, profile!])
  )

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Ediel operations
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Kör leverantörsbyte och mätvärdesflöden direkt från kundkortet med
                route, mailbox och senaste Ediel-händelser synliga här.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/ediel"
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Öppna Ediel-center
              </Link>
              <Link
                href="/admin/ediel/routes"
                className="rounded-2xl border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
              >
                Ediel-routes
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Senaste Ediel-meddelanden
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {edielMessages.length}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Switchar redo för Z03/Z09
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {latestSwitches.length}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Aktiva data requests
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {openDataRequests.length}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Ediel-routes för kunden
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {
                routes.filter((route) =>
                  sites.some((site) => site.grid_owner_id === route.grid_owner_id)
                ).length
              }
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Switch → Ediel
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Skapa Z03 och Z09 från riktiga switchärenden med rätt route och
              nätägarens Ediel-id.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {latestSwitches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga switchärenden finns ännu för kunden.
              </div>
            ) : (
              latestSwitches.map((request) => {
                const gridOwner = gridOwnerForRequest(request, gridOwners)
                const site = sites.find((row) => row.id === request.site_id) ?? null
                const meteringPoint =
                  meteringPoints.find((row) => row.id === request.metering_point_id) ??
                  null
                const route = routeForGridOwner(
                  routes,
                  request.grid_owner_id,
                  'supplier_switch'
                )
                const profile = route ? routeProfileMap.get(route.id) ?? null : null

                const autoRouteId = route?.id ?? ''
                const autoMailbox = profile?.mailbox ?? 'ediel@gridex.se'
                const autoSenderEdielId = profile?.sender_ediel_id ?? ''
                const autoReceiverEdielId =
                  profile?.receiver_ediel_id ?? gridOwner?.ediel_id ?? ''
                const autoReceiverEmail =
                  route?.target_email ?? gridOwner?.email ?? ''

                return (
                  <article
                    key={request.id}
                    className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {site?.site_name ?? request.site_id}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                          request.status
                        )}`}
                      >
                        {request.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {meteringPoint?.meter_point_id ?? request.metering_point_id}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <Grid label="Switch request" value={request.id} />
                      <Grid
                        label="Nätägare"
                        value={
                          gridOwner
                            ? `${gridOwner.name}${gridOwner.ediel_id ? ` (${gridOwner.ediel_id})` : ''}`
                            : request.grid_owner_id
                        }
                      />
                      <Grid label="Auto route" value={route?.route_name ?? '—'} />
                      <Grid label="Auto mailbox" value={autoMailbox} />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <form
                        action={prepareSwitchZ03Action}
                        className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                      >
                        <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
                        <input type="hidden" name="switchRequestId" value={request.id} />

                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Förbered Z03
                        </div>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Automatiskt prefyllt från vald Ediel-route. Du kan skriva över
                          manuellt här om self test kräver det.
                        </p>

                        <RoutePrefillNotice
                          routeId={autoRouteId || null}
                          routeName={route?.route_name ?? null}
                          mailbox={autoMailbox}
                          senderEdielId={autoSenderEdielId || null}
                          receiverEdielId={autoReceiverEdielId || null}
                        />

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <EditableField
                            label="Communication route-id"
                            name="communicationRouteId"
                            defaultValue={autoRouteId}
                            placeholder="Route-id"
                          />
                          <EditableField
                            label="Mailbox"
                            name="mailbox"
                            defaultValue={autoMailbox}
                            placeholder="ediel@gridex.se"
                            required
                          />
                          <EditableField
                            label="Gridex Ediel-id"
                            name="senderEdielId"
                            defaultValue={autoSenderEdielId}
                            placeholder="Gridex Ediel-id"
                            required
                          />
                          <EditableField
                            label="Nätägarens Ediel-id"
                            name="receiverEdielId"
                            defaultValue={autoReceiverEdielId}
                            placeholder="Nätägarens Ediel-id"
                            required
                          />
                          <EditableField
                            label="Mottagarens e-post"
                            name="receiverEmail"
                            defaultValue={autoReceiverEmail}
                            placeholder="nätägare@example.se"
                          />
                        </div>

                        <button
                          className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                          Skapa Z03-utkast
                        </button>
                      </form>

                      <form
                        action={prepareSwitchZ09Action}
                        className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                      >
                        <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
                        <input type="hidden" name="switchRequestId" value={request.id} />

                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Förbered Z09
                        </div>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Automatiskt prefyllt från vald Ediel-route. Du kan skriva över
                          manuellt här om scenariot kräver andra värden.
                        </p>

                        <RoutePrefillNotice
                          routeId={autoRouteId || null}
                          routeName={route?.route_name ?? null}
                          mailbox={autoMailbox}
                          senderEdielId={autoSenderEdielId || null}
                          receiverEdielId={autoReceiverEdielId || null}
                        />

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <EditableField
                            label="Communication route-id"
                            name="communicationRouteId"
                            defaultValue={autoRouteId}
                            placeholder="Route-id"
                          />
                          <EditableField
                            label="Mailbox"
                            name="mailbox"
                            defaultValue={autoMailbox}
                            placeholder="ediel@gridex.se"
                            required
                          />
                          <EditableField
                            label="Gridex Ediel-id"
                            name="senderEdielId"
                            defaultValue={autoSenderEdielId}
                            placeholder="Gridex Ediel-id"
                            required
                          />
                          <EditableField
                            label="Nätägarens Ediel-id"
                            name="receiverEdielId"
                            defaultValue={autoReceiverEdielId}
                            placeholder="Nätägarens Ediel-id"
                            required
                          />
                          <EditableField
                            label="Mottagarens e-post"
                            name="receiverEmail"
                            defaultValue={autoReceiverEmail}
                            placeholder="nätägare@example.se"
                          />
                        </div>

                        <button
                          className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Skapa Z09-utkast
                        </button>
                      </form>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Metering / mailbox
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Hämta UTILTS från mailboxen med rätt route mot nätägaren.
              </p>
            </div>

            <div className="space-y-4 p-6">
              {openDataRequests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga öppna data requests finns för kunden just nu.
                </div>
              ) : (
                openDataRequests.slice(0, 5).map((request) => {
                  const route = routeForGridOwner(
                    routes,
                    request.grid_owner_id,
                    'meter_values'
                  )
                  const profile = route ? routeProfileMap.get(route.id) ?? null : null

                  const autoRouteId = route?.id ?? ''
                  const autoMailbox = profile?.mailbox ?? 'INBOX'

                  return (
                    <article
                      key={request.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {request.request_scope}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                            request.status
                          )}`}
                        >
                          {request.status}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <Grid label="Request" value={request.id} />
                        <Grid
                          label="Mätpunkt"
                          value={meteringPointName(request.metering_point_id, meteringPoints)}
                        />
                        <Grid label="Auto route" value={route?.route_name ?? '—'} />
                        <Grid label="Auto mailbox" value={autoMailbox} />
                      </div>

                      <form action={pollMailboxAction} className="mt-4 space-y-4">
                        <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
                        <input type="hidden" name="limit" value="10" />

                        <RoutePrefillNotice
                          routeId={autoRouteId || null}
                          routeName={route?.route_name ?? null}
                          mailbox={autoMailbox}
                          senderEdielId={null}
                          receiverEdielId={null}
                          compact
                        />

                        <div className="grid gap-3 md:grid-cols-2">
                          <EditableField
                            label="Communication route-id"
                            name="communicationRouteId"
                            defaultValue={autoRouteId}
                            placeholder="Route-id"
                          />
                          <EditableField
                            label="Mailbox"
                            name="mailbox"
                            defaultValue={autoMailbox}
                            placeholder="INBOX"
                            required
                          />
                        </div>

                        <button
                          className="w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                          Poll mailbox för UTILTS
                        </button>
                      </form>
                    </article>
                  )
                })
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Senaste Ediel för kunden
              </h3>
            </div>

            <div className="space-y-4 p-6">
              {edielMessages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga Ediel-meddelanden ännu för kunden.
                </div>
              ) : (
                edielMessages.map((message) => (
                  <article
                    key={message.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {message.message_family} {message.message_code}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {message.direction}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                          message.status
                        )}`}
                      >
                        {message.status}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <Grid label="Message-id" value={message.id} />
                      <Grid label="External reference" value={message.external_reference} />
                      <Grid label="Sender" value={message.sender_ediel_id} />
                      <Grid label="Receiver" value={message.receiver_ediel_id} />
                      <Grid label="Switch request" value={message.switch_request_id} />
                      <Grid label="Data request" value={message.grid_owner_data_request_id} />
                    </div>

                    {message.direction === 'outbound' &&
                    ['draft', 'queued', 'prepared'].includes(message.status) ? (
                      <form action={sendEdielMessageAction} className="mt-4">
                        <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
                        <input type="hidden" name="edielMessageId" value={message.id} />
                        <button className="w-full rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                          Skicka detta meddelande nu
                        </button>
                      </form>
                    ) : null}

                    <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Skapad {formatDateTime(message.created_at)} · skickad{' '}
                      {formatDateTime(message.sent_at)} · inkommen{' '}
                      {formatDateTime(message.message_received_at)}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function RoutePrefillNotice({
  routeId,
  routeName,
  mailbox,
  senderEdielId,
  receiverEdielId,
  compact = false,
}: {
  routeId: string | null
  routeName: string | null
  mailbox: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  compact?: boolean
}) {
  const hasCoreIds = Boolean(senderEdielId && receiverEdielId)

  return (
    <div
      className={`rounded-2xl border px-3 py-3 text-sm ${
        hasCoreIds || compact
          ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200'
      }`}
    >
      <div className="font-medium">
        {routeName ? `Automatiskt prefyllt från route: ${routeName}` : 'Ingen komplett Ediel-route hittad'}
      </div>
      <div className="mt-1 text-xs leading-5">
        Route-id: {routeId ?? '—'} · Mailbox: {mailbox ?? '—'}
        {!compact ? ` · Sender: ${senderEdielId ?? '—'} · Receiver: ${receiverEdielId ?? '—'}` : ''}
      </div>
      <div className="mt-2 text-xs leading-5">
        Fälten nedan är skrivbara för manuell testning. Lämnar du de prefyllda värdena används Ediel-konfigurationen automatiskt. Vill du ändra standardvärden permanent gör du det i{' '}
        <Link href="/admin/ediel/routes" className="underline">
          Ediel-routes
        </Link>
        .
      </div>
    </div>
  )
}

function EditableField({
  label,
  name,
  defaultValue,
  placeholder,
  required = false,
}: {
  label: string
  name: string
  defaultValue: string
  placeholder: string
  required?: boolean
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

function Grid({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900 dark:text-white">
        {value && value.length > 0 ? value : '—'}
      </div>
    </div>
  )
}