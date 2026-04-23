// lib/ediel/core/versionRegistry.ts

import type {
  EdielEnvironment,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import {
  resolveInboundAcceptedVersionsRuntime,
  resolveOutboundMessageVersionRuntime,
} from '@/lib/ediel/config'

export async function resolveCanonicalOutboundVersion(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  routeDefaultMessageVersion?: string | null
}) {
  if (params.routeDefaultMessageVersion?.trim()) {
    return params.routeDefaultMessageVersion.trim()
  }

  const runtime = await resolveOutboundMessageVersionRuntime({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? null,
    environment: params.environment ?? 'test',
  })

  return runtime.selectedVersion
}

export async function resolveCanonicalInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  const runtime = await resolveInboundAcceptedVersionsRuntime({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    date: params.date ?? null,
  })

  return runtime.acceptedVersions.map((versionCode, index) => ({
    id: `accepted-${params.family}-${params.code}-${index}`,
    version_code: versionCode,
    valid_from: index === 0 ? params.date ?? null : null,
    valid_to: null,
    requires_contrl: false,
    requires_aperak: false,
    supports_negative_response: false,
  }))
}