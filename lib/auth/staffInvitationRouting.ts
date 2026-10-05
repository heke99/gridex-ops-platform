import { isIP } from 'node:net'
import { ApiInputError } from '@/lib/api/strictRequest'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { staffStorageProjectRef } from '@/lib/staff-api/storageTarget'

export const STAFF_ONBOARDING_PROJECT_REF = 'ayiuxjlfazkjmmtlvhsl'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type StaffInvitationClient = {
  id: string; company_id: string; status: string; scopes: string[]; expires_at: string | null;
  allowed_origins?: string[] | null; metadata?: Record<string, unknown> | null;
  revoked_at?: string | null; deleted_at?: string | null;
}
export type InvitationCommandBinding = { channel?: unknown; api_client_id?: unknown; company_id?: unknown; staff_operation?: unknown }

export function requireStaffOnboardingProject(): void {
  if (staffStorageProjectRef() !== STAFF_ONBOARDING_PROJECT_REF) {
    throw new ApiInputError('Staff onboarding requires the configured production project.', 'storage_project_mismatch', 412)
  }
}

/** Registration is an operator-owned client setting, never an invitation/browser URL. */
export function registeredStaffOnboardingOrigin(client: StaffInvitationClient | null, companyId: string, clientId: string): string {
  const deny = (): never => { throw new ApiInputError('The staff portal registration is unavailable.', 'staff_onboarding_registration_invalid', 403) }
  if (!client || !UUID.test(clientId) || client.id !== clientId || client.company_id !== companyId
    || client.status !== 'active' || client.revoked_at != null || client.deleted_at != null || !client.scopes?.includes('staff_users.write')) return deny()
  if (client.expires_at !== null && (!Number.isFinite(Date.parse(client.expires_at)) || Date.parse(client.expires_at) <= Date.now())) deny()
  const origin = client.metadata?.staff_onboarding_origin
  if (typeof origin !== 'string' || origin.length > 512) return deny()
  let url: URL
  try { url = new URL(origin) } catch { return deny() }
  if (url.protocol !== 'https:' || url.origin !== origin || url.port || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || isIP(url.hostname) || !url.hostname.includes('.')
    || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || !client.allowed_origins?.includes(origin)) deny()
  return origin
}

export async function loadRegisteredStaffInvitationClient(companyId: string, clientId: string): Promise<StaffInvitationClient> {
  requireStaffOnboardingProject()
  const { data, error } = await tenantSelect(companyId, 'integration_api_clients',
    'id,company_id,status,scopes,expires_at,allowed_origins,metadata,revoked_at,deleted_at').eq('id', clientId).maybeSingle()
  if (error) throw error
  const client = data as StaffInvitationClient | null
  registeredStaffOnboardingOrigin(client, companyId, clientId)
  return client!
}

export async function loadInvitationCommandBinding(companyId: string, invitationId: string): Promise<InvitationCommandBinding> {
  const { data, error } = await tenantSelect(companyId, 'canonical_command_results', 'request_payload')
    .eq('command_type', 'tenant.invitation.create').eq('result_payload->>invitation_id', invitationId).maybeSingle()
  if (error) throw error
  const binding = (data as { request_payload?: InvitationCommandBinding } | null)?.request_payload
  if (!binding || binding.company_id !== companyId) throw new ApiInputError('The durable invitation binding is unavailable.', 'staff_invitation_binding_missing', 403)
  return binding
}

export async function staffInvitationCallbackOrigin(companyId: string, invitationId: string): Promise<string | null> {
  const binding = await loadInvitationCommandBinding(companyId, invitationId)
  if (binding.channel !== 'staff_api') {
    if (binding.api_client_id || (binding.channel !== undefined && binding.channel !== 'ops')) {
      throw new ApiInputError('The durable invitation binding is invalid.', 'staff_invitation_binding_missing', 403)
    }
    return null
  }
  if (binding.staff_operation !== 'invite' || typeof binding.api_client_id !== 'string') {
    throw new ApiInputError('The durable invitation binding is invalid.', 'staff_invitation_binding_missing', 403)
  }
  const client = await loadRegisteredStaffInvitationClient(companyId, binding.api_client_id)
  return registeredStaffOnboardingOrigin(client, companyId, binding.api_client_id)
}

export function staffInvitationAcceptUrl(origin: string, token: string): string {
  return `${origin}/auth/invitation?token=${encodeURIComponent(token)}`
}
