import type { CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { ApiInputError } from '@/lib/api/strictRequest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import type { RegisteredStaffTenantAuth } from '@/lib/staff-api/tenantAuth'
import { supabaseService } from '@/lib/supabase/service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type StaffIdentityBinding = { actor_user_id: string; binding_id: string; binding_version: number }
export type StaffIdentityAuthorityCommand = {
  company_id: string; api_client_id: string; provider_id: string; local_user_id: string; local_auth_issuer: string; local_auth_url: string;
  verified_client: { secret_hash: string; scopes: string[]; allowed_origins: string[] | null; staff_onboarding_origin: string; staff_tenant_auth: { url: string; public_key: string }; staff_tenant_delivery: unknown };
  verified_provider: Pick<CustomerIdentityProvider, 'kind' | 'issuer' | 'audience' | 'jwks_uri' | 'public_jwk' | 'subject_claim' | 'enforcement'>;
}
export type StaffIdentityBindingValidationCommand = StaffIdentityAuthorityCommand & StaffIdentityBinding
export function staffIdentityAuthorityError(error: unknown): unknown {
  if ((error as { code?: unknown } | null)?.code === '42501') {
    return new ApiInputError('The independent staff binding is unavailable.', 'staff_identity_binding_invalid', 403)
  }
  return error
}
export function readStaffAssertionClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (token.length > 16_384 || parts.length !== 3) return null
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims as Record<string, unknown> : null
  } catch { return null }
}

export function staffIdentityAuthorityCommand(client: IntegrationApiClient, provider: CustomerIdentityProvider, registration: RegisteredStaffTenantAuth, localUserId: string, credential: string): StaffIdentityAuthorityCommand {
  return {
    company_id: client.company_id, api_client_id: client.id, provider_id: provider.id,
    local_user_id: localUserId, local_auth_issuer: registration.authIssuer, local_auth_url: registration.url,
    verified_client: { secret_hash: hashIntegrationApiSecret(credential), scopes: client.scopes, allowed_origins: client.allowed_origins ?? null,
      staff_onboarding_origin: registration.origin, staff_tenant_auth: { url: registration.url, public_key: registration.publicKey }, staff_tenant_delivery: client.metadata?.staff_tenant_delivery ?? null },
    verified_provider: { kind: provider.kind, issuer: provider.issuer, audience: provider.audience, jwks_uri: provider.jwks_uri,
      public_jwk: provider.public_jwk, subject_claim: provider.subject_claim, enforcement: provider.enforcement },
  }
}

export function parsedStaffIdentityBinding(value: unknown): StaffIdentityBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const binding = value as Record<string, unknown>
  if (Object.keys(binding).length !== 3 || typeof binding.actor_user_id !== 'string' || !UUID.test(binding.actor_user_id)
    || typeof binding.binding_id !== 'string' || !UUID.test(binding.binding_id)
    || typeof binding.binding_version !== 'number' || !Number.isSafeInteger(binding.binding_version) || binding.binding_version < 1) return null
  return { actor_user_id: binding.actor_user_id, binding_id: binding.binding_id, binding_version: binding.binding_version }
}

// Additive RPC facade remains narrow until the next authentic generated-type capture.
const identityRpc = supabaseService as unknown as { rpc(name: 'gridex_resolve_staff_identity_v1' | 'gridex_validate_staff_identity_binding_v1', args: { p_command: StaffIdentityAuthorityCommand | StaffIdentityBindingValidationCommand }): Promise<{ data: unknown; error: unknown }> }
export async function validateCurrentStaffIdentityBinding(command: StaffIdentityBindingValidationCommand): Promise<unknown> {
  const { data, error } = await identityRpc.rpc('gridex_validate_staff_identity_binding_v1', { p_command: command })
  if (error) throw staffIdentityAuthorityError(error)
  return data
}

export async function resolveCurrentStaffIdentity(command: StaffIdentityAuthorityCommand): Promise<unknown> {
  const { data, error } = await identityRpc.rpc('gridex_resolve_staff_identity_v1', { p_command: command })
  if (error) throw staffIdentityAuthorityError(error)
  return data
}
