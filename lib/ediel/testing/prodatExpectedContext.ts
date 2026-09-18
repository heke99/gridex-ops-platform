import { readTgtProdatSourceColumns, sourceExpectationIndex, sourceObjectIds } from './tgtProdatSource'
// lib/ediel/prodat/expectedContext.ts

import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ParsedProdatMessage } from '@/lib/ediel/prodat/parser'

export type ExpectedProdatObject = {
  expectedRegisterIndex?: string | null
  expectedIdentityAgency?: string | null
  expectedFields?: Record<string,string>
  sourceGroupIndex?: number
  sourceOrder: number
  sourceLabel: string
  expectedMeteringPointId: string | null
  expectedAlternativeMeteringPointIds: string[]
  expectedGridAreaId: string | null
  expectedAgreementReference: string | null
  expectedCustomerId: string | null
  expectedBalanceResponsibleId: string | null
  expectedContractStartDate: string | null
  expectedContractEndDate: string | null
  expectedReportStartDate: string | null
  expectedReportEndDate: string | null
  expectedReasonForTransaction: string | null
  expectedMeasuringMethod: string | null
  expectedTimeSeriesProduct: string | null
  expectedMeterNumber: string | null
  rawFields: Record<string, string>
}

export type ExpectedProdatContext = {
  mode: 'tgt' | 'production'
  source: string
  testCaseCode: string | null
  objects: ExpectedProdatObject[]
}

function fieldsByColumn(testData: EdielTgtCaseTestData, code: string): ExpectedProdatObject[] {
  const columns = readTgtProdatSourceColumns(testData,code)
  return columns.map(row => {
    const fields = row.fields
    const ids = sourceObjectIds(row,code)
    return {
      sourceOrder:row.column.sourceOrder ?? row.column.index, sourceLabel:row.column.name,
      sourceGroupIndex:row.groupIndex, expectedRegisterIndex:sourceExpectationIndex(row,columns),
      expectedIdentityAgency:row.identityAgency, expectedMeteringPointId:ids[0] ?? null,
      expectedAlternativeMeteringPointIds:ids,
      expectedGridAreaId:fields['260'] ?? null, expectedAgreementReference:fields['261'] ?? null,
      expectedCustomerId:fields['227'] ?? null, expectedBalanceResponsibleId:fields['262'] ?? null,
      expectedContractStartDate:fields['210'] ?? null, expectedContractEndDate:fields['211'] ?? null,
      expectedReportStartDate:fields['302'] ?? null, expectedReportEndDate:fields['321'] ?? null,
      expectedReasonForTransaction:fields['223'] ?? null, expectedMeasuringMethod:fields['217'] ?? null,
      expectedTimeSeriesProduct:fields['222'] ?? null, expectedMeterNumber:fields['224'] ?? null,
      rawFields:row.rawFields, expectedFields:fields,
    }
  })
}

export function resolveTgtExpectedProdatContext(params: {
  parsed: ParsedProdatMessage
  testData: EdielTgtCaseTestData | null | undefined
}): ExpectedProdatContext {
  const { testData } = params

  return {
    mode: 'tgt',
    source: testData ? 'ediel_tgt_testdata' : 'none',
    testCaseCode: testData?.testCaseCode ?? null,
    objects: testData ? fieldsByColumn(testData,params.parsed.messageCode) : [],
  }
}

export function resolveProductionExpectedProdatContext(params: {
  parsed: ParsedProdatMessage
  objects?: ExpectedProdatObject[]
}): ExpectedProdatContext {
  return {
    mode: 'production',
    source: 'production_masterdata',
    testCaseCode: null,
    objects: params.objects ?? [],
  }
}
