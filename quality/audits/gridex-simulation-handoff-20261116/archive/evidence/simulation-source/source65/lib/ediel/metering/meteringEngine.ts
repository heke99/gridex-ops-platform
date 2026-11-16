export type MeteringResolution = 'PT15M' | 'PT60M' | 'P1M' | 'P1Y' | 'UNKNOWN'
export type MeteringValueQuality = 'measured' | 'estimated' | 'corrected' | 'missing' | 'unknown'

export type MeteringEngineValueInput = {
  timestamp: string | null
  quantity: number | string | null
  unit?: string | null
  quality?: string | null
  sourceOrder?: number | null
}

export type MeteringEngineIngestInput = {
  companyId: string | null
  sourceMessageId: string | null
  meteringPointId: string | null
  gridAreaId?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  resolution?: string | null
  values: MeteringEngineValueInput[]
}

export type MeteringEngineNormalizedValue = {
  timestamp: string | null
  quantity: number | null
  unit: string | null
  quality: MeteringValueQuality
  sourceOrder: number
}

export type MeteringEngineResult = {
  ok: boolean
  resolution: MeteringResolution
  values: MeteringEngineNormalizedValue[]
  issues: Array<{ severity: 'error' | 'warning'; code: string; message: string }>
  dedupeKey: string
}

function normalizeResolution(value?: string | null): MeteringResolution {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['15', '15M', 'PT15M', 'QUARTER', 'KVART', 'QH'].includes(normalized)) return 'PT15M'
  if (['60', '60M', 'PT60M', 'HOUR', 'TIMME'].includes(normalized)) return 'PT60M'
  if (['M', 'P1M', 'MONTH', 'MÅNAD'].includes(normalized)) return 'P1M'
  if (['Y', 'P1Y', 'YEAR', 'ÅR'].includes(normalized)) return 'P1Y'
  return 'UNKNOWN'
}

function normalizeQuality(value?: string | null): MeteringValueQuality {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['MEASURED', 'MÄTT', 'ACTUAL', 'OK', '136'].includes(normalized)) return 'measured'
  if (['ESTIMATED', 'ESTIMERAD', 'E'].includes(normalized)) return 'estimated'
  if (['CORRECTED', 'RÄTTAD', 'C'].includes(normalized)) return 'corrected'
  if (['MISSING', 'SAKNAS', 'M'].includes(normalized)) return 'missing'
  return 'unknown'
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeMeteringIngest(input: MeteringEngineIngestInput): MeteringEngineResult {
  const issues: MeteringEngineResult['issues'] = []
  const resolution = normalizeResolution(input.resolution)

  if (!input.companyId) {
    issues.push({ severity: 'error', code: 'company_missing', message: 'Mätvärden måste alltid kopplas till ett bolag/tenant.' })
  }
  if (!input.meteringPointId) {
    issues.push({ severity: 'error', code: 'metering_point_missing', message: 'Mätvärden måste kopplas till anläggnings-/mätpunkts-id.' })
  }
  if (resolution === 'UNKNOWN') {
    issues.push({ severity: 'warning', code: 'resolution_unknown', message: 'Mätvärdets upplösning kunde inte bestämmas automatiskt.' })
  }

  const values = input.values
    .map((value, index) => ({
      timestamp: value.timestamp ?? null,
      quantity: numberOrNull(value.quantity),
      unit: String(value.unit ?? 'KWH').trim().toUpperCase() || 'KWH',
      quality: normalizeQuality(value.quality),
      sourceOrder: value.sourceOrder ?? index,
    }))
    .sort((a, b) => a.sourceOrder - b.sourceOrder)

  if (values.length === 0) {
    issues.push({ severity: 'warning', code: 'values_empty', message: 'Inga mätvärdesrader hittades i ingest-flödet.' })
  }

  const dedupeKey = [
    input.companyId ?? 'no-company',
    input.sourceMessageId ?? 'no-message',
    input.meteringPointId ?? 'no-metering-point',
    input.periodStart ?? 'no-start',
    input.periodEnd ?? 'no-end',
    resolution,
  ].join('|')

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    resolution,
    values,
    issues,
    dedupeKey,
  }
}
