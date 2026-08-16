import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { handlePartnerApi } from './core'
import { PARTNER_API_VERSION } from './openApi'

type JsonObject = Record<string, unknown>
type CanonicalMethod = 'GET' | 'POST' | 'DELETE'

type RelationshipContext = {
  client: IntegrationApiClient
  customer: { id: string; customer_reference: string; customer_number: string | null }
  site: { id: string; customer_id: string; facility_reference: string }
  startedAt: number
  requestId: string
}

function requestId(request: NextRequest) {
  const candidate = request.headers.get('x-request-id')?.trim()
  return candidate && candidate.length <= 128 ? candidate : randomUUID()
}

function canonicalJson(body: JsonObject, status: number, id: string) {
  return NextResponse.json(
    { ...body, request_id: id, api_version: PARTNER_API_VERSION },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-ID': id,
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    },
  )
}

function canonicalError(request: NextRequest, status: number, code: string, message: string) {
  return canonicalJson({ error: { code, message } }, status, requestId(request))
}

async function rewriteJsonRequest(
  request: NextRequest,
  additions: Record<string, string>,
): Promise<NextRequest | NextResponse> {
  let body: JsonObject
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return canonicalError(request, 400, 'invalid_json_object', 'Request body must be a JSON object.')
    }
    body = parsed as JsonObject
  } catch {
    return canonicalError(request, 400, 'invalid_json', 'Request body must contain valid JSON.')
  }

  for (const [key, value] of Object.entries(additions)) {
    const supplied = body[key]
    if (typeof supplied === 'string' && supplied.trim() && supplied.trim() !== value) {
      return canonicalError(
        request,
        409,
        'path_body_reference_mismatch',
        `${key} must match the resource reference in the request path.`,
      )
    }
    body[key] = value
  }

  return new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  })
}

async function logFailure(input: {
  request: NextRequest
  client: IntegrationApiClient | null
  startedAt: number
  id: string
  status: number
  code: string
}) {
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: input.status,
    startedAt: input.startedAt,
    errorCode: input.code,
    metadata: { request_id: input.id, api_surface: 'partner_v1_canonical' },
  }).catch(() => undefined)
}

async function logSuccess(input: {
  request: NextRequest
  client: IntegrationApiClient
  startedAt: number
  id: string
  operation: string
}) {
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: 200,
    startedAt: input.startedAt,
    metadata: {
      request_id: input.id,
      api_surface: 'partner_v1_canonical',
      operation: input.operation,
    },
  }).catch(() => undefined)
}

async function requireCustomerSite(
  request: NextRequest,
  scopes: IntegrationScopeRequirement,
  customerReference: string,
  siteReference: string,
): Promise<{ ok: true; context: RelationshipContext } | { ok: false; response: NextResponse }> {
  const startedAt = Date.now()
  const id = requestId(request)
  const access = await requireIntegrationApiAccess(request, scopes)
  if (!access.ok) {
    await logFailure({
      request,
      client: access.client ?? null,
      startedAt,
      id,
      status: access.status,
      code: access.errorCode,
    })
    return {
      ok: false,
      response: canonicalJson(
        { error: { code: access.errorCode, message: access.error } },
        access.status,
        id,
      ),
    }
  }

  const customerResult = await supabaseService
    .from('customers')
    .select('id,customer_reference,customer_number')
    .eq('company_id', access.client.company_id)
    .eq('customer_reference', customerReference)
    .maybeSingle()

  if (customerResult.error) throw customerResult.error
  if (!customerResult.data) {
    await logFailure({ request, client: access.client, startedAt, id, status: 404, code: 'customer_not_found' })
    return { ok: false, response: canonicalJson({ error: { code: 'customer_not_found', message: 'Customer not found.' } }, 404, id) }
  }

  const siteResult = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,facility_reference')
    .eq('company_id', access.client.company_id)
    .eq('facility_reference', siteReference)
    .maybeSingle()

  if (siteResult.error) throw siteResult.error
  if (!siteResult.data || String(siteResult.data.customer_id) !== String(customerResult.data.id)) {
    await logFailure({ request, client: access.client, startedAt, id, status: 404, code: 'site_not_found' })
    return { ok: false, response: canonicalJson({ error: { code: 'site_not_found', message: 'Site not found for customer.' } }, 404, id) }
  }

  return {
    ok: true,
    context: {
      client: access.client,
      customer: customerResult.data,
      site: siteResult.data,
      startedAt,
      requestId: id,
    },
  }
}

