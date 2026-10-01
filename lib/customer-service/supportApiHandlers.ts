/**
 * Customer support API handlers (tenant portal → OPS support cases).
 *
 * Not yet mounted as public routes: the public API surface is release-locked by the versioned
 * OpenAPI contract. The route files under app/api/v1/customer/support/** are added together with
 * the next OpenAPI release (tenantservice P6), so no undocumented endpoint is reachable.
 */
import { NextRequest } from 'next/server'
import { executeIdempotentPortalWrite, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { publicPageInput } from '@/lib/customer-portal/publicDto'
import {
  addCustomerSupportMessage,
  createCustomerSupportCase,
  findCustomerSupportCase,
  listCustomerSupportCases,
  listCustomerSupportMessages,
  publicSupportCase,
} from '@/lib/customer-service/supportConversation'
import { toSupportApiError } from '@/lib/customer-service/supportApi'

type Params = { params: Promise<{ reference: string }> }

export async function getSupportCases(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'])
  if (!context.ok) return context.response
  try {
    const page = await listCustomerSupportCases(
      { companyId: context.client.company_id, customerId: context.identity.customer_id },
      publicPageInput(request.nextUrl.searchParams),
    )
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function postSupportCase(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.write'])
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/support/cases',
      payload: body,
      execute: async () => {
        const created = await createCustomerSupportCase({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          apiClientId: context.client.id,
          portalIdentityId: context.identity.id,
          title: body.title,
          message: body.message,
          category: body.category,
          idempotencyKey,
        })
        return { statusCode: 201, body: { data: created.case } }
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { action: 'support_case_created', idempotency_replay: result.replayed } })
    return customerPortalJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportCase(request: NextRequest, contextInput: { params: Promise<{ reference: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'])
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const messages = await listCustomerSupportMessages(scope, supportCase.id)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({ data: { ...publicSupportCase(supportCase), messages } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportMessages(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'])
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const messages = await listCustomerSupportMessages(scope, supportCase.id)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: messages.length })
    return customerPortalJson({ data: messages })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function postSupportMessage(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.write'])
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const body = await readJsonObject(request)
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/support/cases/[reference]/messages',
      payload: { reference, ...body },
      execute: async () => {
        const message = await addCustomerSupportMessage({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          caseReference: reference,
          apiClientId: context.client.id,
          portalIdentityId: context.identity.id,
          message: body.message,
        })
        return { statusCode: 201, body: { data: message } }
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { action: 'support_message_created', idempotency_replay: result.replayed } })
    return customerPortalJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}
