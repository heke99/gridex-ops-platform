import SupplierSwitchBusinessView, { SupplierSwitchRetryFields, supplierSwitchRequestTypeLabel } from '@/components/admin/customers/SupplierSwitchBusinessView'
import { canPresentAdminAction, canPresentAdminLink } from '@/lib/admin/actionPresentation'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import CustomerName from '@/components/admin/CustomerName'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { readResult } from '@/lib/read-models/readResult'
import { readConfirmedMarketStarts } from '@/lib/operations/readyBulkCandidates'
import { readWritableSwitchCompanyIds } from '@/lib/operations/switchCompanyWriteScope'
import { readSwitchActivationCompanyIds } from '@/lib/operations/switchActivationAuthority'
import { canEditManualSwitchStatus, canRetrySwitchOutboundStatus, manualSwitchStatusOptions } from '@/lib/operations/manualSwitchStatus'
import { getVerifiedSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
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
import { ManualOutboundDeliveryForm } from '@/components/admin/outbound/ManualOutboundDeliveryForm'
import { listOutboundDispatchEventsByRequestIds } from '@/lib/cis/db'
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
import {
 prepareSwitchZ03Action,
 prepareSwitchZ05Action,
 prepareSwitchZ09Action,
 sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { OutboundDispatchEventRow, OutboundRequestRow } from '@/lib/cis/types'
import type {
 SupplierSwitchEventRow,
 SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type { CustomerSiteRow, MeteringPointRow, GridOwnerRow } from '@/lib/masterdata/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { formatStatusLabel } from '@/lib/ui/format'

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

type TimelineEntry = {
 id: string
 occurredAt: string
 source: 'switch_request' | 'switch_event' | 'outbound' | 'utskick_event' | 'ediel_message'
 title: string
 description: string
 status: string
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

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function tone(status: string): string {
 if (['completed', 'accepted', 'acknowledged', 'validated', 'received'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (['failed', 'rejected', 'cancelled', 'blocked'].includes(status)) {
 return 'bg-red-100 text-red-700 '
 }

 if (['submitted', 'sent'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 return 'bg-amber-100 text-amber-700 '
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

function edielTitle(message: EdielMessageRow): string {
 return `${message.message_family} ${message.message_code}`
}

function edielOccurredAt(message: EdielMessageRow): string {
 return (
 message.message_received_at ??
 message.message_sent_at ??
 message.acknowledged_at ??
 message.failed_at ??
 message.created_at
 )
}

function buildTimeline(params: {
 request: SupplierSwitchRequestRow
 switchEvents: SupplierSwitchEventRow[]
 outboundRequest: OutboundRequestRow | null
 outboundDispatchEvents: OutboundDispatchEventRow[]
 edielMessages: EdielMessageRow[]
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
 title: "Begäran om leverantörsbyte",
 description: `${params.request.request_type} · ${params.request.status}`,
 status: params.request.status,
 })

 for (const event of params.switchEvents) {
 rows.push({
 id: `switch-event:${event.id}`,
 occurredAt: event.created_at,
 source: 'switch_event',
 title: 'Leverantörsbyte event',
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
 title: "Utskick",
 description: `${params.outboundRequest.request_type} · ${params.outboundRequest.channel_type}`,
 status: params.outboundRequest.status,
 })
 }

 for (const message of params.edielMessages) {
 rows.push({
 id: `ediel:${message.id}`,
 occurredAt: edielOccurredAt(message),
 source: 'ediel_message',
 title: 'Ediel message',
 description: `${message.direction} · ${message.message_family} ${message.message_code} · ${message.status}`,
 status: message.status,
 })
 }

 for (const event of params.outboundDispatchEvents) {
 rows.push({
 id: `utskick-event:${event.id}`,
 occurredAt: event.created_at,
 source: 'utskick_event',
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

export default async function LeverantörsbyteDetailPage({ params }: PageProps) {
 const access = await requireAdminPageKeyAccess('operations.switches')
 const tenantScope = await resolveAdminTenantReadScope(access)

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
 const request = (requestQuery.data as (SupplierSwitchRequestRow & { outbound_z03_message_id?: string | null }) | null) ?? null

 if (!request) {
 notFound()
 }

 const requestCompanyId = typeof request.company_id === 'string' ? request.company_id : null
 if (!tenantScope.isPlatformAdmin && (!requestCompanyId || requestCompanyId !== tenantScope.companyId)) {
 notFound()
 }

 const [
 siteQuery,
 gridOwners,
 outboundQuery,
 switchEvents,
 powersOfAttorney,
 edielMessagesQuery,
 ] = await Promise.all([
 supabase
 .from('customer_sites')
 .select('*')
 .eq('id', request.site_id)
 .maybeSingle(),
 listGridOwners(supabase),
 requestCompanyId ? supabase
 .from('outbound_requests')
 .select('*')
 .eq('company_id', requestCompanyId)
 .eq('customer_id', request.customer_id)
 .eq('site_id', request.site_id)
 .eq('request_type', 'supplier_switch')
 .eq('source_type', 'supplier_switch_request')
 .eq('source_id', request.id)
 .order('created_at', { ascending: false })
 .order('id', { ascending: false })
 .limit(1)
 .maybeSingle() : null,
 tenantScope.isPlatformAdmin ? listSupplierSwitchEventsByRequestIds(supabase, [request.id]) : [],
 listPowersOfAttorneyByCustomerId(supabase, request.customer_id),
 tenantScope.isPlatformAdmin ? supabase
 .from('ediel_messages')
 .select('*')
 .eq('switch_request_id', request.id)
 .order('created_at', { ascending: false }) : null,
 ])

 if (siteQuery.error) throw siteQuery.error
 if (outboundQuery?.error) throw outboundQuery.error

 const siteRow = siteQuery.data as CustomerSiteRow | null
 const site = siteRow?.company_id === requestCompanyId && siteRow?.customer_id === request.customer_id ? siteRow : null
 const customerHref = site
   && canPresentAdminLink(access, { anyOf: ['customers.read', 'masterdata.read'] })
   && canPresentAdminLink(access, { anyOf: ['customers.read', 'contracts.read', 'contracts.write'] })
   ? `/admin/customers/${request.customer_id}`
   : null

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

 const outboundRequest = (outboundQuery?.data as OutboundRequestRow | null) ?? null

 const now = new Date()
 const marketStarts = request.status === 'accepted' ? await readResult(
 () => readConfirmedMarketStarts(supabase, [request]),
 { definitionVersion: 'supplier_switch_confirmed_market_start_v1', errorCode: 'SWITCH_MARKET_START_UNAVAILABLE' },
 ) : null
 const activation = marketStarts ? getVerifiedSupplierSwitchActivationReadiness(
 request, marketStarts.kind === 'unavailable' ? undefined : marketStarts.data.get(request.id.toLowerCase()) ?? null, now,
 ) : null
 const lifecycle = getSwitchLifecycle({
 activation,
 request,
 readiness,
 outboundRequest,
 })

 const canActivate = Boolean(requestCompanyId && site && activation?.ready
   && lifecycle.stage === 'ready_to_execute'
   && await canPresentAdminAction([MASTERDATA_PERMISSIONS.WRITE])
   && (await readSwitchActivationCompanyIds(supabase, access.userId, [requestCompanyId])).has(requestCompanyId))

 const canUpdateManualStatus = requestCompanyId !== null
   && canEditManualSwitchStatus(request.status)
   && (tenantScope.isPlatformAdmin || access.permissions.includes(MASTERDATA_PERMISSIONS.WRITE))
   && await canPresentAdminAction([MASTERDATA_PERMISSIONS.WRITE])
   && (await readWritableSwitchCompanyIds(supabase, [requestCompanyId])).has(requestCompanyId)

 if (edielMessagesQuery?.error) throw edielMessagesQuery.error
 const edielMessages = (edielMessagesQuery?.data as EdielMessageRow[] | null) ?? []
 const retrySelection = canUpdateManualStatus
   && requestCompanyId && !request.lifecycle_blocked && !request.paused_at && request.updated_at
   && !request.inbound_z04_message_id && !request.outbound_z03_message_id
   && outboundRequest && outboundRequest.updated_at && canRetrySwitchOutboundStatus(outboundRequest.status)
   && !outboundRequest.sent_at && !outboundRequest.acknowledged_at && outboundRequest.attempts_count === 0
   && !outboundRequest.response_payload?.edielMessageId
   && !edielMessages.some(message => message.direction === 'outbound'
      && (message.outbound_request_id === outboundRequest.id
        || (message.message_family === 'PRODAT' && message.message_code === 'Z03')))
   ? {
      companyId: requestCompanyId, customerId: request.customer_id,
      switchId: request.id, switchStatus: request.status, switchUpdatedAt: request.updated_at,
      outboundId: outboundRequest.id, outboundStatus: outboundRequest.status, outboundUpdatedAt: outboundRequest.updated_at,
     }
   : null

 if (!tenantScope.isPlatformAdmin) {
   return <SupplierSwitchBusinessView
     request={{
       id: request.id,
       customer_id: request.customer_id,
       request_type: request.request_type,
       status: request.status,
       current_supplier_name: request.current_supplier_name,
       incoming_supplier_name: request.incoming_supplier_name,
       requested_start_date: request.requested_start_date,
       confirmed_start_date: request.confirmed_start_date,
       power_of_attorney_id: request.power_of_attorney_id,
       authorization_document_id: request.authorization_document_id,
       completed_at: request.completed_at,
       paused_at: request.paused_at,
       lifecycle_blocked: request.lifecycle_blocked,
     }}
     site={site}
     customerHref={customerHref}
     gridOwner={gridOwner}
     readiness={readiness}
     outboundRequest={outboundRequest ? { id: outboundRequest.id, status: outboundRequest.status, sent_at: outboundRequest.sent_at } : null}
     retrySelection={retrySelection}
     stage={lifecycle.stage}
     activation={activation}
     canActivate={canActivate}
     canManage={access.permissions.includes(MASTERDATA_PERMISSIONS.WRITE)}
     canQueue={access.permissions.includes('switching.write')}
   />
 }

 const outboundDispatchEvents = outboundRequest ? await listOutboundDispatchEventsByRequestIds([outboundRequest.id]) : []

 const stuckReason = explainWhySwitchIsStuck({
 activation,
 request,
 readiness,
 outboundRequest,
 })

 const tidslinje = buildTimeline({
 request,
 switchEvents,
 outboundRequest,
 outboundDispatchEvents,
 edielMessages,
 })

 const validationSummary = readValidationSnapshot(request.validation_snapshot)

 const z03Messages = edielMessages.filter((row) => row.message_code === 'Z03')
 const z05Messages = edielMessages.filter((row) => row.message_code === 'Z05')
 const z09Messages = edielMessages.filter((row) => row.message_code === 'Z09')

 return (
 <div className="min-h-screen">
 <AdminHeader
 title={supplierSwitchRequestTypeLabel(request.request_type)}
 subtitle="Tidslinje, utskick, validering och slutföring för ärendet."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
 {formatStatusLabel(request.status)}
 </span>
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(lifecycle.stage)}`}>
 {lifecycle.label}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {request.request_type}
 </span>
 </div>

 <h1 className="mt-3 text-2xl font-semibold text-slate-950 ">
 Leverantörsbyteärende {request.id}
 </h1>

 <p className="mt-2 text-sm text-slate-700 ">
 Kund <CustomerName id={request.customer_id} /> · Anläggning {siteName(site)} · Mätpunkt{' '}
 {meteringPointName(meteringPoint)}
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/operations/switches"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Tillbaka till leverantörsbyten
 </Link>
 {customerHref ? <Link
 href={customerHref}
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna kundkort
 </Link> : null}
 </div>
 </div>
 </section>

 <section className="grid gap-4 xl:grid-cols-5">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Flödesstatus</div>
 <div className="mt-2 text-lg font-semibold text-slate-950 ">
 {lifecycle.label}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 {lifecycle.reason}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Varför sitter den fast</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {stuckReason}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Senaste utskickförsök</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {summarizeDispatchAttempt(outboundRequest)}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Beredskap</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {readiness ? (readiness.isReady ? 'Redo för byte' : 'Ej redo') : 'Kunde inte beräkna'}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 {readiness
 ? readiness.isReady
 ? 'Inga aktiva blockers.'
 : summarizeReadinessIssues(readiness)
 : 'Anläggning saknas eller kunde inte läsas.'}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Senaste validering</div>
 <div className="mt-2 text-sm font-semibold text-slate-950 ">
 {validationSummary.isReady === null
 ? 'Inte körd ännu'
 : validationSummary.isReady
 ? 'Redo för hantering'
 : 'Kräver granskning'}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 {validationSummary.validatedAt
 ? `${formatDateTime(validationSummary.validatedAt)} · ${validationSummary.issueCount} issues`
 : 'Ingen kontroll har gjorts ännu.'}
 </div>
 </div>
 </section>

 <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
 <div className="space-y-6">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Ärendedetaljer
 </h2>

 <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Nuvarande leverantör</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.current_supplier_name ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Inkommande leverantör</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.incoming_supplier_name}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Nätägare</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {gridOwnerName(gridOwner)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Startdatum</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.requested_start_date ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Tidsstämplar
 </div>
 <div className="mt-3 space-y-2 text-sm text-slate-700 ">
 <div>Skapad: <span className="font-medium">{formatDateTime(request.created_at)}</span></div>
 <div>Submitted: <span className="font-medium">{formatDateTime(request.submitted_at)}</span></div>
 <div>Completed: <span className="font-medium">{formatDateTime(request.completed_at)}</span></div>
 <div>Failed: <span className="font-medium">{formatDateTime(request.failed_at)}</span></div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Identifierare
 </div>
 <div className="mt-3 space-y-2 text-sm text-slate-700 ">
 <div>Kund: <span className="font-medium"><CustomerName id={request.customer_id} /></span></div>
 <div>Site ID: <span className="font-medium">{request.site_id}</span></div>
 <div>Mätpunkt ID: <span className="font-medium">{request.metering_point_id}</span></div>
 <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
 </div>
 </div>
 </div>

 {request.failure_reason ? (
 <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ">
 {request.failure_reason}
 </div>
 ) : null}
 {request.pause_reason ? (
 <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
 <strong>Pausorsak</strong> {request.pause_reason}
 </div>
 ) : null}
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Pre-processing validation
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Steg 7.11 kör en live-validering mot databasen, sparar validation_snapshot och loggar resultatet innan vidare processing.
 </p>
 </div>

 <form action={validateSupplierSwitchBeforeProcessingAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 {request.status === 'draft'
 ? 'Validera och markera redo'
 : 'Kör om validering'}
 </button>
 </form>
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Validation state</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {validationSummary.isReady === null
 ? 'Inte körd ännu'
 : validationSummary.isReady
 ? 'Redo för hantering'
 : 'Kräver granskning'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Validerad</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {validationSummary.validatedAt
 ? formatDateTime(validationSummary.validatedAt)
 : '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Antal avvikelser</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {validationSummary.issueCount}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Snapshot mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {validationSummary.matchedMeterPointId ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Snapshotdetaljer
 </div>
 <div className="mt-3 space-y-2 text-sm text-slate-700 ">
 <div>Anläggningsstatus: <span className="font-medium">{validationSummary.siteStatus ?? '—'}</span></div>
 <div>Prisområde: <span className="font-medium">{validationSummary.priceAreaCode ?? '—'}</span></div>
 <div>Fullmakt: <span className="font-medium">{validationSummary.latestPowerOfAttorneyStatus ?? '—'}</span></div>
 <div>Beredskap live nu: <span className="font-medium">{readiness ? (readiness.isReady ? 'Redo för hantering' : 'Kräver granskning') : '—'}</span></div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 ">
 <div className="text-sm font-semibold text-slate-900 ">
 Valideringsresultat
 </div>
 <div className="mt-3 text-sm text-slate-700 ">
 {!readiness ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">Anläggningen saknas eller kunde inte läsas. Uppgifterna behöver kontrolleras.</p> : !readiness.isReady ? (
 <div className="space-y-2">
 {readiness.issues.map((issue) => (
 <div key={issue.code} className="rounded-2xl bg-red-50 px-3 py-2 text-red-700 ">
 <div className="font-medium">{issue.title}</div>
 <div className="mt-1 text-xs">{issue.description}</div>
 </div>
 ))}
 </div>
 ) : (
 <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-700 ">
 Inga aktiva blockerare. Ärendet kan gå vidare i hanteringsflödet.
 </div>
 )}
 </div>
 </div>
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Slutför leverantörsbyte
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Slutför leverantörsbytet internt. Anläggningen får ny aktuell leverantör, mätpunkten synkas och ärendet markeras som klart.
 </p>
 </div>

 {canActivate ? (
 <form action={finalizeSupplierSwitchExecutionAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
 Slutför byte nu
 </button>
 </form>
 ) : (
 <span className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 {activation?.code === 'lifecycle_held'
   ? activation.reason
   : lifecycle.stage === 'ready_to_execute'
   ? 'Aktivering är inte tillgänglig för ditt konto i detta bolag.'
   : 'Väntar på kvalificerad bekräftelse och uppnådd leveransstart'}
 </span>
 )}
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Aktuell flödesstatus</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {lifecycle.label}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Ärendestatus</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {formatStatusLabel(request.status)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Utskicksstatus</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {outboundRequest?.status ?? "Inget utskick"}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Ny leverantör på site</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.incoming_supplier_name}
 </div>
 </div>
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex items-center justify-between gap-4">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Utskick
 </h2>

 <Link
 href="/admin/outbound"
 className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline "
 >
 Öppna utskick
 </Link>
 </div>

 {!outboundRequest ? (
 <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inget utskick finns ännu för det här leverantörsbytet.
 <div className="mt-4">
 <form action={queueSupplierSwitchOutboundAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Förbered utskick nu
 </button>
 </form>
 </div>
 </div>
 ) : (
 <div className="mt-5 space-y-5">
 <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Status</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {formatStatusLabel(outboundRequest.status)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Kanal</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {outboundRequest.channel_type}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Route</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {outboundRequest.communication_route_id ?? '—'}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Försök</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {outboundRequest.attempts_count}
 </div>
 </div>
 </div>

 <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 {outboundRequest.status === 'queued' ? (
 <form action={updateOutboundRequestStatusAction}>
 <input type="hidden" name="outbound_request_id" value={outboundRequest.id} />
 <input type="hidden" name="customer_id" value={request.customer_id} />
 <input type="hidden" name="original_status" value={outboundRequest.status} />
 <input type="hidden" name="status" value="prepared" />
 <input type="hidden" name="dispatch_step" value="prepare" />
 <button className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered
 </button>
 </form>
 ) : null}

 <ManualOutboundDeliveryForm
   request={outboundRequest}
   action={updateOutboundRequestStatusAction}
   linkedOriginal={edielMessages.some(message => message.direction === 'outbound'
     && (message.outbound_request_id === outboundRequest.id
       || (message.message_family === 'PRODAT' && message.message_code === 'Z03')))}
 />

 {retrySelection ? (
 <form action={retryOutboundFromSwitchDetailAction}>
 <SupplierSwitchRetryFields selection={retrySelection} />
 <button className="w-full rounded-2xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 ">
 Försök skicka igen
 </button>
 </form>
 ) : null}
 </div>

 {outboundRequest.failure_reason ? (
 <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ">
 {outboundRequest.failure_reason}
 </div>
 ) : null}
 </div>
 )}
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Ediel direkt från switchdetaljen
 </h2>
 <p className="mt-2 text-sm text-slate-700 ">
 Här använder du samma switchrequest som i operations, utan parallellt flöde. Actions går mot samma Ediel orchestrator och samma route resolution.
 </p>

 <div className="mt-5 grid gap-4 md:grid-cols-3">
 <form action={prepareSwitchZ03Action} className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <input type="hidden" name="switchRequestId" value={request.id} />
 <input type="hidden" name="forceRegenerate" value="true" />
 <div className="text-sm font-semibold text-slate-900 ">Förbered Z03</div>
 <p className="mt-2 text-sm text-slate-700 ">
 Skapar outbound PRODAT Z03 från exakt detta switchärende.
 </p>
 <div className="mt-3 text-xs text-slate-700 ">
 Befintliga Z03: {z03Messages.length}
 </div>
 <button className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Förbered Z03
 </button>
 </form>

 <form action={prepareSwitchZ05Action} className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <input type="hidden" name="switchRequestId" value={request.id} />
 <div className="text-sm font-semibold text-slate-900 ">Förbered Z05</div>
 <p className="mt-2 text-sm text-slate-700 ">
 Skapar outbound PRODAT Z05 från exakt detta switchärende.
 </p>
 <div className="mt-3 text-xs text-slate-700 ">
 Befintliga Z05: {z05Messages.length}
 </div>
 <button className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered Z05
 </button>
 </form>

 <form action={prepareSwitchZ09Action} className="rounded-2xl border border-slate-200 bg-white p-4 ">
 <input type="hidden" name="switchRequestId" value={request.id} />
 <div className="text-sm font-semibold text-slate-900 ">Förbered Z09</div>
 <p className="mt-2 text-sm text-slate-700 ">
 Skapar outbound PRODAT Z09 från exakt detta switchärende.
 </p>
 <div className="mt-3 text-xs text-slate-700 ">
 Befintliga Z09: {z09Messages.length}
 </div>
 <button className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 ">
 Förbered Z09
 </button>
 </form>
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex items-center justify-between gap-4">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kopplade meddelanden
 </h2>

 </div>

 <div className="mt-5 space-y-4">
 {edielMessages.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga kopplade Ediel-meddelanden ännu.
 </div>
 ) : (
 edielMessages.map((message) => (
 <div
 key={message.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(message.status)}`}>
 {formatStatusLabel(message.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {message.direction}
 </span>
 </div>
 <div className="mt-3 text-sm font-semibold text-slate-900 ">
 {edielTitle(message)}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 Ref: {message.external_reference ?? '—'} · Version {message.message_version ?? '—'}
 </div>
 </div>

 <div className="text-right text-xs text-slate-700 ">
 <div>{formatDateTime(edielOccurredAt(message))}</div>
 <div className="mt-1 break-all">{message.id}</div>
 </div>
 </div>

 <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
 <div>Avsändare: <span className="font-medium">{message.sender_ediel_id ?? '—'}</span></div>
 <div>Mottagare: <span className="font-medium">{message.receiver_ediel_id ?? '—'}</span></div>
 <div>Meddelandereferens: <span className="font-medium">{message.interchange_reference ?? '—'}</span></div>
 <div>Transaktionsreferens: <span className="font-medium">{message.transaction_reference ?? '—'}</span></div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <Link
 href={`/admin/messages/${message.id}`}
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna meddelande
 </Link>

 {['draft', 'prepared', 'queued'].includes(message.status) ? (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Skicka nu
 </button>
 </form>
 ) : null}
 </div>
 </div>
 ))
 )}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Timeline
 </h2>

 <div className="mt-5 space-y-3">
 {tidslinje.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Ingen tidslinje ännu.
 </div>
 ) : (
 tidslinje.map((entry) => (
 <div
 key={entry.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 {entry.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {entry.description}
 </div>
 </div>

 <div className="text-right">
 <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone(entry.status)}`}>
 {formatStatusLabel(entry.status)}
 </span>
 <div className="mt-2 text-xs text-slate-700 ">
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
 {canUpdateManualStatus ? (
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Uppdatera switchstatus
 </h2>

 <form
 action={updateSupplierSwitchStatusFromAdminAction}
 className="mt-5 space-y-3"
 >
 <input type="hidden" name="request_id" value={request.id} />
 <input type="hidden" name="expected_status" value={request.status} />
 <input type="hidden" name="expected_updated_at" value={request.updated_at} />

 <select
 name="status"
 aria-label="Status"
 defaultValue={request.status}
 className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm "
 >
 {manualSwitchStatusOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
 </select>

 <input
 name="external_reference"
 defaultValue={request.external_reference ?? ''}
 placeholder="Extern referens"
 className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm "
 />

 <textarea
 name="failure_reason"
 defaultValue={request.failure_reason ?? ''}
 placeholder="Felorsak"
 rows={4}
 className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm "
 />

 <button className="w-full rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Spara switchstatus
 </button>
 </form>
 </div>
 ) : null}

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Senaste switch-events
 </h2>

 <div className="mt-5 space-y-3">
 {switchEvents.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga switch-events ännu.
 </div>
 ) : (
 switchEvents.slice(0, 8).map((event) => (
 <div
 key={event.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(event.event_status)}`}>
 {event.event_status}
 </span>
 <span className="text-xs text-slate-700 ">
 {formatDateTime(event.created_at)}
 </span>
 </div>

 <div className="mt-3 text-sm font-medium text-slate-900 ">
 {event.event_type}
 </div>

 <div className="mt-1 text-sm text-slate-700 ">
 {event.message ?? '—'}
 </div>
 </div>
 ))
 )}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Dispatch-events
 </h2>

 <div className="mt-5 space-y-3">
 {outboundDispatchEvents.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga utskick-events ännu.
 </div>
 ) : (
 outboundDispatchEvents.map((event) => (
 <div
 key={event.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(event.event_status)}`}>
 {event.event_status}
 </span>
 <span className="text-xs text-slate-700 ">
 {formatDateTime(event.created_at)}
 </span>
 </div>

 <div className="mt-3 text-sm font-medium text-slate-900 ">
 {event.event_type}
 </div>

 <div className="mt-1 text-sm text-slate-700 ">
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