// components/admin/customers/CustomerBillingMeteringCard.tsx
'use client'

import { useMemo } from 'react'
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
import {
 createGridOwnerDataRequestAction,
 createPartnerExportAction,
} from '@/app/admin/customers/[id]/actions'
import { queueOutboundRequestAction } from '@/app/admin/cis/actions'
import { buildCustomerTimeline } from '@/lib/operations/timeline'
import {
 buildUnderlayMap,
 inferDefaultPeriod,
 inferredGridOwnerId,
 latestMeteringPointId,
 latestSiteId,
 splitPartnerExports,
} from './billing-metering/utils'
import { GRIDEX_TENANT_BUSINESS_ACTIONS } from '@/lib/ediel/businessLabels'
import {
 QuickActionButton,
 SectionCard,
} from './billing-metering/shared'
import {
 SmartDataRequestForm,
 SmartOutboundForm,
 SmartPartnerExportForm,
} from './billing-metering/forms'
import {
 CustomerBillingUnderlaysPanel,
 CustomerDataRequestsPanel,
 CustomerMeteringValuesPanel,
 CustomerOperationalSignalPanel,
 CustomerOutboundHistoryPanel,
 CustomerPartnerExportsPanel,
 CustomerTimelinePanel,
} from './billing-metering/panels'

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

