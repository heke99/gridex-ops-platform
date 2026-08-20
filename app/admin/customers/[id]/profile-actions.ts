"use server";

// Stable public facade. Implementations are split into 2 characterized modules.
import * as implementation1 from './profile-actions.part-1'
import * as implementation2 from './profile-actions.part-2'

export async function saveCustomerProfileAction(...args: Parameters<typeof implementation1.saveCustomerProfileAction>) {
  return implementation1.saveCustomerProfileAction(...args)
}

export async function closeCustomerLifecycleAction(...args: Parameters<typeof implementation1.closeCustomerLifecycleAction>) {
  return implementation1.closeCustomerLifecycleAction(...args)
}

export async function markCustomerAsTestDataAction(...args: Parameters<typeof implementation2.markCustomerAsTestDataAction>) {
  return implementation2.markCustomerAsTestDataAction(...args)
}

export async function archiveCustomerAction(...args: Parameters<typeof implementation2.archiveCustomerAction>) {
  return implementation2.archiveCustomerAction(...args)
}

export async function deleteCustomerForRecreateAction(...args: Parameters<typeof implementation2.deleteCustomerForRecreateAction>) {
  return implementation2.deleteCustomerForRecreateAction(...args)
}
