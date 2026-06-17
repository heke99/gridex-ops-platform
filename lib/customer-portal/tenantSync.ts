import { emitDomainEvent } from '@/lib/events/domainEvents'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'

type JsonRecord = Record<string, unknown>

type TenantDocumentInput = {
  external_document_id?: string
  document_type?: string
  title?: string
  status?: string
  file_url?: string
  public_url?: string
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
  external_acceptance_id?: string
  acceptance_type?: string
  legal_text_version_id?: string
  legal_text_version?: string
  version?: string
  contract_id?: string
  contract_application_id?: string
  accepted_at?: string
  accepted_ip?: string
  accepted_ip_hash?: string
  accepted_user_agent?: string
  source?: string
  snapshot?: JsonRecord
  metadata?: JsonRecord
}

type TenantPowerOfAttorneyInput = {
  scope?: string
  status?: string
  signed_at?: string
  accepted_at?: string
  valid_from?: string
  valid_to?: string
  reference?: string
  legal_text_version_id?: string
  legal_text_version?: string
  version?: string
  contract_id?: string
  customer_site_id?: string
  site_id?: string
  metering_point_id?: string
  accepted_ip?: string
  accepted_ip_hash?: string
  accepted_user_agent?: string
  document?: TenantDocumentInput
  metadata?: JsonRecord
}

type TenantFacilityDataInput = {
  facility_id?: string
  metering_point_id?: string
  meter_point_id?: string
  grid_owner_id?: string
  grid_area_code?: string
  price_area_code?: string
  customer_site_id?: string
  site_id?: string
  move_in_date?: string
  requested_start_date?: string
  verified_at?: string
  metadata?: JsonRecord
}

export type TenantCustomerSyncPayload = {
  email?: string
  customer_number?: string
  external_customer_id?: string
  contract_id?: string
  customer_site_id?: string
  site_id?: string
  metering_point_id?: string
  contract_application_id?: string
  application_id?: string
  documents?: TenantDocumentInput[]
  legal_acceptances?: TenantLegalAcceptanceInput[]
  power_of_attorney?: TenantPowerOfAttorneyInput
  facility_data?: TenantFacilityDataInput
  metadata?: JsonRecord
}

type SyncRefs = {
  contractId: string | null
  siteId: string | null
  meteringPointId: string | null
  applicationId: string | null
}

