import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const { data, error } = await supabaseService
      .from('customer_documents')
      .select('id,customer_id,document_type,title,file_name,mime_type,file_size_bytes,file_path,public_url,source_system,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: data?.length ?? 0 })
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
