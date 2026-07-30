import { emitDomainEvent } from '@/lib/events/domainEvents'
import { createOrUpdateCustomerSiteFromAddress } from '@/lib/customer-sites/addressIntake'
import { enqueueCustomerDataRequestAutomation } from '@/lib/customer-operations/automation'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import { publicReference } from '@/lib/integrations/publicReferences'

type JsonRecord = Record<string, unknown>

type TenantDocumentInput = {
  document_reference?: string
  document_type?: string
  title?: string
  status?: string
  secure_url?: string
  file_name?: string
  mime_type?: string
  file_size_bytes?: number
  storage_key?: string
  storage_path?: string
  storage_bucket?: string
  accepted_at?: string
  metadata?: JsonRecord
}

type TenantLegalAcceptanceInput = {
  document_reference: string
  document_code: string
  document_version: string
  document_hash: string
  accepted: true
  accepted_at: string
  metadata?: JsonRecord
}

type TenantPowerOfAttorneyInput = {
  power_of_attorney_reference?: string
  document_reference: string
  scope: string[]
  accepted: true
  accepted_at: string
  valid_from?: string
  valid_to?: string
  metadata?: JsonRecord
}

type TenantFacilityAddressInput = {
  street?: string
  postal_code?: string
  postalCode?: string
  city?: string
  country?: string
  care_of?: string
  careOf?: string
  apartment_number?: string
  apartmentNumber?: string
}

type TenantFacilityDataInput = {
  facility_reference?: string
  facility_id?: string
  metering_point_id?: string
  meter_point_id?: string
  grid_owner_id?: string
  grid_area_code?: string
  price_area_code?: string
  move_in_date?: string
  requested_start_date?: string
  verified_at?: string
  address?: TenantFacilityAddressInput
  street?: string
  postal_code?: string
  postalCode?: string
  city?: string
  country?: string
  care_of?: string
  apartment_number?: string
  claimed_grid_owner_id?: string
  metadata?: JsonRecord
}

export type TenantCustomerSyncPayload = {
  email?: string
  customer_number?: string
  external_customer_id?: string
  authenticated_user_reference?: string
  profile?: {
    first_name?: string
    last_name?: string
    full_name?: string
    company_name?: string
    phone?: string
    invoice_email?: string
    language_code?: string
    timezone?: string
  }
  documents?: TenantDocumentInput[]
  legal_acceptances?: TenantLegalAcceptanceInput[]
  power_of_attorney?: TenantPowerOfAttorneyInput
  facility_data?: TenantFacilityDataInput[]
  metadata?: JsonRecord
}

type SyncRefs = {
  contractId: string | null
  siteId: string | null
  meteringPointId: string | null
  applicationId: string | null
  legalBundleVersionId: string | null
}

