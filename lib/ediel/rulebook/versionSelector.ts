// lib/ediel/rulebook/versionSelector.ts

import { resolveOutboundMessageVersionRuntimeFromRegistry, resolveInboundAcceptedVersionsRuntimeFromRegistry } from '@/lib/ediel/core/versionRegistry'
import { getRulebookMessageRule } from '@/lib/ediel/rulebook/rulebook'
import type { EdielMessageStandard } from '@/lib/ediel/types'

export async function resolveRulebookOutboundVersion(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  routeDefaultMessageVersion?: string | null
}) {
  const fallbackRule = getRulebookMessageRule({ family: params.family, code: params.code })
  return resolveOutboundMessageVersionRuntimeFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? fallbackRule?.currentVersion ?? null,
    routeDefaultMessageVersion: params.routeDefaultMessageVersion ?? null,
  })
}

export async function resolveRulebookInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
}) {
  return resolveInboundAcceptedVersionsRuntimeFromRegistry({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
  })
}
