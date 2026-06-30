import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'

export type CustomerSiteAddressSource =
  | 'tenant_api'
  | 'manual_intake'
  | 'website'
  | 'customer_portal'
  | 'grid_owner_response'
  | 'superadmin'
  | 'import'

export type CustomerSiteAddressInput = {
  street?: unknown
  postalCode?: unknown
  city?: unknown
  country?: unknown
  careOf?: unknown
  apartmentNumber?: unknown
  source: CustomerSiteAddressSource
  sourceReference?: string | null
  actorUserId?: string | null
  claimedGridOwnerId?: string | null
  metadata?: Record<string, unknown>
}

export type CustomerSiteAddressResult = {
  status: 'updated' | 'unchanged' | 'incomplete' | 'conflict'
  siteId: string
  addressHash: string | null
  normalized: string | null
  reason?: string
}

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeSpaces(value: unknown): string | null {
  const text = clean(value)
  return text ? text.replace(/\s+/g, ' ').trim() : null
}

export function normalizeSwedishPostalCode(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function normalisedCountry(value: unknown): string {
  return (clean(value) ?? 'SE').toUpperCase()
}

function normalizedAddress(input: CustomerSiteAddressInput) {
  const street = normalizeSpaces(input.street)
  const postalCode = normalizeSwedishPostalCode(input.postalCode)
  const city = normalizeSpaces(input.city)
  const country = normalisedCountry(input.country)
  const careOf = normalizeSpaces(input.careOf)
  const apartmentNumber = normalizeSpaces(input.apartmentNumber)
  const complete = Boolean(street && postalCode && city && country === 'SE')
  const normalized = complete
    ? [street ?? '', apartmentNumber ?? '', postalCode ?? '', city ?? '', country].map((part) => part.toLocaleLowerCase('sv-SE')).join('|')
    : null
  const hash = normalized ? createHash('sha256').update(normalized).digest('hex') : null
  return { street, postalCode, city, country, careOf, apartmentNumber, complete, normalized, hash }
}

function sourceRank(source: CustomerSiteAddressSource): number {
  switch (source) {
    case 'grid_owner_response': return 70
    case 'superadmin': return 60
    case 'tenant_api': return 50
    case 'manual_intake': return 40
    case 'website': return 30
    case 'customer_portal': return 20
    case 'import': return 10
  }
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist|could not find the function/i.test(row?.message ?? '')
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

async function insertAddressHistory(input: {
  companyId: string
  customerId: string
  siteId: string
  addressHash: string | null
  source: CustomerSiteAddressSource
  sourceReference: string | null
  actorUserId: string | null
  snapshot: JsonRecord
}) {
  const { error } = await supabaseService.from('customer_site_address_history').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.siteId,
    address_hash: input.addressHash,
    source: input.source,
    source_reference: input.sourceReference,
    actor_user_id: input.actorUserId,
    snapshot: input.snapshot,
  })
  if (error && !missingSchema(error)) throw error
}

async function createAddressConflict(input: {
  companyId: string
  customerId: string
  siteId: string
  existing: JsonRecord
  candidate: JsonRecord
  source: CustomerSiteAddressSource
  sourceReference: string | null
}) {
  const dedupeKey = createHash('sha256')
    .update([input.companyId, input.siteId, input.source, JSON.stringify(input.candidate)].join('|'))
    .digest('hex')
  const { error } = await supabaseService.from('customer_site_address_conflicts').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.siteId,
    status: 'open',
    existing_address: input.existing,
    candidate_address: input.candidate,
    candidate_source: input.source,
    candidate_source_reference: input.sourceReference,
    dedupe_key: dedupeKey,
  })
  // Open-address-conflict dedupe is a partial unique index. PostgREST cannot
  // target it through onConflict, so a duplicate is intentionally a no-op.
  if (error && error.code !== '23505' && !missingSchema(error)) throw error
}

