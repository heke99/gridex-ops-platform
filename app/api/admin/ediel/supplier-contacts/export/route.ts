import { NextResponse } from 'next/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET() {
  await requirePlatformAdminAccess()

  const { data: contacts, error } = await supabaseService
    .from('platform_actor_contacts')
    .select('actor_id,contact_type,email,phone,contact_name,channel,source,is_verified,notes')
    .order('actor_id', { ascending: true })
    .limit(10000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const actorIds = [...new Set((contacts ?? []).map((contact) => String(contact.actor_id)).filter(Boolean))]
  const { data: actors } = actorIds.length
    ? await supabaseService.from('platform_market_actors').select('id,name,org_number').in('id', actorIds)
    : { data: [] }
  const { data: identifiers } = actorIds.length
    ? await supabaseService.from('platform_actor_identifiers').select('actor_id,identifier_value').in('actor_id', actorIds).limit(10000)
    : { data: [] }
  const { data: roles } = actorIds.length
    ? await supabaseService.from('platform_actor_roles').select('actor_id,actor_role').in('actor_id', actorIds).eq('is_active', true).limit(10000)
    : { data: [] }

  const actorsById = new Map((actors ?? []).map((actor) => [String(actor.id), actor]))
  const edielByActor = new Map<string, string>()
  for (const identifier of identifiers ?? []) {
    const actorId = String(identifier.actor_id)
    if (!edielByActor.has(actorId)) edielByActor.set(actorId, String(identifier.identifier_value ?? ''))
  }
  const roleByActor = new Map<string, string>()
  for (const role of roles ?? []) {
    const actorId = String(role.actor_id)
    if (!roleByActor.has(actorId)) roleByActor.set(actorId, String(role.actor_role ?? ''))
  }

  const headers = ['actor_name','org_number','ediel_id','actor_role','contact_type','contact_email','contact_phone','contact_name','channel','source','is_verified','notes']
  const rows = (contacts ?? []).map((contact) => {
    const actorId = String(contact.actor_id)
    const actor = actorsById.get(actorId)
    return [
      actor?.name,
      actor?.org_number,
      edielByActor.get(actorId),
      roleByActor.get(actorId),
      contact.contact_type,
      contact.email,
      contact.phone,
      contact.contact_name,
      contact.channel,
      contact.source,
      contact.is_verified,
      contact.notes,
    ]
  })

  const csv = [headers.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n')
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="gridex-supplier-contacts.csv"',
    },
  })
}
