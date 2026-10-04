import type { NextRequest } from 'next/server'
import { readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { commandArgs, commandDatabase, databaseError, enumValue, fields, invalid, optionalText, pageRows, PRIORITIES, readRows, reference, requestFingerprint, requiredText, resourceQuery, timestamp, WRITE_STATUSES, type ResourceContext } from './common'
import { staffAssignee, staffSupportCase, staffSupportEntry } from './dto'

export async function listStaffCases(context: ResourceContext, params: URLSearchParams) {
  const query = resourceQuery(params, 'cases')
  return pageRows(context, 'cases', '', query, await readRows(context, 'cases', '', query), row => staffSupportCase(context.companyId, row))
}
export async function getStaffCase(context: ResourceContext, caseReference: string) {
  reference(caseReference, 'support_case')
  const rows = await readRows(context, 'case', caseReference, { limit: 1, cursor: null, filters: {} })
  if (rows.length !== 1) invalid('reference', 'Ärendet hittades inte.', 404, 'support_case_not_found')
  return staffSupportCase(context.companyId, rows[0])
}
export async function listStaffCaseEntries(context: ResourceContext, caseReference: string, params: URLSearchParams) {
  reference(caseReference, 'support_case')
  const query = resourceQuery(params, 'entries')
  return pageRows(context, 'entries', caseReference, query, await readRows(context, 'entries', caseReference, query), row => staffSupportEntry(context.companyId, row))
}
export async function listStaffAssignees(context: ResourceContext, params: URLSearchParams) {
  const query = resourceQuery(params, 'assignees')
  return pageRows(context, 'assignees', '', query, await readRows(context, 'assignees', '', query), row => staffAssignee(context.companyId, row))
}
export async function writeStaffCase(context: ResourceContext, request: NextRequest, operation: 'create' | 'reply' | 'note' | 'status' | 'assignment', caseReference: string) {
  if (operation !== 'create') reference(caseReference, 'support_case')
  const body = await readJsonObject(request, 48_000)
  const allowed = { create: ['customer_reference', 'title', 'description', 'category', 'priority', 'facility_reference'], reply: ['message', 'kind'], note: ['message'], status: ['status', 'message', 'expected_updated_at'], assignment: ['assignee_reference', 'expected_updated_at'] }[operation]
  fields(body, allowed)
  const payload: Record<string, unknown> = {}
  if (operation === 'create') {
    payload.customer_reference = reference(body.customer_reference, 'customer', 'customer_reference')
    payload.title = requiredText(body.title, 'title', 180)
    payload.description = optionalText(body.description, 'description', 8000)
    payload.category = optionalText(body.category, 'category', 120) ?? 'support'
    payload.priority = body.priority === undefined ? 'normal' : enumValue(body.priority, PRIORITIES, 'priority')
    payload.facility_reference = body.facility_reference === undefined || body.facility_reference === null ? null : reference(body.facility_reference, 'facility', 'facility_reference')
  } else if (operation === 'reply' || operation === 'note') {
    payload.message = requiredText(body.message, 'message', 8000)
    if (operation === 'reply') payload.kind = body.kind === undefined ? 'message' : enumValue(body.kind, ['message', 'phone_summary'], 'kind')
  } else {
    payload.expected_updated_at = timestamp(body.expected_updated_at, 'expected_updated_at')
    if (operation === 'status') { payload.status = enumValue(body.status, WRITE_STATUSES, 'status'); payload.message = optionalText(body.message, 'message', 8000) }
    else payload.assignee_reference = body.assignee_reference === null ? null : reference(body.assignee_reference, 'staff', 'assignee_reference')
  }
  const { data, error } = await commandDatabase(context).rpc('staff_api_support_command', { ...commandArgs(context), p_operation: operation, p_reference: caseReference || null, p_idempotency_key: requireIdempotencyKey(request), p_request_hash: requestFingerprint({ operation, reference: caseReference || null, body }), p_payload: payload })
  if (error) databaseError(error)
  if (!data || typeof data !== 'object' || !data.data || typeof data.replayed !== 'boolean') throw new Error('Invalid staff command result')
  // The SQL command returns only its explicit receipt projection, never a native row.
  return { data: data.data, replayed: data.replayed }
}
