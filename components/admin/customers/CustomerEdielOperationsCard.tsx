import Link from 'next/link'
import type { CommunicationRouteRow, GridOwnerDataRequestRow } from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import EdielRouteIssueActions from '@/components/admin/ediel/EdielRouteIssueActions'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  pollMailboxAction,
  prepareSwitchZ03Action,
  prepareSwitchZ09Action,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import {
  getRecommendationSummary,
  type EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import type { EdielRouteProfileRow } from '@/lib/ediel/types'
import type { CustomerEdielMessageRow } from '@/lib/ediel/customerData'

type EdielMessageSummaryRow = CustomerEdielMessageRow

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
  communicationRoutes: CommunicationRouteRow[]
  routeProfiles: EdielRouteProfileRow[]
  edielMessages: EdielMessageSummaryRow[]
  recommendationRoutes: EdielRecommendationRouteRow[]
}

type EdielValidationIssue = {
  key: string
  label: string
  severity: 'error' | 'warning'
  resolution: string
}

type SwitchEdielLifecycle = {
  z03Outbound: EdielMessageSummaryRow | null
  z09Outbound: EdielMessageSummaryRow | null
  contrlMessages: EdielMessageSummaryRow[]
  aperakMessages: EdielMessageSummaryRow[]
  prodatResponses: EdielMessageSummaryRow[]
  latestInbound: EdielMessageSummaryRow | null
  latestFailure: EdielMessageSummaryRow | null
  lastEventAt: string | null
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

function buildSwitchEdielValidation(params: {
  route: CommunicationRouteRow | null
  senderEdielId: string
  receiverEdielId: string
  mailbox: string
  receiverEmail: string
  gridOwner: GridOwnerRow | null
}): EdielValidationIssue[] {
  const issues: EdielValidationIssue[] = []

  if (!params.route?.id) {
    issues.push({
      key: 'route',
      label: 'Ingen Ediel-route hittad',
      severity: 'error',
      resolution:
        'Skapa eller koppla en ediel_partner-route för denna nätägare i Ediel-routes.',
    })
  }

  if (!params.mailbox.trim()) {
    issues.push({
      key: 'mailbox',
      label: 'Mailbox saknas',
      severity: 'error',
      resolution: 'Fyll mailbox manuellt eller lägg in mailbox på routeprofilen.',
    })
  }

  if (!params.senderEdielId.trim()) {
    issues.push({
      key: 'sender',
      label: 'Gridex Ediel-id saknas',
      severity: 'error',
      resolution:
        'Fyll i Gridex Ediel-id manuellt eller lägg in det på routeprofilen.',
    })
  }

  if (!params.receiverEdielId.trim()) {
    issues.push({
      key: 'receiver',
      label: 'Mottagarens Ediel-id saknas',
      severity: 'error',
      resolution:
        'Fyll i nätägarens Ediel-id manuellt eller säkerställ att det finns på route eller nätägare.',
    })
  }

  if (!params.gridOwner?.ediel_id && !params.receiverEdielId.trim()) {
    issues.push({
      key: 'grid-owner-ediel',
      label: 'Nätägaren saknar Ediel-id',
      severity: 'warning',
      resolution:
        'Lägg gärna in nätägarens Ediel-id i masterdata så routefallback fungerar automatiskt.',
    })
  }

  if (!params.receiverEmail.trim()) {
    issues.push({
      key: 'receiver-email',
      label: 'Mottagarens e-post saknas',
      severity: 'warning',
      resolution:
        'Fyll i e-post manuellt om ditt testflöde eller route kräver det.',
    })
  }

  return issues
}

function buildMailboxValidation(params: {
  route: CommunicationRouteRow | null
  mailbox: string
}): EdielValidationIssue[] {
  const issues: EdielValidationIssue[] = []

  if (!params.route?.id) {
    issues.push({
      key: 'route',
      label: 'Ingen meter-values route hittad',
      severity: 'error',
      resolution:
        'Skapa eller koppla en ediel_partner-route för meter_values i Ediel-routes.',
    })
  }

  if (!params.mailbox.trim()) {
    issues.push({
      key: 'mailbox',
      label: 'Mailbox saknas',
      severity: 'error',
      resolution: 'Fyll mailbox manuellt eller lägg in mailbox på routeprofilen.',
    })
  }

  return issues
}

function hasBlockingIssues(issues: EdielValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

function messageActivityTime(message: EdielMessageSummaryRow): string {
  return message.message_received_at ?? message.created_at
}

function sortMessagesDesc(rows: EdielMessageSummaryRow[]): EdielMessageSummaryRow[] {
  return [...rows].sort(
    (a, b) =>
      new Date(messageActivityTime(b)).getTime() -
      new Date(messageActivityTime(a)).getTime()
  )
}

function buildSwitchLifecycle(
  requestId: string,
  edielMessages: EdielMessageSummaryRow[]
): SwitchEdielLifecycle {
  const rows = sortMessagesDesc(
    edielMessages.filter((message) => message.switch_request_id === requestId)
  )

  const z03Outbound =
    rows.find(
      (message) =>
        message.direction === 'outbound' &&
        message.message_family.toUpperCase() === 'PRODAT' &&
        message.message_code.toUpperCase() === 'Z03'
    ) ?? null

  const z09Outbound =
    rows.find(
      (message) =>
        message.direction === 'outbound' &&
        message.message_family.toUpperCase() === 'PRODAT' &&
        message.message_code.toUpperCase() === 'Z09'
    ) ?? null

  const contrlMessages = rows.filter(
    (message) => message.message_family.toUpperCase() === 'CONTRL'
  )

  const aperakMessages = rows.filter(
    (message) => message.message_family.toUpperCase() === 'APERAK'
  )

  const prodatResponses = rows.filter(
    (message) =>
      message.direction === 'inbound' &&
      message.message_family.toUpperCase() === 'PRODAT' &&
      ['Z04', 'Z05', 'Z06', 'Z10'].includes(message.message_code.toUpperCase())
  )

  const latestInbound =
    rows.find((message) => message.direction === 'inbound') ?? null

  const latestFailure =
    rows.find((message) =>
      ['failed', 'rejected', 'cancelled'].includes(message.status.toLowerCase())
    ) ?? null

  const lastEventAt = rows[0] ? messageActivityTime(rows[0]) : null

  return {
    z03Outbound,
    z09Outbound,
    contrlMessages,
    aperakMessages,
    prodatResponses,
    latestInbound,
    latestFailure,
    lastEventAt,
  }
}

export default async function CustomerEdielOperationsCard({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  switchRequests,
  dataRequests,
  communicationRoutes,
  routeProfiles,
  edielMessages,
  recommendationRoutes,
}: Props) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const latestSwitches = latestSwitchPerSite(sites, switchRequests)
  const openDataRequests = dataRequests
    .filter((row) => ['pending', 'sent', 'received'].includes(row.status))
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

  const routes = communicationRoutes
  const profileByRouteId = new Map(
    routeProfiles.map((profile) => [profile.communication_route_id, profile])
  )

  const recommendation = getRecommendationSummary({
    switchRequests,
    outboundRequests: [],
    messages: edielMessages,
    routes: recommendationRoutes,
    preferredFamily: 'PRODAT',
  })

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

      <div className="rounded-3xl border border-blue-200 bg-blue-50/70 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
        <div className="border-b border-blue-200 px-6 py-5 dark:border-blue-900/50">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Rekommenderat Ediel-nästa steg för kunden
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Detta räknas fram med samma rekommendationsmotor som i Ediel-center, men visas direkt på kundkortet så handläggaren slipper hoppa mellan vyer.
          </p>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-5">
          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Senaste switch
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.selectedSwitchId || '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Bästa route
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.recommendedRoute
                ? `${recommendation.recommendedRoute.route_name} (${recommendation.recommendedRoute.route_scope})${recommendation.recommendedRoute.grid_owner_name ? ` · ${recommendation.recommendedRoute.grid_owner_name}` : ''}`
                : '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Bästa outbound att skicka
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.recommendedSendMessage
                ? `${recommendation.recommendedSendMessage.message_family} ${recommendation.recommendedSendMessage.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.recommendedSendMessage?.id ?? 'Inget skickbart meddelande ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Bästa inbound UTILTS
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {recommendation.recommendedInboundUtilts
                ? `${recommendation.recommendedInboundUtilts.message_family} ${recommendation.recommendedInboundUtilts.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {recommendation.recommendedInboundUtilts?.id ?? 'Inget inbound UTILTS ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Route-hälsa
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recommendation.routeHealth.hasTargetEmail ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
                target email {recommendation.routeHealth.hasTargetEmail ? 'ok' : 'saknas'}
              </span>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recommendation.routeHealth.hasSenderEdielId ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}`}>
                sender {recommendation.routeHealth.hasSenderEdielId ? 'ok' : 'saknas'}
              </span>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recommendation.routeHealth.hasReceiverEdielId ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}`}>
                receiver {recommendation.routeHealth.hasReceiverEdielId ? 'ok' : 'saknas'}
              </span>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recommendation.routeHealth.hasMailbox ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}`}>
                mailbox {recommendation.routeHealth.hasMailbox ? 'ok' : 'saknas'}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:col-span-5">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Routebedömning
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {recommendation.routeSummary}
            </p>

            {recommendation.routeIssues.length > 0 ? (
              <div className="mt-3 space-y-2">
                {recommendation.routeIssues.map((issue) => (
                  <div
                    key={issue.key}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      issue.severity === 'error'
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
                    }`}
                  >
                    <div className="font-medium">{issue.label}</div>
                    <div className="mt-1 text-xs opacity-80">{issue.resolution}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4">
              <EdielRouteIssueActions
                route={recommendation.recommendedRoute}
                issues={recommendation.routeIssues}
                customerId={customerId}
              />
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
                const profile = route ? profileByRouteId.get(route.id) ?? null : null

                const autoRouteId = route?.id ?? ''
                const autoMailbox = profile?.mailbox ?? 'ediel@gridex.se'
                const autoSenderEdielId = profile?.sender_ediel_id ?? ''
                const autoReceiverEdielId =
                  profile?.receiver_ediel_id ?? gridOwner?.ediel_id ?? ''
                const autoReceiverEmail = route?.target_email ?? ''

                const validationIssues = buildSwitchEdielValidation({
                  route,
                  senderEdielId: autoSenderEdielId,
                  receiverEdielId: autoReceiverEdielId,
                  mailbox: autoMailbox,
                  receiverEmail: autoReceiverEmail,
                  gridOwner,
                })

                const blockingIssues = hasBlockingIssues(validationIssues)
                const lifecycle = buildSwitchLifecycle(request.id, edielMessages)

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
                      <Grid
                        label="Switch request"
                        value={request.id}
                        href={`/admin/operations/switches/${request.id}`}
                      />
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

                    <div className="mt-4">
                      <ValidationPanel
                        title="Validering före Z03/Z09"
                        issues={validationIssues}
                      />
                    </div>

                    <div className="mt-4">
                      <EdielLifecyclePanel lifecycle={lifecycle} />
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
                            placeholder="natagare@example.se"
                          />
                        </div>

                        <button
                          className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={blockingIssues}
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
                            placeholder="natagare@example.se"
                          />
                        </div>

                        <button
                          className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                          disabled={blockingIssues}
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
                  const profile = route ? profileByRouteId.get(route.id) ?? null : null

                  const autoRouteId = route?.id ?? ''
                  const autoMailbox = profile?.mailbox ?? 'INBOX'
                  const mailboxIssues = buildMailboxValidation({
                    route,
                    mailbox: autoMailbox,
                  })

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
                        <Grid
                          label="Request"
                          value={request.id}
                          href={`/admin/operations/grid-owner-requests/${request.id}`}
                        />
                        <Grid
                          label="Mätpunkt"
                          value={meteringPointName(request.metering_point_id, meteringPoints)}
                        />
                        <Grid label="Auto route" value={route?.route_name ?? '—'} />
                        <Grid label="Auto mailbox" value={autoMailbox} />
                      </div>

                      <div className="mt-4">
                        <ValidationPanel
                          title="Validering före mailbox poll"
                          issues={mailboxIssues}
                          compact
                        />
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
                          className="w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={hasBlockingIssues(mailboxIssues)}
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
                      <Grid
                        label="Switch request"
                        value={message.switch_request_id}
                        href={
                          message.switch_request_id
                            ? `/admin/operations/switches/${message.switch_request_id}`
                            : undefined
                        }
                      />
                      <Grid
                        label="Data request"
                        value={message.grid_owner_data_request_id}
                        href={
                          message.grid_owner_data_request_id
                            ? `/admin/operations/grid-owner-requests/${message.grid_owner_data_request_id}`
                            : undefined
                        }
                      />
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
                      Skapad {formatDateTime(message.created_at)} · inkommen{' '}
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
        {routeName
          ? `Automatiskt prefyllt från route: ${routeName}`
          : 'Ingen komplett Ediel-route hittad'}
      </div>
      <div className="mt-1 text-xs leading-5">
        Route-id: {routeId ?? '—'} · Mailbox: {mailbox ?? '—'}
        {!compact
          ? ` · Sender: ${senderEdielId ?? '—'} · Receiver: ${receiverEdielId ?? '—'}`
          : ''}
      </div>
      <div className="mt-2 text-xs leading-5">
        Fälten nedan är skrivbara för manuell testning. Lämnar du de prefyllda
        värdena används Ediel-konfigurationen automatiskt. Vill du ändra
        standardvärden permanent gör du det i{' '}
        <Link href="/admin/ediel/routes" className="underline">
          Ediel-routes
        </Link>
        .
      </div>
    </div>
  )
}

