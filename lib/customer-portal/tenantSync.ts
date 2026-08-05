import { emitDomainEvent } from '@/lib/events/domainEvents'
import { createOrUpdateCustomerSiteFromAddress } from '@/lib/customer-sites/addressIntake'
import { enqueueCustomerDataRequestAutomation } from '@/lib/customer-operations/automation'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import { publicReference } from '@/lib/integrations/publicReferences'
import {
  buildCustomerLegalDocuments,
  customerLegalAcceptanceCategoryForModule,
  type CustomerLegalModuleVersion,
} from '@/lib/legal/customerDocumentPackage'
import { ensureAuthorizationDocumentFromPowerOfAttorney } from '@/lib/legal/authorizationChain'
import { powerOfAttorneyCoverageFromScopes } from '@/lib/operations/powerOfAttorneyWorkflow'

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
  signer_name?: string
  signer_identity_number?: string
  method?: string
  ip_address?: string
  user_agent?: string
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

type StoredLegalAcceptanceType =
  | 'terms'
  | 'privacy_policy'
  | 'withdrawal_info'
  | 'price_snapshot'
  | 'power_of_attorney'

function normalizeAcceptanceType(value: unknown): StoredLegalAcceptanceType | null {
  const moduleKey = clean(value)?.toLowerCase()
  if (!moduleKey) return null
  const category = customerLegalAcceptanceCategoryForModule(moduleKey)
  if (category === 'withdrawal') return 'withdrawal_info'
  if (category === 'price_terms') return 'price_snapshot'
  return category
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

type ResolvedLegalModule = {
  id: string
  acceptanceType: StoredLegalAcceptanceType
  legalTextVersionId: string | null
  moduleKey: string
  version: string
  hash: string
  title: string | null
}

type ResolvedLegalDocument = {
  documentCode: string
  documentVersion: string
  documentHash: string
  title: string | null
  legalBundleVersionId: string
  referenceKind: 'module' | 'customer_document'
  modules: ResolvedLegalModule[]
}

function resolvedLegalModule(row: Record<string, unknown>): ResolvedLegalModule {
  const moduleKey = clean(row.module_key)
  const version = clean(row.template_version) ?? clean(row.created_at)
  const hash = clean(row.content_sha256)?.toLowerCase()
  const acceptanceType = normalizeAcceptanceType(moduleKey)
  if (!moduleKey || !version || !hash || !acceptanceType) {
    throw new Error('LEGAL_DOCUMENT_NOT_ACCEPTABLE')
  }
  return {
    id: String(row.id),
    acceptanceType,
    legalTextVersionId: clean(row.legacy_legal_text_version_id),
    moduleKey,
    version,
    hash,
    title: clean(row.title),
  }
}

function assertAcceptedDocumentEvidence(input: {
  expectedCode?: string
  expectedVersion?: string
  expectedHash?: string
  actualCode: string
  actualVersion: string
  actualHash: string
}) {
  if (
    (input.expectedCode && input.expectedCode !== input.actualCode) ||
    (input.expectedVersion && input.expectedVersion !== input.actualVersion) ||
    (input.expectedHash && input.expectedHash.toLowerCase() !== input.actualHash)
  ) {
    throw new Error('LEGAL_DOCUMENT_EVIDENCE_MISMATCH')
  }
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
    .select('id,legal_bundle_version_id,module_key,legacy_legal_text_version_id,title,content_sha256,template_version,created_at,origin')
    .eq('legal_bundle_version_id', input.refs.legalBundleVersionId)
  if (result.error) throw result.error

  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const exactRow = rows.find((row) =>
    publicReference('legal_document', input.companyId, String(row.id)) === input.documentReference)

  if (exactRow) {
    const module = resolvedLegalModule(exactRow)
    assertAcceptedDocumentEvidence({
      expectedCode: input.expectedCode,
      expectedVersion: input.expectedVersion,
      expectedHash: input.expectedHash,
      actualCode: module.moduleKey,
      actualVersion: module.version,
      actualHash: module.hash,
    })
    return {
      documentCode: module.moduleKey,
      documentVersion: module.version,
      documentHash: module.hash,
      title: module.title,
      legalBundleVersionId: input.refs.legalBundleVersionId,
      referenceKind: 'module',
      modules: [module],
    }
  }

  const packageModules = rows.map((row) => ({
    id: String(row.id),
    module_key: String(row.module_key),
    version: clean(row.template_version) ?? clean(row.created_at) ?? String(row.id),
    title: clean(row.title) ?? String(row.module_key),
    published_at: clean(row.created_at),
    content_sha256: clean(row.content_sha256),
    legal_bundle_version_id: clean(row.legal_bundle_version_id),
    origin: clean(row.origin),
  })) satisfies CustomerLegalModuleVersion[]
  const customerDocument = buildCustomerLegalDocuments({
    companyId: input.companyId,
    legalBundleVersionId: input.refs.legalBundleVersionId,
    modules: packageModules,
  }).find((candidate) => candidate.document_reference === input.documentReference)
  if (!customerDocument) throw new Error('LEGAL_DOCUMENT_REFERENCE_INVALID')

  assertAcceptedDocumentEvidence({
    expectedCode: input.expectedCode,
    expectedVersion: input.expectedVersion,
    expectedHash: input.expectedHash,
    actualCode: customerDocument.requirement_code,
    actualVersion: customerDocument.document_version,
    actualHash: customerDocument.document_hash.toLowerCase(),
  })

  const sourceIds = new Set(customerDocument.source_document_ids)
  const sourceRows = rows.filter((row) => sourceIds.has(String(row.id)))
  if (sourceRows.length !== sourceIds.size) {
    throw new Error('LEGAL_DOCUMENT_SOURCE_MISMATCH')
  }

  return {
    documentCode: customerDocument.requirement_code,
    documentVersion: customerDocument.document_version,
    documentHash: customerDocument.document_hash.toLowerCase(),
    title: customerDocument.title,
    legalBundleVersionId: input.refs.legalBundleVersionId,
    referenceKind: 'customer_document',
    modules: sourceRows.map(resolvedLegalModule),
  }
}

async function existingLegalAcceptanceDocumentIds(input: {
  companyId: string
  customerId: string
  contractId: string | null
  moduleIds: string[]
}): Promise<Set<string>> {
  if (input.moduleIds.length === 0) return new Set()
  let query = supabaseService
    .from('customer_legal_acceptances')
    .select('legal_bundle_version_document_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('legal_bundle_version_document_id', input.moduleIds)
  query = input.contractId ? query.eq('contract_id', input.contractId) : query.is('contract_id', null)
  const result = await query
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return new Set()
    throw result.error
  }
  return new Set(
    (result.data ?? [])
      .map((row) => clean(row.legal_bundle_version_document_id))
      .filter((value): value is string => Boolean(value)),
  )
}

async function syncLegalAcceptance(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  acceptance: TenantLegalAcceptanceInput
  baseMetadata: JsonRecord
  legalDocument?: ResolvedLegalDocument
}): Promise<'created' | 'existing' | 'skipped'> {
  if (input.acceptance.accepted !== true) return 'skipped'
  const legalDocument =
    input.legalDocument ??
    (await resolveLegalDocument({
      companyId: input.client.company_id,
      refs: input.refs,
      documentReference: input.acceptance.document_reference,
      expectedCode: input.acceptance.document_code,
      expectedVersion: input.acceptance.document_version,
      expectedHash: input.acceptance.document_hash,
    }))
  const contractId = input.refs.contractId
  const existingIds = await existingLegalAcceptanceDocumentIds({
    companyId: input.client.company_id,
    customerId: input.identity.customer_id,
    contractId,
    moduleIds: legalDocument.modules.map((module) => module.id),
  })
  const missingModules = legalDocument.modules.filter((module) => !existingIds.has(module.id))
  if (missingModules.length === 0) return 'existing'

  const rows = missingModules.map((module) => nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: contractId,
    contract_application_id: input.refs.applicationId,
    acceptance_type: module.acceptanceType,
    legal_text_version_id: module.legalTextVersionId,
    legal_bundle_version_document_id: module.id,
    legal_module_key: module.moduleKey,
    legal_document_version: module.version,
    legal_document_sha256: module.hash,
    accepted_at: input.acceptance.accepted_at,
    source: 'customer_portal',
    snapshot: {
      accepted_document: {
        document_code: legalDocument.documentCode,
        document_version: legalDocument.documentVersion,
        document_hash: legalDocument.documentHash,
        document_title: legalDocument.title,
        document_reference: input.acceptance.document_reference,
        reference_kind: legalDocument.referenceKind,
      },
      source_module: {
        id: module.id,
        module_key: module.moduleKey,
        version: module.version,
        hash: module.hash,
        title: module.title,
      },
    },
    metadata: {
      ...input.baseMetadata,
      ...asRecord(input.acceptance.metadata),
      document_reference: input.acceptance.document_reference,
      accepted_document_code: legalDocument.documentCode,
      legal_bundle_version_id: input.refs.legalBundleVersionId,
      legal_bundle_document_id: module.id,
      legal_reference_kind: legalDocument.referenceKind,
      grouped_source_document_count: legalDocument.modules.length,
    },
  }))

  const result = await supabaseService
    .from('customer_legal_acceptances')
    .insert(rows)
    .select('id')
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) {
      throw new Error('LEGAL_ACCEPTANCE_SCHEMA_MISMATCH')
    }
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

