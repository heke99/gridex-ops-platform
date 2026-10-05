import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { verifyCustomerAssertion } from '@/lib/customer-portal/customerAssertion'
import { requireIntegrationApiAccess, integrationCredential, logIntegrationApiRequest, type IntegrationApiAuthResult } from '@/lib/integrations/apiAuth'
import { isIndependentStaffInvitation, loadInvitationCommandBinding, type InvitationCommandBinding } from '@/lib/auth/staffInvitationRouting'
import { assertStaffStorageTarget, staffStorageProjectRef } from '@/lib/staff-api/storageTarget'
import { STAFF_ONBOARDING_CONTRACT_VERSION } from '@/lib/staff-api/onboardingContract'
import { getRegisteredStaffTenantAuthUser, registeredStaffTenantAuth, type RegisteredStaffTenantAuth, type StaffTenantAuthIdentity } from '@/lib/staff-api/tenantAuth'
import { parsedStaffIdentityBinding, readStaffAssertionClaims, staffIdentityAuthorityCommand, type StaffIdentityAuthorityCommand } from '@/lib/staff-api/identityAuthority'
import type { StaffOnboardingProvider } from '@/lib/staff-api/identityResolution'
import { supabaseService } from '@/lib/supabase/service'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'

export { STAFF_ONBOARDING_CONTRACT_VERSION }
export const STAFF_ONBOARDING_ACCEPT_PATH = '/api/v1/staff-onboarding/invitations/accept'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Invitation = { id: string; company_id: string; email: string; invited_user_id: string | null; status: string; expires_at: string | null }
type BindingLookupCommand = StaffIdentityAuthorityCommand & { invitation_id: string }
type AcceptCommand = BindingLookupCommand & { binding_id: string; binding_version: number; verified_email: string; email_confirmed: true; idempotency_key: string }
export type StaffInvitationAcceptancePorts = {
  apiAccess: (request: NextRequest, scopes: readonly string[]) => Promise<Pick<Extract<IntegrationApiAuthResult, { ok: true }>, 'ok' | 'client'> | Extract<IntegrationApiAuthResult, { ok: false }>>;
  getAuthUser: (registration: RegisteredStaffTenantAuth, accessToken: string) => Promise<StaffTenantAuthIdentity | null>;
  loadProvider: (companyId: string) => Promise<StaffOnboardingProvider | null>;
  consumeJti: (companyId: string, jti: string, expiresAt: Date) => Promise<boolean>;
  findInvitation: (companyId: string, tokenHash: string) => Promise<Invitation | null>;
  loadBinding: (companyId: string, invitationId: string) => Promise<InvitationCommandBinding>;
  lookupIdentityBinding: (command: BindingLookupCommand) => Promise<unknown>;
  canonicalAccept: (command: AcceptCommand) => Promise<unknown>;
  logRequest: typeof logIntegrationApiRequest;
}
function json(data: unknown, status = 200): Response {
  const requestId = randomUUID(), projectRef = staffStorageProjectRef()
  return Response.json({ ...(status < 400 ? { data } : { error: data }), request_id: requestId, contract_schema_version: STAFF_ONBOARDING_CONTRACT_VERSION },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Gridex-Contract-Version': STAFF_ONBOARDING_CONTRACT_VERSION, ...(projectRef ? { 'X-Gridex-Project-Ref': projectRef } : {}) } })
}
function denied(code = 'staff_invitation_invalid', status = 403): never { throw new ApiInputError('The staff invitation could not be accepted.', code, status) }
function tokenHeader(request: NextRequest, name: string): string {
  const value = request.headers.get(name)
  if (!value || value.length > 16_384 || /\s/.test(value)) denied('staff_onboarding_identity_missing', 401)
  return value
}
/** Explicit local Auth -> durable binding -> central canonical actor; no OPS Auth login required. */
export function createStaffInvitationAcceptanceHandler(ports: StaffInvitationAcceptancePorts): (request: NextRequest) => Promise<Response> {
  return async request => {
    if (request.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use an explicit POST to accept the invitation.' }, 405)
    try {
      if (!request.headers.get('x-gridex-expected-project-ref') || !staffStorageProjectRef()) denied('storage_project_mismatch', 412)
      assertStaffStorageTarget(request.headers)
    } catch (error) {
      return json({ code: error instanceof ApiInputError ? error.code : 'internal_error', message: 'The requested API project is unavailable.' }, error instanceof ApiInputError ? error.status : 500)
    }
    const startedAt = Date.now()
    let client: Extract<IntegrationApiAuthResult, { ok: true }>['client'] | undefined
    let actorUserId: string | undefined
    try {
      const auth = await ports.apiAccess(request, ['staff_users.write'])
      if (!auth.ok) throw new ApiInputError(auth.error, auth.errorCode, auth.status)
      client = auth.client
      const registration = registeredStaffTenantAuth(client, client.company_id, client.id, 'staff_users.write')
      const credential = integrationCredential(request)
      if (!credential.ok) denied('staff_onboarding_identity_missing', 401)
      const body = await readJsonObject(request, 1024)
      if (Object.keys(body).length !== 1 || typeof body.invitation_token !== 'string' || !UUID.test(body.invitation_token)) denied('staff_invitation_input_invalid', 422)
      const idempotencyKey = requireIdempotencyKey(request)
      const authToken = tokenHeader(request, 'x-gridex-support-auth-token'), proof = tokenHeader(request, 'x-gridex-staff-assertion')
      const user = await ports.getAuthUser(registration, authToken)
      if (!user || !UUID.test(user.id) || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) denied('staff_onboarding_auth_invalid', 401)
      const provider = await ports.loadProvider(client.company_id)
      if (!provider || provider.company_id !== client.company_id || provider.purpose !== 'staff' || provider.is_active !== true
        || provider.subject_claim !== 'sub' || provider.enforcement !== 'enforce') denied('staff_onboarding_provider_invalid')
      const claims = readStaffAssertionClaims(proof)
      if (!claims || claims.token_use !== 'staff_invitation_acceptance' || claims.company_id !== client.company_id
        || typeof claims.iat !== 'number' || typeof claims.exp !== 'number' || claims.exp - claims.iat > 60) denied('staff_onboarding_assertion_invalid', 401)
      const verified = await verifyCustomerAssertion({ token: proof, provider, expectedSubject: user.id, requireIssuedAt: true,
        consumeJti: (jti, expiresAt) => ports.consumeJti(client!.company_id, jti, expiresAt) })
      if (!verified.ok) denied('staff_onboarding_assertion_invalid', 401)
      const invitation = await ports.findInvitation(client.company_id, createHash('sha256').update(body.invitation_token).digest('hex'))
      if (!invitation || invitation.company_id !== client.company_id || !UUID.test(invitation.id) || !invitation.invited_user_id || !UUID.test(invitation.invited_user_id)
        || invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase() || !['pending', 'accepted'].includes(invitation.status)
        || (invitation.status !== 'accepted' && (!invitation.expires_at || !Number.isFinite(Date.parse(invitation.expires_at)) || Date.parse(invitation.expires_at) <= Date.now()))) denied()
      const original = await ports.loadBinding(client.company_id, invitation.id)
      if (original.company_id !== client.company_id || original.api_client_id !== client.id || !isIndependentStaffInvitation(original) || original.staff_operation !== 'invite') denied('staff_invitation_client_mismatch')
      const common = { ...staffIdentityAuthorityCommand(client, provider, registration, user.id, credential.token), invitation_id: invitation.id }
      const binding = parsedStaffIdentityBinding(await ports.lookupIdentityBinding(common))
      if (!binding || binding.actor_user_id !== invitation.invited_user_id || binding.actor_user_id === user.id) denied('staff_identity_binding_invalid')
      await ports.canonicalAccept({ ...common, binding_id: binding.binding_id, binding_version: binding.binding_version,
        verified_email: user.email.trim().toLowerCase(), email_confirmed: true,
        idempotency_key: `${client.id}:staff-invitation-accept:${idempotencyKey}` })
      actorUserId = binding.actor_user_id
      await ports.logRequest({ request, client, startedAt, statusCode: 200, metadata: { channel: 'staff_onboarding', actor_user_id: actorUserId } })
      return json({ status: 'accepted' })
    } catch (error) {
      const known = error instanceof ApiInputError
      const code = known ? error.code : ((error as { message?: string })?.message === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ? 'idempotency_conflict' : 'staff_invitation_invalid')
      const response = json({ code, message: 'The staff invitation could not be accepted.' }, known ? error.status : code === 'idempotency_conflict' ? 409 : 403)
      if (client) await ports.logRequest({ request, client, startedAt, statusCode: response.status, errorCode: code,
        metadata: { channel: 'staff_onboarding', ...(actorUserId ? { actor_user_id: actorUserId } : {}) } })
      return response
    }
  }
}
// New RPC names stay explicit until authentic generated schema capture.
const nativeOnboarding = supabaseService as unknown as { rpc(name: 'gridex_lookup_pending_staff_identity_binding_v1' | 'gridex_accept_external_staff_invitation_v1', args: { p_command: BindingLookupCommand | AcceptCommand }): Promise<{ data: unknown; error: unknown }> }
export const acceptStaffInvitation = createStaffInvitationAcceptanceHandler({
  apiAccess: requireIntegrationApiAccess, getAuthUser: getRegisteredStaffTenantAuthUser,
  loadProvider: async companyId => {
    const { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers', 'id,company_id,purpose,is_active,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement')
      .eq('purpose', 'staff').eq('is_active', true).maybeSingle()
    if (error) throw error
    return data as StaffOnboardingProvider | null
  },
  consumeJti: async (companyId, jti, expiresAt) => {
    const { error } = await tenantInsert(companyId, 'tenant_staff_assertion_replays', { jti, expires_at: expiresAt.toISOString() })
    if (!error) return true
    if (error.code === '23505') return false
    throw error
  },
  findInvitation: async (companyId, hash) => {
    const { data, error } = await tenantSelect(companyId, 'company_invitations', 'id,company_id,email,invited_user_id,status,expires_at')
      .eq('accept_token_hash', hash).maybeSingle()
    if (error) throw error
    return data as Invitation | null
  },
  loadBinding: loadInvitationCommandBinding,
  lookupIdentityBinding: async command => {
    const { data, error } = await nativeOnboarding.rpc('gridex_lookup_pending_staff_identity_binding_v1', { p_command: command })
    if (error) throw error
    return data
  },
  canonicalAccept: async command => {
    const { data, error } = await nativeOnboarding.rpc('gridex_accept_external_staff_invitation_v1', { p_command: command })
    if (error) throw error
    if (!data) denied()
    return data
  },
  logRequest: logIntegrationApiRequest,
})