function ValidationPanel({
  title,
  issues,
  compact = false,
}: {
  title: string
  issues: EdielValidationIssue[]
  compact?: boolean
}) {
  if (issues.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-xs leading-5">
          Alla obligatoriska Ediel-värden finns. Du kan skapa utkast direkt eller skriva över manuellt.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
      <div className="font-medium">{title}</div>
      <div className="mt-2 space-y-2">
        {issues.map((issue) => (
          <div
            key={issue.key}
            className={`rounded-xl border px-3 py-2 ${
              issue.severity === 'error'
                ? 'border-rose-200 bg-white text-rose-800 dark:border-rose-900/50 dark:bg-slate-950/40 dark:text-rose-200'
                : 'border-amber-200 bg-white text-amber-900 dark:border-amber-900/50 dark:bg-slate-950/40 dark:text-amber-100'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  issue.severity === 'error'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                }`}
              >
                {issue.severity === 'error' ? 'Obligatoriskt' : 'Varning'}
              </span>
              <span className="font-medium">{issue.label}</span>
            </div>
            {!compact ? (
              <div className="mt-1 text-xs leading-5">{issue.resolution}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function EdielLifecyclePanel({
  lifecycle,
}: {
  lifecycle: SwitchEdielLifecycle
}) {
  const hasAnySignal =
    Boolean(lifecycle.z03Outbound) ||
    Boolean(lifecycle.z09Outbound) ||
    lifecycle.contrlMessages.length > 0 ||
    lifecycle.aperakMessages.length > 0 ||
    lifecycle.prodatResponses.length > 0

  return (
    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-sm font-semibold text-slate-900 dark:text-white">
        Ediel lifecycle för switchen
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Visar om utgående meddelanden skapats/skickats och om svar kommit tillbaka.
      </p>

      {!hasAnySignal ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Ingen Ediel-signal kopplad till denna switch ännu.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <LifecycleCard
              title="Z03 ut"
              message={lifecycle.z03Outbound}
              emptyLabel="Ingen Z03 ännu"
            />
            <LifecycleCard
              title="Z09 ut"
              message={lifecycle.z09Outbound}
              emptyLabel="Ingen Z09 ännu"
            />
            <LifecycleCountCard
              title="CONTRL"
              count={lifecycle.contrlMessages.length}
              messages={lifecycle.contrlMessages}
            />
            <LifecycleCountCard
              title="APERAK"
              count={lifecycle.aperakMessages.length}
              messages={lifecycle.aperakMessages}
            />
            <LifecycleCountCard
              title="PRODAT-svar"
              count={lifecycle.prodatResponses.length}
              messages={lifecycle.prodatResponses}
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Senaste Ediel-händelse
              </div>
              <div className="mt-1 text-sm text-slate-900 dark:text-white">
                {formatDateTime(lifecycle.lastEventAt)}
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Senaste inbound: {lifecycle.latestInbound ? `${lifecycle.latestInbound.message_family} ${lifecycle.latestInbound.message_code}` : '—'}
              </div>
            </div>
          </div>

          {lifecycle.latestFailure ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
              <div className="font-medium">Senaste fel i Ediel-kedjan</div>
              <div className="mt-1 text-xs leading-5">
                {lifecycle.latestFailure.message_family} {lifecycle.latestFailure.message_code} · status{' '}
                {lifecycle.latestFailure.status} · {formatDateTime(messageActivityTime(lifecycle.latestFailure))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function LifecycleCard({
  title,
  message,
  emptyLabel,
}: {
  title: string
  message: EdielMessageSummaryRow | null
  emptyLabel: string
}) {
  if (!message) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </div>
        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(message.status)}`}
        >
          {message.status}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {message.message_family} {message.message_code}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {formatDateTime(messageActivityTime(message))}
      </div>
    </div>
  )
}

function LifecycleCountCard({
  title,
  count,
  messages,
}: {
  title: string
  count: number
  messages: EdielMessageSummaryRow[]
}) {
  const latest = messages[0] ?? null

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
        {count}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Senaste: {latest ? `${latest.message_family} ${latest.message_code} · ${latest.status}` : '—'}
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
  href,
}: {
  label: string
  value: string | null | undefined
  href?: string
}) {
  const displayValue = value && value.length > 0 ? value : '—'

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900 dark:text-white">
        {href && value ? (
          <Link
            href={href}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
          >
            {displayValue}
          </Link>
        ) : (
          displayValue
        )}
      </div>
    </div>
  )
}