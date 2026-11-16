// Stable public facade. Implementations are split into 3 characterized modules.
export type { CustomerOperationJobType, CustomerOperationJobStatus } from './automation.part-1'
export { enqueueCustomerDataRequestAutomation, enqueueSupplierSwitchAutomation, enqueueInboundGridOwnerResponseAutomation, resolveCustomerSiteGridOwner } from './automation.part-1'
export { applyInboundGridOwnerResponse } from './automation.part-2'
export { processCustomerOperationJobs } from './automation.part-3'
