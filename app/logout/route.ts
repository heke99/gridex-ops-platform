import { NextResponse } from 'next/server'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/login', getBaseAppUrl()))
}
