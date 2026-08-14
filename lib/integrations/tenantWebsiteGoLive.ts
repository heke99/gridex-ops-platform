import { supabaseService } from '@/lib/supabase/service'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import {
  loadTenantWebsiteFlowReadiness,
  type TenantWebsiteFlowReadiness,
} from '@/lib/integrations/tenantWebsiteReadiness'

export type TenantWebsiteGoLiveSummary = {
  company: {
    id: string
    name: string
    status: string
    website: string | null
    customerPortalUrl: string | null
    externalTenantReference: string | null
  }
  client: (IntegrationApiClient & {
    profile_key?: string | null
    launch_ready?: boolean | null
    launch_blockers?: unknown[] | null
    created_at?: string | null
  }) | null
  readiness: TenantWebsiteFlowReadiness | null
  latestReceipt: {
    id: string
    state: string
    receipt_sha256: string | null
    completed_at: string | null
    failure_code: string | null
    failure_message: string | null
    created_at: string
  } | null
  suggestedOrigins: string[]
}

function originFromWebsite(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export async function getTenantWebsiteGoLiveSummary(
  companyId: string,
): Promise<TenantWebsiteGoLiveSummary | null> {
  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .select('id,name,status,website,customer_portal_url,external_tenant_reference')
    .eq('id', companyId)
    .maybeSingle()
  if (companyError) throw companyError
  if (!company) return null

  const { data: clientRows, error: clientError } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix,secret_hash,scopes,allowed_ips,allowed_origins,metadata,rate_limit_per_minute,expires_at,profile_key,launch_ready,launch_blockers,created_at')
    .eq('company_id', companyId)
    .eq('profile_key', 'tenant_website')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (clientError) throw clientError

  const candidates = (clientRows ?? []) as Array<IntegrationApiClient & {
    profile_key?: string | null
    launch_ready?: boolean | null
    launch_blockers?: unknown[] | null
    created_at?: string | null
  }>
  const primary = candidates.find((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {}
    return metadata.primary === true
  }) ?? candidates[0] ?? null

  const readiness = primary
    ? await loadTenantWebsiteFlowReadiness({ companyId, client: primary })
    : null

  let latestReceipt: TenantWebsiteGoLiveSummary['latestReceipt'] = null
  if (primary) {
    const { data: receipt, error: receiptError } = await supabaseService
      .from('tenant_website_installation_receipts')
      .select('id,state,receipt_sha256,completed_at,failure_code,failure_message,created_at')
      .eq('company_id', companyId)
      .eq('api_client_id', primary.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (receiptError) throw receiptError
    latestReceipt = receipt as TenantWebsiteGoLiveSummary['latestReceipt']
  }

  const clientOrigins = primary?.allowed_origins ?? []
  const websiteOrigin = originFromWebsite(company.website ?? null)
  const suggestedOrigins = Array.from(new Set([
    ...clientOrigins,
    ...(websiteOrigin ? [websiteOrigin] : []),
  ]))

  return {
    company: {
      id: company.id,
      name: company.name,
      status: company.status,
      website: company.website ?? null,
      customerPortalUrl: company.customer_portal_url ?? null,
      externalTenantReference: company.external_tenant_reference ?? null,
    },
    client: primary,
    readiness,
    latestReceipt,
    suggestedOrigins,
  }
}
