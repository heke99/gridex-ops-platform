// components/admin/customers/billing-metering/panels.tsx
'use client'

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
import type { CustomerTimelineEntry } from '@/lib/operations/timeline'
import {
  badgeTone,
  formatDateTime,
  gridOwnerLabel,
  meteringPointLabel,
  siteLabel,
  statusTone,
} from './utils'
import { SectionCard } from './shared'

export function CustomerOperationalSignalPanel({
  unresolvedOutbound,
  openDataRequests,
  readyUnderlaysWithoutExport,
  openMeterValueRequests,
  openBillingRequests,
  openMasterdataRequests,
  queuedMeterValueOutbound,
  queuedBillingOutbound,
  billingExports,
  meteringExports,
  customerSnapshotExports,
  sites,
  meteringPoints,
}: {
  unresolvedOutbound: OutboundRequestRow[]
  openDataRequests: GridOwnerDataRequestRow[]
  readyUnderlaysWithoutExport: BillingUnderlayRow[]
  openMeterValueRequests: GridOwnerDataRequestRow[]
  openBillingRequests: GridOwnerDataRequestRow[]
  openMasterdataRequests: GridOwnerDataRequestRow[]
  queuedMeterValueOutbound: OutboundRequestRow[]
  queuedBillingOutbound: OutboundRequestRow[]
  billingExports: PartnerExportRow[]
  meteringExports: PartnerExportRow[]
  customerSnapshotExports: PartnerExportRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}) {
  return (
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
        <SignalStat title="Öppna mätvärdesrequests" value={openMeterValueRequests.length} tone="amber" />
        <SignalStat title="Öppna billingrequests" value={openBillingRequests.length} tone="amber" />
        <SignalStat title="Öppna masterdatarequests" value={openMasterdataRequests.length} tone="amber" />
        <SignalStat title="Outbound mätvärden" value={queuedMeterValueOutbound.length} tone="blue" />
        <SignalStat title="Outbound billingunderlag" value={queuedBillingOutbound.length} tone="blue" />
        <SignalStat title="Billingexporter" value={billingExports.length} tone="emerald" />
        <SignalStat title="Mätvärdesexporter" value={meteringExports.length} tone="emerald" />
        <SignalStat title="Kundsnapshot-exporter" value={customerSnapshotExports.length} tone="emerald" />
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
  )
}

function SignalStat({
  title,
  value,
  tone,
}: {
  title: string
  value: number
  tone: 'amber' | 'blue' | 'emerald'
}) {
  const classes =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200'
        : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200'

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  )
}

export function CustomerOutboundHistoryPanel({
  outboundRequests,
  sites,
  meteringPoints,
  gridOwners,
}: {
  outboundRequests: OutboundRequestRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
}) {
  return (
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
          outboundRequests.map((request) => {
            const primaryHref =
              request.source_type === 'grid_owner_data_request' && request.source_id
                ? `/admin/operations/grid-owner-requests/${request.source_id}`
                : request.source_type === 'supplier_switch_request' &&
                    request.source_id
                  ? `/admin/operations/switches/${request.source_id}`
                  : null

            const primaryLabel =
              request.source_type === 'grid_owner_data_request' && request.source_id
                ? 'Öppna request-detail'
                : request.source_type === 'supplier_switch_request' &&
                    request.source_id
                  ? 'Öppna switch-detail'
                  : null

            return (
              <article
                key={request.id}
                className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
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

                  {primaryHref && primaryLabel ? (
                    <Link
                      href={primaryHref}
                      className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {primaryLabel}
                    </Link>
                  ) : null}
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
            )
          })
        )}
      </div>
    </div>
  )
}

