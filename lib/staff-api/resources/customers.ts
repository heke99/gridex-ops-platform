import { invalid, pageRows, readRows, reference, resourceQuery, type ResourceContext } from './common'
import { staffCustomer, staffCustomerDetail, staffCustomerContact, staffCustomerAddress, staffCustomerFacility } from './dto'

export async function listStaffCustomers(context: ResourceContext, params: URLSearchParams) {
  const query = resourceQuery(params, 'customers')
  return pageRows(context, 'customers', '', query, await readRows(context, 'customers', '', query), row => staffCustomer(context.companyId, row))
}
export async function getStaffCustomer(context: ResourceContext, customerReference: string) {
  reference(customerReference, 'customer')
  const rows = await readRows(context, 'customer', customerReference, { limit: 1, cursor: null, filters: {} })
  if (rows.length !== 1) invalid('reference', 'Kunden hittades inte.', 404, 'customer_not_found')
  return staffCustomerDetail(context.companyId, rows[0])
}
export async function listStaffCustomerRelated(context: ResourceContext, customerReference: string, operation: 'contacts' | 'addresses' | 'facilities', params: URLSearchParams) {
  reference(customerReference, 'customer')
  const query = resourceQuery(params, operation)
  const mapper = { contacts: staffCustomerContact, addresses: staffCustomerAddress, facilities: staffCustomerFacility }[operation]
  return pageRows(context, operation, customerReference, query, await readRows(context, operation, customerReference, query), row => mapper(context.companyId, row))
}
