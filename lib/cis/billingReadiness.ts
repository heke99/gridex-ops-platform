import type {
  BillingUnderlayRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'

export type BillingReadinessStatus =
  | 'ready'
  | 'warning'
  | 'blocked'
  | 'already_exported'
  | 'requires_correction'

export type BillingReadinessIssue = {
  code:
    | 'company_missing'
    | 'tenant_conflict'
    | 'customer_missing'
    | 'period_missing'
    | 'underlay_failed'
    | 'underlay_not_received'
    | 'metering_point_missing'
    | 'meter_values_missing'
    | 'total_kwh_missing'
    | 'amount_missing'
    | 'already_exported'
    | 'correction_after_export'
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
}

export type BillingReadinessResult = {
  underlayId: string
  status: BillingReadinessStatus
  label: string
  isExportable: boolean
  issues: BillingReadinessIssue[]
  matchedMeterValueCount: number
  existingExportId: string | null
  targetAction: 'queue_export' | 'skip_already_exported' | 'review' | 'wait_for_data'
}

function normalizeDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameUnderlayMonth(value: MeteringValueRow, underlay: BillingUnderlayRow): boolean {
  if (!underlay.underlay_year || !underlay.underlay_month) return true

  const date =
    normalizeDate(value.period_start) ??
    normalizeDate(value.period_end) ??
    normalizeDate(value.read_at)

  if (!date) return false

  return (
    date.getUTCFullYear() === underlay.underlay_year &&
    date.getUTCMonth() + 1 === underlay.underlay_month
  )
}

function isCorrectedValue(value: MeteringValueRow): boolean {
  const quality = String(value.quality_code ?? '').toLowerCase()
  const status = String(value.value_status ?? '').toLowerCase()
  const revision = Number(value.revision_number ?? 1)

  return (
    quality.includes('correct') ||
    quality.includes('korr') ||
    quality.includes('rätt') ||
    status === 'current' && revision > 1 ||
    Boolean(value.previous_value_id)
  )
}

function exportReferenceDate(exportRow: PartnerExportRow | null | undefined): Date | null {
  if (!exportRow) return null
  return (
    normalizeDate(exportRow.acknowledged_at) ??
    normalizeDate(exportRow.sent_at) ??
    normalizeDate(exportRow.queued_at) ??
    normalizeDate(exportRow.created_at)
  )
}

export function findMeterValuesForUnderlay(
  underlay: BillingUnderlayRow,
  meterValues: MeteringValueRow[]
): MeteringValueRow[] {
  return meterValues.filter((value) => {
    if (underlay.company_id && value.company_id && underlay.company_id !== value.company_id) {
      return false
    }

    if (underlay.metering_point_id && value.metering_point_id !== underlay.metering_point_id) {
      return false
    }

    if (!underlay.metering_point_id && value.customer_id !== underlay.customer_id) {
      return false
    }

    return isSameUnderlayMonth(value, underlay)
  })
}

export function evaluateBillingUnderlayReadiness(params: {
  underlay: BillingUnderlayRow
  meterValues: MeteringValueRow[]
  existingExport?: PartnerExportRow | null
}): BillingReadinessResult {
  const { underlay, existingExport } = params
  const issues: BillingReadinessIssue[] = []
  const matchedMeterValues = findMeterValuesForUnderlay(underlay, params.meterValues)
  const exportedAt = exportReferenceDate(existingExport)
  const correctionAfterExport = exportedAt
    ? matchedMeterValues.some((value) => {
        const createdAt = normalizeDate(value.created_at)
        return isCorrectedValue(value) && Boolean(createdAt && createdAt > exportedAt)
      })
    : false

  if (!underlay.company_id) {
    issues.push({
      code: 'company_missing',
      severity: 'error',
      title: 'Bolagskoppling saknas',
      description: 'Underlaget saknar company_id och får därför inte exporteras innan tenant är satt.',
    })
  }

  if (!underlay.customer_id) {
    issues.push({
      code: 'customer_missing',
      severity: 'error',
      title: 'Kund saknas',
      description: 'Underlaget måste vara kopplat till kund för att kunna skickas vidare.',
    })
  }

  if (!underlay.underlay_year || !underlay.underlay_month) {
    issues.push({
      code: 'period_missing',
      severity: 'error',
      title: 'Period saknas',
      description: 'Faktureringsperiod måste vara satt per underlag. Detta stoppar bara denna rad, inte hela exportkörningen.',
    })
  }

  if (underlay.status === 'failed') {
    issues.push({
      code: 'underlay_failed',
      severity: 'error',
      title: 'Underlaget har felstatus',
      description: underlay.failure_reason ?? 'Underlaget är markerat som felaktigt och måste hanteras innan export.',
    })
  }

  if (!['received', 'validated', 'exported'].includes(underlay.status)) {
    issues.push({
      code: 'underlay_not_received',
      severity: 'error',
      title: 'Underlaget är inte mottaget',
      description: 'Underlaget måste vara mottaget eller validerat innan det kan exporteras.',
    })
  }

  if (!underlay.metering_point_id) {
    issues.push({
      code: 'metering_point_missing',
      severity: 'warning',
      title: 'Mätpunkt saknas',
      description: 'Underlaget kan behöva kompletteras med mätpunkt. Raden flaggas så att den inte döljs i batchen.',
    })
  }

  if (matchedMeterValues.length === 0) {
    issues.push({
      code: 'meter_values_missing',
      severity: underlay.total_kwh === null ? 'error' : 'warning',
      title: 'Detaljerade mätvärden saknas',
      description:
        underlay.total_kwh === null
          ? 'Varken total kWh eller detaljerade mätvärden finns. Denna rad stoppas men andra färdiga rader kan exporteras.'
          : 'Detaljerade mätvärden saknas, men underlaget har total kWh. Export kan köas med flagga.',
    })
  }

  if (underlay.total_kwh === null) {
    issues.push({
      code: 'total_kwh_missing',
      severity: matchedMeterValues.length > 0 ? 'warning' : 'error',
      title: 'Total kWh saknas',
      description:
        matchedMeterValues.length > 0
          ? 'Detaljerade mätvärden finns men totalsumma saknas. Export kan köas med flagga om partnern accepterar detta.'
          : 'Total kWh saknas och inga matchade mätvärden hittades.',
    })
  }

  if (underlay.total_sek_ex_vat === null) {
    issues.push({
      code: 'amount_missing',
      severity: 'warning',
      title: 'Belopp saknas',
      description: 'Underlaget saknar belopp ex moms. Detta är en flagga, inte ett globalt exportstopp.',
    })
  }

  if (existingExport) {
    issues.push({
      code: 'already_exported',
      severity: 'info',
      title: 'Export finns redan',
      description: `Partnerexport finns redan i status ${existingExport.status}.`,
    })
  }

  if (correctionAfterExport) {
    issues.push({
      code: 'correction_after_export',
      severity: 'error',
      title: 'Korrigerat mätvärde efter export',
      description: 'Ett korrigerat mätvärde har kommit efter exporten. Underlaget kräver granskning eller korrigeringsunderlag.',
    })
  }

  if (correctionAfterExport) {
    return {
      underlayId: underlay.id,
      status: 'requires_correction',
      label: 'Kräver korrigering',
      isExportable: false,
      issues,
      matchedMeterValueCount: matchedMeterValues.length,
      existingExportId: existingExport?.id ?? null,
      targetAction: 'review',
    }
  }

  if (existingExport) {
    return {
      underlayId: underlay.id,
      status: 'already_exported',
      label: 'Redan köad/exporterad',
      isExportable: false,
      issues,
      matchedMeterValueCount: matchedMeterValues.length,
      existingExportId: existingExport.id,
      targetAction: 'skip_already_exported',
    }
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    return {
      underlayId: underlay.id,
      status: 'blocked',
      label: 'Ej redo',
      isExportable: false,
      issues,
      matchedMeterValueCount: matchedMeterValues.length,
      existingExportId: null,
      targetAction: 'wait_for_data',
    }
  }

  if (issues.some((issue) => issue.severity === 'warning')) {
    return {
      underlayId: underlay.id,
      status: 'warning',
      label: 'Redo med flagga',
      isExportable: true,
      issues,
      matchedMeterValueCount: matchedMeterValues.length,
      existingExportId: null,
      targetAction: 'queue_export',
    }
  }

  return {
    underlayId: underlay.id,
    status: 'ready',
    label: 'Redo',
    isExportable: true,
    issues,
    matchedMeterValueCount: matchedMeterValues.length,
    existingExportId: null,
    targetAction: 'queue_export',
  }
}

export function buildBillingReadinessMap(params: {
  underlays: BillingUnderlayRow[]
  meterValues: MeteringValueRow[]
  partnerExports: PartnerExportRow[]
}): Map<string, BillingReadinessResult> {
  const exportByUnderlayId = new Map(
    params.partnerExports
      .filter((row) => row.billing_underlay_id)
      .map((row) => [row.billing_underlay_id as string, row])
  )

  return new Map(
    params.underlays.map((underlay) => [
      underlay.id,
      evaluateBillingUnderlayReadiness({
        underlay,
        meterValues: params.meterValues,
        existingExport: exportByUnderlayId.get(underlay.id) ?? null,
      }),
    ])
  )
}
