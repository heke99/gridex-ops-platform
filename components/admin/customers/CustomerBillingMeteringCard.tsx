'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
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

type PeriodRange = {
  start: string
  end: string
  label: string
}

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}

function QuickActionButton({
  idleLabel,
  pendingLabel,
  tone = 'default',
}: {
  idleLabel: string
  pendingLabel: string
  tone?: 'default' | 'warning' | 'info' | 'success'
}) {
  const { pending } = useFormStatus()

  const toneClass =
    tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'
      : tone === 'info'
        ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300'
        : tone === 'success'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300'
          : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
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
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (['received', 'validated', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['exported', 'sent', 'prepared', 'queued'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function siteLabel(siteId: string | null, sites: CustomerSiteRow[]): string {
  if (!siteId) return '—'
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

function meteringPointLabel(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

function gridOwnerLabel(
  gridOwnerId: string | null,
  gridOwners: GridOwnerRow[]
): string {
  if (!gridOwnerId) return '—'
  return gridOwners.find((owner) => owner.id === gridOwnerId)?.name ?? gridOwnerId
}

function badgeTone(kind: string): string {
  switch (kind) {
    case 'outbound':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    case 'data_request':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    case 'meter_value':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'billing_underlay':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
    case 'partner_export':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'
    case 'site':
    case 'metering_point':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function latestSiteId(sites: CustomerSiteRow[]): string {
  return sites[0]?.id ?? ''
}

function latestMeteringPointId(meteringPoints: MeteringPointRow[]): string {
  return meteringPoints[0]?.id ?? ''
}

function inferredGridOwnerId(
  sites: CustomerSiteRow[],
  meteringPoints: MeteringPointRow[]
): string {
  return meteringPoints[0]?.grid_owner_id ?? sites[0]?.grid_owner_id ?? ''
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function inferDefaultPeriod(): PeriodRange {
  const now = new Date()
  const start = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const end = monthStart(new Date(now.getFullYear(), now.getMonth(), 1))
  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
    label: 'Föregående kalendermånad',
  }
}

function inferLatestBillingPeriod(
  billingUnderlays: BillingUnderlayRow[],
  siteId: string,
  meteringPointId: string
): PeriodRange | null {
  const rows = billingUnderlays.filter((row) => {
    if (meteringPointId) return row.metering_point_id === meteringPointId
    if (siteId) return row.site_id === siteId
    return true
  })

  const normalized = rows
    .filter(
      (row) =>
        typeof row.underlay_year === 'number' &&
        typeof row.underlay_month === 'number'
    )
    .sort((a, b) => {
      const aKey = (a.underlay_year ?? 0) * 100 + (a.underlay_month ?? 0)
      const bKey = (b.underlay_year ?? 0) * 100 + (b.underlay_month ?? 0)
      return bKey - aKey
    })

  const latest = normalized[0]
  if (!latest?.underlay_year || !latest?.underlay_month) return null

  const nextStart = monthStart(
    new Date(latest.underlay_year, latest.underlay_month, 1)
  )
  const nextEnd = monthStart(
    new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 1)
  )

  return {
    start: formatDateInput(nextStart),
    end: formatDateInput(nextEnd),
    label: `Nästa saknade månad efter ${latest.underlay_year}-${String(
      latest.underlay_month
    ).padStart(2, '0')}`,
  }
}

function inferLatestMeteringPeriod(
  meteringValues: MeteringValueRow[],
  meteringPointId: string
): PeriodRange | null {
  const rows = meteringPointId
    ? meteringValues.filter((row) => row.metering_point_id === meteringPointId)
    : meteringValues

  const validDates = rows
  .map((row) => (row.read_at ? new Date(row.read_at) : null))
  .filter((value): value is Date => {
    if (!value) return false
    return !Number.isNaN(value.getTime())
  })
  .sort((a, b) => b.getTime() - a.getTime())

  const latest = validDates[0]
  if (!latest) return null

  const nextStart = monthStart(new Date(latest.getFullYear(), latest.getMonth() + 1, 1))
  const nextEnd = monthStart(new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 1))

  return {
    start: formatDateInput(nextStart),
    end: formatDateInput(nextEnd),
    label: `Nästa månad efter senaste mätvärde ${latest.getFullYear()}-${String(
      latest.getMonth() + 1
    ).padStart(2, '0')}`,
  }
}

function bestRecommendedPeriod(params: {
  billingUnderlays: BillingUnderlayRow[]
  meteringValues: MeteringValueRow[]
  siteId: string
  meteringPointId: string
  mode: 'billing' | 'meter_values' | 'generic'
}): PeriodRange {
  if (params.mode === 'billing') {
    return (
      inferLatestBillingPeriod(
        params.billingUnderlays,
        params.siteId,
        params.meteringPointId
      ) ?? inferDefaultPeriod()
    )
  }

  if (params.mode === 'meter_values') {
    return (
      inferLatestMeteringPeriod(params.meteringValues, params.meteringPointId) ??
      inferDefaultPeriod()
    )
  }

  return (
    inferLatestBillingPeriod(
      params.billingUnderlays,
      params.siteId,
      params.meteringPointId
    ) ??
    inferLatestMeteringPeriod(params.meteringValues, params.meteringPointId) ??
    inferDefaultPeriod()
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}

function RecommendationBox({
  period,
  siteName,
  meteringPointName,
  gridOwnerName,
}: {
  period: PeriodRange
  siteName: string
  meteringPointName: string
  gridOwnerName: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 md:col-span-3">
      <div>
        Rekommenderad period:{' '}
        <span className="font-medium text-slate-900 dark:text-white">
          {period.start} → {period.end}
        </span>{' '}
        ({period.label})
      </div>
      <div className="mt-1">
        Vald anläggning:{' '}
        <span className="font-medium text-slate-900 dark:text-white">
          {siteName}
        </span>
      </div>
      <div className="mt-1">
        Vald mätpunkt:{' '}
        <span className="font-medium text-slate-900 dark:text-white">
          {meteringPointName}
        </span>
      </div>
      <div className="mt-1">
        Aktiv nätägare:{' '}
        <span className="font-medium text-slate-900 dark:text-white">
          {gridOwnerName}
        </span>
      </div>
    </div>
  )
}

function SmartSelectionFields({
  sites,
  meteringPoints,
  gridOwners,
  siteId,
  meteringPointId,
  gridOwnerId,
  onSiteIdChange,
  onMeteringPointIdChange,
  onGridOwnerIdChange,
  recommendation,
}: {
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
  siteId: string
  meteringPointId: string
  gridOwnerId: string
  onSiteIdChange: (value: string) => void
  onMeteringPointIdChange: (value: string) => void
  onGridOwnerIdChange: (value: string) => void
  recommendation: PeriodRange
}) {
  const filteredMeteringPoints = useMemo(() => {
    if (!siteId) return meteringPoints
    return meteringPoints.filter((point) => point.site_id === siteId)
  }, [meteringPoints, siteId])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const selectedMeteringPoint =
    meteringPoints.find((point) => point.id === meteringPointId) ?? null
  const selectedGridOwner =
    gridOwners.find((owner) => owner.id === gridOwnerId) ?? null

  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Anläggning
        </span>
        <select
          name="site_id"
          value={siteId}
          onChange={(event) => onSiteIdChange(event.target.value)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
        >
          <option value="">Ingen specifik anläggning</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.site_name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Mätpunkt
        </span>
        <select
          name="metering_point_id"
          value={meteringPointId}
          onChange={(event) => onMeteringPointIdChange(event.target.value)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
        >
          <option value="">Ingen specifik mätpunkt</option>
          {filteredMeteringPoints.map((point) => (
            <option key={point.id} value={point.id}>
              {point.meter_point_id}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Nätägare
        </span>
        <select
          name="grid_owner_id"
          value={gridOwnerId}
          onChange={(event) => onGridOwnerIdChange(event.target.value)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
        >
          <option value="">Välj nätägare</option>
          {gridOwners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>

      <RecommendationBox
        period={recommendation}
        siteName={selectedSite?.site_name ?? '—'}
        meteringPointName={selectedMeteringPoint?.meter_point_id ?? '—'}
        gridOwnerName={selectedGridOwner?.name ?? '—'}
      />
    </>
  )
}

function SmartOutboundForm({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  billingUnderlays,
  meteringValues,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
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
  const [requestType, setRequestType] = useState<'supplier_switch' | 'meter_values' | 'billing_underlay'>('meter_values')

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
              setRequestType(event.target.value as 'supplier_switch' | 'meter_values' | 'billing_underlay')
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
        <SubmitButton
          idleLabel="Köa outbound"
          pendingLabel="Köar outbound..."
        />
      </div>
    </form>
  )
}

function SmartDataRequestForm({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  billingUnderlays,
  meteringValues,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
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
  const [scope, setScope] = useState<'meter_values' | 'billing_underlay' | 'customer_masterdata'>('meter_values')

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
              setScope(event.target.value as 'meter_values' | 'billing_underlay' | 'customer_masterdata')
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
        <SubmitButton
          idleLabel="Köa request"
          pendingLabel="Skapar request..."
        />
      </div>
    </form>
  )
}

function SmartPartnerExportForm({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  billingUnderlays,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
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
        <SubmitButton
          idleLabel="Köa export"
          pendingLabel="Skapar export..."
        />
      </div>
    </form>
  )
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

  const billingExports = partnerExports.filter(
    (row) => row.export_kind === 'billing_underlay'
  )

  const meteringExports = partnerExports.filter(
    (row) => row.export_kind === 'meter_values'
  )

  const customerSnapshotExports = partnerExports.filter(
    (row) => row.export_kind === 'customer_snapshot'
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
          description="Snabbaste vägen för att begära mätvärden, billingunderlag eller masterdata utan att fylla hela formuläret varje gång."
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
                  value="Snabbåtgärd från kundkort: billingunderlag"
                />
                <QuickActionButton
                  idleLabel="Begär billingunderlag"
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
                  value="Snabbåtgärd från kundkort: masterdata"
                />
                <QuickActionButton
                  idleLabel="Begär masterdata"
                  pendingLabel="Skapar..."
                  tone="warning"
                />
              </form>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Snabbknapparna använder första tillgängliga anläggning, mätpunkt och nätägare på kunden. Behöver du styra exakt period, mätpunkt eller referens använder du formulären längre ner.
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Direktåtgärder för outbound"
          description="Köa externa requests direkt för mätvärden eller billingunderlag."
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
                value="Snabbåtgärd från kundkort: outbound meter values"
              />
              <QuickActionButton
                idleLabel="Köa outbound: mätvärden"
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
                value="Snabbåtgärd från kundkort: outbound billing underlay"
              />
              <QuickActionButton
                idleLabel="Köa outbound: billingunderlag"
                pendingLabel="Köar..."
                tone="info"
              />
            </form>
          </div>
        </SectionCard>

        <SectionCard
          title="Direktåtgärder för partnerexport"
          description="Köa partnerexporter utan att behöva fylla hela exportformuläret varje gång."
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
                value="Snabbåtgärd från kundkort: billing underlay export"
              />
              <QuickActionButton
                idleLabel="Export: billingunderlag"
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
                value="Snabbåtgärd från kundkort: meter values export"
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
                value="Snabbåtgärd från kundkort: customer snapshot export"
              />
              <QuickActionButton
                idleLabel="Export: kundsnapshot"
                pendingLabel="Skapar..."
                tone="success"
              />
            </form>
          </div>
        </SectionCard>

        <SectionCard
          title="Operativ signal"
          description="Snabb överblick över det som kräver åtgärd först."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                Unresolved outbound
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {unresolvedOutbound.length}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                Öppna nätägar-requests
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {openDataRequests.length}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                Redo utan export
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {readyUnderlaysWithoutExport.length}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Öppna mätvärdesrequests
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {openMeterValueRequests.length}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Öppna billingrequests
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {openBillingRequests.length}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Öppna masterdatarequests
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {openMasterdataRequests.length}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
              <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                Outbound mätvärden
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {queuedMeterValueOutbound.length}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
              <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                Outbound billingunderlag
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {queuedBillingOutbound.length}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Billingexporter
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {billingExports.length}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Mätvärdesexporter
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {meteringExports.length}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Kundsnapshot-exporter
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {customerSnapshotExports.length}
              </div>
            </div>
          </div>

          {(unresolvedOutbound.length > 0 ||
            openDataRequests.length > 0 ||
            readyUnderlaysWithoutExport.length > 0) && (
            <div className="mt-5 space-y-3">
              {unresolvedOutbound.slice(0, 3).map((request) => (
                <div
                  key={request.id}
                  className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/20 dark:bg-rose-500/10"
                >
                  <div className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                    Outbound saknar route
                  </div>
                  <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {request.request_type} · {siteLabel(request.site_id, sites)} ·{' '}
                    {meteringPointLabel(request.metering_point_id, meteringPoints)}
                  </div>
                </div>
              ))}

              {readyUnderlaysWithoutExport.slice(0, 3).map((underlay) => (
                <div
                  key={underlay.id}
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10"
                >
                  <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    Billing-underlag redo men ej exporterat
                  </div>
                  <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {siteLabel(underlay.site_id, sites)} ·{' '}
                    {meteringPointLabel(underlay.metering_point_id, meteringPoints)} ·{' '}
                    {underlay.underlay_year ?? '—'}-
                    {String(underlay.underlay_month ?? '').padStart(2, '0')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Köa extern outbound request"
          description="Smart formulär: mätpunkter filtreras per vald anläggning, nätägare förifylls och perioden rekommenderas utifrån verklig data."
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

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Outbound historik
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Senaste externa dispatch-requests för kunden.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {outboundRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga outbound requests ännu.
              </div>
            ) : (
              outboundRequests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {request.request_type}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {request.channel_type}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>Skapad: <span className="font-medium">{formatDateTime(request.created_at)}</span></div>
                    <div>Anläggning: <span className="font-medium">{siteLabel(request.site_id, sites)}</span></div>
                    <div>Mätpunkt: <span className="font-medium">{meteringPointLabel(request.metering_point_id, meteringPoints)}</span></div>
                    <div>Nätägare: <span className="font-medium">{gridOwnerLabel(request.grid_owner_id, gridOwners)}</span></div>
                    <div>Period: <span className="font-medium">{request.period_start ?? '—'} → {request.period_end ?? '—'}</span></div>
                    <div>Batch: <span className="font-medium">{request.dispatch_batch_key ?? '—'}</span></div>
                    <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <SectionCard
          title="Begär underlag från nätägare"
          description="Smart formulär: mätpunkter filtreras per vald anläggning, nätägare förifylls och perioden rekommenderas utifrån verklig data."
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
          title="Köa partnerexport"
          description="Smart formulär: billingunderlag filtreras hårt mot vald anläggning och mätpunkt."
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
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Kundtimeline
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {timeline.length} händelser
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {timeline.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Ingen tidslinje ännu.
              </div>
            ) : (
              timeline.slice(0, 14).map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(entry.category)}`}>
                        {entry.category}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(entry.status)}`}>
                        {entry.status ?? 'utan status'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(entry.occurredAt)}
                    </div>
                  </div>

                  <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                    {entry.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {entry.description}
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3">
                    <div>Site: {siteLabel(entry.siteId, sites)}</div>
                    <div>
                      Mätpunkt: {meteringPointLabel(entry.meteringPointId, meteringPoints)}
                    </div>
                    <div>Nätägare: {gridOwnerLabel(entry.gridOwnerId, gridOwners)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Requests mot nätägare
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {dataRequests.length} st
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {dataRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga requests ännu.
              </div>
            ) : (
              dataRequests.slice(0, 8).map((request) => (
                <div
                  key={request.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {request.request_scope}
                    </span>
                    </div>

                    <Link
                      href={`/admin/operations/grid-owner-requests/${request.id}`}
                      className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Öppna detailvy
                    </Link>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      Nätägare:{' '}
                      <span className="font-medium">
                        {gridOwnerLabel(request.grid_owner_id, gridOwners)}
                      </span>
                    </div>
                    <div>
                      Anläggning:{' '}
                      <span className="font-medium">
                        {siteLabel(request.site_id, sites)}
                      </span>
                    </div>
                    <div>
                      Mätpunkt:{' '}
                      <span className="font-medium">
                        {meteringPointLabel(request.metering_point_id, meteringPoints)}
                      </span>
                    </div>
                    <div>
                      Begärd period:{' '}
                      <span className="font-medium">
                        {request.requested_period_start ?? '—'} →{' '}
                        {request.requested_period_end ?? '—'}
                      </span>
                    </div>
                    <div>
                      Skapad:{' '}
                      <span className="font-medium">
                        {formatDateTime(request.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Senaste mätvärden
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {meteringValues.length} rader
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {meteringValues.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga importerade mätvärden ännu.
              </div>
            ) : (
              meteringValues.slice(0, 8).map((value) => (
                <div
                  key={value.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {value.reading_type}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {value.source_system}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      Mätpunkt:{' '}
                      <span className="font-medium">
                        {meteringPointLabel(value.metering_point_id, meteringPoints)}
                      </span>
                    </div>
                    <div>
                      Värde: <span className="font-medium">{value.value_kwh} kWh</span>
                    </div>
                    <div>
                      Tid:{' '}
                      <span className="font-medium">
                        {formatDateTime(value.read_at)}
                      </span>
                    </div>
                    <div>
                      Kvalitet:{' '}
                      <span className="font-medium">
                        {value.quality_code ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Billing underlag
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {billingUnderlays.length} st
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {billingUnderlays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga billing underlag ännu.
              </div>
            ) : (
              billingUnderlays.slice(0, 8).map((underlay) => (
                <div
                  key={underlay.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(underlay.status)}`}>
                      {underlay.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {underlay.underlay_year ?? '—'}-
                      {String(underlay.underlay_month ?? '').padStart(2, '0')}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      Anläggning:{' '}
                      <span className="font-medium">
                        {siteLabel(underlay.site_id, sites)}
                      </span>
                    </div>
                    <div>
                      Mätpunkt:{' '}
                      <span className="font-medium">
                        {meteringPointLabel(underlay.metering_point_id, meteringPoints)}
                      </span>
                    </div>
                    <div>
                      Total kWh:{' '}
                      <span className="font-medium">{underlay.total_kwh ?? '—'}</span>
                    </div>
                    <div>
                      Total ex moms:{' '}
                      <span className="font-medium">
                        {underlay.total_sek_ex_vat ?? '—'} {underlay.currency}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Partnerexporter
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {partnerExports.length} st
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {partnerExports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga partnerexporter ännu.
              </div>
            ) : (
              partnerExports.slice(0, 8).map((exportRow) => (
                <div
                  key={exportRow.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(exportRow.status)}`}>
                      {exportRow.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {exportRow.export_kind}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      Target system:{' '}
                      <span className="font-medium">{exportRow.target_system}</span>
                    </div>
                    <div>
                      Anläggning:{' '}
                      <span className="font-medium">
                        {siteLabel(exportRow.site_id, sites)}
                      </span>
                    </div>
                    <div>
                      Mätpunkt:{' '}
                      <span className="font-medium">
                        {meteringPointLabel(exportRow.metering_point_id, meteringPoints)}
                      </span>
                    </div>
                    <div>
                      Extern referens:{' '}
                      <span className="font-medium">
                        {exportRow.external_reference ?? '—'}
                      </span>
                    </div>
                    <div>
                      Köad:{' '}
                      <span className="font-medium">
                        {formatDateTime(exportRow.queued_at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}