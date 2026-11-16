import { CANONICAL_EDIEL_RULES } from '@/lib/ediel/rulebook/canonicalRules'

export type CompileRuleProfileInput = {
  profileKey: string
  version: string
  sourceDocument?: string | null
  sourceVersion?: string | null
  validFrom?: string | null
  validTo?: string | null
  fieldRules: Array<{ ruleType: string; segment: string; qualifier?: string | null; rulePayload?: Record<string, unknown> }>
}

export type CompileRuleProfileResult = {
  ok: boolean
  profileKey: string
  version: string
  canonicalRuleCount: number
  fieldRuleCount: number
  conflicts: string[]
  warnings: string[]
  compiled: Record<string, unknown>
}

export function compileRuleProfile(input: CompileRuleProfileInput): CompileRuleProfileResult {
  const conflicts: string[] = []
  const warnings: string[] = []

  for (const rule of input.fieldRules) {
    const ruleType = String(rule.ruleType ?? '').toLowerCase()
    const segment = String(rule.segment ?? '').toUpperCase()
    const qualifier = String(rule.qualifier ?? '').toUpperCase()

    if (ruleType === 'forbidden' && segment === 'UNB') conflicts.push('Field Matrix får inte förbjuda UNB. Canonical EDIFACT-envelope kräver UNB.')
    if (ruleType === 'forbidden' && segment === 'BGM') conflicts.push('Field Matrix får inte förbjuda BGM. Meddelandefunktion kräver BGM.')
    if (ruleType === 'forbidden' && segment === 'UNH') conflicts.push('Field Matrix får inte förbjuda UNH. Canonical EDIFACT-envelope kräver UNH.')
    if (ruleType === 'forbidden' && segment === 'NAD' && ['FR', 'DO'].includes(qualifier)) conflicts.push(`Field Matrix får inte förbjuda NAD+${qualifier}; aktörsadressering kräver segmentet.`)
  }

  if (!input.sourceDocument) warnings.push('Källdokument saknas. Ange t.ex. PRODAT 26.A eller UTILTS/TGT-anvisning.')
  if (!input.validFrom) warnings.push('Giltig-från saknas. Profilen kan aktiveras men bör versioneras före produktion.')

  return {
    ok: conflicts.length === 0,
    profileKey: input.profileKey,
    version: input.version,
    canonicalRuleCount: CANONICAL_EDIEL_RULES.length,
    fieldRuleCount: input.fieldRules.length,
    conflicts,
    warnings,
    compiled: {
      profileKey: input.profileKey,
      version: input.version,
      sourceDocument: input.sourceDocument ?? null,
      sourceVersion: input.sourceVersion ?? null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      canonicalRulesLocked: CANONICAL_EDIEL_RULES.map((rule) => rule.key),
      fieldRuleCount: input.fieldRules.length,
    },
  }
}
