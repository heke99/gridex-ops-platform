import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import EdielWorkbench from '@/components/admin/ediel/EdielWorkbench'
import EdielRouteIssueActions from '@/components/admin/ediel/EdielRouteIssueActions'
import EdielFileEnginePanel from '@/components/admin/ediel/EdielFileEnginePanel'
import EdielTgtWorkbenchPanel from '@/components/admin/ediel/EdielTgtWorkbenchPanel'
import EdielOperationalBridgePanel from '@/components/admin/ediel/EdielOperationalBridgePanel'
import EdielOperationalVerificationPanel from '@/components/admin/ediel/EdielOperationalVerificationPanel'
import EdielSafeApplyReviewPanel from '@/components/admin/ediel/EdielSafeApplyReviewPanel'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import {
  getEdielRouteProfileByCommunicationRouteId,
  listCanonicalAckConflictEvents,
  listCanonicalDuplicateBlockEvents,
  listDuplicateAckCandidates,
  listEdielMessages,
  listEdielTestRuns,
  listOverdueAckMessages,
  listRecentInvalidCodeUsageMessages,
  listRecentVersionMismatchMessages,
  listRuleAmbiguities,
} from '@/lib/ediel/db'
import {
  createEdielTestRunAction,
  registerInboundUtiltsAction,
  runEdielSelfTestAction,
} from '@/app/admin/ediel/actions'
import {
  getRecommendationSummary,
  type EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  ACTIVE_EDIEL_TEST_SUITES,
  isActiveEdielMessageFamily,
  isActiveEdielTestSuite,
} from '@/lib/ediel/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listSafeApplyReviewItems, listUtiltsBillingReviewItems } from '@/lib/ediel/safeApplyReview'

export const dynamic = 'force-dynamic'

type SimpleSwitchRequestRow = {
  id: string
  status: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleDataRequestRow = {
  id: string
  status: string
  request_scope: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleOutboundRow = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
  channel_type: string | null
  communication_route_id: string | null
  external_reference: string | null
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  created_at: string
}

type SimpleCommunicationRouteRow = {
  id: string
  route_name: string
  is_active: boolean
  route_scope: string
  route_type: string
  grid_owner_id: string | null
  target_system: string | null
  target_email: string | null
}

type SimpleGridOwnerRow = {
  id: string
  name: string
  ediel_id: string | null
}

function isEdielCandidateRoute(route: SimpleCommunicationRouteRow): boolean {
  if (route.route_type === 'ediel_partner') return true
  if (route.target_system?.toLowerCase().includes('ediel')) return true
  if (route.target_email?.toLowerCase().includes('ediel')) return true
  return false
}

function Cell({
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
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900">
        {href && value ? (
          <Link
            href={href}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'yellow'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : tone === 'red'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : tone === 'blue'
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-slate-50 text-slate-700 border-slate-200'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  )
}

function getOutboundStatusTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'acknowledged') return 'green'
  if (status === 'sent' || status === 'prepared') return 'blue'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'queued') return 'yellow'
  return 'slate'
}

function getRouteTone(routeId: string | null | undefined): 'green' | 'red' {
  return routeId ? 'green' : 'red'
}

function getMessageTone(
  direction: string | null | undefined
): 'blue' | 'green' | 'slate' {
  if (direction === 'outbound') return 'blue'
  if (direction === 'inbound') return 'green'
  return 'slate'
}

function getRequestTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'completed' || status === 'received' || status === 'accepted') {
    return 'green'
  }
  if (status === 'submitted' || status === 'sent') return 'blue'
  if (status === 'failed' || status === 'cancelled' || status === 'rejected') {
    return 'red'
  }
  if (status === 'queued' || status === 'pending' || status === 'draft') {
    return 'yellow'
  }
  return 'slate'
}

function findMessagesForOutbound(
  messages: Awaited<ReturnType<typeof listEdielMessages>>,
  outboundRequestId: string
) {
  return messages.filter((row) => row.outbound_request_id === outboundRequestId)
}

