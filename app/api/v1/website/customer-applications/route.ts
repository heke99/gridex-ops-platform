import { NextRequest } from 'next/server'
import {
  customerPortalJson,
} from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { processWebsiteCustomerApplication } from '@/lib/website/customerApplications'
import { logUsageEvent } from '@/lib/audit/actionLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record[field] === 'string' && record[field].trim() ? record[field] : null
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Kundansökan kunde inte behandlas.'
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_applications.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await processWebsiteCustomerApplication({
      client: auth.client,
      rawBody: body,
      idempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
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
    await logUsageEvent({
      companyId: auth.client.company_id,
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

    return customerPortalJson(result.body, { status: result.status })
  } catch (error) {
    const message = safeError(error)
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: message,
    })
    return customerPortalJson({ error: message }, { status: 500 })
  }
}
