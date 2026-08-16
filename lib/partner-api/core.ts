import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import {
  ApiInputError,
  executeIdempotentPortalWrite,
  readJsonObject,
  requireIsoDate,
} from '@/lib/api/strictRequest'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { PARTNER_API_VERSION, partnerOpenApi } from './openApi'

const POA_BUCKET = 'customer-documents'
const MAX_POA_BYTES = 5 * 1024 * 1024
const MAX_MEASUREMENT_DAYS = 366
const MAX_MEASUREMENT_ROWS = 40_000

type Json = Record<string, unknown>

class PartnerApiError extends Error {
  status: number
  code: string
  field?: string
  constructor(message: string, code: string, status = 400, field?: string) {
    super(message)
    this.name = 'PartnerApiError'
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

function lower(value: unknown): string | null {
  return text(value)?.toLowerCase() ?? null
}

function digits(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\D/g, '')
  return normalized || null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function requestId(request: NextRequest): string {
  const candidate = request.headers.get('x-request-id')?.trim()
  return candidate && candidate.length <= 128 ? candidate : randomUUID()
}

function safeError(error: unknown): { status: number; code: string; message: string; field?: string } {
  if (error instanceof PartnerApiError) return error
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
    [/partner_api_offer_not_found/i, 404, 'offer_not_found', 'The published offer was not found for this API client.'],
    [/partner_api_offer_reference_required/i, 422, 'offer_reference_required', 'offer_reference is required.'],
    [/partner_api_customer_email_required/i, 422, 'customer_email_required', 'customer.email is required.'],
    [/partner_api_external_customer_id_required/i, 422, 'external_customer_id_required', 'customer.external_customer_id is required.'],
    [/partner_api_customer_identity_number_required/i, 422, 'identity_number_required', 'Private customers require identity_number.'],
    [/partner_api_customer_organization_number_required/i, 422, 'organization_number_required', 'Business customers require organization_number.'],
    [/partner_api_site_address_required/i, 422, 'site_address_required', 'site street, postal_code and city are required.'],
    [/partner_api_agreement_evidence_required/i, 422, 'agreement_evidence_required', 'A signed agreement requires signer_name and evidence_reference.'],
    [/partner_api_customer_type_invalid/i, 422, 'customer_type_invalid', 'customer.type must be private, business or association.'],
    [/partner_api_site_electricity_type_invalid/i, 422, 'site_electricity_type_invalid', 'site.electricity_type must be consumption or production.'],
    [/duplicate key|23505/i, 409, 'resource_conflict', 'A resource with the same external reference already exists.'],
  ]
  const match = known.find(([pattern]) => pattern.test(message))
  if (match) return { status: match[1], code: match[2], message: match[3] }
  return {
    status: 500,
    code: 'partner_api_internal_error',
    message: 'The request could not be completed.',
  }
}

function partnerJson(body: Json, status = 200, id: string = randomUUID()): NextResponse {
  const envelope = {
    ...body,
    request_id: id,
    api_version: PARTNER_API_VERSION,
  }
  if (!('error' in envelope)) assertPublicResponsePayload(envelope)
  return NextResponse.json(envelope, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-ID': id,
      'X-Gridex-API-Version': PARTNER_API_VERSION,
    },
  })
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
      metadata: { request_id: id, api_surface: 'partner_v1' },
    })
    return {
      ok: false,
      response: partnerJson({
        error: {
          code: result.errorCode,
          message: result.error,
        },
      }, result.status, id),
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
      api_surface: 'partner_v1',
      operation: input.operation,
    },
  })
}

async function failureResponse(input: {
  request: NextRequest
  client: IntegrationApiClient | null
  startedAt: number
  id: string
  error: unknown
}) {
  const normalized = safeError(input.error)
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: normalized.status,
    startedAt: input.startedAt,
    errorCode: normalized.code,
    metadata: { request_id: input.id, api_surface: 'partner_v1' },
  }).catch(() => undefined)
  if (normalized.status >= 500) {
    console.error('[partner-api] request failed', {
      requestId: input.id,
      path: input.request.nextUrl.pathname,
      error: input.error,
    })
  }
  return partnerJson({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.field ? { field: normalized.field } : {}),
    },
  }, normalized.status, input.id)
}

function ensureKeys(body: Json, allowed: string[]) {
  const allow = new Set(allowed)
  const invalid = Object.keys(body).find((key) => !allow.has(key))
  if (invalid) {
    throw new PartnerApiError(`Unsupported field: ${invalid}`, 'unsupported_field', 422, invalid)
  }
  if ('company_id' in body || 'tenant_id' in body) {
    throw new PartnerApiError(
      'Tenant selection is not accepted in request payloads.',
      'tenant_selection_forbidden',
      422,
    )
  }
}