export async function applyCustomerSiteAddressCandidate(input: {
  companyId: string
  customerId: string
  siteId: string
  address: CustomerSiteAddressInput
}): Promise<CustomerSiteAddressResult> {
  const address = normalizedAddress(input.address)
  const currentResult = await supabaseService
    .from('customer_sites')
    .select('id,street,postal_code,city,country,care_of,address_hash,address_source,address_verified_at,address_verification_method,metadata')
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (currentResult.error) throw currentResult.error
  if (!currentResult.data?.id) throw new Error('Anläggningen hittades inte för adressuppdatering.')

  const current = currentResult.data as JsonRecord
  const now = new Date().toISOString()
  const sourceReference = clean(input.address.sourceReference)
  const candidateSnapshot = {
    street: address.street,
    postal_code: address.postalCode,
    city: address.city,
    country: address.country,
    care_of: address.careOf,
    apartment_number: address.apartmentNumber,
    address_hash: address.hash,
    source: input.address.source,
    source_reference: sourceReference,
  }

  if (!address.complete || !address.hash || !address.normalized) {
    const incomplete = await supabaseService.from('customer_sites').update({
      address_status: 'incomplete',
      address_quality_status: 'incomplete',
      address_quality_warnings: ['site_address_requires_street_postal_code_city'],
      address_source: input.address.source,
      address_source_reference: sourceReference,
      address_received_at: now,
      updated_at: now,
    }).eq('id', input.siteId).eq('company_id', input.companyId)
    if (incomplete.error) throw incomplete.error
    await insertAddressHistory({ companyId: input.companyId, customerId: input.customerId, siteId: input.siteId, addressHash: null, source: input.address.source, sourceReference, actorUserId: input.address.actorUserId ?? null, snapshot: candidateSnapshot })
    return { status: 'incomplete', siteId: input.siteId, addressHash: null, normalized: null, reason: 'missing_site_address_fields' }
  }

  const currentHash = clean(current.address_hash)
  if (currentHash === address.hash) {
    const unchanged = await supabaseService.from('customer_sites').update({
      address_received_at: now,
      address_source: input.address.source,
      address_source_reference: sourceReference,
      updated_at: now,
    }).eq('id', input.siteId).eq('company_id', input.companyId)
    if (unchanged.error) throw unchanged.error
    return { status: 'unchanged', siteId: input.siteId, addressHash: address.hash, normalized: address.normalized }
  }

  const currentSource = clean(current.address_source) as CustomerSiteAddressSource | null
  const isVerified = Boolean(clean(current.address_verified_at)) || clean(current.address_verification_method) === 'grid_owner_response'
  if (currentHash && isVerified && sourceRank(input.address.source) < sourceRank(currentSource ?? 'import')) {
    await createAddressConflict({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      existing: {
        street: current.street ?? null,
        postal_code: current.postal_code ?? null,
        city: current.city ?? null,
        country: current.country ?? 'SE',
        address_hash: currentHash,
        source: currentSource,
      },
      candidate: candidateSnapshot,
      source: input.address.source,
      sourceReference,
    })
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: input.address.actorUserId ?? null,
      eventType: 'facility.address_conflict',
      title: 'Anläggningsadress behöver granskas',
      message: 'En ny adress skiljer sig från en tidigare verifierad anläggningsadress. Automation pausas tills uppgiften har granskats.',
      payload: { site_id: input.siteId, existing_address_hash: currentHash, candidate_address_hash: address.hash },
      idempotencyKey: `facility.address-conflict:${input.siteId}:${address.hash}`,
    })
    return { status: 'conflict', siteId: input.siteId, addressHash: address.hash, normalized: address.normalized, reason: 'verified_address_conflict' }
  }

  const metadata = {
    ...asRecord(current.metadata),
    claimed_grid_owner_id: clean(input.address.claimedGridOwnerId),
    address_candidate_metadata: input.address.metadata ?? {},
  }
  const atomicCommit = await supabaseService.rpc('gridex_commit_customer_site_address', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_site_id: input.siteId,
    p_street: address.street,
    p_postal_code: address.postalCode,
    p_city: address.city,
    p_country: address.country,
    p_care_of: address.careOf,
    p_apartment_number: address.apartmentNumber,
    p_address_normalized: address.normalized,
    p_address_hash: address.hash,
    p_source: input.address.source,
    p_source_reference: sourceReference,
    p_metadata: metadata,
    p_actor_user_id: input.address.actorUserId ?? null,
  })
  if (atomicCommit.error) {
    if (missingSchema(atomicCommit.error)) {
      throw new Error('Adressflödets atomiska databasfunktion saknas. Kör den senaste OPS-migrationen innan adress eller nätägare kan ändras.')
    }
    throw atomicCommit.error
  }

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    actorUserId: input.address.actorUserId ?? null,
    eventType: input.address.source === 'grid_owner_response' ? 'facility.address_verified' : 'facility.address_received',
    title: input.address.source === 'grid_owner_response' ? 'Anläggningsadress verifierad' : 'Anläggningsadress mottagen',
    message: input.address.source === 'grid_owner_response'
      ? 'Nätägarens svar har verifierat anläggningsadressen. Systemet fortsätter med ny readiness-kontroll.'
      : 'Systemet har tagit emot anläggningsadressen och söker nätägare automatiskt.',
    payload: { site_id: input.siteId, address_hash: address.hash, source: input.address.source },
    idempotencyKey: `facility.address:${input.siteId}:${address.hash}:${input.address.source}`,
  })
  return { status: 'updated', siteId: input.siteId, addressHash: address.hash, normalized: address.normalized }
}

