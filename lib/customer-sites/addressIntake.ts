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
  return ['42P01', '42703', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
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
  const { error } = await supabaseService.from('customer_site_address_conflicts').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.siteId,
    status: 'open',
    existing_address: input.existing,
    candidate_address: input.candidate,
    candidate_source: input.source,
    candidate_source_reference: input.sourceReference,
  })
  if (error && !missingSchema(error)) throw error
}

async function syncFacilityAddressRecord(input: {
  companyId: string
  customerId: string
  siteId: string
  street: string
  careOf: string | null
  postalCode: string
  city: string
  country: string
  source: CustomerSiteAddressSource
  addressHash: string
}) {
  const existing = await supabaseService
    .from('customer_addresses')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('type', 'facility')
    .contains('metadata', { customer_site_id: input.siteId })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing.error && !missingSchema(existing.error)) throw existing.error

  const payload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    type: 'facility',
    street_1: input.street,
    street_2: input.careOf,
    postal_code: input.postalCode,
    city: input.city,
    country: input.country,
    is_active: true,
    metadata: { customer_site_id: input.siteId, address_hash: input.addressHash, source: input.source },
    updated_at: new Date().toISOString(),
  }
  const result = existing.data?.id
    ? await supabaseService.from('customer_addresses').update(payload).eq('id', existing.data.id)
    : await supabaseService.from('customer_addresses').insert(payload)
  if (result.error && !missingSchema(result.error)) throw result.error
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
  if (currentHash && currentHash !== address.hash) {
    const cancelJobs = await supabaseService
      .from('customer_operation_jobs')
      .update({
        status: 'cancelled',
        last_error: 'Anläggningsadressen ändrades innan automationen var klar.',
        completed_at: now,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('customer_site_id', input.siteId)
      .in('status', ['queued', 'running'])
    if (cancelJobs.error && !missingSchema(cancelJobs.error)) throw cancelJobs.error

    const pauseRequests = await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_reason: 'Anläggningsadressen har ändrats efter att begäran skapades. Kontrollera adress och starta om automatiken.',
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('site_id', input.siteId)
      .in('status', ['draft', 'ready_to_send', 'z01_prepared', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'])
    if (pauseRequests.error && !missingSchema(pauseRequests.error)) throw pauseRequests.error
  }

  const patch: JsonRecord = {
    street: address.street,
    postal_code: address.postalCode,
    city: address.city,
    country: address.country,
    care_of: address.careOf,
    apartment_number: address.apartmentNumber,
    address_normalized: address.normalized,
    address_hash: address.hash,
    address_source: input.address.source,
    address_source_reference: sourceReference,
    address_received_at: now,
    address_verified_at: input.address.source === 'grid_owner_response' ? now : null,
    address_verification_method: input.address.source === 'grid_owner_response' ? 'grid_owner_response' : null,
    address_confidence: input.address.source === 'grid_owner_response' ? 1 : null,
    address_status: input.address.source === 'grid_owner_response' ? 'verified' : 'candidate',
    address_quality_status: 'complete',
    address_quality_warnings: [],
    grid_owner_id: null,
    grid_area_code: null,
    price_area_code: null,
    resolution_id: null,
    resolution_status: 'address_changed',
    resolution_confidence: null,
    facility_data_status: input.address.source === 'grid_owner_response' ? 'verified' : 'unverified',
    metadata,
    updated_at: now,
  }
  const update = await supabaseService.from('customer_sites').update(patch).eq('id', input.siteId).eq('company_id', input.companyId)
  if (update.error) throw update.error

  const meterReset = await supabaseService
    .from('metering_points')
    .update({ grid_owner_id: null, grid_area_code: null, price_area_code: null, verification_status: 'pending_verification', updated_at: now })
    .eq('company_id', input.companyId)
    .eq('site_id', input.siteId)
    .neq('status', 'closed')
  if (meterReset.error && !missingSchema(meterReset.error)) throw meterReset.error

  await syncFacilityAddressRecord({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    street: address.street as string,
    careOf: address.careOf,
    postalCode: address.postalCode as string,
    city: address.city as string,
    country: address.country,
    source: input.address.source,
    addressHash: address.hash,
  })
  await insertAddressHistory({ companyId: input.companyId, customerId: input.customerId, siteId: input.siteId, addressHash: address.hash, source: input.address.source, sourceReference, actorUserId: input.address.actorUserId ?? null, snapshot: candidateSnapshot })
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
      const inserted = await supabaseService.from('customer_sites').insert({
        company_id: input.companyId,
        customer_id: input.customerId,
        site_name: clean(input.siteName) ?? 'Anläggning',
        facility_id: clean(input.facilityId),
        site_type: 'consumption',
        status: 'draft',
        is_active: true,
        address_status: 'candidate',
        facility_data_status: 'unverified',
        metadata: { created_from_address_source: input.address.source },
      }).select('id').single()
      if (inserted.error) throw inserted.error
      siteId = String(inserted.data.id)
    }
  }
  const address = await applyCustomerSiteAddressCandidate({ companyId: input.companyId, customerId: input.customerId, siteId, address: input.address })
  return { siteId, address }
}