function normalizeCustomerType(value: unknown): 'private' | 'business' | 'association' {
  const normalized = lower(value) === 'company' ? 'business' : lower(value) ?? 'private'
  if (!['private', 'business', 'association'].includes(normalized)) {
    throw new PartnerApiError('Invalid customer type.', 'customer_type_invalid', 422, 'type')
  }
  return normalized as 'private' | 'business' | 'association'
}

function normalizeSiteType(value: unknown): 'consumption' | 'production' {
  const normalized = lower(value) ?? 'consumption'
  if (!['consumption', 'production'].includes(normalized)) {
    throw new PartnerApiError('Invalid site electricity type.', 'site_electricity_type_invalid', 422, 'electricity_type')
  }
  return normalized as 'consumption' | 'production'
}

function customerWrite(body: Json) {
  ensureKeys(body, [
    'external_customer_id', 'type', 'customer_type', 'first_name', 'last_name',
    'company_name', 'identity_number', 'soc_id', 'organization_number', 'org_number',
    'email', 'phone', 'cell_phone', 'invoice_address', 'zip_code', 'city', 'country',
    'metadata',
  ])
  const customerType = normalizeCustomerType(body.type ?? body.customer_type)
  const externalCustomerId = text(body.external_customer_id)
  const email = lower(body.email)
  const identityNumber = digits(body.identity_number ?? body.soc_id)
  const organizationNumber = digits(body.organization_number ?? body.org_number)
  if (!externalCustomerId) throw new PartnerApiError('external_customer_id is required.', 'external_customer_id_required', 422)
  if (!email || !email.includes('@')) throw new PartnerApiError('email is required.', 'customer_email_required', 422)
  if (customerType === 'private' && (!identityNumber || identityNumber.length < 10)) {
    throw new PartnerApiError('identity_number is required.', 'identity_number_required', 422)
  }
  if (customerType !== 'private' && (!organizationNumber || organizationNumber.length < 10)) {
    throw new PartnerApiError('organization_number is required.', 'organization_number_required', 422)
  }
  const invoiceAddress = record(body.invoice_address)
  return {
    customerType,
    externalCustomerId,
    email,
    identityNumber,
    organizationNumber,
    firstName: text(body.first_name),
    lastName: text(body.last_name),
    companyName: text(body.company_name),
    phone: text(body.phone ?? body.cell_phone),
    billingStreet: text(invoiceAddress.street ?? body.invoice_address),
    billingPostalCode: text(invoiceAddress.postal_code ?? body.zip_code),
    billingCity: text(invoiceAddress.city ?? body.city),
    billingCountry: (text(invoiceAddress.country ?? body.country) ?? 'SE').toUpperCase(),
    metadata: record(body.metadata),
  }
}

