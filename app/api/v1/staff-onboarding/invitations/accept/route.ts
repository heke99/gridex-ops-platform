import type { NextRequest } from 'next/server'
import { acceptStaffInvitation } from '@/lib/staff-api/onboarding'
import { createStaffOnboardingMethodRejection, staffOnboardingOptions } from '@/lib/staff-api/onboardingMethodResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  return acceptStaffInvitation(request)
}

const rejectMethod = createStaffOnboardingMethodRejection(acceptStaffInvitation)

export {
  rejectMethod as DELETE,
  rejectMethod as GET,
  rejectMethod as HEAD,
  rejectMethod as PATCH,
  rejectMethod as PUT,
  staffOnboardingOptions as OPTIONS,
}
