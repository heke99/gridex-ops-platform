"use server";

// Stable public facade. Implementations are split into 4 characterized modules.
import * as implementation1 from './actions.part-3'
import * as implementation2 from './actions.part-4'

export async function createCustomerAction(...args: Parameters<typeof implementation1.createCustomerAction>) {
  return implementation1.createCustomerAction(...args)
}

export async function createCustomerFromImportRowAction(...args: Parameters<typeof implementation1.createCustomerFromImportRowAction>) {
  return implementation1.createCustomerFromImportRowAction(...args)
}

export async function linkCustomerImportRowToExistingCustomerAction(...args: Parameters<typeof implementation1.linkCustomerImportRowToExistingCustomerAction>) {
  return implementation1.linkCustomerImportRowToExistingCustomerAction(...args)
}

export async function rejectCustomerImportRowAction(...args: Parameters<typeof implementation1.rejectCustomerImportRowAction>) {
  return implementation1.rejectCustomerImportRowAction(...args)
}

export async function bulkCreateCustomersAction(...args: Parameters<typeof implementation2.bulkCreateCustomersAction>) {
  return implementation2.bulkCreateCustomersAction(...args)
}

export async function previewCustomerImportAction(...args: Parameters<typeof implementation2.previewCustomerImportAction>) {
  return implementation2.previewCustomerImportAction(...args)
}

export async function commitCustomerImportAction(...args: Parameters<typeof implementation2.commitCustomerImportAction>) {
  return implementation2.commitCustomerImportAction(...args)
}
