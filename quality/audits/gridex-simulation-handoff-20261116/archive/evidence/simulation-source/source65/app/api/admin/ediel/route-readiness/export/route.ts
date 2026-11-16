import { NextResponse } from 'next/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { internalApiError } from '@/lib/http/apiError'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET() {
  await requirePlatformAdminAccess()

  const { data, error } = await supabaseService
    .from('gridex_route_readiness_v')
    .select('actor_name,legal_name,org_number,actor_role,message_family,readiness_status,requirement_level,communication_address,subaddress,environment,route_status,is_verified,auto_send_allowed,next_step')
    .order('readiness_status', { ascending: true })
    .order('actor_name', { ascending: true })
    .limit(5000)

  if (error) return internalApiError({ context: 'route-readiness-export', error, code: 'route_readiness_export_failed', message: 'Route-readiness kunde inte exporteras.' })

  const rows = data ?? []
  const headers = [
    'actor_name','legal_name','org_number','actor_role','message_family','readiness_status','requirement_level',
    'communication_address','subaddress','environment','route_status','is_verified','auto_send_allowed','next_step',
  ]
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell((row as Record<string, unknown>)[header])).join(','))].join('\n')

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="gridex-route-readiness.csv"',
    },
  })
}
