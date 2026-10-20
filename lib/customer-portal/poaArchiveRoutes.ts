import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { customerPortalJson, handleCustomerPortalRouteError } from '@/lib/customer-portal/externalApi'
import { resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'
import { CUSTOMER_ASSERTION_HEADER, gateCustomerAssertion } from '@/lib/customer-portal/customerAssertion'
import { currentIntegrationApiResponseContext, logIntegrationApiRequest, requireIntegrationApiAccess, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { isPoaVerificationReference, listCustomerPoaArchives, readCustomerPoaArchive } from '@/lib/customer-portal/poaArchiveRead'

const SCOPES = { allOf: ['customer_power_of_attorney.read', 'customer_documents.read'] }

/** New sensitive read boundary: require actual verified assertion even during a tenant's report rollout. */
async function authorize(request: NextRequest, startedAt: number, authenticated: (client: IntegrationApiClient) => void) {
  const auth = await requireIntegrationApiAccess(request, SCOPES)
  if (!auth.ok) {
    await logIntegrationApiRequest({ request, client: auth.client ?? null, startedAt, statusCode: auth.status, errorCode: auth.errorCode })
    return { ok: false as const, response: customerPortalJson({ error: { code: auth.errorCode, message: auth.error } }, { status: auth.status }) }
  }
  authenticated(auth.client)
  const resolved = await resolvePortalCustomer({ request, client: auth.client, strict: true, mode: 'read' })
  if (!resolved.ok) throw new ApiInputError(resolved.error, resolved.code, resolved.status)
  if (resolved.binding !== 'portal_account' || resolved.customer.company_id !== auth.client.company_id) {
    throw new ApiInputError('Fullmaktsdokument kräver en aktivt kopplad portalanvändare.', 'customer_identity_binding_required', 403)
  }
  const token = request.headers.get(CUSTOMER_ASSERTION_HEADER)
  if (token && token.length > 8192) throw new ApiInputError('Kundens signerade inloggningsintyg är för stort.', 'customer_assertion_invalid', 403)
  const proof = await gateCustomerAssertion({ companyId: auth.client.company_id, clientId: auth.client.id,
    expectedSubject: resolved.customer.customer_portal_user_id ?? resolved.customer.auth_user_id, token })
  if (!proof.allowed || !proof.verified) {
    const unconfigured = proof.allowed && proof.enforcement === 'none'
    throw new ApiInputError('Kundens signerade inloggningsintyg kunde inte verifieras.',
      unconfigured ? 'customer_assertion_configuration_required' : 'customer_assertion_invalid', unconfigured ? 503 : 403)
  }
  return { ok: true as const, client: auth.client, scope: { companyId: auth.client.company_id, customerId: resolved.customer.customer_id } }
}

function query(request: NextRequest, allowed: string[]) {
  for (const [key] of request.nextUrl.searchParams) {
    if (!allowed.includes(key) || request.nextUrl.searchParams.getAll(key).length !== 1) {
      throw new ApiInputError('Ogiltig eller upprepad frågeparameter.', 'invalid_query_parameter', 400, key)
    }
  }
}
async function success(request: NextRequest, client: IntegrationApiClient, startedAt: number, count: number) {
  await logIntegrationApiRequest({ request, client, startedAt, statusCode: 200, metadata: { result_count: count } })
}

export async function customerPoaEvidenceList(request: NextRequest) {
  const startedAt = Date.now()
  let client: IntegrationApiClient | null = null
  try {
    const access = await authorize(request, startedAt, value => { client = value })
    if (!access.ok) return access.response
    client = access.client
    query(request, ['limit', 'cursor'])
    const raw = request.nextUrl.searchParams.get('limit') ?? '50'
    if (!/^[1-9]\d{0,2}$/.test(raw) || Number(raw) > 100) throw new ApiInputError('limit ska vara 1–100.', 'invalid_limit', 400, 'limit')
    const cursor = request.nextUrl.searchParams.get('cursor')
    if (cursor && cursor.length > 2048) throw new ApiInputError('Ogiltig sidmarkör.', 'invalid_cursor', 400, 'cursor')
    const result = await listCustomerPoaArchives(access.scope, { limit: Number(raw), cursor })
    await success(request, client, startedAt, result.data.length)
    return customerPortalJson(result)
  } catch (error) { return handleCustomerPortalRouteError({ request, client, startedAt, error }) }
}

export async function customerPoaEvidenceDetail(request: NextRequest, context: { params: Promise<{ verificationReference: string }> }) {
  const startedAt = Date.now()
  let client: IntegrationApiClient | null = null
  try {
    const access = await authorize(request, startedAt, value => { client = value })
    if (!access.ok) return access.response
    client = access.client
    query(request, ['format', 'sha256'])
    const { verificationReference } = await context.params
    if (!isPoaVerificationReference(verificationReference)) throw new ApiInputError('Ogiltig verifikationsreferens.', 'invalid_verification_reference', 400)
    const format = request.nextUrl.searchParams.get('format') ?? 'json'
    if (!['json', 'pdf'].includes(format)) throw new ApiInputError('format ska vara json eller pdf.', 'invalid_format', 400, 'format')
    const hash = request.nextUrl.searchParams.get('sha256')?.toLowerCase() ?? null
    if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new ApiInputError('sha256 måste vara en SHA-256-kontrollsumma.', 'invalid_sha256', 400, 'sha256')
    if (format === 'pdf' && hash !== null) throw new ApiInputError('Kontrollsummejämförelse kräver format=json.', 'invalid_query_parameter', 400, 'sha256')
    const result = await readCustomerPoaArchive(access.scope, verificationReference, hash)
    await success(request, client, startedAt, 1)
    if (format === 'json') return customerPortalJson({ data: result.data })
    const headers = new Headers({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="fullmakt-${result.data.power_of_attorney_reference}.pdf"`,
      'X-Content-Type-Options': 'nosniff', 'X-Gridex-Document-SHA256': result.data.sha256,
      'X-Gridex-Verification-Reference': verificationReference, 'X-Request-ID': randomUUID() })
    const limits = currentIntegrationApiResponseContext()?.rateLimit
    if (limits) {
      headers.set('X-RateLimit-Limit', String(limits.limit)); headers.set('X-RateLimit-Remaining', String(limits.remaining))
      if (limits.resetAt) headers.set('X-RateLimit-Reset', limits.resetAt)
    }
    // Release bytes only after the complete archive proof above. Stream the
    // verified result so valid PDFs above the platform's buffered body limit
    // remain downloadable, with backpressure and bounded response chunks.
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const end = Math.min(offset + 64 * 1024, result.pdf.length)
        controller.enqueue(new Uint8Array(result.pdf.subarray(offset, end)))
        offset = end
        if (offset === result.pdf.length) controller.close()
      },
    })
    return new Response(stream, { headers })
  } catch (error) { return handleCustomerPortalRouteError({ request, client, startedAt, error }) }
}
