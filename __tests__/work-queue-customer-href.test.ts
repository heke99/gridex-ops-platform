import { expect, it } from 'vitest'
import { workQueueCustomerHref } from '@/app/admin/work-queue/customerHref'
it.each(['data-requests','supplier-switch','technical-details','ediel-operations','switch-operations'])('routes a company operator past unavailable tab %s', tab => {
  expect(workQueueCustomerHref(`/admin/customers/customer?tab=${tab}#old-anchor`,false,false)).toBe('/admin/customers/customer')
})
it('preserves permitted targets and platform tools', () => {
  expect(workQueueCustomerHref('/admin/customers/c?tab=sites',false,false)).toBe('/admin/customers/c?tab=sites')
  expect(workQueueCustomerHref('/admin/customers/c?tab=technical-details',true,false)).toContain('technical-details')
  expect(workQueueCustomerHref('/admin/customers/c?tab=contracts',false,false)).toBe('/admin/customers/c')
  expect(workQueueCustomerHref('/admin/customers/c?tab=contracts',false,true)).toContain('contracts')
  expect(workQueueCustomerHref('/admin/operations/switches/id',false,false)).toBe('/admin/operations/switches/id')
})
