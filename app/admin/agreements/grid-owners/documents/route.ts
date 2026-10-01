import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { isGridOwnerAgreementBucket, parseGridOwnerAgreementDocumentKey } from '@/lib/routes/gridOwnerAgreementDocumentKey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requirePlatformAdminAccess()
  const agreementBucket = process.env.GRID_OWNER_AGREEMENTS_BUCKET ?? 'grid-owner-agreements'
  const unavailable = () => NextResponse.json({ ok: false, error: 'Dokumentet är inte tillgängligt just nu.' }, { status: 503 })
  if (!isGridOwnerAgreementBucket(agreementBucket) || agreementBucket === 'customer-support-quarantine') return unavailable()

  const documentPath = request.nextUrl.searchParams.get('path')
  const parsed = parseGridOwnerAgreementDocumentKey(documentPath, agreementBucket)
  if (!parsed) return NextResponse.json({ ok: false, error: 'Document path saknas.' }, { status: 400 })
  if (parsed.bucket !== agreementBucket || parsed.bucket === 'customer-support-quarantine') {
    return NextResponse.json({ ok: false, error: 'Dokumentet är inte tillgängligt.' }, { status: 403 })
  }

  try {
    const authClient = await createSupabaseServerClient()
    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData.user || authData.user.id !== context.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: agreement, error: agreementError } = await supabaseService
      .from('grid_owner_access_agreements')
      .select('id,document_path')
      .eq('document_path', documentPath)
      .maybeSingle()
    if (agreementError) return unavailable()
    if (!agreement?.id || agreement.document_path !== documentPath) {
      return NextResponse.json({ ok: false, error: 'Dokumentet är inte tillgängligt.' }, { status: 404 })
    }

    const { data, error } = await supabaseService.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60)
    if (error || !data?.signedUrl) return unavailable()
    return NextResponse.redirect(data.signedUrl)
  } catch (error) {
    unstable_rethrow(error)
    return unavailable()
  }
}
