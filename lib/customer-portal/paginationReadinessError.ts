import { randomUUID } from 'node:crypto'
import { canonicalApiError } from '@/lib/api/apiError'
import { customerPortalJson, handleCustomerPortalRouteError } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import publicApiErrors from '@/lib/integrations/public-api-error-registry.json'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

type PaginationRpc = 'portal_customer_documents_page_v1' | 'portal_customer_events_page_v1'

function isMissingPaginationRpc(error: PlatformSchemaNotReadyError, rpc: PaginationRpc) {
  const details = error.details as { code?: unknown; message?: unknown } | null
  const message = details?.message
  if (typeof message !== 'string') return false

  const signature = `public.${rpc}(`
  if (details?.code === 'PGRST202') {
    return (
      message.startsWith(`Could not find the function ${signature}`) && message.endsWith(' in the schema cache')
    ) || (
      message.startsWith(`Could not find the ${signature}`) && message.endsWith(' function in the schema cache')
    )
  }
  return details?.code === '42883' && message.startsWith(`function ${signature}`) && message.endsWith(' does not exist')
}

export function handleCustomerPortalPaginationError(
  input: Parameters<typeof handleCustomerPortalRouteError>[0],
  rpc: PaginationRpc,
) {
  const { error } = input
  // The page helpers wrap every RPC failure in this class. Verify the missing
  // public function before treating a failed read as temporary schema drift.
  if (!(error instanceof PlatformSchemaNotReadyError) || !isMissingPaginationRpc(error, rpc)) {
    return handleCustomerPortalRouteError(input)
  }

  const requestId = randomUUID()
  void logIntegrationApiRequest({
    request: input.request,
    client: input.client,
    startedAt: input.startedAt,
    statusCode: error.status,
    errorCode: error.code,
    requestId,
  })
  const definition = publicApiErrors.platform_schema_not_ready
  return customerPortalJson(canonicalApiError({
    code: error.code,
    message: definition.public_message,
    requestId,
    retryable: definition.retryable,
  }), { status: error.status })
}
