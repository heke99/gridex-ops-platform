// components/admin/customers/CustomerBillingMeteringCard.tsx

import Link from 'next/link'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import { GRIDEX_TENANT_BUSINESS_ACTIONS } from '@/lib/ediel/businessLabels'
import type { CustomerMeterImportOutcome } from '@/lib/billing/readCustomerMeterImportOutcomes'
import { meterRequestBillingMonth } from '@/lib/billing/meterRequestBillingPeriod'
import { parseBillingMonth } from '@/lib/time/stockholm'
import { isUuid } from '@/lib/validation/uuid'
import { SectionCard } from './billing-metering/shared'

type Props = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
  dataRequests: GridOwnerDataRequestRow[]
  meteringValues: MeteringValueRow[]
  billingUnderlays: BillingUnderlayRow[]
  partnerExports: PartnerExportRow[]
  outboundRequests: OutboundRequestRow[]
  isPlatformAdmin?: boolean
  canReadBilling?: boolean
  meterImportOutcomes?: CustomerMeterImportOutcome[] | null
}

function rowTime(row: { updated_at?: string | null; created_at?: string | null }) {
  const value = row.updated_at ?? row.created_at ?? ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function underlayPeriod(row: BillingUnderlayRow): string | null {
  const year = row.underlay_year
  const month = row.underlay_month
  if (!year || !month || !Number.isInteger(year) || !Number.isInteger(month) || year < 1 || year > 9999 || month < 1 || month > 12) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function isBlocked(row: BillingUnderlayRow): boolean {
  return row.readiness_status === 'blocked' ||
    row.invoice_readiness_status === 'needs_review' ||
    ['failed', 'needs_review', 'pricing_failed'].includes(row.status)
}

function isInvoiced(row: BillingUnderlayRow): boolean {
  return row.invoice_readiness_status === 'invoiced' || row.invoice_readiness_status === 'exported'
}

const progressLabels = {
  blocked: { status: GRIDEX_TENANT_BUSINESS_ACTIONS.requiresAction, underlay: 'Blockerat' },
  invoiced: { status: 'Fakturerad', underlay: 'Klart' },
  invoiceReady: { status: 'Klar för faktura', underlay: 'Klart' },
  ready: { status: 'Underlag klart', underlay: 'Klart' },
  processing: { status: 'Underlag bearbetas', underlay: 'Bearbetas' },
  missing: { status: GRIDEX_TENANT_BUSINESS_ACTIONS.billingAutomatic, underlay: 'Skapas automatiskt' },
}

function billingProgress(rows: BillingUnderlayRow[]): keyof typeof progressLabels {
  if (rows.length === 0) return 'missing'
  if (rows.some(isBlocked)) return 'blocked'
  if (rows.every(isInvoiced)) return 'invoiced'
  const isReadyForInvoice = (row: BillingUnderlayRow) => isInvoiced(row) || row.invoice_readiness_status === 'ready_for_invoice'
  if (rows.every(isReadyForInvoice)) return 'invoiceReady'
  if (rows.every((row) => isReadyForInvoice(row) || (row.status === 'validated' && row.readiness_status === 'ready'))) return 'ready'
  return 'processing'
}

function billingHref(customerId: string, month: string | null, requestId?: string) {
  const query = new URLSearchParams({ customer: customerId })
  if (month) {
    try {
      query.set('month', parseBillingMonth(month).value)
      if (requestId && isUuid(requestId)) query.set('meterRequest', requestId)
    } catch {
      // Keep the ordinary customer view when a historical period cannot be opened.
    }
  }
  return `/admin/billing?${query}`
}

function requestMatchesUnderlay(request: GridOwnerDataRequestRow, row: BillingUnderlayRow) {
  const siteId = row.customer_site_id ?? row.site_id
  return row.source_request_id === request.id &&
    (!row.company_id || !request.company_id || row.company_id === request.company_id) &&
    (!siteId || !request.site_id || siteId === request.site_id) &&
    (!row.metering_point_id || !request.metering_point_id || row.metering_point_id === request.metering_point_id)
}

const meterRequestStatus = {
  waiting: { status: GRIDEX_TENANT_BUSINESS_ACTIONS.waitingForMeteringValues, metering: 'Inväntas', underlay: 'Inväntar mätvärden' },
  review: { status: GRIDEX_TENANT_BUSINESS_ACTIONS.requiresAction, metering: 'Kräver åtgärd', underlay: 'Inväntar kontroll' },
  importRetry: { status: GRIDEX_TENANT_BUSINESS_ACTIONS.requiresAction, metering: 'Importen behöver ett nytt försök', underlay: 'Inväntar kontroll' },
  imported: { status: 'Mätvärden sparade', metering: 'Importen slutförd', underlay: 'Kontrollera periodens underlag' },
  received: { status: 'Kontrollera mätvärdesimporten', metering: 'Svar mottaget', underlay: 'Inväntar kontroll' },
}

function requestStage(request: GridOwnerDataRequestRow, outcome?: CustomerMeterImportOutcome): keyof typeof meterRequestStatus | null {
  if (request.status === 'failed' || request.readiness_status === 'blocked') return 'review'
  if (outcome?.state === 'retry_required') return 'importRetry'
  if (outcome?.state === 'resolved') return 'imported'
  if (request.status === 'received') return 'received'
  if (request.status === 'pending' || request.status === 'sent') return 'waiting'
  return null
}

export default function CustomerBillingMeteringCard({
  customerId,
  sites,
  meteringPoints,
  dataRequests,
  meteringValues,
  billingUnderlays,
  outboundRequests,
  isPlatformAdmin = false,
  canReadBilling = false,
  meterImportOutcomes,
}: Props) {
  const eligibleOutcomes = new Map((canReadBilling ? meterImportOutcomes ?? [] : []).map((outcome) => [outcome.requestId, outcome]))
  function outcomeFor(request: GridOwnerDataRequestRow) {
    const outcome = eligibleOutcomes.get(request.id)
    return outcome && outcome.siteId === request.site_id && outcome.meteringPointId === request.metering_point_id &&
      outcome.periodStart === request.requested_period_start && outcome.periodEnd === request.requested_period_end ? outcome : undefined
  }
  function periodFor(request: GridOwnerDataRequestRow) {
    if (request.request_scope === 'billing_underlay') return outcomeFor(request)?.billingMonth ?? null
    return meterRequestBillingMonth(request)
  }
  const meterValueRequests = dataRequests.filter((request) =>
    request.request_scope === 'meter_values' || (request.request_scope === 'billing_underlay' && Boolean(outcomeFor(request))),
  )
  const meterValueOutbound = outboundRequests.filter((request) => request.request_type === 'meter_values')
  const latestMeterOutbound = [...meterValueOutbound].sort((a, b) => rowTime(b) - rowTime(a))[0] ?? null
  const customerUnderlays = billingUnderlays.filter((row) => row.customer_id === customerId)
  const underlaysByPeriod = new Map<string, BillingUnderlayRow[]>()
  for (const row of customerUnderlays) {
    const period = underlayPeriod(row)
    if (!period) continue
    const rows = underlaysByPeriod.get(period) ?? []
    rows.push(row)
    underlaysByPeriod.set(period, rows)
  }
  const latestPeriod = [...underlaysByPeriod.keys()].sort().at(-1) ?? null
  const currentRows = latestPeriod ? underlaysByPeriod.get(latestPeriod) ?? [] : []
  const progress = latestPeriod || customerUnderlays.length === 0 ? billingProgress(currentRows) : 'processing'
  const scopedRequests = meterValueRequests.filter((request) => request.customer_id === customerId && request.status !== 'cancelled')
  const openRequests = scopedRequests.filter((request) => {
    const stage = requestStage(request, outcomeFor(request))
    return stage === 'review' || stage === 'waiting' || stage === 'importRetry'
  })
  const requestsForFollowup = openRequests.length > 0 ? openRequests : scopedRequests.filter((request) => {
    const month = periodFor(request)
    return !latestPeriod || Boolean(month && month > latestPeriod)
  })
  const requestMonths = requestsForFollowup.map(periodFor)
  const firstMonth = requestMonths[0] ?? null
  const requestMonth = requestMonths.every((month) => month === firstMonth) ? firstMonth : null
  const linkedRequests = scopedRequests.filter((request) => periodFor(request) === latestPeriod &&
    currentRows.some((row) => requestMatchesUnderlay(request, row)))
  const followupRequest = requestMonth && requestsForFollowup.length === 1 ? requestsForFollowup[0] : null
  const linkedRequest = linkedRequests.length === 1 ? linkedRequests[0] : null
  const focusedRequest = followupRequest ?? linkedRequest
  const focusedMonth = focusedRequest ? periodFor(focusedRequest) : null
  const focusedOutcome = focusedRequest ? outcomeFor(focusedRequest) : undefined
  const focusedStage = focusedRequest ? requestStage(focusedRequest, focusedOutcome) : null
  const focusedStatus = focusedStage ? meterRequestStatus[focusedStage] : null
  const waitingBesideOtherUnderlay = Boolean(followupRequest && (focusedStage === 'waiting' || focusedStage === 'importRetry') &&
    focusedMonth && focusedMonth === latestPeriod &&
    followupRequest.company_id && followupRequest.site_id && followupRequest.metering_point_id &&
    !currentRows.some((row) => requestMatchesUnderlay(followupRequest, row) || (
      row.company_id === followupRequest.company_id &&
      (row.customer_site_id ?? row.site_id) === followupRequest.site_id &&
      row.metering_point_id === followupRequest.metering_point_id
    )))
  const leadingStatus = focusedMonth && (
    !latestPeriod || focusedMonth > latestPeriod || (waitingBesideOtherUnderlay && progress !== 'blocked')
  ) ? focusedStatus : null
  const requestLeads = leadingStatus !== null
  const displayedPeriod = requestLeads ? focusedMonth : latestPeriod
  const primaryRequest = requestLeads || !latestPeriod ? followupRequest : linkedRequest
  const primaryRequestId = primaryRequest?.request_scope === 'meter_values' ? primaryRequest.id : undefined
  const alternateRequestMonth = !requestLeads && latestPeriod &&
    (requestMonth !== latestPeriod || waitingBesideOtherUnderlay) ? requestMonth : null
  const customerSites = new Map(sites.filter((site) => site.customer_id === customerId).map((site) => [site.id, site]))
  const sourceSite = focusedRequest?.site_id ? customerSites.get(focusedRequest.site_id) : undefined
  const requestSite = canReadBilling && focusedRequest?.company_id && sourceSite?.company_id === focusedRequest.company_id
    ? sourceSite : undefined
  const requestPoint = focusedRequest?.metering_point_id && requestSite ? meteringPoints.find((point) =>
    point.id === focusedRequest.metering_point_id &&
    (point.customer_site_id ?? point.site_id) === requestSite.id &&
    (!point.customer_id || point.customer_id === customerId) &&
    point.company_id === focusedRequest.company_id,
  ) : null
  const rowsBySite = new Map<string | null, BillingUnderlayRow[]>()
  for (const row of currentRows) {
    const siteId = row.customer_site_id ?? row.site_id
    const key = siteId && customerSites.has(siteId) ? siteId : null
    const rows = rowsBySite.get(key) ?? []
    rows.push(row)
    rowsBySite.set(key, rows)
  }
  const waitingForMetering = Boolean(
    meterValueRequests.some((request) =>
      (!request.customer_id || request.customer_id === customerId) && requestStage(request) === 'waiting'
    ) ||
      (latestMeterOutbound && ['queued', 'prepared', 'sent'].includes(latestMeterOutbound.status)),
  )
  const unverifiedMeteringLabel = meteringValues.length > 0 ? 'Kontrollera mätvärden' : null
  const hasBlocker = progress === 'blocked'
  const billingStatusLabel = leadingStatus?.status ?? (progress === 'missing'
      ? (waitingForMetering ? GRIDEX_TENANT_BUSINESS_ACTIONS.waitingForMeteringValues : unverifiedMeteringLabel) ?? progressLabels.missing.status
      : progressLabels[progress].status)
  const statusClasses = (requestLeads ? focusedStage !== 'waiting' : hasBlocker)
    ? 'border-amber-200 bg-amber-50'
    : !requestLeads && (progress === 'invoiced' || progress === 'invoiceReady' || progress === 'ready')
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-slate-200 bg-slate-50'
  const latestBlocked = currentRows.filter(isBlocked).sort((a, b) => rowTime(b) - rowTime(a))[0] ?? null
  const blockerReason = latestBlocked
    ? String((latestBlocked as unknown as Record<string, unknown>).billing_block_reason ?? 'Faktureringen kräver granskning innan nästa steg.')
    : null

  return (
    <section>
      <SectionCard
        title="Fakturering"
        description="Status för fakturaunderlaget och den nätägarbegäran som visas."
      >
        <div className="space-y-4">
          {canReadBilling && meterImportOutcomes === null ? <p className="text-sm" role="status">Importstatus kunde inte läsas just nu.</p> : null}
          <div className={`rounded-2xl border p-4 ${statusClasses}`}>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Status</div>
            <div className="mt-2 text-xl font-semibold text-slate-950">{billingStatusLabel}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Mätdata</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">
                {focusedStatus?.metering ?? (waitingForMetering ? 'Inväntas' : unverifiedMeteringLabel ?? 'Automatisk')}
              </div>
              {focusedOutcome?.environment === 'test' ? <p className="text-xs">Testmiljö</p> : null}
              {focusedMonth ? (
                <p className="mt-1 text-xs text-slate-600">
                  Nätägarbegäran för {focusedMonth}{requestSite?.site_name ? ` · ${requestSite.site_name}` : ''}{requestPoint?.meter_point_id ? ` · ${requestPoint.meter_point_id}` : ''}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Underlag</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">
                {leadingStatus?.underlay ?? progressLabels[progress].underlay}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Senaste period</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{displayedPeriod ?? 'Inväntar period'}</div>
              {requestLeads && latestPeriod && latestPeriod !== displayedPeriod ? <p className="mt-1 text-xs text-slate-600">Senaste inlästa underlag: {latestPeriod}</p> : null}
            </div>
          </div>

          {rowsBySite.size > 0 && (customerSites.size > 1 || rowsBySite.has(null)) ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <h3 className="font-semibold text-slate-950">Underlag per anläggning{requestLeads && latestPeriod ? ` för ${latestPeriod}` : ''}</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                {[...rowsBySite].map(([siteId, rows]) => (
                  <div key={siteId ?? 'unresolved'} className="contents">
                    <dt>{(siteId && customerSites.get(siteId)?.site_name) || 'Anläggning behöver kontrolleras'}</dt>
                    <dd className="font-semibold">{progressLabels[billingProgress(rows)].underlay}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {hasBlocker ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="font-semibold">{requestLeads && latestPeriod ? `Underlaget för ${latestPeriod} kräver åtgärd` : 'Kräver åtgärd'}</div>
              <p className="mt-1 leading-6">Kontrollera fakturaunderlaget i Fakturor innan nästa steg.</p>
              {isPlatformAdmin ? <details className="mt-2"><summary className="cursor-pointer font-semibold">Tekniska uppgifter</summary><p className="mt-2 break-words">{blockerReason}</p></details> : null}
            </div>
          ) : null}

          {canReadBilling ? <div className="flex flex-wrap justify-end gap-2">
            {focusedOutcome && requestSite && requestPoint ? (
              <Link
                href={`/admin/operations/grid-owner-requests/${focusedOutcome.requestId}`}
                className="inline-flex rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Öppna nätägarbegäran
              </Link>
            ) : null}
            {requestLeads && hasBlocker && latestPeriod ? (
              <Link
                href={billingHref(customerId, latestPeriod, linkedRequest?.request_scope === 'meter_values' ? linkedRequest.id : undefined)}
                className="inline-flex rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Öppna underlaget för {latestPeriod}
              </Link>
            ) : null}
            {alternateRequestMonth ? (
              <Link
                href={billingHref(customerId, alternateRequestMonth, followupRequest?.request_scope === 'meter_values' ? followupRequest.id : undefined)}
                className="inline-flex rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Öppna fakturor för mätvärdesbegäran {alternateRequestMonth}
              </Link>
            ) : null}
            <Link
              href={billingHref(customerId, displayedPeriod ?? requestMonth, primaryRequestId)}
              className="inline-flex rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Öppna fakturor
            </Link>
          </div> : null}
        </div>
      </SectionCard>
    </section>
  )
}
