// lib/ediel/core/aperakErrorRuleRegistry.ts

import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { compareInboundPayloadToTgtTestData } from '@/lib/ediel/core/tgtAutoMatcher'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/tgtTestData'
import { supabaseService } from '@/lib/supabase/service'

export type EdielAperakValidationIssue = {
  ruleKey: string
  severity: 'error' | 'warning' | 'info'
  fieldPath: string | null
  fieldValue: string | null
  expectedValue: string | null
  meteringPointId: string | null
  transactionReference: string | null
  sourceOrder: number
  fallbackText: string
}

type EdielAperakErrorRuleRow = {
  id: string
  message_family: string
  message_code: string | null
  direction: string
  rule_key: string
  rule_description: string | null
  application_error: string
  free_text_code: string | null
  free_text: string | null
  applies_to_field: string | null
  environment: string | null
  priority: number | null
  is_active: boolean
}

export type EdielResolvedAperakErrorDetail = {
  validationIssueId: string | null
  errorRuleId: string | null
  ruleKey: string
  applicationError: string
  freeTextCode: string | null
  freeText: string
  meteringPointId: string | null
  transactionReference: string | null
  sourceOrder: number
}

export type EdielResolvedAperakErrors = {
  errors: EdielAperakApplicationError[]
  details: EdielResolvedAperakErrorDetail[]
  issueCount: number
  matchedRuleKeys: string[]
  unmappedIssues: EdielAperakValidationIssue[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function cleanTestDataToken(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^0-9A-Za-zÅÄÖåäö_-]/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.split(/\s+/)[0] ?? null
}

function testDataValuesForField(testData: EdielTgtCaseTestData | null | undefined, fieldCodes: string[]): string[] {
  if (!testData) return []
  const wanted = new Set(fieldCodes.map((code) => code.toUpperCase()))
  const values: string[] = []

  for (const group of testData.groups) {
    for (const field of group.fields) {
      if (!wanted.has(String(field.fieldCode).toUpperCase())) continue
      for (const value of Object.values(field.values) as string[]) {
        const cleaned = cleanTestDataToken(value)
        if (cleaned) values.push(cleaned)
      }
    }
  }

  return Array.from(new Set(values))
}

function hasTestDataField(testData: EdielTgtCaseTestData | null | undefined, fieldCode: string): boolean {
  if (!testData) return false
  const wanted = fieldCode.toUpperCase()
  return testData.groups.some((group) =>
    group.fields.some((field) =>
      String(field.fieldCode).toUpperCase() === wanted &&
      (Object.values(field.values) as string[]).some((value) => Boolean(cleanTestDataToken(value)))
    )
  )
}

function meterIdLooksInvalid(value: string | null): boolean {
  if (!value) return true
  return !/^735\d{15}$/.test(value)
}

function issue(input: Omit<EdielAperakValidationIssue, 'severity'> & { severity?: EdielAperakValidationIssue['severity'] }): EdielAperakValidationIssue {
  return {
    severity: input.severity ?? 'error',
    ruleKey: input.ruleKey,
    fieldPath: input.fieldPath,
    fieldValue: input.fieldValue,
    expectedValue: input.expectedValue,
    meteringPointId: input.meteringPointId,
    transactionReference: input.transactionReference,
    sourceOrder: input.sourceOrder,
    fallbackText: input.fallbackText,
  }
}

function dedupeIssues(issues: EdielAperakValidationIssue[]): EdielAperakValidationIssue[] {
  const seen = new Set<string>()
  const result: EdielAperakValidationIssue[] = []

  for (const item of issues) {
    const key = [
      item.ruleKey,
      item.meteringPointId ?? '',
      item.transactionReference ?? '',
      item.fieldPath ?? '',
      item.fieldValue ?? '',
      item.expectedValue ?? '',
    ].join('|')

    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result.sort((a, b) => a.sourceOrder - b.sourceOrder)
}

type TgtRuleMapping = {
  ruleKey: string
  fieldPath: string
  fallbackText: string
}

const TGT_FIELD_RULES: Record<string, { missing: TgtRuleMapping; invalid: TgtRuleMapping }> = {
  // Special APERAK/PRODAT error: object could not be identified.
  // The APERAK codes are resolved from ediel_aperak_error_rules, not here.
  '105': {
    missing: {
      ruleKey: 'facility_not_identified',
      fieldPath: 'SG4/RFF/Z07',
      fallbackText: 'Anläggningen kan inte identifieras',
    },
    invalid: {
      ruleKey: 'facility_not_identified',
      fieldPath: 'SG4/RFF/Z07',
      fallbackText: 'Anläggningen kan inte identifieras',
    },
  },
  '209': {
    missing: {
      ruleKey: 'metering_point_id_mismatch',
      fieldPath: 'SG4/RFF/Z07',
      fallbackText: 'Anläggningsid saknas eller avviker från Edielportalens testdata',
    },
    invalid: {
      ruleKey: 'metering_point_id_mismatch',
      fieldPath: 'SG4/RFF/Z07',
      fallbackText: 'Anläggningsid avviker från Edielportalens testdata',
    },
  },
  '210': {
    missing: {
      ruleKey: 'agreement_start_date_missing',
      fieldPath: 'SG5/DTM/92|157',
      fallbackText: 'Avtal, startdatum saknas',
    },
    invalid: {
      ruleKey: 'agreement_start_date_invalid',
      fieldPath: 'SG5/DTM/92|157',
      fallbackText: 'Felaktig avtal, startdatum',
    },
  },
  '213': {
    missing: {
      ruleKey: 'annual_consumption_missing',
      fieldPath: 'SG5/QTY/31',
      fallbackText: 'Årsförbrukning saknas',
    },
    invalid: {
      ruleKey: 'annual_consumption_invalid',
      fieldPath: 'SG5/QTY/31',
      fallbackText: 'Felaktig årsförbrukning',
    },
  },
  '214': {
    missing: {
      ruleKey: 'constant_missing',
      fieldPath: 'SG5/CCI/Z02',
      fallbackText: 'Konstant saknas',
    },
    invalid: {
      ruleKey: 'constant_invalid',
      fieldPath: 'SG5/CCI/Z02',
      fallbackText: 'Felaktig konstant',
    },
  },
  '217': {
    missing: {
      ruleKey: 'metering_method_missing',
      fieldPath: 'SG5/CCI/Z04',
      fallbackText: 'Mätmetod saknas',
    },
    invalid: {
      ruleKey: 'metering_method_invalid',
      fieldPath: 'SG5/CCI/Z04',
      fallbackText: 'Felaktig mätmetod',
    },
  },
  '218': {
    missing: {
      ruleKey: 'digit_count_missing',
      fieldPath: 'SG5/CCI/Z16',
      fallbackText: 'Antal siffror saknas',
    },
    invalid: {
      ruleKey: 'digit_count_invalid',
      fieldPath: 'SG5/CCI/Z16',
      fallbackText: 'Felaktigt antal siffror',
    },
  },
  '222': {
    missing: {
      ruleKey: 'settlement_method_missing',
      fieldPath: 'SG5/CCI/Z05',
      fallbackText: 'Avräkningsmetod saknas',
    },
    invalid: {
      ruleKey: 'settlement_method_invalid',
      fieldPath: 'SG5/CCI/Z05',
      fallbackText: 'Felaktig avräkningsmetod',
    },
  },
  '223': {
    missing: {
      ruleKey: 'transaction_type_missing',
      fieldPath: 'SG5/CCI/Z13',
      fallbackText: 'Transaktionstyp saknas',
    },
    invalid: {
      ruleKey: 'transaction_type_invalid',
      fieldPath: 'SG5/CCI/Z13',
      fallbackText: 'Felaktig transaktionstyp',
    },
  },
  '224': {
    missing: {
      ruleKey: 'meter_number_missing',
      fieldPath: 'SG5/RFF/MG',
      fallbackText: 'Mätarnummer saknas',
    },
    invalid: {
      ruleKey: 'meter_number_invalid',
      fieldPath: 'SG5/RFF/MG',
      fallbackText: 'Felaktigt mätarnummer',
    },
  },
  // TGT spreadsheet uses 261 for line item reference; APERAK FTX code in the test instructions is 226.
  '261': {
    missing: {
      ruleKey: 'case_reference_missing',
      fieldPath: 'SG4/RFF/LI',
      fallbackText: 'Ärendereferens saknas',
    },
    invalid: {
      ruleKey: 'case_reference_invalid',
      fieldPath: 'SG4/RFF/LI',
      fallbackText: 'Felaktig ärendereferens',
    },
  },
  '226': {
    missing: {
      ruleKey: 'case_reference_missing',
      fieldPath: 'SG4/RFF/LI',
      fallbackText: 'Ärendereferens saknas',
    },
    invalid: {
      ruleKey: 'case_reference_invalid',
      fieldPath: 'SG4/RFF/LI',
      fallbackText: 'Felaktig ärendereferens',
    },
  },
  '260': {
    missing: {
      ruleKey: 'grid_area_missing',
      fieldPath: 'SG4/RFF/Z05',
      fallbackText: 'Nätområdesid saknas',
    },
    invalid: {
      ruleKey: 'grid_area_invalid',
      fieldPath: 'SG4/RFF/Z05',
      fallbackText: 'Felaktigt nätområdesid',
    },
  },
  '262': {
    missing: {
      ruleKey: 'balance_responsible_missing',
      fieldPath: 'SG5/NAD/Z02',
      fallbackText: 'Balansansvarig saknas',
    },
    invalid: {
      ruleKey: 'balance_responsible_invalid',
      fieldPath: 'SG5/NAD/Z02',
      fallbackText: 'Felaktig balansansvarig',
    },
  },
}

function fieldRuleForTgtIssue(fieldCode: string, actual: string | null): TgtRuleMapping {
  const normalized = fieldCode.toUpperCase()
  const rule = TGT_FIELD_RULES[normalized]
  if (rule) return actual ? rule.invalid : rule.missing

  return {
    ruleKey: actual ? `field_${normalized}_invalid` : `field_${normalized}_missing`,
    fieldPath: `PRODAT/FIELD/${normalized}`,
    fallbackText: actual ? `Fält ${normalized} avviker från Edielportalens testdata` : `Fält ${normalized} saknas`,
  }
}

function issuesFromTgtComparison(params: {
  message: EdielMessageRow
  testData: EdielTgtCaseTestData | null | undefined
}): EdielAperakValidationIssue[] {
  const comparisonIssues = compareInboundPayloadToTgtTestData({
    message: params.message,
    testData: params.testData,
  })

  return comparisonIssues.map((item, index) => {
    const mapping = fieldRuleForTgtIssue(item.fieldCode, item.actual)
    return issue({
      ruleKey: mapping.ruleKey,
      fieldPath: mapping.fieldPath,
      fieldValue: item.actual,
      expectedValue: item.expected,
      meteringPointId: item.referenceNumber,
      transactionReference: item.lineItemReference,
      sourceOrder: index,
      fallbackText: mapping.fallbackText,
    })
  })
}

export function deriveProdatAperakValidationIssues(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
}): EdielAperakValidationIssue[] {
  const { message, testData } = params
  if (message.message_family !== 'PRODAT') return []

  // TGT/testdata mode: detect rule keys by comparing the inbound payload with
  // imported Edielportal testdata. The APERAK ERC/FTX codes are still resolved
  // only from ediel_aperak_error_rules in the backend, not hardcoded here.
  if (testData) {
    const tgtIssues = dedupeIssues(issuesFromTgtComparison({ message, testData }))
    if (tgtIssues.length > 0) return tgtIssues
  }

  const facts = parseEdifactMessageFacts(message.raw_payload)
  const code = String(message.message_code ?? facts.messageCode ?? '').toUpperCase()
  const issues: EdielAperakValidationIssue[] = []
  let sourceOrder = 0

  const expectedFacilityIds = testDataValuesForField(testData, ['209', '233']).filter((value) => /^735\d{15}$/.test(value))
  const expectedFacilities = new Set(expectedFacilityIds)

  if (facts.rawSegments.some((segment) => segment === 'RFF+LI' || segment === 'RFF+LI:')) {
    return [
      issue({
        ruleKey: 'missing_facility_reference',
        fieldPath: 'SG4/RFF/LI',
        fieldValue: null,
        expectedValue: 'RFF+LI:<value>',
        meteringPointId: null,
        transactionReference: null,
        sourceOrder: sourceOrder++,
        fallbackText: 'Referens till anläggning saknas',
      }),
    ]
  }

  for (const line of facts.lineItems) {
    const lineReference = line.rffLi ?? null

    if (expectedFacilities.size > 0 && line.itemId && !expectedFacilities.has(line.itemId)) {
      issues.push(
        issue({
          ruleKey: 'facility_not_identified',
          fieldPath: 'SG4/RFF/Z07',
          fieldValue: line.itemId,
          expectedValue: expectedFacilityIds.join(','),
          meteringPointId: line.itemId,
          transactionReference: lineReference,
          sourceOrder: sourceOrder++,
          fallbackText: 'Anläggningen kan inte identifieras',
        }),
        issue({
          ruleKey: 'metering_point_id_mismatch',
          fieldPath: 'SG4/RFF/Z07',
          fieldValue: line.itemId,
          expectedValue: expectedFacilityIds.join(','),
          meteringPointId: line.itemId,
          transactionReference: lineReference,
          sourceOrder: sourceOrder++,
          fallbackText: 'Anläggningsid avviker från Edielportalens testdata',
        })
      )
      continue
    }

    if (expectedFacilities.size > 0 && !line.itemId) {
      issues.push(
        issue({
          ruleKey: 'facility_not_identified',
          fieldPath: 'SG4/RFF/Z07',
          fieldValue: null,
          expectedValue: expectedFacilityIds.join(','),
          meteringPointId: null,
          transactionReference: lineReference,
          sourceOrder: sourceOrder++,
          fallbackText: 'Anläggningen kan inte identifieras',
        }),
        issue({
          ruleKey: 'metering_point_id_mismatch',
          fieldPath: 'SG4/RFF/Z07',
          fieldValue: null,
          expectedValue: expectedFacilityIds.join(','),
          meteringPointId: null,
          transactionReference: lineReference,
          sourceOrder: sourceOrder++,
          fallbackText: 'Anläggningsid avviker från Edielportalens testdata',
        })
      )
      continue
    }

    if (meterIdLooksInvalid(line.itemId)) {
      issues.push(issue({
        ruleKey: 'facility_not_identified',
        fieldPath: 'SG4/RFF/Z07',
        fieldValue: line.itemId,
        expectedValue: '735 + 15 siffror',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Anläggningen kan inte identifieras',
      }))
    }

    if (['Z05', 'Z06', 'Z09', 'Z10'].includes(code) && !line.rffLi) {
      issues.push(issue({
        ruleKey: 'case_reference_missing',
        fieldPath: 'SG4/RFF/LI',
        fieldValue: null,
        expectedValue: 'RFF+LI:<ärendereferens>',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Ärendereferens saknas',
      }))
    }

    if (['Z04'].includes(code) && !line.hasQty31) {
      issues.push(issue({
        ruleKey: 'annual_consumption_missing',
        fieldPath: 'SG5/QTY/31',
        fieldValue: null,
        expectedValue: hasTestDataField(testData, '213') ? testDataValuesForField(testData, ['213']).join(',') : 'QTY+31',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Årsförbrukning saknas',
      }))
    }

    if (['Z04', 'Z06', 'Z10'].includes(code) && !line.hasConstant) {
      issues.push(issue({
        ruleKey: 'constant_missing',
        fieldPath: 'SG5/CCI/Z02',
        fieldValue: null,
        expectedValue: hasTestDataField(testData, '214') ? testDataValuesForField(testData, ['214']).join(',') : 'Konstant',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Konstant saknas',
      }))
    }

    if (['Z06'].includes(code) && !line.hasDigitCount) {
      issues.push(issue({
        ruleKey: 'digit_count_missing',
        fieldPath: 'SG5/CCI/Z16',
        fieldValue: null,
        expectedValue: hasTestDataField(testData, '218') ? testDataValuesForField(testData, ['218']).join(',') : 'Antal siffror',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Antal siffror saknas',
      }))
    }

    if (['Z10'].includes(code) && !line.hasMeterNumber) {
      issues.push(issue({
        ruleKey: 'meter_number_missing',
        fieldPath: 'SG5/RFF/MG',
        fieldValue: null,
        expectedValue: hasTestDataField(testData, '224') ? testDataValuesForField(testData, ['224']).join(',') : 'Mätarnummer',
        meteringPointId: line.itemId,
        transactionReference: lineReference,
        sourceOrder: sourceOrder++,
        fallbackText: 'Mätarnummer saknas',
      }))
    }
  }

  return dedupeIssues(issues)
}

async function tableExistsSafe(table: string): Promise<boolean> {
  const { error } = await supabaseService.from(table).select('id').limit(1)
  return !error
}

async function insertValidationIssue(params: {
  messageId: string
  issue: EdielAperakValidationIssue
}): Promise<string | null> {
  if (!(await tableExistsSafe('ediel_message_validation_issues'))) return null

  const { data, error } = await supabaseService
    .from('ediel_message_validation_issues')
    .upsert(
      {
        message_id: params.messageId,
        rule_key: params.issue.ruleKey,
        severity: params.issue.severity,
        field_path: params.issue.fieldPath,
        field_value: params.issue.fieldValue,
        expected_value: params.issue.expectedValue,
        metering_point_id: params.issue.meteringPointId,
        transaction_reference: params.issue.transactionReference,
        source_order: params.issue.sourceOrder,
      },
      { onConflict: 'message_id,rule_key,coalesce_field_path,coalesce_metering_point_id,coalesce_transaction_reference' }
    )
    .select('id')
    .maybeSingle()

  if (error) {
    await supabaseService.from('ediel_message_events').insert({
      ediel_message_id: params.messageId,
      event_type: 'manual_note',
      event_status: 'warning',
      message: 'Kunde inte spara APERAK validation issue. Fortsätter med transient backend-beslut.',
      payload: {
        ruleKey: params.issue.ruleKey,
        error: error.message,
      },
    })
    return null
  }

  return asString((data as { id?: unknown } | null)?.id)
}

async function listActiveRules(params: {
  family: string
  code: string
  environment: string
}): Promise<EdielAperakErrorRuleRow[]> {
  if (!(await tableExistsSafe('ediel_aperak_error_rules'))) return []

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabaseService
    .from('ediel_aperak_error_rules')
    .select('*')
    .eq('is_active', true)
    .eq('message_family', params.family)
    .in('message_code', [params.code, '*'])
    .in('direction', ['inbound', 'both'])
    .in('environment', [params.environment, 'all'])
    .or(`valid_from.is.null,valid_from.lte.${today}`)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as EdielAperakErrorRuleRow[]
}

function selectRuleForIssue(
  rules: EdielAperakErrorRuleRow[],
  issue: EdielAperakValidationIssue,
  code: string,
  environment: string
): EdielAperakErrorRuleRow | null {
  const candidates = rules.filter((rule) =>
    rule.rule_key === issue.ruleKey &&
    (rule.message_code === code || rule.message_code === '*') &&
    (rule.environment === environment || rule.environment === 'all')
  )

  if (candidates.length === 0) return null

  return candidates.sort((a, b) => {
    const aCodeRank = a.message_code === code ? 0 : 1
    const bCodeRank = b.message_code === code ? 0 : 1
    if (aCodeRank !== bCodeRank) return aCodeRank - bCodeRank

    const aEnvRank = a.environment === environment ? 0 : 1
    const bEnvRank = b.environment === environment ? 0 : 1
    if (aEnvRank !== bEnvRank) return aEnvRank - bEnvRank

    return (a.priority ?? 9999) - (b.priority ?? 9999)
  })[0] ?? null
}


function formatAperakFreeText(template: string | null | undefined, issue: EdielAperakValidationIssue): string {
  const fallback = issue.fallbackText
  const raw = String(template ?? fallback).trim() || fallback
  const replacements: Record<string, string> = {
    actual: issue.fieldValue ?? '',
    fieldValue: issue.fieldValue ?? '',
    value: issue.fieldValue ?? '',
    expected: issue.expectedValue ?? '',
    meteringPointId: issue.meteringPointId ?? '',
    transactionReference: issue.transactionReference ?? '',
  }

  const formatted = raw.replace(/\{(actual|fieldValue|value|expected|meteringPointId|transactionReference)\}/g, (_match, key: string) => replacements[key] ?? '')
  return formatted.replace(/\s+/g, ' ').trim() || fallback
}

async function insertResolvedDetail(params: {
  sourceMessageId: string
  validationIssueId: string | null
  rule: EdielAperakErrorRuleRow
  issue: EdielAperakValidationIssue
  freeText: string
}): Promise<void> {
  if (!(await tableExistsSafe('ediel_aperak_error_details'))) return

  const { error } = await supabaseService
    .from('ediel_aperak_error_details')
    .upsert(
      {
        source_message_id: params.sourceMessageId,
        validation_issue_id: params.validationIssueId,
        error_rule_id: params.rule.id,
        rule_key: params.issue.ruleKey,
        application_error: params.rule.application_error,
        free_text_code: params.rule.free_text_code,
        free_text: params.freeText,
        metering_point_id: params.issue.meteringPointId,
        transaction_reference: params.issue.transactionReference,
        source_order: params.issue.sourceOrder,
      },
      { onConflict: 'source_message_id,rule_key,application_error,coalesce_free_text_code,coalesce_metering_point_id,coalesce_transaction_reference' }
    )

  if (error) throw error
}

export async function attachAperakErrorDetailsToMessage(params: {
  sourceMessageId: string
  aperakMessageId: string
}): Promise<void> {
  if (!(await tableExistsSafe('ediel_aperak_error_details'))) return

  const { error } = await supabaseService
    .from('ediel_aperak_error_details')
    .update({ aperak_message_id: params.aperakMessageId })
    .eq('source_message_id', params.sourceMessageId)
    .is('aperak_message_id', null)

  if (error) throw error
}

export async function resolveAndStoreProdatAperakErrors(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
}): Promise<EdielResolvedAperakErrors> {
  const { message, testData } = params
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? facts.messageCode ?? '').toUpperCase()
  const environment = String(message.environment ?? 'test').toLowerCase()
  const issues = deriveProdatAperakValidationIssues({ message, testData })

  if (issues.length === 0) {
    return {
      errors: [],
      details: [],
      issueCount: 0,
      matchedRuleKeys: [],
      unmappedIssues: [],
    }
  }

  const rules = await listActiveRules({ family, code, environment })
  const details: EdielResolvedAperakErrorDetail[] = []
  const errors: EdielAperakApplicationError[] = []
  const unmappedIssues: EdielAperakValidationIssue[] = []

  for (const item of issues) {
    const validationIssueId = await insertValidationIssue({ messageId: message.id, issue: item })
    const rule = selectRuleForIssue(rules, item, code, environment)

    if (!rule) {
      unmappedIssues.push(item)
      continue
    }

    const freeText = formatAperakFreeText(rule.free_text, item)
    const detail: EdielResolvedAperakErrorDetail = {
      validationIssueId,
      errorRuleId: rule.id,
      ruleKey: item.ruleKey,
      applicationError: rule.application_error,
      freeTextCode: rule.free_text_code,
      freeText,
      meteringPointId: item.meteringPointId,
      transactionReference: item.transactionReference,
      sourceOrder: item.sourceOrder,
    }

    await insertResolvedDetail({
      sourceMessageId: message.id,
      validationIssueId,
      rule,
      issue: item,
      freeText,
    })

    details.push(detail)
    errors.push({
      ercCode: rule.application_error,
      fieldCode: rule.free_text_code,
      text: freeText,
      referenceQualifier: item.meteringPointId ? 'Z07' : null,
      referenceNumber: item.meteringPointId,
      lineItemReference: item.transactionReference,
    })
  }

  return {
    errors,
    details,
    issueCount: issues.length,
    matchedRuleKeys: Array.from(new Set(details.map((detail) => detail.ruleKey))),
    unmappedIssues,
  }
}
