import { randomUUID } from 'node:crypto'
import { type NextRequest, type NextResponse } from 'next/server'
import { requireStaffIntegrationApiAccess, type IntegrationApiAuthResult } from '@/lib/integrations/apiAuth'
import { publicReference } from '@/lib/integrations/publicReferences'
import { StaffApiError, staffApiErrorResponse, staffRequestIds, type StaffResponseContext } from '@/lib/staff-api/errors'
import { staffHash, staffReference, verifyStaffProof } from '@/lib/staff-api/crypto'
import { acquireSessionOperation, completeSessionOperation, loadStaffSession, operationError, revokeStaffSession, sessionPayload, type StaffSessionRow } from '@/lib/staff-api/sessionStore'
import { refreshNativeStaff } from '@/lib/staff-api/nativeAuth'
import type { StaffApiContext } from '@/lib/staff-api/context'
import { requireStaffReadBudget } from '@/lib/staff-api/rateLimit'
export type { StaffApiContext } from '@/lib/staff-api/context'

export async function requireStaffIntegration(request: NextRequest, scope: string) {
  // Staff v1 has one canonical machine-credential location; no legacy fallback.
  if (!/^Bearer [^\s]+$/i.test(request.headers.get('authorization') ?? '')) throw new StaffApiError(401, 'api_key_required', 'An integration API key is required.')
  const auth = await requireStaffIntegrationApiAccess(request, [scope])
  if (!auth.ok) throw new StaffApiError(auth.status, auth.errorCode, auth.error, auth.status >= 500 || auth.status === 429, [], auth.retryAfterSeconds, auth.rateLimit)
  return auth
}

export async function staffProofSession(request: NextRequest, auth: Extract<IntegrationApiAuthResult, { ok: true }>, options?: { allowStaleForReplay?: boolean }) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('x-gridex-staff-authorization') ?? '')
  if (!match) throw new StaffApiError(401, 'staff_session_required', 'Staff authentication is required.')
  const proof = verifyStaffProof(match[1])
  if (proof.clientReference !== staffReference('acl', auth.client.id) || proof.organizationReference !== staffReference('org', auth.client.company_id)) throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
  const row = await loadStaffSession(proof.sessionId)
  if (!row || row.api_client_id !== auth.client.id || row.company_id !== auth.client.company_id || row.status !== 'active' || (options?.allowStaleForReplay ? row.revision < proof.revision : row.revision !== proof.revision) || (row.revision === proof.revision && row.stage !== proof.stage) || staffReference('stf', row.user_id) !== proof.userReference || Date.parse(row.expires_at) <= Date.now()) throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
  return { row, proof }
}

export async function validateStaffSession(row: StaffSessionRow) {
  const acquired = await acquireSessionOperation(row, { key: `validate:${randomUUID()}`, command: 'validate', digest: staffHash(`validate:${row.id}:${row.revision}`), revision: row.revision })
  if (acquired.state !== 'acquired') {
    if (acquired.state === 'replay') throw new StaffApiError(503, 'staff_session_unavailable', 'Staff session is unavailable.', true)
    operationError(acquired)
  }
  try {
    const verified = await refreshNativeStaff(sessionPayload(acquired.session), acquired.session)
    await completeSessionOperation(acquired.session, acquired.lease_id, verified.payload, verified.sessionId, verified.aal, null, { advance: false })
    return verified
  } catch (error) {
    await revokeStaffSession(acquired.session, 'blocked').catch(() => undefined)
    throw error
  }
}

export async function requireStaffApi(request: NextRequest, input: { scope: string; permission?: string; mutation?: boolean }): Promise<{ ok: true; context: StaffApiContext } | { ok: false; response: NextResponse }> {
  let responseContext: StaffResponseContext = staffRequestIds(request)
  try {
    const integrationAuth = await requireStaffIntegration(request, input.scope)
    responseContext = { ...responseContext, integrationAuth }
    const { row } = await staffProofSession(request, integrationAuth)
    if (!input.mutation) await requireStaffReadBudget({ userId: row.user_id, companyId: row.company_id, clientId: row.api_client_id })
    const verified = await validateStaffSession(row)
    if (verified.payload.stage !== 'authenticated') throw new StaffApiError(403, 'staff_authentication_incomplete', 'Complete staff authentication before accessing customer data.', false, [{ code: verified.payload.stage, message: 'A further authentication step is required.' }])
    if (input.mutation && verified.isPlatformAdmin) throw new StaffApiError(403, 'staff_tenant_write_required', 'Tenant staff authorization is required for this operation.')
    if (input.permission && (!verified.isPlatformAdmin || input.mutation) && !verified.permissions.includes(input.permission)) throw new StaffApiError(403, 'staff_permission_denied', 'The current staff permission does not allow this operation.')
    const context: StaffApiContext = { requestId: responseContext.requestId, correlationId: responseContext.correlationId, companyId: row.company_id, userId: row.user_id, client: integrationAuth.client, isPlatformAdmin: verified.isPlatformAdmin, permissions: verified.permissions, roles: verified.roles, sessionId: row.id, sessionRevision: row.revision, nativeSessionId: verified.sessionId, integrationAuth, staffReference: publicReference('staff', row.company_id, row.user_id)!, organizationReference: staffReference('org', row.company_id), displayName: typeof verified.user.user_metadata?.full_name === 'string' ? verified.user.user_metadata.full_name.slice(0, 200) : null }
    return { ok: true, context }
  } catch (error) { return { ok: false, response: staffApiErrorResponse(request, error, responseContext) } }
}
