import type { NextRequest } from 'next/server'
import { resolveStaffIdentity } from '@/lib/staff-api/identityResolution'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  return resolveStaffIdentity(request)
}
