import { randomUUID } from 'node:crypto'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'
import { STAFF_API_CONTRACT_VERSION } from '@/lib/staff-api/openApiContract'
import { supabaseService } from '@/lib/supabase/service'

export class StaffClientCreationInputError extends Error {}

async function requireCurrentStaffPlatformAdmin(userId: string) {
  // The legacy console flag does not evaluate every global role's expiry.
  const { data: currentPlatformAdmin, error: platformError } = await supabaseService.rpc('staff_api_is_platform_admin', { p_user_id: userId })
  if (platformError || currentPlatformAdmin !== true) throw new Error('Current platform administration authority is required')
}

export async function requireCurrentStaffClientAdministrator(userId: string, client: { profile_key?: string | null; metadata?: unknown }) {
  const metadata = client.metadata && typeof client.metadata === 'object' && !Array.isArray(client.metadata)
    ? client.metadata as Record<string, unknown> : {}
  if (client.profile_key === 'custom' && metadata.integration_kind === 'staff_support_v1') await requireCurrentStaffPlatformAdmin(userId)
}

/** Native OPS administration only; return the credential once after its audited activation. */
export async function createDedicatedStaffIntegrationClient(input: { companyId: string; name: string }) {
  const actor = await requirePlatformAdminActionAccess()
  await requireCurrentStaffPlatformAdmin(actor.userId)
  const companyId = input.companyId.trim()
  const name = input.name.trim() || 'Gridex intern support'
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(companyId)) {
    throw new StaffClientCreationInputError('Välj ett giltigt bolag.')
  }
  if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new StaffClientCreationInputError('Namnet får innehålla högst 120 tecken och inga kontrolltecken.')
  }
  const { data: company, error: companyError } = await supabaseService.from('companies')
    .select('id,status,is_active').eq('id', companyId).maybeSingle()
  if (companyError) throw new Error('Staff client company verification failed')
  if (!company || company.status !== 'active' || company.is_active === false) {
    throw new StaffClientCreationInputError('Staff-klienten kräver ett aktivt bolag.')
  }

  const id = randomUUID()
  const credential = generateIntegrationApiToken()
  const scopes = ['staff_sessions.write', 'staff_context.read', 'staff_customers.read', 'staff_support.read', 'staff_support.write']
  const allowedOrigins = ['https://support123.gridex.se']
  // A separate paused row is deliberate: no primary-website provisioning or
  // credential rotation occurs, and audit must succeed before activation.
  const { error: insertError } = await supabaseService.from('integration_api_clients').insert({
    id, company_id: companyId, created_by: actor.userId, name, status: 'paused',
    profile_key: 'custom', key_prefix: credential.keyPrefix, secret_hash: credential.secretHash,
    scopes, allowed_origins: allowedOrigins, allowed_ips: [], rate_limit_per_minute: 120,
    permission_groups: ['staff_sessions', 'staff_context', 'staff_customers', 'staff_support_read', 'staff_support_write'],
    purpose_label: 'Intern kundsupport', launch_ready: false, launch_blockers: [],
    metadata: { integration_kind: 'staff_support_v1', contract_schema_version: STAFF_API_CONTRACT_VERSION,
      created_from: 'native_platform_staff_client', token_display: 'shown_once_on_create' },
  })
  if (insertError) throw new Error('Staff client storage failed')
  const { error: auditError } = await supabaseService.from('audit_logs').insert({
    company_id: companyId, actor_user_id: actor.userId, entity_type: 'integration_api_client', entity_id: id,
    action: 'api_client.staff_created', old_values: null, new_values: null,
    metadata: { scopes, allowed_origins: allowedOrigins, contract_schema_version: STAFF_API_CONTRACT_VERSION },
  })
  if (auditError) throw new Error('Staff client audit failed')
  const { data: activated, error: activationError } = await supabaseService.from('integration_api_clients')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).eq('status', 'paused').is('deleted_at', null).is('revoked_at', null)
    .select('id').maybeSingle()
  if (activationError || !activated) throw new Error('Staff client activation failed')
  return { clientId: id, keyPrefix: credential.keyPrefix, token: credential.token }
}
