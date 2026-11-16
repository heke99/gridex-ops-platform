import { ApiInputError } from '@/lib/api/strictRequest'
import { SUPABASE_SERVICE_URL } from '@/lib/supabase/service'

export function staffStorageProjectRef(): string | null {
  try {
    const url = new URL(SUPABASE_SERVICE_URL)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password ? /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1] ?? null : null
  } catch { return null }
}

/** Compare before auth/rate-limit/audit/handler database access, including writes. */
export function assertStaffStorageTarget(headers: Headers): void {
  const requested = headers.get('x-gridex-expected-project-ref')
  if (requested !== null && (!/^[a-z0-9]{20}$/.test(requested) || requested !== staffStorageProjectRef())) {
    throw new ApiInputError('The requested storage project is not served by this API deployment.', 'storage_project_mismatch', 412)
  }
}
