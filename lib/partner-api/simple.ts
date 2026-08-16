import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  ApiInputError,
  executeIdempotentPortalWrite,
  readJsonObject,
  requireIdempotencyKey,
  requireIsoDate,
} from '@/lib/api/strictRequest'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { assertPublicWebhookTarget } from '@/lib/integrations/publicWebhookTransport'
import { supabaseService } from '@/lib/supabase/service'
import { PARTNER_API_VERSION, partnerOpenApi } from './openApi'

const POA_BUCKET = 'customer-documents'
const MAX_POA_BYTES = 5 * 1024 * 1024
const MAX_INVOICE_PDF_BYTES = 15 * 1024 * 1024
const MAX_MEASUREMENT_DAYS = 366
const MAX_MEASUREMENT_ROWS = 40_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SIMPLE_WEBHOOK_EVENTS = {
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  SITE_CREATED: 'site.created',
  SITE_UPDATED: 'site.updated',
  POWER_OF_ATTORNEY_CREATED: 'power_of_attorney.created',
  CONTRACT_CREATED: 'contract.created',
  CONTRACT_STATUS_CHANGE: 'contract.status_changed',
  INVOICE_CREATED: 'invoice.created',
  INVOICE_UPDATED: 'invoice.updated',
} as const

type Json = Record<string, unknown>
type SimpleMethod = 'GET' | 'POST' | 'DELETE'
type CustomerType = 'private' | 'business'
type SiteType = 'consumption' | 'production'

class SimplePartnerApiError extends Error {
  status: number
  code: string
  field?: string

  constructor(message: string, code: string, status = 400, field?: string) {
    super(message)
    this.name = 'SimplePartnerApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Json
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function digits(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\D/g, '')
  return normalized || null
}

function requestId(request: NextRequest): string {
  const candidate = request.headers.get('x-request-id')?.trim()
  return candidate && candidate.length <= 128 ? candidate : randomUUID()
}

function assertNoTenantSelectors(value: unknown, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTenantSelectors(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Json)) {
    if (key === 'company_id' || key === 'tenant_id' || key === 'tenant_reference') {
      throw new SimplePartnerApiError(
        'Company selection is not accepted by the Partner API.',
        'tenant_selection_forbidden',
        422,
        `${path}.${key}`,
      )
    }
    assertNoTenantSelectors(nested, `${path}.${key}`)
  }
}

function ensureKeys(body: Json, allowed: readonly string[]) {
  const allow = new Set(allowed)
  const invalid = Object.keys(body).find((key) => !allow.has(key))
  if (invalid) {
    throw new SimplePartnerApiError(`Unsupported field: ${invalid}`, 'unsupported_field', 422, invalid)
  }
}

function assertOpaquePublicPayload(value: unknown, path = '$') {
  if (typeof value === 'string' && UUID_PATTERN.test(value)) {
    throw new Error(`simple_partner_api_internal_uuid_leak:${path}`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOpaquePublicPayload(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Json)) {
    if (['company_id', 'tenant_id', 'api_client_id', 'customer_id_internal', 'site_id_internal'].includes(key)) {
      throw new Error(`simple_partner_api_internal_field_leak:${path}.${key}`)
    }
    assertOpaquePublicPayload(nested, `${path}.${key}`)
  }
}

function simpleJson(body: Json, status: number, id: string): NextResponse {
  if (status < 400) assertOpaquePublicPayload(body)
  const payload = status >= 400
    ? { ...body, request_id: id }
    : body
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-ID': id,
      'X-Gridex-API-Version': PARTNER_API_VERSION,
    },
  })
}

function normalizedError(error: unknown): { status: number; code: string; message: string; field?: string } {
  if (error instanceof SimplePartnerApiError) return error
  if (error instanceof ApiInputError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }

  const message = String((error as { message?: unknown } | null)?.message ?? '')
  const known: Array<[RegExp, number, string, string]> = [
    [/partner_api_offer_not_found/i, 404, 'offer_not_found', 'No published API offer is available for this customer type.'],
    [/partner_api_customer_email_required/i, 422, 'customer_email_required', 'email is required.'],
    [/partner_api_customer_identity_number_required/i, 422, 'soc_id_required', 'soc_id is required for PRIVATE customers.'],
    [/partner_api_customer_organization_number_required/i, 422, 'soc_id_required', 'soc_id is required for COMPANY customers.'],
    [/partner_api_site_address_required/i, 422, 'site_address_required', 'Site address, zip_code and city are required.'],
    [/duplicate key|23505/i, 409, 'resource_conflict', 'The resource already exists.'],
  ]
  const match = known.find(([pattern]) => pattern.test(message))
  if (match) return { status: match[1], code: match[2], message: match[3] }

  return {
    status: 500,
    code: 'partner_api_internal_error',
    message: 'The request could not be completed.',
  }
}

