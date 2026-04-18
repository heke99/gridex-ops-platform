// components/admin/customers/billing-metering/shared.tsx
'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { PeriodRange } from './utils'

export function SubmitButton({
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

export function QuickActionButton({
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

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
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

export function RecommendationBox({
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

export function SmartSelectionFields({
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
  const filteredMeteringPoints = siteId
    ? meteringPoints.filter((point) => point.site_id === siteId)
    : meteringPoints

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