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
const createSchema = z.object({ title: z.string().trim().min(1).max(180), body: z.string().trim().min(1).max(8000) }).strict()

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.read'])
  if (!context.ok) return context.response
  try {
    const page = await readCustomerSupportPage(customerSupportApiContext(context), publicPageInput(request.nextUrl.searchParams))
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_cases.write'])
  if (!context.ok) return context.response
  try {
    const payload = createSchema.safeParse(await readJsonObject(request, 40_000))
    if (!payload.success) throw new ApiInputError('Ange rubrik och meddelande utan extra fält.', 'invalid_support_request', 422)
    const result = await executeSupportCommand({ ...customerSupportApiContext(context), operation: 'create',
      expectedRevision: 0, idempotencyKey: requireIdempotencyKey(request), payload: payload.data })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({ data: { case_reference: publicReference('case', context.client.company_id, result.caseId),
      revision: result.revision, status: result.customerStatus, replayed: result.replayed } }, { status: 201 })
  } catch (error) { return supportApiError({ request, client: context.client, startedAt: context.startedAt, error }) }
}
