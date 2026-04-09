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
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

export type CustomerTimelineEntry = {
  id: string
  occurredAt: string
  category:
    | 'site'
    | 'metering_point'
    | 'switch'
    | 'outbound'
    | 'data_request'
    | 'meter_value'
    | 'billing_underlay'
    | 'partner_export'
  title: string
  description: string
  status: string | null
  customerId: string
  siteId: string | null
  meteringPointId: string | null
}

function safeDate(value: string | null | undefined): string | null {
  return value ?? null
}

export function buildCustomerTimeline(params: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  switchRequests: SupplierSwitchRequestRow[]
  outboundRequests: OutboundRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
  meteringValues: MeteringValueRow[]
  billingUnderlays: BillingUnderlayRow[]
  partnerExports: PartnerExportRow[]
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
      description: `${site.site_name ?? 'Anläggning'} registrerad.`,
      status: site.status ?? null,
      customerId: params.customerId,
      siteId: site.id,
      meteringPointId: null,
    })
  }

  for (const point of params.meteringPoints) {
    const occurredAt = safeDate(point.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `metering-point:${point.id}`,
      occurredAt,
      category: 'metering_point',
      title: 'Mätpunkt registrerad',
      description: `${point.meter_point_id ?? point.id} lades till.`,
      status: point.status ?? null,
      customerId: params.customerId,
      siteId: point.site_id,
      meteringPointId: point.id,
    })
  }

  for (const row of params.switchRequests) {
    const occurredAt = safeDate(row.updated_at ?? row.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `switch:${row.id}`,
      occurredAt,
      category: 'switch',
      title: 'Switchärende uppdaterat',
      description: `${row.request_type} · ${
        row.incoming_supplier_name ?? 'okänd leverantör'
      }`,
      status: row.status ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  for (const row of params.outboundRequests) {
    const occurredAt = safeDate(
      row.acknowledged_at ??
        row.failed_at ??
        row.sent_at ??
        row.prepared_at ??
        row.queued_at ??
        row.updated_at ??
        row.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `outbound:${row.id}`,
      occurredAt,
      category: 'outbound',
      title: 'Outbound request',
      description: `${row.request_type} · kanal ${row.channel_type}`,
      status: row.status ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  for (const row of params.dataRequests) {
    const occurredAt = safeDate(
      row.received_at ??
        row.failed_at ??
        row.sent_at ??
        row.requested_at ??
        row.updated_at ??
        row.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `data-request:${row.id}`,
      occurredAt,
      category: 'data_request',
      title: 'Nätägarförfrågan',
      description: `${row.request_scope} mot nätägare`,
      status: row.status ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  for (const row of params.meteringValues) {
    const occurredAt = safeDate(row.read_at ?? row.created_at)
    if (!occurredAt) continue

    entries.push({
      id: `meter-value:${row.id}`,
      occurredAt,
      category: 'meter_value',
      title: 'Mätvärde mottaget',
      description: `${row.reading_type} · ${row.value_kwh} kWh`,
      status: row.quality_code ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  for (const row of params.billingUnderlays) {
    const occurredAt = safeDate(
      row.exported_at ??
        row.validated_at ??
        row.received_at ??
        row.updated_at ??
        row.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `billing-underlay:${row.id}`,
      occurredAt,
      category: 'billing_underlay',
      title: 'Billing-underlag',
      description: `${row.underlay_year ?? '—'}-${String(
        row.underlay_month ?? ''
      ).padStart(2, '0')}`,
      status: row.status ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  for (const row of params.partnerExports) {
    const occurredAt = safeDate(
      row.acknowledged_at ??
        row.failed_at ??
        row.sent_at ??
        row.queued_at ??
        row.updated_at ??
        row.created_at
    )
    if (!occurredAt) continue

    entries.push({
      id: `partner-export:${row.id}`,
      occurredAt,
      category: 'partner_export',
      title: 'Partner-export',
      description: `${row.export_kind} till ${row.target_system}`,
      status: row.status ?? null,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
    })
  }

  return entries.sort((a, b) => {
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  })
}