async function getCanonicalSite(
  request: NextRequest,
  customerReference: string,
  siteReference: string,
) {
  const relation = await requireCustomerSite(
    request,
    ['customer_sites.read'],
    customerReference,
    siteReference,
  )
  if (!relation.ok) return relation.response
  return handlePartnerApi(request, 'GET', ['sites', siteReference])
}

async function getCanonicalMeasurements(
  request: NextRequest,
  customerReference: string,
  siteReference: string,
) {
  const relation = await requireCustomerSite(
    request,
    ['customer_metering.read'],
    customerReference,
    siteReference,
  )
  if (!relation.ok) return relation.response
  return handlePartnerApi(request, 'GET', ['sites', siteReference, 'measurements'])
}

async function getCanonicalPowerOfAttorney(
  request: NextRequest,
  customerReference: string,
  siteReference: string,
) {
  try {
    const relation = await requireCustomerSite(
      request,
      ['customer_power_of_attorney.read'],
      customerReference,
      siteReference,
    )
    if (!relation.ok) return relation.response
    const { context } = relation

    const result = await supabaseService
      .from('powers_of_attorney')
      .select('power_of_attorney_reference,status,scope,signed_at,valid_from,valid_to,method,revoked_at,document_path,evidence_payload,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.customer.id)
      .eq('customer_site_id', context.site.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (result.error) throw result.error
    if (!result.data) {
      await logFailure({ request, client: context.client, startedAt: context.startedAt, id: context.requestId, status: 404, code: 'power_of_attorney_not_found' })
      return canonicalJson({ error: { code: 'power_of_attorney_not_found', message: 'Power of attorney not found.' } }, 404, context.requestId)
    }

    const evidence = result.data.evidence_payload && typeof result.data.evidence_payload === 'object' && !Array.isArray(result.data.evidence_payload)
      ? result.data.evidence_payload as JsonObject
      : {}
    const data = {
      power_of_attorney_reference: result.data.power_of_attorney_reference,
      status: result.data.status,
      scope: result.data.scope,
      signed_at: result.data.signed_at,
      valid_from: result.data.valid_from,
      valid_to: result.data.valid_to,
      method: result.data.method,
      revoked_at: result.data.revoked_at,
      document_available: Boolean(result.data.document_path),
      evidence_reference: typeof evidence.evidence_reference === 'string' ? evidence.evidence_reference : null,
      transaction_type: typeof evidence.transaction_type === 'string' ? evidence.transaction_type : null,
    }
    await logSuccess({ request, client: context.client, startedAt: context.startedAt, id: context.requestId, operation: 'power_of_attorney.get_by_site' })
    return canonicalJson({ data }, 200, context.requestId)
  } catch (error) {
    console.error('[partner-api] canonical power-of-attorney lookup failed', { error })
    return canonicalError(request, 500, 'partner_api_internal_error', 'The request could not be completed.')
  }
}

async function getCanonicalSiteInvoices(
  request: NextRequest,
  customerReference: string,
  siteReference: string,
) {
  try {
    const relation = await requireCustomerSite(
      request,
      ['customer_invoices.read'],
      customerReference,
      siteReference,
    )
    if (!relation.ok) return relation.response
    const { context } = relation

    const contracts = await supabaseService
      .from('customer_contracts')
      .select('id')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.customer.id)
      .eq('customer_site_id', context.site.id)
    if (contracts.error) throw contracts.error
    const contractIds = new Set((contracts.data ?? []).map((row) => String(row.id)))

    const from = request.nextUrl.searchParams.get('from_date')
    const to = request.nextUrl.searchParams.get('to_date')
    let invoiceQuery = supabaseService
      .from('customer_invoices')
      .select('invoice_reference,invoice_number,period_start,period_end,amount_inc_vat,currency,due_date,issued_at,paid_at,status,contract_id,customer_contract_id')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.customer.id)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(200)

    if (from) invoiceQuery = invoiceQuery.gte('issued_at', `${from}T00:00:00.000Z`)
    if (to) invoiceQuery = invoiceQuery.lte('issued_at', `${to}T23:59:59.999Z`)
    const invoicesResult = await invoiceQuery
    if (invoicesResult.error) throw invoicesResult.error

    const invoices = (invoicesResult.data ?? [])
      .filter((row) => {
        const contractId = row.customer_contract_id ?? row.contract_id
        return contractId ? contractIds.has(String(contractId)) : false
      })
      .slice(0, 100)
      .map((row) => ({
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

    await logSuccess({ request, client: context.client, startedAt: context.startedAt, id: context.requestId, operation: 'invoice.list_by_site' })
    return canonicalJson({ data: { invoices } }, 200, context.requestId)
  } catch (error) {
    console.error('[partner-api] canonical invoice lookup failed', { error })
    return canonicalError(request, 500, 'partner_api_internal_error', 'The request could not be completed.')
  }
}

export async function handleCanonicalPartnerApi(
  request: NextRequest,
  method: CanonicalMethod,
  path: string[] | undefined,
): Promise<NextResponse | null> {
  const segments = (path ?? []).filter(Boolean)

  if (method === 'POST' && segments.length === 1 && segments[0] === 'contract') {
    return handlePartnerApi(request, 'POST', ['contracts'])
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'contract') {
    return handlePartnerApi(request, 'GET', ['contracts', segments[1]])
  }
  if (method === 'GET' && segments.length === 3 && segments[0] === 'contract' && segments[2] === 'state') {
    return handlePartnerApi(request, 'GET', ['contracts', segments[1], 'status'])
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'customer') {
    return handlePartnerApi(request, 'POST', ['customers'])
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'customer') {
    return handlePartnerApi(request, 'GET', ['customers', segments[1]])
  }

  if (method === 'POST' && segments.length === 3 && segments[0] === 'customer' && segments[2] === 'site') {
    const rewritten = await rewriteJsonRequest(request, { customer_reference: segments[1] })
    if (rewritten instanceof NextResponse) return rewritten
    return handlePartnerApi(rewritten, 'POST', ['sites'])
  }
  if (method === 'GET' && segments.length === 4 && segments[0] === 'customer' && segments[2] === 'site') {
    return getCanonicalSite(request, segments[1], segments[3])
  }

  if (
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'powerofattorney'
  ) {
    if (method === 'POST') {
      const rewritten = await rewriteJsonRequest(request, {
        customer_reference: segments[1],
        site_reference: segments[3],
      })
      if (rewritten instanceof NextResponse) return rewritten
      return handlePartnerApi(rewritten, 'POST', ['powers-of-attorney'])
    }
    if (method === 'GET') {
      return getCanonicalPowerOfAttorney(request, segments[1], segments[3])
    }
  }

  if (
    method === 'GET' &&
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'invoice'
  ) {
    return getCanonicalSiteInvoices(request, segments[1], segments[3])
  }

  if (
    method === 'GET' &&
    segments.length === 5 &&
    segments[0] === 'customer' &&
    segments[2] === 'site' &&
    segments[4] === 'measurement'
  ) {
    return getCanonicalMeasurements(request, segments[1], segments[3])
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'invoice') {
    return handlePartnerApi(request, 'GET', ['invoices', segments[1]])
  }
  if (method === 'GET' && segments.length === 3 && segments[0] === 'invoice' && segments[2] === 'pdf') {
    return handlePartnerApi(request, 'GET', ['invoices', segments[1], 'pdf'])
  }

  if (segments[0] === 'webhook' && segments[1] === 'subscription') {
    if (method === 'GET' && segments.length === 2) return handlePartnerApi(request, 'GET', ['webhooks', 'subscriptions'])
    if (method === 'POST' && segments.length === 2) return handlePartnerApi(request, 'POST', ['webhooks', 'subscriptions'])
    if (method === 'DELETE' && segments.length === 3) return handlePartnerApi(request, 'DELETE', ['webhooks', 'subscriptions', segments[2]])
  }

  return null
}
