import { STAFF_ONBOARDING_CONTRACT_VERSION } from '@/lib/staff-api/onboardingContract'
import { staffStorageProjectRef } from '@/lib/staff-api/storageTarget'

export function staffOnboardingJson(
  requestId: string,
  data: unknown,
  status = 200,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-ID': requestId,
    'X-Gridex-Contract-Version': STAFF_ONBOARDING_CONTRACT_VERSION,
  })
  const projectRef = staffStorageProjectRef()
  if (projectRef) headers.set('X-Gridex-Project-Ref', projectRef)
  if (status === 429 && retryAfterSeconds !== undefined && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
    headers.set('Retry-After', String(retryAfterSeconds))
  }
  return Response.json({
    ...(status < 400 ? { data } : { error: data }),
    request_id: requestId,
    contract_schema_version: STAFF_ONBOARDING_CONTRACT_VERSION,
  }, { status, headers })
}