function routeLabel(route: EdielRecommendationRouteRow | null): string {
  if (!route) return '—'
  return `${route.route_name} (${route.route_scope})${
    route.grid_owner_name ? ` · ${route.grid_owner_name}` : ''
  }`
}

function ackStateTone(state: string): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (
    state === 'ack_overdue' ||
    state === 'contrl_failed' ||
    state === 'aperak_received_negative'
  ) {
    return 'red'
  }
  if (state === 'awaiting_contrl' || state === 'awaiting_aperak' || state === 'in_progress') {
    return 'yellow'
  }
  if (
    state === 'contrl_received' ||
    state === 'aperak_received_positive' ||
    state === 'utilts_err_received' ||
    state === 'no_ack_required'
  ) {
    return 'green'
  }
  return 'slate'
}

export default async function AdminEdielPage() {
  await requirePermissionServer('communication.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [
    messagesRaw,
    testRunsRaw,
    switchRequestsRaw,
    dataRequestsRaw,
    outboundRaw,
    routesRaw,
    gridOwnersRaw,
    overdueAckMessages,
    duplicateAckCandidates,
    duplicateBlockEvents,
    ackConflictEvents,
    versionMismatchMessages,
    invalidCodeMessages,
    ruleAmbiguities,
  ] = await Promise.all([
    listEdielMessages({ limit: 120 }),
    listEdielTestRuns(),
    supabase
      .from('supplier_switch_requests')
      .select(
        'id,status,customer_id,site_id,metering_point_id,external_reference,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('grid_owner_data_requests')
      .select(
        'id,status,request_scope,customer_id,site_id,metering_point_id,external_reference,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('outbound_requests')
      .select(
        'id,request_type,source_type,source_id,status,channel_type,communication_route_id,external_reference,customer_id,site_id,metering_point_id,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('communication_routes')
      .select(
        'id,route_name,is_active,route_scope,route_type,grid_owner_id,target_system,target_email'
      )
      .order('updated_at', { ascending: false }),
    supabase.from('grid_owners').select('id,name,ediel_id').order('name'),
    listOverdueAckMessages({ limit: 20 }),
    listDuplicateAckCandidates(),
    listCanonicalDuplicateBlockEvents({ limit: 20 }),
    listCanonicalAckConflictEvents({ limit: 20 }),
    listRecentVersionMismatchMessages({ limit: 20 }),
    listRecentInvalidCodeUsageMessages({ limit: 20 }),
    listRuleAmbiguities(),
  ])

  if (switchRequestsRaw.error) throw switchRequestsRaw.error
  if (dataRequestsRaw.error) throw dataRequestsRaw.error
  if (outboundRaw.error) throw outboundRaw.error
  if (routesRaw.error) throw routesRaw.error
  if (gridOwnersRaw.error) throw gridOwnersRaw.error

  const switchRequests = (switchRequestsRaw.data ?? []) as SimpleSwitchRequestRow[]
  const dataRequests = (dataRequestsRaw.data ?? []) as SimpleDataRequestRow[]
  const outboundRequests = (outboundRaw.data ?? []) as SimpleOutboundRow[]
  const allRoutes = (routesRaw.data ?? []) as SimpleCommunicationRouteRow[]
  const gridOwners = (gridOwnersRaw.data ?? []) as SimpleGridOwnerRow[]

  const messages = messagesRaw.filter((row) => isActiveEdielMessageFamily(row.message_family))
  const hiddenMessagesCount = messagesRaw.length - messages.length

  const testRuns = testRunsRaw.filter((row) => isActiveEdielTestSuite(row.test_suite))
  const hiddenTestRunsCount = testRunsRaw.length - testRuns.length
  const safeApplyReviewItems = await listSafeApplyReviewItems(messages)
  const utiltsBillingReviewItems = listUtiltsBillingReviewItems(messages)

  const edielRoutes = allRoutes.filter(isEdielCandidateRoute)
  const routeProfiles = await Promise.all(
    edielRoutes.map((route) => getEdielRouteProfileByCommunicationRouteId(route.id))
  )

  const profileByRouteId = new Map(
    routeProfiles
      .filter((profile) => Boolean(profile))
      .map((profile) => [profile!.communication_route_id, profile!])
  )

  const gridOwnerById = new Map(gridOwners.map((row) => [row.id, row]))

  const workbenchRoutes = edielRoutes.map((route) => {
    const gridOwner = route.grid_owner_id
      ? gridOwnerById.get(route.grid_owner_id) ?? null
      : null

    const profile = profileByRouteId.get(route.id) ?? null

    return {
      id: route.id,
      route_name: route.route_name,
      route_scope: route.route_scope,
      route_type: route.route_type,
      target_email: route.target_email,
      target_system: route.target_system,
      grid_owner_id: route.grid_owner_id,
      grid_owner_name: gridOwner?.name ?? null,
      grid_owner_ediel_id: gridOwner?.ediel_id ?? null,
      is_active: route.is_active,
      profile: profile
        ? {
            is_enabled: profile.is_enabled,
            sender_ediel_id: profile.sender_ediel_id,
            receiver_ediel_id: profile.receiver_ediel_id,
            mailbox: profile.mailbox,
            sender_sub_address: profile.sender_sub_address,
            receiver_sub_address: profile.receiver_sub_address,
            application_reference: profile.application_reference,
            smtp_host: profile.smtp_host,
            smtp_port: profile.smtp_port,
            imap_host: profile.imap_host,
            imap_port: profile.imap_port,
            encryption_mode: profile.encryption_mode,
          }
        : null,
    }
  })

  const recommendation = getRecommendationSummary({
    switchRequests,
    outboundRequests,
    messages,
    routes: workbenchRoutes,
    preferredFamily: 'PRODAT',
  })

  const outboundWithoutRoute = outboundRequests.filter(
    (row) => !row.communication_route_id
  ).length
  const acknowledgedOutboundCount = outboundRequests.filter(
    (row) => row.status === 'acknowledged'
  ).length
  const unresolvedOutboundCount = outboundRequests.filter(
    (row) => row.channel_type === 'unresolved'
  ).length
  const outboundBackedByEdielCount = outboundRequests.filter((row) =>
    messages.some((message) => message.outbound_request_id === row.id)
  ).length
  const activeTestRunsCount = testRuns.filter((row) =>
    ['draft', 'running'].includes(row.status)
  ).length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel"
        subtitle="Operativ release 1 med canonical kernel, dedupe-spårning, versionssignaler och kontrollflöden i samma runtime."
        userEmail={user?.email ?? null}
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Aktivt scope är låst
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Den här vyn visar bara aktivt release-scope. Framtida spår hålls utanför den operativa Ediel-vyn tills de verkligen tas i bruk.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">
              familjer: {ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')}
            </Badge>
            <Badge tone="blue">
              testsviter: {ACTIVE_EDIEL_TEST_SUITES.join(', ')}
            </Badge>
            <Badge tone={hiddenMessagesCount > 0 ? 'yellow' : 'green'}>
              dolda meddelanden: {hiddenMessagesCount}
            </Badge>
            <Badge tone={hiddenTestRunsCount > 0 ? 'yellow' : 'green'}>
              dolda test runs: {hiddenTestRunsCount}
            </Badge>
          </div>
        </div>
      </section>

      <EdielFileEnginePanel recentMessages={messages} />


      <EdielOperationalBridgePanel
        messages={messages}
        switchRequests={switchRequests}
        dataRequests={dataRequests}
        outboundRequests={outboundRequests}
        routes={workbenchRoutes}
      />


      <EdielOperationalVerificationPanel
        messages={messages}
        switchRequests={switchRequests}
        dataRequests={dataRequests}
        outboundRequests={outboundRequests}
      />

      <EdielSafeApplyReviewPanel
        safeApplyItems={safeApplyReviewItems}
        utiltsItems={utiltsBillingReviewItems}
      />

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Försenade ack</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {overdueAckMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Canonical ack overdue.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ack-dubletter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {duplicateAckCandidates.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Faktiska ack-kandidater i historiken.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Duplicate-block</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {duplicateBlockEvents.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Kernel-blockeringar från events.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ack-konflikter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {ackConflictEvents.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Dubbel eller konflikt i ack-chain.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Version mismatch</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {versionMismatchMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Runtime-signal från payload/validation.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Kodlist-signaler</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {invalidCodeMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Ogiltig kod eller code list usage.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Regelambiguiteter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {ruleAmbiguities.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Flera aktiva regler samtidigt.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Unresolved outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {unresolvedOutboundCount}
          </div>
          <div className="mt-2 text-xs text-slate-500">Affärsqueue utan klar route.</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Runtime-diagnostik från canonical lagret
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Den här startsidan visar nu samma diagnosspår som control tower: overdue ack, duplicate-blocks, ack-konflikter, versionssignaler och kodlistsignaler.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ediel/control-tower"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Öppna control tower
            </Link>
            <Link
              href="/admin/ediel/routes"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Routes
            </Link>
            <Link
              href="/admin/ediel/settings"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Senaste duplicate-blocks / ack-konflikter
            </div>
            <div className="space-y-3">
              {[...duplicateBlockEvents.slice(0, 3), ...ackConflictEvents.slice(0, 3)].length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Inga duplicate-blocks eller ack-konflikter just nu.
                </div>
              ) : (
                [...duplicateBlockEvents.slice(0, 3), ...ackConflictEvents.slice(0, 3)].map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-950">
                        {row.issue_kind === 'ack_conflict'
                          ? `Ack-konflikt ${row.ack_family ?? ''}`
                          : `Duplicate-block ${row.dedupe_layer ?? ''}`}
                      </div>
                      <Badge tone={row.issue_kind === 'ack_conflict' ? 'red' : 'yellow'}>
                        {row.issue_kind}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{row.message ?? '—'}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatDateTime(row.created_at)}
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/admin/ediel/messages/${row.ediel_message_id}`}
                        className="text-sm text-indigo-700 underline-offset-2 hover:underline"
                      >
                        Öppna meddelande
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Senaste versions- / kodlistsignaler
            </div>
            <div className="space-y-3">
              {[...versionMismatchMessages.slice(0, 3), ...invalidCodeMessages.slice(0, 3)].length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Inga versions- eller kodlistsignaler just nu.
                </div>
              ) : (
                [...versionMismatchMessages.slice(0, 3), ...invalidCodeMessages.slice(0, 3)].map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-950">
                        {row.message_family} {row.message_code}
                      </div>
                      <Badge tone={versionMismatchMessages.some((m) => m.id === row.id) ? 'yellow' : 'red'}>
                        {versionMismatchMessages.some((m) => m.id === row.id)
                          ? 'version'
                          : 'code-list'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {row.message_version ?? 'utan version'} · {row.direction}
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/admin/ediel/messages/${row.id}`}
                        className="text-sm text-indigo-700 underline-offset-2 hover:underline"
                      >
                        Öppna meddelande
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Server-side rekommendation just nu
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Panelen räknas fram på serversidan innan workbenchen renderas, så du ser bästa kandidat direkt för aktivt scope.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone={recommendation.routeHealth.isRouteActive ? 'green' : 'red'}>
              route {recommendation.routeHealth.isRouteActive ? 'aktiv' : 'inaktiv'}
            </Badge>
            <Badge tone={recommendation.routeHealth.isEdielEnabled ? 'green' : 'red'}>
              ediel {recommendation.routeHealth.isEdielEnabled ? 'på' : 'av'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasTargetEmail ? 'green' : 'yellow'}>
              target email {recommendation.routeHealth.hasTargetEmail ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasSenderEdielId ? 'green' : 'red'}>
              sender {recommendation.routeHealth.hasSenderEdielId ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasReceiverEdielId ? 'green' : 'red'}>
              receiver {recommendation.routeHealth.hasReceiverEdielId ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasMailbox ? 'green' : 'red'}>
              mailbox {recommendation.routeHealth.hasMailbox ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.isReadyForOutbound ? 'green' : 'red'}>
              outbound {recommendation.routeHealth.isReadyForOutbound ? 'redo' : 'blockerad'}
            </Badge>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/70 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Routebedömning</div>
          <p className="mt-2 text-sm text-slate-600">{recommendation.routeSummary}</p>

          {recommendation.routeIssues.length > 0 ? (
            <div className="mt-3 space-y-2">
              {recommendation.routeIssues.map((issue) => (
                <div
                  key={issue.key}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    issue.severity === 'error'
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
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
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-5">
          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Senaste switch
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.selectedSwitchId || '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa route
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {routeLabel(recommendation.recommendedRoute)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa outbound att skicka
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedSendMessage
                ? `${recommendation.recommendedSendMessage.message_family} ${recommendation.recommendedSendMessage.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedSendMessage?.id ?? 'inget skickbart meddelande'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa inbound UTILTS
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedInboundUtilts
                ? `${recommendation.recommendedInboundUtilts.message_family} ${recommendation.recommendedInboundUtilts.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedInboundUtilts?.id ?? 'inget inbound UTILTS ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa ACK-källa
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedAckSource
                ? `${recommendation.recommendedAckSource.message_family} ${recommendation.recommendedAckSource.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedAckSource?.id ?? 'ingen lämplig ACK-källa ännu'}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Aktiva meddelanden</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.direction === 'outbound').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Inbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.direction === 'inbound').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">PRODAT</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.message_family === 'PRODAT').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">UTILTS</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.message_family === 'UTILTS').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Aktiva test runs</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {activeTestRunsCount}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound i kö</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {outboundRequests.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Intern queue som driver dispatch och Ediel-flöden.
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar route</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">
            {outboundWithoutRoute}
          </div>
          <div className="mt-2 text-xs text-amber-700">
            Registrerade men inte skickbara ännu.
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-700">Kvitterade outbound</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-900">
            {acknowledgedOutboundCount}
          </div>
          <div className="mt-2 text-xs text-emerald-700">
            Har fått svar eller kvittens tillbaka i kedjan.
          </div>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm text-blue-700">Outbound med Ediel-koppling</div>
          <div className="mt-2 text-3xl font-semibold text-blue-900">
            {outboundBackedByEdielCount}
          </div>
          <div className="mt-2 text-xs text-blue-700">
            Outbound som verkligen blivit Ediel-meddelanden.
          </div>
        </div>
      </section>

      <EdielWorkbench
        switchRequests={switchRequests}
        outboundRequests={outboundRequests}
        messages={messages}
        routes={workbenchRoutes}
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Registrera inbound UTILTS manuellt
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Använd bara för riktade test eller när du behöver mata in ett korrekt inbound-fall i aktivt scope.
          </p>

          <form action={registerInboundUtiltsAction} className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Meddelandekod
              </label>
              <select
                name="messageCode"
                defaultValue="E66"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="E66">E66</option>
                <option value="S02">S02</option>
                <option value="S03">S03</option>
                <option value="E31">E31</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Sender Ediel-id
              </label>
              <input
                name="senderEdielId"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Receiver Ediel-id
              </label>
              <input
                name="receiverEdielId"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Kvantitet
              </label>
              <input
                name="quantity"
                defaultValue="0"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Period start
              </label>
              <input
                name="periodStart"
                type="datetime-local"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Period slut
              </label>
              <input
                name="periodEnd"
                type="datetime-local"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="md:col-span-2">
              <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                Registrera inbound UTILTS
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Starta self-test i aktivt scope
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Självtest är låsta till aktiv release. Framtida meddelandefamiljer körs inte här.
          </p>

          <form action={runEdielSelfTestAction} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Scenario
              </label>
              <select
                name="scenario"
                defaultValue="PRODAT_Z05_IN"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="PRODAT_Z04_IN">PRODAT_Z04_IN</option>
                <option value="PRODAT_Z05_IN">PRODAT_Z05_IN</option>
                <option value="PRODAT_Z06_IN">PRODAT_Z06_IN</option>
                <option value="PRODAT_Z10_IN">PRODAT_Z10_IN</option>
                <option value="UTILTS_S02_IN">UTILTS_S02_IN</option>
                <option value="UTILTS_S03_IN">UTILTS_S03_IN</option>
                <option value="UTILTS_E66_KVART_IN">UTILTS_E66_KVART_IN</option>
                <option value="UTILTS_E66_SCH_IN">UTILTS_E66_SCH_IN</option>
                <option value="UTILTS_NEGATIVE">UTILTS_NEGATIVE</option>
              </select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="switchRequestId"
                placeholder="switchRequestId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="gridOwnerDataRequestId"
                placeholder="gridOwnerDataRequestId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="senderEdielId"
                placeholder="senderEdielId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="receiverEdielId"
                placeholder="receiverEdielId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="mailbox"
                placeholder="mailbox"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="receiverEmail"
                placeholder="receiverEmail"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Kör self-test
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa test run
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Endast testsviter i aktivt scope är tillåtna här.
          </p>

          <form action={createEdielTestRunAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Test suite
                </label>
                <select
                  name="testSuite"
                  defaultValue="PRODAT"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  {ACTIVE_EDIEL_TEST_SUITES.map((suite) => (
                    <option key={suite} value={suite}>
                      {suite}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Rollkod
                </label>
                <select
                  name="roleCode"
                  defaultValue="supplier"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  <option value="supplier">supplier</option>
                  <option value="grid_owner">grid_owner</option>
                  <option value="balance_responsible">balance_responsible</option>
                  <option value="esco">esco</option>
                </select>
              </div>

              <input
                name="testCaseCode"
                placeholder="testCaseCode"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="title"
                placeholder="title"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="approvalVersion"
                placeholder="approvalVersion"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="notes"
                placeholder="notes"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa test run
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Aktiva test runs
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Draft eller running inom aktiv release.
          </p>

          <div className="mt-4 space-y-3">
            {testRuns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga aktiva test runs ännu.
              </div>
            ) : (
              testRuns.slice(0, 12).map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        {row.test_suite} · {row.test_case_code}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(row.created_at)}
                      </div>
                    </div>
                    <Badge tone={row.status === 'failed' ? 'red' : row.status === 'passed' ? 'green' : 'yellow'}>
                      {row.status}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="ID" value={row.id} />
                    <Cell label="Roll" value={row.role_code} />
                    <Cell label="Titel" value={row.title} />
                    <Cell label="Approval version" value={row.approval_version} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Outbound queue som driver Ediel/CIS
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Här ser du om ett leverantörsbyte eller en nätägarbegäran verkligen har köats, vilken kanal som valts, om route saknas och om det sedan blivit ett riktigt Ediel-meddelande.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={unresolvedOutboundCount > 0 ? 'red' : 'green'}>
              unresolved: {unresolvedOutboundCount}
            </Badge>
            <Badge tone="blue">totalt: {outboundRequests.length}</Badge>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Källa</th>
                <th className="px-3 py-2">Source-id</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Kanal</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Ediel</th>
                <th className="px-3 py-2">Extern ref</th>
                <th className="px-3 py-2">Skapad</th>
              </tr>
            </thead>
            <tbody>
              {outboundRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Inga outbound requests ännu.
                  </td>
                </tr>
              ) : (
                outboundRequests.map((row) => {
                  const relatedMessages = findMessagesForOutbound(messages, row.id)

                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">
                        {row.id}
                      </td>
                      <td className="px-3 py-2">{row.request_type}</td>
                      <td className="px-3 py-2">{row.source_type ?? '—'}</td>
                      <td className="px-3 py-2 break-all text-xs text-slate-600">
                        {row.source_id ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getOutboundStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2">{row.channel_type ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={getRouteTone(row.communication_route_id)}>
                          {row.communication_route_id ? 'kopplad' : 'saknas'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {relatedMessages.length === 0 ? (
                            <Badge tone="slate">ingen Ediel-rad</Badge>
                          ) : (
                            relatedMessages.slice(0, 3).map((message) => (
                              <Link
                                key={message.id}
                                href={`/admin/ediel/messages/${message.id}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:underline"
                              >
                                <span className="mr-2">
                                  <Badge tone={getMessageTone(message.direction)}>
                                    {message.direction}
                                  </Badge>
                                </span>
                                {message.message_family} {message.message_code}
                              </Link>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 break-all text-xs text-slate-600">
                        {row.external_reference ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Senaste switch requests</h2>
          <div className="mt-4 space-y-3">
            {switchRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga switch requests ännu.
              </div>
            ) : (
              switchRequests.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">{row.id}</div>
                    <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="Customer" value={row.customer_id} />
                    <Cell label="Site" value={row.site_id} />
                    <Cell label="Metering point" value={row.metering_point_id} />
                    <Cell label="External ref" value={row.external_reference} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Senaste data requests</h2>
          <div className="mt-4 space-y-3">
            {dataRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga data requests ännu.
              </div>
            ) : (
              dataRequests.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">
                      {row.id} · {row.request_scope}
                    </div>
                    <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="Customer" value={row.customer_id} />
                    <Cell label="Site" value={row.site_id} />
                    <Cell label="Metering point" value={row.metering_point_id} />
                    <Cell label="External ref" value={row.external_reference} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Senaste Ediel-meddelanden</h2>
            <p className="mt-1 text-sm text-slate-600">
              Aktiva familjer med canonical ack-state direkt i översikten.
            </p>
          </div>
          <Link
            href="/admin/ediel/control-tower"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Se full kontrollvy
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">Skapad</th>
                <th className="px-3 py-2">Meddelande</th>
                <th className="px-3 py-2">Riktning</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Ack-state</th>
                <th className="px-3 py-2">Referenser</th>
                <th className="px-3 py-2">Öppna</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Inga Ediel-meddelanden ännu.
                  </td>
                </tr>
              ) : (
                messages.slice(0, 20).map((row) => {
                  const ackState = getCanonicalAckState(row)
                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.message_version ?? 'utan version'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getMessageTone(row.direction)}>{row.direction}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getOutboundStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={ackStateTone(String(ackState))}>{String(ackState)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div>External: {row.external_reference ?? '—'}</div>
                        <div>Transaction: {row.transaction_reference ?? '—'}</div>
                        <div>Interchange: {row.interchange_reference ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="text-indigo-700 underline-offset-2 hover:underline"
                        >
                          Öppna
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Ediel-routes i runtime</h2>
            <p className="mt-1 text-sm text-slate-600">
              Visar vad runtime faktiskt kan använda just nu utifrån route + profil.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">routes: {edielRoutes.length}</Badge>
            <Badge tone={ruleAmbiguities.length > 0 ? 'yellow' : 'green'}>
              regelambiguiteter: {ruleAmbiguities.length}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {workbenchRoutes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Inga Ediel-routes hittades.
            </div>
          ) : (
            workbenchRoutes.slice(0, 12).map((route) => (
              <div key={route.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-950">{route.route_name}</div>
                  <Badge tone={route.is_active ? 'green' : 'red'}>
                    {route.is_active ? 'aktiv' : 'inaktiv'}
                  </Badge>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Cell label="Scope" value={route.route_scope} />
                  <Cell label="Type" value={route.route_type} />
                  <Cell label="Grid owner" value={route.grid_owner_name} />
                  <Cell label="Grid owner ediel" value={route.grid_owner_ediel_id} />
                  <Cell label="Target email" value={route.target_email} />
                  <Cell label="Target system" value={route.target_system} />
                  <Cell label="Sender ediel" value={route.profile?.sender_ediel_id ?? null} />
                  <Cell label="Receiver ediel" value={route.profile?.receiver_ediel_id ?? null} />
                  <Cell label="Mailbox" value={route.profile?.mailbox ?? null} />
                  <Cell label="App ref" value={route.profile?.application_reference ?? null} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}