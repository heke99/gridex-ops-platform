export const BATCH2B_AUTOMATION_ACCESS = { anyOf: ['customers.write', 'metering.write', 'billing_underlay.export', 'cases.write'] }
export const BATCH2C_AUTOMATION_ACCESS = { anyOf: ['metering.write', 'billing_underlay.export', 'cases.write'] }
export const BILLING_BLOCKER_ACCESS = { anyOf: ['cases.write', 'billing_underlay.export'] }
export const CONTROL_TOWER_ROW_ACCESS = { anyOf: ['cases.write', 'metering.write', 'billing_underlay.export', 'partner_exports.write'] }
