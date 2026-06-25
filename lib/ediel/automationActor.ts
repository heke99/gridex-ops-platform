import { supabaseService } from '@/lib/supabase/service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function schemaError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(record.code ?? '')
  const message = String(record.message ?? record.details ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /does not exist|schema cache|column .* does not exist/i.test(message)
}

export function configuredEdielAutomationActorId(): string {
  const value = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID?.trim() ?? ''
  if (!UUID.test(value)) {
    throw new Error('ediel_actor_invalid_uuid: EDIEL_AUTOMATION_ACTOR_USER_ID måste vara en giltig användaridentitet för automatiska Ediel-åtgärder.')
  }
  return value
}

async function hasUserProfile(userId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .limit(1)
    .maybeSingle()
  if (error) {
    if (schemaError(error)) return false
    throw error
  }
  return Boolean(data?.id)
}

async function hasAuthUser(userId: string): Promise<boolean> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error) return false
  return Boolean(data?.user?.id)
}

async function membershipExistsByColumn(userId: string, column: 'status' | 'is_active'): Promise<boolean> {
  const query = supabaseService
    .from('company_memberships')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  const { data, error } = column === 'status'
    ? await query.eq('status', 'active').maybeSingle()
    : await query.eq('is_active', true).maybeSingle()

  if (error) {
    if (schemaError(error)) return false
    throw error
  }
  return Boolean(data?.id)
}

async function hasActiveMembership(userId: string): Promise<boolean> {
  return await membershipExistsByColumn(userId, 'status') || await membershipExistsByColumn(userId, 'is_active')
}

/**
 * A configured UUID is not enough. Automation must be attributable to an
 * existing platform identity, otherwise audit rows become unverifiable. The
 * live OPS schema can have either user_profiles or auth.users + active
 * company_memberships as the source of truth, so accept both safe identities.
 */
export async function resolveConfiguredEdielAutomationActorId(): Promise<string> {
  const userId = configuredEdielAutomationActorId()
  if (await hasUserProfile(userId)) return userId

  const authUserExists = await hasAuthUser(userId)
  if (!authUserExists) {
    throw new Error('ediel_actor_missing_auth_user: EDIEL_AUTOMATION_ACTOR_USER_ID saknar motsvarande auth.users-rad.')
  }

  if (await hasActiveMembership(userId)) return userId

  throw new Error('ediel_actor_missing_profile_or_membership: EDIEL_AUTOMATION_ACTOR_USER_ID saknar user_profiles-rad och aktiv company_memberships-rad.')
}
