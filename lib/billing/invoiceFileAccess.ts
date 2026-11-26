// Downloads are historical reads. The route requires this explicit grant even for platform actors.
export function hasInvoiceFileDownloadPermission(permissions: readonly string[]): boolean {
  return permissions.includes('billing_underlay.export')
}
