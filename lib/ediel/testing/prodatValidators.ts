// lib/ediel/prodat/validator.ts

import type { ParsedProdatLineItem, ParsedProdatMessage } from '@/lib/ediel/prodat/parser'
import type { ExpectedProdatContext, ExpectedProdatObject } from '@/lib/ediel/testing/prodatExpectedContext'

export type ProdatValidationIssueType =
  | 'facility_not_identified'
  | 'metering_point_id_mismatch'
  | 'grid_area_id_invalid'
  | 'agreement_reference_invalid'
  | 'customer_id_invalid'
  | 'balance_responsible_invalid'
  | 'agreement_start_date_invalid'
  | 'agreement_end_date_invalid'
  | 'report_start_date_invalid'
  | 'report_end_date_invalid'
  | 'transaction_type_invalid'
  | 'measuring_method_invalid'
  | 'time_series_product_invalid'
  | 'meter_number_invalid'
  | 'case_reference_missing'
  | 'annual_consumption_missing'
  | 'constant_missing'
  | 'digit_count_missing'
  | 'meter_number_missing'

export type ProdatValidationIssue = {
  type: ProdatValidationIssueType
  severity: 'error' | 'warning' | 'info'
  fieldCode: string
  fieldName: string
  actual: string | null
  expected: string | null
  meteringPointId: string | null
  transactionReference: string | null
  sourceOrder: number
  message: string
}

function normalizeCompare(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]+/g, '')
    .toUpperCase()
}

function sameValue(actual: string | null, expected: string | null): boolean {
  if (!expected) return true
  if (!actual) return false
  return normalizeCompare(actual) === normalizeCompare(expected)
}

function expectedIdsForObject(object: ExpectedProdatObject, messageCode: string): string[] {
  if (messageCode === 'Z05' && object.expectedMeteringPointId) return [object.expectedMeteringPointId]
  return Array.from(new Set([object.expectedMeteringPointId, ...object.expectedAlternativeMeteringPointIds].filter(Boolean) as string[]))
}

function matchExpectedObject(objects: ExpectedProdatObject[], line: ParsedProdatLineItem, messageCode: string): ExpectedProdatObject | null {
  if (objects.length === 0) return null

  if (line.meteringPointId) {
    const exact = objects.find((object) =>
      expectedIdsForObject(object, messageCode).some((id) => sameValue(line.meteringPointId, id)),
    )
    if (exact) return exact
  }

  return objects[line.sourceOrder] ?? objects[0] ?? null
}

function issue(params: Omit<ProdatValidationIssue, 'severity'> & { severity?: ProdatValidationIssue['severity'] }): ProdatValidationIssue {
  return {
    severity: params.severity ?? 'error',
    type: params.type,
    fieldCode: params.fieldCode,
    fieldName: params.fieldName,
    actual: params.actual,
    expected: params.expected,
    meteringPointId: params.meteringPointId,
    transactionReference: params.transactionReference,
    sourceOrder: params.sourceOrder,
    message: params.message,
  }
}

function compareField(params: {
  issues: ProdatValidationIssue[]
  type: ProdatValidationIssueType
  fieldCode: string
  fieldName: string
  actual: string | null
  expected: string | null
  line: ParsedProdatLineItem
  sourceOrder: number
  message: string
}): void {
  if (!params.expected) return
  if (sameValue(params.actual, params.expected)) return

  params.issues.push(issue({
    type: params.type,
    fieldCode: params.fieldCode,
    fieldName: params.fieldName,
    actual: params.actual,
    expected: params.expected,
    meteringPointId: params.line.meteringPointId,
    transactionReference: params.line.lineItemReference,
    sourceOrder: params.sourceOrder,
    message: params.message,
  }))
}