type SyncSummary = {
  documents: { created: number; updated: number; skipped: number }
  legal_acceptances: { created: number; existing: number; skipped: number }
  powers_of_attorney: { created: number; updated: number; skipped: number }
  facility_data: { updated: boolean; metering_point_created: boolean; skipped: boolean }
  events: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function toIso(value: unknown): string {
  const raw = clean(value)
  if (!raw) return new Date().toISOString()
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

function normalizeAcceptanceType(value: unknown): 'terms' | 'privacy_policy' | 'withdrawal_info' | 'price_snapshot' | 'power_of_attorney' | null {
  const type = clean(value)?.toLowerCase()
  if (!type) return null
  if (type === 'withdrawal' || type === 'cancellation_right') return 'withdrawal_info'
  if (type === 'price_terms' || type === 'price_snapshot') return 'price_snapshot'
  if (type === 'terms' || type === 'privacy_policy' || type === 'power_of_attorney') return type
  return null
}

function legalVersionType(acceptanceType: string): string {
  if (acceptanceType === 'withdrawal_info') return 'withdrawal'
  if (acceptanceType === 'price_snapshot') return 'price_terms'
  return acceptanceType
}

function nonNull<T extends JsonRecord>(input: T): JsonRecord {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

async function getLatestRefs(client: IntegrationApiClient, identity: LinkedPortalIdentity, payload: TenantCustomerSyncPayload): Promise<SyncRefs> {
  const explicitContractId = clean(payload.contract_id)
  const explicitSiteId = clean(payload.customer_site_id) ?? clean(payload.site_id)
  const explicitMeteringPointId = clean(payload.metering_point_id)
  const explicitApplicationId = clean(payload.contract_application_id) ?? clean(payload.application_id)

  let contractId = explicitContractId
  let siteId = explicitSiteId
  let meteringPointId = explicitMeteringPointId
  let applicationId = explicitApplicationId

  if (!contractId || !siteId || !meteringPointId) {
    const contract = await supabaseService
      .from('customer_contracts')
      .select('id,customer_site_id,site_id,metering_point_id,website_application_id')
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

  return { contractId, siteId, meteringPointId, applicationId }
}

async function resolveLegalTextVersionId(companyId: string, acceptanceType: string, input: TenantLegalAcceptanceInput | TenantPowerOfAttorneyInput): Promise<string | null> {
  const direct = clean(input.legal_text_version_id)
  if (isUuid(direct)) return direct

  const version = clean(input.legal_text_version) ?? clean(input.version)
  if (!version) return null

  const result = await supabaseService
    .from('legal_text_versions')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', legalVersionType(acceptanceType))
    .eq('version', version)
    .limit(1)
    .maybeSingle()

  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return null
    throw result.error
  }
  return clean(result.data?.id)
}

async function findExistingLegalAcceptance(input: {
  companyId: string
  customerId: string
  contractId: string | null
  acceptanceType: string
  legalTextVersionId: string | null
  externalAcceptanceId: string | null
}): Promise<string | null> {
  if (input.externalAcceptanceId) {
    const byExternal = await supabaseService
      .from('customer_legal_acceptances')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .contains('metadata', { external_acceptance_id: input.externalAcceptanceId })
      .limit(1)
      .maybeSingle()
    if (!byExternal.error && byExternal.data?.id) return clean(byExternal.data.id)
    if (byExternal.error && !isMissingPortalSchemaError(byExternal.error)) throw byExternal.error
  }

  let query = supabaseService
    .from('customer_legal_acceptances')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('acceptance_type', input.acceptanceType)
    .limit(1)

  query = input.contractId ? query.eq('contract_id', input.contractId) : query.is('contract_id', null)
  query = input.legalTextVersionId ? query.eq('legal_text_version_id', input.legalTextVersionId) : query.is('legal_text_version_id', null)

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
  const acceptanceType = normalizeAcceptanceType(input.acceptance.acceptance_type)
  if (!acceptanceType) return 'skipped'

  const legalTextVersionId = await resolveLegalTextVersionId(input.client.company_id, acceptanceType, input.acceptance)
  const contractId = clean(input.acceptance.contract_id) ?? input.refs.contractId
  const externalAcceptanceId = clean(input.acceptance.external_acceptance_id)
  const existingId = await findExistingLegalAcceptance({
    companyId: input.client.company_id,
    customerId: input.identity.customer_id,
    contractId,
    acceptanceType,
    legalTextVersionId,
    externalAcceptanceId,
  })
  if (existingId) return 'existing'

  const payload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: contractId,
    contract_application_id: clean(input.acceptance.contract_application_id) ?? input.refs.applicationId,
    acceptance_type: acceptanceType,
    legal_text_version_id: legalTextVersionId,
    accepted_at: toIso(input.acceptance.accepted_at),
    accepted_ip: clean(input.acceptance.accepted_ip),
    accepted_ip_hash: clean(input.acceptance.accepted_ip_hash),
    accepted_user_agent: clean(input.acceptance.accepted_user_agent),
    source: clean(input.acceptance.source) ?? 'website',
    snapshot: asRecord(input.acceptance.snapshot),
    metadata: {
      ...input.baseMetadata,
      ...asRecord(input.acceptance.metadata),
      external_acceptance_id: externalAcceptanceId,
      legal_text_version: clean(input.acceptance.legal_text_version) ?? clean(input.acceptance.version),
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
  externalDocumentId: string | null
  publicUrl: string | null
}): Promise<string | null> {
  if (input.externalDocumentId) {
    const byExternal = await supabaseService
      .from('customer_documents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .contains('metadata', { external_document_id: input.externalDocumentId })
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
  const publicUrl = clean(input.document.file_url) ?? clean(input.document.public_url)
  const externalDocumentId = clean(input.document.external_document_id)
  const existingId = await findExistingDocument({ companyId: input.client.company_id, customerId: input.identity.customer_id, externalDocumentId, publicUrl })
  const now = new Date().toISOString()
  const metadata = {
    ...input.baseMetadata,
    ...asRecord(input.document.metadata),
    external_document_id: externalDocumentId,
    accepted_at: clean(input.document.accepted_at),
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
    storage_key: clean(input.document.storage_key) ?? clean(input.document.storage_path),
    storage_bucket: clean(input.document.storage_bucket),
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
  const scope = clean(input.poa.scope) ?? 'supplier_switch'
  const contractId = clean(input.poa.contract_id) ?? input.refs.contractId
  const siteId = clean(input.poa.customer_site_id) ?? clean(input.poa.site_id) ?? input.refs.siteId
  const meteringPointId = clean(input.poa.metering_point_id) ?? input.refs.meteringPointId
  const reference = clean(input.poa.reference) ?? (input.refs.applicationId ? `POA-${input.refs.applicationId}` : null)
  const acceptanceType = 'power_of_attorney'
  const legalTextVersionId = await resolveLegalTextVersionId(input.client.company_id, acceptanceType, input.poa)
  const acceptedAt = toIso(input.poa.accepted_at ?? input.poa.signed_at)
  const status = clean(input.poa.status) ?? 'signed'
  const now = new Date().toISOString()
  const existingId = await findExistingPowerOfAttorney({ companyId: input.client.company_id, customerId: input.identity.customer_id, reference, contractId, scope })
  const metadata = {
    ...input.baseMetadata,
    ...asRecord(input.poa.metadata),
    contract_application_id: input.refs.applicationId,
    legal_text_version: clean(input.poa.legal_text_version),
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
    signed_at: toIso(input.poa.signed_at ?? input.poa.accepted_at),
    accepted_at: acceptedAt,
    valid_from: clean(input.poa.valid_from) ?? acceptedAt.slice(0, 10),
    valid_to: clean(input.poa.valid_to),
    legal_text_version_id: legalTextVersionId,
    fullmakt_snapshot: { ...asRecord(input.poa.metadata), document: input.poa.document ?? null },
    accepted_ip: clean(input.poa.accepted_ip),
    accepted_ip_hash: clean(input.poa.accepted_ip_hash),
    accepted_user_agent: clean(input.poa.accepted_user_agent),
    accepted_source: 'website',
    reference,
    scope_summary: {
      [scope]: true,
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
    signed_at: toIso(input.poa.signed_at ?? input.poa.accepted_at),
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
      if (result.error.code === '23514' && payload.status === status && status !== 'draft') {
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
  const siteId = clean(facility.customer_site_id) ?? clean(facility.site_id) ?? input.refs.siteId
  if (!siteId || (!facilityId && !meteringPointId && !clean(facility.grid_owner_id) && !clean(facility.grid_area_code))) {
    return { updated: false, metering_point_created: false, skipped: true }
  }

  const sitePayload = nonNull({
    facility_id: facilityId,
    grid_owner_id: clean(facility.grid_owner_id),
    grid_area_code: clean(facility.grid_area_code),
    price_area_code: clean(facility.price_area_code),
    move_in_date: clean(facility.move_in_date),
    resolution_status: clean(facility.verified_at) ? 'verified' : undefined,
    metadata: { ...input.baseMetadata, ...asRecord(facility.metadata), facility_synced_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  })

  let updated = false
  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update(sitePayload)
    .eq('company_id', input.client.company_id)
    .eq('customer_id', input.identity.customer_id)
    .eq('id', siteId)
    .select('id')
    .maybeSingle()
  if (!siteUpdate.error) updated = Boolean(siteUpdate.data?.id)
  else if (!isMissingPortalSchemaError(siteUpdate.error)) throw siteUpdate.error

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

    if (!existing.data?.id) {
      const mpPayload = nonNull({
        company_id: input.client.company_id,
        customer_id: input.identity.customer_id,
        site_id: siteId,
        customer_site_id: siteId,
        metering_point_id: meteringPointId,
        meter_point_id: meteringPointId,
        site_facility_id: facilityId,
        grid_owner_id: clean(facility.grid_owner_id),
        grid_area_code: clean(facility.grid_area_code),
        price_area_code: clean(facility.price_area_code),
        status: clean(facility.verified_at) ? 'verified' : 'pending_verification',
        metadata: { ...input.baseMetadata, ...asRecord(facility.metadata), source: 'tenant_api' },
      })
      const inserted = await supabaseService.from('metering_points').insert(mpPayload).select('id').maybeSingle()
      if (!inserted.error) created = Boolean(inserted.data?.id)
      else if (!isMissingPortalSchemaError(inserted.error)) throw inserted.error
    }
  }

  if ((facilityId || meteringPointId) && input.refs.applicationId) {
    const applicationUpdate = await supabaseService
      .from('website_customer_applications')
      .update(nonNull({
        metering_point_id: meteringPointId ?? input.refs.meteringPointId,
        customer_site_id: siteId,
        facility_data_verified_at: clean(facility.verified_at) ?? (meteringPointId ? new Date().toISOString() : undefined),
        status: meteringPointId ? 'facility_data_received' : undefined,
        updated_at: new Date().toISOString(),
      }))
      .eq('company_id', input.client.company_id)
      .eq('id', input.refs.applicationId)
    if (applicationUpdate.error && !isMissingPortalSchemaError(applicationUpdate.error)) throw applicationUpdate.error
  }

  return { updated, metering_point_created: created, skipped: false }
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
  const refs = await getLatestRefs(input.client, input.identity, input.payload)
  const summary: SyncSummary = {
    documents: { created: 0, updated: 0, skipped: 0 },
    legal_acceptances: { created: 0, existing: 0, skipped: 0 },
    powers_of_attorney: { created: 0, updated: 0, skipped: 0 },
    facility_data: { updated: false, metering_point_created: false, skipped: true },
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

  const acceptances = Array.isArray(input.payload.legal_acceptances) ? input.payload.legal_acceptances : []
  for (const acceptance of acceptances) {
    const result = await syncLegalAcceptance({ client: input.client, identity: input.identity, refs, acceptance, baseMetadata })
    summary.legal_acceptances[result === 'created' ? 'created' : result === 'existing' ? 'existing' : 'skipped']++
  }

  if (input.payload.power_of_attorney) {
    const poa = input.payload.power_of_attorney
    const poaAcceptance: TenantLegalAcceptanceInput = {
      acceptance_type: 'power_of_attorney',
      legal_text_version_id: poa.legal_text_version_id,
      legal_text_version: poa.legal_text_version,
      contract_id: poa.contract_id ?? refs.contractId ?? undefined,
      contract_application_id: refs.applicationId ?? undefined,
      accepted_at: poa.accepted_at ?? poa.signed_at,
      accepted_ip: poa.accepted_ip,
      accepted_ip_hash: poa.accepted_ip_hash,
      accepted_user_agent: poa.accepted_user_agent,
      metadata: poa.metadata,
    }
    const legalResult = await syncLegalAcceptance({ client: input.client, identity: input.identity, refs, acceptance: poaAcceptance, baseMetadata })
    summary.legal_acceptances[legalResult === 'created' ? 'created' : legalResult === 'existing' ? 'existing' : 'skipped']++

    const poaResult = await writePowerOfAttorney({ client: input.client, identity: input.identity, refs, poa, baseMetadata })
    summary.powers_of_attorney[poaResult === 'created' ? 'created' : poaResult === 'updated' ? 'updated' : 'skipped']++
    if (poa.document) {
      const documentResult = await writeDocument({
        client: input.client,
        identity: input.identity,
        refs,
        document: { document_type: 'power_of_attorney', title: 'Signerad fullmakt', ...poa.document },
        baseMetadata,
      })
      summary.documents[documentResult === 'created' ? 'created' : documentResult === 'updated' ? 'updated' : 'skipped']++
    }
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

  summary.facility_data = await syncFacilityData({ client: input.client, identity: input.identity, refs, facility: input.payload.facility_data, baseMetadata })
  if (!summary.facility_data.skipped) {
    await emitSyncEvent({
      client: input.client,
      identity: input.identity,
      type: summary.facility_data.metering_point_created ? 'facility_data.verified' : 'facility_data.received',
      refs,
      events: summary.events,
    })
  }

  if (!refs.meteringPointId && !input.payload.facility_data?.metering_point_id) {
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
