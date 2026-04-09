'use client'

import { useMemo } from 'react'
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

  if (['exported', 'sent', 'prepared'].includes(status)) {
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

  return (
    <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-6">
        <form
          action={queueOutboundRequestAction}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Köa extern outbound request
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Skapa dispatch-post för leverantörsbyte, mätvärdesförfrågan eller billing-underlag.
              Systemet försöker sedan hitta rätt route per nätägare och scope.
            </p>
          </div>

          <input type="hidden" name="customer_id" value={customerId} />

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Requesttyp
              </span>
              <select
                name="request_type"
                defaultValue="meter_values"
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="supplier_switch">Leverantörsbyte</option>
                <option value="meter_values">Mätvärden</option>
                <option value="billing_underlay">Billing underlag</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Anläggning
              </span>
              <select
                name="site_id"
                defaultValue=""
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
                defaultValue=""
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Ingen specifik mätpunkt</option>
                {meteringPoints.map((point) => (
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
                defaultValue=""
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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Period från
                </span>
                <input
                  name="period_start"
                  type="date"
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Period till
                </span>
                <input
                  name="period_end"
                  type="date"
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
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

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Operativ signal
            </h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
        </div>

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

        <form
          action={createGridOwnerDataRequestAction}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Begär underlag från nätägare
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Köar en request för mätvärden, billing underlag eller masterdata. Själva
              integrationshämtningen kan kopplas in ovanpå detta senare.
            </p>
          </div>

          <input type="hidden" name="customer_id" value={customerId} />

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Scope
              </span>
              <select
                name="request_scope"
                defaultValue="meter_values"
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="meter_values">Mätvärden</option>
                <option value="billing_underlay">Billing underlag</option>
                <option value="customer_masterdata">Masterdataunderlag</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Anläggning
              </span>
              <select
                name="site_id"
                defaultValue=""
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
                defaultValue=""
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Ingen specifik mätpunkt</option>
                {meteringPoints.map((point) => (
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
                defaultValue=""
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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Period från
                </span>
                <input
                  name="requested_period_start"
                  type="date"
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Period till
                </span>
                <input
                  name="requested_period_end"
                  type="date"
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
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

        <form
          action={createPartnerExportAction}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Köa partnerexport
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Skapar en exportpost för billing underlag, mätvärden eller kundsnapshot
              till partnerflödet.
            </p>
          </div>

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

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Anläggning
              </span>
              <select
                name="site_id"
                defaultValue=""
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
                defaultValue=""
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Ingen specifik mätpunkt</option>
                {meteringPoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.meter_point_id}
                  </option>
                ))}
              </select>
            </label>

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
                {billingUnderlays.map((underlay) => (
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {request.request_scope}
                    </span>
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