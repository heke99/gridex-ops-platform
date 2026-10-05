import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { verifyCustomerAssertion, type CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { requireIntegrationApiAccess, integrationCredential, logIntegrationApiRequest, type IntegrationApiAuthResult } from '@/lib/integrations/apiAuth'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import { registeredStaffOnboardingOrigin, loadInvitationCommandBinding, requireStaffOnboardingProject, STAFF_ONBOARDING_PROJECT_REF, type InvitationCommandBinding } from '@/lib/auth/staffInvitationRouting'
import { assertStaffStorageTarget, staffStorageProjectRef } from '@/lib/staff-api/storageTarget'
import { supabaseService } from '@/lib/supabase/service'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'

export const STAFF_ONBOARDING_CONTRACT_VERSION = '2026-10-05.1'
export const STAFF_ONBOARDING_ACCEPT_PATH = '/api/v1/staff-onboarding/invitations/accept'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type AuthIdentity = { id: string; email?: string | null; email_confirmed_at?: string | null }
type Invitation = { id: string; company_id: string; email: string; invited_user_id: string | null; status: string; expires_at: string | null }
type OnboardingProvider = CustomerIdentityProvider & { purpose: string; is_active: boolean }
type AcceptCommand = {
  company_id: string; invitation_id: string; user_id: string; actor_user_id: string; idempotency_key: string;
  channel: 'staff_onboarding'; api_client_id: string; provider_id: string;
  verified_client: { secret_hash: string; scopes: string[]; allowed_origins: string[] | null; staff_onboarding_origin: string };
  verified_provider: Pick<CustomerIdentityProvider, 'kind' | 'issuer' | 'audience' | 'jwks_uri' | 'public_jwk' | 'subject_claim' | 'enforcement'>;
}
export type StaffInvitationAcceptancePorts = {
  apiAccess: (request: NextRequest, scopes: readonly string[]) => Promise<Pick<Extract<IntegrationApiAuthResult, { ok: true }>, 'ok' | 'client'> | Extract<IntegrationApiAuthResult, { ok: false }>>;
  getAuthUser: (accessToken: string) => Promise<AuthIdentity | null>;
  loadProvider: (companyId: string) => Promise<OnboardingProvider | null>;
  consumeJti: (companyId: string, jti: string, expiresAt: Date) => Promise<boolean>;
  findInvitation: (companyId: string, tokenHash: string) => Promise<Invitation | null>;
  loadBinding: (companyId: string, invitationId: string) => Promise<InvitationCommandBinding>;
  canonicalAccept: (command: AcceptCommand) => Promise<unknown>;
  logRequest: typeof logIntegrationApiRequest;
}

function json(data: unknown, status = 200): Response {
  const requestId = randomUUID()
  const projectRef = staffStorageProjectRef()
  return Response.json({ ...(status < 400 ? { data } : { error: data }), request_id: requestId, contract_schema_version: STAFF_ONBOARDING_CONTRACT_VERSION },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Gridex-Contract-Version': STAFF_ONBOARDING_CONTRACT_VERSION, ...(projectRef ? { 'X-Gridex-Project-Ref': projectRef } : {}) } })
}
function denied(code = 'staff_invitation_invalid', status = 403): never { throw new ApiInputError('The staff invitation could not be accepted.', code, status) }
function tokenHeader(request: NextRequest, name: string): string {
  const value = request.headers.get(name)
  if (!value || value.length > 16_384 || /\s/.test(value)) denied('staff_onboarding_identity_missing', 401)
  return value
}

/** Pre-membership exception is isolated here: real Auth + signed staff proof + exact durable invite. */
export function createStaffInvitationAcceptanceHandler(ports: StaffInvitationAcceptancePorts): (request: NextRequest) => Promise<Response> {
  return async request => {
    if (request.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use an explicit POST to accept the invitation.' }, 405)
    // Do not even rate-limit/audit on the wrong storage project.
    try {
      requireStaffOnboardingProject()
      if (request.headers.get('x-gridex-expected-project-ref') !== STAFF_ONBOARDING_PROJECT_REF) denied('storage_project_mismatch', 412)
      assertStaffStorageTarget(request.headers)
    } catch (error) {
      return json({ code: error instanceof ApiInputError ? error.code : 'internal_error', message: 'The requested storage project is unavailable.' }, error instanceof ApiInputError ? error.status : 500)
    }
    const startedAt = Date.now()
    let client: Extract<IntegrationApiAuthResult, { ok: true }>['client'] | undefined
    let actorUserId: string | undefined
    try {
      const auth = await ports.apiAccess(request, ['staff_users.write'])
      if (!auth.ok) throw new ApiInputError(auth.error, auth.errorCode, auth.status)
      client = auth.client
      // The credential RPC deliberately omits stored hashes. Bind the native
      // snapshot to the exact token that just passed credential verification.
      const credential = integrationCredential(request)
      if (!credential.ok) denied('staff_onboarding_identity_missing', 401)
      const verifiedSecretHash = hashIntegrationApiSecret(credential.token)
      registeredStaffOnboardingOrigin(client, client.company_id, client.id)
      const body = await readJsonObject(request, 1024)
      if (Object.keys(body).length !== 1 || typeof body.invitation_token !== 'string' || !UUID.test(body.invitation_token)) denied('staff_invitation_input_invalid', 422)
      const idempotencyKey = requireIdempotencyKey(request)
      const authToken = tokenHeader(request, 'x-gridex-support-auth-token')
      const proof = tokenHeader(request, 'x-gridex-staff-assertion')
      const user = await ports.getAuthUser(authToken)
      if (!user || !UUID.test(user.id) || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) denied('staff_onboarding_auth_invalid', 401)
      actorUserId = user.id
      const provider = await ports.loadProvider(client.company_id)
      if (!provider || provider.company_id !== client.company_id || provider.purpose !== 'staff' || provider.is_active !== true || provider.subject_claim !== 'sub' || provider.enforcement !== 'enforce') denied('staff_onboarding_provider_invalid')
      const verified = await verifyCustomerAssertion({ token: proof, provider, expectedSubject: user.id, requireIssuedAt: true,
        consumeJti: (jti, expiresAt) => ports.consumeJti(client!.company_id, jti, expiresAt) })
      if (!verified.ok) denied('staff_onboarding_assertion_invalid', 401)
      // These claims are read only after the complete signature/issuer/subject verification.
      const claims = JSON.parse(Buffer.from(proof.split('.')[1], 'base64url').toString('utf8')) as { company_id?: unknown; iat: number; exp: number }
      if (claims.company_id !== client.company_id || claims.exp - claims.iat > 60) denied('staff_onboarding_assertion_invalid', 401)
      const invitation = await ports.findInvitation(client.company_id, createHash('sha256').update(body.invitation_token).digest('hex'))
      if (!invitation || invitation.company_id !== client.company_id || !UUID.test(invitation.id)
        || invitation.invited_user_id !== user.id || invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
        || !['pending', 'accepted'].includes(invitation.status)
        || (invitation.status !== 'accepted' && (!invitation.expires_at || !Number.isFinite(Date.parse(invitation.expires_at)) || Date.parse(invitation.expires_at) <= Date.now()))) denied()
      const binding = await ports.loadBinding(client.company_id, invitation.id)
      if (binding.company_id !== client.company_id || binding.api_client_id !== client.id || binding.channel !== 'staff_api' || binding.staff_operation !== 'invite') denied('staff_invitation_client_mismatch')
      await ports.canonicalAccept({ company_id: client.company_id, invitation_id: invitation.id, user_id: user.id, actor_user_id: user.id,
        idempotency_key: `${client.id}:staff-invitation-accept:${idempotencyKey}`, channel: 'staff_onboarding', api_client_id: client.id, provider_id: provider.id,
        verified_client: { secret_hash: verifiedSecretHash, scopes: client.scopes, allowed_origins: client.allowed_origins ?? null, staff_onboarding_origin: registeredStaffOnboardingOrigin(client, client.company_id, client.id) },
        verified_provider: { kind: provider.kind, issuer: provider.issuer, audience: provider.audience, jwks_uri: provider.jwks_uri, public_jwk: provider.public_jwk, subject_claim: provider.subject_claim, enforcement: provider.enforcement } })
      const response = json({ status: 'accepted' })
      await ports.logRequest({ request, client, startedAt, statusCode: 200, metadata: { channel: 'staff_onboarding', actor_user_id: user.id } })
      return response
    } catch (error) {
      const known = error instanceof ApiInputError
      const code = known ? error.code : ((error as { message?: string })?.message === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ? 'idempotency_conflict' : 'staff_invitation_invalid')
      const response = json({ code, message: 'The staff invitation could not be accepted.' }, known ? error.status : code === 'idempotency_conflict' ? 409 : 403)
      if (client) await ports.logRequest({ request, client, startedAt, statusCode: response.status, errorCode: code, metadata: { channel: 'staff_onboarding', ...(actorUserId ? { actor_user_id: actorUserId } : {}) } })
      return response
    }
  }
}

export const acceptStaffInvitation = createStaffInvitationAcceptanceHandler({
  apiAccess: requireIntegrationApiAccess,
  getAuthUser: async accessToken => {
    const { data, error } = await supabaseService.auth.getUser(accessToken)
    return error ? null : data.user
  },
  loadProvider: async companyId => {
    const { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers',
      'id,company_id,purpose,is_active,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement')
      .eq('purpose', 'staff').eq('is_active', true).maybeSingle()
    if (error) throw error
    return data as OnboardingProvider | null
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
  canonicalAccept: async command => {
    const { data, error } = await supabaseService.rpc('gridex_accept_staff_invitation_v1', { p_command: command })
    if (error) throw error
    if (!data) denied()
    return data
  },
  logRequest: logIntegrationApiRequest,
})
