import { normalizeAndStoreMeteringValue, type NormalizedMeteringValueInput } from '@/lib/metering/normalizeMeteringValues'

export type BrpMeteringImportRow = {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  facilityId?: string | null
  priceArea?: string | null
  gridArea?: string | null
  periodStart: string
  periodEnd: string
  resolution?: string | null
  quantityKwh: number
  qualityStatus?: string | null
  sourceReference?: string | null
  lineReference?: string | null
  rawPayload?: Record<string, unknown>
}

export async function importBrpMeteringRows(input: {
  rows: BrpMeteringImportRow[]
  createdBy?: string | null
}) {
  const results = []
  for (const row of input.rows) {
    const normalized: NormalizedMeteringValueInput = {
      companyId: row.companyId,
      customerId: row.customerId ?? null,
      customerSiteId: row.customerSiteId ?? null,
      siteId: row.siteId ?? null,
      meteringPointId: row.meteringPointId ?? null,
      facilityId: row.facilityId ?? null,
      priceArea: row.priceArea ?? null,
      gridArea: row.gridArea ?? null,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      resolution: row.resolution ?? null,
      quantityKwh: row.quantityKwh,
      qualityStatus: row.qualityStatus ?? null,
      sourceType: 'brp_import',
      sourceTransactionReference: row.sourceReference ?? null,
      sourceLineReference: row.lineReference ?? null,
      rawPayload: row.rawPayload ?? {},
      createdBy: input.createdBy ?? null,
    }
    results.push(await normalizeAndStoreMeteringValue(normalized))
  }
  return {
    stored: results.filter((row) => row.status === 'stored').length,
    needsReview: results.filter((row) => row.status === 'needs_review').length,
    duplicates: results.filter((row) => row.status === 'blocked_duplicate').length,
    results,
  }
}
