import type { EdielMessageRow } from '@/lib/ediel/types'
import { fieldRulesForMessage, validateFieldMatrixPayload, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { RegistryFieldRuleResult, RegistryRulePackSnapshot } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import type { EdielDirection, EdielEnvironment } from '@/lib/ediel/types'
import { parseRulebookListPayload, parseRulebookMessage, type ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import {
  getRulebookRule,
  normalizeRulebookToken,
  processGroupForMessage,
  type EdielRulebookIssue,
} from '@/lib/ediel/rulebook/rulebook'
import {
  getCanonicalProdatProfile,
  validateProdatApplicationReference,
} from '@/lib/ediel/rulebook/prodatRulebook'
import { canonicalProdatSubtypeAlias } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

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
  businessDate?: string | null
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

function normalizeProcessGroupAlias(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'customer_masterdata' || normalized.includes('customer_masterdata') || normalized.includes('customer_info') || normalized.includes('data_request') || normalized.includes('facility_contract')) return 'customer_masterdata'
  if (normalized === 'supplier_switch' || normalized.includes('supplier_switch') || normalized.includes('switch') || normalized === 'move_in' || normalized.includes('supply_termination')) return 'supplier_switch'
  if (normalized === 'metering_access' || normalized.includes('metering_access') || normalized.includes('permission')) return 'metering_access'
  if (normalized === 'meter_values' || normalized.includes('meter_value') || normalized.includes('utilts')) return 'meter_values'
  if (normalized === 'ediel_ack' || normalized.includes('ack')) return 'ediel_ack'
  if (normalized === 'ai_list' || normalized.includes('ai_list') || normalized.includes('bi_list')) return 'ai_list'
  return normalized
}

function normalizeProcessGroupInput(value: string | null | undefined, family: string | null, code: string | null): string {
  if (family === 'PRODAT') {
    return getCanonicalProdatProfile(code)?.processGroup ?? 'unknown'
  }
  const normalized = normalizeProcessGroupAlias(value)
  return normalized || processGroupForMessage(family, code)
}

function deriveEdielRoleCode(input: {
  family?: string | null
  code?: string | null
  applicationReference?: string | null
  roleCode?: string | null
}): string | null {
  const explicit = normalizeRulebookToken(input.roleCode)
  if (explicit === 'DDQ' || explicit === 'DGI') return explicit

  if (normalizeRulebookToken(input.family) === 'PRODAT') {
    const canonical = getCanonicalProdatProfile(input.code)
    if (!canonical) return null
    return canonical.applicationReference.includes('DGI') ? 'DGI' : 'DDQ'
  }

  const reference = normalizeRulebookToken(input.applicationReference)
  if (reference.includes('DGI')) return 'DGI'
  if (reference.includes('DDQ')) return 'DDQ'
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

function stockholmDate(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function normalizeBusinessDate(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return null
}

function businessDateForRulePack(input: RulebookValidationInput, parsed: ParsedRulebookMessage | null): string {
  const explicit = normalizeBusinessDate(input.businessDate)
  if (explicit) return explicit
  const documentDate = parsed?.rawSegments
    .find((segment) => /^DTM\+137:/i.test(segment))
    ?.replace(/^DTM\+137:/i, '')
    .split(':')[0]
  return normalizeBusinessDate(documentDate) ?? stockholmDate()
}

export function validateRulebookMessage(input: RulebookValidationInput): RulebookValidationResult {
  const parsed = input.parsed ?? (input.rawPayload ? (input.rawPayload.includes("'") ? parseRulebookMessage(input.rawPayload) : parseRulebookListPayload(input.rawPayload)) : null)
  const family = normalizeRulebookToken(input.family ?? parsed?.family ?? null) || null
  const code = normalizeRulebookToken(input.code ?? parsed?.code ?? null) || null
  const canonicalProdat = family === 'PRODAT' ? getCanonicalProdatProfile(code) : null
  const processGroup = normalizeProcessGroupInput(input.processGroup ?? input.routeScope ?? parsed?.processGroup, family, code)
  const expectedApplicationReference = canonicalProdat?.applicationReference ?? null
  const actualApplicationReference = input.applicationReference ?? parsed?.applicationReference ?? null
  const issues: EdielRulebookIssue[] = [...(parsed?.errors ?? []).map((description) => issue({ severity: 'error', code: 'PARSER_ERROR', title: 'Parserfel', description }))]
  for (const warning of parsed?.warnings ?? []) issues.push(issue({ severity: 'warning', code: 'PARSER_WARNING', title: 'Parser-varning', description: warning }))

  const rule = getRulebookRule(family, code)
  if (!rule && family && code) {
    issues.push(issue({ severity: family === 'PRODAT' ? 'error' : 'warning', code: 'RULEBOOK_RULE_MISSING', title: 'Regel saknas', description: `Ingen canonical regel hittades för ${family} ${code}.` }))
  }

  if (family === 'PRODAT') {
    if (!canonicalProdat) {
      issues.push(issue({ severity: 'error', code: 'PRODAT_CANONICAL_PROFILE_MISSING', title: 'Canonical PRODAT-profil saknas', description: `${code ?? 'saknad kod'} ingår inte i den verifierade source-controlled PRODAT-katalogen.` }))
    }
    if (detectCompositeBgmCode(code)) {
      issues.push(issue({ severity: 'error', code: 'PRODAT_COMPOSITE_BGM_CODE', title: 'Fel BGM-kod', description: `${code} får inte användas som BGM-värde. BGM ska vara t.ex. Z03 och undertyp ska ligga separat i CCI/CAV.` }))
    }

    const suppliedProcess = normalizeProcessGroupAlias(input.processGroup ?? input.routeScope ?? parsed?.processGroup)
    if (canonicalProdat && suppliedProcess && suppliedProcess !== canonicalProdat.processGroup) {
      issues.push(issue({ severity: 'error', code: 'PRODAT_PROCESS_GROUP_MISMATCH', title: 'PRODAT-funktion i fel process', description: `${code} tillhör canonical process ${canonicalProdat.processGroup}, men anropet anger ${suppliedProcess}.` }))
    }

    if (canonicalProdat) {
      const appRef = validateProdatApplicationReference({
        messageCode: canonicalProdat.messageCode,
        applicationReference: actualApplicationReference,
      })
      if (!appRef.ok) {
        issues.push(issue({ severity: 'error', code: 'APPLICATION_REFERENCE_MISMATCH', title: 'Fel Application Reference', description: appRef.reason ?? `${code} har fel Application Reference.` }))
      }
      if (!actualApplicationReference && input.mode === 'send') {
        issues.push(issue({ severity: 'error', code: 'APPLICATION_REFERENCE_MISSING', title: 'Application Reference saknas', description: `${code} kräver canonical ${canonicalProdat.applicationReference}.` }))
      }
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
    for (const fieldRule of fieldRules.filter((fieldRule) => fieldRule.requirement === 'required')) {
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
    code,
    applicationReference,
    roleCode: input.roleCode,
  })

  let canonicalProfileIssue: EdielRulebookIssue | null = null
  let canonicalProfileSnapshot: RegistryRulePackSnapshot | null = null

  // Source-controlled profile/subtype/direction is resolved before the DB call.
  // The DB resolver may only prove activation/evidence for that decision.
  if (family === 'PRODAT' && code && input.direction && input.direction !== 'both') {
    const canonicalProfile = getCanonicalProdatProfile(code)
    const subtype = canonicalProdatSubtypeAlias(parsed?.subtype, code)
    if (!canonicalProfile) {
      canonicalProfileIssue = issue({
        severity: 'error',
        code: 'PRODAT_CANONICAL_PROFILE_MISSING',
        title: 'Canonical PRODAT-profil saknas',
        description: `${code} finns inte i source-controlled PRODAT-katalogen.`,
      })
    } else if (!subtype) {
      canonicalProfileIssue = issue({
        severity: 'error',
        code: 'PRODAT_CANONICAL_SUBTYPE_MISSING',
        title: 'PRODAT-transaktionstyp saknas',
        description: `${code} kan inte valideras mot den aktiva 26.A-profilen utan transaktionstyp/subtype.`,
      })
    } else {
      const expectedDirection: EdielDirection = canonicalProfile.direction === 'actor_to_portal' ? 'outbound' : 'inbound'
      if (input.direction !== expectedDirection) {
        canonicalProfileIssue = issue({
          severity: 'error',
          code: 'PRODAT_CANONICAL_DIRECTION_NOT_ALLOWED',
          title: 'PRODAT-riktningen är inte tillåten',
          description: `${code} är canonical ${expectedDirection} för aktuell marknadsroll, inte ${input.direction}.`,
        })
      } else {
        try {
          const { resolveCanonicalRulePack } = await import('@/lib/ediel/rulebook/canonicalRulePackRegistry')
          const resolved = await resolveCanonicalRulePack({
            family: 'PRODAT',
            messageCode: code,
            transactionSubtype: subtype,
            direction: input.direction,
            businessDate: businessDateForRulePack(input, parsed),
            requireBuilder: input.direction === 'outbound' && input.mode === 'send',
            requireStateMachine: true,
          })
          canonicalProfileSnapshot = {
            profileKey: resolved.profileKey,
            profileVersionId: resolved.messageProfileId,
            version: `${resolved.guideVersion}:r${resolved.guideRevision}`,
            checksum: resolved.sourceHash,
          }
        } catch (error) {
          canonicalProfileIssue = issue({
            severity: 'error',
            code: 'PRODAT_CANONICAL_EVIDENCE_NOT_ACTIVE',
            title: 'Canonical PRODAT-profil saknar giltig runtime-evidence',
            description: `${code}${subtype} är source-valid men saknar en exakt matchande aktiv evidence/activation för direction=${input.direction}. Meddelandet blockeras.`,
          })
        }
      }
    }
  }

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

  const result = validateRulebookMessage({
    ...input,
    parsed,
    processGroup,
    applicationReference,
    roleCode,
    fieldRules: registry.source === 'registry' ? registry.rules : input.fieldRules,
    fieldRuleSource: registry.source,
    rulePackSnapshot: canonicalProfileSnapshot ?? registry.rulePack,
  })

  if (!canonicalProfileIssue) return result
  return {
    ...result,
    ok: false,
    blocking: true,
    issues: [...result.issues, canonicalProfileIssue],
    rulePackSnapshot: canonicalProfileSnapshot ?? result.rulePackSnapshot,
  }
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
