import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import type { StaffApiContext } from '@/lib/staff-api/context'
import { staffApiJson, withStaffApi } from '@/lib/staff-api/http'
import { applyStaffQueryPolicy } from '@/lib/staff-api/queryPolicy'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { changeStaffRole, disableStaff, inviteStaff, listStaff, listStaffRoles, reactivateStaff, type StaffCommandContext } from '@/lib/tenant/staffCommands'

const inviteSchema = z.object({ email: z.string().email().max(320), full_name: z.string().trim().max(200).nullable().optional(), role_key: z.string().min(1).max(80) }).strict()
const roleSchema = z.object({ role_key: z.string().min(1).max(80) }).strict()
const disableSchema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict()
const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), page_size: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['active', 'disabled', 'removed', 'invited', 'pending', 'suspended', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked']).optional() }).strict()

function commandContext(ctx: StaffApiContext): StaffCommandContext {
  return { companyId: ctx.companyId, actorUserId: ctx.actorUserId, apiClientId: ctx.apiClientId, permissions: ctx.permissions, channel: 'staff_api' }
}
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) throw new ApiInputError('Anropets fält är ogiltiga.', 'invalid_request', 422, result.error.issues[0]?.path.join('.') || null)
  return result.data
}
function commandIdempotencyKey(ctx: StaffApiContext, operation: string, key: string, userId?: string): string {
  return createHash('sha256').update([ctx.companyId, ctx.apiClientId, ctx.actorUserId, operation, ...(userId ? [userId] : []), key].join('|')).digest('hex')
}
async function requireTenantStaffUser(ctx: StaffApiContext, userId: string): Promise<void> {
  const { data, error } = await tenantSelect(ctx.companyId, 'company_memberships', 'user_id').eq('user_id', userId).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new ApiInputError('Användaren finns inte i bolaget.', 'staff_user_not_found', 404)
}

// The ledger route is the public route template (lib/api/publicRouteRegistry.ts), a
// server constant the customer-less allow-list can name. The target user is part of
// the hashed payload, so reusing a key against another user is a 409 conflict.
async function write<T>(request: NextRequest, ctx: StaffApiContext, operation: string, payload: unknown, execute: (key: string) => Promise<T>, status = 200, userId?: string) {
  const rawKey = requireIdempotencyKey(request)
  if (userId) await requireTenantStaffUser(ctx, userId)
  const result = await executeIdempotentPortalWrite({
    request, companyId: ctx.companyId, clientId: ctx.apiClientId, customerId: null,
    operation, payload: { actor_user_id: ctx.actorUserId, ...(userId ? { user_id: userId } : {}), data: payload },
    execute: async () => ({ statusCode: status, body: { data: await execute(commandIdempotencyKey(ctx, operation, rawKey, userId)) } }),
  })
  return staffApiJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
}

export async function getStaffUsers(request: NextRequest) {
  return withStaffApi(request, { scopes: ['staff_users.read'], permission: 'users.read' }, async ctx => {
    applyStaffQueryPolicy(request, ['page', 'page_size'])
    const query = parse(listSchema, Object.fromEntries(request.nextUrl.searchParams))
    return staffApiJson(await listStaff(commandContext(ctx), { page: query.page, pageSize: query.page_size, status: query.status }))
  })
}
export async function postStaffUser(request: NextRequest) {
  return withStaffApi(request, { scopes: ['staff_users.write'], permission: 'users.write' }, async ctx => {
    const body = parse(inviteSchema, await readJsonObject(request))
    return write(request, ctx, '/api/v1/staff/users', body, key => inviteStaff(commandContext(ctx), { email: body.email, fullName: body.full_name, roleKey: body.role_key, idempotencyKey: key }), 201)
  })
}
export async function patchStaffUser(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStaffApi(request, { scopes: ['staff_users.write'], permission: 'users.write' }, async ctx => {
    const userId = parse(z.string().uuid(), (await params).id)
    const body = parse(roleSchema, await readJsonObject(request))
    return write(request, ctx, '/api/v1/staff/users/[id]', body, key => changeStaffRole(commandContext(ctx), { userId, roleKey: body.role_key, idempotencyKey: key }), 200, userId)
  })
}
export async function disableStaffUser(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStaffApi(request, { scopes: ['staff_users.write'], permission: 'users.write' }, async ctx => {
    const userId = parse(z.string().uuid(), (await params).id)
    const body = parse(disableSchema, await readJsonObject(request))
    return write(request, ctx, '/api/v1/staff/users/[id]/disable', body, key => disableStaff(commandContext(ctx), { userId, reason: body.reason, idempotencyKey: key }), 200, userId)
  })
}
export async function enableStaffUser(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStaffApi(request, { scopes: ['staff_users.write'], permission: 'users.write' }, async ctx => {
    const userId = parse(z.string().uuid(), (await params).id)
    const body = parse(z.object({}).strict(), await readJsonObject(request))
    return write(request, ctx, '/api/v1/staff/users/[id]/enable', body, key => reactivateStaff(commandContext(ctx), { userId, idempotencyKey: key }), 200, userId)
  })
}
export async function getStaffRoles(request: NextRequest) {
  return withStaffApi(request, { scopes: ['staff_users.read'], permission: 'users.read' }, async ctx => staffApiJson(listStaffRoles(commandContext(ctx))))
}
