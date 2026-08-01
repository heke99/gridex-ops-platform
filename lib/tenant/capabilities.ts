import { supabaseService } from '@/lib/supabase/service'
import { assertTenantContextCompany, type TenantContext } from '@/lib/tenant/context'

export const TENANT_CAPABILITY_CODES = [
  'customer_intake_enabled',
  'manual_intake_enabled',
  'website_intake_enabled',
  'partner_api_enabled',
  'customer_portal_enabled',
  'power_of_attorney_required',
  'facility_lookup_enabled',
  'ediel_enabled',
  'supplier_switch_enabled',
  'invoice_enabled',
  'webhook_delivery_enabled',
] as const

export type TenantCapabilityCode = (typeof TENANT_CAPABILITY_CODES)[number]
export type TenantCapabilityReadiness = 'not_configured' | 'blocked' | 'ready' | 'disabled'

export type TenantCapability = Readonly<{
  companyId: string
  code: TenantCapabilityCode
  enabled: boolean
  readiness: TenantCapabilityReadiness
  configuration: Readonly<Record<string, unknown>>
  blockers: readonly string[]
}>

export class TenantCapabilityError extends Error {
  readonly code = 'TENANT_CAPABILITY_NOT_READY'
  readonly capability: TenantCapabilityCode

  constructor(capability: TenantCapabilityCode) {
    super(`Tenantens capability ${capability} är inte aktiverad och verifierad.`)
    this.name = 'TenantCapabilityError'
    this.capability = capability
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function loadTenantCapabilities(
  context: TenantContext,
  companyId: string = context.companyId,
): Promise<ReadonlyMap<TenantCapabilityCode, TenantCapability>> {
  const trustedCompanyId = assertTenantContextCompany(context, companyId)
  const { data, error } = await supabaseService
    .from('company_capabilities')
    .select('company_id,capability_code,enabled,readiness_status,configuration,blockers')
    .eq('company_id', trustedCompanyId)
  if (error) throw error

  const capabilities = new Map<TenantCapabilityCode, TenantCapability>()
  for (const code of TENANT_CAPABILITY_CODES) {
    capabilities.set(code, {
      companyId: trustedCompanyId,
      code,
      enabled: false,
      readiness: 'not_configured',
      configuration: Object.freeze({}),
      blockers: Object.freeze(['capability_not_configured']),
    })
  }

  for (const raw of data ?? []) {
    const code = String(raw.capability_code ?? '') as TenantCapabilityCode
    if (!TENANT_CAPABILITY_CODES.includes(code)) continue
    const readiness = String(raw.readiness_status ?? 'not_configured') as TenantCapabilityReadiness
    const blockers = Array.isArray(raw.blockers)
      ? raw.blockers.map(String).filter(Boolean)
      : []
    capabilities.set(code, Object.freeze({
      companyId: trustedCompanyId,
      code,
      enabled: raw.enabled === true,
      readiness,
      configuration: Object.freeze(object(raw.configuration)),
      blockers: Object.freeze(blockers),
    }))
  }
  return capabilities
}

export async function requireTenantCapability(
  context: TenantContext,
  capability: TenantCapabilityCode,
): Promise<TenantCapability> {
  const capabilities = await loadTenantCapabilities(context)
  const current = capabilities.get(capability)
  if (!current?.enabled || current.readiness !== 'ready') {
    throw new TenantCapabilityError(capability)
  }
  return current
}