export function CustomerTimelinePanel({
  timeline,
  sites,
  meteringPoints,
  gridOwners,
}: {
  timeline: CustomerTimelineEntry[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
}) {
  return (
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
                <div>Mätpunkt: {meteringPointLabel(entry.meteringPointId, meteringPoints)}</div>
                <div>Nätägare: {gridOwnerLabel(entry.gridOwnerId, gridOwners)}</div>
              </div>

              {entry.href && entry.primaryLabel ? (
                <div className="mt-3">
                  <Link
                    href={entry.href}
                    className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {entry.primaryLabel}
                  </Link>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CustomerDataRequestsPanel({
  dataRequests,
  sites,
  meteringPoints,
  gridOwners,
}: {
  dataRequests: GridOwnerDataRequestRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
}) {
  return (
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
                <div>Nätägare: <span className="font-medium">{gridOwnerLabel(request.grid_owner_id, gridOwners)}</span></div>
                <div>Anläggning: <span className="font-medium">{siteLabel(request.site_id, sites)}</span></div>
                <div>Mätpunkt: <span className="font-medium">{meteringPointLabel(request.metering_point_id, meteringPoints)}</span></div>
                <div>Begärd period: <span className="font-medium">{request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}</span></div>
                <div>Skapad: <span className="font-medium">{formatDateTime(request.created_at)}</span></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CustomerMeteringValuesPanel({
  meteringValues,
  meteringPoints,
}: {
  meteringValues: MeteringValueRow[]
  meteringPoints: MeteringPointRow[]
}) {
  return (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {value.reading_type}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {value.source_system}
                  </span>
                </div>

                {value.source_request_id ? (
                  <Link
                    href={`/admin/operations/grid-owner-requests/${value.source_request_id}`}
                    className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Öppna source request
                  </Link>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                <div>Mätpunkt: <span className="font-medium">{meteringPointLabel(value.metering_point_id, meteringPoints)}</span></div>
                <div>Värde: <span className="font-medium">{value.value_kwh} kWh</span></div>
                <div>Tid: <span className="font-medium">{formatDateTime(value.read_at)}</span></div>
                <div>Kvalitet: <span className="font-medium">{value.quality_code ?? '—'}</span></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CustomerBillingUnderlaysPanel({
  billingUnderlays,
  sites,
  meteringPoints,
}: {
  billingUnderlays: BillingUnderlayRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}) {
  return (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(underlay.status)}`}>
                    {underlay.status}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {underlay.underlay_year ?? '—'}-
                    {String(underlay.underlay_month ?? '').padStart(2, '0')}
                  </span>
                </div>

                {underlay.source_request_id ? (
                  <Link
                    href={`/admin/operations/grid-owner-requests/${underlay.source_request_id}`}
                    className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Öppna source request
                  </Link>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                <div>Anläggning: <span className="font-medium">{siteLabel(underlay.site_id, sites)}</span></div>
                <div>Mätpunkt: <span className="font-medium">{meteringPointLabel(underlay.metering_point_id, meteringPoints)}</span></div>
                <div>Total kWh: <span className="font-medium">{underlay.total_kwh ?? '—'}</span></div>
                <div>Total ex moms: <span className="font-medium">{underlay.total_sek_ex_vat ?? '—'} {underlay.currency}</span></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CustomerPartnerExportsPanel({
  partnerExports,
  underlayById,
  sites,
  meteringPoints,
}: {
  partnerExports: PartnerExportRow[]
  underlayById: Map<string, BillingUnderlayRow>
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}) {
  return (
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
          partnerExports.slice(0, 8).map((exportRow) => {
            const relatedUnderlay = exportRow.billing_underlay_id
              ? underlayById.get(exportRow.billing_underlay_id) ?? null
              : null

            const sourceRequestId = relatedUnderlay?.source_request_id ?? null

            return (
              <div
                key={exportRow.id}
                className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(exportRow.status)}`}>
                      {exportRow.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {exportRow.export_kind}
                    </span>
                  </div>

                  {sourceRequestId ? (
                    <Link
                      href={`/admin/operations/grid-owner-requests/${sourceRequestId}`}
                      className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Öppna source request
                    </Link>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <div>Target system: <span className="font-medium">{exportRow.target_system}</span></div>
                  <div>Anläggning: <span className="font-medium">{siteLabel(exportRow.site_id, sites)}</span></div>
                  <div>Mätpunkt: <span className="font-medium">{meteringPointLabel(exportRow.metering_point_id, meteringPoints)}</span></div>
                  <div>Extern referens: <span className="font-medium">{exportRow.external_reference ?? '—'}</span></div>
                  <div>Köad: <span className="font-medium">{formatDateTime(exportRow.queued_at)}</span></div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}