type SyncSummary = {
  documents: { created: number; updated: number; skipped: number }
  legal_acceptances: { created: number; existing: number; skipped: number }
  powers_of_attorney: { created: number; updated: number; skipped: number }
  profile: { updated: boolean; skipped: boolean }
  facility_data: { processed: number; updated: number; metering_point_created: number; skipped: number }
  events: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function normalizeAcceptanceType(value: unknown): 'terms' | 'privacy_policy' | 'withdrawal_info' | 'price_snapshot' | 'power_of_attorney' | null {
  const type = clean(value)?.toLowerCase()
  if (!type) return null
  if (type === 'withdrawal' || type === 'cancellation_right') return 'withdrawal_info'
  if (type === 'price_terms' || type === 'price_snapshot') return 'price_snapshot'
  if (type === 'terms' || type === 'privacy_policy' || type === 'power_of_attorney') return type
  return null
}

function nonNull<T extends JsonRecord>(input: T): JsonRecord {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

async function getLatestRefs(client: IntegrationApiClient, identity: LinkedPortalIdentity): Promise<SyncRefs> {
  let contractId: string | null = null
  let siteId: string | null = null
  let meteringPointId: string | null = null
  let applicationId: string | null = null
  let legalBundleVersionId: string | null = null

  {
    const contract = await supabaseService
      .from('customer_contracts')
      .select('id,customer_site_id,site_id,metering_point_id,website_application_id,legal_bundle_version_id')
      .eq('company_id', client.company_id)
      .eq('customer_id', identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!contract.error && contract.data) {
      contractId = contractId ?? clean(contract.data.id)
      siteId = siteId ?? clean(contract.data.customer_site_id) ?? clean(contract.data.site_id)
      meteringPointId = meteringPointId ?? clean(contract.data.metering_point_id)
      applicationId = applicationId ?? clean(contract.data.website_application_id)
      legalBundleVersionId = clean(contract.data.legal_bundle_version_id)
    } else if (contract.error && !isMissingPortalSchemaError(contract.error)) {
      throw contract.error
    }
  }

  if (!applicationId) {
    const application = await supabaseService
      .from('website_customer_applications')
      .select('id,customer_site_id,metering_point_id,contract_id')
      .eq('company_id', client.company_id)
      .eq('customer_id', identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!application.error && application.data) {
      applicationId = clean(application.data.id)
      contractId = contractId ?? clean(application.data.contract_id)
      siteId = siteId ?? clean(application.data.customer_site_id)
      meteringPointId = meteringPointId ?? clean(application.data.metering_point_id)
    } else if (application.error && !isMissingPortalSchemaError(application.error)) {
      throw application.error
    }
  }

  return { contractId, siteId, meteringPointId, applicationId, legalBundleVersionId }
}

type ResolvedLegalDocument = {
  id: string
  acceptanceType: 'terms' | 'privacy_policy' | 'withdrawal_info' | 'price_snapshot' | 'power_of_attorney'
  legalTextVersionId: string | null
  documentCode: string
  documentVersion: string
  documentHash: string
  title: string | null
}

async function resolveLegalDocument(input: {
  companyId: string
  refs: SyncRefs
  documentReference: string
  expectedCode?: string
  expectedVersion?: string
  expectedHash?: string
}): Promise<ResolvedLegalDocument> {
  if (!input.refs.legalBundleVersionId) throw new Error('LEGAL_BUNDLE_NOT_RESOLVED')
  const result = await supabaseService
    .from('legal_bundle_version_documents')
    .select('id,module_key,legacy_legal_text_version_id,title,content_sha256,template_version')
    .eq('legal_bundle_version_id', input.refs.legalBundleVersionId)
  if (result.error) throw result.error
  const document = (result.data ?? []).find((row) =>
    publicReference('legal_document', input.companyId, row.id) === input.documentReference)
  if (!document) throw new Error('LEGAL_DOCUMENT_REFERENCE_INVALID')

  const documentCode = clean(document.module_key)
  const documentVersion = clean(document.template_version)
  const documentHash = clean(document.content_sha256)?.toLowerCase()
  const acceptanceType = normalizeAcceptanceType(documentCode)
  if (!documentCode || !documentVersion || !documentHash || !acceptanceType) {
    throw new Error('LEGAL_DOCUMENT_NOT_ACCEPTABLE')
  }
  if (
    (input.expectedCode && input.expectedCode !== documentCode) ||
    (input.expectedVersion && input.expectedVersion !== documentVersion) ||
    (input.expectedHash && input.expectedHash.toLowerCase() !== documentHash)
  ) {
    throw new Error('LEGAL_DOCUMENT_EVIDENCE_MISMATCH')
  }
  return {
    id: document.id,
    acceptanceType,
    legalTextVersionId: clean(document.legacy_legal_text_version_id),
    documentCode,
    documentVersion,
    documentHash,
    title: clean(document.title),
  }
}

async function findExistingLegalAcceptance(input: {
  companyId: string
  customerId: string
  contractId: string | null
  documentReference: string
}): Promise<string | null> {
  let query = supabaseService
    .from('customer_legal_acceptances')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .contains('metadata', { document_reference: input.documentReference })
    .limit(1)
  query = input.contractId ? query.eq('contract_id', input.contractId) : query.is('contract_id', null)
  const result = await query.maybeSingle()
  if (!result.error && result.data?.id) return clean(result.data.id)
  if (result.error && !isMissingPortalSchemaError(result.error)) throw result.error
  return null
}

async function syncLegalAcceptance(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  acceptance: TenantLegalAcceptanceInput
  baseMetadata: JsonRecord
}): Promise<'created' | 'existing' | 'skipped'> {
  if (input.acceptance.accepted !== true) return 'skipped'
  const legalDocument = await resolveLegalDocument({
    companyId: input.client.company_id,
    refs: input.refs,
    documentReference: input.acceptance.document_reference,
    expectedCode: input.acceptance.document_code,
    expectedVersion: input.acceptance.document_version,
    expectedHash: input.acceptance.document_hash,
  })
  const contractId = input.refs.contractId
  const existingId = await findExistingLegalAcceptance({
    companyId: input.client.company_id,
    customerId: input.identity.customer_id,
    contractId,
    documentReference: input.acceptance.document_reference,
  })
  if (existingId) return 'existing'

  const payload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: contractId,
    contract_application_id: input.refs.applicationId,
    acceptance_type: legalDocument.acceptanceType,
    legal_text_version_id: legalDocument.legalTextVersionId,
    accepted_at: input.acceptance.accepted_at,
    source: 'customer_portal',
    snapshot: {
      document_code: legalDocument.documentCode,
      document_version: legalDocument.documentVersion,
      document_hash: legalDocument.documentHash,
      document_title: legalDocument.title,
    },
    metadata: {
      ...input.baseMetadata,
      ...asRecord(input.acceptance.metadata),
      document_reference: input.acceptance.document_reference,
      legal_bundle_version_id: input.refs.legalBundleVersionId,
      legal_bundle_document_id: legalDocument.id,
    },
  })

  const result = await supabaseService.from('customer_legal_acceptances').insert(payload).select('id').maybeSingle()
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return 'skipped'
    throw result.error
  }
  return 'created'
}

