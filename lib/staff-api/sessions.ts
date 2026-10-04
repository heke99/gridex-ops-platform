import { randomUUID } from 'node:crypto'
import { type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { publicReference } from '@/lib/integrations/publicReferences'
import { sendTransactionalEmail, getAuthSmtpReadiness } from '@/lib/auth/smtpTransactionalEmail'
import { getTenantEmailBranding, renderTenantEmailLayout } from '@/lib/tenant/emailBranding'
import { requireStaffApi, requireStaffIntegration, staffProofSession, validateStaffSession } from '@/lib/staff-api/auth'
import { StaffApiError, staffApiErrorResponse, staffApiJson, staffRequestIds, type StaffResponseContext } from '@/lib/staff-api/errors'
import { decryptStaffPayload, encryptStaffPayload, signStaffProof, staffHash, staffKeys, staffReference, staffRefreshToken, verifyStaffProof } from '@/lib/staff-api/crypto'
import { nativeAuthFailure, nativeStaffClient, refreshNativeStaff, verifyNativeStaff, type VerifiedNativeStaff } from '@/lib/staff-api/nativeAuth'
import { acquireSessionOperation, completeSessionOperation, insertStaffSession, loadStaffSession, loadStaffSessionByRefresh, operationError, revokeStaffSession, sessionPayload, staffRpc, type StaffSessionPayload, type StaffSessionRow } from '@/lib/staff-api/sessionStore'
import { requireStaffAuthBudget } from '@/lib/staff-api/rateLimit'
import type { StaffApiContext } from '@/lib/staff-api/context'

export type StaffSessionReceipt = {
  status: StaffSessionPayload['stage']; staff_access_token: string; refresh_token: string; token_type: 'Bearer'
  expires_in: 300; expires_at: string; refresh_expires_at: string; session_reference: string
  staff_reference: string; organization_reference: string
  factors: { factor_reference: string; method: 'totp'; friendly_name: string | null }[]
}
export type StaffSessionCommand = 'login' | 'refresh' | 'logout' | 'mfa_challenge' | 'mfa_verify' | 'password' | 'recovery' | 'recovery_verify'

async function bodyObject(request: NextRequest, keys: string[], optional: string[] = []) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new StaffApiError(415, 'unsupported_media_type', 'A JSON request body is required.')
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) throw new StaffApiError(413, 'payload_too_large', 'Request body is too large.')
  const reader = request.body?.getReader()
  if (!reader) throw new StaffApiError(400, 'json_body_missing', 'A JSON request body is required.')
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 16_384) { await reader.cancel(); throw new StaffApiError(413, 'payload_too_large', 'Request body is too large.') } chunks.push(result.value) }
  } finally { reader.releaseLock() }
  let body: Record<string, unknown>
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new StaffApiError(400, 'invalid_json', 'The JSON request body is invalid.') }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !optional.includes(key) && body[key] === undefined)) throw new StaffApiError(422, 'invalid_request', 'The request fields are invalid.')
  return body
}
function text(body: Record<string, unknown>, key: string, min: number, max: number, pattern?: RegExp) {
  const value = body[key]
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) throw new StaffApiError(422, 'invalid_request', `The ${key} field is invalid.`)
  return value
}
function email(body: Record<string, unknown>) { const value = text(body, 'email', 3, 254).trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new StaffApiError(422, 'invalid_request', 'The email field is invalid.'); return value }
function operationKey(request: NextRequest) { const key = request.headers.get('idempotency-key') ?? ''; if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new StaffApiError(400, key ? 'idempotency_key_invalid' : 'idempotency_key_required', 'A valid Idempotency-Key is required.'); return key }
function receipt(row: StaffSessionRow, verified: VerifiedNativeStaff, refreshToken: string, revision: number): StaffSessionReceipt {
  return { status: verified.payload.stage, staff_access_token: signStaffProof({ sessionId: row.id, revision, clientId: row.api_client_id, companyId: row.company_id, userReference: staffReference('stf', row.user_id), stage: verified.payload.stage }), refresh_token: refreshToken, token_type: 'Bearer', expires_in: 300, expires_at: new Date(Date.now() + 300_000).toISOString(), refresh_expires_at: row.expires_at, session_reference: `sst_${row.id}`, staff_reference: publicReference('staff', row.company_id, row.user_id)!, organization_reference: staffReference('org', row.company_id), factors: verified.payload.factors.map((factor) => ({ factor_reference: staffReference('mfa', `${row.id}:${factor.id}`), method: 'totp', friendly_name: factor.friendly_name })) }
}
async function createSession(payload: StaffSessionPayload, companyId: string, clientId: string) {
  const verified = await verifyNativeStaff(payload, companyId)
  const id = randomUUID(); const refreshToken = staffRefreshToken()
  const row: StaffSessionRow = { id, user_id: verified.user.id, company_id: companyId, api_client_id: clientId, native_session_id: verified.sessionId, encrypted_payload: encryptStaffPayload(verified.payload, id), refresh_hash: staffHash(`refresh:${refreshToken}`), previous_refresh_hash: null, revision: 1, stage: verified.payload.stage, native_aal: verified.aal, status: 'active', expires_at: new Date(Date.now() + 8 * 3600_000).toISOString(), lease_id: null, lease_expires_at: null }
  await insertStaffSession(row)
  return receipt(row, verified, refreshToken, 1)
}
async function boundRefreshRow(token: string, clientId: string, companyId: string) {
  const row = await loadStaffSessionByRefresh(token)
  if (!row || row.api_client_id !== clientId || row.company_id !== companyId || Date.parse(row.expires_at) <= Date.now()) throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
  return row
}
type FailedAuthReceipt = { failed: { status: number; code: string; message: string; retryable: boolean } }
async function runProtectedOperation(request: NextRequest, command: 'refresh' | 'mfa_challenge' | 'mfa_verify' | 'password', input: Record<string, unknown>, row: StaffSessionRow, key: string, refreshToken?: string, proofRevision = row.revision) {
  const canonicalInput = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
  const acquired = await acquireSessionOperation(row, { key, command, digest: staffHash(`${command}:${canonicalInput}`), ...(command === 'refresh' ? { refreshHash: staffHash(`refresh:${refreshToken}`) } : { revision: proofRevision }) })
  if (acquired.state === 'replay') {
    const verified = await validateStaffSession(acquired.session)
    const saved = decryptStaffPayload<StaffSessionReceipt | FailedAuthReceipt | { challenge_reference: string; method: 'totp'; expires_at: string }>(acquired.receipt, `receipt:${row.id}`)
    if ('failed' in saved) throw new StaffApiError(saved.failed.status, saved.failed.code, saved.failed.message, saved.failed.retryable)
    if ('status' in saved) {
      if (saved.status !== verified.payload.stage || saved.session_reference !== `sst_${row.id}`) throw new StaffApiError(409, 'staff_session_changed', 'The current authentication state has changed.')
      // The rotated refresh credential stays identical; the short-lived access
      // proof is freshly issued after current native authorization is checked.
      return receipt(acquired.session, verified, saved.refresh_token, acquired.session.revision)
    }
    return saved
  }
  if (acquired.state !== 'acquired') operationError(acquired)
  let verified: VerifiedNativeStaff | null = null
  try {
    verified = await refreshNativeStaff(sessionPayload(acquired.session), acquired.session)
    if (command === 'mfa_challenge') {
      if (verified.payload.stage !== 'mfa_required') throw new StaffApiError(403, 'staff_authentication_step_invalid', 'MFA authentication is not pending.')
      const factorReference = text(input, 'factor_reference', 36, 36, /^mfa_[0-9a-f]{32}$/)
      const factor = verified.payload.factors.find((f) => staffReference('mfa', `${row.id}:${f.id}`) === factorReference)
      if (!factor) throw new StaffApiError(403, 'staff_mfa_factor_invalid', 'The MFA factor does not belong to this staff session.')
      const native = nativeStaffClient()
      const installed = await native.auth.setSession({ access_token: verified.payload.accessToken, refresh_token: verified.payload.refreshToken })
      if (installed.error) nativeAuthFailure(installed.error)
      const challenge = await native.auth.mfa.challenge({ factorId: factor.id })
      if (challenge.error || !challenge.data) nativeAuthFailure(challenge.error)
      const challengeReference = staffReference('mch', `${row.id}:${challenge.data.id}`)
      const expiresAt = new Date(Number(challenge.data.expires_at) * 1000).toISOString()
      verified.payload.challenge = { reference: challengeReference, factorId: factor.id, nativeId: challenge.data.id, expiresAt }
      const result = { challenge_reference: challengeReference, method: 'totp' as const, expires_at: expiresAt }
      await completeSessionOperation(acquired.session, acquired.lease_id, verified.payload, verified.sessionId, verified.aal, result, { advance: false })
      return result
    }
    if (command === 'mfa_verify') {
      if (verified.payload.stage !== 'mfa_required') throw new StaffApiError(403, 'staff_authentication_step_invalid', 'MFA authentication is not pending.')
      const challenge = verified.payload.challenge
      if (!challenge || challenge.reference !== input.challenge_reference || Date.parse(challenge.expiresAt) <= Date.now() || !verified.payload.factors.some((f) => f.id === challenge.factorId)) throw new StaffApiError(403, 'staff_mfa_challenge_invalid', 'The MFA challenge is invalid or expired.')
      const native = nativeStaffClient()
      const installed = await native.auth.setSession({ access_token: verified.payload.accessToken, refresh_token: verified.payload.refreshToken })
      if (installed.error) nativeAuthFailure(installed.error)
      const result = await native.auth.mfa.verify({ factorId: challenge.factorId, challengeId: challenge.nativeId, code: String(input.code) })
      if (result.error?.status && result.error.status >= 400 && result.error.status < 500 && result.error.status !== 429) throw new StaffApiError(422, 'staff_mfa_code_invalid', 'The MFA code was not accepted.')
      if (result.error || !result.data?.access_token || !result.data.refresh_token) nativeAuthFailure(result.error)
      verified = await verifyNativeStaff({ ...verified.payload, accessToken: result.data.access_token, refreshToken: result.data.refresh_token, challenge: undefined }, row.company_id, row)
      if (verified.aal !== 'aal2') throw new StaffApiError(403, 'staff_mfa_verification_failed', 'Native MFA verification did not complete.')
    }
    if (command === 'password') {
      if (verified.payload.stage !== 'password_change_required') throw new StaffApiError(403, 'staff_authentication_step_invalid', 'A password change is not pending.')
      const native = nativeStaffClient()
      const installed = await native.auth.setSession({ access_token: verified.payload.accessToken, refresh_token: verified.payload.refreshToken })
      if (installed.error) nativeAuthFailure(installed.error)
      const changed = await native.auth.updateUser({ password: String(input.password) })
      if (changed.error?.status && changed.error.status >= 400 && changed.error.status < 500 && changed.error.status !== 429) throw new StaffApiError(422, 'staff_password_rejected', 'The new password was not accepted.')
      if (changed.error) nativeAuthFailure(changed.error)
      const updated = await supabaseService.from('user_profiles').update({ must_change_password: false, password_changed_at: new Date().toISOString() }).eq('id', row.user_id)
      if (updated.error) throw new StaffApiError(503, 'staff_password_policy_unavailable', 'Password policy could not be updated.', true)
      verified = await refreshNativeStaff({ ...verified.payload, recovery: false }, row)
    }
    const token = staffRefreshToken()
    const result = receipt(row, verified, token, acquired.session.revision + 1)
    await completeSessionOperation(acquired.session, acquired.lease_id, verified.payload, verified.sessionId, verified.aal, result, { advance: true, refreshToken: token })
    return result
  } catch (error) {
    if (verified && error instanceof StaffApiError && (error.status === 422 || ['staff_authentication_step_invalid', 'staff_mfa_factor_invalid', 'staff_mfa_challenge_invalid'].includes(error.code))) {
      await completeSessionOperation(acquired.session, acquired.lease_id, verified.payload, verified.sessionId, verified.aal, { failed: { status: error.status, code: error.code, message: error.message, retryable: error.retryable } }, { advance: false })
      throw error
    }
    await revokeStaffSession(acquired.session, 'blocked').catch(() => undefined)
    throw error
  }
}