const TENANT_POWER_OF_ATTORNEY_SCOPES = new Set([
  'supplier_switch',
  'facility_information_lookup',
])

type ExistingTenantPowerOfAttorney = {
  id: string
  reference?: string | null
  legal_text_version_id?: string | null
  signed_scope_snapshot?: unknown
  scope_summary?: unknown
  fullmakt_snapshot?: unknown
  evidence_payload?: unknown
  signer_name?: string | null
  signer_identity_number?: string | null
  method?: string | null
  metadata?: unknown
  status?: string | null
}

function normalizeTenantPowerOfAttorneyScopes(scopes: string[]): string[] {
  const normalized = Array.from(
    new Set(scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean)),
  ).sort()
  if (
    normalized.length === 0 ||
    !normalized.includes('supplier_switch') ||
    normalized.some((scope) => !TENANT_POWER_OF_ATTORNEY_SCOPES.has(scope))
  ) {
    throw new Error('POWER_OF_ATTORNEY_SCOPE_INVALID')
  }
  return normalized
}

function existingPowerOfAttorneyScopes(row: ExistingTenantPowerOfAttorney): string[] {
  const evidence = asRecord(row.evidence_payload)
  const snapshot = asRecord(row.fullmakt_snapshot)
  const summary = asRecord(row.scope_summary)
  const raw = Array.isArray(row.signed_scope_snapshot)
    ? row.signed_scope_snapshot
    : Array.isArray(evidence.scopes)
      ? evidence.scopes
      : Array.isArray(snapshot.scopes)
        ? snapshot.scopes
        : Array.isArray(summary.scopes)
          ? summary.scopes
          : []
  return Array.from(
    new Set(
      raw
        .map((scope) => String(scope).trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort()
}

function existingPowerOfAttorneyDocumentId(
  row: ExistingTenantPowerOfAttorney,
): string | null {
  const evidence = asRecord(row.evidence_payload)
  const snapshot = asRecord(row.fullmakt_snapshot)
  const metadata = asRecord(row.metadata)
  return (
    clean(evidence.legal_bundle_version_document_id) ??
    clean(snapshot.legal_bundle_version_document_id) ??
    clean(metadata.legal_bundle_document_id) ??
    clean(row.legal_text_version_id) ??
    null
  )
}

function existingPowerOfAttorneyIsExternallySendable(
  row: ExistingTenantPowerOfAttorney,
): boolean {
  const evidence = asRecord(row.evidence_payload)
  const metadata = asRecord(row.metadata)
  return Boolean(
    clean(row.signer_name) &&
      clean(row.signer_identity_number) &&
      clean(row.method) &&
      (evidence.externally_sendable_at_capture === true ||
        evidence.capture_type === 'structured_complete' ||
        metadata.externally_sendable === true),
  )
}

async function listExistingPowerOfAttorneys(input: {
  companyId: string
  customerId: string
  reference: string | null
  contractId: string | null
}): Promise<ExistingTenantPowerOfAttorney[]> {
  const selection =
    'id,reference,legal_text_version_id,signed_scope_snapshot,scope_summary,fullmakt_snapshot,evidence_payload,signer_name,signer_identity_number,method,metadata,status'
  if (input.reference) {
    const byRef = await supabaseService
      .from('powers_of_attorney')
      .select(selection)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('reference', input.reference)
      .order('created_at', { ascending: false })
      .limit(5)
    if (byRef.error) {
      if (isMissingPortalSchemaError(byRef.error)) return []
      throw byRef.error
    }
    return (byRef.data ?? []) as ExistingTenantPowerOfAttorney[]
  }

  let query = supabaseService
    .from('powers_of_attorney')
    .select(selection)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('scope', 'supplier_switch')
    .order('created_at', { ascending: false })
    .limit(25)
  query = input.contractId
    ? query.eq('contract_id', input.contractId)
    : query.is('contract_id', null)
  const result = await query
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return []
    throw result.error
  }
  return (result.data ?? []) as ExistingTenantPowerOfAttorney[]
}

async function writePowerOfAttorney(input: {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  refs: SyncRefs
  poa: TenantPowerOfAttorneyInput
  baseMetadata: JsonRecord
}): Promise<{ result: 'created' | 'updated' | 'skipped'; signed: boolean }> {
  if (input.poa.accepted !== true) return { result: 'skipped', signed: false }

  const scopes = normalizeTenantPowerOfAttorneyScopes(input.poa.scope)
  const contractId = input.refs.contractId
  const siteId = input.refs.siteId
  const meteringPointId = input.refs.meteringPointId
  const reference = clean(input.poa.power_of_attorney_reference)
  const legalDocument = await resolveLegalDocument({
    companyId: input.client.company_id,
    refs: input.refs,
    documentReference: input.poa.document_reference,
  })
  const poaModule =
    legalDocument.modules.length === 1 ? legalDocument.modules[0] : null
  if (!poaModule || poaModule.acceptanceType !== 'power_of_attorney') {
    throw new Error('POWER_OF_ATTORNEY_DOCUMENT_REQUIRED')
  }

  const signerName = clean(input.poa.signer_name)
  const signerIdentityNumber = clean(input.poa.signer_identity_number)
  const method = clean(input.poa.method)
  const externallySendable = Boolean(
    signerName && signerIdentityNumber && method,
  )
  const acceptedAt = input.poa.accepted_at
  const now = new Date().toISOString()
  const status = externallySendable ? 'signed' : 'draft'
  const validFrom = clean(input.poa.valid_from) ?? acceptedAt.slice(0, 10)
  const validTo = clean(input.poa.valid_to)
  const captureType = externallySendable
    ? 'structured_complete'
    : 'legacy_weak_consent'
  const metadata = {
    ...input.baseMetadata,
    ...asRecord(input.poa.metadata),
    contract_application_id: input.refs.applicationId,
    document_reference: input.poa.document_reference,
    legal_bundle_version_id: legalDocument.legalBundleVersionId,
    legal_bundle_document_id: poaModule.id,
    legal_reference_kind: legalDocument.referenceKind,
    external_customer_id: input.identity.external_customer_id,
    externally_sendable: externallySendable,
    poa_capture_type: captureType,
    requires_completion: !externallySendable,
  }
  const fullmaktSnapshot = {
    ...asRecord(input.poa.metadata),
    document_reference: input.poa.document_reference,
    document_code: poaModule.moduleKey,
    document_version: poaModule.version,
    document_hash: poaModule.hash,
    accepted_document_reference: input.poa.document_reference,
    accepted_document_version: legalDocument.documentVersion,
    accepted_document_hash: legalDocument.documentHash,
    legal_bundle_version_id: legalDocument.legalBundleVersionId,
    legal_bundle_version_document_id: poaModule.id,
    scopes,
    accepted_at: acceptedAt,
  }
  const evidencePayload = {
    accepted: true,
    accepted_at: acceptedAt,
    method,
    scopes,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    ip_address: clean(input.poa.ip_address),
    user_agent: clean(input.poa.user_agent),
    legal_bundle_version_id: legalDocument.legalBundleVersionId,
    legal_bundle_version_document_id: poaModule.id,
    legal_text_version_id: poaModule.legalTextVersionId,
    legal_document_version: poaModule.version,
    legal_document_sha256: poaModule.hash,
    accepted_document_reference: input.poa.document_reference,
    accepted_document_version: legalDocument.documentVersion,
    accepted_document_sha256: legalDocument.documentHash,
    source: 'customer_portal_api',
    externally_sendable_at_capture: externallySendable,
    requires_completion: !externallySendable,
    capture_type: captureType,
  }

  const existingRows = await listExistingPowerOfAttorneys({
    companyId: input.client.company_id,
    customerId: input.identity.customer_id,
    reference,
    contractId,
  })
  const exactExisting = existingRows.find((row) => {
    const existingScopes = existingPowerOfAttorneyScopes(row)
    const exactScopes =
      existingScopes.length === scopes.length &&
      existingScopes.every((scope, index) => scope === scopes[index])
    return (
      exactScopes &&
      existingPowerOfAttorneyDocumentId(row) === poaModule.id
    )
  })
  if (reference && existingRows.length > 0 && !exactExisting) {
    // A reference is an immutable signer-facing identity. Reusing it with a
    // different legal document or scope would silently widen/rebind the POA.
    throw new Error('POWER_OF_ATTORNEY_REFERENCE_CONFLICT')
  }

  const fullPayload = nonNull({
    company_id: input.client.company_id,
    customer_id: input.identity.customer_id,
    contract_id: contractId,
    customer_site_id: siteId,
    site_id: siteId,
    metering_point_id: meteringPointId,
    scope: 'supplier_switch',
    status,
    signed_at: externallySendable ? acceptedAt : null,
    accepted_at: acceptedAt,
    valid_from: validFrom,
    valid_to: validTo,
    legal_text_version_id: poaModule.legalTextVersionId,
    signed_scope_snapshot: scopes,
    fullmakt_snapshot: fullmaktSnapshot,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    method,
    evidence_payload: evidencePayload,
    accepted_ip: clean(input.poa.ip_address),
    accepted_user_agent: clean(input.poa.user_agent),
    accepted_source: 'customer_portal',
    reference,
    scope_summary: {
      scopes,
      supplier_switch: true,
      facility_information_lookup: scopes.includes(
        'facility_information_lookup',
      ),
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
    scope: 'supplier_switch',
    // A legacy schema that cannot persist the complete signer/evidence snapshot
    // must never surface the POA as signed. It remains fail-closed until the
    // canonical schema is available and the same exact authorization is completed.
    status: 'draft',
    signed_at: null,
    valid_from: validFrom,
    valid_to: validTo,
    reference,
    scope_summary: { scopes },
    fullmakt_snapshot: fullmaktSnapshot,
    metadata: {
      ...metadata,
      desired_status: status,
      legacy_schema_fallback: true,
      externally_sendable: false,
      requires_completion: true,
    },
    updated_at: now,
  })

  let powerOfAttorneyId: string | null = exactExisting?.id ?? null
  const resultKind: 'created' | 'updated' = exactExisting ? 'updated' : 'created'
  let persistedAsSigned =
    exactExisting?.status === 'signed' &&
    existingPowerOfAttorneyIsExternallySendable(exactExisting)

  if (!exactExisting || (externallySendable && !persistedAsSigned)) {
    for (const payload of [fullPayload, fallbackPayload]) {
      const updatePayload = exactExisting ? { ...payload } : payload
      if (
        exactExisting &&
        Array.isArray(exactExisting.signed_scope_snapshot) &&
        exactExisting.signed_scope_snapshot.length === 0
      ) {
        // The database protects an already-created POA scope snapshot from any
        // mutation. Legacy rows may still be completed without rewriting that
        // column because the same exact scopes are already present in their
        // captured scope_summary/fullmakt evidence.
        delete updatePayload.signed_scope_snapshot
      }
      const result = exactExisting
        ? await supabaseService
            .from('powers_of_attorney')
            .update(updatePayload)
            .eq('id', exactExisting.id)
            .eq('company_id', input.client.company_id)
            .select('id,status')
            .maybeSingle()
        : await supabaseService
            .from('powers_of_attorney')
            .insert({ ...payload, created_at: now })
            .select('id,status')
            .maybeSingle()
      if (!result.error) {
        powerOfAttorneyId = clean(result.data?.id)
        persistedAsSigned = result.data?.status === 'signed'
        break
      }
      if (!isMissingPortalSchemaError(result.error)) {
        if (result.error.code === '23514' && payload.status === 'signed') {
          const retry = {
            ...updatePayload,
            status: 'draft',
            signed_at: null,
            metadata: {
              ...metadata,
              desired_status: 'signed',
              status_constraint_retry: true,
            },
          }
          const retryResult = exactExisting
            ? await supabaseService
                .from('powers_of_attorney')
                .update(retry)
                .eq('id', exactExisting.id)
                .eq('company_id', input.client.company_id)
                .select('id,status')
                .maybeSingle()
            : await supabaseService
                .from('powers_of_attorney')
                .insert({ ...retry, created_at: now })
                .select('id,status')
                .maybeSingle()
          if (!retryResult.error) {
            powerOfAttorneyId = clean(retryResult.data?.id)
            persistedAsSigned = false
            break
          }
        }
        throw result.error
      }
    }
  }

  if (!powerOfAttorneyId) {
    // An explicitly accepted POA may never disappear into a successful sync
    // summary. Missing/old schema must fail the request so the tenant retries
    // after OPS has been upgraded instead of starting a switch without proof.
    throw new Error('POWER_OF_ATTORNEY_PERSISTENCE_FAILED')
  }

  if (externallySendable && persistedAsSigned) {
    await ensureAuthorizationDocumentFromPowerOfAttorney({
      companyId: input.client.company_id,
      customerId: input.identity.customer_id,
      powerOfAttorneyId,
      actorUserId: null,
      siteId,
      meteringPointId,
      contractId,
      reference,
      source: 'customer_portal_api',
      validFrom,
      validTo,
      coverage: powerOfAttorneyCoverageFromScopes(scopes),
      signedScopes: scopes,
      metadata: {
        application_id: input.refs.applicationId,
        legal_bundle_version_id: legalDocument.legalBundleVersionId,
        legal_bundle_version_document_id: poaModule.id,
        document_reference: input.poa.document_reference,
      },
    })
  }

  return { result: resultKind, signed: externallySendable && persistedAsSigned }
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
  const seenAcceptanceReferences = new Set<string>()
  const resolvedAcceptances = await Promise.all(
    acceptances.map(async (acceptance) => {
      if (seenAcceptanceReferences.has(acceptance.document_reference)) {
        throw new Error('LEGAL_ACCEPTANCE_DUPLICATE')
      }
      seenAcceptanceReferences.add(acceptance.document_reference)
      return {
        acceptance,
        legalDocument: await resolveLegalDocument({
          companyId: input.client.company_id,
          refs,
          documentReference: acceptance.document_reference,
          expectedCode: acceptance.document_code,
          expectedVersion: acceptance.document_version,
          expectedHash: acceptance.document_hash,
        }),
      }
    }),
  )
  const acceptanceReferenceKinds = new Set(
    resolvedAcceptances.map(({ legalDocument }) => legalDocument.referenceKind),
  )
  if (acceptanceReferenceKinds.size > 1) {
    throw new Error('LEGAL_ACCEPTANCE_FORMAT_MIXED')
  }
  for (const { acceptance, legalDocument } of resolvedAcceptances) {
    const result = await syncLegalAcceptance({
      client: input.client,
      identity: input.identity,
      refs,
      acceptance,
      baseMetadata,
      legalDocument,
    })
    summary.legal_acceptances[result === 'created' ? 'created' : result === 'existing' ? 'existing' : 'skipped']++
  }

  if (input.payload.power_of_attorney) {
    const poa = input.payload.power_of_attorney
    const poaResult = await writePowerOfAttorney({ client: input.client, identity: input.identity, refs, poa, baseMetadata })
    summary.powers_of_attorney[poaResult.result === 'created' ? 'created' : poaResult.result === 'updated' ? 'updated' : 'skipped']++
    if (poaResult.signed) {
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
