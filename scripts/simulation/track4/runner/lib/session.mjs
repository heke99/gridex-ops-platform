// Staff browser session without a browser: sign in through Supabase Auth with @supabase/ssr and keep the
// exact cookies the app's own server client would set (same library, same chunking), plus the active-company
// cookie the admin guards read (gridex_admin_selected_company_id, lib/admin/navigationPreferences.ts).
import { createServerClient } from '@supabase/ssr'

export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

export async function signIn({ url, anonKey, email, password, companyId }) {
  const jar = new Map()
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) { if (value === '' || value === undefined) jar.delete(name); else jar.set(name, value) } },
    },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error(`staff sign-in failed for ${email}: ${error?.message ?? 'no user'}`)
  if (companyId) jar.set(ADMIN_SELECTED_COMPANY_COOKIE, companyId)
  return {
    userId: data.user.id,
    email,
    accessToken: data.session.access_token,
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  }
}