export default function CustomerBillingMeteringCard({
 customerId,
 sites,
 meteringPoints,
 gridOwners,
 dataRequests,
 meteringValues,
 billingUnderlays,
 partnerExports,
 outboundRequests,
 isPlatformAdmin = false,
}: Props) {
 const unresolvedOutbound = outboundRequests.filter(
 (request) => request.channel_type === 'unresolved'
 )

 const openDataRequests = dataRequests.filter((request) =>
 ['pending', 'sent'].includes(request.status)
 )

 const readyUnderlaysWithoutExport = billingUnderlays.filter((underlay) => {
 if (!['received', 'validated'].includes(underlay.status)) return false

 return !partnerExports.some(
 (exportRow) =>
 exportRow.billing_underlay_id === underlay.id &&
 ['queued', 'sent', 'acknowledged'].includes(exportRow.status)
 )
 })

 const openMeterValueRequests = dataRequests.filter(
 (request) =>
 request.request_scope === 'meter_values' &&
 ['pending', 'sent'].includes(request.status)
 )

 const openBillingRequests = dataRequests.filter(
 (request) =>
 request.request_scope === 'billing_underlay' &&
 ['pending', 'sent'].includes(request.status)
 )

 const openMasterdataRequests = dataRequests.filter(
 (request) =>
 request.request_scope === 'customer_masterdata' &&
 ['pending', 'sent'].includes(request.status)
 )

 const queuedMeterValueOutbound = outboundRequests.filter(
 (request) => request.request_type === 'meter_values'
 )

 const queuedBillingOutbound = outboundRequests.filter(
 (request) => request.request_type === 'billing_underlay'
 )

 const { billingExports, meteringExports, customerSnapshotExports } =
 splitPartnerExports(partnerExports)

 const underlayById = useMemo(
 () => buildUnderlayMap(billingUnderlays),
 [billingUnderlays]
 )

 const timeline = useMemo(
 () =>
 buildCustomerTimeline({
 sites,
 meteringPoints,
 dataRequests,
 meteringValues,
 billingUnderlays,
 partnerExports,
 outboundRequests,
 }),
 [
 sites,
 meteringPoints,
 dataRequests,
 meteringValues,
 billingUnderlays,
 partnerExports,
 outboundRequests,
 ]
 )

 const defaultSiteId = latestSiteId(sites)
 const defaultMeteringPointId = latestMeteringPointId(meteringPoints)
 const defaultGridOwnerId = inferredGridOwnerId(sites, meteringPoints)
 const defaultPeriod = inferDefaultPeriod()
 const blockedUnderlays = billingUnderlays.filter((underlay) =>
 ['blocked', 'failed', 'needs_review', 'pricing_failed'].includes(String(underlay.readiness_status ?? underlay.status ?? ''))
 )
 const sentExports = partnerExports.filter((exportRow) =>
 ['queued', 'sent', 'acknowledged'].includes(exportRow.status)
 )
 const latestUnderlay = [...billingUnderlays].sort((a, b) =>
 new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
 )[0] ?? null
 const billingStatusLabel = blockedUnderlays.length > 0
 ? GRIDEX_TENANT_BUSINESS_ACTIONS.requiresAction
 : sentExports.length > 0
 ? GRIDEX_TENANT_BUSINESS_ACTIONS.billingSentToPartner
 : billingUnderlays.length > 0
 ? 'Underlag klart'
 : meteringValues.length > 0
 ? GRIDEX_TENANT_BUSINESS_ACTIONS.billingAutomatic
 : GRIDEX_TENANT_BUSINESS_ACTIONS.waitingForMeteringValues

 if (!isPlatformAdmin) {
 return (
 <section className="space-y-6">
 <SectionCard
 title="Fakturering"
 description="Mätvärden och fakturaunderlag hanteras automatiskt. Du behöver bara agera om systemet markerar en avvikelse."
 >
 <div className="space-y-4">
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
 <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Status</div>
 <div className="mt-2 text-xl font-semibold text-slate-950">{billingStatusLabel}</div>
 <p className="mt-2 text-sm leading-6 text-slate-700">
 Systemet tar emot mätvärden från nätägaren, skapar fakturaunderlag i bakgrunden och skickar färdigt underlag till fakturapartner när perioden är komplett.
 </p>
 </div>
 <div className="grid gap-3 sm:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Senaste period</div>
 <div className="mt-2 text-lg font-semibold text-slate-950">{latestUnderlay ? `${latestUnderlay.underlay_year ?? '—'}-${String(latestUnderlay.underlay_month ?? '').padStart(2, '0')}` : 'Inväntar data'}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Underlag</div>
 <div className="mt-2 text-lg font-semibold text-slate-950">{billingUnderlays.length > 0 ? 'Skapat' : 'Skapas automatiskt'}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Avvikelser</div>
 <div className="mt-2 text-lg font-semibold text-slate-950">{blockedUnderlays.length > 0 ? 'Kräver åtgärd' : 'Inga kända'}</div>
 </div>
 </div>
 {blockedUnderlays.length > 0 ? (
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
 <div className="font-semibold">Fakturering kräver åtgärd</div>
 <p className="mt-1">Det finns mätvärden eller fakturaunderlag som inte kan skickas automatiskt. Kontrollera arbetskön eller kontakta plattformsadministratör.</p>
 </div>
 ) : null}
 </div>
 </SectionCard>
 </section>
 )
 }

 return (
 <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
 <div className="space-y-6">
 <SectionCard
 title="Fakturering"
 description="Mätvärden och fakturaunderlag hanteras automatiskt. Du behöver bara agera om systemet markerar en avvikelse."
 >
 <div className="space-y-4">
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
 <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Status</div>
 <div className="mt-2 text-xl font-semibold text-slate-950">{billingStatusLabel}</div>
 <p className="mt-2 text-sm leading-6 text-slate-700">
 Systemet tar emot mätvärden från nätägaren, skapar fakturaunderlag i bakgrunden och skickar färdigt underlag till fakturapartner när perioden är komplett.
 </p>
 </div>
 <div className="grid gap-3 sm:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Mätvärden</div>
 <div className="mt-2 text-2xl font-semibold text-slate-950">{meteringValues.length}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Underlag</div>
 <div className="mt-2 text-2xl font-semibold text-slate-950">{billingUnderlays.length}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs uppercase tracking-[0.15em] text-slate-600">Avvikelser</div>
 <div className="mt-2 text-2xl font-semibold text-slate-950">{blockedUnderlays.length}</div>
 </div>
 </div>
 {blockedUnderlays.length > 0 ? (
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
 <div className="font-semibold">Fakturering kräver åtgärd</div>
 <p className="mt-1">Det finns mätvärden eller fakturaunderlag som inte kan skickas automatiskt. Kontrollera arbetskön eller kontakta plattformsadministratör.</p>
 </div>
 ) : null}
 {latestUnderlay ? (
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
 Senaste underlag: {latestUnderlay.underlay_year ?? '—'}-{String(latestUnderlay.underlay_month ?? '').padStart(2, '0')} · status {latestUnderlay.status}
 </div>
 ) : null}
 </div>
 </SectionCard>
 </div>
 <div className="space-y-6">
 <CustomerTimelinePanel
 timeline={timeline}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 />
 <CustomerBillingUnderlaysPanel
 billingUnderlays={billingUnderlays}
 sites={sites}
 meteringPoints={meteringPoints}
 />
 </div>
 </section>
 )
 }
