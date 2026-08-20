import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import {
  customerPortalJson,
} from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { processWebsiteCustomerApplication } from '@/lib/website/customerApplications'
import { scheduleUsageEvent } from '@/lib/audit/actionLogger'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import { publicWebsiteCustomerApplicationData } from '@/lib/website/publicCustomerApplication'
import { canonicalApiError } from '@/lib/api/apiError'
import { bindPayloadToTenant, TenantContextError } from '@/lib/tenant/context'
import { loadTenantWebsiteFlowReadiness } from '@/lib/integrations/tenantWebsiteReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record[field] === 'string' && record[field].trim() ? record[field] : null
}

function requestAudit(request: NextRequest, requestId: string) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  return {
    ipAddress: forwardedFor,
    ipHash: forwardedFor ? createHash('sha256').update(forwardedFor).digest('hex') : null,
    userAgent: request.headers.get('user-agent')?.slice(0, 1000) || null,
    requestId,
    traceId: request.headers.get('traceparent')?.slice(0, 255) || requestId,
  }
}

function readField(value: unknown, field: string): unknown {
  if (!value || typeof value !== 'object') return null
  return (value as Record<string, unknown>)[field] ?? null
}

// Builds the standard JSON error contract:
//   { error: { code, message, stage, field, request_id, action? }, ... }
// Legacy flat keys (code, error_stage, field, hint, details) are preserved
// alongside the nested object for backward compatibility.
function publicApplicationErrorCode(value: unknown): string {
  const code = typeof value === 'string' && value.trim() ? value.trim() : 'website_application_error'
  return code.startsWith('tenant_') ? code.replace(/^tenant_/, 'organization_') : code
}

function publicApplicationMessage(code: string): string {
  if (code.includes('idempotency')) return 'The request could not be completed with the supplied Idempotency-Key.'
  if (code.includes('quote')) return 'The authoritative quote could not be validated for this application.'
  if (code.includes('legal') || code.includes('acceptance')) return 'The legal acceptance evidence could not be validated.'
  if (code.includes('power_of_attorney')) return 'The power-of-attorney evidence could not be validated.'
  if (code.includes('portal_auth')) return 'The verified customer identity could not be validated.'
  if (code.includes('organization') || code.includes('integration')) return 'The integration is not currently ready to accept this request.'
  if (code.includes('payload') || code.includes('json') || code.includes('validation') || code.includes('required') || code.includes('invalid')) return 'The customer application could not be validated.'
  return 'The customer application could not be processed.'
}

function buildErrorBody(body: Record<string, unknown>, requestId: string) {
  const code = publicApplicationErrorCode(body.code)
  const stage = (readField(body, 'error_stage') as string | null)
    ?? (readField(body, 'stage') as string | null)
    ?? null
  return canonicalApiError({
    code,
    message: publicApplicationMessage(code),
    requestId,
    correlationId: typeof body.correlation_id === 'string' ? body.correlation_id : requestId,
    field: (body.field as string | null | undefined) ?? null,
    blockers: [],
    details: null,
    stage: stage === 'tenant_readiness' ? 'integration_readiness' : stage,
    hint: null,
    retryable: body.retryable === true,
  })
}


