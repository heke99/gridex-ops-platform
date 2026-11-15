export function customerProfileEditHref(customerId: string): string {
  return `/admin/customers/${encodeURIComponent(customerId)}?tab=profile#edit-customer-profile`
}
