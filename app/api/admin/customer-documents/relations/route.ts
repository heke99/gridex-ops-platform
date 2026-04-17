import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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

  const [gridOwnerDataRequests, outboundRequests, switchRequests] =
    await Promise.all([
      listGridOwnerDataRequestsByCustomerId(customerId),
      listOutboundRequestsByCustomerId(customerId),
      listSupplierSwitchRequestsByCustomerId(supabase, customerId),
    ])

  return NextResponse.json({
    gridOwnerDataRequests,
    outboundRequests,
    switchRequests,
  })
}