async function findExistingDocument(input: {
  companyId: string
  customerId: string
  documentReference: string | null
  publicUrl: string | null
}): Promise<string | null> {
  if (input.documentReference) {
    const byExternal = await supabaseService
      .from('customer_documents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .contains('metadata', { document_reference: input.documentReference })
      .limit(1)
      .maybeSingle()
    if (!byExternal.error && byExternal.data?.id) return clean(byExternal.data.id)
    if (byExternal.error && !isMissingPortalSchemaError(byExternal.error)) throw byExternal.error
  }

  if (input.publicUrl) {
    const byUrl = await supabaseService
      .from('customer_documents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('public_url', input.publicUrl)
      .limit(1)
      .maybeSingle()
    if (!byUrl.error && byUrl.data?.id) return clean(byUrl.data.id)
    if (byUrl.error && !isMissingPortalSchemaError(byUrl.error)) throw byUrl.error
  }

  return null
}

async function writeDocument(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  document: TenantDocumentInput
  baseMetadata: JsonRecord
}): Promise<'created' | 'updated' | 'skipped'> {
  const documentType = clean(input.document.document_type) ?? 'customer_document'
  const publicUrl = clean(input.document.secure_url)
  const documentReference = clean(input.document.document_reference)
  const existingId = await findExistingDocument({ companyId: input.client.company_id, customerId: input.identity.customer_id, documentReference, publicUrl })
  const now = new Date().toISOString()
  const metadata = {
    ...input.baseMetadata,
    ...asRecord(input.document.metadata),
    document_reference: documentReference,
  }

  const fullPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: input.refs.contractId,
    customer_site_id: input.refs.siteId,
    metering_point_id: input.refs.meteringPointId,
    document_type: documentType,
    title: clean(input.document.title) ?? documentType,
    status: clean(input.document.status) ?? 'uploaded',
    public_url: publicUrl,
    file_name: clean(input.document.file_name),
    mime_type: clean(input.document.mime_type),
    file_size_bytes: input.document.file_size_bytes,
    source: 'tenant_api',
    source_system: 'tenant_api',
    metadata,
    raw_payload: input.document,
    audit: { received_at: now, api_client_id: input.client.id },
    updated_at: now,
  })

  const fallbackPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    document_type: documentType,
    title: clean(input.document.title) ?? documentType,
    status: clean(input.document.status) ?? 'uploaded',
    public_url: publicUrl,
    file_name: clean(input.document.file_name),
    mime_type: clean(input.document.mime_type),
    file_size_bytes: input.document.file_size_bytes,
    source_system: 'tenant_api',
    raw_payload: { ...input.document, metadata },
    updated_at: now,
  })

  const minimalPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    document_type: documentType,
    title: clean(input.document.title) ?? documentType,
    file_name: clean(input.document.file_name),
    public_url: publicUrl,
    source_system: 'tenant_api',
    raw_payload: { ...input.document, metadata },
    updated_at: now,
  })

  for (const payload of [fullPayload, fallbackPayload, minimalPayload]) {
    const result = existingId
      ? await supabaseService.from('customer_documents').update(payload).eq('id', existingId).eq('company_id', input.client.company_id).select('id').maybeSingle()
      : await supabaseService.from('customer_documents').insert({ ...payload, created_at: now }).select('id').maybeSingle()
    if (!result.error) return existingId ? 'updated' : 'created'
    if (!isMissingPortalSchemaError(result.error)) throw result.error
  }

  return 'skipped'
}

