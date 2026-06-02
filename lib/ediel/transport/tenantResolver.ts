import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveInboundTenantForMessage } from '@/lib/ediel/core/tenantResolver'
import { supabaseService } from '@/lib/supabase/service'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function configuredMatches(configured: unknown, observed: unknown): boolean {
  const configuredValue = upper(configured)
  const observedValue = upper(observed)
  if (!configuredValue || !observedValue) return true
  return configuredValue === observedValue
}

function subaddressMatches(params: {
  configured: unknown
  observed: unknown
  required?: unknown
}): boolean {
  const configured = upper(params.configured)
  const observed = upper(params.observed)
  if (params.required === true && !observed) return false
  if (!configured || !observed) return true
  return configured === observed
}

export async function resolveTenantFromInboundEdifact(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  return resolveInboundTenantForMessage({
    actorUserId: params.actorUserId,
    message: params.message,
  })
}

export async function resolveTenantFromEdifact(params: {
  mailbox_id?: string | null
  environment: string
  unb_sender_ediel_id?: string | null
  unb_receiver_ediel_id?: string | null
  application_reference?: string | null
  message_family?: string | null
  business_code?: string | null
  nad_sender?: string | null
  nad_receiver?: string | null
  optional_unb_receiver_subaddress?: string | null
  optional_unb_sender_subaddress?: string | null
}): Promise<
  | { status: 'resolved'; company_id: string; route_profile_id: string; confidence: 'exact' }
  | { status: 'unresolved'; company_id: null; route_profile_id: null; reason: 'tenant_resolution_failed' | 'tenant_resolution_ambiguous'; candidate_company_ids: string[] }
> {
  const receiver = upper(params.unb_receiver_ediel_id ?? params.nad_receiver)
  if (!receiver) {
    return {
      status: 'unresolved',
      company_id: null,
      route_profile_id: null,
      reason: 'tenant_resolution_failed',
      candidate_company_ids: [],
    }
  }

  let query = supabaseService
    .from('ediel_route_profiles')
    .select('id,company_id,mailbox_id,own_ediel_id,own_subaddress,counterparty_ediel_id,counterparty_subaddress,sender_ediel_id,sender_subaddress,sender_sub_address,receiver_ediel_id,receiver_subaddress,receiver_sub_address,receiver_message_subaddress,subaddress_required,application_reference,message_family,message_code,business_code,is_active,is_enabled')
    .eq('environment', params.environment)

  const mailboxId = clean(params.mailbox_id)
  if (mailboxId) query = query.eq('mailbox_id', mailboxId)

  const { data, error } = await query.limit(1000)
  if (error) throw error

  const sender = upper(params.unb_sender_ediel_id ?? params.nad_sender)
  const receiverSub = upper(params.optional_unb_receiver_subaddress)
  const senderSub = upper(params.optional_unb_sender_subaddress)
  const appRef = upper(params.application_reference)
  const family = upper(params.message_family)
  const code = upper(params.business_code)

  const candidates = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const companyId = clean(row.company_id)
    if (!companyId || row.is_active === false || row.is_enabled === false) return false

    const ownIds = [row.own_ediel_id, row.receiver_ediel_id].map(upper).filter(Boolean)
    if (!ownIds.includes(receiver)) return false

    const counterpartyIds = [row.counterparty_ediel_id].map(upper).filter(Boolean)
    if (counterpartyIds.length > 0 && sender && !counterpartyIds.includes(sender)) return false

    const receiverSubConfigured =
      row.receiver_message_subaddress ??
      row.own_subaddress ??
      row.receiver_subaddress ??
      row.receiver_sub_address
    if (!subaddressMatches({
      configured: receiverSubConfigured,
      observed: receiverSub,
      required: row.subaddress_required,
    })) return false

    const senderSubConfigured = row.counterparty_subaddress ?? row.sender_subaddress ?? row.sender_sub_address
    if (!subaddressMatches({
      configured: senderSubConfigured,
      observed: senderSub,
      required: false,
    })) return false

    return (
      configuredMatches(row.application_reference, appRef) &&
      configuredMatches(row.message_family, family) &&
      configuredMatches(row.business_code ?? row.message_code, code)
    )
  })

  const byRoute = new Map<string, Record<string, unknown>>()
  for (const candidate of candidates) {
    if (clean(candidate.id)) byRoute.set(String(candidate.id), candidate)
  }
  const uniqueCandidates = [...byRoute.values()]
  const companyIds = [...new Set(uniqueCandidates.map((row) => clean(row.company_id)).filter((value): value is string => Boolean(value)))]

  if (uniqueCandidates.length === 1 && companyIds.length === 1) {
    return {
      status: 'resolved',
      company_id: companyIds[0],
      route_profile_id: String(uniqueCandidates[0].id),
      confidence: 'exact',
    }
  }

  return {
    status: 'unresolved',
    company_id: null,
    route_profile_id: null,
    reason: uniqueCandidates.length > 1 ? 'tenant_resolution_ambiguous' : 'tenant_resolution_failed',
    candidate_company_ids: companyIds,
  }
}