async function auth(
  request: NextRequest,
  scopes: IntegrationScopeRequirement,
): Promise<
  | { ok: true; client: IntegrationApiClient; startedAt: number; id: string }
  | { ok: false; response: NextResponse }
> {
  const startedAt = Date.now()
  const id = requestId(request)
  const result = await requireIntegrationApiAccess(request, scopes)
  if (!result.ok) {
    await logIntegrationApiRequest({
      client: result.client ?? null,
      request,
      statusCode: result.status,
      startedAt,
      errorCode: result.errorCode,
      metadata: { request_id: id, api_surface: 'partner_v1_simple' },
    }).catch(() => undefined)
    return {
      ok: false,
      response: simpleJson({ error: { code: result.errorCode, message: result.error } }, result.status, id),
    }
  }
  return { ok: true, client: result.client, startedAt, id }
}

async function successLog(input: {
  request: NextRequest
  client: IntegrationApiClient
  startedAt: number
  status: number
  operation: string
  id: string
}) {
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: input.status,
    startedAt: input.startedAt,
    metadata: {
      request_id: input.id,
      api_surface: 'partner_v1_simple',
      operation: input.operation,
    },
  }).catch(() => undefined)
}

async function failureResponse(input: {
  request: NextRequest
  client: IntegrationApiClient | null
  startedAt: number
  id: string
  error: unknown
}) {
  const error = normalizedError(input.error)
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: error.status,
    startedAt: input.startedAt,
    errorCode: error.code,
    metadata: { request_id: input.id, api_surface: 'partner_v1_simple' },
  }).catch(() => undefined)
  if (error.status >= 500) {
    console.error('[partner-api-simple] request failed', {
      requestId: input.id,
      path: input.request.nextUrl.pathname,
      error: input.error,
    })
  }
  return simpleJson({
    error: {
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    },
  }, error.status, input.id)
}

function normalizeCustomerType(value: unknown): CustomerType {
  const normalized = String(value ?? 'PRIVATE').trim().toUpperCase()
  if (normalized === 'PRIVATE') return 'private'
  if (normalized === 'COMPANY') return 'business'
  throw new SimplePartnerApiError('customer_type must be PRIVATE or COMPANY.', 'customer_type_invalid', 422, 'customer_type')
}

function normalizeSiteType(value: unknown): SiteType {
  const normalized = String(value ?? 'CONSUMPTION').trim().toUpperCase()
  if (normalized === 'CONSUMPTION') return 'consumption'
  if (normalized === 'PRODUCTION') return 'production'
  throw new SimplePartnerApiError('site_electricity_type must be CONSUMPTION or PRODUCTION.', 'site_electricity_type_invalid', 422, 'site_electricity_type')
}

function normalizePoaType(value: unknown): 'web' | 'paper' | 'audio' {
  const normalized = String(value ?? 'WEB').trim().toUpperCase()
  if (normalized === 'WEB') return 'web'
  if (normalized === 'PAPER') return 'paper'
  if (normalized === 'AUDIO') return 'audio'
  throw new SimplePartnerApiError('poa_type must be WEB, PAPER or AUDIO.', 'poa_type_invalid', 422, 'poa_type')
}

function normalizeTransactionType(value: unknown): 'SWITCH' | 'MOVE_OUT' {
  const normalized = String(value ?? 'SWITCH').trim().toUpperCase()
  if (normalized === 'SWITCH' || normalized === 'MOVE_OUT') return normalized
  throw new SimplePartnerApiError('transaction_type must be SWITCH or MOVE_OUT.', 'transaction_type_invalid', 422, 'transaction_type')
}

function customerInput(body: Json) {
  ensureKeys(body, [
    'first_name', 'last_name', 'soc_id', 'customer_type', 'company_name',
    'invoice_address', 'zip_code', 'city', 'country', 'email', 'cell_phone',
  ])
  const customerType = normalizeCustomerType(body.customer_type)
  const socId = digits(body.soc_id)
  const email = text(body.email)?.toLowerCase() ?? null
  const firstName = text(body.first_name)
  const lastName = text(body.last_name)
  const companyName = text(body.company_name)
  if (!socId || socId.length < 10) {
    throw new SimplePartnerApiError('soc_id is required.', 'soc_id_required', 422, 'soc_id')
  }
  if (!email || !email.includes('@')) {
    throw new SimplePartnerApiError('email is required.', 'customer_email_required', 422, 'email')
  }
  if (customerType === 'private' && (!firstName || !lastName)) {
    throw new SimplePartnerApiError('first_name and last_name are required for PRIVATE customers.', 'customer_name_required', 422)
  }
  if (customerType === 'business' && !companyName) {
    throw new SimplePartnerApiError('company_name is required for COMPANY customers.', 'company_name_required', 422, 'company_name')
  }
  return {
    customerType,
    socId,
    email,
    firstName,
    lastName,
    companyName,
    invoiceAddress: text(body.invoice_address),
    zipCode: text(body.zip_code),
    city: text(body.city),
    country: (text(body.country) ?? 'SE').toUpperCase(),
    phone: text(body.cell_phone),
  }
}

