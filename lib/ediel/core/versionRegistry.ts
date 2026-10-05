// lib/ediel/core/versionRegistry.ts

import { supabaseService } from '@/lib/supabase/service'
import { selectRulebookVersion } from '@/lib/ediel/rulebook/versionSelector'
import type {
  EdielEnvironment,
  EdielMessageRuleRow,
  EdielMessageStandard,
} from '@/lib/ediel/types'

type ResolveMessageVersionInput = {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  date?: string | null
}

export type ResolvedEdielMessageRuleRow = Pick<
  EdielMessageRuleRow,
  | 'id'
  | 'message_family'
  | 'message_code'
  | 'message_standard'
  | 'version_code'
  | 'direction'
  | 'requires_contrl'
  | 'requires_aperak'
  | 'supports_negative_response'
  | 'is_active'
  | 'valid_from'
  | 'valid_to'
  | 'notes'
>

export type ResolvedInboundEdielMessageRuleRow = Pick<
  EdielMessageRuleRow,
  | 'id'
  | 'version_code'
  | 'valid_from'
  | 'valid_to'
  | 'requires_contrl'
  | 'requires_aperak'
  | 'supports_negative_response'
>

export type ResolvedVersionWindow = {
  selectedVersion: string | null
  currentVersion: string | null
  previousVersion: string | null
  acceptedVersions: string[]
  selectedRule: ResolvedEdielMessageRuleRow | null
  currentRule: ResolvedEdielMessageRuleRow | null
  previousRule: ResolvedInboundEdielMessageRuleRow | null
}

function todayIsoDate(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => sanitize(value)).filter(Boolean) as string[])]
}

function normalizeResolvedRule(value: unknown): ResolvedEdielMessageRuleRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as ResolvedEdielMessageRuleRow
}

function normalizeResolvedInboundRules(value: unknown): ResolvedInboundEdielMessageRuleRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(Boolean) as ResolvedInboundEdielMessageRuleRow[]
}

function sortInboundRulesByPriority(rows: ResolvedInboundEdielMessageRuleRow[]): ResolvedInboundEdielMessageRuleRow[] {
  return [...rows].sort((a, b) => {
    const aFrom = a.valid_from ?? ''
    const bFrom = b.valid_from ?? ''
    if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)

    const aTo = a.valid_to ?? '9999-12-31'
    const bTo = b.valid_to ?? '9999-12-31'
    if (aTo !== bTo) return aTo.localeCompare(bTo)

    return String(a.version_code).localeCompare(String(b.version_code))
  })
}

function isCanonicalEdifactFamily(family: string, standard: EdielMessageStandard): boolean {
  if (standard !== 'edifact') return false
  const normalized = family.trim().toUpperCase()
  return ['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK', 'CONTRL'].includes(normalized)
}

function canonicalVersionWindow(params: {
  family: string
  code: string
  date?: string | null
}): ResolvedVersionWindow {
  const selection = selectRulebookVersion({
    family: params.family,
    code: params.code,
    referenceDate: params.date ?? todayIsoDate(),
  })
  return {
    selectedVersion: selection.selectedVersion,
    currentVersion: selection.selectedVersion,
    previousVersion: selection.previousVersion,
    acceptedVersions: selection.acceptedVersions,
    selectedRule: null,
    currentRule: null,
    previousRule: null,
  }
}

// Evidence-only accessors. These functions intentionally expose persisted DB
// rows for admin/audit/history. They are not normative runtime version selectors.
export async function getActiveEdielMessageRuleFromRegistry(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  direction?: 'inbound' | 'outbound' | 'both'
  date?: string | null
}): Promise<ResolvedEdielMessageRuleRow | null> {
  const direction = params.direction ?? 'outbound'
  const date = params.date ?? todayIsoDate()
  const standard = params.standard ?? 'edifact'

  const { data, error } = await supabaseService.rpc('ediel_resolve_message_rule', {
    p_message_family: params.family,
    p_message_code: params.code,
    p_message_standard: standard,
    p_direction: direction,
    p_reference_date: date,
  })

  if (error) throw error
  if (Array.isArray(data) && data.length > 0) return normalizeResolvedRule(data[0])
  return normalizeResolvedRule(data)
}

