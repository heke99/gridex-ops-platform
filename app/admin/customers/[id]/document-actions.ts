"use server";

// Stable public facade. Implementations are split into 2 characterized modules.
import * as implementation1 from './document-actions.part-2'

export type { UploadCustomerAuthorizationDocumentActionState } from './document-actions.part-1'

export async function uploadCustomerAuthorizationDocumentAction(...args: Parameters<typeof implementation1.uploadCustomerAuthorizationDocumentAction>) {
  return implementation1.uploadCustomerAuthorizationDocumentAction(...args)
}

export async function verifyCustomerAuthorizationDocumentAndRequestDataAction(...args: Parameters<typeof implementation1.verifyCustomerAuthorizationDocumentAndRequestDataAction>) {
  return implementation1.verifyCustomerAuthorizationDocumentAndRequestDataAction(...args)
}

export async function archiveCustomerAuthorizationDocumentAction(...args: Parameters<typeof implementation1.archiveCustomerAuthorizationDocumentAction>) {
  return implementation1.archiveCustomerAuthorizationDocumentAction(...args)
}

export async function setCustomerAuthorizationDocumentActiveAction(...args: Parameters<typeof implementation1.setCustomerAuthorizationDocumentActiveAction>) {
  return implementation1.setCustomerAuthorizationDocumentActiveAction(...args)
}
