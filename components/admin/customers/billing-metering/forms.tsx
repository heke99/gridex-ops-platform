// components/admin/customers/billing-metering/forms.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
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
  const [siteId, setSiteId] = useState(latestSiteId(sites))
  const [meteringPointId, setMeteringPointId] = useState(
    latestMeteringPointId(meteringPoints)
  )
  const [gridOwnerId, setGridOwnerId] = useState(
    inferredGridOwnerId(sites, meteringPoints)
  )
  const [requestType, setRequestType] = useState<
    'supplier_switch' | 'meter_values' | 'billing_underlay'
  >('meter_values')

  const filteredMeteringPoints = useMemo(() => {
    if (!siteId) return meteringPoints
    return meteringPoints.filter((point) => point.site_id === siteId)
  }, [meteringPoints, siteId])

  useEffect(() => {
    if (
      meteringPointId &&
      !filteredMeteringPoints.some((point) => point.id === meteringPointId)
    ) {
      setMeteringPointId('')
    }
  }, [filteredMeteringPoints, meteringPointId])

  useEffect(() => {
    const selectedMeteringPoint =
      meteringPoints.find((point) => point.id === meteringPointId) ?? null
    const selectedSite = sites.find((site) => site.id === siteId) ?? null
    const inferred =
      selectedMeteringPoint?.grid_owner_id ?? selectedSite?.grid_owner_id ?? ''

    if (inferred && inferred !== gridOwnerId) {
      setGridOwnerId(inferred)
    }

    if (!selectedMeteringPoint && !selectedSite && gridOwnerId) {
      setGridOwnerId('')
    }
  }, [siteId, meteringPointId, sites, meteringPoints, gridOwnerId])

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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Requesttyp
          </span>
          <select
            name="request_type"
            value={requestType}
            onChange={(event) =>
              setRequestType(
                event.target.value as
                  | 'supplier_switch'
                  | 'meter_values'
                  | 'billing_underlay'
              )
            }
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="supplier_switch">Leverantörsbyte</option>
            <option value="meter_values">Mätvärden</option>
            <option value="billing_underlay">Billing underlag</option>
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Period från
            </span>
            <input
              name="period_start"
              type="date"
              value={recommendedPeriod.start}
              readOnly
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Period till
            </span>
            <input
              name="period_end"
              type="date"
              value={recommendedPeriod.end}
              readOnly
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Extern referens
          </span>
          <input
            name="external_reference"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Payload / notering
          </span>
          <textarea
            name="payload_note"
            rows={3}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>
      </div>

      <div className="mt-6 flex justify-end">
        <SubmitButton idleLabel="Köa outbound" pendingLabel="Köar outbound..." />
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
  const [siteId, setSiteId] = useState(latestSiteId(sites))
  const [meteringPointId, setMeteringPointId] = useState(
    latestMeteringPointId(meteringPoints)
  )
  const [gridOwnerId, setGridOwnerId] = useState(
    inferredGridOwnerId(sites, meteringPoints)
  )
  const [scope, setScope] = useState<
    'meter_values' | 'billing_underlay' | 'customer_masterdata'
  >('meter_values')

  const filteredMeteringPoints = useMemo(() => {
    if (!siteId) return meteringPoints
    return meteringPoints.filter((point) => point.site_id === siteId)
  }, [meteringPoints, siteId])

  useEffect(() => {
    if (
      meteringPointId &&
      !filteredMeteringPoints.some((point) => point.id === meteringPointId)
    ) {
      setMeteringPointId('')
    }
  }, [filteredMeteringPoints, meteringPointId])

  useEffect(() => {
    const selectedMeteringPoint =
      meteringPoints.find((point) => point.id === meteringPointId) ?? null
    const selectedSite = sites.find((site) => site.id === siteId) ?? null
    const inferred =
      selectedMeteringPoint?.grid_owner_id ?? selectedSite?.grid_owner_id ?? ''

    if (inferred && inferred !== gridOwnerId) {
      setGridOwnerId(inferred)
    }

    if (!selectedMeteringPoint && !selectedSite && gridOwnerId) {
      setGridOwnerId('')
    }
  }, [siteId, meteringPointId, sites, meteringPoints, gridOwnerId])

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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Scope
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
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="meter_values">Mätvärden</option>
            <option value="billing_underlay">Billing underlag</option>
            <option value="customer_masterdata">Masterdataunderlag</option>
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Period från
            </span>
            <input
              name="requested_period_start"
              type="date"
              value={recommendedPeriod.start}
              readOnly
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Period till
            </span>
            <input
              name="requested_period_end"
              type="date"
              value={recommendedPeriod.end}
              readOnly
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Extern referens
          </span>
          <input
            name="external_reference"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Notering
          </span>
          <textarea
            name="notes"
            rows={3}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>
      </div>

      <div className="mt-6 flex justify-end">
        <SubmitButton idleLabel="Köa request" pendingLabel="Skapar request..." />
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
  const [siteId, setSiteId] = useState(latestSiteId(sites))
  const [meteringPointId, setMeteringPointId] = useState(
    latestMeteringPointId(meteringPoints)
  )
  const [gridOwnerId, setGridOwnerId] = useState(
    inferredGridOwnerId(sites, meteringPoints)
  )

  const filteredMeteringPoints = useMemo(() => {
    if (!siteId) return meteringPoints
    return meteringPoints.filter((point) => point.site_id === siteId)
  }, [meteringPoints, siteId])

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

  useEffect(() => {
    if (
      meteringPointId &&
      !filteredMeteringPoints.some((point) => point.id === meteringPointId)
    ) {
      setMeteringPointId('')
    }
  }, [filteredMeteringPoints, meteringPointId])

  useEffect(() => {
    const selectedMeteringPoint =
      meteringPoints.find((point) => point.id === meteringPointId) ?? null
    const selectedSite = sites.find((site) => site.id === siteId) ?? null
    const inferred =
      selectedMeteringPoint?.grid_owner_id ?? selectedSite?.grid_owner_id ?? ''

    if (inferred && inferred !== gridOwnerId) {
      setGridOwnerId(inferred)
    }

    if (!selectedMeteringPoint && !selectedSite && gridOwnerId) {
      setGridOwnerId('')
    }
  }, [siteId, meteringPointId, sites, meteringPoints, gridOwnerId])

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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Exporttyp
          </span>
          <select
            name="export_kind"
            defaultValue="billing_underlay"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="billing_underlay">Billing underlag</option>
            <option value="meter_values">Mätvärden</option>
            <option value="customer_snapshot">Customer snapshot</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Target system
          </span>
          <input
            name="target_system"
            defaultValue="billing_partner"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Billing underlag
          </span>
          <select
            name="billing_underlay_id"
            defaultValue=""
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Extern referens
          </span>
          <input
            name="external_reference"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Notering
          </span>
          <textarea
            name="notes"
            rows={3}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>
      </div>

      <div className="mt-6 flex justify-end">
        <SubmitButton idleLabel="Köa export" pendingLabel="Skapar export..." />
      </div>
    </form>
  )
}