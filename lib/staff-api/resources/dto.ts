import { publicReference } from '@/lib/integrations/publicReferences'
import { publicSupportStatus } from '@/lib/customer-service/supportConversation'
import type { Row } from './common'

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const scalar = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]))
const ref = (kind: string, companyId: string, id: unknown) => publicReference(kind, companyId, id)
const name = (row: Row) => text(row.full_name) ?? text(row.company_name) ?? ([text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || null)
export function staffCustomer(companyId: string, row: Row) {
  return { customer_reference: ref('customer', companyId, row.id), ...scalar(row, ['customer_number', 'customer_type', 'status', 'email', 'phone', 'created_at']), display_name: name(row) }
}
export function staffCustomerDetail(companyId: string, row: Row) {
  const identity = text(row.personal_number)
  return { ...staffCustomer(companyId, row), ...scalar(row, ['first_name', 'last_name', 'company_name', 'apartment_number', 'preferred_language', 'updated_at', 'moved_out_at', 'lifecycle_closed_at']), org_number: row.customer_type === 'private' ? null : text(row.org_number), masked_personal_number: identity ? `${'*'.repeat(Math.max(0, identity.length - 4))}${identity.slice(-4)}` : null }
}
export function staffCustomerContact(companyId: string, row: Row) { return { contact_reference: ref('customer_contact', companyId, row.id), ...scalar(row, ['type', 'name', 'email', 'phone', 'title', 'is_primary', 'created_at']) } }
export function staffCustomerAddress(companyId: string, row: Row) { return { address_reference: ref('customer_address', companyId, row.id), ...scalar(row, ['type', 'street_1', 'street_2', 'postal_code', 'city', 'country', 'municipality', 'moved_in_at', 'moved_out_at', 'is_active', 'created_at']) } }
export function staffCustomerFacility(companyId: string, row: Row) { return { facility_reference: ref('facility', companyId, row.id), ...scalar(row, ['site_name', 'facility_id', 'site_type', 'status', 'street', 'care_of', 'postal_code', 'city', 'country', 'grid_area_code', 'price_area_code', 'move_in_date', 'move_out_date', 'created_at', 'updated_at']) } }
export function staffAssignee(companyId: string, row: Row) { return { staff_reference: ref('staff', companyId, row.id), display_name: text(row.full_name) ?? 'Personal' } }
export function staffSupportCase(companyId: string, row: Row) {
  return { case_reference: ref('support_case', companyId, row.id), customer_reference: ref('customer', companyId, row.customer_id), customer_number: text(row.customer_number), customer_display_name: text(row.customer_display_name), facility_reference: ref('facility', companyId, row.site_id), ...scalar(row, ['title', 'description', 'status', 'priority', 'next_action', 'next_action_due_at', 'created_at', 'updated_at', 'resolved_at', 'closed_at']), category: text(row.reason_category), description_visibility: row.description_visibility === 'customer' ? 'customer' : 'internal', public_status: publicSupportStatus(text(row.status)), channel: ['admin', 'phone', 'api', 'customer_portal', 'operations_automation'].includes(String(row.support_channel)) ? row.support_channel : null, assigned_to: row.assigned_to ? { staff_reference: ref('staff', companyId, row.assigned_to), display_name: text(row.assignee_name) ?? 'Personal' } : null }
}
export function staffSupportEntry(companyId: string, row: Row) {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Row : {}
  const types: Record<string, string> = { support_customer_message: 'customer_message', support_staff_reply: 'staff_reply', support_internal_note: 'internal_note', support_phone_interaction: 'phone_interaction', created: 'created', status_changed: 'status_changed', assignment_changed: 'assignment_changed' }
  const event = String(row.event_type); const publicEntry = ['support_customer_message', 'support_staff_reply'].includes(event) && payload.visibility === 'customer'
  return { entry_reference: ref('support_message', companyId, row.id), case_reference: ref('support_case', companyId, row.customer_case_id), kind: types[event] ?? 'internal_note', visibility: publicEntry ? 'customer' : 'internal', author_type: event === 'support_customer_message' ? 'customer' : row.created_by ? 'staff' : 'system', author: row.created_by ? { staff_reference: ref('staff', companyId, row.created_by), display_name: text(row.author_name) ?? 'Personal' } : null, body: text(row.message), created_at: text(row.created_at), ...(event === 'support_staff_reply' ? { reply_kind: payload.kind === 'phone_summary' ? 'phone_summary' : 'message' } : {}), ...(event === 'status_changed' ? { status: text(payload.status) } : {}), ...(event === 'assignment_changed' ? { assignee_reference: ref('staff', companyId, payload.assigned_to) } : {}) }
}
export function staffAttachment(row: Row, caseReference: string) {
  const reasons = ['empty', 'too_large', 'type_not_allowed', 'pdf_active_content', 'pdf_truncated', 'pdf_encoded_content']
  return { case_reference: caseReference, attachment_reference: text(row.public_reference), file_name: text(row.file_name), mime_type: ['application/pdf', 'image/png', 'image/jpeg'].includes(String(row.detected_mime_type)) ? row.detected_mime_type : null, byte_size: Number(row.byte_size), sha256: text(row.sha256), visibility: row.visibility === 'customer' ? 'customer' : 'internal', uploaded_by: row.uploaded_by_kind === 'customer' ? 'customer' : 'staff', scan_status: ['released', 'rejected'].includes(String(row.scan_status)) ? row.scan_status : 'quarantined', scan_reason: reasons.includes(String(row.scan_reason)) ? row.scan_reason : null, created_at: text(row.created_at) }
}
