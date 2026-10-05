import { z } from 'zod'
import { hasPermissionRequirement } from '@/lib/admin/accessModel'
import { getSupabasePublicEnv } from '@/lib/env/supabasePublic'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { SUPABASE_SERVICE_URL, supabaseService } from '@/lib/supabase/service'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import {
  assertStaffStorageTarget,
  staffStorageProjectRef,
} from '@/lib/staff-api/storageTarget'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { COMPANY_ASSIGNABLE_ROLE_KEYS } from '@/lib/tenant/companyUserRoles'
import { provisionExternalStaffBootstrapInvitation } from '@/lib/auth/companyInvitationFlow'

export type ExternalStaffEnrollmentState = {
  ok: boolean
  message: string
  status?: 'pending'
}
export type ExternalStaffEnrollmentClient = { id: string; name: string }

const unavailable =
  'Inbjudan kunde inte förberedas. Kontrollera din behörighet, bolagets registrering och personalportalens konfiguration.'
const uuid = z.string().uuid()
const inputSchema = z
  .object({
    api_client_id: uuid,
    email: z.string().trim().toLowerCase().email().max(320),
    full_name: z
      .string()
      .trim()
      .max(160)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
      .optional(),
    role_key: z
      .string()
      .refine((value) => COMPANY_ASSIGNABLE_ROLE_KEYS.has(value)),
    idempotency_key: uuid,
  })
  .strict()

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(unavailable)
  return value as Record<string, unknown>
}

function url(value: unknown): URL {
  if (typeof value !== 'string') throw new Error(unavailable)
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(unavailable)
  return parsed
}

function opsOrigin(): string {
  const captured = url(SUPABASE_SERVICE_URL)
  const projectRef = staffStorageProjectRef()
  if (
    !projectRef ||
    captured.pathname !== '/' ||
    captured.hostname !== `${projectRef}.supabase.co`
  )
    throw new Error(unavailable)
  return captured.origin
}

function checkSdk(client: unknown, origin: string): void {
  const sdk = record(client)
  const root = url(sdk.supabaseUrl)
  const auth = url(record(sdk.auth).url)
  const rest = url(record(sdk.rest).url)
  if (
    root.origin !== origin ||
    root.pathname !== '/' ||
    auth.href !== `${origin}/auth/v1` ||
    rest.href !== `${origin}/rest/v1`
  )
    throw new Error(unavailable)
}

/** Attest installed SDK targets, not just configuration strings; never inspect keys. */
export function assertOpsEnrollmentSdkTargets(client: unknown): void {
  const origin = opsOrigin()
  checkSdk(supabaseService, origin)
  checkSdk(client, origin)
  assertStaffStorageTarget(
    new Headers({
      'x-gridex-expected-project-ref': new URL(origin).hostname.split('.')[0],
    }),
  )
}

async function requireEnrollmentActor(companyId: string): Promise<string> {
  uuid.parse(companyId)
  const origin = opsOrigin()
  checkSdk(supabaseService, origin)
  // SSR construction can initialize cookies/session: reject a foreign public URL first.
  const publicUrl = url(getSupabasePublicEnv().url)
  if (publicUrl.origin !== origin || publicUrl.pathname !== '/')
    throw new Error(unavailable)
  const sdk = await createSupabaseServerClient()
  assertOpsEnrollmentSdkTargets(sdk)
  const {
    data: { user },
    error,
  } = await sdk.auth.getUser()
  if (error || !user || !uuid.safeParse(user.id).success)
    throw new Error(unavailable)
  const lifecycle = record(user)
  if (
    (lifecycle.is_anonymous !== undefined &&
      lifecycle.is_anonymous !== false) ||
    lifecycle.deleted_at != null
  )
    throw new Error(unavailable)
  if (lifecycle.banned_until != null) {
    if (
      !z.string().datetime({ offset: true }).safeParse(lifecycle.banned_until)
        .success ||
      Date.parse(String(lifecycle.banned_until)) > Date.now()
    )
      throw new Error(unavailable)
  }
  const { data, error: contextError } = await sdk.rpc(
    'canonical_authenticated_tenant_context',
    { p_selected_company_id: companyId },
  )
  if (contextError) throw new Error(unavailable)
  const context = record(data)
  const permissions = Array.isArray(context.permissions)
    ? context.permissions.filter(
        (value): value is string => typeof value === 'string',
      )
    : []
  if (
    context.authorized !== true ||
    context.user_id !== user.id ||
    context.is_platform_admin !== true ||
    context.selected_company_id !== companyId ||
    !hasPermissionRequirement(permissions, { allOf: ['users.write'] })
  )
    throw new Error(unavailable)
  const company = await requireCompanyOperationalForWrites(companyId)
  if (company.id !== companyId) throw new Error(unavailable)
  return user.id
}

async function registeredClients(
  companyId: string,
  clientId?: string,
): Promise<ExternalStaffEnrollmentClient[]> {
  let query = tenantSelect(
    companyId,
    'integration_api_clients',
    'id,company_id,name',
  )
    .eq('status', 'active')
    .is('deleted_at', null)
    .is('revoked_at', null)
    .contains('scopes', ['staff_users.read', 'staff_users.write'])
    .not('metadata->staff_onboarding_origin', 'is', null)
    .not('metadata->staff_tenant_auth', 'is', null)
    .not('metadata->staff_tenant_delivery', 'is', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('name')
    .limit(100)
  if (clientId) query = query.eq('id', clientId)
  const { data, error } = await query
  if (error || !Array.isArray(data)) throw new Error(unavailable)
  return data.map((value) => {
    const row = record(value)
    if (
      row.company_id !== companyId ||
      !uuid.safeParse(row.id).success ||
      typeof row.name !== 'string' ||
      (clientId && row.id !== clientId)
    )
      throw new Error(unavailable)
    return { id: String(row.id), name: row.name }
  })
}

function parseForm(form: FormData) {
  const fields: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (key.startsWith('$ACTION_')) continue
    if (typeof value !== 'string' || Object.hasOwn(fields, key))
      throw new Error(unavailable)
    fields[key] = value
  }
  return inputSchema.parse(fields)
}

export const externalStaffEnrollmentAdmin = {
  async listClients(
    companyId: string,
  ): Promise<ExternalStaffEnrollmentClient[]> {
    try {
      await requireEnrollmentActor(companyId)
      return await registeredClients(companyId)
    } catch {
      throw new Error(unavailable)
    }
  },
  async enroll(
    companyId: string,
    form: FormData,
  ): Promise<ExternalStaffEnrollmentState> {
    try {
      const input = parseForm(form)
      const actorUserId = await requireEnrollmentActor(companyId)
      if (
        (await registeredClients(companyId, input.api_client_id)).length !== 1
      )
        throw new Error(unavailable)
      await provisionExternalStaffBootstrapInvitation({
        companyId,
        apiClientId: input.api_client_id,
        actorUserId,
        email: input.email,
        fullName: input.full_name || null,
        roleKey: input.role_key,
        idempotencyKey: `ops-external-staff-enrollment:${companyId}:${input.idempotency_key}`,
      })
      return {
        ok: true,
        status: 'pending',
        message:
          'Personalinbjudan är registrerad för leverans via bolagets personalportal.',
      }
    } catch (error) {
      const conflict =
        error &&
        typeof error === 'object' &&
        'message' in error &&
        error.message === 'IDEMPOTENCY_KEY_REUSE_MISMATCH'
      return {
        ok: false,
        message: conflict
          ? 'Försöket måste avse samma inbjudan. Ladda om formuläret för en ny mottagare eller ändrade uppgifter.'
          : unavailable,
      }
    }
  },
}
