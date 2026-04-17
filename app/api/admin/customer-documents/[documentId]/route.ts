import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const { documentId } = await context.params
  const mode = request.nextUrl.searchParams.get('mode') === 'download'
    ? 'download'
    : 'open'

  const { data: document, error } = await supabaseService
    .from('customer_authorization_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!document) {
    return NextResponse.json({ error: 'Dokumentet hittades inte' }, { status: 404 })
  }

  const bucket = document.storage_bucket || 'customer-documents'

  const signedUrlResponse = await supabaseService.storage
    .from(bucket)
    .createSignedUrl(document.file_path, 60, {
      download: mode === 'download' ? document.file_name || true : undefined,
    })

  if (signedUrlResponse.error || !signedUrlResponse.data?.signedUrl) {
    return NextResponse.json(
      { error: signedUrlResponse.error?.message ?? 'Kunde inte skapa signed URL' },
      { status: 500 }
    )
  }

  return NextResponse.redirect(signedUrlResponse.data.signedUrl)
}