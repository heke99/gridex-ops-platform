import { supabaseService } from '@/lib/supabase/service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function configuredEdielAutomationActorId(): string {
  const value = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID?.trim() ?? ''
  if (!UUID.test(value)) {
    throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID måste vara en giltig användaridentitet för automatiska Ediel-åtgärder.')
  }
  return value
}

/**
 * A configured UUID is not enough. Automation must be attributable to an
 * existing platform identity, otherwise audit rows become unverifiable.
 */
export async function resolveConfiguredEdielAutomationActorId(): Promise<string> {
  const userId = configuredEdielAutomationActorId()
  const { data, error } = await supabaseService
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) {
    throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID saknar motsvarande user_profiles-rad. Skapa eller konfigurera systemaktören innan automation körs.')
  }
  return userId
}
