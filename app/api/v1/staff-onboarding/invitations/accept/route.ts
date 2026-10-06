import type { NextRequest } from 'next/server'
import { acceptStaffInvitation } from '@/lib/staff-api/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  return acceptStaffInvitation(request)
}
