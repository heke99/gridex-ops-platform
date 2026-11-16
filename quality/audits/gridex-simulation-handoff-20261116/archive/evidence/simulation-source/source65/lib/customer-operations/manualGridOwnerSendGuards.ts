// lib/customer-operations/manualGridOwnerSendGuards.ts
//
// Guards shared by the manual grid-owner request orchestrator (queue time), the
// manual e-mail outbox worker (send time) and the follow-up watchdog. Keeping
// them in one place guarantees that a power of attorney or recipient that was
// valid when the mail was queued is re-checked with the SAME rules right before
// the provider is called.

import { supabaseService } from '@/lib/supabase/service'
import { derivePowerOfAttorneyLifecycleStatus } from '@/lib/customers/poaReadiness'
import { resolveCurrentInfoRequestScopeAuthorization } from '@/lib/onboarding/infoRequestAuthorization'
import { powerOfAttorneyCoverageFromScopes } from '@/lib/operations/powerOfAttorneyWorkflow'

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
  'signed_scope_snapshot',
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

export const MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE = 'current_supplier_contract_information_request'

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}

export function isManualSupplierInformationRequest(request: JsonRecord): boolean {
  return request.request_type === MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE || record(request.metadata).target_party === 'current_supplier'
}

export function isPartialManualSupplierReply(request: JsonRecord): boolean {
  const parsed = record(request.parsed_payload)
  return isManualSupplierInformationRequest(request) && request.status === 'manual_response_received'
    && parsed.complete === false && Boolean(clean(parsed.sourceHash))
}

export type ManualSupplierContact = ManualGridOwnerContact & { supplierId: string; actorId: string }

/** No name/email guessing: only the site's tenant-visible supplier actor and
 * one currently verified contact for the power-of-attorney purpose. */
export async function findCurrentSupplierManualContact(input: {
  companyId: string; customerId: string; siteId: string
  expectedSupplierId?: string; expectedActorId?: string; expectedContactId?: string; now?: Date
}): Promise<ManualSupplierContact | null> {
  const siteResult = await supabaseService.from('customer_sites').select('id,company_id,customer_id,current_supplier_id,protected_identity')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('id', input.siteId).maybeSingle()
  if (siteResult.error) throw siteResult.error
  const site = siteResult.data as JsonRecord | null
  const supplierId = clean(site?.current_supplier_id)
  if (!site || site.protected_identity === true || !supplierId || (input.expectedSupplierId && input.expectedSupplierId !== supplierId)) return null
  const supplierResult = await supabaseService.from('electricity_suppliers').select('id,company_id,platform_market_actor_id,is_active')
    .eq('id', supplierId).or(`company_id.is.null,company_id.eq.${input.companyId}`).maybeSingle()
  if (supplierResult.error) throw supplierResult.error
  const supplier = supplierResult.data as JsonRecord | null
  const actorId = clean(supplier?.platform_market_actor_id)
  if (!supplier || supplier.is_active !== true || (supplier.company_id != null && supplier.company_id !== input.companyId)
    || !actorId || (input.expectedActorId && input.expectedActorId !== actorId)) return null
  const [actorResult, roleResult, contactResult] = await Promise.all([
    supabaseService.from('platform_market_actors').select('id,status,match_status').eq('id', actorId).maybeSingle(),
    supabaseService.from('platform_actor_roles').select('actor_id,actor_role,is_active').eq('actor_id', actorId).eq('is_active', true).in('actor_role', ['electricity_supplier', 'supplier']),
    supabaseService.from('platform_actor_contacts').select('id,actor_id,contact_type,channel,email,is_verified,verified_at,valid_from,valid_to,source')
      .eq('actor_id', actorId).eq('channel', 'email').eq('is_verified', true).in('contact_type', ['poa', 'customer_service', 'switching', 'general']),
  ])
  if (actorResult.error) throw actorResult.error
  if (roleResult.error) throw roleResult.error
  if (contactResult.error) throw contactResult.error
  if (actorResult.data?.status !== 'active' || actorResult.data?.match_status !== 'verified' || !roleResult.data?.length) return null
  const now = input.now ?? new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const dateValid = (value: unknown, lower: boolean): boolean => {
    if (value == null) return true
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const instant = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value && (lower ? value <= today : value >= today)
  }
  const priorities = ['poa', 'customer_service', 'switching', 'general']
  const contacts = ((contactResult.data ?? []) as JsonRecord[]).filter((row) => row.actor_id === actorId && row.is_verified === true && Boolean(clean(row.verified_at))
    && row.channel === 'email' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(clean(row.email) ?? '')
    && dateValid(row.valid_from, true) && dateValid(row.valid_to, false))
    .sort((a, b) => priorities.indexOf(String(a.contact_type)) - priorities.indexOf(String(b.contact_type)))
  const contact = contacts[0]
  if (!contact || contacts.filter((row) => row.contact_type === contact.contact_type).length !== 1
    || (input.expectedContactId && input.expectedContactId !== contact.id)) return null
  return { email: String(contact.email).trim(), source: clean(contact.source) ?? 'platform_actor_contacts', contactChannelId: String(contact.id), isVerified: true, supplierId, actorId }
}

