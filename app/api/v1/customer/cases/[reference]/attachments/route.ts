import { NextRequest } from 'next/server'
import { requireIdempotencyKey } from '@/lib/api/strictRequest'
import { customerPortalJson, logCustomerPortalSuccess, requireCustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
import { publicPageInput } from '@/lib/customer-portal/publicDto'
import { customerSupportApiContext, supportApiError } from '@/lib/customer-cases/apiAdapter'
import { intakeSupportAttachment, readSupportAttachmentForm, readSupportAttachments } from '@/lib/customer-cases/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ reference: string }> }

export async function GET(request: NextRequest, route: RouteContext) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.read'])
  if (!context.ok) return context.response
  try {
    const { reference } = await route.params
    const page = await readSupportAttachments(customerSupportApiContext(context), { reference, ...publicPageInput(request.nextUrl.searchParams) })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}

export async function POST(request: NextRequest, route: RouteContext) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.write'])
  if (!context.ok) return context.response
  try {
    const { reference } = await route.params
    const idempotencyKey = requireIdempotencyKey(request)
    const file = await readSupportAttachmentForm(request)
    const result = await intakeSupportAttachment({ context: customerSupportApiContext(context), caseReference: reference, idempotencyKey, ...file })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({ data: result }, { status: 201 })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}
