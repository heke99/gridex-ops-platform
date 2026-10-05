import { randomUUID } from 'node:crypto'
import { parsedStaffIdentityBinding, readStaffAssertionClaims, resolveCurrentStaffIdentity, staffIdentityAuthorityCommand, staffIdentityAuthorityError, type StaffIdentityAuthorityCommand } from '@/lib/staff-api/identityAuthority'
export { parsedStaffIdentityBinding, readStaffAssertionClaims, staffIdentityAuthorityCommand, validateCurrentStaffIdentityBinding } from '@/lib/staff-api/identityAuthority'
export type { StaffIdentityBinding, StaffIdentityAuthorityCommand, StaffIdentityBindingValidationCommand } from '@/lib/staff-api/identityAuthority'
import type { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject } from '@/lib/api/strictRequest'
import { verifyCustomerAssertion, type CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { integrationCredential, logIntegrationApiRequest, requireIntegrationApiAccess, type IntegrationApiAuthResult, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { STAFF_ONBOARDING_CONTRACT_VERSION } from '@/lib/staff-api/onboardingContract'
import { assertStaffStorageTarget, staffStorageProjectRef } from '@/lib/staff-api/storageTarget'
import { getRegisteredStaffTenantAuthUser, registeredStaffTenantAuth, type RegisteredStaffTenantAuth, type StaffTenantAuthIdentity } from '@/lib/staff-api/tenantAuth'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type StaffOnboardingProvider = CustomerIdentityProvider & { purpose: string; is_active: boolean }
export type StaffIdentityResolutionPorts = {
  apiAccess: (request: NextRequest, scopes: readonly string[]) => Promise<Pick<Extract<IntegrationApiAuthResult, { ok: true }>, 'ok' | 'client'> | Extract<IntegrationApiAuthResult, { ok: false }>>;
  getAuthUser: (registration: RegisteredStaffTenantAuth, accessToken: string) => Promise<StaffTenantAuthIdentity | null>;
  loadProvider: (companyId: string) => Promise<StaffOnboardingProvider | null>;
  consumeJti: (companyId: string, jti: string, expiresAt: Date) => Promise<boolean>;
  resolveIdentity: (command: StaffIdentityAuthorityCommand) => Promise<unknown>;
  logRequest: typeof logIntegrationApiRequest;
}

function denied(code = 'staff_identity_binding_invalid', status = 403): never {
  throw new ApiInputError('The independent staff identity could not be verified.', code, status)
}
function headerToken(request: NextRequest, name: string): string {
  const value = request.headers.get(name)
  if (!value || value.length > 16_384 || /\s/.test(value)) return denied('staff_identity_missing', 401)
  return value
}
function json(data: unknown, status = 200): Response {
  const requestId = randomUUID(), projectRef = staffStorageProjectRef()
  return Response.json({ ...(status < 400 ? { data } : { error: data }), request_id: requestId, contract_schema_version: STAFF_ONBOARDING_CONTRACT_VERSION }, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Gridex-Contract-Version': STAFF_ONBOARDING_CONTRACT_VERSION, ...(projectRef ? { 'X-Gridex-Project-Ref': projectRef } : {}) },
  })
}

/** Existing binding lookup only; no Auth account, membership, permission, or invitation is created. */
export function createStaffIdentityResolutionHandler(ports: StaffIdentityResolutionPorts): (request: NextRequest) => Promise<Response> {
  return async request => {
    if (request.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use an explicit POST to resolve the staff identity.' }, 405)
    try {
      const expected = request.headers.get('x-gridex-expected-project-ref')
      if (!expected || !staffStorageProjectRef()) denied('storage_project_mismatch', 412)
      assertStaffStorageTarget(request.headers)
    } catch (error) {
      return json({ code: error instanceof ApiInputError ? error.code : 'internal_error', message: 'The requested API project is unavailable.' }, error instanceof ApiInputError ? error.status : 500)
    }
    const startedAt = Date.now()
    let client: IntegrationApiClient | undefined
    try {
      const auth = await ports.apiAccess(request, ['staff_users.read'])
      if (!auth.ok) throw new ApiInputError(auth.error, auth.errorCode, auth.status)
      client = auth.client
      const registration = registeredStaffTenantAuth(client, client.company_id, client.id, 'staff_users.read')
      const credential = integrationCredential(request)
      if (!credential.ok) denied('staff_identity_missing', 401)
      if (Object.keys(await readJsonObject(request, 1024)).length !== 0) denied('staff_identity_input_invalid', 422)
      const authToken = headerToken(request, 'x-gridex-support-auth-token'), proof = headerToken(request, 'x-gridex-staff-assertion')
      const user = await ports.getAuthUser(registration, authToken)
      if (!user || !UUID.test(user.id) || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) denied('staff_identity_auth_invalid', 401)
      const provider = await ports.loadProvider(client.company_id)
      if (!provider || provider.company_id !== client.company_id || provider.purpose !== 'staff' || provider.is_active !== true
        || provider.subject_claim !== 'sub' || provider.enforcement !== 'enforce') denied('staff_identity_provider_invalid')
      // Unverified claims are used only for rejection. Signature verification still precedes lookup.
      const claims = readStaffAssertionClaims(proof)
      if (!claims || claims.token_use !== 'staff_identity_resolution' || claims.company_id !== client.company_id
        || typeof claims.iat !== 'number' || typeof claims.exp !== 'number' || claims.exp - claims.iat > 60) denied('staff_identity_assertion_invalid', 401)
      const verified = await verifyCustomerAssertion({ token: proof, provider, expectedSubject: user.id, requireIssuedAt: true,
        consumeJti: (jti, expiresAt) => ports.consumeJti(client!.company_id, jti, expiresAt) })
      if (!verified.ok) denied('staff_identity_assertion_invalid', 401)
      const binding = parsedStaffIdentityBinding(await ports.resolveIdentity(staffIdentityAuthorityCommand(client, provider, registration, user.id, credential.token)))
      if (!binding) denied()
      await ports.logRequest({ request, client, statusCode: 200, startedAt,
        metadata: { operation: 'staff_identity_resolve', outcome: 'resolved' } })
      return json(binding)
    } catch (failure) {
      const error = staffIdentityAuthorityError(failure)
      const status = error instanceof ApiInputError ? error.status : 500
      const code = error instanceof ApiInputError ? error.code : 'internal_error'
      if (client) await ports.logRequest({ request, client, statusCode: status, errorCode: code, startedAt,
        metadata: { operation: 'staff_identity_resolve', outcome: 'denied' } })
      return json({ code, message: 'The independent staff identity could not be verified.' }, status)
    }
  }
}

export const resolveStaffIdentity = createStaffIdentityResolutionHandler({
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
  resolveIdentity: resolveCurrentStaffIdentity,
  logRequest: logIntegrationApiRequest,
})
