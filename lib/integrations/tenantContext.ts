import { supabaseService } from '@/lib/supabase/service'
import { type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { loadTenantWebsiteFlowReadiness, type TenantWebsiteReadinessBlocker } from '@/lib/integrations/tenantWebsiteReadiness'
import {
  CUSTOMER_PORTAL_OPENAPI_URL,
  CUSTOMER_PORTAL_REQUIRED_SCOPES,
  TENANT_WEBSITE_RECOMMENDED_SCOPES,
  WEBSITE_APPLICATION_REFERENCE_LOCATION,
  WEBSITE_CHECKOUT_REQUIRED_SCOPES,
  WEBSITE_INTEGRATION_BASE_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
  WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES,
} from '@/lib/integrations/websiteIntegrationContract'

export class ExternalTenantContextError extends Error {
  readonly status: number
  readonly code:
    | 'TENANT_NOT_FOUND'
    | 'EXTERNAL_TENANT_REFERENCE_MISSING'
    | 'TENANT_NOT_OPERATIONALLY_READY'

  constructor(input: {
    status: number
    code: ExternalTenantContextError['code']
    message: string
  }) {
    super(input.message)
    this.name = 'ExternalTenantContextError'
    this.status = input.status
    this.code = input.code
  }
}

export type ExternalTenantContext = {
  tenant_reference: string
  api_client_reference: string
  api_version: 'v1'
  contract_version: typeof WEBSITE_INTEGRATION_CONTRACT_VERSION
  authoritative_identity: 'api_key'
  configuration: {
    required_environment_variables: typeof WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES
    api_base_url: typeof WEBSITE_INTEGRATION_BASE_URL
    authentication: {
      header: 'Authorization'
      scheme: 'Bearer'
      server_side_only: true
    }
    openapi_url: typeof WEBSITE_INTEGRATION_OPENAPI_URL
    customer_portal_openapi_url: typeof CUSTOMER_PORTAL_OPENAPI_URL
    application_reference_location: typeof WEBSITE_APPLICATION_REFERENCE_LOCATION
    tenant_id_environment_required: false
    company_id_environment_required: false
  }
  capabilities: {
    website_checkout_ready: boolean
    customer_portal_ready: boolean
    complete_tenant_website_ready: boolean
    required_website_scopes: string[]
    missing_website_scopes: string[]
    required_customer_portal_scopes: string[]
    missing_customer_portal_scopes: string[]
    recommended_scopes: string[]
    missing_recommended_scopes: string[]
    portal_identity_required: true
    portal_url: string | null
    webhook_delivery_ready: boolean
    status_delivery_modes: Array<'polling' | 'webhook'>
    blockers: TenantWebsiteReadinessBlocker[]
    warnings: TenantWebsiteReadinessBlocker[]
    checks: Record<string, boolean>
  }
}

export async function loadExternalTenantReference(companyId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('external_tenant_reference,status')
    .eq('id', companyId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ExternalTenantContextError({
        status: 404,
        code: 'TENANT_NOT_FOUND',
        message: 'Tenantbolaget kunde inte hittas.',
      })
    }
    throw error
  }
  if (String(data?.status ?? '') !== 'active') {
    throw new ExternalTenantContextError({
      status: 409,
      code: 'TENANT_NOT_OPERATIONALLY_READY',
      message: 'Tenantbolaget är inte operationellt aktivt.',
    })
  }
  const tenantReference = String(data?.external_tenant_reference ?? '').trim()
  if (!tenantReference) {
    throw new ExternalTenantContextError({
      status: 409,
      code: 'EXTERNAL_TENANT_REFERENCE_MISSING',
      message: 'Tenantens externa referens saknas.',
    })
  }
  return tenantReference
}

export async function loadExternalTenantContext(client: IntegrationApiClient): Promise<ExternalTenantContext> {
  const tenantReference = await loadExternalTenantReference(client.company_id)
  const readiness = await loadTenantWebsiteFlowReadiness({
    companyId: client.company_id,
    client,
  })

  return {
    tenant_reference: tenantReference,
    api_client_reference: `client_${client.id.replaceAll('-', '')}`,
    api_version: 'v1',
    contract_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
    authoritative_identity: 'api_key',
    configuration: {
      required_environment_variables: WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES,
      api_base_url: WEBSITE_INTEGRATION_BASE_URL,
      authentication: {
        header: 'Authorization',
        scheme: 'Bearer',
        server_side_only: true,
      },
      openapi_url: WEBSITE_INTEGRATION_OPENAPI_URL,
      customer_portal_openapi_url: CUSTOMER_PORTAL_OPENAPI_URL,
      application_reference_location: WEBSITE_APPLICATION_REFERENCE_LOCATION,
      tenant_id_environment_required: false,
      company_id_environment_required: false,
    },
    capabilities: {
      website_checkout_ready: readiness.website_checkout_ready,
      customer_portal_ready: readiness.customer_portal_ready,
      complete_tenant_website_ready: readiness.complete_tenant_website_ready,
      required_website_scopes: [...WEBSITE_CHECKOUT_REQUIRED_SCOPES],
      missing_website_scopes: readiness.missing_website_scopes,
      required_customer_portal_scopes: [...CUSTOMER_PORTAL_REQUIRED_SCOPES],
      missing_customer_portal_scopes: readiness.missing_customer_portal_scopes,
      recommended_scopes: [...TENANT_WEBSITE_RECOMMENDED_SCOPES],
      missing_recommended_scopes: readiness.missing_recommended_scopes,
      portal_identity_required: readiness.portal_identity_required,
      portal_url: readiness.portal_url,
      webhook_delivery_ready: readiness.webhook_delivery_ready,
      status_delivery_modes: readiness.status_delivery_modes,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      checks: readiness.checks,
    },
  }
}
