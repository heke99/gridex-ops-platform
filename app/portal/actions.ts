'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function switchPortalAccountAction() {
  const supabase = await createSupabaseServerClient()
  const result = await supabase.auth.signOut({ scope: 'local' }).catch(() => null)

  if (!result || result.error) redirect('/portal?konto=byte-misslyckades')
  redirect('/login?next=%2Fportal')
}
