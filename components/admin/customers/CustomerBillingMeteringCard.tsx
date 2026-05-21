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

 return (
 <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
 <div className="space-y-6">
 <SectionCard
 title="Direktåtgärder för nätägare"
 description="Snabbaste vägen för att begära mätvärden, faktureringsunderlag eller kund- och anläggningsdata utan att fylla hela formuläret varje gång."
 >
 <div className="grid gap-4">
 <div className="grid gap-3 sm:grid-cols-3">
 <form action={createGridOwnerDataRequestAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="request_scope" value="meter_values" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input type="hidden" name="grid_owner_id" value={defaultGridOwnerId} />
 <input type="hidden" name="requested_period_start" value={defaultPeriod.start} />
 <input type="hidden" name="requested_period_end" value={defaultPeriod.end} />
 <input type="hidden" name="notes" value="Snabbåtgärd från kundkort: mätvärden" />
 <QuickActionButton
 idleLabel="Begär mätvärden"
 pendingLabel="Skapar..."
 tone="warning"
 />
 </form>

 <form action={createGridOwnerDataRequestAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="request_scope" value="billing_underlay" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input type="hidden" name="grid_owner_id" value={defaultGridOwnerId} />
 <input type="hidden" name="requested_period_start" value={defaultPeriod.start} />
 <input type="hidden" name="requested_period_end" value={defaultPeriod.end} />
 <input
 type="hidden"
 name="notes"
 value="Snabbåtgärd från kundkort: faktureringsunderlag"
 />
 <QuickActionButton
 idleLabel="Begär faktureringsunderlag"
 pendingLabel="Skapar..."
 tone="warning"
 />
 </form>

 <form action={createGridOwnerDataRequestAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="request_scope" value="customer_masterdata" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input type="hidden" name="grid_owner_id" value={defaultGridOwnerId} />
 <input
 type="hidden"
 name="notes"
 value="Snabbåtgärd från kundkort: kund- och anläggningsdata"
 />
 <QuickActionButton
 idleLabel="Begär kund- och anläggningsdata"
 pendingLabel="Skapar..."
 tone="warning"
 />
 </form>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 ">
 Snabbknapparna använder första tillgängliga anläggning, mätpunkt och nätägare på kunden. Behöver du styra exakt period, mätpunkt eller referens använder du formulären längre ner.
 </div>
 </div>
 </SectionCard>

 <SectionCard
 title="Direktåtgärder för utskick"
 description="Förbered externa utskick direkt för mätvärden eller faktureringsunderlag."
 >
 <div className="grid gap-3 sm:grid-cols-2">
 <form action={queueOutboundRequestAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="request_type" value="meter_values" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input type="hidden" name="grid_owner_id" value={defaultGridOwnerId} />
 <input type="hidden" name="period_start" value={defaultPeriod.start} />
 <input type="hidden" name="period_end" value={defaultPeriod.end} />
 <input
 type="hidden"
 name="payload_note"
 value="Snabbåtgärd från kundkort: utskick av mätvärden"
 />
 <QuickActionButton
 idleLabel="Förbered utskick: mätvärden"
 pendingLabel="Köar..."
 tone="info"
 />
 </form>

 <form action={queueOutboundRequestAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="request_type" value="billing_underlay" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input type="hidden" name="grid_owner_id" value={defaultGridOwnerId} />
 <input type="hidden" name="period_start" value={defaultPeriod.start} />
 <input type="hidden" name="period_end" value={defaultPeriod.end} />
 <input
 type="hidden"
 name="payload_note"
 value="Snabbåtgärd från kundkort: utskick av faktureringsunderlag"
 />
 <QuickActionButton
 idleLabel="Förbered utskick: faktureringsunderlag"
 pendingLabel="Köar..."
 tone="info"
 />
 </form>
 </div>
 </SectionCard>

 <SectionCard
 title="Direktåtgärder för export"
 description="Förbered partnerexporter utan att fylla hela exportformuläret varje gång."
 >
 <div className="grid gap-3 sm:grid-cols-3">
 <form action={createPartnerExportAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="export_kind" value="billing_underlay" />
 <input type="hidden" name="target_system" value="billing_partner" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input
 type="hidden"
 name="notes"
 value="Snabbåtgärd från kundkort: export av faktureringsunderlag"
 />
 <QuickActionButton
 idleLabel="Export: faktureringsunderlag"
 pendingLabel="Skapar..."
 tone="success"
 />
 </form>

 <form action={createPartnerExportAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="export_kind" value="meter_values" />
 <input type="hidden" name="target_system" value="billing_partner" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input
 type="hidden"
 name="notes"
 value="Snabbåtgärd från kundkort: export av mätvärden"
 />
 <QuickActionButton
 idleLabel="Export: mätvärden"
 pendingLabel="Skapar..."
 tone="success"
 />
 </form>

 <form action={createPartnerExportAction} className="contents">
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="export_kind" value="customer_snapshot" />
 <input type="hidden" name="target_system" value="billing_partner" />
 <input type="hidden" name="site_id" value={defaultSiteId} />
 <input type="hidden" name="metering_point_id" value={defaultMeteringPointId} />
 <input
 type="hidden"
 name="notes"
 value="Snabbåtgärd från kundkort: export av kundbild"
 />
 <QuickActionButton
 idleLabel="Export: kundbild"
 pendingLabel="Skapar..."
 tone="success"
 />
 </form>
 </div>
 </SectionCard>

 <CustomerOperationalSignalPanel
 unresolvedOutbound={unresolvedOutbound}
 openDataRequests={openDataRequests}
 readyUnderlaysWithoutExport={readyUnderlaysWithoutExport}
 openMeterValueRequests={openMeterValueRequests}
 openBillingRequests={openBillingRequests}
 openMasterdataRequests={openMasterdataRequests}
 queuedMeterValueOutbound={queuedMeterValueOutbound}
 queuedBillingOutbound={queuedBillingOutbound}
 billingExports={billingExports}
 meteringExports={meteringExports}
 customerSnapshotExports={customerSnapshotExports}
 sites={sites}
 meteringPoints={meteringPoints}
 />

 <SectionCard
 title="Förbered externt utskick"
 description="Styrt formulär: mätpunkter filtreras per vald anläggning, nätägare förifylls och perioden rekommenderas utifrån verklig data."
 >
 <SmartOutboundForm
 customerId={customerId}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 billingUnderlays={billingUnderlays}
 meteringValues={meteringValues}
 />
 </SectionCard>

 <CustomerOutboundHistoryPanel
 outboundRequests={outboundRequests}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 />

 <SectionCard
 title="Begär underlag från nätägare"
 description="Styrt formulär: mätpunkter filtreras per vald anläggning, nätägare förifylls och perioden rekommenderas utifrån verklig data."
 >
 <SmartDataRequestForm
 customerId={customerId}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 billingUnderlays={billingUnderlays}
 meteringValues={meteringValues}
 />
 </SectionCard>

 <SectionCard
 title="Förbered partnerexport"
 description="Styrt formulär: faktureringsunderlag filtreras hårt mot vald anläggning och mätpunkt."
 >
 <SmartPartnerExportForm
 customerId={customerId}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 billingUnderlays={billingUnderlays}
 />
 </SectionCard>
 </div>

 <div className="space-y-6">
 <CustomerTimelinePanel
 timeline={timeline}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 />

 <CustomerDataRequestsPanel
 dataRequests={dataRequests}
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 />

 <CustomerMeteringValuesPanel
 meteringValues={meteringValues}
 meteringPoints={meteringPoints}
 />

 <CustomerBillingUnderlaysPanel
 billingUnderlays={billingUnderlays}
 sites={sites}
 meteringPoints={meteringPoints}
 />

 <CustomerPartnerExportsPanel
 partnerExports={partnerExports}
 underlayById={underlayById}
 sites={sites}
 meteringPoints={meteringPoints}
 />
 </div>
 </section>
 )
}