async function findExistingPowerOfAttorney(input: {
  companyId: string
  customerId: string
  reference: string | null
  contractId: string | null
  scope: string
}): Promise<string | null> {
  if (input.reference) {
    const byRef = await supabaseService
      .from('powers_of_attorney')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('reference', input.reference)
      .limit(1)
      .maybeSingle()
    if (!byRef.error && byRef.data?.id) return clean(byRef.data.id)
    if (byRef.error && !isMissingPortalSchemaError(byRef.error)) throw byRef.error
  }

  let query = supabaseService
    .from('powers_of_attorney')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('scope', input.scope)
    .limit(1)
  query = input.contractId ? query.eq('contract_id', input.contractId) : query.is('contract_id', null)
  const result = await query.maybeSingle()
  if (!result.error && result.data?.id) return clean(result.data.id)
  if (result.error && !isMissingPortalSchemaError(result.error)) throw result.error
  return null
}

async function writePowerOfAttorney(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  poa: TenantPowerOfAttorneyInput
  baseMetadata: JsonRecord
}): Promise<'created' | 'updated' | 'skipped'> {
  if (input.poa.accepted !== true) return 'skipped'
  const scope = input.poa.scope.join(',')
  const contractId = input.refs.contractId
  const siteId = input.refs.siteId
  const meteringPointId = input.refs.meteringPointId
  const reference = clean(input.poa.power_of_attorney_reference)
  const legalDocument = await resolveLegalDocument({
    companyId: input.client.company_id,
    refs: input.refs,
    documentReference: input.poa.document_reference,
  })
  if (legalDocument.acceptanceType !== 'power_of_attorney') {
    throw new Error('POWER_OF_ATTORNEY_DOCUMENT_REQUIRED')
  }
  const acceptedAt = input.poa.accepted_at
  const status = 'signed'
  const now = new Date().toISOString()
  const existingId = await findExistingPowerOfAttorney({ companyId: input.client.company_id, customerId: input.identity.customer_id, reference, contractId, scope })
  const metadata = {
    ...input.baseMetadata,
    ...asRecord(input.poa.metadata),
    contract_application_id: input.refs.applicationId,
    document_reference: input.poa.document_reference,
    legal_bundle_document_id: legalDocument.id,
    external_customer_id: input.identity.external_customer_id,
  }

  const fullPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: contractId,
    customer_site_id: siteId,
    site_id: siteId,
    metering_point_id: meteringPointId,
    scope,
    status,
    signed_at: acceptedAt,
    accepted_at: acceptedAt,
    valid_from: clean(input.poa.valid_from) ?? acceptedAt.slice(0, 10),
    valid_to: clean(input.poa.valid_to),
    legal_text_version_id: legalDocument.legalTextVersionId,
    fullmakt_snapshot: {
      ...asRecord(input.poa.metadata),
      document_reference: input.poa.document_reference,
      document_code: legalDocument.documentCode,
      document_version: legalDocument.documentVersion,
      document_hash: legalDocument.documentHash,
    },
    accepted_source: 'customer_portal',
    reference,
    scope_summary: {
      scopes: input.poa.scope,
      contract_id: contractId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
    },
    metadata,
    updated_at: now,
  })

  const fallbackPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    site_id: siteId,
    metering_point_id: meteringPointId,
    scope,
    status,
    signed_at: acceptedAt,
    valid_from: clean(input.poa.valid_from) ?? acceptedAt.slice(0, 10),
    valid_to: clean(input.poa.valid_to),
    reference,
    metadata,
    updated_at: now,
  })

  for (const payload of [fullPayload, fallbackPayload]) {
    const result = existingId
      ? await supabaseService.from('powers_of_attorney').update(payload).eq('id', existingId).eq('company_id', input.client.company_id).select('id').maybeSingle()
      : await supabaseService.from('powers_of_attorney').insert({ ...payload, created_at: now }).select('id').maybeSingle()
    if (!result.error) return existingId ? 'updated' : 'created'
    if (!isMissingPortalSchemaError(result.error)) {
      if (result.error.code === '23514' && payload.status === status) {
        const retry = { ...payload, status: 'draft', metadata: { ...metadata, desired_status: status, status_constraint_retry: true } }
        const retryResult = existingId
          ? await supabaseService.from('powers_of_attorney').update(retry).eq('id', existingId).eq('company_id', input.client.company_id).select('id').maybeSingle()
          : await supabaseService.from('powers_of_attorney').insert({ ...retry, created_at: now }).select('id').maybeSingle()
        if (!retryResult.error) return existingId ? 'updated' : 'created'
      }
      throw result.error
    }
  }

  return 'skipped'
}

