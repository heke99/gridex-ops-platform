// lib/customer-operations/manualGridOwnerSendGuards.ts
//
// Guards shared by the manual grid-owner request orchestrator (queue time), the
// manual e-mail outbox worker (send time) and the follow-up watchdog. Keeping
// them in one place guarantees that a power of attorney or recipient that was
// valid when the mail was queued is re-checked with the SAME rules right before
// the provider is called.

import { supabaseService } from '@/lib/supabase/service'
import { derivePowerOfAttorneyLifecycleStatus } from '@/lib/customers/poaReadiness'

type JsonRecord = Record<string, unknown>

export type ManualContactChannelType =
  | 'facility_information_request'
  | 'supplier_switch_manual'
  | 'power_of_attorney'
  | 'ai_list'
  | 'escalation'

export const MANUAL_CONTACT_CHANNEL_TYPES: ReadonlySet<string> = new Set([
  'facility_information_request',
  'supplier_switch_manual',
  'power_of_attorney',
  'ai_list',
  'escalation',
])

// Every column the lifecycle derivation and external-sendability checks read.
export const MANUAL_POA_SELECT = [
  'id', 'company_id', 'customer_id', 'status', 'scope', 'scope_summary', 'site_id', 'customer_site_id',
  'valid_from', 'valid_to', 'valid_until', 'expires_at', 'revoked_at',
  'fullmakt_snapshot', 'evidence_payload', 'metadata', 'document_id', 'document_path', 'reference',
  'signer_name', 'signer_identity_number', 'method', 'accepted_at', 'signed_at', 'legal_text_version_id', 'source',
].join(',')

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

// A POA may authorise an external grid-owner mail only while its canonical
// lifecycle is 'valid' (accepted with evidence, inside valid_from/valid_to,
// not revoked/replaced/expired) and any expires_at has not passed.
export function manualPoaIsCurrentlyValid(poa: JsonRecord | null | undefined, now: Date = new Date()): boolean {
  if (!poa) return false
  if (derivePowerOfAttorneyLifecycleStatus(poa, { now }) !== 'valid') return false
  const expiresAt = clean(poa.expires_at)
  if (expiresAt) {
    const parsed = Date.parse(expiresAt)
    if (Number.isNaN(parsed) || parsed < now.getTime()) return false
  }
  return true
}

// Scope match against the scope text column and scope_summary. Object-shaped
// summaries only grant a scope whose value is literally true:
// { facility_information_lookup: false } is a denial, not a grant.
export function poaScopeAllows(poa: JsonRecord, requiredScope: string): boolean {
  const scopeText = clean(poa.scope)?.toLowerCase()
  // supplier_switch implicitly covers facility_information_lookup for the switch.
  const acceptable = new Set([requiredScope, 'supplier_switch', 'all'])
  if (scopeText && acceptable.has(scopeText)) return true
  const summary = poa.scope_summary
  if (!summary || typeof summary !== 'object') return false
  if (Array.isArray(summary)) {
    const values = summary.map((value) => String(value).toLowerCase())
    return values.includes(requiredScope) || values.includes('supplier_switch')
  }
  const record = summary as JsonRecord
  if (Array.isArray(record.scopes)) {
    const values = (record.scopes as unknown[]).map((value) => String(value).toLowerCase())
    if (values.includes(requiredScope) || values.includes('supplier_switch')) return true
  }
  return record[requiredScope] === true || record.supplier_switch === true
}

export type ManualGridOwnerContact = {
  email: string
  source: string
  contactChannelId: string | null
  isVerified: boolean
}

// Recipient address per grid owner and channel. Tenant override (company_id
// set) takes precedence over the platform default; ambiguity is an error.
export async function findGridOwnerManualContact(input: {
  companyId: string
  gridOwnerId: string
  channelType: ManualContactChannelType | string
}): Promise<ManualGridOwnerContact | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('id,email,company_id,source,is_enabled,is_verified,verified_at')
    .eq('grid_owner_id', input.gridOwnerId)
    .eq('channel_type', input.channelType)
    .eq('is_enabled', true)
    .eq('is_verified', true)
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
    .order('verified_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  const rows = ((data ?? []) as JsonRecord[]).filter(
    (row) => !row.company_id || String(row.company_id) === input.companyId,
  )
  const sorted = rows
    .filter((row) => clean(row.email) && row.is_verified === true)
    .sort((a, b) => {
      const tenantPriority = (a.company_id ? 0 : 1) - (b.company_id ? 0 : 1)
      if (tenantPriority) return tenantPriority
      const verifiedPriority = String(b.verified_at ?? '').localeCompare(String(a.verified_at ?? ''))
      return verifiedPriority || String(a.id).localeCompare(String(b.id))
    })
  const chosen = sorted[0]
  if (!chosen) return null
  const samePriority = sorted.filter((row) => Boolean(row.company_id) === Boolean(chosen.company_id) && String(row.verified_at ?? '') === String(chosen.verified_at ?? ''))
  if (samePriority.length > 1) throw new Error('Flera verifierade nätägarkontakter har samma prioritet. Markera en entydig kontaktväg.')
  return {
    email: String(chosen.email).trim(),
    source: String(chosen.source ?? 'manual_admin'),
    contactChannelId: clean(chosen.id),
    isVerified: chosen.is_verified === true,
  }
}

export async function readPowerOfAttorneyForSend(input: { companyId: string; poaId: string }): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select(MANUAL_POA_SELECT)
    .eq('company_id', input.companyId)
    .eq('id', input.poaId)
    .maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}