function siteInput(body: Json) {
  ensureKeys(body, ['address', 'zip_code', 'city', 'country', 'site_electricity_type'])
  const address = text(body.address)
  const zipCode = text(body.zip_code)
  const city = text(body.city)
  if (!address || !zipCode || !city) {
    throw new SimplePartnerApiError('address, zip_code and city are required.', 'site_address_required', 422)
  }
  return {
    address,
    zipCode,
    city,
    country: (text(body.country) ?? 'SE').toUpperCase(),
    siteType: normalizeSiteType(body.site_electricity_type),
  }
}

function stableExternalCustomerId(clientId: string, request: NextRequest): string {
  const key = requireIdempotencyKey(request)
  return `partner_${createHash('sha256').update(`${clientId}:${key}`).digest('hex').slice(0, 32)}`
}

async function resolveCustomer(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customers')
    .select('id,customer_reference,customer_number,external_customer_id,customer_type,status,first_name,last_name,company_name,identity_number,organization_number,email,phone,billing_street,billing_postal_code,billing_city,billing_country')
    .eq('company_id', companyId)
    .eq('customer_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new SimplePartnerApiError('Customer not found.', 'customer_not_found', 404)
  return result.data
}

async function resolveSite(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,facility_reference,facility_id,site_name,site_type,status,street,postal_code,city,country')
    .eq('company_id', companyId)
    .eq('facility_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new SimplePartnerApiError('Site not found.', 'site_not_found', 404)
  return result.data
}

async function requireCustomerSite(companyId: string, customerReference: string, siteReference: string) {
  const customer = await resolveCustomer(companyId, customerReference)
  const site = await resolveSite(companyId, siteReference)
  if (String(site.customer_id) !== String(customer.id)) {
    throw new SimplePartnerApiError('Site not found for customer.', 'site_not_found', 404)
  }
  return { customer, site }
}

async function uploadPoaPdf(companyId: string, value: unknown, extension: unknown) {
  const raw = text(value)
  if (!raw) throw new SimplePartnerApiError('file_base64 is required.', 'poa_file_required', 422, 'file_base64')
  const ext = (text(extension) ?? 'pdf').toLowerCase().replace(/^\./, '')
  if (ext !== 'pdf') {
    throw new SimplePartnerApiError('Power of attorney uploads must be PDF.', 'poa_file_type_invalid', 422, 'file_extension')
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    throw new SimplePartnerApiError('file_base64 is invalid.', 'poa_file_base64_invalid', 422, 'file_base64')
  }
  const bytes = Buffer.from(raw.replace(/\s/g, ''), 'base64')
  if (!bytes.length || bytes.length > MAX_POA_BYTES) {
    throw new SimplePartnerApiError('Power of attorney PDF must be 5 MB or smaller.', 'poa_file_size_invalid', 413, 'file_base64')
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new SimplePartnerApiError('The uploaded file is not a PDF.', 'poa_file_signature_invalid', 422, 'file_base64')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const path = `partner-api/${companyId}/${randomUUID()}.pdf`
  const result = await supabaseService.storage.from(POA_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (result.error) throw result.error
  return { path, sha256 }
}

async function cleanupPoa(path: string | null | undefined) {
  if (!path) return
  await supabaseService.storage.from(POA_BUCKET).remove([path]).catch(() => undefined)
}

async function readPrivateFile(bucket: string, path: string, maxBytes: number): Promise<Buffer> {
  const result = await supabaseService.storage.from(bucket).download(path)
  if (result.error || !result.data) throw result.error ?? new Error('storage_file_missing')
  if (result.data.size > maxBytes) {
    throw new SimplePartnerApiError('The requested document is too large.', 'document_too_large', 413)
  }
  return Buffer.from(await result.data.arrayBuffer())
}

async function resolveInvoicePdf(document: { file_path: string | null; metadata: unknown }) {
  const filePath = text(document.file_path)
  if (!filePath) throw new SimplePartnerApiError('Invoice PDF is not available.', 'invoice_pdf_not_available', 404)
  const metadata = record(document.metadata)
  const allowedBuckets = ['customer-documents', 'customer-contract-documents', 'contract-pdfs', 'billing-exports'] as const
  const configuredBucket = text(metadata.bucket)
  const candidates: Array<{ bucket: string; path: string }> = []

  if (configuredBucket && allowedBuckets.includes(configuredBucket as typeof allowedBuckets[number])) {
    candidates.push({ bucket: configuredBucket, path: filePath })
  }
  for (const bucket of allowedBuckets) {
    if (filePath.startsWith(`${bucket}/`)) {
      candidates.push({ bucket, path: filePath.slice(bucket.length + 1) })
    }
  }
  if (!filePath.includes('/')) {
    for (const bucket of allowedBuckets) candidates.push({ bucket, path: filePath })
  } else if (candidates.length === 0) {
    for (const bucket of allowedBuckets) candidates.push({ bucket, path: filePath })
  }

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      return await readPrivateFile(candidate.bucket, candidate.path, MAX_INVOICE_PDF_BYTES)
    } catch (error) {
      lastError = error
    }
  }
  if (lastError instanceof SimplePartnerApiError) throw lastError
  throw new SimplePartnerApiError('Invoice PDF is not available.', 'invoice_pdf_not_available', 404)
}

async function defaultOfferReference(client: IntegrationApiClient, customerType: CustomerType): Promise<string> {
  const metadata = client.metadata ?? {}
  const configured = text(metadata.partner_default_offer_reference ?? metadata.default_offer_reference)
  if (configured) return configured

  const candidates = await supabaseService
    .from('canonical_public_contract_diagnostics_v')
    .select('offer_reference,customer_type')
    .eq('company_id', client.company_id)
    .eq('channel', 'api')
    .eq('visible', true)
    .limit(20)
  if (candidates.error) throw candidates.error
  const references = Array.from(new Set(
    (candidates.data ?? [])
      .filter((row) => {
        const type = String(row.customer_type ?? '').toLowerCase()
        return type === 'both' || type === customerType
      })
      .map((row) => text(row.offer_reference))
      .filter((value): value is string => Boolean(value)),
  ))
  if (references.length === 1) return references[0]
  if (references.length === 0) {
    throw new SimplePartnerApiError('No published API offer is available.', 'offer_not_found', 404)
  }
  throw new SimplePartnerApiError(
    'This API credential has multiple published offers. Gridex must configure one default offer before contract registration.',
    'default_offer_not_configured',
    409,
  )
}

function simpleCustomerResponse(row: Record<string, unknown>): Json {
  const customerType = String(row.customer_type ?? '').toLowerCase()
  return {
    entity_id: row.customer_reference,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    soc_id: customerType === 'private' ? row.identity_number ?? null : row.organization_number ?? null,
    customer_type: customerType === 'private' ? 'PRIVATE' : 'COMPANY',
    company_name: row.company_name ?? null,
    invoice_address: row.billing_street ?? null,
    zip_code: row.billing_postal_code ?? null,
    city: row.billing_city ?? null,
    country: row.billing_country ?? null,
    email: row.email ?? null,
    cell_phone: row.phone ?? null,
  }
}

function simpleSiteResponse(row: Record<string, unknown>): Json {
  return {
    entity_id: row.facility_reference,
    address: row.street ?? null,
    zip_code: row.postal_code ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    site_electricity_type: String(row.site_type ?? 'consumption').toUpperCase(),
  }
}

async function createCustomer(request: NextRequest) {
  const context = await auth(request, ['partner_customers.write'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    assertNoTenantSelectors(body)
    const customer = customerInput(body)
    const externalCustomerId = stableExternalCustomerId(context.client.id, request)
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/customer',
      payload: body,
      execute: async () => {
        const result = await supabaseService
          .from('customers')
          .insert({
            company_id: context.client.company_id,
            customer_type: customer.customerType,
            status: 'active',
            first_name: customer.firstName,
            last_name: customer.lastName,
            full_name: customer.customerType === 'private'
              ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null
              : customer.companyName,
            company_name: customer.companyName,
            personal_number: customer.customerType === 'private' ? customer.socId : null,
            identity_number: customer.customerType === 'private' ? customer.socId : null,
            org_number: customer.customerType === 'business' ? customer.socId : null,
            organization_number: customer.customerType === 'business' ? customer.socId : null,
            email: customer.email,
            phone: customer.phone,
            source: 'api',
            acquisition_channel: 'partner_api',
            external_customer_id: externalCustomerId,
            billing_street: customer.invoiceAddress,
            billing_postal_code: customer.zipCode,
            billing_city: customer.city,
            billing_country: customer.country,
            metadata: { source_channel: 'partner_api', api_client_id: context.client.id, partner_surface: 'simple_v1' },
          })
          .select('customer_reference')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { entity_id: result.data.customer_reference } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'customer.create', id: context.id })
    return simpleJson(write.body, write.statusCode, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createSite(request: NextRequest, customerReference: string) {
  const context = await auth(request, ['partner_sites.write'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    assertNoTenantSelectors(body)
    const site = siteInput(body)
    const customer = await resolveCustomer(context.client.company_id, customerReference)
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: String(customer.id),
      operation: '/api/partner/v1/customer/{customer_id}/site',
      payload: body,
      execute: async () => {
        const result = await supabaseService
          .from('customer_sites')
          .insert({
            company_id: context.client.company_id,
            customer_id: customer.id,
            site_name: `${site.address}, ${site.city}`,
            site_type: site.siteType,
            status: 'draft',
            street: site.address,
            address: site.address,
            postal_code: site.zipCode,
            city: site.city,
            country: site.country,
            metadata: { source_channel: 'partner_api', api_client_id: context.client.id, partner_surface: 'simple_v1' },
          })
          .select('facility_reference')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { entity_id: result.data.facility_reference } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'site.create', id: context.id })
    return simpleJson(write.body, write.statusCode, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createPowerOfAttorney(request: NextRequest, customerReference: string, siteReference: string) {
  const context = await auth(request, ['partner_power_of_attorney.write'])
  if (!context.ok) return context.response
  let uploadedPath: string | null = null
  try {
    const body = await readJsonObject(request, 7 * 1024 * 1024)
    assertNoTenantSelectors(body)
    ensureKeys(body, ['poa_type', 'transaction_type', 'file_base64', 'file_extension'])
    const { customer, site } = await requireCustomerSite(context.client.company_id, customerReference, siteReference)
    const poaType = normalizePoaType(body.poa_type)
    const transactionType = normalizeTransactionType(body.transaction_type)
    const file = await uploadPoaPdf(context.client.company_id, body.file_base64, body.file_extension)
    uploadedPath = file.path
    const signerName = text(`${customer.first_name ?? ''} ${customer.last_name ?? ''}`)
      ?? text(customer.company_name)
      ?? 'Customer'
    const acceptedAt = new Date().toISOString()
    const idempotencyPayload = {
      ...body,
      file_base64: `sha256:${file.sha256}`,
    }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: String(customer.id),
      operation: '/api/partner/v1/customer/{customer_id}/site/{site_id}/powerofattorney',
      payload: idempotencyPayload,
      execute: async () => {
        const result = await supabaseService
          .from('powers_of_attorney')
          .insert({
            company_id: context.client.company_id,
            customer_id: customer.id,
            site_id: site.id,
            customer_site_id: site.id,
            scope: 'supplier_switch',
            status: 'signed',
            signed_at: acceptedAt,
            accepted_at: acceptedAt,
            signer_name: signerName,
            signer_identity_number: customer.customer_type === 'private' ? customer.identity_number : customer.organization_number,
            method: poaType,
            accepted_source: 'partner_api',
            source: 'partner_api',
            document_path: file.path,
            document_hash: file.sha256,
            evidence_payload: {
              evidence_reference: `sha256:${file.sha256}`,
              transaction_type: transactionType,
            },
            metadata: { source_channel: 'partner_api', api_client_id: context.client.id, partner_surface: 'simple_v1' },
            customer_number: customer.customer_number,
            external_customer_id: customer.external_customer_id,
          })
          .select('power_of_attorney_reference')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { entity_id: result.data.power_of_attorney_reference } }
      },
    })
    if (write.replayed && uploadedPath) await cleanupPoa(uploadedPath)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'power_of_attorney.create', id: context.id })
    return simpleJson(write.body, write.statusCode, context.id)
  } catch (error) {
    await cleanupPoa(uploadedPath)
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createContract(request: NextRequest) {
  const context = await auth(request, ['partner_contracts.write'])
  if (!context.ok) return context.response
  let uploadedPath: string | null = null
  try {
    const body = await readJsonObject(request, 7 * 1024 * 1024)
    assertNoTenantSelectors(body)
    ensureKeys(body, ['customer', 'site', 'power_of_attorney'])
    const customerBody = record(body.customer)
    const siteBody = record(body.site)
    const poaBody = record(body.power_of_attorney)
    if (!Object.keys(customerBody).length) throw new SimplePartnerApiError('customer is required.', 'customer_required', 422, 'customer')
    if (!Object.keys(siteBody).length) throw new SimplePartnerApiError('site is required.', 'site_required', 422, 'site')
    const customer = customerInput(customerBody)
    const site = siteInput(siteBody)
    const externalCustomerId = stableExternalCustomerId(context.client.id, request)
    const offerReference = await defaultOfferReference(context.client, customer.customerType)

    let poaPayload: Json | undefined
    let poaIdempotency: Json | undefined
    if (Object.keys(poaBody).length) {
      ensureKeys(poaBody, ['poa_type', 'transaction_type', 'file_base64', 'file_extension'])
      const poaType = normalizePoaType(poaBody.poa_type)
      const transactionType = normalizeTransactionType(poaBody.transaction_type)
      const file = await uploadPoaPdf(context.client.company_id, poaBody.file_base64, poaBody.file_extension)
      uploadedPath = file.path
      const signerName = customer.customerType === 'private'
        ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
        : customer.companyName ?? 'Customer'
      poaPayload = {
        accepted: true,
        accepted_at: new Date().toISOString(),
        signer_name: signerName || 'Customer',
        signer_identity_number: customer.socId,
        poa_type: poaType,
        transaction_type: transactionType,
        evidence_reference: `sha256:${file.sha256}`,
        document_path: file.path,
        document_sha256: file.sha256,
      }
      poaIdempotency = {
        poa_type: poaType,
        transaction_type: transactionType,
        file_sha256: file.sha256,
      }
    }

    const rpcPayload: Json = {
      offer_reference: offerReference,
      external_customer_id: externalCustomerId,
      customer: {
        external_customer_id: externalCustomerId,
        type: customer.customerType,
        first_name: customer.firstName,
        last_name: customer.lastName,
        company_name: customer.companyName,
        identity_number: customer.customerType === 'private' ? customer.socId : undefined,
        organization_number: customer.customerType === 'business' ? customer.socId : undefined,
        email: customer.email,
        cell_phone: customer.phone,
        invoice_address: customer.invoiceAddress,
        zip_code: customer.zipCode,
        city: customer.city,
        country: customer.country,
      },
      site: {
        electricity_type: site.siteType,
        street: site.address,
        address: site.address,
        postal_code: site.zipCode,
        city: site.city,
        country: site.country,
      },
      ...(poaPayload ? { power_of_attorney: poaPayload } : {}),
      metadata: { partner_surface: 'simple_v1' },
    }

    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/contract',
      payload: {
        customer: customerBody,
        site: siteBody,
        ...(poaIdempotency ? { power_of_attorney: poaIdempotency } : {}),
      },
      execute: async () => {
        const result = await supabaseService.rpc('gridex_create_partner_contract_v1', {
          p_company_id: context.client.company_id,
          p_api_client_id: context.client.id,
          p_payload: rpcPayload,
        })
        if (result.error) throw result.error
        const data = record(result.data)
        return {
          statusCode: 201,
          body: {
            entity_id: data.contract_reference,
            customer: { entity_id: record(data.customer).customer_reference },
            site: { entity_id: record(data.site).site_reference },
            power_of_attorney: data.power_of_attorney
              ? { entity_id: record(data.power_of_attorney).power_of_attorney_reference }
              : null,
          },
        }
      },
    })
    if (write.replayed && uploadedPath) await cleanupPoa(uploadedPath)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'contract.create', id: context.id })
    return simpleJson(write.body, write.statusCode, context.id)
  } catch (error) {
    await cleanupPoa(uploadedPath)
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getContractState(request: NextRequest, contractReference: string) {
  const context = await auth(request, ['customer_contracts.read'])
  if (!context.ok) return context.response
  try {
    const result = await supabaseService
      .from('customer_contracts')
      .select('customer_contract_reference,status')
      .eq('company_id', context.client.company_id)
      .eq('customer_contract_reference', contractReference)
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new SimplePartnerApiError('Contract not found.', 'contract_not_found', 404)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'contract.state', id: context.id })
    return simpleJson({ entity_id: result.data.customer_contract_reference, state: result.data.status }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getCustomer(request: NextRequest, customerReference: string) {
  const context = await auth(request, ['customer_profile.read'])
  if (!context.ok) return context.response
  try {
    const customer = await resolveCustomer(context.client.company_id, customerReference)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'customer.get', id: context.id })
    return simpleJson(simpleCustomerResponse(customer), 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getSite(request: NextRequest, customerReference: string, siteReference: string) {
  const context = await auth(request, ['customer_sites.read'])
  if (!context.ok) return context.response
  try {
    const { site } = await requireCustomerSite(context.client.company_id, customerReference, siteReference)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'site.get', id: context.id })
    return simpleJson(simpleSiteResponse(site), 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getPowerOfAttorney(request: NextRequest, customerReference: string, siteReference: string) {
  const context = await auth(request, ['customer_power_of_attorney.read'])
  if (!context.ok) return context.response
  try {
    const { customer, site } = await requireCustomerSite(context.client.company_id, customerReference, siteReference)
    const result = await supabaseService
      .from('powers_of_attorney')
      .select('power_of_attorney_reference,method,document_path,evidence_payload,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', customer.id)
      .eq('customer_site_id', site.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new SimplePartnerApiError('Power of attorney not found.', 'power_of_attorney_not_found', 404)
    const evidence = record(result.data.evidence_payload)
    const path = text(result.data.document_path)
    const file = path ? await readPrivateFile(POA_BUCKET, path, MAX_POA_BYTES) : null
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'power_of_attorney.get', id: context.id })
    return simpleJson({
      entity_id: result.data.power_of_attorney_reference,
      poa_type: String(result.data.method ?? 'web').toUpperCase(),
      transaction_type: String(evidence.transaction_type ?? 'SWITCH').toUpperCase(),
      file_base64: file ? file.toString('base64') : null,
      file_extension: file ? 'pdf' : null,
    }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getInvoices(request: NextRequest, customerReference: string, siteReference: string) {
  const context = await auth(request, ['customer_invoices.read'])
  if (!context.ok) return context.response
  try {
    const { customer, site } = await requireCustomerSite(context.client.company_id, customerReference, siteReference)
    const contracts = await supabaseService
      .from('customer_contracts')
      .select('id')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', customer.id)
      .eq('customer_site_id', site.id)
    if (contracts.error) throw contracts.error
    const contractIds = new Set((contracts.data ?? []).map((row) => String(row.id)))
    const fromDate = request.nextUrl.searchParams.get('from_date')
    const toDate = request.nextUrl.searchParams.get('to_date')
    let query = supabaseService
      .from('customer_invoices')
      .select('invoice_reference,invoice_number,amount_inc_vat,currency,due_date,issued_at,status,contract_id,customer_contract_id')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', customer.id)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(200)
    if (fromDate) query = query.gte('issued_at', `${requireIsoDate(fromDate, 'from_date')}T00:00:00.000Z`)
    if (toDate) query = query.lte('issued_at', `${requireIsoDate(toDate, 'to_date')}T23:59:59.999Z`)
    const result = await query
    if (result.error) throw result.error
    const invoices = (result.data ?? [])
      .filter((row) => {
        const contractId = row.customer_contract_id ?? row.contract_id
        return contractId ? contractIds.has(String(contractId)) : false
      })
      .slice(0, 100)
      .map((row) => ({
        entity_id: row.invoice_reference,
        invoice_number: row.invoice_number,
        invoice_date: row.issued_at ? String(row.issued_at).slice(0, 10) : null,
        due_date: row.due_date,
        amount: row.amount_inc_vat,
        currency: row.currency ?? 'SEK',
        status: row.status,
      }))
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.list', id: context.id })
    return simpleJson({ invoices }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function resolveInvoice(companyId: string, invoiceReference: string) {
  const result = await supabaseService
    .from('customer_invoices')
    .select('id,invoice_reference,invoice_number,amount_inc_vat,currency,due_date,issued_at,status')
    .eq('company_id', companyId)
    .eq('invoice_reference', invoiceReference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new SimplePartnerApiError('Invoice not found.', 'invoice_not_found', 404)
  return result.data
}

async function getInvoice(request: NextRequest, invoiceReference: string) {
  const context = await auth(request, ['customer_invoices.read'])
  if (!context.ok) return context.response
  try {
    const invoice = await resolveInvoice(context.client.company_id, invoiceReference)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.get', id: context.id })
    return simpleJson({
      entity_id: invoice.invoice_reference,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.issued_at ? String(invoice.issued_at).slice(0, 10) : null,
      due_date: invoice.due_date,
      amount: invoice.amount_inc_vat,
      currency: invoice.currency ?? 'SEK',
      status: invoice.status,
    }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getInvoicePdf(request: NextRequest, invoiceReference: string) {
  const context = await auth(request, ['customer_invoices.read'])
  if (!context.ok) return context.response
  try {
    const invoice = await resolveInvoice(context.client.company_id, invoiceReference)
    const document = await supabaseService
      .from('customer_invoice_documents')
      .select('file_path,metadata')
      .eq('company_id', context.client.company_id)
      .eq('invoice_id', invoice.id)
      .eq('document_type', 'invoice_pdf')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (document.error) throw document.error
    if (!document.data) throw new SimplePartnerApiError('Invoice PDF is not available.', 'invoice_pdf_not_available', 404)
    const file = await resolveInvoicePdf(document.data)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.pdf', id: context.id })
    return simpleJson({
      entity_id: invoice.invoice_reference,
      file_base64: file.toString('base64'),
      file_extension: 'pdf',
    }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getMeasurements(request: NextRequest, customerReference: string, siteReference: string) {
  const context = await auth(request, ['customer_metering.read'])
  if (!context.ok) return context.response
  try {
    const { site } = await requireCustomerSite(context.client.company_id, customerReference, siteReference)
    const from = requireIsoDate(request.nextUrl.searchParams.get('from_date'), 'from_date')
    const to = requireIsoDate(request.nextUrl.searchParams.get('to_date'), 'to_date')
    const resolution = String(request.nextUrl.searchParams.get('resolution') ?? '1h').trim().toLowerCase()
    if (!['15m', '1h'].includes(resolution)) {
      throw new SimplePartnerApiError('resolution must be 15m or 1h.', 'resolution_invalid', 422, 'resolution')
    }
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T23:59:59.999Z`)
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (days < 1 || days > MAX_MEASUREMENT_DAYS) {
      throw new SimplePartnerApiError(`Date range must be 1-${MAX_MEASUREMENT_DAYS} days.`, 'measurement_range_invalid', 422)
    }
    const resolutionValues = resolution === '15m'
      ? ['15m', 'PT15M', 'quarterly']
      : ['1h', 'PT1H', 'hourly']
    const result = await supabaseService
      .from('normalized_metering_values')
      .select('period_start,quantity_kwh,unit,direction')
      .eq('company_id', context.client.company_id)
      .eq('customer_site_id', site.id)
      .gte('period_start', start.toISOString())
      .lte('period_start', end.toISOString())
      .in('resolution', resolutionValues)
      .order('period_start', { ascending: true })
      .limit(MAX_MEASUREMENT_ROWS)
    if (result.error) throw result.error
    const measurements = (result.data ?? []).map((row) => ({
      timestamp: row.period_start,
      value: row.quantity_kwh,
      unit: row.unit ?? 'kWh',
      type: String(row.direction ?? site.site_type ?? 'consumption').toUpperCase(),
    }))
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'measurement.list', id: context.id })
    return simpleJson({ site_id: site.facility_reference, measurements }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createWebhook(request: NextRequest) {
  const context = await auth(request, ['partner_webhooks.manage'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    assertNoTenantSelectors(body)
    ensureKeys(body, ['webhook_event', 'target_url', 'notification_email', 'signing_secret'])
    const externalEvent = String(body.webhook_event ?? '').trim().toUpperCase() as keyof typeof SIMPLE_WEBHOOK_EVENTS
    const internalEvent = SIMPLE_WEBHOOK_EVENTS[externalEvent]
    if (!internalEvent) {
      throw new SimplePartnerApiError('webhook_event is invalid.', 'webhook_event_invalid', 422, 'webhook_event')
    }
    const targetUrl = text(body.target_url)
    if (!targetUrl) throw new SimplePartnerApiError('target_url is required.', 'webhook_target_required', 422, 'target_url')
    await assertPublicWebhookTarget(targetUrl)
    const notificationEmail = text(body.notification_email)?.toLowerCase() ?? null
    if (notificationEmail && !notificationEmail.includes('@')) {
      throw new SimplePartnerApiError('notification_email is invalid.', 'notification_email_invalid', 422, 'notification_email')
    }
    const signingSecret = text(body.signing_secret)
    if (!signingSecret || signingSecret.length < 32) {
      throw new SimplePartnerApiError('signing_secret must contain at least 32 characters.', 'webhook_secret_too_short', 422, 'signing_secret')
    }
    const payloadForIdempotency = {
      webhook_event: externalEvent,
      target_url: targetUrl,
      notification_email: notificationEmail,
      signing_secret: `sha256:${createHash('sha256').update(signingSecret).digest('hex')}`,
    }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/webhook/subscription',
      payload: payloadForIdempotency,
      execute: async () => {
        const result = await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1', {
          p_company_id: context.client.company_id,
          p_api_client_id: context.client.id,
          p_name: `Partner ${externalEvent}`,
          p_endpoint_url: targetUrl,
          p_event_types: [internalEvent],
          p_secret: signingSecret,
          p_description: notificationEmail ? `Notification email: ${notificationEmail}` : null,
        })
        if (result.error) throw result.error
        const data = record(result.data)
        return { statusCode: 201, body: { entity_id: data.webhook_subscription_reference } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'webhook.create', id: context.id })
    return simpleJson(write.body, write.statusCode, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

export async function handleSimplePartnerApi(
  request: NextRequest,
  method: SimpleMethod,
  path: string[] | undefined,
): Promise<NextResponse | null> {
  const segments = (path ?? []).filter(Boolean)

  if (method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') {
    return NextResponse.json(partnerOpenApi, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    })
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'contract') {
    return createContract(request)
  }
  if (method === 'GET' && segments.length === 3 && segments[0] === 'contract' && segments[2] === 'state') {
    return getContractState(request, segments[1])
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'customer') {
    return createCustomer(request)
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'customer') {
    return getCustomer(request, segments[1])
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'customer' && segments[2] === 'site') {
    return createSite(request, segments[1])
  }
  if (method === 'GET' && segments.length === 4 && segments[0] === 'customer' && segments[2] === 'site') {
    return getSite(request, segments[1], segments[3])
  }

  if (
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'powerofattorney'
  ) {
    if (method === 'POST') return createPowerOfAttorney(request, segments[1], segments[3])
    if (method === 'GET') return getPowerOfAttorney(request, segments[1], segments[3])
  }

  if (
    method === 'GET' &&
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'invoice'
  ) {
    return getInvoices(request, segments[1], segments[3])
  }

  if (
    method === 'GET' &&
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'measurement'
  ) {
    return getMeasurements(request, segments[1], segments[3])
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'invoice') {
    return getInvoice(request, segments[1])
  }
  if (method === 'GET' && segments.length === 3 && segments[0] === 'invoice' && segments[2] === 'pdf') {
    return getInvoicePdf(request, segments[1])
  }

  if (method === 'POST' && segments.length === 2 && segments[0] === 'webhook' && segments[1] === 'subscription') {
    return createWebhook(request)
  }

  return null
}