async function syncFacilityData(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  facility: TenantFacilityDataInput | undefined
  baseMetadata: JsonRecord
}): Promise<{ updated: boolean; metering_point_created: boolean; skipped: boolean }> {
  const facility = input.facility
  if (!facility) return { updated: false, metering_point_created: false, skipped: true }

  const facilityId = clean(facility.facility_id)
  const meteringPointId = clean(facility.metering_point_id) ?? clean(facility.meter_point_id)
  const facilityReference = clean(facility.facility_reference)
  let requestedSiteId = input.refs.siteId
  if (facilityReference) {
    const siteResult = await supabaseService
      .from('customer_sites')
      .select('id')
      .eq('company_id', input.client.company_id)
      .eq('customer_id', input.identity.customer_id)
      .eq('facility_reference', facilityReference)
      .limit(1)
      .maybeSingle()
    if (siteResult.error) throw siteResult.error
    if (!siteResult.data?.id) throw new Error('FACILITY_REFERENCE_NOT_FOUND')
    requestedSiteId = siteResult.data.id
  }
  const address = asRecord(facility.address)
  const addressStreet = clean(address.street) ?? clean(facility.street)
  const addressPostalCode = clean(address.postal_code) ?? clean(address.postalCode) ?? clean(facility.postal_code) ?? clean(facility.postalCode)
  const addressCity = clean(address.city) ?? clean(facility.city)
  const addressCountry = clean(address.country) ?? clean(facility.country) ?? 'SE'
  const careOf = clean(address.care_of) ?? clean(address.careOf) ?? clean(facility.care_of)
  const apartmentNumber = clean(address.apartment_number) ?? clean(address.apartmentNumber) ?? clean(facility.apartment_number)
  const hasAddressPayload = Boolean(addressStreet || addressPostalCode || addressCity)

  if (!requestedSiteId && !hasAddressPayload && !facilityId && !meteringPointId) {
    return { updated: false, metering_point_created: false, skipped: true }
  }

  const site = hasAddressPayload
    ? await createOrUpdateCustomerSiteFromAddress({
        companyId: input.client.company_id,
        customerId: input.identity.customer_id,
        siteId: requestedSiteId,
        facilityId,
        address: {
          street: addressStreet,
          postalCode: addressPostalCode,
          city: addressCity,
          country: addressCountry,
          careOf,
          apartmentNumber,
          source: 'tenant_api',
          sourceReference: input.identity.external_customer_id ?? input.identity.customer_number,
          claimedGridOwnerId: clean(facility.claimed_grid_owner_id) ?? clean(facility.grid_owner_id),
          metadata: { ...input.baseMetadata, ...asRecord(facility.metadata), supplied_verified_at: clean(facility.verified_at) },
        },
      })
    : requestedSiteId
      ? { siteId: requestedSiteId, address: null }
      : null

  if (!site?.siteId) return { updated: false, metering_point_created: false, skipped: true }
  const siteId = site.siteId
  const now = new Date().toISOString()

  // Tenant-provided grid-owner/grid-area/verification values are hints only.
  // They never set operational route readiness or verified facility state.
  const sitePayload = nonNull({
    facility_id: facilityId,
    move_in_date: clean(facility.move_in_date),
    metadata: {
      ...input.baseMetadata,
      ...asRecord(facility.metadata),
      facility_synced_at: now,
      claimed_grid_owner_id: clean(facility.claimed_grid_owner_id) ?? clean(facility.grid_owner_id),
      claimed_grid_area_code: clean(facility.grid_area_code),
      claimed_price_area_code: clean(facility.price_area_code),
      supplied_verified_at: clean(facility.verified_at),
    },
    facility_data_status: 'unverified',
    updated_at: now,
  })

  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update(sitePayload)
    .eq('company_id', input.client.company_id)
    .eq('customer_id', input.identity.customer_id)
    .eq('id', siteId)
    .select('id')
    .maybeSingle()
  if (siteUpdate.error && !isMissingPortalSchemaError(siteUpdate.error)) throw siteUpdate.error

  let created = false
  if (meteringPointId) {
    const existing = await supabaseService
      .from('metering_points')
      .select('id')
      .eq('company_id', input.client.company_id)
      .eq('customer_id', input.identity.customer_id)
      .eq('site_id', siteId)
      .eq('metering_point_id', meteringPointId)
      .limit(1)
      .maybeSingle()
    if (existing.error && !isMissingPortalSchemaError(existing.error)) throw existing.error

    const mpPayload = nonNull({
      company_id: input.client.company_id,
      customer_id: input.identity.customer_id,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      meter_point_id: meteringPointId,
      site_facility_id: facilityId,
      status: 'pending_verification',
      verification_status: 'pending_verification',
      metadata: {
        ...input.baseMetadata,
        ...asRecord(facility.metadata),
        source: 'tenant_api',
        claimed_grid_owner_id: clean(facility.claimed_grid_owner_id) ?? clean(facility.grid_owner_id),
        claimed_grid_area_code: clean(facility.grid_area_code),
        claimed_price_area_code: clean(facility.price_area_code),
      },
      updated_at: now,
    })
    const write = existing.data?.id
      ? await supabaseService.from('metering_points').update(mpPayload).eq('id', existing.data.id).eq('company_id', input.client.company_id)
      : await supabaseService.from('metering_points').insert(mpPayload).select('id').maybeSingle()
    if (write.error && !isMissingPortalSchemaError(write.error)) throw write.error
    created = Boolean(!existing.data?.id && (write.data as { id?: string } | null)?.id)
  }

  if (input.refs.applicationId) {
    const applicationUpdate = await supabaseService
      .from('website_customer_applications')
      .update({
        customer_site_id: siteId,
        metering_point_id: meteringPointId ?? input.refs.meteringPointId,
        status: hasAddressPayload ? 'needs_address_resolution' : undefined,
        updated_at: now,
      })
      .eq('company_id', input.client.company_id)
      .eq('id', input.refs.applicationId)
    if (applicationUpdate.error && !isMissingPortalSchemaError(applicationUpdate.error)) throw applicationUpdate.error
  }

  if (hasAddressPayload && site.address?.status !== 'conflict' && site.address?.status !== 'incomplete') {
    await enqueueCustomerDataRequestAutomation({
      companyId: input.client.company_id,
      customerId: input.identity.customer_id,
      siteId,
      meteringPointId: null,
    })
  }

  return { updated: Boolean(siteUpdate.data?.id) || Boolean(site.address), metering_point_created: created, skipped: false }
}

