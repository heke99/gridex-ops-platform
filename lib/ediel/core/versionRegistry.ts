// lib/ediel/core/versionRegistry.ts

import { supabaseService } from '@/lib/supabase/service'
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
  return new Date().toISOString().slice(0, 10)
}

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => sanitize(value)).filter(Boolean) as string[])]
}

function normalizeResolvedRule(
  value: unknown
): ResolvedEdielMessageRuleRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as ResolvedEdielMessageRuleRow
}

function normalizeResolvedInboundRules(
  value: unknown
): ResolvedInboundEdielMessageRuleRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(Boolean) as ResolvedInboundEdielMessageRuleRow[]
}

function sortInboundRulesByPriority(
  rows: ResolvedInboundEdielMessageRuleRow[]
): ResolvedInboundEdielMessageRuleRow[] {
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

function chooseSelectedVersion(params: {
  currentRule: ResolvedEdielMessageRuleRow | null
  previousRule: ResolvedInboundEdielMessageRuleRow | null
  acceptedVersions: string[]
  fallback?: string | null
  routeDefaultMessageVersion?: string | null
}) {
  const routeDefault = sanitize(params.routeDefaultMessageVersion)
  const currentVersion = sanitize(params.currentRule?.version_code)
  const previousVersion = sanitize(params.previousRule?.version_code)
  const fallback = sanitize(params.fallback)

  if (routeDefault && params.acceptedVersions.includes(routeDefault)) {
    return routeDefault
  }

  return currentVersion ?? routeDefault ?? fallback ?? previousVersion ?? null
}

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

  const { data, error } = await supabaseService.rpc(
    'ediel_resolve_message_rule',
    {
      p_message_family: params.family,
      p_message_code: params.code,
      p_message_standard: standard,
      p_direction: direction,
      p_reference_date: date,
    }
  )

  if (error) throw error

  if (Array.isArray(data) && data.length > 0) {
    return normalizeResolvedRule(data[0])
  }

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

  const { data, error } = await supabaseService.rpc(
    'ediel_resolve_inbound_message_rules',
    {
      p_message_family: params.family,
      p_message_code: params.code,
      p_message_standard: standard,
      p_reference_date: date,
    }
  )

  if (error) throw error
  return sortInboundRulesByPriority(normalizeResolvedInboundRules(data))
}

export async function resolveOutboundMessageVersionRuntimeFromRegistry(
  input: ResolveMessageVersionInput & { routeDefaultMessageVersion?: string | null }
): Promise<ResolvedVersionWindow> {
  const standard = input.standard ?? 'edifact'
  const date = input.date ?? todayIsoDate()

  const currentRule =
    (await getActiveEdielMessageRuleFromRegistry({
      family: input.family,
      code: input.code,
      standard,
      direction: 'outbound',
      date,
    })) ??
    (await getActiveEdielMessageRuleFromRegistry({
      family: input.family,
      code: input.code,
      standard,
      direction: 'both',
      date,
    }))

  const inboundAccepted = await resolveInboundAcceptedMessageRulesFromRegistry({
    family: input.family,
    code: input.code,
    standard,
    date,
  })

  const previousRule = inboundAccepted[1] ?? null
  const acceptedVersions = uniqueStrings([
    currentRule?.version_code,
    previousRule?.version_code,
    ...inboundAccepted.map((row) => row.version_code),
    input.fallback ?? null,
    input.routeDefaultMessageVersion ?? null,
  ])

  const selectedVersion = chooseSelectedVersion({
    currentRule,
    previousRule,
    acceptedVersions,
    fallback: input.fallback ?? null,
    routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
  })

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

export async function resolveInboundAcceptedVersionsRuntimeFromRegistry(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedVersionWindow> {
  const standard = params.standard ?? 'edifact'
  const date = params.date ?? todayIsoDate()
  const inboundAccepted = await resolveInboundAcceptedMessageRulesFromRegistry({
    family: params.family,
    code: params.code,
    standard,
    date,
  })

  const currentRule =
    (await getActiveEdielMessageRuleFromRegistry({
      family: params.family,
      code: params.code,
      standard,
      direction: 'inbound',
      date,
    })) ??
    (await getActiveEdielMessageRuleFromRegistry({
      family: params.family,
      code: params.code,
      standard,
      direction: 'both',
      date,
    }))

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
}) {
  const runtime = await resolveOutboundMessageVersionRuntimeFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? null,
    environment: params.environment ?? 'test',
    routeDefaultMessageVersion: params.routeDefaultMessageVersion ?? null,
  })

  return runtime.selectedVersion
}

export async function resolveCanonicalInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  await resolveInboundAcceptedVersionsRuntimeFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    date: params.date ?? null,
  })

  return resolveInboundAcceptedMessageRulesFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
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
    }))
  )
}