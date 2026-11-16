/**
 * Outgoing webhook lifecycle versus inbound API credential lifecycle (F45).
 *
 * Owner-approved policy (OPS API remediation plan, package 13):
 * - Normal key rotation keeps explicitly approved webhooks delivering.
 * - Security revocation and tenant offboarding stop webhooks created with the
 *   revoked credential.
 * - Subscriptions without a credential link (`api_client_id` null) or with an
 *   explicit manual approval are owned independently of the credential and
 *   follow only subscription and tenant state.
 * - Expiry and pausing of a credential stop inbound calls only.
 *
 * The decision is evaluated immediately before transport for every delivery,
 * including deliveries queued before the revocation, so the stop takes effect
 * as soon as the credential revocation commits. Subscription status updates
 * made by the revoke action are an additional, visible record.
 */
import { supabaseService } from '@/lib/supabase/service'

export const CREDENTIAL_REVOKE_KINDS = ['key_rotation', 'security_revocation', 'tenant_offboarding'] as const
export type CredentialRevokeKind = (typeof CREDENTIAL_REVOKE_KINDS)[number]

/** Revoke kinds that stop credential-linked webhooks. */
const STOPPING_KINDS: ReadonlySet<CredentialRevokeKind> = new Set(['security_revocation', 'tenant_offboarding'])

const KIND_PREFIX = /^\[revoke_kind:([a-z_]+)\]\s*/

export function isCredentialRevokeKind(value: unknown): value is CredentialRevokeKind {
  return typeof value === 'string' && (CREDENTIAL_REVOKE_KINDS as readonly string[]).includes(value)
}

/** Stores the kind in `revoke_reason` as a machine-readable prefix. */
export function formatRevokeReason(kind: CredentialRevokeKind, reason: string | null): string {
  const text = (reason ?? '').replace(KIND_PREFIX, '').trim()
  return text ? `[revoke_kind:${kind}] ${text}` : `[revoke_kind:${kind}]`
}

/** Returns the recorded kind, or null for revocations made before this policy. */
export function parseRevokeKind(revokeReason: string | null | undefined): CredentialRevokeKind | null {
  const match = KIND_PREFIX.exec(revokeReason ?? '')
  return match && isCredentialRevokeKind(match[1]) ? match[1] : null
}

export function revokeKindStopsWebhooks(kind: CredentialRevokeKind | null): boolean {
  return kind !== null && STOPPING_KINDS.has(kind)
}

export type WebhookCredentialSubscription = {
  api_client_id?: string | null
  company_id: string
  metadata?: Record<string, unknown> | null
}

export type WebhookCredentialClient = {
  id: string
  company_id: string
  status: string
  revoke_reason?: string | null
  metadata?: Record<string, unknown> | null
}

export type WebhookCredentialDecision =
  | { allowed: true; basis: 'independent_ownership' | 'credential_lifecycle_keeps_webhook' }
  | { allowed: false; reason: 'webhook_credential_missing' | 'webhook_credential_security_revoked' | 'webhook_credential_tenant_offboarded' }

/** Subscription explicitly approved to survive its creating credential. */
export function hasIndependentOwnership(subscription: WebhookCredentialSubscription): boolean {
  if (!subscription.api_client_id) return true
  return subscription.metadata?.credential_independent_approval === true
}

export function webhookCredentialDecision(
  subscription: WebhookCredentialSubscription,
  client: WebhookCredentialClient | null,
): WebhookCredentialDecision {
  if (hasIndependentOwnership(subscription)) return { allowed: true, basis: 'independent_ownership' }
  if (!client || client.id !== subscription.api_client_id || client.company_id !== subscription.company_id) {
    return { allowed: false, reason: 'webhook_credential_missing' }
  }
  if (client.status === 'revoked') {
    const kind = parseRevokeKind(client.revoke_reason)
    if (kind === 'security_revocation') return { allowed: false, reason: 'webhook_credential_security_revoked' }
    // Tenant closure revokes credentials in canonical_transition_tenant_lifecycle
    // and marks them with metadata.lifecycle_status = 'closed'.
    if (kind === 'tenant_offboarding' || client.metadata?.lifecycle_status === 'closed') return { allowed: false, reason: 'webhook_credential_tenant_offboarded' }
  }
  return { allowed: true, basis: 'credential_lifecycle_keeps_webhook' }
}

/** Tenant-bound read of the credentials linked to the given subscriptions. */
export async function loadWebhookCredentialClients(
  subscriptions: WebhookCredentialSubscription[],
): Promise<Map<string, WebhookCredentialClient>> {
  const ids = Array.from(new Set(
    subscriptions.filter((s) => !hasIndependentOwnership(s)).map((s) => String(s.api_client_id)),
  ))
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,status,revoke_reason,metadata')
    .in('id', ids)
  if (error) throw error
  return new Map(((data ?? []) as WebhookCredentialClient[]).map((client) => [client.id, client]))
}

/**
 * Disables active, credential-linked subscriptions of a revoked credential
 * when the revoke kind requires it. Independently owned subscriptions are
 * left untouched. Returns the number of subscriptions disabled.
 */
export async function stopCredentialLinkedWebhooks(input: {
  companyId: string
  clientId: string
  kind: CredentialRevokeKind
  actorUserId: string | null
}): Promise<number> {
  if (!revokeKindStopsWebhooks(input.kind)) return 0
  const { data, error } = await supabaseService
    .from('webhook_subscriptions')
    .select('id,company_id,api_client_id,metadata')
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.clientId)
    .eq('status', 'active')
  if (error) throw error
  const ids = ((data ?? []) as Array<WebhookCredentialSubscription & { id: string }>)
    .filter((subscription) => !hasIndependentOwnership(subscription))
    .map((subscription) => subscription.id)
  if (ids.length === 0) return 0
  const { error: updateError } = await supabaseService
    .from('webhook_subscriptions')
    .update({
      status: 'disabled',
      status_reason: input.kind === 'security_revocation' ? 'credential_security_revoked' : 'credential_tenant_offboarded',
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.clientId)
    .in('id', ids)
  if (updateError) throw updateError
  return ids.length
}
