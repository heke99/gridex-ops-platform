// lib/ediel/prodat/expectedContext.ts

import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ParsedProdatMessage } from '@/lib/ediel/prodat/parser'

export type ExpectedProdatObject = {
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

function normalizeExpectedValue(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

function value(fields: Record<string, string>, codes: string[]): string | null {
  for (const code of codes) {
    const item = fields[code]
    if (item) return item
  }
  return null
}

function validFacility(value: string | null | undefined): value is string {
  return Boolean(value && /^735\d{15}$/.test(value))
}

function fieldsByColumn(testData: EdielTgtCaseTestData): ExpectedProdatObject[] {
  const objects: ExpectedProdatObject[] = []

  for (const group of testData.groups) {
    const columns = [...group.columns].sort((a, b) => {
      const sourceOrderDiff = Number(a.sourceOrder ?? a.index) - Number(b.sourceOrder ?? b.index)
      return sourceOrderDiff !== 0 ? sourceOrderDiff : a.index - b.index
    })

    for (const column of columns) {
      const fields: Record<string, string> = {}

      for (const field of group.fields) {
        const cleaned = normalizeExpectedValue(field.values[column.name])
        if (!cleaned) continue
        fields[String(field.fieldCode).toUpperCase()] = cleaned
      }

      if (Object.keys(fields).length === 0) continue

      objects.push({
        sourceOrder: Number(column.sourceOrder ?? column.index),
        sourceLabel: column.name,
        // For PRODAT Z05 negative object tests, field 209 can be the object in
        // the received message while field 233 is the expected/correct object.
        // This interpretation belongs to the expected-context layer, not to
        // APERAK rendering.
        expectedMeteringPointId: validFacility(fields['233']) ? fields['233'] : (validFacility(fields['209']) ? fields['209'] : null),
        expectedAlternativeMeteringPointIds: [fields['209'], fields['233']].filter(validFacility),
        expectedGridAreaId: value(fields, ['260']),
        expectedAgreementReference: value(fields, ['261']),
        expectedCustomerId: value(fields, ['227']),
        expectedBalanceResponsibleId: value(fields, ['262']),
        expectedContractStartDate: value(fields, ['210']),
        expectedContractEndDate: value(fields, ['211']),
        expectedReportStartDate: value(fields, ['302']),
        expectedReportEndDate: value(fields, ['321']),
        expectedReasonForTransaction: value(fields, ['223']),
        expectedMeasuringMethod: value(fields, ['217']),
        expectedTimeSeriesProduct: value(fields, ['222']),
        expectedMeterNumber: value(fields, ['224']),
        rawFields: fields,
      })
    }
  }

  return objects.sort((a, b) => a.sourceOrder - b.sourceOrder)
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
    objects: testData ? fieldsByColumn(testData) : [],
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