export async function createOrUpdateCustomerSiteFromAddress(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  siteName?: string | null
  facilityId?: string | null
  address: CustomerSiteAddressInput
}): Promise<{ siteId: string; address: CustomerSiteAddressResult }> {
  let siteId = clean(input.siteId)
  if (!siteId) {
    const address = normalizedAddress(input.address)
    if (!address.complete || !address.hash) throw new Error('Anläggningsadress behöver gata, svenskt femsiffrigt postnummer och ort.')
    const existing = await supabaseService
      .from('customer_sites')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('address_hash', address.hash)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (existing.error && !missingSchema(existing.error)) throw existing.error
    siteId = clean(existing.data?.id)
    if (!siteId) {
      const created = await supabaseService.rpc('gridex_create_customer_site_with_address', {
        p_company_id: input.companyId,
        p_customer_id: input.customerId,
        p_site_name: clean(input.siteName) ?? 'Anläggning',
        p_facility_id: clean(input.facilityId),
        p_street: address.street,
        p_postal_code: address.postalCode,
        p_city: address.city,
        p_country: address.country,
        p_address_normalized: address.normalized,
        p_address_hash: address.hash,
        p_source: input.address.source,
        p_metadata: { created_from_address_source: input.address.source },
      })
      if (created.error) {
        if (missingSchema(created.error)) {
          const detail = created.error as { code?: string; message?: string; details?: string; hint?: string }
          const error = new Error('Atomisk anläggningsprovisionering kunde inte köras. Kontrollera att senaste OPS-migrationen är körd och att Supabase/PostgREST schema cache är uppdaterad.')
          ;(error as Error & { code?: string; details?: Record<string, unknown> }).code = 'site_provisioning_function_unavailable'
          ;(error as Error & { code?: string; details?: Record<string, unknown> }).details = {
            db_code: detail?.code ?? null,
            db_message: detail?.message ?? null,
            db_details: detail?.details ?? null,
            db_hint: detail?.hint ?? null,
          }
          throw error
        }
        throw created.error
      }
      siteId = clean(created.data)
      if (!siteId) throw new Error('Atomisk anläggningsprovisionering returnerade inget anläggnings-ID.')
      return {
        siteId,
        address: { status: 'updated', siteId, addressHash: address.hash, normalized: address.normalized },
      }
    }
  }
  const address = await applyCustomerSiteAddressCandidate({ companyId: input.companyId, customerId: input.customerId, siteId, address: input.address })
  return { siteId, address }
}
