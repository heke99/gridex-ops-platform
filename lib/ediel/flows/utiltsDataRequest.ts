// Stable public facade.
// Supplier outbound UTILTS is centralized in utiltsSupplierRequest; inbound
// transaction processing remains in the characterized runtime module.
export { prepareAndQueueUtiltsE73, prepareAndQueueUtiltsE66 } from './utiltsSupplierRequest'
export { processInboundUtiltsMessage } from './utiltsDataRequest.part-2'
