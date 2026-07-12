import type { EdielMessageRow } from '@/lib/ediel/types'
import { fieldRulesForMessage, validateFieldMatrixPayload, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { RegistryFieldRuleResult, RegistryRulePackSnapshot } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import type { EdielDirection, EdielEnvironment } from '@/lib/ediel/types'
import { parseRulebookListPayload, parseRulebookMessage, type ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import {
  defaultApplicationReferenceForProcess,
  getRulebookRule,
  isProdatCustomerMasterdataCode,
  isProdatMeteringAccessCode,
  isProdatSupplierSwitchCode,
  normalizeRulebookToken,
  processGroupForMessage,
  type EdielRulebookIssue,
} from '@/lib/ediel/rulebook/rulebook'

export type RulebookValidationInput = {
  family?: string | null
  code?: string | null
  processGroup?: string | null
  routeScope?: string | null
  applicationReference?: string | null
  rawPayload?: string | null
  parsed?: ParsedRulebookMessage | null
  mode?: 'send' | 'parse' | 'test'
  roleCode?: string | null
  direction?: EdielDirection | 'both' | null
  environment?: EdielEnvironment | 'all' | null
  version?: string | null
  companyId?: string | null
  fieldRules?: readonly RulebookFieldRule[] | null
  fieldRuleSource?: 'static' | 'registry'
  rulePackSnapshot?: RegistryRulePackSnapshot | null
}

export type RulebookValidationResult = {
  ok: boolean
  blocking: boolean
  family: string | null
  code: string | null
  processGroup: string
  expectedApplicationReference: string | null
  parsed: ParsedRulebookMessage | null
  issues: EdielRulebookIssue[]
  fieldRuleSource: 'static' | 'registry'
  rulePackSnapshot: RegistryRulePackSnapshot | null
}

function issue(input: EdielRulebookIssue): EdielRulebookIssue {
  return { blocking: input.severity === 'error', ...input }
}

function detectCompositeBgmCode(code: string | null): boolean {
  return Boolean(code && /^Z\d{2}[A-Z]+$/i.test(code))
}


function normalizeProcessGroupInput(value: string | null | undefined, family: string | null, code: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return processGroupForMessage(family, code)
  if (normalized === 'customer_masterdata' || normalized.includes('customer_masterdata') || normalized.includes('customer_info') || normalized.includes('data_request')) return 'customer_masterdata'
  if (normalized === 'supplier_switch' || normalized.includes('supplier_switch') || normalized.includes('switch')) return 'supplier_switch'
  if (normalized === 'metering_access' || normalized.includes('metering_access') || normalized.includes('permission')) return 'metering_access'
  if (normalized === 'meter_values' || normalized.includes('meter_value') || normalized.includes('utilts')) return 'meter_values'
  if (normalized === 'ediel_ack' || normalized.includes('ack')) return 'ediel_ack'
  if (normalized === 'ai_list' || normalized.includes('ai_list') || normalized.includes('bi_list')) return 'ai_list'
  return processGroupForMessage(family, code)
}

function deriveEdielRoleCode(input: {
  family?: string | null
  processGroup?: string | null
  applicationReference?: string | null
  roleCode?: string | null
}): string | null {
  const explicit = normalizeRulebookToken(input.roleCode)
  if (explicit === 'DDQ' || explicit === 'DGI') return explicit
  const reference = normalizeRulebookToken(input.applicationReference)
  if (reference.includes('DGI')) return 'DGI'
  if (reference.includes('DDQ')) return 'DDQ'
  const processGroup = String(input.processGroup ?? '').trim().toLowerCase()
  if (processGroup.includes('metering') || processGroup.includes('permission')) return 'DGI'
  if (normalizeRulebookToken(input.family) === 'PRODAT') return 'DDQ'
  return null
}

function ensureNoMixedProdatFunctions(rawPayload: string | null | undefined, issues: EdielRulebookIssue[]) {
  if (!rawPayload) return
  const bgmCodes = Array.from(new Set(Array.from(rawPayload.matchAll(/BGM\+([A-Z0-9]+)/gi)).map((match) => match[1]?.toUpperCase()).filter(Boolean)))
  const prodatCodes = bgmCodes.filter((code) => /^Z\d{2}$/.test(code))
  if (prodatCodes.length > 1) {
    issues.push(issue({ severity: 'error', code: 'PRODAT_MIXED_FUNCTIONS', title: 'Flera PRODAT-funktioner i samma payload', description: `Payload innehåller ${prodatCodes.join(', ')}. PRODAT-funktioner får inte blandas i samma överföring.` }))
  }
}

export function validateRulebookMessage(input: RulebookValidationInput): RulebookValidationResult {
  const parsed = input.parsed ?? (input.rawPayload ? (input.rawPayload.includes("'") ? parseRulebookMessage(input.rawPayload) : parseRulebookListPayload(input.rawPayload)) : null)
  const family = normalizeRulebookToken(input.family ?? parsed?.family ?? null) || null
  const code = normalizeRulebookToken(input.code ?? parsed?.code ?? null) || null
  const processGroup = normalizeProcessGroupInput(input.processGroup ?? input.routeScope ?? parsed?.processGroup, family, code)
  const expectedApplicationReference = defaultApplicationReferenceForProcess(processGroup as never, family)
  const actualApplicationReference = input.applicationReference ?? parsed?.applicationReference ?? null
  const issues: EdielRulebookIssue[] = [...(parsed?.errors ?? []).map((description) => issue({ severity: 'error', code: 'PARSER_ERROR', title: 'Parserfel', description }))]
  for (const warning of parsed?.warnings ?? []) issues.push(issue({ severity: 'warning', code: 'PARSER_WARNING', title: 'Parser-varning', description: warning }))

  const rule = getRulebookRule(family, code)
  if (!rule && family && code) {
    issues.push(issue({ severity: 'warning', code: 'RULEBOOK_RULE_MISSING', title: 'Regel saknas', description: `Ingen aktiv rulebook-regel hittades för ${family} ${code}.` }))
  }

  if (family === 'PRODAT') {
    if (detectCompositeBgmCode(code)) {
      issues.push(issue({ severity: 'error', code: 'PRODAT_COMPOSITE_BGM_CODE', title: 'Fel BGM-kod', description: `${code} får inte användas som BGM-värde. BGM ska vara t.ex. Z03 och undertyp ska ligga separat i CCI/CAV.` }))
    }
    if (isProdatMeteringAccessCode(code) && processGroup !== 'metering_access') {
      issues.push(issue({ severity: 'error', code: 'PRODAT_PERMISSION_WRONG_PROCESS', title: 'Mätvärdesåtkomst i fel process', description: `${code} måste ligga i metering_access, inte ${processGroup}.` }))
    }
    if ((isProdatSupplierSwitchCode(code) || isProdatCustomerMasterdataCode(code)) && processGroup === 'metering_access') {
      issues.push(issue({ severity: 'error', code: 'PRODAT_SWITCH_WRONG_PROCESS', title: 'Leverantörs-/kunddata i fel process', description: `${code} får inte skickas som metering_access.` }))
    }
    if (expectedApplicationReference && actualApplicationReference && normalizeRulebookToken(actualApplicationReference) !== normalizeRulebookToken(expectedApplicationReference)) {
      issues.push(issue({ severity: 'error', code: 'APPLICATION_REFERENCE_MISMATCH', title: 'Fel Application Reference', description: `${code} i ${processGroup} ska använda ${expectedApplicationReference}, men payload/route anger ${actualApplicationReference}.` }))
    }
    if (expectedApplicationReference && !actualApplicationReference && input.mode === 'send') {
      issues.push(issue({ severity: 'error', code: 'APPLICATION_REFERENCE_MISSING', title: 'Application Reference saknas', description: `${code} i ${processGroup} kräver ${expectedApplicationReference}.` }))
    }
    ensureNoMixedProdatFunctions(input.rawPayload, issues)
  }

  if ((family === 'AI_LIST' || family === 'BI_LIST') && input.rawPayload) {
    if (!input.rawPayload.includes(';')) {
      issues.push(issue({ severity: 'warning', code: 'AI_BI_DELIMITER_WARNING', title: 'Kontrollera separator', description: 'AI/BI-listor ska vara semikolonseparerade även när filändelsen är .csv.' }))
    }
  }

  const fieldRules = input.fieldRules ?? fieldRulesForMessage(family, code)
  if (input.mode === 'send') {
    for (const fieldRule of fieldRules.filter((rule) => rule.requirement === 'required')) {
      if (fieldRule.fieldKey === 'application_reference' && expectedApplicationReference && !actualApplicationReference) {
        issues.push(issue({ severity: 'error', code: fieldRule.errorCodeIfMissing ?? 'REQUIRED_FIELD_MISSING', title: `${fieldRule.label} saknas`, description: `${fieldRule.segmentPath} krävs för ${family} ${code}.`, fieldPath: fieldRule.segmentPath }))
      }
    }
  }

  const fieldMatrixIssues = validateFieldMatrixPayload({
    family,
    code,
    rawSegments: parsed?.rawSegments ?? [],
    applicationReference: actualApplicationReference,
    expectedApplicationReference,
    mode: input.mode ?? 'send',
  }, fieldRules)

  issues.push(...fieldMatrixIssues)

  const blocking = issues.some((item) => item.severity === 'error' || item.blocking)
  return {
    ok: !blocking,
    blocking,
    family,
    code,
    processGroup,
    expectedApplicationReference,
    parsed,
    issues,
    fieldRuleSource: input.fieldRuleSource ?? 'static',
    rulePackSnapshot: input.rulePackSnapshot ?? null,
  }
}

export async function validateRulebookMessageWithRegistry(input: RulebookValidationInput): Promise<RulebookValidationResult> {
  const parsed = input.parsed ?? (input.rawPayload ? (input.rawPayload.includes("'") ? parseRulebookMessage(input.rawPayload) : parseRulebookListPayload(input.rawPayload)) : null)
  const family = normalizeRulebookToken(input.family ?? parsed?.family ?? null) || null
  const code = normalizeRulebookToken(input.code ?? parsed?.code ?? null) || null
  const processGroup = normalizeProcessGroupInput(input.processGroup ?? input.routeScope ?? parsed?.processGroup, family, code)
  const applicationReference = input.applicationReference ?? parsed?.applicationReference ?? null
  const roleCode = deriveEdielRoleCode({
    family,
    processGroup,
    applicationReference,
    roleCode: input.roleCode,
  })

  let registry: RegistryFieldRuleResult = { rules: [], source: 'static', rulePack: null }
  if (family && code) {
    const { loadRegistryFieldRules } = await import('@/lib/ediel/rulebook/fieldRuleRegistry')
    registry = await loadRegistryFieldRules({
      family,
      code,
      roleCode,
      direction: input.direction ?? null,
      environment: input.environment ?? null,
      version: input.version ?? null,
      companyId: input.companyId ?? null,
    })
  }

  return validateRulebookMessage({
    ...input,
    parsed,
    processGroup,
    applicationReference,
    roleCode,
    fieldRules: registry.source === 'registry' ? registry.rules : input.fieldRules,
    fieldRuleSource: registry.source,
    rulePackSnapshot: registry.rulePack,
  })
}

export function validateEdielMessageRowWithRulebook(message: EdielMessageRow, mode: 'send' | 'parse' | 'test' = 'send'): RulebookValidationResult {
  return validateRulebookMessage({
    family: message.message_family,
    code: String(message.message_code ?? ''),
    processGroup: message.process_type ?? message.route_scope ?? null,
    routeScope: message.route_scope ?? null,
    applicationReference: message.application_reference,
    rawPayload: message.raw_payload,
    mode,
  })
}
