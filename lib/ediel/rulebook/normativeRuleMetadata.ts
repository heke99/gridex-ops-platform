import { createHash } from 'node:crypto'
import sourceManifest from '@/docs/ediel/masterplan-v2/registers/source_manifest.json'

/**
 * GOV-01 (T §1.2, 1.4; P §1.3): every normative rule must cite its source by
 * document hash, version/revision, page/section, validity and exact scope.
 * A rule lacking any of these is "unproven": it can never be published and so
 * can never be the basis of a new external message or a national error code.
 *
 * This module is the publication gate over the existing code-owned authority
 * (guideRegistry / canonicalRulePackRegistry); it is not a second registry.
 */
export type NormativeRuleSource = {
  document: string
  sha256: string | null
  version: string
  page: number | null
  section: string | null
  validFrom: string
  validTo: string | null
  /** Exact scope tokens, e.g. `PRODAT:Z13`. Wildcards are not exact. */
  scope: readonly string[]
}

export type NormativeRule = {
  ruleId: string
  source: NormativeRuleSource
  content?: Readonly<Record<string, unknown>>
}

export type NormativeRuleField = 'ruleId' | 'document' | 'sha256' | 'version' | 'page' | 'section' | 'validFrom' | 'validTo' | 'scope'

export type NormativeRuleAssessment = { status: 'proven' | 'unproven'; missing: NormativeRuleField[] }

/** Internal refusal code. Deliberately not an ERC/APERAK/UTILTS code. */
export const NORMATIVE_RULE_UNPROVEN = 'ediel_normative_rule_unproven' as const

const REGISTERED_SOURCE_HASHES: ReadonlySet<string> = new Set(sourceManifest.map(source => source.sha256))

/** Registered manifest hash for a source document name, or null when the
 * repository holds no hashed copy of that document. Never guessed. */
