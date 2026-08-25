import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Returns the server-verified Supabase user for the current React server render.
 * React cache only deduplicates repeated callers in the same render tree; it
 * does not persist identity across requests or replace auth.getUser().
 * Auth provider errors fail closed as unauthenticated (null).
 */
export const getVerifiedAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  return user
})
