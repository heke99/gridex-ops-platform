import 'server-only'
import { randomUUID } from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import { customerPortalJson, handleCustomerPortalRouteError, type CustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
import { SupportCommandError } from '@/lib/customer-operations/supportCommand'
import type { SupportReadContext } from './customerRead'
import type { NextRequest } from 'next/server'

export function customerSupportApiContext(context: CustomerPortalApiContext): SupportReadContext {
  const subject = context.identity.customer_portal_user_id
  if (!subject) throw new ApiInputError('Kundbehörighet saknas.', 'support_actor_forbidden', 403)
  return { companyId: context.client.company_id, customerId: context.identity.customer_id,
    actor: { kind: 'api', clientId: context.client.id, subject } }
}

export function supportApiError(input: { request: NextRequest; client: CustomerPortalApiContext['client']; startedAt: number; error: unknown }) {
  const error = input.error
  if (error instanceof SupportCommandError && error.status === 503) {
    return customerPortalJson(canonicalApiError({ code: error.code === 'support_attachment_unavailable' ? error.code : 'support_unavailable', message: 'Ärendefunktionen är tillfälligt otillgänglig.', requestId: randomUUID(), retryable: true }), { status: 503 })
  }
  return handleCustomerPortalRouteError({ ...input, error: error instanceof SupportCommandError
    ? new ApiInputError(error.status === 404 ? 'Resursen finns inte.' : error.status === 409 ? 'Ärendet har ändrats. Läs den aktuella versionen och försök igen.' : 'Åtgärden kunde inte genomföras.', error.code, error.status)
    : error })
}