async function syncCustomerProfile(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  profile: TenantCustomerSyncPayload['profile']
}): Promise<{ updated: boolean; skipped: boolean }> {
  if (!input.profile || Object.keys(input.profile).length === 0) {
    return { updated: false, skipped: true }
  }
  const existing = await supabaseService
    .from('customers')
    .select('metadata')
    .eq('company_id', input.client.company_id)
    .eq('id', input.identity.customer_id)
    .maybeSingle()
  if (existing.error) throw existing.error
  const payload = nonNull({
    first_name: clean(input.profile.first_name),
    last_name: clean(input.profile.last_name),
    full_name: clean(input.profile.full_name),
    company_name: clean(input.profile.company_name),
    phone: clean(input.profile.phone),
    invoice_email: clean(input.profile.invoice_email),
    preferred_language: clean(input.profile.language_code),
    metadata: input.profile.timezone
      ? { ...asRecord(existing.data?.metadata), portal_timezone: input.profile.timezone }
      : undefined,
    updated_at: new Date().toISOString(),
  })
  const result = await supabaseService
    .from('customers')
    .update(payload)
    .eq('company_id', input.client.company_id)
    .eq('id', input.identity.customer_id)
    .select('id')
    .maybeSingle()
  if (result.error) throw result.error
  return { updated: Boolean(result.data?.id), skipped: false }
}

