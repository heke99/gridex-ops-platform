import { createPrivateKey, createPublicKey, randomUUID, sign, type JsonWebKey } from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'
import { verifyCustomerAssertion, type CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { loadRegisteredStaffInvitationClient, registeredStaffOnboardingOrigin, type StaffInvitationClient } from '@/lib/auth/staffInvitationRouting'
import { registeredStaffTenantAuth, type RegisteredStaffTenantAuth } from '@/lib/staff-api/tenantAuth'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'
import { supabaseService } from '@/lib/supabase/service'
import { parsedStaffIdentityBinding } from '@/lib/staff-api/identityAuthority'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DELIVERY_PATH = '/api/internal/staff/invitations/deliver'
const nativeDelivery = supabaseService as unknown as { rpc(name: 'gridex_staff_tenant_onboarding_ready_v1' | 'gridex_prepare_staff_identity_delivery_v1' | 'gridex_record_staff_identity_delivery_v1', args: { p_command: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> }
type StaffProvider = CustomerIdentityProvider & { purpose: string; is_active: boolean }
export type StaffDeliveryRegistration = { url: string; issuer: string; audience: string; key_id: string; request_public_jwk: JsonWebKey }
export type StaffClientVerification = {
  secret_hash: string; scopes: string[]; allowed_origins: string[] | null; staff_onboarding_origin: string;
  staff_tenant_auth: unknown; staff_tenant_delivery: unknown;
}
export type StaffOnboardingAuthority = {
  client: StaffInvitationClient & { secret_hash?: string };
  provider: StaffProvider; tenantAuth: RegisteredStaffTenantAuth; delivery: StaffDeliveryRegistration;
}
export type StaffDeliveryPayload = {
  delivery_id: string; actor_user_id: string; company_id: string; api_client_id: string; provider_id: string;
  invitation_id: string; recipient_email: string; full_name: string | null; auth_issuer: string; callback_url: string; request_hash: string;
}
export type StaffDeliveryReceipt = {
  request_hash: string; company_id: string; api_client_id: string; provider_id: string; invitation_id: string;
  delivery_id: string; local_auth_subject: string; auth_issuer: string; email: string; status: 'sent';
}
export function staffProviderSnapshot(provider: CustomerIdentityProvider) {
  return { kind: provider.kind, issuer: provider.issuer, audience: provider.audience, jwks_uri: provider.jwks_uri,
    public_jwk: provider.public_jwk, subject_claim: provider.subject_claim, enforcement: provider.enforcement }
}
export function staffClientSnapshot(client: StaffInvitationClient, secretHash: string): StaffClientVerification {
  return { secret_hash: secretHash, scopes: client.scopes, allowed_origins: client.allowed_origins ?? null,
    staff_onboarding_origin: registeredStaffOnboardingOrigin(client, client.company_id, client.id),
    staff_tenant_auth: client.metadata?.staff_tenant_auth, staff_tenant_delivery: client.metadata?.staff_tenant_delivery }
}
function unavailable(): never {
  throw new ApiInputError('Independent tenant invitation delivery is unavailable.', 'staff_tenant_delivery_not_ready', 503)
}
export function registeredStaffDelivery(client: StaffInvitationClient): StaffDeliveryRegistration {
  const origin = registeredStaffOnboardingOrigin(client, client.company_id, client.id)
  const value = client.metadata?.staff_tenant_delivery
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable()
  const entry = value as Partial<StaffDeliveryRegistration>
  if (entry.url !== `${origin}${DELIVERY_PATH}` || entry.audience !== entry.url
    || typeof entry.issuer !== 'string' || !/^https:\/\/[^\s?#]+$/.test(entry.issuer)
    || typeof entry.key_id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(entry.key_id)
    || !entry.request_public_jwk || entry.request_public_jwk.kty !== 'RSA'
    || entry.request_public_jwk.kid !== entry.key_id
    || ['d','p','q','dp','dq','qi','oth'].some(field => field in entry.request_public_jwk!)) return unavailable()
  try {
    const key = createPublicKey({ key: entry.request_public_jwk, format: 'jwk' })
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return unavailable()
  } catch { return unavailable() }
  return entry as StaffDeliveryRegistration
}
function deliverySigningKey(registration: StaffDeliveryRegistration) {
  try {
    const key = createPrivateKey((process.env.GRIDEX_STAFF_DELIVERY_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'))
    const publicJwk = createPublicKey(key).export({ format: 'jwk' })
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      || publicJwk.n !== registration.request_public_jwk.n || publicJwk.e !== registration.request_public_jwk.e) return unavailable()
    return key
  } catch { return unavailable() }
}
export async function loadStaffOnboardingAuthority(companyId: string, clientId: string): Promise<StaffOnboardingAuthority> {
  const client = await loadRegisteredStaffInvitationClient(companyId, clientId)
  const tenantAuth = registeredStaffTenantAuth(client, companyId, clientId, 'staff_users.write')
  const delivery = registeredStaffDelivery(client)
  deliverySigningKey(delivery) // Capability failure precedes a durable invitation intent.
  const { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers',
    'id,company_id,purpose,is_active,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement')
    .eq('purpose', 'staff').eq('is_active', true).maybeSingle()
  if (error) throw error
  const provider = data as StaffProvider | null
  if (!provider || provider.company_id !== companyId || provider.purpose !== 'staff' || provider.is_active !== true
    || provider.kind !== 'tenant_key' || provider.subject_claim !== 'sub' || provider.enforcement !== 'enforce') return unavailable()
  return { client, provider, tenantAuth, delivery }
}
export function staffAuthorityCommand(authority: StaffOnboardingAuthority, secretHash = authority.client.secret_hash ?? '') {
  return { company_id: authority.client.company_id, api_client_id: authority.client.id, provider_id: authority.provider.id,
    verified_client: staffClientSnapshot(authority.client, secretHash), verified_provider: staffProviderSnapshot(authority.provider) }
}
export async function requireStaffTenantOnboardingReady(authority: StaffOnboardingAuthority): Promise<void> {
  const { data, error } = await nativeDelivery.rpc('gridex_staff_tenant_onboarding_ready_v1', { p_command: staffAuthorityCommand(authority) })
  if (error || data !== true) return unavailable()
}
function assertPrepared(payload: StaffDeliveryPayload, authority: StaffOnboardingAuthority, invitationId: string): void {
  if (!payload || !UUID.test(payload.delivery_id) || !UUID.test(payload.actor_user_id)
    || payload.company_id !== authority.client.company_id || payload.api_client_id !== authority.client.id
    || payload.provider_id !== authority.provider.id || payload.invitation_id !== invitationId
    || payload.auth_issuer !== authority.tenantAuth.authIssuer || !/^[a-f0-9]{64}$/.test(payload.request_hash)
    || typeof payload.recipient_email !== 'string' || payload.recipient_email.length > 320) return unavailable()
  try {
    const callback = new URL(payload.callback_url)
    if (callback.origin !== authority.tenantAuth.origin || callback.pathname !== '/auth/invitation' || callback.hash
      || !UUID.test(callback.searchParams.get('token') ?? '') || [...callback.searchParams.keys()].join(',') !== 'token') return unavailable()
  } catch { return unavailable() }
}
function signDelivery(payload: StaffDeliveryPayload, authority: StaffOnboardingAuthority): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: authority.delivery.key_id })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ ...payload, iss: authority.delivery.issuer, aud: authority.delivery.audience,
    sub: payload.invitation_id, token_use: 'staff_invitation_delivery', iat: now, exp: now + 60, jti: randomUUID() })).toString('base64url')
  const input = `${header}.${claims}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), deliverySigningKey(authority.delivery)).toString('base64url')}`
}
async function responseReceipt(response: Response): Promise<string> {
  if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/json') || !response.body) return unavailable()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 24_576) { await reader.cancel(); return unavailable() }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { receipt?: unknown }
  if (!data || Object.keys(data).join(',') !== 'receipt' || typeof data.receipt !== 'string' || data.receipt.length > 16_384) return unavailable()
  return data.receipt
}
async function verifiedReceipt(token: string, payload: StaffDeliveryPayload, authority: StaffOnboardingAuthority): Promise<StaffDeliveryReceipt> {
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) } catch { return unavailable() }
  if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return unavailable()
  const checked = await verifyCustomerAssertion({ token, provider: authority.provider, expectedSubject: claims.sub, requireIssuedAt: true,
    consumeJti: async (jti, expiresAt) => {
      const { error } = await tenantInsert(payload.company_id, 'tenant_staff_assertion_replays', { jti, expires_at: expiresAt.toISOString() })
      if (error?.code === '23505') return false
      if (error) throw error
      return true
    } })
  if (!checked.ok || claims.token_use !== 'staff_invitation_delivery_receipt' || Number(claims.exp) - Number(claims.iat) > 60
    || checked.subject === payload.actor_user_id
    || claims.local_auth_subject !== checked.subject || claims.auth_issuer !== payload.auth_issuer
    || claims.email !== payload.recipient_email || claims.status !== 'sent') return unavailable()
  if (Object.keys(claims).sort().join(',') !== 'api_client_id,aud,auth_issuer,company_id,delivery_id,email,exp,iat,invitation_id,iss,jti,local_auth_subject,provider_id,request_hash,status,sub,token_use') return unavailable()
  for (const field of ['request_hash', 'company_id', 'api_client_id', 'provider_id', 'invitation_id', 'delivery_id'] as const) {
    if (claims[field] !== payload[field]) return unavailable()
  }
  return { request_hash: payload.request_hash, company_id: payload.company_id, api_client_id: payload.api_client_id,
    provider_id: payload.provider_id, invitation_id: payload.invitation_id, delivery_id: payload.delivery_id,
    local_auth_subject: checked.subject, auth_issuer: payload.auth_issuer, email: payload.recipient_email, status: 'sent' }
}
export async function deliverRegisteredStaffInvitation(input: {
  companyId: string; clientId: string; invitationId: string; provisioningJobId: string; provisioningLeaseToken: string;
}, fetchImpl: typeof fetch = fetch) {
  const authority = await loadStaffOnboardingAuthority(input.companyId, input.clientId)
  const common = { ...staffAuthorityCommand(authority), invitation_id: input.invitationId,
    provisioning_job_id: input.provisioningJobId, provisioning_lease_token: input.provisioningLeaseToken }
  const { data, error } = await nativeDelivery.rpc('gridex_prepare_staff_identity_delivery_v1', { p_command: common })
  if (error) throw error
  const payload = data as StaffDeliveryPayload
  assertPrepared(payload, authority, input.invitationId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(authority.delivery.url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.delivery_id }, body: JSON.stringify({ assertion: signDelivery(payload, authority) }) })
    const receipt = await verifiedReceipt(await responseReceipt(response), payload, authority)
    const recorded = await nativeDelivery.rpc('gridex_record_staff_identity_delivery_v1', { p_command: { ...common, delivery_id: payload.delivery_id, verified_receipt: receipt } })
    if (recorded.error) throw recorded.error
    if (parsedStaffIdentityBinding(recorded.data)?.actor_user_id !== payload.actor_user_id) return unavailable()
    return { userId: payload.actor_user_id, wasCreated: false, emailSent: true, acceptUrl: payload.callback_url }
  } catch { return unavailable() } finally { clearTimeout(timer) }
}
