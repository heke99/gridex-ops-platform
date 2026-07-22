import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Removed from the public OPS surface in API 2026-07-22.2. */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      error: {
        code: 'public_energy_area_removed',
        message:
          'Publik elområdesresolution tillhandahålls inte längre av OPS. Tenantens webbplats ansvarar för sin resolver.',
      },
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        Deprecation: 'true',
        Sunset: 'Wed, 22 Jul 2026 23:59:59 GMT',
      },
    },
  )
}
