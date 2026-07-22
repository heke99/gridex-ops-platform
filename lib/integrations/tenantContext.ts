import { supabaseService } from '@/lib/supabase/service'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

export type ExternalTenantContext = {
  tenant_reference: string
  api_client_reference: string
  api_version: 'v1'
  authoritative_identity: 'api_key'
}


export async function loadExternalTenantReference(companyId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('external_tenant_reference')
    .eq('id', companyId)
    .single()

  if (error) throw error
  const tenantReference = String(data?.external_tenant_reference ?? '').trim()
  if (!tenantReference) throw new Error('external_tenant_reference_missing')
  return tenantReference
}

export async function loadExternalTenantContext(client: IntegrationApiClient): Promise<ExternalTenantContext> {
  const tenantReference = await loadExternalTenantReference(client.company_id)

  return {
    tenant_reference: tenantReference,
    api_client_reference: `client_${client.id.replaceAll('-', '')}`,
    api_version: 'v1',
    authoritative_identity: 'api_key',
  }
}
