// Stable public facade.
// Supplier outbound UTILTS is centralized in utiltsSupplierRequest; inbound
// transaction processing remains in the characterized runtime module.
export { prepareAndQueueUtiltsE73 } from './utiltsSupplierRequest'
export { processInboundUtiltsMessage } from './utiltsDataRequest.part-2'

export async function prepareAndQueueUtiltsE66(_params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: string | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}): Promise<{ id: string }> {
  // Compatibility boundary only. E66 is grid-owner-originated validated
  // metering data and may never be originated by Gridex in supplier role.
  void _params
  throw new Error('utilts_e66_supplier_outbound_not_allowed')
}
