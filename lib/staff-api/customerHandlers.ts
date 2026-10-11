import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { planPrimaryContactSync } from '@/lib/customer-service/contactChange'
import { applyCustomerContactChange, ContactChangeTransactionError } from '@/lib/customer-service/contactChangeTransaction'
import { requestCustomerIdentityChange, IdentityChangeError } from '@/lib/customer-service/identityChange'
import { getCustomerForCompany } from '@/lib/customers/getCustomerForCompany'
import { listCustomersPageForCompany, type CustomerStatusFilter, type CustomerTypeFilter } from '@/lib/customers/getCustomers'
import { publicReference } from '@/lib/integrations/publicReferences'
import { findStaffCustomer, parseStaffContactPatch, rejectUnknownFields, staffCustomerDetail, staffCustomerSummary } from '@/lib/staff-api/customers'
import { staffApiJson, withStaffApi } from '@/lib/staff-api/http'
import { applyStaffQueryPolicy } from '@/lib/staff-api/queryPolicy'

type Params = { params: Promise<{ ref: string }> }
const statuses = ['all', 'draft', 'pending_verification', 'active', 'inactive', 'moved', 'terminated', 'blocked', 'archived'] as const
const customerTypes = ['all', 'private', 'business', 'association'] as const

function pageNumber(value: string | null, name: string, defaultValue: number, max: number): number {
  if (value === null) return defaultValue
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new ApiInputError('Ogiltigt sidvärde.', 'invalid_field', 422, name)
  }
  return Number(value)
}

function mapCustomerError(error: unknown): never {
  if (error instanceof ContactChangeTransactionError) {
    const status = { version_conflict: 409, not_found: 404, not_authorized: 403, customer_archived: 409, invalid_request: 422 }[error.code]
    throw new ApiInputError(error.message, error.code, status)
  }
  if (error instanceof IdentityChangeError) throw new ApiInputError(error.message, error.code, error.status)
  throw error
}

export async function getStaffCustomers(request: NextRequest): Promise<Response> {
  return withStaffApi(request, { scopes: ['staff_customers.read'], permission: 'customers.read' }, async ctx => {
    const query = request.nextUrl.searchParams
    const allowed = ['q', 'page', 'page_size', 'status', 'customer_type']
    for (const key of query.keys()) {
      if (!allowed.includes(key)) throw new ApiInputError('Okänt sökfält.', 'field_not_allowed', 422, key)
      if (query.getAll(key).length > 1) throw new ApiInputError('Sökfält får bara anges en gång.', 'invalid_field', 422, key)
    }
    applyStaffQueryPolicy(request, ['page', 'page_size'])
    const search = query.get('q')?.trim() ?? ''
    if (search.length > 200) throw new ApiInputError('Söktexten är för lång.', 'invalid_field', 422, 'q')
    const status = query.get('status') ?? 'all'
    const customerType = query.get('customer_type') ?? 'all'
    if (!(statuses as readonly string[]).includes(status)) throw new ApiInputError('Ogiltig status.', 'invalid_field', 422, 'status')
    if (!(customerTypes as readonly string[]).includes(customerType)) throw new ApiInputError('Ogiltig kundtyp.', 'invalid_field', 422, 'customer_type')
    const page = await listCustomersPageForCompany({
      companyId: ctx.companyId,
      query: search,
      page: pageNumber(query.get('page'), 'page', 1, 1_000_000),
      pageSize: pageNumber(query.get('page_size'), 'page_size', 25, 100),
      status: status as CustomerStatusFilter,
      customerType: customerType as CustomerTypeFilter,
    })
    return staffApiJson({ data: {
      customers: page.rows.map(row => staffCustomerSummary(ctx.companyId, row)),
      pagination: { page: page.page, page_size: page.pageSize, total: page.total, total_pages: page.totalPages },
    } })
  })
}

export async function getStaffCustomer(request: NextRequest, input: Params): Promise<Response> {
  return withStaffApi(request, { scopes: ['staff_customers.read'], permission: 'customers.read' }, async ctx => {
    const { ref } = await input.params
    const customer = await findStaffCustomer(ctx.companyId, ref)
    const detail = await getCustomerForCompany(ctx.companyId, customer.id)
    return staffApiJson({ data: { customer: staffCustomerDetail(ctx.companyId, detail) } })
  })
}

