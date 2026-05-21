// components/admin/customers/billing-metering/forms.tsx
'use client'

import { useMemo, useState } from 'react'
import type {
 BillingUnderlayRow,
 MeteringValueRow,
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
import {
 bestRecommendedPeriod,
 inferredGridOwnerId,
 latestMeteringPointId,
 latestSiteId,
} from './utils'
import {
 SmartSelectionFields,
 SubmitButton,
} from './shared'

type BaseProps = {
 customerId: string
 sites: CustomerSiteRow[]
 meteringPoints: MeteringPointRow[]
 gridOwners: GridOwnerRow[]
}

type SelectionState = {
 siteId: string
 meteringPointId: string
 gridOwnerId: string
}

function normalizeSelection(
 selection: SelectionState,
 sites: CustomerSiteRow[],
 meteringPoints: MeteringPointRow[]
): SelectionState {
 const availableMeteringPoints = selection.siteId
 ? meteringPoints.filter((point) => point.site_id === selection.siteId)
 : meteringPoints

 const meteringPointId =
 selection.meteringPointId &&
 availableMeteringPoints.some((point) => point.id === selection.meteringPointId)
 ? selection.meteringPointId
 : ''

 const selectedMeteringPoint =
 meteringPoints.find((point) => point.id === meteringPointId) ?? null
 const selectedSite = sites.find((site) => site.id === selection.siteId) ?? null
 const inferredGridOwnerIdValue =
 selectedMeteringPoint?.grid_owner_id ?? selectedSite?.grid_owner_id ?? ''

 return {
 siteId: selection.siteId,
 meteringPointId,
 gridOwnerId: inferredGridOwnerIdValue || (selectedMeteringPoint || selectedSite ? selection.gridOwnerId : ''),
 }
}

function useSmartSelectionState(
 sites: CustomerSiteRow[],
 meteringPoints: MeteringPointRow[]
) {
 const [siteId, setSiteId] = useState(latestSiteId(sites))
 const [meteringPointId, setMeteringPointId] = useState(
 latestMeteringPointId(meteringPoints)
 )
 const [gridOwnerId, setGridOwnerId] = useState(
 inferredGridOwnerId(sites, meteringPoints)
 )

 const selection = useMemo(
 () => normalizeSelection({ siteId, meteringPointId, gridOwnerId }, sites, meteringPoints),
 [gridOwnerId, meteringPointId, meteringPoints, siteId, sites]
 )

 const applySelection = (nextSelection: SelectionState) => {
 const normalized = normalizeSelection(nextSelection, sites, meteringPoints)
 setSiteId(normalized.siteId)
 setMeteringPointId(normalized.meteringPointId)
 setGridOwnerId(normalized.gridOwnerId)
 }

 return {
 ...selection,
 setSiteId: (nextSiteId: string) =>
 applySelection({
 siteId: nextSiteId,
 meteringPointId: selection.meteringPointId,
 gridOwnerId: selection.gridOwnerId,
 }),
 setMeteringPointId: (nextMeteringPointId: string) =>
 applySelection({
 siteId: selection.siteId,
 meteringPointId: nextMeteringPointId,
 gridOwnerId: selection.gridOwnerId,
 }),
 setGridOwnerId: (nextGridOwnerId: string) => {
 setGridOwnerId(nextGridOwnerId)
 },
 }
}

export function SmartOutboundForm({
 customerId,
 sites,
 meteringPoints,
 gridOwners,
 billingUnderlays,
 meteringValues,
}: BaseProps & {
 billingUnderlays: BillingUnderlayRow[]
 meteringValues: MeteringValueRow[]
}) {
 const {
 siteId,
 meteringPointId,
 gridOwnerId,
 setSiteId,
 setMeteringPointId,
 setGridOwnerId,
 } = useSmartSelectionState(sites, meteringPoints)
 const [requestType, setRequestType] = useState<
 'supplier_switch' | 'customer_masterdata' | 'meter_values' | 'billing_underlay'
 >('meter_values')

 const recommendedPeriod = useMemo(
 () =>
 bestRecommendedPeriod({
 billingUnderlays,
 meteringValues,
 siteId,
 meteringPointId,
 mode: requestType === 'billing_underlay' ? 'billing' : 'meter_values',
 }),
 [billingUnderlays, meteringValues, siteId, meteringPointId, requestType]
 )

 return (
 <form action={queueOutboundRequestAction}>
 <input type="hidden" name="customer_id" value={customerId} />

 <div className="grid gap-4">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Typ av begäran
 </span>
 <select
 name="request_type"
 value={requestType}
 onChange={(event) =>
 setRequestType(
 event.target.value as
 | 'supplier_switch'
 | 'customer_masterdata'
 | 'meter_values'
 | 'billing_underlay'
 )
 }
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 >
 <option value="supplier_switch">Leverantörsbyte</option>
 <option value="customer_masterdata">Kund- och anläggningsdata (Z01)</option>
 <option value="meter_values">Mätvärden</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 </select>
 </label>

 <SmartSelectionFields
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 siteId={siteId}
 meteringPointId={meteringPointId}
 gridOwnerId={gridOwnerId}
 onSiteIdChange={setSiteId}
 onMeteringPointIdChange={setMeteringPointId}
 onGridOwnerIdChange={setGridOwnerId}
 recommendation={recommendedPeriod}
 />

 <div className="grid gap-4 sm:grid-cols-2">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Period från
 </span>
 <input
 name="period_start"
 type="date"
 value={recommendedPeriod.start}
 readOnly
 className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm "
 />
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Period till
 </span>
 <input
 name="period_end"
 type="date"
 value={recommendedPeriod.end}
 readOnly
 className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm "
 />
 </label>
 </div>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Extern referens
 </span>
 <input
 name="external_reference"
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 />
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Meddelandenotering
 </span>
 <textarea
 name="payload_note"
 rows={3}
 className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm "
 />
 </label>
 </div>

 <div className="mt-6 flex justify-end">
 <SubmitButton idleLabel="Förbered utskick" pendingLabel="Förbereder utskick..." />
 </div>
 </form>
 )
}

export function SmartDataRequestForm({
 customerId,
 sites,
 meteringPoints,
 gridOwners,
 billingUnderlays,
 meteringValues,
}: BaseProps & {
 billingUnderlays: BillingUnderlayRow[]
 meteringValues: MeteringValueRow[]
}) {
 const {
 siteId,
 meteringPointId,
 gridOwnerId,
 setSiteId,
 setMeteringPointId,
 setGridOwnerId,
 } = useSmartSelectionState(sites, meteringPoints)
 const [scope, setScope] = useState<
 'meter_values' | 'billing_underlay' | 'customer_masterdata'
 >('meter_values')

 const recommendedPeriod = useMemo(
 () =>
 bestRecommendedPeriod({
 billingUnderlays,
 meteringValues,
 siteId,
 meteringPointId,
 mode:
 scope === 'billing_underlay'
 ? 'billing'
 : scope === 'meter_values'
 ? 'meter_values'
 : 'generic',
 }),
 [billingUnderlays, meteringValues, siteId, meteringPointId, scope]
 )

 return (
 <form action={createGridOwnerDataRequestAction}>
 <input type="hidden" name="customer_id" value={customerId} />

 <div className="grid gap-4">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Typ av underlag
 </span>
 <select
 name="request_scope"
 value={scope}
 onChange={(event) =>
 setScope(
 event.target.value as
 | 'meter_values'
 | 'billing_underlay'
 | 'customer_masterdata'
 )
 }
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 >
 <option value="meter_values">Mätvärden</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 <option value="customer_masterdata">Kund- och anläggningsdata (Z01)</option>
 </select>
 </label>

 <SmartSelectionFields
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 siteId={siteId}
 meteringPointId={meteringPointId}
 gridOwnerId={gridOwnerId}
 onSiteIdChange={setSiteId}
 onMeteringPointIdChange={setMeteringPointId}
 onGridOwnerIdChange={setGridOwnerId}
 recommendation={recommendedPeriod}
 />

 <div className="grid gap-4 sm:grid-cols-2">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Period från
 </span>
 <input
 name="requested_period_start"
 type="date"
 value={recommendedPeriod.start}
 readOnly
 className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm "
 />
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Period till
 </span>
 <input
 name="requested_period_end"
 type="date"
 value={recommendedPeriod.end}
 readOnly
 className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm "
 />
 </label>
 </div>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Extern referens
 </span>
 <input
 name="external_reference"
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 />
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Notering
 </span>
 <textarea
 name="notes"
 rows={3}
 className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm "
 />
 </label>
 </div>

 <div className="mt-6 flex justify-end">
 <SubmitButton idleLabel="Skapa begäran" pendingLabel="Skapar begäran..." />
 </div>
 </form>
 )
}

export function SmartPartnerExportForm({
 customerId,
 sites,
 meteringPoints,
 gridOwners,
 billingUnderlays,
}: BaseProps & {
 billingUnderlays: BillingUnderlayRow[]
}) {
 const {
 siteId,
 meteringPointId,
 gridOwnerId,
 setSiteId,
 setMeteringPointId,
 setGridOwnerId,
 } = useSmartSelectionState(sites, meteringPoints)

 const filteredBillingUnderlays = useMemo(() => {
 if (meteringPointId) {
 return billingUnderlays.filter(
 (row) => row.metering_point_id === meteringPointId
 )
 }
 if (siteId) {
 return billingUnderlays.filter((row) => row.site_id === siteId)
 }
 return billingUnderlays
 }, [billingUnderlays, meteringPointId, siteId])

 const recommendedPeriod = useMemo(
 () =>
 bestRecommendedPeriod({
 billingUnderlays,
 meteringValues: [],
 siteId,
 meteringPointId,
 mode: 'billing',
 }),
 [billingUnderlays, siteId, meteringPointId]
 )

 return (
 <form action={createPartnerExportAction}>
 <input type="hidden" name="customer_id" value={customerId} />

 <div className="grid gap-4">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Exporttyp
 </span>
 <select
 name="export_kind"
 defaultValue="billing_underlay"
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 >
 <option value="billing_underlay">Faktureringsunderlag</option>
 <option value="meter_values">Mätvärden</option>
 <option value="customer_snapshot">Kundöversikt</option>
 </select>
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Mottagande system
 </span>
 <input
 name="target_system"
 defaultValue="billing_partner"
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 />
 </label>

 <SmartSelectionFields
 sites={sites}
 meteringPoints={meteringPoints}
 gridOwners={gridOwners}
 siteId={siteId}
 meteringPointId={meteringPointId}
 gridOwnerId={gridOwnerId}
 onSiteIdChange={setSiteId}
 onMeteringPointIdChange={setMeteringPointId}
 onGridOwnerIdChange={setGridOwnerId}
 recommendation={recommendedPeriod}
 />

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Faktureringsunderlag
 </span>
 <select
 name="billing_underlay_id"
 defaultValue=""
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 >
 <option value="">Inget specifikt underlag</option>
 {filteredBillingUnderlays.map((underlay) => (
 <option key={underlay.id} value={underlay.id}>
 {underlay.underlay_year ?? '—'}-{String(
 underlay.underlay_month ?? ''
 ).padStart(2, '0')} • {underlay.status}
 </option>
 ))}
 </select>
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Extern referens
 </span>
 <input
 name="external_reference"
 className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm "
 />
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Notering
 </span>
 <textarea
 name="notes"
 rows={3}
 className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm "
 />
 </label>
 </div>

 <div className="mt-6 flex justify-end">
 <SubmitButton idleLabel="Förbered export" pendingLabel="Skapar export..." />
 </div>
 </form>
 )
}