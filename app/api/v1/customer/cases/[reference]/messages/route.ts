import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiInputError, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { customerPortalJson, logCustomerPortalSuccess, requireCustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
import { publicPageInput } from '@/lib/customer-portal/publicDto'
import { readCustomerSupportPage } from '@/lib/customer-cases/customerRead'
import { customerSupportApiContext, supportApiError } from '@/lib/customer-cases/apiAdapter'
import { executeSupportCommand } from '@/lib/customer-operations/supportCommand'
import { publicReference } from '@/lib/integrations/publicReferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ reference: string }> }
const messageSchema = z.object({ body: z.string().trim().min(1).max(8000), expected_revision: z.number().int().nonnegative().safe() }).strict()

export async function GET(request: NextRequest, route: RouteContext) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.read'])
  if (!context.ok) return context.response
  try {
    const { reference } = await route.params
    const page = await readCustomerSupportPage(customerSupportApiContext(context), { reference, ...publicPageInput(request.nextUrl.searchParams) })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}

export async function POST(request: NextRequest, route: RouteContext) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.write'])
  if (!context.ok) return context.response
  try {
    const { reference } = await route.params
    const payload = messageSchema.safeParse(await readJsonObject(request, 40_000))
    if (!payload.success) throw new ApiInputError('Ange meddelande och aktuell revision utan extra fält.', 'invalid_support_request', 422)
    const result = await executeSupportCommand({ ...customerSupportApiContext(context), operation: 'customer_message', caseReference: reference,
      expectedRevision: payload.data.expected_revision, idempotencyKey: requireIdempotencyKey(request), payload: { body: payload.data.body } })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({ data: { case_reference: publicReference('case', context.client.company_id, result.caseId),
      message_reference: publicReference('case_message', context.client.company_id, result.messageId),
      revision: result.revision, status: result.customerStatus, replayed: result.replayed } }, { status: 201 })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}