/** Re-evaluates the complete supplier-specific authority and frozen routing
 * identity at queue time, every provider attempt and every reminder. */
export async function readManualSupplierSendContext(input: {
  companyId: string; request: JsonRecord; now?: Date
}): Promise<{ contact: ManualSupplierContact; poa: JsonRecord } | null> {
  const request = input.request, metadata = record(request.metadata)
  if (request.company_id !== input.companyId || request.request_type !== MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE
    || metadata.target_party !== 'current_supplier' || record(metadata.counterparty_reply).requires_review === true) return null
  if (!['draft', 'ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response'].includes(String(request.status))
    && !isPartialManualSupplierReply(request)) return null
  const customerId = clean(request.customer_id), siteId = clean(request.customer_site_id), cirId = clean(metadata.customer_info_request_id)
  const supplierId = clean(metadata.supplier_id), actorId = clean(metadata.supplier_actor_id), contactId = clean(metadata.supplier_contact_id)
  const documentId = clean(metadata.authorization_document_id)
  if (!customerId || !siteId || !cirId || !supplierId || !actorId || !contactId || !documentId || !clean(request.poa_id)) return null
  const cirResult = await supabaseService.from('customer_info_requests').select('*')
    .eq('company_id', input.companyId).eq('customer_id', customerId).eq('site_id', siteId).eq('id', cirId).maybeSingle()
  if (cirResult.error) throw cirResult.error
  const cir = cirResult.data
  if (!cir || cir.target_party_type !== 'current_supplier' || cir.authorization_document_id !== documentId
    || ['cancelled', 'rejected', 'received', 'completed', 'ready_for_switch'].includes(String(cir.status))) return null
  const authority = await resolveCurrentInfoRequestScopeAuthorization(cir)
  if (!authority.scopes.some((scope) => scope.authorization_document_id === documentId && scope.covers_current_supplier_contract)) return null
  const documentResult = await supabaseService.from('customer_authorization_documents').select('id,company_id,customer_id,site_id,power_of_attorney_id,status')
    .eq('company_id', input.companyId).eq('customer_id', customerId).eq('site_id', siteId).eq('id', documentId).maybeSingle()
  if (documentResult.error) throw documentResult.error
  if (!documentResult.data || documentResult.data.power_of_attorney_id !== request.poa_id || !['active', 'signed'].includes(String(documentResult.data.status))) return null
  const contact = await findCurrentSupplierManualContact({ companyId: input.companyId, customerId, siteId, expectedSupplierId: supplierId, expectedActorId: actorId, expectedContactId: contactId, now: input.now })
  if (!contact) return null
  // Contact lookup awaits several registry reads. Never reuse the authority or
  // POA snapshot from before that IO: either can have been revoked meanwhile.
  const currentAuthority = await resolveCurrentInfoRequestScopeAuthorization(cir)
  const currentScopeIds = currentAuthority.scopes.filter((scope) => scope.authorization_document_id === documentId && scope.covers_current_supplier_contract).map((scope) => scope.id)
  if (!currentScopeIds.length) return null
  const poa = await readPowerOfAttorneyForSend({ companyId: input.companyId, poaId: String(request.poa_id) })
  if (!contact || !poa || poa.customer_id !== customerId || poa.document_id !== documentId
    || (poa.customer_site_id ?? poa.site_id) !== siteId || !manualPoaIsCurrentlyValid(poa, input.now)) return null
  const hasImmutableScopes = Array.isArray(poa.signed_scope_snapshot) && poa.signed_scope_snapshot.length > 0
  const signedScopes = hasImmutableScopes ? poa.signed_scope_snapshot : record(poa.scope_summary).scopes
  if (!Array.isArray(signedScopes) || !powerOfAttorneyCoverageFromScopes(signedScopes.filter((scope): scope is string => typeof scope === 'string')).coversCurrentSupplierContract) return null
  // Check the exact already-validated grants again after the final POA read.
  // This is still a read guard; the outbox DB guard remains the atomic preflight.
  const finalScopeResult = await supabaseService.from('authorization_scopes').select('id,status,revoked_at,valid_from,valid_to,covers_current_supplier_contract')
    .eq('company_id', input.companyId).eq('customer_id', customerId).eq('authorization_document_id', documentId)
    .in('id', currentScopeIds).eq('status', 'active').eq('covers_current_supplier_contract', true).is('revoked_at', null)
  if (finalScopeResult.error) throw finalScopeResult.error
  const today = (input.now ?? new Date()).toISOString().slice(0, 10)
  const currentGrant = ((finalScopeResult.data ?? []) as JsonRecord[]).some((scope) => ['valid_from', 'valid_to'].every((key) => {
    if (scope[key] == null) return true
    if (typeof scope[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(scope[key])) return false
    const date = new Date(`${scope[key]}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === scope[key] && (key === 'valid_from' ? scope[key] <= today : scope[key] >= today)
  }))
  if (!currentGrant) return null
  return { contact, poa }
}
