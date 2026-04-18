import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  listGridOwnerDataRequestsByCustomerId,
  listOutboundRequestsByCustomerId,
} from '@/lib/cis/db'
import { listSupplierSwitchRequestsByCustomerId } from '@/lib/operations/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId')

  if (!customerId) {
    return NextResponse.json({ error: 'customerId saknas' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const { data: documentRows, error: documentError } = await supabaseService
    .from('customer_authorization_documents')
    .select('id')
    .eq('customer_id', customerId)

  if (documentError) {
    return NextResponse.json({ error: documentError.message }, { status: 500 })
  }

  const documentIds = (documentRows ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === 'string')

  const [gridOwnerDataRequests, outboundRequests, switchRequests] =
    await Promise.all([
      listGridOwnerDataRequestsByCustomerId(customerId),
      listOutboundRequestsByCustomerId(customerId),
      listSupplierSwitchRequestsByCustomerId(supabase, customerId),
    ])

  let documentAuditLogs: unknown[] = []

  if (documentIds.length > 0) {
    const { data, error } = await supabaseService
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'customer_authorization_document')
      .in('entity_id', documentIds)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    documentAuditLogs = data ?? []
  }

  return NextResponse.json({
    gridOwnerDataRequests,
    outboundRequests,
    switchRequests,
    documentAuditLogs,
  })
}