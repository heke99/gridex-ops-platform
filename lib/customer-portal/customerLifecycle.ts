type CustomerRow = Record<string, unknown>

const unavailableStatuses = new Set(['archived', 'deleted', 'disabled'])

export function portalCustomerCanLink(customer: { status?: unknown; merged_into_customer_id?: unknown }): boolean {
  return !customer.merged_into_customer_id && !unavailableStatuses.has(String(customer.status ?? '').trim().toLowerCase())
}

/** Resolve only an existing authenticated binding through an explicit tenant-bound merge. */
export async function canonicalPortalCustomer(input: {
  companyId: string
  customer: CustomerRow
  allowMergedAlias: boolean
  load: (customerId: string) => Promise<CustomerRow | null>
}): Promise<CustomerRow | null> {
  let customer = input.customer
  const visited = new Set<string>()
  // query-loop-budget: bounded-canonical-merge-chain max=8
  for (let depth = 0; depth < 8; depth += 1) {
    const id = String(customer.id ?? '')
    if (!id || String(customer.company_id) !== input.companyId || visited.has(id)) return null
    visited.add(id)
    const target = customer.merged_into_customer_id
    if (!target) return portalCustomerCanLink(customer) ? customer : null
    if (!input.allowMergedAlias || typeof target !== 'string') return null
    const next = await input.load(target)
    if (!next) return null
    customer = next
  }
  return null
}
