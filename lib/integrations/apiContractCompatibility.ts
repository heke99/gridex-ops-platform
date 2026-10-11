/**
 * API contract compatibility decision (OPS API remediation plan, package 4).
 *
 * A tenant integrates against a supported contract family (major `v1`). It
 * never has to match the newest documentation revision. This module only
 * decides the supported profile and capabilities; it does not authenticate
 * and does not replace payload, tenant or legal validation.
 */
import {
  MINIMUM_TENANT_INTEGRATION_VERSION,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
} from '@/lib/integrations/websiteIntegrationContract'

export type ApiSurface = 'website' | 'customer' | 'staff' | 'staff_onboarding' | 'partner'
export type ApiContractProfile = {
  surface: ApiSurface
  major: 'v1'
  revision: string
  status: 'supported' | 'deprecated'
  capabilities: readonly string[]
}
export type CompatibilityResult =
  | { ok: true; profile: ApiContractProfile }
  | { ok: false; code: 'unsupported_contract_profile' | 'required_capability_missing' }

export const API_CONTRACT_REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/

/**
 * Qualified client profiles. A profile is listed only after its format was
 * proven against the current server (see __tests__/api-legacy-client-profiles.test.ts).
 * The first entry of a surface is not special; the default is the newest
 * `supported` profile of the surface.
 */
const WEBSITE_CAPABILITIES = [
  'contracts.read', 'energy_area.resolve', 'market_prices.read', 'quotes.write',
  'legal.read', 'applications.write', 'switch_status.read',
] as const
const CUSTOMER_CAPABILITIES = [
  'profile.read', 'sites.read', 'contracts.read', 'invoices.read', 'metering.read',
  'support.read', 'support.write', 'support.attachments',
] as const

/**
 * 2026-10-04.1 stays a supported profile after the documentation-only
 * 2026-10-09.1 release; per surface the profiles are ordered oldest first so
 * the last supported entry is the current release.
 */
export const STAFF_FIRST_RELEASE_REVISION = '2026-10-04.1' as const
const STAFF_CAPABILITIES = ['users', 'customers', 'cases'] as const
const STAFF_ONBOARDING_CAPABILITIES = ['independent_identity'] as const

export const API_CONTRACT_PROFILE_REGISTRY: readonly ApiContractProfile[] = [
  { surface: 'website', major: 'v1', revision: MINIMUM_TENANT_INTEGRATION_VERSION, status: 'supported', capabilities: WEBSITE_CAPABILITIES },
  { surface: 'website', major: 'v1', revision: STAFF_FIRST_RELEASE_REVISION, status: 'supported', capabilities: WEBSITE_CAPABILITIES },
  { surface: 'website', major: 'v1', revision: WEBSITE_INTEGRATION_CONTRACT_VERSION, status: 'supported', capabilities: WEBSITE_CAPABILITIES },
  { surface: 'customer', major: 'v1', revision: MINIMUM_TENANT_INTEGRATION_VERSION, status: 'supported', capabilities: CUSTOMER_CAPABILITIES },
  { surface: 'customer', major: 'v1', revision: STAFF_FIRST_RELEASE_REVISION, status: 'supported', capabilities: CUSTOMER_CAPABILITIES },
  { surface: 'customer', major: 'v1', revision: WEBSITE_INTEGRATION_CONTRACT_VERSION, status: 'supported', capabilities: CUSTOMER_CAPABILITIES },
  { surface: 'staff', major: 'v1', revision: STAFF_FIRST_RELEASE_REVISION, status: 'supported', capabilities: STAFF_CAPABILITIES },
  { surface: 'staff', major: 'v1', revision: WEBSITE_INTEGRATION_CONTRACT_VERSION, status: 'supported', capabilities: STAFF_CAPABILITIES },
  { surface: 'staff_onboarding', major: 'v1', revision: STAFF_FIRST_RELEASE_REVISION, status: 'supported', capabilities: STAFF_ONBOARDING_CAPABILITIES },
  { surface: 'staff_onboarding', major: 'v1', revision: WEBSITE_INTEGRATION_CONTRACT_VERSION, status: 'supported', capabilities: STAFF_ONBOARDING_CAPABILITIES },
]

function defaultProfile(surface: ApiSurface, registry: readonly ApiContractProfile[]) {
  const candidates = registry.filter((p) => p.surface === surface && p.major === 'v1' && p.status === 'supported')
  return candidates.at(-1) ?? null
}

export function assessApiContractCompatibility(input: {
  surface: ApiSurface
  major: string
  clientProfile: string | null
  requiredCapabilities: readonly string[]
  registry: readonly ApiContractProfile[]
}): CompatibilityResult {
  if (input.major !== 'v1') return { ok: false, code: 'unsupported_contract_profile' }
  const profile = input.clientProfile === null
    ? defaultProfile(input.surface, input.registry)
    : input.registry.find((p) => p.surface === input.surface && p.major === 'v1' && p.revision === input.clientProfile) ?? null
  if (!profile) return { ok: false, code: 'unsupported_contract_profile' }
  if (!input.requiredCapabilities.every((capability) => profile.capabilities.includes(capability))) {
    return { ok: false, code: 'required_capability_missing' }
  }
  return { ok: true, profile }
}

/**
 * Response-side check used by OPS reference helpers: a well-formed V1 revision
 * is accepted even when it is newer than the helper. Business payload
 * validation stays mandatory and decides whether the response is usable.
 */
export function isCompatibleResponseRevision(revision: string | null, major: string | null = null): boolean {
  if (!revision || !API_CONTRACT_REVISION_PATTERN.test(revision)) return false
  return major === null || major === 'v1'
}