async function resolveCustomer(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customers')
    .select('id,customer_reference,customer_number,external_customer_id,customer_type,status,first_name,last_name,company_name,email,phone,billing_street,billing_postal_code,billing_city,billing_country')
    .eq('company_id', companyId)
    .eq('customer_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new PartnerApiError('Customer not found.', 'customer_not_found', 404)
  return result.data
}

async function resolveSite(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,facility_reference,facility_id,site_name,site_type,status,street,postal_code,city,country,price_area_code,grid_area_code,annual_consumption_kwh,move_in_date,data_quality_status')
    .eq('company_id', companyId)
    .eq('facility_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new PartnerApiError('Site not found.', 'site_not_found', 404)
  return result.data
}

async function resolveContract(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customer_contracts')
    .select('id,customer_id,customer_site_id,customer_contract_reference,contract_number,status,status_reason_code,contract_name,contract_type,offer_reference,energy_direction,requested_start_date,confirmed_start_date,actual_start_date,signed_at,starts_at,ends_at,created_at,updated_at,customer_number')
    .eq('company_id', companyId)
    .eq('customer_contract_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new PartnerApiError('Contract not found.', 'contract_not_found', 404)
  return result.data
}

async function uploadPoaPdf(companyId: string, value: unknown, extension: unknown) {
  const raw = text(value)
  if (!raw) return null
  const ext = (text(extension) ?? 'pdf').toLowerCase().replace(/^\./, '')
  if (ext !== 'pdf') {
    throw new PartnerApiError('Only PDF is accepted for power of attorney documents.', 'poa_file_type_invalid', 422, 'file_extension')
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    throw new PartnerApiError('file_base64 is invalid.', 'poa_file_base64_invalid', 422, 'file_base64')
  }
  const bytes = Buffer.from(raw.replace(/\s/g, ''), 'base64')
  if (!bytes.length || bytes.length > MAX_POA_BYTES) {
    throw new PartnerApiError('Power of attorney PDF must be between 1 byte and 5 MB.', 'poa_file_size_invalid', 413, 'file_base64')
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new PartnerApiError('The uploaded document is not a PDF.', 'poa_file_signature_invalid', 422, 'file_base64')
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  const path = `partner-api/${companyId}/${randomUUID()}.pdf`
  const uploaded = await supabaseService.storage.from(POA_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploaded.error) throw uploaded.error
  return { path, sha256: digest }
}

async function cleanupPoa(path: string | null | undefined) {
  if (!path) return
  await supabaseService.storage.from(POA_BUCKET).remove([path]).catch(() => undefined)
}

function publicCustomer(row: Record<string, unknown>) {
  return {
    customer_reference: row.customer_reference ?? null,
    customer_number: row.customer_number ?? null,
    external_customer_id: row.external_customer_id ?? null,
    type: row.customer_type ?? null,
    status: row.status ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    company_name: row.company_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    invoice_address: {
      street: row.billing_street ?? null,
      postal_code: row.billing_postal_code ?? null,
      city: row.billing_city ?? null,
      country: row.billing_country ?? null,
    },
  }
}

function publicSite(row: Record<string, unknown>) {
  return {
    site_reference: row.facility_reference ?? null,
    name: row.site_name ?? null,
    status: row.status ?? null,
    electricity_type: row.site_type ?? null,
    facility_id: row.facility_id ?? null,
    address: {
      street: row.street ?? null,
      postal_code: row.postal_code ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
    },
    price_area: row.price_area_code ?? null,
    grid_area: row.grid_area_code ?? null,
    annual_consumption_kwh: row.annual_consumption_kwh ?? null,
    move_in_date: row.move_in_date ?? null,
    data_quality_status: row.data_quality_status ?? null,
  }
}

function publicContract(row: Record<string, unknown>) {
  return {
    contract_reference: row.customer_contract_reference ?? null,
    contract_number: row.contract_number ?? null,
    customer_number: row.customer_number ?? null,
    status: row.status ?? null,
    status_reason: row.status_reason_code ?? null,
    name: row.contract_name ?? null,
    contract_type: row.contract_type ?? null,
    offer_reference: row.offer_reference ?? null,
    electricity_type: row.energy_direction ?? null,
    requested_start_date: row.requested_start_date ?? null,
    confirmed_start_date: row.confirmed_start_date ?? null,
    actual_start_date: row.actual_start_date ?? null,
    signed_at: row.signed_at ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }
}

async function createCustomer(request: NextRequest) {
  const context = await auth(request, ['partner_customers.write'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    const normalized = customerWrite(body)
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/customers',
      payload: body,
      execute: async () => {
        const result = await supabaseService
          .from('customers')
          .insert({
            company_id: context.client.company_id,
            customer_type: normalized.customerType,
            status: 'active',
            first_name: normalized.firstName,
            last_name: normalized.lastName,
            full_name: text(`${normalized.firstName ?? ''} ${normalized.lastName ?? ''}`),
            company_name: normalized.companyName,
            personal_number: normalized.customerType === 'private' ? normalized.identityNumber : null,
            identity_number: normalized.customerType === 'private' ? normalized.identityNumber : null,
            org_number: normalized.customerType === 'private' ? null : normalized.organizationNumber,
            organization_number: normalized.customerType === 'private' ? null : normalized.organizationNumber,
            email: normalized.email,
            phone: normalized.phone,
            source: 'api',
            acquisition_channel: 'partner_api',
            external_customer_id: normalized.externalCustomerId,
            billing_street: normalized.billingStreet,
            billing_postal_code: normalized.billingPostalCode,
            billing_city: normalized.billingCity,
            billing_country: normalized.billingCountry,
            metadata: {
              source_channel: 'partner_api',
              api_client_id: context.client.id,
              external_payload_metadata: normalized.metadata,
            },
          })
          .select('customer_reference,customer_number,external_customer_id')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { data: result.data } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'customer.create', id: context.id })
    return partnerJson(write.body, write.statusCode, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createSite(request: NextRequest) {
  const context = await auth(request, ['partner_sites.write'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    ensureKeys(body, [
      'customer_reference', 'name', 'electricity_type', 'site_electricity_type',
      'facility_id', 'address', 'street', 'postal_code', 'zip_code', 'city', 'country',
      'move_in_date', 'annual_consumption_kwh',
    ])
    const customerReference = text(body.customer_reference)
    if (!customerReference) throw new PartnerApiError('customer_reference is required.', 'customer_reference_required', 422)
    const customer = await resolveCustomer(context.client.company_id, customerReference)
    const address = record(body.address)
    const street = text(address.street ?? body.street)
    const postalCode = text(address.postal_code ?? body.postal_code ?? body.zip_code)
    const city = text(address.city ?? body.city)
    if (!street || !postalCode || !city) throw new PartnerApiError('street, postal_code and city are required.', 'site_address_required', 422)
    const siteType = normalizeSiteType(body.electricity_type ?? body.site_electricity_type)
    const moveInDate = body.move_in_date ? requireIsoDate(body.move_in_date, 'move_in_date') : null
    const annual = body.annual_consumption_kwh === undefined || body.annual_consumption_kwh === null
      ? null
      : Number(body.annual_consumption_kwh)
    if (annual !== null && (!Number.isFinite(annual) || annual < 0)) {
      throw new PartnerApiError('annual_consumption_kwh must be a non-negative number.', 'annual_consumption_invalid', 422)
    }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: String(customer.id),
      operation: '/api/partner/v1/sites',
      payload: body,
      execute: async () => {
        const result = await supabaseService
          .from('customer_sites')
          .insert({
            company_id: context.client.company_id,
            customer_id: customer.id,
            site_name: text(body.name) ?? `${street}, ${city}`,
            site_type: siteType,
            status: 'draft',
            facility_id: digits(body.facility_id),
            street,
            address: street,
            postal_code: postalCode,
            city,
            country: (text(address.country ?? body.country) ?? 'SE').toUpperCase(),
            move_in_date: moveInDate,
            annual_consumption_kwh: annual,
            metadata: { source_channel: 'partner_api', api_client_id: context.client.id },
          })
          .select('facility_reference,facility_id,site_name,site_type,status,street,postal_code,city,country,move_in_date,annual_consumption_kwh')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { data: publicSite(result.data) } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'site.create', id: context.id })
    return partnerJson(write.body, write.statusCode, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

function poaNormalized(body: Json) {
  ensureKeys(body, [
    'customer_reference', 'site_reference', 'contract_reference', 'accepted', 'accepted_at',
    'signer_name', 'signer_identity_number', 'poa_type', 'transaction_type',
    'evidence_reference', 'file_base64', 'file_extension',
  ])
  if (bool(body.accepted) !== true) {
    throw new PartnerApiError('accepted must be true for a signed power of attorney.', 'power_of_attorney_not_accepted', 422, 'accepted')
  }
  const customerReference = text(body.customer_reference)
  const siteReference = text(body.site_reference)
  const signerName = text(body.signer_name)
  const evidenceReference = text(body.evidence_reference)
  if (!customerReference) throw new PartnerApiError('customer_reference is required.', 'customer_reference_required', 422)
  if (!siteReference) throw new PartnerApiError('site_reference is required.', 'site_reference_required', 422)
  if (!signerName) throw new PartnerApiError('signer_name is required.', 'signer_name_required', 422)
  if (!evidenceReference) throw new PartnerApiError('evidence_reference is required.', 'evidence_reference_required', 422)
  return {
    customerReference,
    siteReference,
    contractReference: text(body.contract_reference),
    acceptedAt: text(body.accepted_at) ?? new Date().toISOString(),
    signerName,
    signerIdentityNumber: digits(body.signer_identity_number),
    poaType: lower(body.poa_type) ?? 'web',
    transactionType: (text(body.transaction_type) ?? 'SWITCH').toUpperCase(),
    evidenceReference,
  }
}

async function createPowerOfAttorney(request: NextRequest) {
  const context = await auth(request, ['partner_power_of_attorney.write'])
  if (!context.ok) return context.response
  let uploadedPath: string | null = null
  try {
    const body = await readJsonObject(request, 7 * 1024 * 1024)
    const normalized = poaNormalized(body)
    const customer = await resolveCustomer(context.client.company_id, normalized.customerReference)
    const site = await resolveSite(context.client.company_id, normalized.siteReference)
    if (String(site.customer_id) !== String(customer.id)) {
      throw new PartnerApiError('Site does not belong to customer.', 'site_customer_mismatch', 409)
    }
    let contractId: string | null = null
    if (normalized.contractReference) {
      const contract = await resolveContract(context.client.company_id, normalized.contractReference)
      if (String(contract.customer_id) !== String(customer.id) || String(contract.customer_site_id ?? '') !== String(site.id)) {
        throw new PartnerApiError('Contract does not belong to customer/site.', 'contract_resource_mismatch', 409)
      }
      contractId = String(contract.id)
    }
    const file = await uploadPoaPdf(context.client.company_id, body.file_base64, body.file_extension)
    uploadedPath = file?.path ?? null
    const idempotencyPayload = { ...body, file_base64: file ? `sha256:${file.sha256}` : null }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: String(customer.id),
      operation: '/api/partner/v1/powers-of-attorney',
      payload: idempotencyPayload,
      execute: async () => {
        const result = await supabaseService
          .from('powers_of_attorney')
          .insert({
            company_id: context.client.company_id,
            customer_id: customer.id,
            site_id: site.id,
            customer_site_id: site.id,
            contract_id: contractId,
            customer_contract_id: contractId,
            scope: 'supplier_switch',
            status: 'signed',
            signed_at: normalized.acceptedAt,
            accepted_at: normalized.acceptedAt,
            signer_name: normalized.signerName,
            signer_identity_number: normalized.signerIdentityNumber,
            method: normalized.poaType,
            accepted_source: 'partner_api',
            source: 'partner_api',
            document_path: file?.path ?? null,
            document_hash: file?.sha256 ?? null,
            evidence_payload: {
              evidence_reference: normalized.evidenceReference,
              transaction_type: normalized.transactionType,
            },
            metadata: { source_channel: 'partner_api', api_client_id: context.client.id },
            customer_number: customer.customer_number,
            external_customer_id: customer.external_customer_id,
          })
          .select('power_of_attorney_reference,status,signed_at,method')
          .single()
        if (result.error) throw result.error
        return { statusCode: 201, body: { data: result.data } }
      },
    })
    if (write.replayed && uploadedPath) await cleanupPoa(uploadedPath)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'power_of_attorney.create', id: context.id })
    return partnerJson(write.body, write.statusCode, context.id)
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
    ensureKeys(body, [
      'offer_reference', 'external_customer_id', 'customer', 'site', 'agreement',
      'power_of_attorney', 'requested_start_date', 'requested_start_mode', 'metadata',
    ])
    const customerBody = record(body.customer)
    customerWrite({ ...customerBody, external_customer_id: customerBody.external_customer_id ?? body.external_customer_id })
    const siteBody = record(body.site)
    normalizeSiteType(siteBody.electricity_type ?? siteBody.site_electricity_type)
    const siteAddress = record(siteBody.address)
    const siteStreet = text(
      siteAddress.street ??
      siteBody.street ??
      (typeof siteBody.address === 'string' ? siteBody.address : null),
    )
    const sitePostalCode = text(siteAddress.postal_code ?? siteBody.postal_code ?? siteBody.zip_code)
    const siteCity = text(siteAddress.city ?? siteBody.city)
    const siteCountry = (text(siteAddress.country ?? siteBody.country) ?? 'SE').toUpperCase()
    if (!siteStreet || !sitePostalCode || !siteCity) {
      throw new PartnerApiError(
        'site.address.street, postal_code and city are required.',
        'site_address_required',
        422,
        'site.address',
      )
    }
    body.site = {
      ...siteBody,
      street: siteStreet,
      address: siteStreet,
      postal_code: sitePostalCode,
      city: siteCity,
      country: siteCountry,
    }
    if (!text(body.offer_reference)) throw new PartnerApiError('offer_reference is required.', 'offer_reference_required', 422)
    if (body.requested_start_date) requireIsoDate(body.requested_start_date, 'requested_start_date')
    const startMode = lower(body.requested_start_mode) ?? 'earliest_possible'
    if (!['earliest_possible', 'specific_date'].includes(startMode)) {
      throw new PartnerApiError('requested_start_mode is invalid.', 'requested_start_mode_invalid', 422)
    }
    const agreement = record(body.agreement)
    if (agreement.accepted_at) {
      if (!text(agreement.signer_name) || !text(agreement.evidence_reference)) {
        throw new PartnerApiError('Signed agreement requires signer_name and evidence_reference.', 'agreement_evidence_required', 422)
      }
      const accepted = new Date(String(agreement.accepted_at))
      if (Number.isNaN(accepted.getTime())) throw new PartnerApiError('agreement.accepted_at is invalid.', 'agreement_accepted_at_invalid', 422)
      if (agreement.distance_agreement !== undefined && bool(agreement.distance_agreement) === null) {
        throw new PartnerApiError('agreement.distance_agreement must be boolean.', 'agreement_distance_invalid', 422)
      }
    }
    const poa = record(body.power_of_attorney)
    if (Object.keys(poa).length) {
      if (bool(poa.accepted) !== true) throw new PartnerApiError('power_of_attorney.accepted must be true.', 'power_of_attorney_not_accepted', 422)
      if (!text(poa.signer_name) || !text(poa.evidence_reference)) {
        throw new PartnerApiError('Power of attorney requires signer_name and evidence_reference.', 'power_of_attorney_evidence_required', 422)
      }
      const file = await uploadPoaPdf(context.client.company_id, poa.file_base64, poa.file_extension)
      uploadedPath = file?.path ?? null
      body.power_of_attorney = {
        ...poa,
        document_path: file?.path ?? null,
        document_sha256: file?.sha256 ?? null,
      }
    }
    const idempotencyPayload = {
      ...body,
      power_of_attorney: Object.keys(record(body.power_of_attorney)).length
        ? {
            ...record(body.power_of_attorney),
            file_base64: undefined,
            document_path: undefined,
            document_sha256: text(record(body.power_of_attorney).document_sha256),
          }
        : undefined,
    }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/contracts',
      payload: idempotencyPayload,
      execute: async () => {
        const result = await supabaseService.rpc('gridex_create_partner_contract_v1', {
          p_company_id: context.client.company_id,
          p_api_client_id: context.client.id,
          p_payload: body,
        })
        if (result.error) throw result.error
        return { statusCode: 201, body: { data: result.data as unknown } }
      },
    })
    if (write.replayed && uploadedPath) await cleanupPoa(uploadedPath)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'contract.create', id: context.id })
    return partnerJson(write.body, write.statusCode, context.id)
  } catch (error) {
    await cleanupPoa(uploadedPath)
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function createWebhook(request: NextRequest) {
  const context = await auth(request, ['partner_webhooks.manage'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    ensureKeys(body, ['name', 'endpoint_url', 'event_types', 'signing_secret', 'description'])
    const name = text(body.name)
    const endpointUrl = text(body.endpoint_url)
    const secret = text(body.signing_secret)
    const eventTypes = Array.isArray(body.event_types)
      ? body.event_types.map((item) => text(item)).filter((item): item is string => Boolean(item))
      : []
    if (!name) throw new PartnerApiError('name is required.', 'webhook_name_required', 422)
    if (!endpointUrl || !endpointUrl.startsWith('https://')) throw new PartnerApiError('endpoint_url must use HTTPS.', 'webhook_https_required', 422)
    if (!secret || secret.length < 32) throw new PartnerApiError('signing_secret must contain at least 32 characters.', 'webhook_secret_too_short', 422)
    if (!eventTypes.length) throw new PartnerApiError('event_types is required.', 'webhook_event_types_required', 422)
    const secretHash = createHash('sha256').update(secret).digest('hex')
    const payloadForIdempotency = { ...body, signing_secret: `sha256:${secretHash}` }
    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/webhooks/subscriptions',
      payload: payloadForIdempotency,
      execute: async () => {
        const result = await supabaseService.rpc('gridex_create_partner_webhook_subscription_v1', {
          p_company_id: context.client.company_id,
          p_api_client_id: context.client.id,
          p_name: name,
          p_endpoint_url: endpointUrl,
          p_event_types: eventTypes,
          p_secret: secret,
          p_description: text(body.description),
        })
        if (result.error) throw result.error
        return { statusCode: 201, body: { data: result.data as unknown } }
      },
    })
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: write.statusCode, operation: 'webhook.create', id: context.id })
    return partnerJson(write.body, write.statusCode, context.id)
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
    return partnerJson({ data: publicCustomer(customer) }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getSite(request: NextRequest, siteReference: string) {
  const context = await auth(request, ['customer_sites.read'])
  if (!context.ok) return context.response
  try {
    const site = await resolveSite(context.client.company_id, siteReference)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'site.get', id: context.id })
    return partnerJson({ data: publicSite(site) }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getContract(request: NextRequest, contractReference: string, statusOnly: boolean) {
  const context = await auth(request, ['customer_contracts.read'])
  if (!context.ok) return context.response
  try {
    const contract = await resolveContract(context.client.company_id, contractReference)
    const data = statusOnly
      ? {
          contract_reference: contract.customer_contract_reference,
          status: contract.status,
          status_reason: contract.status_reason_code ?? null,
          requested_start_date: contract.requested_start_date ?? null,
          confirmed_start_date: contract.confirmed_start_date ?? null,
          actual_start_date: contract.actual_start_date ?? null,
          updated_at: contract.updated_at ?? null,
        }
      : publicContract(contract)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: statusOnly ? 'contract.status' : 'contract.get', id: context.id })
    return partnerJson({ data }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function getPoa(request: NextRequest, reference: string) {
  const context = await auth(request, ['customer_power_of_attorney.read'])
  if (!context.ok) return context.response
  try {
    const result = await supabaseService
      .from('powers_of_attorney')
      .select('power_of_attorney_reference,status,scope,signed_at,valid_from,valid_to,method,revoked_at,document_path,evidence_payload')
      .eq('company_id', context.client.company_id)
      .eq('power_of_attorney_reference', reference)
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new PartnerApiError('Power of attorney not found.', 'power_of_attorney_not_found', 404)
    const row = result.data
    const data = {
      power_of_attorney_reference: row.power_of_attorney_reference,
      status: row.status,
      scope: row.scope,
      signed_at: row.signed_at,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      method: row.method,
      revoked_at: row.revoked_at,
      document_available: Boolean(row.document_path),
      evidence_reference: text(record(row.evidence_payload).evidence_reference),
      transaction_type: text(record(row.evidence_payload).transaction_type),
    }
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'power_of_attorney.get', id: context.id })
    return partnerJson({ data }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function invoicesForCustomer(request: NextRequest, customerReference: string) {
  const context = await auth(request, ['customer_invoices.read'])
  if (!context.ok) return context.response
  try {
    const customer = await resolveCustomer(context.client.company_id, customerReference)
    const from = request.nextUrl.searchParams.get('from_date')
    const to = request.nextUrl.searchParams.get('to_date')
    let query = supabaseService
      .from('customer_invoices')
      .select('invoice_reference,invoice_number,period_start,period_end,amount_inc_vat,currency,due_date,issued_at,paid_at,status')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', customer.id)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(100)
    if (from) query = query.gte('issued_at', requireIsoDate(from, 'from_date'))
    if (to) query = query.lte('issued_at', `${requireIsoDate(to, 'to_date')}T23:59:59.999Z`)
    const result = await query
    if (result.error) throw result.error
    const invoices = (result.data ?? []).map((row) => ({
      invoice_reference: row.invoice_reference,
      invoice_number: row.invoice_number,
      period_start: row.period_start,
      period_end: row.period_end,
      amount: row.amount_inc_vat,
      currency: row.currency,
      due_date: row.due_date,
      invoice_date: row.issued_at,
      paid_at: row.paid_at,
      status: row.status,
    }))
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.list', id: context.id })
    return partnerJson({ data: { invoices } }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function resolveInvoice(companyId: string, reference: string) {
  const result = await supabaseService
    .from('customer_invoices')
    .select('id,invoice_reference,invoice_number,period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,due_date,issued_at,paid_at,status')
    .eq('company_id', companyId)
    .eq('invoice_reference', reference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new PartnerApiError('Invoice not found.', 'invoice_not_found', 404)
  return result.data
}

async function getInvoice(request: NextRequest, reference: string, pdf: boolean) {
  const context = await auth(request, ['customer_invoices.read'])
  if (!context.ok) return context.response
  try {
    const invoice = await resolveInvoice(context.client.company_id, reference)
    if (pdf) {
      const document = await supabaseService
        .from('customer_invoice_documents')
        .select('public_url')
        .eq('company_id', context.client.company_id)
        .eq('invoice_id', invoice.id)
        .eq('document_type', 'invoice_pdf')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (document.error) throw document.error
      const downloadUrl = text(document.data?.public_url)
      if (!downloadUrl || !downloadUrl.startsWith('https://')) {
        throw new PartnerApiError('Invoice PDF is not available.', 'invoice_pdf_not_available', 404)
      }
      await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.pdf', id: context.id })
      return partnerJson({
        data: {
          invoice_reference: invoice.invoice_reference,
          download_url: downloadUrl,
          content_type: 'application/pdf',
        },
      }, 200, context.id)
    }
    const data = {
      invoice_reference: invoice.invoice_reference,
      invoice_number: invoice.invoice_number,
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      total_kwh: invoice.total_kwh,
      amount_ex_vat: invoice.amount_ex_vat,
      vat_amount: invoice.vat_amount,
      amount: invoice.amount_inc_vat,
      currency: invoice.currency,
      due_date: invoice.due_date,
      invoice_date: invoice.issued_at,
      paid_at: invoice.paid_at,
      status: invoice.status,
    }
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'invoice.get', id: context.id })
    return partnerJson({ data }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function measurements(request: NextRequest, siteReference: string) {
  const context = await auth(request, ['customer_metering.read'])
  if (!context.ok) return context.response
  try {
    const site = await resolveSite(context.client.company_id, siteReference)
    const from = requireIsoDate(request.nextUrl.searchParams.get('from_date'), 'from_date')
    const to = requireIsoDate(request.nextUrl.searchParams.get('to_date'), 'to_date')
    const resolution = lower(request.nextUrl.searchParams.get('resolution')) ?? '1h'
    if (!['15m', '1h'].includes(resolution)) {
      throw new PartnerApiError('resolution must be 15m or 1h.', 'resolution_invalid', 422, 'resolution')
    }
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T23:59:59.999Z`)
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (days < 1 || days > MAX_MEASUREMENT_DAYS) {
      throw new PartnerApiError(`Date range must be 1-${MAX_MEASUREMENT_DAYS} days.`, 'measurement_range_invalid', 422)
    }
    const resolutionValues = resolution === '15m'
      ? ['15m', 'PT15M', 'quarterly']
      : ['1h', 'PT1H', 'hourly']
    const result = await supabaseService
      .from('normalized_metering_values')
      .select('period_start,period_end,resolution,quantity_kwh,unit,direction,quality_status')
      .eq('company_id', context.client.company_id)
      .eq('customer_site_id', site.id)
      .gte('period_start', start.toISOString())
      .lte('period_end', end.toISOString())
      .in('resolution', resolutionValues)
      .order('period_start', { ascending: true })
      .limit(MAX_MEASUREMENT_ROWS)
    if (result.error) throw result.error
    const values = (result.data ?? []).map((row) => ({
      timestamp: row.period_start,
      period_end: row.period_end,
      resolution,
      value: row.quantity_kwh,
      unit: row.unit ?? 'kWh',
      type: String(row.direction ?? site.site_type ?? 'consumption').toUpperCase(),
      quality: row.quality_status ?? null,
    }))
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'measurement.list', id: context.id })
    return partnerJson({
      data: {
        site_reference: site.facility_reference,
        resolution,
        measurements: values,
      },
    }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function listWebhooks(request: NextRequest) {
  const context = await auth(request, ['partner_webhooks.manage'])
  if (!context.ok) return context.response
  try {
    const result = await supabaseService
      .from('webhook_subscriptions')
      .select('webhook_subscription_reference,name,endpoint_url,event_types,status,created_at,last_success_at,last_failure_at,failure_count')
      .eq('company_id', context.client.company_id)
      .eq('api_client_id', context.client.id)
      .order('created_at', { ascending: false })
    if (result.error) throw result.error
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'webhook.list', id: context.id })
    return partnerJson({ data: { subscriptions: result.data ?? [] } }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

async function deleteWebhook(request: NextRequest, reference: string) {
  const context = await auth(request, ['partner_webhooks.manage'])
  if (!context.ok) return context.response
  try {
    const result = await supabaseService.rpc('gridex_delete_partner_webhook_subscription_v1', {
      p_company_id: context.client.company_id,
      p_api_client_id: context.client.id,
      p_subscription_reference: reference,
    })
    if (result.error) throw result.error
    if (result.data !== true) throw new PartnerApiError('Webhook subscription not found.', 'webhook_not_found', 404)
    await successLog({ request, client: context.client, startedAt: context.startedAt, status: 200, operation: 'webhook.delete', id: context.id })
    return partnerJson({ data: { deleted: true, webhook_subscription_reference: reference } }, 200, context.id)
  } catch (error) {
    return failureResponse({ request, client: context.client, startedAt: context.startedAt, id: context.id, error })
  }
}

function parts(path: string[] | undefined) {
  return (path ?? []).filter(Boolean)
}

export async function handlePartnerApi(
  request: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  path: string[] | undefined,
) {
  const segments = parts(path)

  if (method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') {
    return NextResponse.json(partnerOpenApi, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    })
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'contracts') return createContract(request)
  if (method === 'GET' && segments.length === 2 && segments[0] === 'contracts') return getContract(request, segments[1], false)
  if (method === 'GET' && segments.length === 3 && segments[0] === 'contracts' && segments[2] === 'status') return getContract(request, segments[1], true)

  if (method === 'POST' && segments.length === 1 && segments[0] === 'customers') return createCustomer(request)
  if (method === 'GET' && segments.length === 2 && segments[0] === 'customers') return getCustomer(request, segments[1])
  if (method === 'GET' && segments.length === 3 && segments[0] === 'customers' && segments[2] === 'invoices') return invoicesForCustomer(request, segments[1])

  if (method === 'POST' && segments.length === 1 && segments[0] === 'sites') return createSite(request)
  if (method === 'GET' && segments.length === 2 && segments[0] === 'sites') return getSite(request, segments[1])
  if (method === 'GET' && segments.length === 3 && segments[0] === 'sites' && segments[2] === 'measurements') return measurements(request, segments[1])

  if (method === 'POST' && segments.length === 1 && segments[0] === 'powers-of-attorney') return createPowerOfAttorney(request)
  if (method === 'GET' && segments.length === 2 && segments[0] === 'powers-of-attorney') return getPoa(request, segments[1])

  if (method === 'GET' && segments.length === 2 && segments[0] === 'invoices') return getInvoice(request, segments[1], false)
  if (method === 'GET' && segments.length === 3 && segments[0] === 'invoices' && segments[2] === 'pdf') return getInvoice(request, segments[1], true)

  if (segments[0] === 'webhooks' && segments[1] === 'subscriptions') {
    if (method === 'GET' && segments.length === 2) return listWebhooks(request)
    if (method === 'POST' && segments.length === 2) return createWebhook(request)
    if (method === 'DELETE' && segments.length === 3) return deleteWebhook(request, segments[2])
  }

  return partnerJson({
    error: {
      code: 'route_not_found',
      message: 'Partner API route not found.',
    },
  }, 404, requestId(request))
}
