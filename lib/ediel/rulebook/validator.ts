import type { EdielDirection, EdielMessageRow } from '@/lib/ediel/types'
import { parseRulebookListPayload, parseRulebookMessage, type ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import type { RegistryRulePackSnapshot } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import {
  validateRulebookMessage as validateLegacyRulebookMessage,
  validateRulebookMessageWithRegistry as validateLegacyRulebookMessageWithRegistry,
  type RulebookValidationInput as LegacyRulebookValidationInput,
  type RulebookValidationResult as LegacyRulebookValidationResult,
} from '@/lib/ediel/rulebook/validatorLegacy'
import type { ProdatDependentConditionEvaluation } from '@/lib/ediel/prodat/prodatDependentConditionEngine'

export type RulebookValidationInput = LegacyRulebookValidationInput & {
  /** Draft metadata from the canonical renderer. Used to verify that production
   * PRODAT D-conditions were already resolved with the original business facts. */
  parsedPayload?: Record<string, unknown> | null
}

export type RulebookValidationResult = LegacyRulebookValidationResult

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function issue(input: Omit<EdielRulebookIssue, 'blocking'> & { blocking?: boolean }): EdielRulebookIssue {
  return { ...input, blocking: input.blocking ?? input.severity === 'error' }
}

function parse(input: RulebookValidationInput): ParsedRulebookMessage | null {
  if (input.parsed) return input.parsed
  if (!input.rawPayload) return null
  return input.rawPayload.includes("'")
    ? parseRulebookMessage(input.rawPayload)
    : parseRulebookListPayload(input.rawPayload)
}

function businessDate(input: RulebookValidationInput, parsed: ParsedRulebookMessage | null): string {
  const explicit = String(input.businessDate ?? '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit
  const raw = parsed?.rawSegments
    .find((segment) => /^DTM\+137:/i.test(segment))
    ?.replace(/^DTM\+137:/i, '')
    .split(':')[0]
    ?.replace(/\D/g, '') ?? ''
  if (raw.length >= 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function isActiveCanonicalFamily(family: string): family is 'PRODAT' | 'UTILTS' {
  return family === 'PRODAT' || family === 'UTILTS'
}

function direction(input: RulebookValidationInput): EdielDirection | null {
  return input.direction === 'inbound' || input.direction === 'outbound' ? input.direction : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function renderedDependentSnapshot(input: RulebookValidationInput): unknown[] | null {
  const payload = record(input.parsedPayload)
  const engine = record(payload?.prodatEngine)
  const direct = engine?.dependentConditionStatuses ?? payload?.prodatDependentConditions
  return Array.isArray(direct) ? direct : null
}

function canonicalizeRenderedDependentSnapshot(input: {
  policy: CanonicalEdielPolicy
  snapshot: unknown[] | null
}): ProdatDependentConditionEvaluation[] | null {
  if (!input.snapshot) return null
  const byId = new Map<string, Record<string, unknown>>()
  for (const value of input.snapshot) {
    const row = record(value)
    const id = String(row?.id ?? '').trim()
    if (!id || byId.has(id)) return null
    byId.set(id, row ?? {})
  }
  if (byId.size !== input.policy.prodatDependentConditions.length) return null

  const results: ProdatDependentConditionEvaluation[] = []
  for (const canonical of input.policy.prodatDependentConditions) {
    const row = byId.get(canonical.id)
    if (!row) return null
    const status = String(row.status ?? '')
    if (status !== 'required' && status !== 'not_required' && status !== 'undetermined') return null
    if (String(row.fieldNumber ?? '') !== canonical.fieldNumber) return null
    results.push({
      ...canonical,
      status,
    })
  }
  return results
}

function policyForValidation(input: RulebookValidationInput, parsed: ParsedRulebookMessage): CanonicalEdielPolicy {
  const family = normalize(input.family ?? parsed.family)
  const code = normalize(input.code ?? parsed.code)
  const dir = direction(input)
  if (!dir) throw new Error(`canonical_policy_direction_required:${family}:${code}`)

  const policy = resolveCanonicalEdielPolicy({
    family,
    messageCode: code,
    subtypeOrReasonCode: parsed.subtype,
    direction: dir,
    referenceDate: businessDate(input, parsed),
    associationAssignedCode: input.version ?? null,
    applicationReference: input.applicationReference ?? parsed.applicationReference ?? null,
    mode: input.mode === 'send' ? 'catalog_evidence' : 'parse',
  })

  if (family !== 'PRODAT' || input.mode !== 'send') return policy
  const snapshot = canonicalizeRenderedDependentSnapshot({
    policy,
    snapshot: renderedDependentSnapshot(input),
  })
  const production = input.environment === 'production'
  if (!snapshot) {
    if (production) throw new Error(`prodat_canonical_policy_snapshot_missing:${code}`)
    return policy
  }
  if (production && snapshot.some((condition) => condition.status === 'undetermined')) {
    const ids = snapshot.filter((condition) => condition.status === 'undetermined').map((condition) => condition.id)
    throw new Error(`prodat_dependent_condition_undetermined:${ids.join(',')}`)
  }
  return { ...policy, prodatDependentConditions: snapshot }
}

function canonicalValidation(input: RulebookValidationInput): RulebookValidationResult {
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  const code = normalize(input.code ?? parsed?.code)
  const parserIssues: EdielRulebookIssue[] = [
    ...(parsed?.errors ?? []).map((description) => issue({ severity: 'error', code: 'PARSER_ERROR', title: 'Parserfel', description })),
    ...(parsed?.warnings ?? []).map((description) => issue({ severity: 'warning', code: 'PARSER_WARNING', title: 'Parser-varning', description })),
  ]

  if (!parsed) {
    const issues = [...parserIssues, issue({ severity: 'error', code: 'CANONICAL_PAYLOAD_REQUIRED', title: 'Payload saknas', description: `${family} ${code} kan inte valideras utan payload.` })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed: null, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
  }

  try {
    const policy = policyForValidation(input, parsed)
    if (input.processGroup && policy.processGroup && String(input.processGroup).trim() !== policy.processGroup) {
      parserIssues.push(issue({
        severity: 'error',
        code: 'CANONICAL_PROCESS_GROUP_MISMATCH',
        title: 'Processgrupp matchar inte canonical policy',
        description: `${family} ${code} tillhör ${policy.processGroup}, men anropet anger ${input.processGroup}.`,
      }))
    }

    let fieldIssues = validateCanonicalPolicyFields({ policy, rawSegments: parsed.rawSegments })
    if (input.mode === 'send' && input.environment !== 'production') {
      fieldIssues = fieldIssues.map((entry) =>
        entry.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'
          ? { ...entry, severity: 'warning' as const, blocking: false }
          : entry,
      )
    }
    const issues = [...parserIssues, ...fieldIssues]
    const blocking = issues.some((entry) => entry.severity === 'error' || entry.blocking)
    return {
      ok: !blocking,
      blocking,
      family: policy.family,
      code: policy.code,
      processGroup: policy.processGroup ?? 'unknown',
      expectedApplicationReference: policy.applicationReference,
      parsed,
      issues,
      fieldRuleSource: 'registry',
      rulePackSnapshot: null,
    }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    const issues = [...parserIssues, issue({
      severity: 'error',
      code: 'CANONICAL_POLICY_VALIDATION_FAILED',
      title: 'Canonical Ediel-policy blockerade validering',
      description,
    })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed, issues, fieldRuleSource: 'registry', rulePackSnapshot: null }
  }
}

export function validateRulebookMessage(input: RulebookValidationInput): RulebookValidationResult {
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(family)) return validateLegacyRulebookMessage(input)
  return canonicalValidation({ ...input, parsed })
}

export async function validateRulebookMessageWithRegistry(input: RulebookValidationInput): Promise<RulebookValidationResult> {
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(family)) return validateLegacyRulebookMessageWithRegistry(input)

  const result = canonicalValidation({ ...input, parsed })
  if (!parsed || result.blocking) return result
  const dir = direction(input)
  if (!dir) return { ...result, ok: false, blocking: true, issues: [...result.issues, issue({ severity: 'error', code: 'CANONICAL_EVIDENCE_DIRECTION_REQUIRED', title: 'Riktning saknas', description: 'Rule-pack evidence kräver explicit inbound/outbound-riktning.' })] }

  try {
    const policy = policyForValidation({ ...input, parsed }, parsed)
    const evidence = await resolveCanonicalRulePack({
      family: policy.family as 'PRODAT' | 'UTILTS',
      messageCode: policy.code,
      transactionSubtype: policy.subtype,
      direction: dir,
      businessDate: policy.referenceDate,
      requireBuilder: dir === 'outbound' && input.mode === 'send',
      requireStateMachine: true,
    })
    const snapshot: RegistryRulePackSnapshot = {
      profileKey: evidence.profileKey,
      profileVersionId: evidence.messageProfileId,
      version: `${evidence.guideVersion}:r${evidence.guideRevision}`,
      checksum: evidence.sourceHash,
    }
    return { ...result, fieldRuleSource: 'registry', rulePackSnapshot: snapshot }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    const issues = [...result.issues, issue({
      severity: 'error',
      code: 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE',
      title: 'Canonical runtime-evidence saknas',
      description,
    })]
    return { ...result, ok: false, blocking: true, issues, fieldRuleSource: 'registry', rulePackSnapshot: null }
  }
}

/**
 * Stable synchronous compatibility API used by transport send guards. Active
 * PRODAT/UTILTS rows are still validated by this file's canonical policy path;
 * the function no longer delegates those families to the legacy validator.
 */
export function validateEdielMessageRowWithRulebook(
  message: EdielMessageRow,
  mode: 'send' | 'parse' | 'test' = 'send',
): RulebookValidationResult {
  return validateRulebookMessage({
    family: message.message_family,
    code: String(message.message_code ?? ''),
    processGroup: message.process_type ?? message.route_scope ?? null,
    routeScope: message.route_scope ?? null,
    applicationReference: message.application_reference,
    rawPayload: message.raw_payload,
    parsedPayload: message.parsed_payload ?? null,
    mode,
    direction: message.direction,
    environment: message.environment,
    version: message.message_version,
    companyId: message.company_id,
  })
}
