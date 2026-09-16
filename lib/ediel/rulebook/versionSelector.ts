import {
  AUTHORITATIVE_EDIEL_GUIDES,
  resolveAuthoritativeEdielGuide,
  type EdielGuideFamily,
} from '@/lib/ediel/rulebook/guideRegistry'

export type RulebookVersionSelection = {
  selectedVersion: string
  previousVersion: string | null
  acceptedVersions: string[]
  messageTypeToken: string
  guideRevision: string
  effectiveFrom: string
  effectiveTo: string | null
  sourceDocument: string
}

function stockholmIsoDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function normalizeGuideRevision(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function normalizeFamily(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function canonicalGuideFamily(family: string): EdielGuideFamily | null {
  if (family === 'UTILTS_ERR') return 'UTILTS'
  if (family === 'PRODAT' || family === 'UTILTS' || family === 'APERAK' || family === 'CONTRL') {
    return family
  }
  return null
}

function aperakAssociationForSource(sourceMessageFamily: string | null | undefined): string {
  const sourceFamily = normalizeFamily(sourceMessageFamily)
  if (sourceFamily === 'PRODAT') return 'E2SE6A'
  if (sourceFamily === 'UTILTS' || sourceFamily === 'UTILTS_ERR') return 'E5SE5A'
  throw new Error(`ediel_aperak_source_family_required:${sourceFamily || 'missing'}`)
}

function runtimeVersionForGuide(family: string, guide: ReturnType<typeof resolveAuthoritativeEdielGuide>): string {
  if (family === 'PRODAT') return normalizeGuideRevision(guide.guideRevision)
  if (family === 'UTILTS' || family === 'UTILTS_ERR' || family === 'APERAK') {
    if (!guide.associationAssignedCode) throw new Error(`ediel_runtime_version_association_missing:${family}:${guide.guideRevision}`)
    return guide.associationAssignedCode
  }
  if (family === 'CONTRL') return 'EDIEL2'
  throw new Error(`ediel_runtime_version_family_unsupported:${family || 'missing'}`)
}

function messageTypeTokenFor(family: string, selectedVersion: string, sourceMessageFamily?: string | null): string {
  if (family === 'PRODAT') return `PRODAT:D:97A:UN:${selectedVersion === '26A' ? 'E2SE6A' : selectedVersion}`
  if (family === 'APERAK') {
    const sourceFamily = normalizeFamily(sourceMessageFamily)
    if (sourceFamily === 'PRODAT') return `APERAK:D:96A:UN:${selectedVersion}`
    if (sourceFamily === 'UTILTS' || sourceFamily === 'UTILTS_ERR') return `APERAK:D:04A:UN:${selectedVersion}`
    throw new Error(`ediel_aperak_source_family_required:${sourceFamily || 'missing'}`)
  }
  if (family === 'CONTRL') return 'CONTRL:2:2:UN:EDIEL2'
  if (family === 'UTILTS' || family === 'UTILTS_ERR') return `UTILTS:D:02B:UN:${selectedVersion}`
  return `${family}:${selectedVersion}`
}

function previousRuntimeVersion(params: {
  family: string
  guideFamily: EdielGuideFamily
  current: ReturnType<typeof resolveAuthoritativeEdielGuide>
  associationAssignedCode?: string | null
}): string | null {
  const previous = AUTHORITATIVE_EDIEL_GUIDES
    .filter((guide) => {
      if (guide.family !== params.guideFamily) return false
      if (!guide.effectiveTo || guide.effectiveTo >= params.current.effectiveFrom) return false
      if (params.associationAssignedCode && guide.associationAssignedCode !== params.associationAssignedCode) return false
      return true
    })
    .sort((a, b) => String(b.effectiveTo).localeCompare(String(a.effectiveTo)))[0]
  if (!previous) return null
  const previousVersion = runtimeVersionForGuide(params.family, previous)
  const currentVersion = runtimeVersionForGuide(params.family, params.current)
  return previousVersion === currentVersion ? null : previousVersion
}

/**
 * Source-controlled, effective-dated Ediel version selection.
 *
 * Runtime selection must never read route defaults or mutable DB message-rule
 * rows. Missing or ambiguous guide coverage throws instead of guessing latest.
 * APERAK is never a standalone version family: it must be resolved from the
 * message family being acknowledged.
 */
export function selectRulebookVersion(input: {
  family: string | null | undefined
  code?: string | null
  asOf?: Date
  referenceDate?: string | null
  sourceMessageFamily?: string | null
}): RulebookVersionSelection {
  const family = normalizeFamily(input.family)
  const guideFamily = canonicalGuideFamily(family)
  if (!guideFamily) throw new Error(`ediel_runtime_version_family_unsupported:${family || 'missing'}`)

  const referenceDate = input.referenceDate?.trim() || stockholmIsoDate(input.asOf ?? new Date())
  const associationAssignedCode = family === 'APERAK'
    ? aperakAssociationForSource(input.sourceMessageFamily)
    : null
  const guide = resolveAuthoritativeEdielGuide({
    family: guideFamily,
    referenceDate,
    associationAssignedCode,
  })
  const selectedVersion = runtimeVersionForGuide(family, guide)
  const previousVersion = previousRuntimeVersion({
    family,
    guideFamily,
    current: guide,
    associationAssignedCode,
  })
  const acceptedVersions = [...new Set([selectedVersion, previousVersion].filter((value): value is string => Boolean(value)))]

  return {
    selectedVersion,
    previousVersion,
    acceptedVersions,
    messageTypeToken: messageTypeTokenFor(family, selectedVersion, input.sourceMessageFamily),
    guideRevision: guide.guideRevision,
    effectiveFrom: guide.effectiveFrom,
    effectiveTo: guide.effectiveTo,
    sourceDocument: guide.documentName,
  }
}