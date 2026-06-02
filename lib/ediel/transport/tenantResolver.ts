import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveInboundTenantForMessage } from '@/lib/ediel/core/tenantResolver'

export async function resolveTenantFromInboundEdifact(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  return resolveInboundTenantForMessage({
    actorUserId: params.actorUserId,
    message: params.message,
  })
}
