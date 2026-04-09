import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'

export type CustomerTimelineEntry = {
  id: string
  occurredAt: string
  category:
    | 'site'
    | 'metering_point'
    | 'outbound'
    | 'data_request'
    | 'meter_value'
    | 'billing_underlay'
    | 'partner_export'
  title: string
  description: string
  status: string | null
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
}

function safeDate(value: string | null | undefined): string | null {
  return value ?? null
}

export function buildCustomerTimeline(params: {
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  dataRequests: GridOwnerDataRequestRow[]
  meteringValues: MeteringValueRow[]
  billingUnderlays: BillingUnderlayRow[]
  partnerExports: PartnerExportRow[]
  outboundRequests: OutboundRequestRow[]
}): CustomerTimelineEntry[] {
  const entries: CustomerTimelineEntry[] = []

  for (const site of params.sites) {
    const occurredAt = safeDate(site.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `site:${site.id}`,
      occurredAt,
      category: 'site',
      title: 'Anläggning skapad',
      description: site.site_name ?? site.id,
      status: site.status ?? null,
      siteId: site.id,
      meteringPointId: null,
      gridOwnerId: site.grid_owner_id ?? null,
    })
  }

  for (const point of params.meteringPoints) {
    const occurredAt = safeDate(point.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `metering_point:${point.id}`,
      occurredAt,
      category: 'metering_point',
      title: 'Mätpunkt registrerad',
      description: point.meter_point_id ?? point.id,
      status: point.status ?? null,
      siteId: point.site_id,
      meteringPointId: point.id,
      gridOwnerId: point.grid_owner_id ?? null,
    })
  }

  for (const request of params.outboundRequests) {
    const occurredAt = safeDate(
      request.acknowledged_at ??
        request.failed_at ??
        request.sent_at ??
        request.prepared_at ??
        request.queued_at ??
        request.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `outbound:${request.id}`,
      occurredAt,
      category: 'outbound',
      title: 'Outbound request',
      description: `${request.request_type} · ${request.channel_type}`,
      status: request.status,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: request.grid_owner_id,
    })
  }

  for (const request of params.dataRequests) {
    const occurredAt = safeDate(
      request.received_at ??
        request.failed_at ??
        request.sent_at ??
        request.requested_at ??
        request.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `data_request:${request.id}`,
      occurredAt,
      category: 'data_request',
      title: 'Request mot nätägare',
      description: request.request_scope,
      status: request.status,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: request.grid_owner_id,
    })
  }

  for (const value of params.meteringValues) {
    const occurredAt = safeDate(value.read_at ?? value.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `meter_value:${value.id}`,
      occurredAt,
      category: 'meter_value',
      title: 'Mätvärde importerat',
      description: `${value.reading_type} · ${value.value_kwh} kWh`,
      status: value.quality_code ?? null,
      siteId: value.site_id,
      meteringPointId: value.metering_point_id,
      gridOwnerId: value.grid_owner_id,
    })
  }

  for (const underlay of params.billingUnderlays) {
    const occurredAt = safeDate(
      underlay.exported_at ??
        underlay.validated_at ??
        underlay.received_at ??
        underlay.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `billing_underlay:${underlay.id}`,
      occurredAt,
      category: 'billing_underlay',
      title: 'Billing underlag',
      description: `${underlay.underlay_year ?? '—'}-${String(
        underlay.underlay_month ?? ''
      ).padStart(2, '0')}`,
      status: underlay.status,
      siteId: underlay.site_id,
      meteringPointId: underlay.metering_point_id,
      gridOwnerId: underlay.grid_owner_id,
    })
  }

  for (const exportRow of params.partnerExports) {
    const occurredAt = safeDate(
      exportRow.acknowledged_at ??
        exportRow.failed_at ??
        exportRow.sent_at ??
        exportRow.queued_at ??
        exportRow.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `partner_export:${exportRow.id}`,
      occurredAt,
      category: 'partner_export',
      title: 'Partnerexport',
      description: `${exportRow.export_kind} · ${exportRow.target_system}`,
      status: exportRow.status,
      siteId: exportRow.site_id,
      meteringPointId: exportRow.metering_point_id,
      gridOwnerId: null,
    })
  }

  return entries.sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}