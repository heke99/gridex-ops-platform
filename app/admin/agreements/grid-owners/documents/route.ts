import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseStoragePath(value: string | null): { bucket: string; path: string } | null {
  if (!value) return null
  const separator = value.indexOf(':')
  if (separator > 0) return { bucket: value.slice(0, separator), path: value.slice(separator + 1) }
  return { bucket: process.env.GRID_OWNER_AGREEMENTS_BUCKET ?? 'grid-owner-agreements', path: value }
}

export async function GET(request: NextRequest) {
  await requirePlatformAdminAccess()
  const parsed = parseStoragePath(request.nextUrl.searchParams.get('path'))
  if (!parsed) return NextResponse.json({ ok: false, error: 'Document path saknas.' }, { status: 400 })

  const { data, error } = await supabaseService.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Kunde inte skapa signerad länk.' }, { status: 404 })
  }

  return NextResponse.redirect(data.signedUrl)
}
