// components/admin/customers/CustomerBillingMeteringCard.tsx
'use client'

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
}

function rowTime(row: { updated_at?: string | null; created_at?: string | null }) {
  const value = row.updated_at ?? row.created_at ?? ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function underlayPeriod(row: BillingUnderlayRow | null): string {
  if (!row?.underlay_year || !row?.underlay_month) return 'Inväntar period'
  return `${row.underlay_year}-${String(row.underlay_month).padStart(2, '0')}`
}

export default function CustomerBillingMeteringCard({
  dataRequests,
  meteringValues,
  billingUnderlays,
  outboundRequests,
}: Props) {
  const meterValueRequests = dataRequests.filter(
    (request) => request.request_scope === 'meter_values',
  )
  const latestMeterRequest = [...meterValueRequests].sort(
    (a, b) => rowTime(b) - rowTime(a),
  )[0] ?? null
  const meterValueOutbound = outboundRequests.filter(
    (request) => request.request_type === 'meter_values',
  )
  const latestMeterOutbound = [...meterValueOutbound].sort(
    (a, b) => rowTime(b) - rowTime(a),
  )[0] ?? null
  const latestUnderlay = [...billingUnderlays].sort(
    (a, b) => rowTime(b) - rowTime(a),
  )[0] ?? null

  const readyUnderlays = billingUnderlays.filter(
    (underlay) =>
      underlay.status === 'validated' &&
      String(underlay.readiness_status ?? '') === 'ready',
  )
  const blockedUnderlays = billingUnderlays.filter((underlay) => {
    const readiness = String(underlay.readiness_status ?? '')
    const status = String(underlay.status ?? '')
    return readiness === 'blocked' || ['failed', 'needs_review', 'pricing_failed'].includes(status)
  })

  const waitingForMetering = Boolean(
    (latestMeterRequest && ['pending', 'sent'].includes(latestMeterRequest.status)) ||
      (latestMeterOutbound &&
        ['queued', 'prepared', 'sent'].includes(latestMeterOutbound.status)),
  )
  const hasMeteringValues = meteringValues.length > 0
  const hasReadyUnderlay = readyUnderlays.length > 0
  const hasBlocker = blockedUnderlays.length > 0

  const billingStatusLabel = hasBlocker
    ? GRIDEX_TENANT_BUSINESS_ACTIONS.requiresAction
    : hasReadyUnderlay
      ? 'Underlag klart för fakturering'
      : hasMeteringValues
        ? 'Mätvärden mottagna'
        : waitingForMetering
          ? GRIDEX_TENANT_BUSINESS_ACTIONS.waitingForMeteringValues
          : GRIDEX_TENANT_BUSINESS_ACTIONS.billingAutomatic

  const statusClasses = hasBlocker
    ? 'border-amber-200 bg-amber-50'
    : hasReadyUnderlay
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-slate-200 bg-slate-50'

  const latestBlocked = [...blockedUnderlays].sort(
    (a, b) => rowTime(b) - rowTime(a),
  )[0] ?? null
  const blockerReason = latestBlocked
    ? String(
        (latestBlocked as unknown as Record<string, unknown>).billing_block_reason ??
          'Faktureringen kräver granskning innan nästa steg.',
      )
    : null

  return (
    <section>
      <SectionCard
        title="Fakturering"
        description="Visar bara det som behövs för att förstå kundens faktureringsläge. Teknisk Ediel- och exportdiagnostik hanteras i respektive arbetsyta."
      >
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${statusClasses}`}>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Status
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-950">
              {billingStatusLabel}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">
                Mätdata
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-950">
                {hasMeteringValues
                  ? 'Mottagen'
                  : waitingForMetering
                    ? 'Inväntas'
                    : 'Automatisk'}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">
                Underlag
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-950">
                {hasReadyUnderlay
                  ? 'Klart'
                  : hasBlocker
                    ? 'Blockerat'
                    : billingUnderlays.length > 0
                      ? 'Bearbetas'
                      : 'Skapas automatiskt'}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500">
                Senaste period
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-950">
                {underlayPeriod(latestUnderlay)}
              </div>
            </div>
          </div>

          {hasBlocker ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="font-semibold">Kräver åtgärd</div>
              <p className="mt-1 leading-6">{blockerReason}</p>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </section>
  )
}