export async function resolveInboundAcceptedMessageRulesFromRegistry(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedInboundEdielMessageRuleRow[]> {
  const date = params.date ?? todayIsoDate()
  const standard = params.standard ?? 'edifact'

  const { data, error } = await supabaseService.rpc('ediel_resolve_inbound_message_rules', {
    p_message_family: params.family,
    p_message_code: params.code,
    p_message_standard: standard,
    p_reference_date: date,
  })

  if (error) throw error
  return sortInboundRulesByPriority(normalizeResolvedInboundRules(data))
}

async function resolveLegacyOutboundEvidenceWindow(
  input: ResolveMessageVersionInput & { routeDefaultMessageVersion?: string | null },
): Promise<ResolvedVersionWindow> {
  const standard = input.standard ?? 'edifact'
  const date = input.date ?? todayIsoDate()
  const currentRule =
    (await getActiveEdielMessageRuleFromRegistry({ family: input.family, code: input.code, standard, direction: 'outbound', date })) ??
    (await getActiveEdielMessageRuleFromRegistry({ family: input.family, code: input.code, standard, direction: 'both', date }))
  const inboundAccepted = await resolveInboundAcceptedMessageRulesFromRegistry({ family: input.family, code: input.code, standard, date })
  const previousRule = inboundAccepted[1] ?? null
  const acceptedVersions = uniqueStrings([
    currentRule?.version_code,
    previousRule?.version_code,
    ...inboundAccepted.map((row) => row.version_code),
    input.fallback ?? null,
    input.routeDefaultMessageVersion ?? null,
  ])
  const selectedVersion = sanitize(currentRule?.version_code) ?? sanitize(input.routeDefaultMessageVersion) ?? sanitize(input.fallback) ?? sanitize(previousRule?.version_code)

  return {
    selectedVersion,
    currentVersion: sanitize(currentRule?.version_code),
    previousVersion: sanitize(previousRule?.version_code),
    acceptedVersions,
    selectedRule: currentRule,
    currentRule,
    previousRule,
  }
}

export async function resolveOutboundMessageVersionRuntimeFromRegistry(
  input: ResolveMessageVersionInput & { routeDefaultMessageVersion?: string | null },
): Promise<ResolvedVersionWindow> {
  const standard = input.standard ?? 'edifact'
  if (isCanonicalEdifactFamily(input.family, standard)) {
    // fallback and routeDefaultMessageVersion are compatibility inputs only.
    // Canonical Ediel runtime selection is effective-dated source code and
    // cannot be overridden by route, draft, DB row or local default.
    return canonicalVersionWindow({ family: input.family, code: input.code, date: input.date })
  }
  return resolveLegacyOutboundEvidenceWindow(input)
}

export async function resolveInboundAcceptedVersionsRuntimeFromRegistry(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedVersionWindow> {
  const standard = params.standard ?? 'edifact'
  if (isCanonicalEdifactFamily(params.family, standard)) {
    return canonicalVersionWindow({ family: params.family, code: params.code, date: params.date })
  }

  const date = params.date ?? todayIsoDate()
  const inboundAccepted = await resolveInboundAcceptedMessageRulesFromRegistry({ family: params.family, code: params.code, standard, date })
  const currentRule =
    (await getActiveEdielMessageRuleFromRegistry({ family: params.family, code: params.code, standard, direction: 'inbound', date })) ??
    (await getActiveEdielMessageRuleFromRegistry({ family: params.family, code: params.code, standard, direction: 'both', date }))
  const selectedRule = currentRule ?? normalizeResolvedRule(inboundAccepted[0] ?? null)
  const previousRule = inboundAccepted[1] ?? null

  return {
    selectedVersion: sanitize(selectedRule?.version_code),
    currentVersion: sanitize(selectedRule?.version_code),
    previousVersion: sanitize(previousRule?.version_code),
    acceptedVersions: uniqueStrings(inboundAccepted.map((row) => row.version_code)),
    selectedRule,
    currentRule: currentRule ?? selectedRule,
    previousRule,
  }
}

export async function resolveCanonicalOutboundVersion(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  routeDefaultMessageVersion?: string | null
  date?: string | null
}) {
  const runtime = await resolveOutboundMessageVersionRuntimeFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? null,
    environment: params.environment ?? 'test',
    routeDefaultMessageVersion: params.routeDefaultMessageVersion ?? null,
    date: params.date ?? null,
  })
  return runtime.selectedVersion
}

export async function resolveCanonicalInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  const standard = params.standard ?? 'edifact'
  if (isCanonicalEdifactFamily(params.family, standard)) {
    const runtime = canonicalVersionWindow({ family: params.family, code: params.code, date: params.date })
    return runtime.acceptedVersions.map((version) => ({ version_code: version }))
  }

  return resolveInboundAcceptedMessageRulesFromRegistry({
    family: params.family,
    code: params.code,
    standard,
    date: params.date ?? null,
  }).then((rules) =>
    rules.map((rule) => ({
      id: rule.id,
      version_code: rule.version_code,
      valid_from: rule.valid_from,
      valid_to: rule.valid_to,
      requires_contrl: rule.requires_contrl,
      requires_aperak: rule.requires_aperak,
      supports_negative_response: rule.supports_negative_response,
    })),
  )
}
