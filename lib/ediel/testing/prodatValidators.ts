import { matchProdatRegisterExpectations } from './prodatRegisterExpectation'
import { prodatDateField, prodatDateComparisonValue } from '@/lib/ediel/prodat/prodatDateFields'
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
  | 'register_identity_invalid'
  | 'register_value_invalid'
  | 'expected_object_missing'

export type ProdatValidationIssue = {
  registerIndex?: string | null
  lineSequenceNumber?: string | null
  identityAgency?: string | null
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

function sameValue(actual: string | null, expected: string | null): boolean {
  return !expected || actual === expected
}

function expectedIdsForObject(object: ExpectedProdatObject, messageCode: string): string[] {
  if (messageCode === 'Z05' && object.expectedMeteringPointId) return [object.expectedMeteringPointId]
  return Array.from(new Set([object.expectedMeteringPointId, ...object.expectedAlternativeMeteringPointIds].filter(Boolean) as string[]))
}

function issue(params: Omit<ProdatValidationIssue, 'severity'> & { severity?: ProdatValidationIssue['severity'] }): ProdatValidationIssue {
  return {
    registerIndex:params.registerIndex, lineSequenceNumber:params.lineSequenceNumber, identityAgency:params.identityAgency,
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
  const isDate = Boolean(prodatDateField(params.fieldCode))
  const expectedDate = isDate ? prodatDateComparisonValue(params.fieldCode, params.expected) : null
  if (isDate ? expectedDate !== null && expectedDate === prodatDateComparisonValue(params.fieldCode, params.actual)
    : sameValue(params.actual, params.expected)) return

  params.issues.push(issue({
    registerIndex:params.line.registerIndex, lineSequenceNumber:params.line.lineSequenceNumber, identityAgency:params.line.identityAgency,
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

  if (!expected.objects.length) return []
  const matched = matchProdatRegisterExpectations(
    parsed.lineItems.map(line => ({data:line,id:line.meteringPointId,index:line.registerIndex,agency:line.identityAgency,first:line.firstRegisterSourceOrder === line.sourceOrder,valid:line.validRegisterChain})),
    expected.objects.map(object => ({data:object,ids:expectedIdsForObject(object,parsed.messageCode),index:object.expectedRegisterIndex ?? null,agency:object.expectedIdentityAgency})),
  )
  for (const match of matched.matches) {
    const line = match.line.data
    const object = match.expected?.data
    const location = {registerIndex:line.registerIndex,lineSequenceNumber:line.lineSequenceNumber,identityAgency:line.identityAgency,meteringPointId:line.meteringPointId,transactionReference:line.lineItemReference}
    if (match.error) {
      const fieldCode = match.error === 'identity' ? '209' : '258'
      issues.push(issue({...location,type:fieldCode === '209' ? 'metering_point_id_mismatch' : 'register_identity_invalid',fieldCode,fieldName:'Objekt/register',actual:fieldCode === '209' ? line.meteringPointId : line.registerIndex,expected:match.expected?.index ?? null,sourceOrder:sourceOrder++,message:'Objekt eller register kan inte matchas entydigt'}))
      if (fieldCode === '209') issues.push(issue({...location,type:'facility_not_identified',fieldCode:'105',fieldName:'Object could not be identified',actual:line.meteringPointId,expected:null,sourceOrder:sourceOrder++,message:'Anläggningen kan inte identifieras'}))
      continue
    }
    if (!object) continue
    for (const [fieldCode,actual] of [['213',line.annualConsumption],['214',line.meterConstant],['218',line.meterDigitCount],['259',line.meterTimeFrame]] as const) {
      compareField({issues,type:'register_value_invalid',fieldCode,fieldName:'Registervärde',actual,expected:(object.expectedFields ?? object.rawFields)[fieldCode] ?? null,line,sourceOrder:sourceOrder++,message:'Registervärdet avviker från källan'})
    }
    if (!match.line.first) continue

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
    compareField({ issues, type: 'time_series_product_invalid', fieldCode: '222', fieldName: 'Tidsserieprodukt', actual: line.reportingFrequency, expected: object.expectedTimeSeriesProduct, line, sourceOrder: sourceOrder++, message: 'Felaktig tidsserieprodukt' })
    compareField({ issues, type: 'meter_number_invalid', fieldCode: '224', fieldName: 'Mätarnummer', actual: line.meterNumber, expected: object.expectedMeterNumber, line, sourceOrder: sourceOrder++, message: line.meterNumber ? `Felaktigt mätarnummer ${line.meterNumber}` : 'Mätarnummer saknas' })
  }

  for (const missing of matched.missing) {
    issues.push(issue({type:'expected_object_missing',fieldCode:missing.index ? '258' : '209',fieldName:'Förväntat objekt/register',actual:null,expected:missing.index ?? missing.ids[0] ?? null,meteringPointId:missing.ids[0] ?? null,transactionReference:null,registerIndex:missing.index,identityAgency:missing.agency,sourceOrder:sourceOrder++,message:'Förväntat objekt/register saknas'}))
  }

  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = JSON.stringify([item.type,item.fieldCode,item.meteringPointId,item.identityAgency,item.registerIndex,item.lineSequenceNumber,item.transactionReference,item.actual,item.expected])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
