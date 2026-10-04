import type { NextRequest } from 'next/server'
import { requireStaffApi } from '@/lib/staff-api/auth'
import { staffApiErrorResponse, staffApiJson } from '@/lib/staff-api/errors'
import { getStaffCustomer, listStaffCustomers, listStaffCustomerRelated } from './customers'
import { getStaffCase, listStaffAssignees, listStaffCaseEntries, listStaffCases, writeStaffCase } from './cases'
import { invalid } from './common'

export type CustomerParams = { params: Promise<{ customerReference: string }> }
export type CaseParams = { params: Promise<{ caseReference: string }> }

export async function customerList(request: NextRequest) {
  const auth = await requireStaffApi(request, { scope: 'staff_customers.read', permission: 'customers.read' })
  if (!auth.ok) return auth.response
  try { const result = await listStaffCustomers(auth.context, request.nextUrl.searchParams); return staffApiJson(request, auth.context, result.data, 200, { page: result.page }) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export async function customerDetail(request: NextRequest, input: CustomerParams) {
  const auth = await requireStaffApi(request, { scope: 'staff_customers.read', permission: 'customers.read' })
  if (!auth.ok) return auth.response
  try { if (request.nextUrl.searchParams.size) invalid('query', 'Query-parametrar stöds inte.', 400); return staffApiJson(request, auth.context, await getStaffCustomer(auth.context, (await input.params).customerReference)) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export function customerRelated(operation: 'contacts' | 'addresses' | 'facilities') {
  return async (request: NextRequest, input: CustomerParams) => {
    const auth = await requireStaffApi(request, { scope: 'staff_customers.read', permission: 'customers.read' })
    if (!auth.ok) return auth.response
    try { const result = await listStaffCustomerRelated(auth.context, (await input.params).customerReference, operation, request.nextUrl.searchParams); return staffApiJson(request, auth.context, result.data, 200, { page: result.page }) }
    catch (error) { return staffApiErrorResponse(request, error, auth.context) }
  }
}
export async function caseList(request: NextRequest) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try { const result = await listStaffCases(auth.context, request.nextUrl.searchParams); return staffApiJson(request, auth.context, result.data, 200, { page: result.page }) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export async function caseDetail(request: NextRequest, input: CaseParams) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try { if (request.nextUrl.searchParams.size) invalid('query', 'Query-parametrar stöds inte.', 400); return staffApiJson(request, auth.context, await getStaffCase(auth.context, (await input.params).caseReference)) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export async function caseEntries(request: NextRequest, input: CaseParams) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try { const result = await listStaffCaseEntries(auth.context, (await input.params).caseReference, request.nextUrl.searchParams); return staffApiJson(request, auth.context, result.data, 200, { page: result.page }) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export async function assignees(request: NextRequest) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try { const result = await listStaffAssignees(auth.context, request.nextUrl.searchParams); return staffApiJson(request, auth.context, result.data, 200, { page: result.page }) }
  catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
async function executeCaseWrite(request: NextRequest, operation: 'create' | 'reply' | 'note' | 'status' | 'assignment', resolveReference: () => Promise<string>) {
    const auth = await requireStaffApi(request, { scope: 'staff_support.write', permission: 'cases.write', mutation: true })
    if (!auth.ok) return auth.response
    try {
      if (request.nextUrl.searchParams.size) invalid('query', 'Query-parametrar stöds inte.', 400)
      const result = await writeStaffCase(auth.context, request, operation, await resolveReference())
      return staffApiJson(request, auth.context, result.data, ['create', 'reply', 'note'].includes(operation) ? 201 : 200, { headers: { 'Idempotency-Replayed': String(result.replayed) } })
    } catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
export async function caseCreate(request: NextRequest) { return executeCaseWrite(request, 'create', async () => '') }
export function caseWrite(operation: 'reply' | 'note' | 'status' | 'assignment') {
  return async (request: NextRequest, input: CaseParams) => executeCaseWrite(request, operation, async () => (await input.params).caseReference)
}
