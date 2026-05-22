import type { BillingExportRunItemRow, BillingExportRunRow } from '@/lib/billing/exportCenter'

export const GRIDEX_BILLING_PARTNER_ADAPTER_KEY = 'gridex_billing_partner_v1'
export const GRIDEX_BILLING_PARTNER_PAYLOAD_VERSION = 'billing_partner_payload_v4c'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export type BillingPartnerPayloadRow = {
  idempotencyKey: string
  payloadVersion: string
  adapterKey: string
  exportRunId: string
  exportRunItemId: string
  billingUnderlayId: string | null
  customerId: string | null
  contractId: string | null
  siteId: string | null
  meteringPointId: string | null
  period: { year: number | null; month: number | null; monthKey: string | null }
  invoice: {
    recipient: string | null
    email: string | null
    reference: string | null
    billingLevel: string | null
    consolidated: boolean
    groupKey: string | null
    address: Record<string, unknown>
    siteAddress: Record<string, unknown>
  }
  amounts: {
    kwh: number | null
    sourceAmountSekExVat: number | null
    calculatedSekExVat: number | null
    vatSek: number | null
    totalSekIncVat: number | null
  }
  pricingLineItems: Array<Record<string, unknown>>
  blockers: Array<Record<string, unknown>>
  raw: Record<string, unknown>
}

export type BillingPartnerPayload = {
  payloadVersion: string
  adapterKey: string
  exportRun: {
    id: string
    companyId: string
    periodMonth: string
    targetSystem: string
    exportFormat: string
    createdAt: string
  }
  rows: BillingPartnerPayloadRow[]
}

function pricingNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const pricing = objectValue(snapshot.pricing)
  return numberValue(pricing[key])
}

export function buildBillingPartnerPayloadRow(params: {
  run: BillingExportRunRow
  item: BillingExportRunItemRow
}): BillingPartnerPayloadRow {
  const snapshot = objectValue(params.item.payload_snapshot)
  const underlay = objectValue(snapshot.underlay)
  const idempotencyKey =
    params.item.idempotency_key ||
    `billing:${params.run.company_id}:${params.run.id}:${params.item.id}`
  const year = numberValue(underlay.underlay_year)
  const month = numberValue(underlay.underlay_month)

  return {
    idempotencyKey,
    payloadVersion: GRIDEX_BILLING_PARTNER_PAYLOAD_VERSION,
    adapterKey: GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
    exportRunId: params.run.id,
    exportRunItemId: params.item.id,
    billingUnderlayId: params.item.billing_underlay_id,
    customerId: params.item.customer_id,
    contractId: params.item.contract_id ?? null,
    siteId: params.item.site_id,
    meteringPointId: params.item.metering_point_id,
    period: {
      year,
      month,
      monthKey: year && month ? `${year}-${String(month).padStart(2, '0')}` : params.run.period_month,
    },
    invoice: {
      recipient: params.item.invoice_recipient ?? null,
      email: params.item.invoice_email ?? null,
      reference: params.item.invoice_reference ?? null,
      billingLevel: params.item.billing_level ?? null,
      consolidated: Boolean(params.item.consolidated_invoice),
      groupKey: params.item.consolidated_invoice_group_key ?? null,
      address: objectValue(params.item.invoice_address_snapshot),
      siteAddress: objectValue(params.item.site_address_snapshot),
    },
    amounts: {
      kwh: numberValue(underlay.total_kwh),
      sourceAmountSekExVat: numberValue(underlay.total_sek_ex_vat),
      calculatedSekExVat: pricingNumber(snapshot, 'subtotalSekExVat'),
      vatSek: pricingNumber(snapshot, 'vatSek'),
      totalSekIncVat: pricingNumber(snapshot, 'totalSekIncVat'),
    },
    pricingLineItems: params.item.pricing_line_items ?? [],
    blockers: params.item.blocker_reasons ?? [],
    raw: {
      underlay,
      contract: objectValue(snapshot.contract),
      readiness: objectValue(snapshot.readiness),
      pricing: objectValue(snapshot.pricing),
    },
  }
}

export function buildBillingPartnerPayload(params: {
  run: BillingExportRunRow
  items: BillingExportRunItemRow[]
}): BillingPartnerPayload {
  return {
    payloadVersion: GRIDEX_BILLING_PARTNER_PAYLOAD_VERSION,
    adapterKey: GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
    exportRun: {
      id: params.run.id,
      companyId: params.run.company_id,
      periodMonth: params.run.period_month,
      targetSystem: params.run.target_system,
      exportFormat: params.run.export_format,
      createdAt: params.run.created_at,
    },
    rows: params.items.map((item) => buildBillingPartnerPayloadRow({ run: params.run, item })),
  }
}
