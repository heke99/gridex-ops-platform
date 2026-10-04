import { NextRequest } from 'next/server'
import { staffReleaseManifestResponse } from '@/lib/staff-api/openApiReleaseManifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return staffReleaseManifestResponse(request)
}
