import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import {
  createTenantSupportCase,
  listTenantSupportCases,
  publicSupportCase,
} from '@/lib/customer-cases/support'
import type { CustomerCasePriority } from '@/lib/customer-cases/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRIORITIES = new Set<CustomerCasePriority>(['low', 'normal', 'high', 'urgent'])

function priority(value: unknown): CustomerCasePriority {
  return PRIORITIES.has(value as CustomerCasePriority) ? value as CustomerCasePriority : 'normal'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_events.read'])
  if (!context.ok) return context.response
  try {
    const status = text(request.nextUrl.searchParams.get('status'))
    const rows = await listTenantSupportCases({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      status,
      limit: 100,
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: rows.length })
    return customerPortalJson({ data: rows.map(publicSupportCase) })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_contact.write'])
  if (!context.ok) return context.response
  try {
    const body = await request.json() as Record<string, unknown>
    const title = text(body.title)
    if (!title) {
      return customerPortalJson({ error: { code: 'support_title_required', message: 'title is required.' } }, { status: 400 })
    }

    const idempotencyKey = text(request.headers.get('idempotency-key')) ?? text(body.idempotency_key)
    if (!idempotencyKey) {
      return customerPortalJson({ error: { code: 'idempotency_key_required', message: 'Idempotency-Key is required.' } }, { status: 400 })
    }

    const created = await createTenantSupportCase({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      title,
      description: text(body.description),
      category: text(body.category),
      priority: priority(body.priority),
      channel: 'customer_portal',
      idempotencyKey,
      metadata: {
        external_reference: text(body.external_reference),
        api_client_id: context.client.id,
      },
    })

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson(
      { data: publicSupportCase(created.case), meta: { reused: created.reused } },
      { status: created.reused ? 200 : 201 },
    )
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