export function validateParsedProdatAgainstExpected(params: {
  parsed: ParsedProdatMessage
  expected: ExpectedProdatContext
}): ProdatValidationIssue[] {
  const { parsed, expected } = params
  const issues: ProdatValidationIssue[] = []
  let sourceOrder = 0

  for (const line of parsed.lineItems) {
    const object = matchExpectedObject(expected.objects, line, parsed.messageCode)
    const expectedFacilities = object ? expectedIdsForObject(object, parsed.messageCode) : []

    if (expectedFacilities.length > 0 && line.meteringPointId && !expectedFacilities.some((id) => sameValue(line.meteringPointId, id))) {
      issues.push(issue({
        type: 'facility_not_identified',
        fieldCode: '105',
        fieldName: 'Object could not be identified',
        actual: line.meteringPointId,
        expected: expectedFacilities[0] ?? null,
        meteringPointId: line.meteringPointId,
        transactionReference: line.lineItemReference,
        sourceOrder: sourceOrder++,
        message: 'Anläggningen kan inte identifieras',
      }))
      issues.push(issue({
        type: 'metering_point_id_mismatch',
        fieldCode: '209',
        fieldName: 'Anläggningsid',
        actual: line.meteringPointId,
        expected: expectedFacilities[0] ?? null,
        meteringPointId: line.meteringPointId,
        transactionReference: line.lineItemReference,
        sourceOrder: sourceOrder++,
        message: `Felaktigt anläggningsid ${line.meteringPointId}`,
      }))
      continue
    }

    if (!object) continue

    compareField({ issues, type: 'grid_area_id_invalid', fieldCode: '260', fieldName: 'Nätområdesid', actual: line.gridAreaId, expected: object.expectedGridAreaId, line, sourceOrder: sourceOrder++, message: 'Felaktigt nätområdesid' })
    compareField({ issues, type: 'agreement_reference_invalid', fieldCode: '261', fieldName: 'Referens till avtal/fullmakt', actual: line.agreementReference, expected: object.expectedAgreementReference, line, sourceOrder: sourceOrder++, message: 'Felaktig referens till avtal/fullmakt' })
    compareField({ issues, type: 'customer_id_invalid', fieldCode: '227', fieldName: 'Kund-id', actual: line.customerId, expected: object.expectedCustomerId, line, sourceOrder: sourceOrder++, message: 'Felaktigt kund-id' })
    compareField({ issues, type: 'balance_responsible_invalid', fieldCode: '262', fieldName: 'Balansansvarig', actual: line.balanceResponsibleId, expected: object.expectedBalanceResponsibleId, line, sourceOrder: sourceOrder++, message: 'Felaktig balansansvarig' })
    compareField({ issues, type: 'agreement_start_date_invalid', fieldCode: '210', fieldName: 'Avtal startdatum', actual: line.contractStartDate, expected: object.expectedContractStartDate, line, sourceOrder: sourceOrder++, message: 'Felaktigt startdatum' })
    compareField({ issues, type: 'agreement_end_date_invalid', fieldCode: '211', fieldName: 'Avtal slutdatum', actual: line.contractEndDate, expected: object.expectedContractEndDate, line, sourceOrder: sourceOrder++, message: 'Felaktigt slutdatum' })
    compareField({ issues, type: 'report_start_date_invalid', fieldCode: '302', fieldName: 'Rapportstartdatum', actual: line.reportStartDate, expected: object.expectedReportStartDate, line, sourceOrder: sourceOrder++, message: 'Felaktigt rapportstartdatum' })
    compareField({ issues, type: 'report_end_date_invalid', fieldCode: '321', fieldName: 'Rapportslutdatum', actual: line.reportEndDate, expected: object.expectedReportEndDate, line, sourceOrder: sourceOrder++, message: 'Felaktigt rapportslutdatum' })
    compareField({ issues, type: 'transaction_type_invalid', fieldCode: '223', fieldName: 'Transaktionstyp', actual: line.reasonForTransaction, expected: object.expectedReasonForTransaction, line, sourceOrder: sourceOrder++, message: 'Felaktig transaktionstyp' })
    compareField({ issues, type: 'measuring_method_invalid', fieldCode: '217', fieldName: 'Mätmetod', actual: line.measuringMethod, expected: object.expectedMeasuringMethod, line, sourceOrder: sourceOrder++, message: 'Felaktig mätmetod' })
    compareField({ issues, type: 'time_series_product_invalid', fieldCode: '222', fieldName: 'Tidsserieprodukt', actual: line.timeSeriesProduct, expected: object.expectedTimeSeriesProduct, line, sourceOrder: sourceOrder++, message: 'Felaktig tidsserieprodukt' })
    compareField({ issues, type: 'meter_number_invalid', fieldCode: '224', fieldName: 'Mätarnummer', actual: line.meterNumber, expected: object.expectedMeterNumber, line, sourceOrder: sourceOrder++, message: line.meterNumber ? `Felaktigt mätarnummer ${line.meterNumber}` : 'Mätarnummer saknas' })
  }

  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = [item.type, item.meteringPointId ?? '', item.transactionReference ?? '', item.actual ?? '', item.expected ?? ''].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
