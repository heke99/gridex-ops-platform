import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listMeteringPointsBySiteIds, listGridOwners } from '@/lib/masterdata/db'
import {
  listPowersOfAttorneyByCustomerId,
  listSupplierSwitchEventsByRequestIds,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import {
  explainWhySwitchIsStuck,
  getSwitchLifecycle,
  summarizeDispatchAttempt,
  summarizeReadinessIssues,
} from '@/lib/operations/controlTower'
import {
  listOutboundDispatchEventsByRequestIds,
  listOutboundRequests,
} from '@/lib/cis/db'
import {
  queueSupplierSwitchOutboundAction,
  updateOutboundRequestStatusAction,
} from '@/app/admin/cis/actions'
import {
  finalizeSupplierSwitchExecutionAction,
  retryOutboundFromSwitchDetailAction,
  updateSupplierSwitchStatusFromAdminAction,
  validateSupplierSwitchBeforeProcessingAction,
} from '@/app/admin/operations/actions'
import type { OutboundDispatchEventRow, OutboundRequestRow } from '@/lib/cis/types'
import type {
  SupplierSwitchEventRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type { CustomerSiteRow, MeteringPointRow, GridOwnerRow } from '@/lib/masterdata/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

type ValidationSnapshotView = {
  validatedAt: string | null
  validatedBy: string | null
  isReady: boolean | null
  issueCodes: string[]
  issueCount: number
  matchedMeterPointId: string | null
  latestPowerOfAttorneyStatus: string | null
  siteStatus: string | null
  priceAreaCode: string | null
}

function readValidationSnapshot(
  snapshot: SupplierSwitchRequestRow['validation_snapshot']
): ValidationSnapshotView {
  const source =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : {}

  const issueCodesRaw = source.issueCodes
  const issueCodes = Array.isArray(issueCodesRaw)
    ? issueCodesRaw.filter((value): value is string => typeof value === 'string')
    : []

  const issueCountRaw = source.issueCount

  return {
    validatedAt: typeof source.validatedAt === 'string' ? source.validatedAt : null,
    validatedBy: typeof source.validatedBy === 'string' ? source.validatedBy : null,
    isReady: typeof source.isReady === 'boolean' ? source.isReady : null,
    issueCodes,
    issueCount:
      typeof issueCountRaw === 'number'
        ? issueCountRaw
        : issueCodes.length,
    matchedMeterPointId:
      typeof source.matchedMeterPointId === 'string'
        ? source.matchedMeterPointId
        : null,
    latestPowerOfAttorneyStatus:
      typeof source.latestPowerOfAttorneyStatus === 'string'
        ? source.latestPowerOfAttorneyStatus
        : null,
    siteStatus: typeof source.siteStatus === 'string' ? source.siteStatus : null,
    priceAreaCode:
      typeof source.priceAreaCode === 'string' ? source.priceAreaCode : null,
  }
}

type TimelineEntry = {
  id: string
  occurredAt: string
  source: 'switch_request' | 'switch_event' | 'outbound' | 'dispatch_event'
  title: string
  description: string
  status: string
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function tone(status: string): string {
  if (['completed', 'accepted', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'cancelled', 'blocked'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['submitted', 'sent'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function siteName(site: CustomerSiteRow | null): string {
  return site?.site_name ?? site?.id ?? '—'
}

function meteringPointName(point: MeteringPointRow | null): string {
  return point?.meter_point_id ?? point?.id ?? '—'
}

function gridOwnerName(owner: GridOwnerRow | null): string {
  return owner?.name ?? owner?.id ?? '—'
}

function buildTimeline(params: {
  request: SupplierSwitchRequestRow
  switchEvents: SupplierSwitchEventRow[]
  outboundRequest: OutboundRequestRow | null
  outboundDispatchEvents: OutboundDispatchEventRow[]
}): TimelineEntry[] {
  const rows: TimelineEntry[] = []

  rows.push({
    id: `request:${params.request.id}`,
    occurredAt:
      params.request.completed_at ??
      params.request.failed_at ??
      params.request.submitted_at ??
      params.request.created_at,
    source: 'switch_request',
    title: 'Switch request',
    description: `${params.request.request_type} · ${params.request.status}`,
    status: params.request.status,
  })

  for (const event of params.switchEvents) {
    rows.push({
      id: `switch-event:${event.id}`,
      occurredAt: event.created_at,
      source: 'switch_event',
      title: 'Switch event',
      description: event.message ?? `${event.event_type} · ${event.event_status}`,
      status: event.event_status,
    })
  }

  if (params.outboundRequest) {
    rows.push({
      id: `outbound:${params.outboundRequest.id}`,
      occurredAt:
        params.outboundRequest.acknowledged_at ??
        params.outboundRequest.failed_at ??
        params.outboundRequest.sent_at ??
        params.outboundRequest.prepared_at ??
        params.outboundRequest.queued_at ??
        params.outboundRequest.created_at,
      source: 'outbound',
      title: 'Outbound request',
      description: `${params.outboundRequest.request_type} · ${params.outboundRequest.channel_type}`,
      status: params.outboundRequest.status,
    })
  }

  for (const event of params.outboundDispatchEvents) {
    rows.push({
      id: `dispatch-event:${event.id}`,
      occurredAt: event.created_at,
      source: 'dispatch_event',
      title: 'Dispatch event',
      description: event.message ?? `${event.event_type} · ${event.event_status}`,
      status: event.event_status,
    })
  }

  return rows.sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}

export default async function SwitchDetailPage({ params }: PageProps) {
  await requirePermissionServer('masterdata.read')

  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const requestQuery = await supabase
    .from('supplier_switch_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (requestQuery.error) throw requestQuery.error
  const request = (requestQuery.data as SupplierSwitchRequestRow | null) ?? null

  if (!request) {
    notFound()
  }

  const [siteQuery, gridOwners, outboundRequests, switchEvents, powersOfAttorney] =
    await Promise.all([
      supabase
        .from('customer_sites')
        .select('*')
        .eq('id', request.site_id)
        .maybeSingle(),
      listGridOwners(supabase),
      listOutboundRequests({
        status: 'all',
        requestType: 'supplier_switch',
        channelType: 'all',
        query: '',
      }),
      listSupplierSwitchEventsByRequestIds(supabase, [request.id]),
      listPowersOfAttorneyByCustomerId(supabase, request.customer_id),
    ])

  if (siteQuery.error) throw siteQuery.error
  const site = (siteQuery.data as CustomerSiteRow | null) ?? null

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    site ? [site.id] : []
  )

  const meteringPoint =
    meteringPoints.find((point) => point.id === request.metering_point_id) ?? null

  const gridOwner =
    gridOwners.find((owner) => owner.id === request.grid_owner_id) ?? null

  const readiness =
    site
      ? evaluateSiteSwitchReadiness({
          site,
          meteringPoints,
          powersOfAttorney,
        })
      : null

  const outboundRequest =
    outboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    ) ?? null

  const outboundDispatchEvents = outboundRequest
    ? await listOutboundDispatchEventsByRequestIds([outboundRequest.id])
    : []

  const lifecycle = getSwitchLifecycle({
    request,
    readiness,
    outboundRequest,
  })

  const stuckReason = explainWhySwitchIsStuck({
    request,
    readiness,
    outboundRequest,
  })

  const timeline = buildTimeline({
    request,
    switchEvents,
    outboundRequest,
    outboundDispatchEvents,
  })

  const validationSummary = readValidationSnapshot(request.validation_snapshot)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Switch detail"
        subtitle="Detail-vy för ett enskilt supplier switch-ärende med timeline, dispatch, validering och intern slutföring."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
                  {request.status}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(lifecycle.stage)}`}>
                  {lifecycle.label}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {request.request_type}
                </span>
              </div>

              <h1 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                Switchärende {request.id}
              </h1>

              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Kund {request.customer_id} · Anläggning {siteName(site)} · Mätpunkt{' '}
                {meteringPointName(meteringPoint)}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/operations/switches"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Tillbaka till switchar
              </Link>
              <Link
                href={`/admin/customers/${request.customer_id}`}
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Öppna kundkort
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Lifecycle</div>
            <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
              {lifecycle.label}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {lifecycle.reason}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Varför sitter den fast</div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {stuckReason}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Senaste dispatchförsök</div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {summarizeDispatchAttempt(outboundRequest)}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Readiness</div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {readiness ? (readiness.isReady ? 'Redo för byte' : 'Ej redo') : 'Kunde inte beräkna'}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {readiness
                ? readiness.isReady
                  ? 'Inga aktiva blockers.'
                  : summarizeReadinessIssues(readiness)
                : 'Anläggning saknas eller kunde inte läsas.'}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Senaste validering</div>
            <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
              {validationSummary.isReady === null
                ? 'Inte körd ännu'
                : validationSummary.isReady
                  ? 'Ready for processing'
                  : 'Pending review'}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {validationSummary.validatedAt
                ? `${formatDateTime(validationSummary.validatedAt)} · ${validationSummary.issueCount} issues`
                : 'Ingen validation snapshot sparad ännu.'}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Ärendedetaljer
              </h2>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Nuvarande leverantör</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {request.current_supplier_name ?? '—'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Inkommande leverantör</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {request.incoming_supplier_name}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Nätägare</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {gridOwnerName(gridOwner)}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Startdatum</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {request.requested_start_date ?? '—'}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Tidsstämplar
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>Skapad: <span className="font-medium">{formatDateTime(request.created_at)}</span></div>
                    <div>Submitted: <span className="font-medium">{formatDateTime(request.submitted_at)}</span></div>
                    <div>Completed: <span className="font-medium">{formatDateTime(request.completed_at)}</span></div>
                    <div>Failed: <span className="font-medium">{formatDateTime(request.failed_at)}</span></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Identifierare
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>Customer ID: <span className="font-medium">{request.customer_id}</span></div>
                    <div>Site ID: <span className="font-medium">{request.site_id}</span></div>
                    <div>Mätpunkt ID: <span className="font-medium">{request.metering_point_id}</span></div>
                    <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
                  </div>
                </div>
              </div>

              {request.failure_reason ? (
                <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                  {request.failure_reason}
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Pre-processing validation
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Steg 7.11 kör en live-validering mot databasen, sparar validation_snapshot och loggar resultatet innan vidare processing.
                  </p>
                </div>

                <form action={validateSupplierSwitchBeforeProcessingAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                    {request.status === 'draft'
                      ? 'Validera och markera redo'
                      : 'Kör om validering'}
                  </button>
                </form>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Validation state</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {validationSummary.isReady === null
                      ? 'Inte körd ännu'
                      : validationSummary.isReady
                        ? 'Ready for processing'
                        : 'Pending review'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Validerad</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {validationSummary.validatedAt
                      ? formatDateTime(validationSummary.validatedAt)
                      : '—'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Snapshot issue count</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {validationSummary.issueCount}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Snapshot mätpunkt</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {validationSummary.matchedMeterPointId ?? '—'}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Snapshotdetaljer
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>Site status: <span className="font-medium">{validationSummary.siteStatus ?? '—'}</span></div>
                    <div>Prisområde: <span className="font-medium">{validationSummary.priceAreaCode ?? '—'}</span></div>
                    <div>Fullmakt: <span className="font-medium">{validationSummary.latestPowerOfAttorneyStatus ?? '—'}</span></div>
                    <div>Readiness live nu: <span className="font-medium">{readiness ? (readiness.isReady ? 'Ready for processing' : 'Pending review') : '—'}</span></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Valideringsresultat
                  </div>
                  <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    {readiness && !readiness.isReady ? (
                      <div className="space-y-2">
                        {readiness.issues.map((issue) => (
                          <div key={issue.code} className="rounded-2xl bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                            <div className="font-medium">{issue.title}</div>
                            <div className="mt-1 text-xs">{issue.description}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        Inga aktiva blockers. Ärendet kan gå vidare i processing-flödet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Execute / finalize switch
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Steg 7.12 slutför switchen internt. Site får ny aktuell leverantör, mätpunkten synkas och requesten markeras completed.
                  </p>
                </div>

                {lifecycle.stage === 'ready_to_execute' ? (
                  <form action={finalizeSupplierSwitchExecutionAction}>
                    <input type="hidden" name="request_id" value={request.id} />
                    <button className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                      Slutför switch nu
                    </button>
                  </form>
                ) : (
                  <span className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Väntar på accepted + kvitterad outbound
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Current lifecycle</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {lifecycle.label}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Request status</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {request.status}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Outbound status</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {outboundRequest?.status ?? 'Ingen outbound'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Ny leverantör på site</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-white">
                    {request.incoming_supplier_name}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Outbound & dispatch
                </h2>

                <Link
                  href="/admin/outbound"
                  className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                >
                  Öppna outbound
                </Link>
              </div>

              {!outboundRequest ? (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Ingen outbound-request finns ännu för det här switchärendet.
                  <div className="mt-4">
                    <form action={queueSupplierSwitchOutboundAction}>
                      <input type="hidden" name="request_id" value={request.id} />
                      <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                        Köa outbound nu
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Status</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-white">
                        {outboundRequest.status}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Kanal</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-white">
                        {outboundRequest.channel_type}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Route</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-white">
                        {outboundRequest.communication_route_id ?? '—'}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Försök</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-white">
                        {outboundRequest.attempts_count}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {outboundRequest.status === 'queued' ? (
                      <form action={updateOutboundRequestStatusAction}>
                        <input type="hidden" name="outbound_request_id" value={outboundRequest.id} />
                        <input type="hidden" name="customer_id" value={request.customer_id} />
                        <input type="hidden" name="status" value="prepared" />
                        <input type="hidden" name="dispatch_step" value="prepare" />
                        <button className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                          Förbered
                        </button>
                      </form>
                    ) : null}

                    {['queued', 'prepared'].includes(outboundRequest.status) ? (
                      <form action={updateOutboundRequestStatusAction}>
                        <input type="hidden" name="outbound_request_id" value={outboundRequest.id} />
                        <input type="hidden" name="customer_id" value={request.customer_id} />
                        <input type="hidden" name="status" value="sent" />
                        <input type="hidden" name="dispatch_step" value="send" />
                        <button className="w-full rounded-2xl border border-blue-300 px-4 py-2.5 text-sm font-semibold text-blue-700 dark:border-blue-800 dark:text-blue-300">
                          Markera som skickad
                        </button>
                      </form>
                    ) : null}

                    {outboundRequest.status === 'sent' ? (
                      <form action={updateOutboundRequestStatusAction}>
                        <input type="hidden" name="outbound_request_id" value={outboundRequest.id} />
                        <input type="hidden" name="customer_id" value={request.customer_id} />
                        <input type="hidden" name="status" value="acknowledged" />
                        <input type="hidden" name="dispatch_step" value="ack" />
                        <button className="w-full rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                          Markera som kvitterad
                        </button>
                      </form>
                    ) : null}

                    {['failed', 'cancelled'].includes(outboundRequest.status) ? (
                      <form action={retryOutboundFromSwitchDetailAction}>
                        <input type="hidden" name="switch_request_id" value={request.id} />
                        <input type="hidden" name="outbound_request_id" value={outboundRequest.id} />
                        <input type="hidden" name="customer_id" value={request.customer_id} />
                        <button className="w-full rounded-2xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300">
                          Retry outbound
                        </button>
                      </form>
                    ) : null}
                  </div>

                  {outboundRequest.failure_reason ? (
                    <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                      {outboundRequest.failure_reason}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Timeline
              </h2>

              <div className="mt-5 space-y-3">
                {timeline.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Ingen timeline ännu.
                  </div>
                ) : (
                  timeline.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {entry.title}
                          </div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {entry.description}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone(entry.status)}`}>
                            {entry.status}
                          </span>
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {formatDateTime(entry.occurredAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Uppdatera switchstatus
              </h2>

              <form
                action={updateSupplierSwitchStatusFromAdminAction}
                className="mt-5 space-y-3"
              >
                <input type="hidden" name="request_id" value={request.id} />

                <select
                  name="status"
                  defaultValue={request.status}
                  className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="queued">Queued</option>
                  <option value="submitted">Submitted</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>

                <input
                  name="external_reference"
                  defaultValue={request.external_reference ?? ''}
                  placeholder="Extern referens"
                  className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />

                <textarea
                  name="failure_reason"
                  defaultValue={request.failure_reason ?? ''}
                  placeholder="Felorsak"
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />

                <button className="w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                  Spara switchstatus
                </button>
              </form>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Senaste switch-events
              </h2>

              <div className="mt-5 space-y-3">
                {switchEvents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga switch-events ännu.
                  </div>
                ) : (
                  switchEvents.slice(0, 8).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(event.event_status)}`}>
                          {event.event_status}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDateTime(event.created_at)}
                        </span>
                      </div>

                      <div className="mt-3 text-sm font-medium text-slate-900 dark:text-white">
                        {event.event_type}
                      </div>

                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {event.message ?? '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Dispatch-events
              </h2>

              <div className="mt-5 space-y-3">
                {outboundDispatchEvents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga dispatch-events ännu.
                  </div>
                ) : (
                  outboundDispatchEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(event.event_status)}`}>
                          {event.event_status}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDateTime(event.created_at)}
                        </span>
                      </div>

                      <div className="mt-3 text-sm font-medium text-slate-900 dark:text-white">
                        {event.event_type}
                      </div>

                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {event.message ?? '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}