export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_applications.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(
      buildErrorBody({ error: auth.error, code: auth.errorCode, error_stage: 'authorization' }, requestId),
      { status: auth.status },
    )
  }

  try {
    const readiness = await loadTenantWebsiteFlowReadiness({
      companyId: auth.context.companyId,
      client: auth.client,
    })
    if (!readiness.complete_tenant_website_ready) {
      const schemaBlocked = readiness.blockers.some((blocker) => blocker.component === 'database')
      const readinessStatus = schemaBlocked ? 503 : 409
      const readinessCode = schemaBlocked
        ? 'integration_schema_not_ready'
        : 'integration_not_ready'
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: readinessStatus,
        startedAt,
        errorCode: readinessCode,
        metadata: {
          request_id: requestId,
          blockers: readiness.blockers.map((blocker) => blocker.code),
        },
      })
      return customerPortalJson(
        buildErrorBody({
          error: schemaBlocked
            ? 'The integration schema is not ready.'
            : 'The integration is not ready for production checkout.',
          code: readinessCode,
          error_stage: 'integration_readiness',
          blockers: readiness.blockers,
          details: {
            portal_identity_required: readiness.portal_identity_required,
            portal_identity_submission_mode: readiness.portal_identity_submission_mode,
            status_delivery_modes: readiness.status_delivery_modes,
            warnings: readiness.warnings,
          },
          retryable: true,
          hint: schemaBlocked
            ? 'Contact Gridex support if this condition persists.'
            : 'Complete the required integration setup before retrying.',
        }, requestId),
        { status: readinessStatus },
      )
    }

    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: parsed.code })
      return customerPortalJson(
        buildErrorBody({
          error: parsed.code === 'payload_too_large'
            ? 'The request payload is too large.'
            : 'The request body contains invalid JSON.',
          code: parsed.code,
          error_stage: 'validation',
        }, requestId),
        { status },
      )
    }
    const body = bindPayloadToTenant(
      auth.context,
      (parsed.body ?? {}) as Record<string, unknown>,
    )
    const result = await processWebsiteCustomerApplication({
      client: auth.client,
      rawBody: body,
      idempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
      requestAudit: requestAudit(request, requestId),
      portalIdentitySubmissionMode: readiness.portal_identity_submission_mode,
    })

    const applicationMetadata = {
      result_count: result.ok ? 1 : 0,
      external_customer_id: typeof body?.external_customer_id === 'string' ? body.external_customer_id : body?.customer_external_id,
      customer_number: readStringField(result.ok ? result.body.data : null, 'customer_number'),
      application_id: readStringField(result.ok ? result.body.data : null, 'application_id'),
      error_stage: result.ok ? null : readStringField(result.body, 'error_stage'),
      error_code: result.ok ? null : readStringField(result.body, 'code'),
      field: result.ok ? null : readStringField(result.body, 'field'),
    }

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: result.status,
      startedAt,
      errorCode: result.ok ? null : String(result.body.error ?? 'website_application_error'),
      metadata: applicationMetadata,
    })
    await scheduleUsageEvent({
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      customerId: readStringField(result.ok ? result.body.data : null, 'customer_id'),
      entityType: 'website_customer_application',
      entityId: readStringField(result.ok ? result.body.data : null, 'application_id'),
      eventKey: result.ok ? 'api.website_application.created' : 'api.website_application.failed',
      actionLabel: result.ok ? 'Tog emot kundansökan från hemsida' : 'Kundansökan från hemsida misslyckades',
      source: 'website_api',
      billable: result.ok,
      billingUnit: 'customer_application',
      metadata: applicationMetadata,
    })

    const responseBody = result.ok
      ? {
          ...result.body,
          data: publicWebsiteCustomerApplicationData(
            result.body.data,
            auth.context.companyId,
          ),
          request_id: requestId,
          correlation_id: requestId,
        }
      : buildErrorBody(result.body as Record<string, unknown>, requestId)
    return customerPortalJson(responseBody, { status: result.status })
  } catch (error) {
    if (error instanceof TenantContextError) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code.toLowerCase(),
        metadata: { request_id: requestId },
      })
      return customerPortalJson(
        buildErrorBody({
          error: error.message,
          code: error.code.toLowerCase(),
          error_stage: 'authorization',
        }, requestId),
        { status: error.status },
      )
    }

    console.error('[website-customer-application] failed', { requestId, error })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: 'website_application_failed',
      metadata: { request_id: requestId },
    })
    return customerPortalJson(
      buildErrorBody({
        error: 'The customer application could not be processed at this time.',
        code: 'website_application_failed',
        error_stage: 'internal_error',
      }, requestId),
      { status: 500 },
    )
  }
}