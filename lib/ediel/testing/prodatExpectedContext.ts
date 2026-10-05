import { readTgtProdatSourceColumns, sourceObjectIds, sourceExpectationIndex } from './tgtProdatSource'
// lib/ediel/prodat/expectedContext.ts

import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ParsedProdatMessage } from '@/lib/ediel/prodat/parser'

export type ExpectedProdatObject = {
  expectedRegisterIndex?: string | null
  expectedIdentityAgency?: string | null
  sourceGroupIndex?: number
  sourceRawFields?: Record<string,string>
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

function value(fields: Record<string, string>, codes: string[]): string | null {
  for (const code of codes) {
    const item = fields[code]
    if (item) return item
  }
  return null
}

function fieldsByColumn(testData: EdielTgtCaseTestData, code: string): ExpectedProdatObject[] {
  const rows=readTgtProdatSourceColumns(testData,code)
  return rows.map(row=>{
    const fields=row.fields, ids=sourceObjectIds(row,code)
    return {sourceOrder:Number(row.column.sourceOrder ?? row.column.index),sourceLabel:row.column.name,
      expectedRegisterIndex:sourceExpectationIndex(row,rows),expectedIdentityAgency:row.identityAgency,
      sourceGroupIndex:row.groupIndex,sourceRawFields:row.rawFields,
      expectedMeteringPointId:ids[0] ?? null,expectedAlternativeMeteringPointIds:ids.slice(1),
      expectedGridAreaId:value(fields,['260']),expectedAgreementReference:value(fields,['261']),
      expectedCustomerId:value(fields,['227']),expectedBalanceResponsibleId:value(fields,['262']),
      expectedContractStartDate:value(fields,['210']),expectedContractEndDate:value(fields,['211']),
      expectedReportStartDate:value(fields,['302']),expectedReportEndDate:value(fields,['321']),
      expectedReasonForTransaction:value(fields,['223']),expectedMeasuringMethod:value(fields,['217']),
      expectedTimeSeriesProduct:value(fields,['222']),expectedMeterNumber:value(fields,['224']),rawFields:fields}
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