export async function patchStaffCustomerContact(request: NextRequest, input: Params): Promise<Response> {
  // The shared OPS command and database both require masterdata.write for contact edits.
  return withStaffApi(request, { scopes: ['staff_customers.write'], permission: 'masterdata.write' }, async ctx => {
    const { ref } = await input.params
    const body = await readJsonObject(request)
    const patch = parseStaffContactPatch(body)
    const idempotencyKey = requireIdempotencyKey(request)
    const customer = await findStaffCustomer(ctx.companyId, ref)
    try {
      const result = await executeIdempotentPortalWrite({
        request, companyId: ctx.companyId, clientId: ctx.apiClientId, customerId: customer.id,
        operation: '/api/v1/staff/customers/[ref]/contact',
        payload: { ...body, ref, actor_user_id: ctx.actorUserId },
        execute: async () => {
          const changed = await applyCustomerContactChange({
            companyId: ctx.companyId, customerId: customer.id,
            actor: { kind: 'staff', userId: ctx.actorUserId, apiClientId: ctx.apiClientId },
            channel: 'staff_api', expectedUpdatedAt: patch.expectedUpdatedAt,
            customerPatch: patch.customerPatch,
            contactPatch: planPrimaryContactSync({
              customerType: String(customer.customer_type ?? ''), contactName: null,
              email: patch.customerPatch.email, phone: patch.customerPatch.phone,
            }),
            // Domain event keys are company-wide: also bind staff, API client and customer.
            idempotencyKey: `staff_api:${ctx.apiClientId}:${ctx.actorUserId}:${customer.id}:${createHash('sha256').update(idempotencyKey).digest('hex')}`,
          })
          return { statusCode: 200, body: { data: {
            customer_reference: publicReference('customer', ctx.companyId, customer.id),
            changed: changed.changed, customer_updated_at: changed.customerUpdatedAt,
          } } }
        },
      })
      return staffApiJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
    } catch (error) { mapCustomerError(error) }
  })
}

export async function postStaffCustomerIdentityChange(request: NextRequest, input: Params): Promise<Response> {
  return withStaffApi(request, { scopes: ['staff_customers.write'], permission: 'customers.write' }, async ctx => {
    const { ref } = await input.params
    const body = await readJsonObject(request)
    rejectUnknownFields(body, ['field', 'new_value', 'reason'])
    if (body.field !== 'personal_number' && body.field !== 'org_number') throw new ApiInputError('Okänt identitetsfält.', 'identity_field_invalid', 422, 'field')
    if (typeof body.new_value !== 'string' || body.new_value.length > 32) throw new ApiInputError('Numret måste vara text.', 'invalid_field', 422, 'new_value')
    if (typeof body.reason !== 'string') throw new ApiInputError('Orsak måste vara text.', 'invalid_field', 422, 'reason')
    requireIdempotencyKey(request)
    const customer = await findStaffCustomer(ctx.companyId, ref)
    const field = body.field
    const newValue = body.new_value
    const reason = body.reason
    try {
      const result = await executeIdempotentPortalWrite({
        request, companyId: ctx.companyId, clientId: ctx.apiClientId, customerId: customer.id,
        operation: '/api/v1/staff/customers/[ref]/identity-change',
        payload: { ...body, ref, actor_user_id: ctx.actorUserId },
        execute: async () => {
          const change = await requestCustomerIdentityChange({ companyId: ctx.companyId, customerId: customer.id, field, newValue, reason, actorUserId: ctx.actorUserId, channel: 'staff_api', apiClientId: ctx.apiClientId })
          const pending = change.status === 'pending_customer_approval' ? change : null
          return { statusCode: 201, body: { data: {
            request_reference: publicReference('identity_change', ctx.companyId, change.requestId),
            status: change.status, recipient_masked: pending?.recipientMasked ?? null,
            expires_at: pending?.expiresAt ?? null, contract_count: pending?.contractCount ?? null,
            takeover_required: pending?.takeoverRequired ?? null,
          } } }
        },
      })
      return staffApiJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
    } catch (error) { mapCustomerError(error) }
  })
}
