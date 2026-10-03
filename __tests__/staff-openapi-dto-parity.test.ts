import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import staffOpenApi from '@/docs/openapi/staff-support-v1.json'
import { staffCustomerDetail, staffCustomerContact, staffCustomerAddress, staffCustomerFacility, staffSupportCase, staffSupportEntry, staffAssignee, staffAttachment } from '@/lib/staff-api/resources/dto'
import { StaffApiError, staffApiErrorResponse, staffApiJson } from '@/lib/staff-api/errors'

const require = createRequire(import.meta.url)
const { validateSchema } = require('../scripts/lib/openapi-schema-validator.cjs') as { validateSchema: (spec: unknown, value: unknown, schema: unknown) => string[] }
const company = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const date = '2026-10-03T21:51:31.000Z'
const validate = (name: keyof typeof staffOpenApi.components.schemas, value: unknown) => validateSchema(staffOpenApi, value, staffOpenApi.components.schemas[name])

describe('staff OpenAPI accepts the actual finite OPS DTOs', () => {
  it('validates nullable customer data without exposing native identity or silently inventing links', () => {
    const actual = staffCustomerDetail(company, { id, customer_number: 'SYNTHETIC-001', customer_type: 'private', status: 'active', first_name: 'Test', last_name: 'Person', personal_number: '190001010000', created_at: date, updated_at: date })
    expect(validate('StaffCustomerDetail', actual)).toEqual([])
    expect(actual.masked_personal_number).toBe('********0000')
    expect(actual).not.toHaveProperty('personal_number')
    expect(actual).not.toHaveProperty('links')
    expect(validate('StaffCustomerDetail', { ...actual, id })).not.toEqual([])
    expect(validate('StaffCustomerDetail', { ...actual, personal_number: '190001010000' })).not.toEqual([])
  })

  it('validates projected related resources when optional source fields are absent', () => {
    expect(validate('StaffCustomerContact', staffCustomerContact(company, { id, created_at: date }))).toEqual([])
    expect(validate('StaffCustomerAddress', staffCustomerAddress(company, { id, created_at: date }))).toEqual([])
    expect(validate('StaffCustomerFacility', staffCustomerFacility(company, { id, created_at: date, updated_at: date }))).toEqual([])
  })

  it('validates case and event variants with internal versus customer visibility preserved', () => {
    expect(validate('StaffSupportCase', staffSupportCase(company, { id, customer_id: id, title: 'Synthetic case', status: 'open', priority: 'normal', created_at: date, updated_at: date }))).toEqual([])
    for (const [event, payload] of [
      ['support_customer_message', { visibility: 'customer' }],
      ['support_staff_reply', { visibility: 'customer', kind: 'phone_summary' }],
      ['support_internal_note', {}], ['support_phone_interaction', {}],
      ['created', {}], ['status_changed', { status: 'resolved' }],
      ['assignment_changed', { assigned_to: null }],
    ] as const) {
      const actual = staffSupportEntry(company, { id, customer_case_id: id, event_type: event, message: 'Synthetic entry', payload, created_at: date })
      expect(validate('StaffSupportEntry', actual), event).toEqual([])
      if (event === 'support_internal_note' || event === 'support_phone_interaction') expect(actual.visibility).toBe('internal')
      expect(validate('StaffSupportEntry', { ...actual, payload: { secret: 'not public' } })).not.toEqual([])
    }
  })

  it('validates persisted attachment scan outcomes and safe staff references', () => {
    const assignee = staffAssignee(company, { id, full_name: 'Synthetic staff' })
    expect(validate('StaffAssignee', assignee)).toEqual([])
    for (const scan_status of ['released', 'rejected', 'quarantined']) {
      const actual = staffAttachment({ public_reference: 'support_attachment_synthetic_reference', file_name: 'example.pdf', detected_mime_type: 'application/pdf', byte_size: 32, sha256: 'a'.repeat(64), visibility: 'internal', uploaded_by_kind: 'staff', scan_status, scan_reason: null, created_at: date }, 'support_case_synthetic_reference')
      expect(validate('StaffSupportAttachment', actual)).toEqual([])
      expect(validate('StaffSupportAttachment', { ...actual, storage_path: 'private/native/path' })).not.toEqual([])
    }
  })

  it('documents bounded requests and page metadata instead of accepting unknown caller identity fields', () => {
    expect(validate('StaffPage', { limit: 50, returned: 50, has_more: true, next_cursor: 'opaque_cursor' })).toEqual([])
    expect(validate('StaffPage', { limit: 101, returned: 101, has_more: true, next_cursor: null })).not.toEqual([])
    const create = { customer_reference: 'customer_' + 'a'.repeat(32), title: 'Synthetic case', description: null, category: null, facility_reference: null }
    expect(validate('StaffCaseCreateRequest', create)).toEqual([])
    expect(validate('StaffCaseCreateRequest', { ...create, actor_user_id: id })).not.toEqual([])
    expect(validate('StaffCaseCreateRequest', { ...create, customer_reference: id })).not.toEqual([])
    expect(validate('StaffRefreshRequest', { refresh_token: 'too_short' })).not.toEqual([])
    expect(validate('StaffPasswordRequest', { password: 'short' })).not.toEqual([])
    expect(validate('StaffMfaVerifyRequest', { challenge_reference: 'mch_' + '0'.repeat(32), code: '12345' })).not.toEqual([])
  })

  it('validates actual versioned serializers while excluding unsafe blocker metadata and preserving measured budgets', async () => {
    const request = new NextRequest('https://app.gridex.se/api/v1/staff/me', { headers: { 'X-Request-ID': 'synthetic-request', 'X-Correlation-ID': 'synthetic-correlation' } })
    const context = { requestId: 'synthetic-request', correlationId: 'synthetic-correlation', integrationAuth: { rateLimit: { limit: 120, count: 1, remaining: 119, resetAt: date } } }
    const customer = staffCustomerDetail(company, { id, first_name: 'Synthetic', created_at: date })
    const response = staffApiJson(request, context, customer)
    expect(validate('StaffCustomerDetailEnvelope', await response.json())).toEqual([])
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    const error = staffApiErrorResponse(request, new StaffApiError(403, 'staff_permission_denied', 'Permission required.', false, [{ code: 'permission_required', message: 'Permission required.', resource_id: id, metadata: { provider_secret: 'synthetic-private-value' } }]), context)
    const envelope = await error.json()
    expect(validate('StaffErrorEnvelope', envelope)).toEqual([])
    expect(envelope.error.blockers[0]).not.toHaveProperty('resource_id')
    expect(envelope.error.blockers[0]).not.toHaveProperty('metadata')
    expect(error.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-03.1')
    expect(error.headers.get('X-RateLimit-Limit')).toBe('120')
    const unavailable = staffApiErrorResponse(request, new Error('synthetic-private-provider-diagnostic'), context)
    const safe = await unavailable.json()
    expect(validate('StaffErrorEnvelope', safe)).toEqual([])
    expect(JSON.stringify(safe)).not.toContain('synthetic-private-provider-diagnostic')
  })
})