export async function staffSessionHandler(request: NextRequest, command: StaffSessionCommand) {
  let responseContext: StaffResponseContext = staffRequestIds(request)
  const respond = (data: unknown, status = 200) => staffApiJson(request, responseContext, data, status)
  try {
    const auth = await requireStaffIntegration(request, 'staff_sessions.write')
    responseContext = { ...responseContext, integrationAuth: auth }
    staffKeys()
    if (command === 'login') {
      const input = await bodyObject(request, ['email', 'password']); const address = email(input); const password = text(input, 'password', 1, 1024)
      await requireStaffAuthBudget(request, auth.client.id, address, 'login')
      const native = nativeStaffClient()
      const result = await native.auth.signInWithPassword({ email: address, password })
      if (result.error || !result.data.session) nativeAuthFailure(result.error, true)
      try { return respond(await createSession({ accessToken: result.data.session.access_token, refreshToken: result.data.session.refresh_token, stage: 'authenticated', recovery: false, factors: [] }, auth.client.company_id, auth.client.id)) }
      catch (error) { await supabaseService.auth.admin.signOut(result.data.session.access_token, 'local').catch(() => undefined); throw error }
    }
    if (command === 'refresh') {
      const input = await bodyObject(request, ['refresh_token']); const token = text(input, 'refresh_token', 43, 43, /^[A-Za-z0-9_-]{43}$/)
      const row = await boundRefreshRow(token, auth.client.id, auth.client.company_id)
      await requireStaffAuthBudget(request, auth.client.id, row.user_id, 'refresh')
      return respond(await runProtectedOperation(request, 'refresh', input, row, operationKey(request), token))
    }
    if (command === 'logout') {
      const input = await bodyObject(request, ['refresh_token'], ['refresh_token']); const key = operationKey(request)
      let row: StaffSessionRow | null
      if (input.refresh_token !== undefined) row = await boundRefreshRow(text(input, 'refresh_token', 43, 43, /^[A-Za-z0-9_-]{43}$/), auth.client.id, auth.client.company_id)
      else {
        const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('x-gridex-staff-authorization') ?? '')?.[1]
        if (!token) throw new StaffApiError(401, 'staff_session_required', 'Staff authentication is required.')
        const proof = verifyStaffProof(token); row = await loadStaffSession(proof.sessionId)
        if (!row || proof.clientReference !== staffReference('acl', auth.client.id) || proof.organizationReference !== staffReference('org', auth.client.company_id) || row.api_client_id !== auth.client.id || row.company_id !== auth.client.company_id || proof.userReference !== staffReference('stf', row.user_id)) throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
      }
      const result = await staffRpc<{ state: string }>('staff_api_logout_session', { p_session_id: row.id, p_client_id: auth.client.id, p_company_id: auth.client.company_id, p_operation_key: key, p_request_hash: staffHash(`logout:${JSON.stringify(input)}`), p_receipt: encryptStaffPayload({ logged_out: true }, `receipt:${row.id}`) })
      if (result.state === 'conflict') throw new StaffApiError(409, 'idempotency_conflict', 'The operation reference does not match this request.')
      if (result.state !== 'revoked') throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
      const revoked = await supabaseService.auth.admin.signOut(sessionPayload(row).accessToken, 'local')
      if (revoked.error) nativeAuthFailure(revoked.error)
      return respond({ logged_out: true })
    }
    if (command === 'recovery') {
      const input = await bodyObject(request, ['email']); const address = email(input)
      await requireStaffAuthBudget(request, auth.client.id, address, 'recovery')
      const origin = process.env.GRIDEX_STAFF_RECOVERY_ORIGIN
      if (origin !== 'https://support123.gridex.se' || !getAuthSmtpReadiness().ready) throw new StaffApiError(503, 'staff_recovery_not_configured', 'Staff recovery is not configured.', true)
      const eligibleUserId = await staffRpc<string | null>('staff_api_recovery_identity', { p_email: address, p_company_id: auth.client.company_id })
      if (!eligibleUserId) return respond({ accepted: true }, 202)
      const generated = await supabaseService.auth.admin.generateLink({ type: 'recovery', email: address, options: { redirectTo: `${origin}/login/recovery` } })
      if (generated.error) {
        if (generated.error.status === 404 || generated.error.code === 'user_not_found') return respond({ accepted: true }, 202)
        nativeAuthFailure(generated.error)
      }
      const user = generated.data.user
      if (user?.id === eligibleUserId && !user.deleted_at && (!user.banned_until || Date.parse(user.banned_until) <= Date.now()) && user.email_confirmed_at) {
        const stillEligible = await staffRpc<string | null>('staff_api_recovery_identity', { p_email: address, p_company_id: auth.client.company_id })
        if (stillEligible === eligibleUserId) {
          const hash = generated.data.properties.hashed_token
          if (!hash || !/^[A-Za-z0-9_-]{16,512}$/.test(hash)) throw new StaffApiError(503, 'staff_recovery_unavailable', 'Staff recovery is unavailable.', true)
          const branding = await getTenantEmailBranding(auth.client.company_id)
          const url = `${origin}/login/recovery#token_hash=${encodeURIComponent(hash)}`
          await sendTransactionalEmail({ to: address, subject: `${branding.displayName}: Återställ personalens lösenord`, html: renderTenantEmailLayout({ branding, title: 'Återställ lösenord', intro: 'Du har begärt en lösenordsåterställning för personalinloggningen.', body: '<p>Använd länken för att välja ett nytt lösenord. Om du inte begärt detta kan du ignorera meddelandet.</p>', ctaLabel: 'Välj nytt lösenord', ctaUrl: url }), replyTo: branding.supportEmail ?? undefined })
        }
      }
      return respond({ accepted: true }, 202)
    }
    if (command === 'recovery_verify') {
      const input = await bodyObject(request, ['token_hash']); const hash = text(input, 'token_hash', 16, 512, /^[A-Za-z0-9_-]+$/)
      await requireStaffAuthBudget(request, auth.client.id, staffHash(hash), 'recovery_verify')
      const native = nativeStaffClient(); const result = await native.auth.verifyOtp({ token_hash: hash, type: 'recovery' })
      if (result.error || !result.data.session) nativeAuthFailure(result.error)
      try { return respond(await createSession({ accessToken: result.data.session.access_token, refreshToken: result.data.session.refresh_token, stage: 'password_change_required', recovery: true, factors: [] }, auth.client.company_id, auth.client.id)) }
      catch (error) { await supabaseService.auth.admin.signOut(result.data.session.access_token, 'local').catch(() => undefined); throw error }
    }
    const fields = command === 'mfa_challenge' ? ['factor_reference'] : command === 'mfa_verify' ? ['challenge_reference', 'code'] : ['password']
    const input = await bodyObject(request, fields)
    if (command === 'mfa_challenge') text(input, 'factor_reference', 36, 36, /^mfa_[0-9a-f]{32}$/)
    if (command === 'mfa_verify') { text(input, 'challenge_reference', 36, 36, /^mch_[0-9a-f]{32}$/); text(input, 'code', 6, 6, /^\d{6}$/) }
    if (command === 'password') text(input, 'password', 12, 1024)
    const { row, proof } = await staffProofSession(request, auth, { allowStaleForReplay: command !== 'mfa_challenge' })
    await requireStaffAuthBudget(request, auth.client.id, row.user_id, command)
    return respond(await runProtectedOperation(request, command, input, row, command === 'mfa_challenge' ? `challenge:${randomUUID()}` : operationKey(request), undefined, proof.revision))
  } catch (error) { return staffApiErrorResponse(request, error, responseContext) }
}

export function staffCapabilities(context: StaffApiContext) {
  const scopes = context.client.scopes; const scoped = (s: string) => scopes.includes('*') || scopes.includes(s)
  const permitted = (p: string) => context.isPlatformAdmin || context.permissions.includes(p)
  return [ ...(scoped('staff_context.read') ? ['staff.context'] : []), ...(scoped('staff_customers.read') && permitted('customers.read') ? ['staff.customers.read'] : []), ...(scoped('staff_support.read') && permitted('cases.read') ? ['staff.support.read', 'staff.support.attachments'] : []), ...(scoped('staff_support.write') && !context.isPlatformAdmin && context.permissions.includes('cases.write') ? ['staff.support.write'] : []) ]
}
export async function staffMeHandler(request: NextRequest) {
  const result = await requireStaffApi(request, { scope: 'staff_context.read' })
  if (!result.ok) return result.response
  const c = result.context
  return staffApiJson(request, c, { staff_reference: c.staffReference, display_name: c.displayName, organization_reference: c.organizationReference, is_platform_admin: c.isPlatformAdmin, permissions: c.permissions, capabilities: staffCapabilities(c) })
}