async function emitSyncEvent(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  type: string
  refs: SyncRefs
  payload?: JsonRecord
  events: string[]
}) {
  await emitDomainEvent({
    companyId: input.client.company_id,
    eventType: input.type,
    aggregateType: 'customer',
    aggregateId: input.identity.customer_id,
    subjectCustomerId: input.identity.customer_id,
    source: 'tenant_customer_sync_api',
    idempotencyKey: `tenant-sync:${input.client.id}:${input.identity.customer_id}:${input.type}:${input.refs.applicationId ?? input.refs.contractId ?? 'customer'}`,
    payload: {
      customer_id: input.identity.customer_id,
      customer_number: input.identity.customer_number,
      external_customer_id: input.identity.external_customer_id,
      contract_id: input.refs.contractId,
      customer_site_id: input.refs.siteId,
      metering_point_id: input.refs.meteringPointId,
      ...(input.payload ?? {}),
    },
  })
  input.events.push(input.type)
}

export async function syncTenantCustomerRecords(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  payload: TenantCustomerSyncPayload
}) {
  const refs = await getLatestRefs(input.client, input.identity)
  const summary: SyncSummary = {
    documents: { created: 0, updated: 0, skipped: 0 },
    legal_acceptances: { created: 0, existing: 0, skipped: 0 },
    powers_of_attorney: { created: 0, updated: 0, skipped: 0 },
    profile: { updated: false, skipped: true },
    facility_data: { processed: 0, updated: 0, metering_point_created: 0, skipped: 0 },
    events: [],
  }
  const baseMetadata = {
    source: 'tenant_api',
    api_client_id: input.client.id,
    external_customer_id: input.identity.external_customer_id ?? clean(input.payload.external_customer_id),
    customer_number: input.identity.customer_number ?? clean(input.payload.customer_number),
    synced_at: new Date().toISOString(),
    ...(input.payload.metadata ?? {}),
  }

  summary.profile = await syncCustomerProfile({
    client: input.client,
    identity: input.identity,
    profile: input.payload.profile,
  })

  const acceptances = Array.isArray(input.payload.legal_acceptances) ? input.payload.legal_acceptances : []
  for (const acceptance of acceptances) {
    const result = await syncLegalAcceptance({ client: input.client, identity: input.identity, refs, acceptance, baseMetadata })
    summary.legal_acceptances[result === 'created' ? 'created' : result === 'existing' ? 'existing' : 'skipped']++
  }

  if (input.payload.power_of_attorney) {
    const poa = input.payload.power_of_attorney
    const poaResult = await writePowerOfAttorney({ client: input.client, identity: input.identity, refs, poa, baseMetadata })
    summary.powers_of_attorney[poaResult === 'created' ? 'created' : poaResult === 'updated' ? 'updated' : 'skipped']++
    if (poaResult !== 'skipped') {
      await emitSyncEvent({ client: input.client, identity: input.identity, type: 'power_of_attorney.signed', refs, events: summary.events })
    }
  }

  const documents = Array.isArray(input.payload.documents) ? input.payload.documents : []
  for (const document of documents) {
    const result = await writeDocument({ client: input.client, identity: input.identity, refs, document, baseMetadata })
    summary.documents[result === 'created' ? 'created' : result === 'updated' ? 'updated' : 'skipped']++
    if (result !== 'skipped') {
      await emitSyncEvent({ client: input.client, identity: input.identity, type: 'document.created', refs, events: summary.events, payload: { document_type: document.document_type ?? 'customer_document' } })
    }
  }

  for (const facility of input.payload.facility_data ?? []) {
    const facilityResult = await syncFacilityData({ client: input.client, identity: input.identity, refs, facility, baseMetadata })
    summary.facility_data.processed += 1
    if (facilityResult.updated) summary.facility_data.updated += 1
    if (facilityResult.metering_point_created) summary.facility_data.metering_point_created += 1
    if (facilityResult.skipped) summary.facility_data.skipped += 1
    if (!facilityResult.skipped) {
      await emitSyncEvent({
        client: input.client,
        identity: input.identity,
        type: facilityResult.metering_point_created ? 'facility_data.verified' : 'facility_data.received',
        refs,
        events: summary.events,
      })
    }
  }

  if (!refs.meteringPointId && !(input.payload.facility_data ?? []).some((item) => item.metering_point_id)) {
    await emitSyncEvent({ client: input.client, identity: input.identity, type: 'contract.needs_facility_data', refs, events: summary.events })
  }

  return {
    customer_id: input.identity.customer_id,
    customer_number: input.identity.customer_number,
    external_customer_id: input.identity.external_customer_id,
    refs,
    summary,
  }
}
