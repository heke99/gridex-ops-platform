import type { NextRequest } from 'next/server'
import { resolveStaffIdentity } from '@/lib/staff-api/identityResolution'
import { createStaffOnboardingMethodRejection, staffOnboardingOptions } from '@/lib/staff-api/onboardingMethodResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  return resolveStaffIdentity(request)
}

const rejectMethod = createStaffOnboardingMethodRejection(resolveStaffIdentity)

export {
  rejectMethod as DELETE,
  rejectMethod as GET,
  rejectMethod as HEAD,
  rejectMethod as PATCH,
  rejectMethod as PUT,
  staffOnboardingOptions as OPTIONS,
}