export function registeredSourceSha256(documentName: string): string | null {
  const matches = sourceManifest.filter(source => source.filename.startsWith(documentName))
  return matches.length === 1 ? matches[0].sha256 : null
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function assessNormativeRule(rule: NormativeRule | null | undefined): NormativeRuleAssessment {
  const missing: NormativeRuleField[] = []
  const source = rule?.source
  if (!text(rule?.ruleId)) missing.push('ruleId')
  if (!text(source?.document)) missing.push('document')
  if (typeof source?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) || !REGISTERED_SOURCE_HASHES.has(source.sha256)) missing.push('sha256')
  if (!text(source?.version)) missing.push('version')
  if (typeof source?.page !== 'number' || !Number.isInteger(source.page) || source.page < 1) missing.push('page')
  if (!text(source?.section)) missing.push('section')
  if (!isCalendarDate(source?.validFrom)) missing.push('validFrom')
  if (source?.validTo !== null && (!isCalendarDate(source?.validTo) || (isCalendarDate(source?.validFrom) && source.validTo < source.validFrom))) missing.push('validTo')
  const scope = source?.scope
  if (!Array.isArray(scope) || scope.length === 0 || scope.some(token => !text(token) || token !== token.trim() || /[*?]/.test(token))
    || new Set(scope).size !== scope.length) missing.push('scope')
  return { status: missing.length === 0 ? 'proven' : 'unproven', missing }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Content address of one rule version (source citation + content). */
export function normativeRuleVersionHash(rule: NormativeRule): string {
  return sha256(stableStringify({ ruleId: rule.ruleId, source: rule.source, content: rule.content ?? null }))
}

export type NormativeRuleActor = { kind: 'user' | 'service'; id: string }

export type NormativeRuleLedgerEntry = Readonly<{
  sequence: number
  ruleId: string
  versionHash: string
  rule: NormativeRule
  actor: NormativeRuleActor
  publishedAt: string
  previousEntryHash: string | null
  entryHash: string
}>

export type NormativeRuleLedger = readonly NormativeRuleLedgerEntry[]

export const EMPTY_NORMATIVE_RULE_LEDGER: NormativeRuleLedger = Object.freeze([])

function entryHash(entry: Omit<NormativeRuleLedgerEntry, 'entryHash'>): string {
  return sha256(stableStringify({ sequence: entry.sequence, ruleId: entry.ruleId, versionHash: entry.versionHash,
    actor: entry.actor, publishedAt: entry.publishedAt, previousEntryHash: entry.previousEntryHash }))
}

export type NormativeRulePublication =
  | { status: 'published'; entry: NormativeRuleLedgerEntry; ledger: NormativeRuleLedger }
  | { status: 'already_published'; entry: NormativeRuleLedgerEntry; ledger: NormativeRuleLedger }
  | { status: 'unproven'; code: typeof NORMATIVE_RULE_UNPROVEN; missing: NormativeRuleField[]; ledger: NormativeRuleLedger
      externalMessages: readonly []; errorCodes: readonly [] }

/**
 * Publish an immutable rule version into an append-only, hash-chained audit
 * trail. Unproven rules are refused with no version, no external message and
 * no national error code. Republishing identical content is idempotent.
 */
export function publishNormativeRuleVersion(input: {
  ledger: NormativeRuleLedger
  rule: NormativeRule
  actor: NormativeRuleActor
  publishedAt: string
}): NormativeRulePublication {
  if (!input.actor || (input.actor.kind !== 'user' && input.actor.kind !== 'service') || !text(input.actor.id)) {
    throw new Error('normative_rule_publication_actor_required')
  }
  const instant = new Date(input.publishedAt)
  if (typeof input.publishedAt !== 'string' || Number.isNaN(instant.getTime()) || instant.toISOString() !== input.publishedAt) {
    throw new Error('normative_rule_publication_time_invalid')
  }
  const verification = verifyNormativeRuleLedger(input.ledger)
  if (!verification.valid) throw new Error(`normative_rule_ledger_invalid:${verification.reason}`)

  const assessment = assessNormativeRule(input.rule)
  if (assessment.status !== 'proven') {
    return { status: 'unproven', code: NORMATIVE_RULE_UNPROVEN, missing: assessment.missing, ledger: input.ledger,
      externalMessages: [], errorCodes: [] }
  }

  const rule = deepFreeze(structuredClone(input.rule))
  const versionHash = normativeRuleVersionHash(rule)
  const existing = input.ledger.find(entry => entry.ruleId === rule.ruleId && entry.versionHash === versionHash)
  if (existing) return { status: 'already_published', entry: existing, ledger: input.ledger }

  const previous = input.ledger.at(-1) ?? null
  const body = { sequence: input.ledger.length + 1, ruleId: rule.ruleId, versionHash, rule,
    actor: Object.freeze({ kind: input.actor.kind, id: input.actor.id }), publishedAt: input.publishedAt,
    previousEntryHash: previous?.entryHash ?? null }
  const entry: NormativeRuleLedgerEntry = Object.freeze({ ...body, entryHash: entryHash(body) })
  return { status: 'published', entry, ledger: Object.freeze([...input.ledger, entry]) }
}

export function verifyNormativeRuleLedger(ledger: NormativeRuleLedger):
  { valid: true } | { valid: false; reason: string; sequence: number } {
  let previous: string | null = null
  for (const [index, entry] of ledger.entries()) {
    const sequence = index + 1
    if (entry.sequence !== sequence) return { valid: false, reason: 'sequence_gap', sequence }
    if (entry.previousEntryHash !== previous) return { valid: false, reason: 'chain_broken', sequence }
    if (assessNormativeRule(entry.rule).status !== 'proven') return { valid: false, reason: 'rule_unproven', sequence }
    if (normativeRuleVersionHash(entry.rule) !== entry.versionHash || entry.rule.ruleId !== entry.ruleId) {
      return { valid: false, reason: 'version_hash_mismatch', sequence }
    }
    if (entryHash(entry) !== entry.entryHash) return { valid: false, reason: 'entry_hash_mismatch', sequence }
    previous = entry.entryHash
  }
  return { valid: true }
}
