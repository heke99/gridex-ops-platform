'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function auditLaunchAction(input: {
  actorUserId: string
  action: string
  actorId?: string | null
  routeId?: string | null
  metadata?: Record<string, unknown>
}) {
  await supabaseService
    .from('audit_logs')
    .insert({
      action: input.action,
      actor_user_id: input.actorUserId,
      entity_type: input.routeId ? 'platform_actor_routes' : 'platform_market_actors',
      entity_id: input.routeId ?? input.actorId ?? 'unknown',
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    })
    .then((result) => {
      if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
    })
}

function revalidateRouteReadiness() {
  revalidatePath('/admin/ediel/route-readiness')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/system-health')
}

export async function verifyActorRouteForManualSendAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const routeId = value(formData, 'routeId')
  if (!actorId) throw new Error('Actor saknas.')

  const actorUpdate = await supabaseService
    .from('platform_market_actors')
    .update({
      status: 'active',
      match_status: 'verified',
      visible_to_tenants: true,
      verified_at: new Date().toISOString(),
      verified_by: context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actorId)
  if (actorUpdate.error) throw actorUpdate.error

  if (routeId) {
    const routeUpdate = await supabaseService
      .from('platform_actor_routes')
      .update({
        status: 'active',
        is_verified: true,
        auto_send_allowed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', routeId)
      .eq('actor_id', actorId)
    if (routeUpdate.error) throw routeUpdate.error
  }

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.verified_manual_send',
    actorId,
    routeId,
    metadata: { auto_send_allowed: false },
  })
  revalidateRouteReadiness()
}

export async function createRouteManualReviewAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const messageFamily = value(formData, 'messageFamily')
  const actorRole = value(formData, 'actorRole')
  const note = value(formData, 'note') ?? 'Route behöver manuell granskning före launch.'
  if (!actorId) throw new Error('Actor saknas.')

  const result = await supabaseService
    .from('platform_actor_import_issues')
    .insert({
      actor_id: actorId,
      issue_type: 'manual_route_review',
      severity: 'blocking',
      status: 'open',
      message: note,
      metadata: {
        message_family: messageFamily,
        actor_role: actorRole,
        created_from: '/admin/ediel/route-readiness',
        created_by: context.userId,
      },
    })
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.manual_review_created',
    actorId,
    metadata: { messageFamily, actorRole, note },
  })
  revalidateRouteReadiness()
}

export async function markRouteNotRelevantAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const messageFamily = value(formData, 'messageFamily')
  const actorRole = value(formData, 'actorRole')
  if (!actorId) throw new Error('Actor saknas.')

  const result = await supabaseService
    .from('platform_actor_import_issues')
    .insert({
      actor_id: actorId,
      issue_type: 'route_not_required',
      severity: 'info',
      status: 'ignored',
      message: 'Route markerad som ej relevant för launch-readiness.',
      metadata: {
        message_family: messageFamily,
        actor_role: actorRole,
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      },
      resolved_at: new Date().toISOString(),
    })
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.not_relevant',
    actorId,
    metadata: { messageFamily, actorRole },
  })
  revalidateRouteReadiness()
}

export async function markContactOnlySupplierAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  if (!actorId) throw new Error('Actor saknas.')

  const existing = await supabaseService
    .from('platform_market_actors')
    .select('metadata')
    .eq('id', actorId)
    .maybeSingle()
  if (existing.error) throw existing.error

  const metadata = {
    ...((existing.data?.metadata ?? {}) as Record<string, unknown>),
    contact_only_supplier: true,
    contact_only_marked_at: new Date().toISOString(),
    contact_only_marked_by: context.userId,
  }

  const result = await supabaseService
    .from('platform_market_actors')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', actorId)
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.contact_only_supplier',
    actorId,
    metadata,
  })
  revalidateRouteReadiness()
}

export async function saveSupplierContactAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const contactType = value(formData, 'contactType') ?? 'general'
  const email = value(formData, 'email')
  const phone = value(formData, 'phone')
  if (!actorId) throw new Error('Actor saknas.')
  if (!email && !phone) throw new Error('E-post eller telefon krävs.')

  const payload = {
    actor_id: actorId,
    contact_type: contactType,
    email,
    phone,
    contact_name: value(formData, 'contactName'),
    channel: email ? 'email' : 'phone',
    source: 'manual',
    is_verified: true,
    verified_by: context.userId,
    verified_at: new Date().toISOString(),
    notes: value(formData, 'notes'),
    updated_at: new Date().toISOString(),
  }

  let lookup = supabaseService
    .from('platform_actor_contacts')
    .select('id')
    .eq('actor_id', actorId)
    .eq('contact_type', contactType)
    .limit(1)

  lookup = email ? lookup.eq('email', email) : lookup.is('email', null)
  lookup = phone ? lookup.eq('phone', phone) : lookup.is('phone', null)

  const existing = await lookup.maybeSingle()
  if (existing.error) throw existing.error

  const result = existing.data?.id
    ? await supabaseService.from('platform_actor_contacts').update(payload).eq('id', existing.data.id)
    : await supabaseService.from('platform_actor_contacts').insert(payload)

  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'supplier_contact.verified_upsert',
    actorId,
    metadata: { contactType, email: email ? '[set]' : null, phone: phone ? '[set]' : null },
  })
  revalidateRouteReadiness()
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index]?.trim() ?? ''
      return row
    }, {})
  })
}

function truthy(value: string | null | undefined): boolean {
  return ['true', '1', 'yes', 'ja', 'verified', 'verifierad'].includes(String(value ?? '').trim().toLowerCase())
}

async function findActorForImportedContact(row: Record<string, string>): Promise<string | null> {
  const edielId = row.ediel_id?.trim()
  if (edielId) {
    const identifier = await supabaseService
      .from('platform_actor_identifiers')
      .select('actor_id')
      .eq('identifier_value', edielId)
      .limit(1)
      .maybeSingle()
    if (identifier.error && !['42P01', '42703', 'PGRST205'].includes(identifier.error.code ?? '')) throw identifier.error
    if (identifier.data?.actor_id) return String(identifier.data.actor_id)
  }

  const orgNumber = row.org_number?.replace(/\D/g, '')
  if (orgNumber) {
    const actor = await supabaseService
      .from('platform_market_actors')
      .select('id')
      .eq('org_number', orgNumber)
      .limit(1)
      .maybeSingle()
    if (actor.error) throw actor.error
    if (actor.data?.id) return String(actor.data.id)
  }

  const actorName = row.actor_name?.trim()
  if (actorName) {
    const actor = await supabaseService
      .from('platform_market_actors')
      .select('id')
      .ilike('name', actorName)
      .limit(1)
      .maybeSingle()
    if (actor.error) throw actor.error
    if (actor.data?.id) return String(actor.data.id)
  }

  return null
}

async function createImportIssue(input: {
  contextUserId: string
  row: Record<string, string>
  issueType: string
  message: string
  severity?: string
  actorId?: string | null
}) {
  const result = await supabaseService
    .from('platform_actor_import_issues')
    .insert({
      actor_id: input.actorId ?? null,
      issue_type: input.issueType,
      severity: input.severity ?? 'warning',
      status: 'open',
      message: input.message,
      metadata: {
        source: 'supplier_contact_csv_import',
        imported_by: input.contextUserId,
        imported_at: new Date().toISOString(),
        row: input.row,
      },
    })
  if (result.error) throw result.error
}

export async function importSupplierContactsCsvAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('contactsCsv')
  const fileLike = file as { text?: () => Promise<string> } | null
  if (!file || typeof file === 'string' || typeof fileLike?.text !== 'function') {
    throw new Error('CSV-fil saknas.')
  }

  const text = await fileLike.text()
  const rows = parseCsv(text)
  if (rows.length === 0) throw new Error('CSV-filen saknar rader.')

  let imported = 0
  let conflicts = 0
  let missingActors = 0

  for (const row of rows) {
    const actorId = await findActorForImportedContact(row)
    if (!actorId) {
      missingActors += 1
      await createImportIssue({
        contextUserId: context.userId,
        row,
        issueType: 'supplier_contact_actor_not_found',
        severity: 'blocking',
        message: 'Kontaktväg kunde inte importeras eftersom aktören inte hittades via Ediel-ID, orgnummer eller namn.',
      })
      continue
    }

    const contactType = row.contact_type?.trim() || 'general'
    const email = row.contact_email?.trim() || null
    const phone = row.contact_phone?.trim() || null
    if (!email && !phone) {
      conflicts += 1
      await createImportIssue({
        contextUserId: context.userId,
        actorId,
        row,
        issueType: 'supplier_contact_missing_contact_value',
        message: 'Kontaktvägen saknar både e-post och telefon.',
      })
      continue
    }

    if (row.actor_role?.trim()) {
      const roleResult = await supabaseService
        .from('platform_actor_roles')
        .upsert({ actor_id: actorId, actor_role: row.actor_role.trim(), is_active: true, role_source: 'supplier_contact_csv_import', updated_at: new Date().toISOString() }, { onConflict: 'actor_id,actor_role' })
      if (roleResult.error) throw roleResult.error
    }

    const existing = await supabaseService
      .from('platform_actor_contacts')
      .select('id,email,phone,is_verified')
      .eq('actor_id', actorId)
      .eq('contact_type', contactType)
      .limit(1)
      .maybeSingle()
    if (existing.error) throw existing.error

    const existingEmail = typeof existing.data?.email === 'string' ? existing.data.email : null
    const existingPhone = typeof existing.data?.phone === 'string' ? existing.data.phone : null
    const incomingDiffers = Boolean(existing.data?.id && (existingEmail !== email || existingPhone !== phone))
    if (existing.data?.is_verified && incomingDiffers) {
      conflicts += 1
      await createImportIssue({
        contextUserId: context.userId,
        actorId,
        row,
        issueType: 'supplier_contact_verified_conflict',
        severity: 'blocking',
        message: 'CSV-raden matchar en verifierad kontaktväg men värdet skiljer sig. Verifierad data skrivs inte över utan review.',
      })
      continue
    }

    const payload = {
      actor_id: actorId,
      contact_type: contactType,
      email,
      phone,
      contact_name: row.contact_name?.trim() || null,
      channel: row.channel?.trim() || (email ? 'email' : 'phone'),
      source: row.source?.trim() || 'csv_import',
      is_verified: truthy(row.is_verified),
      verified_by: truthy(row.is_verified) ? context.userId : null,
      verified_at: truthy(row.is_verified) ? new Date().toISOString() : null,
      notes: row.notes?.trim() || null,
      metadata: { imported_from: 'supplier_contact_csv', raw: row },
      updated_at: new Date().toISOString(),
    }

    const result = existing.data?.id
      ? await supabaseService.from('platform_actor_contacts').update(payload).eq('id', existing.data.id)
      : await supabaseService.from('platform_actor_contacts').insert(payload)
    if (result.error) throw result.error
    imported += 1
  }

  await supabaseService
    .from('platform_actor_contact_import_runs')
    .insert({
      source: 'csv',
      status: conflicts > 0 || missingActors > 0 ? 'completed_with_issues' : 'completed',
      imported_count: imported,
      conflict_count: conflicts,
      missing_actor_count: missingActors,
      total_rows: rows.length,
      imported_by: context.userId,
      metadata: { imported, conflicts, missingActors },
    })
    .then((result) => {
      if (result.error && !['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
    })

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'supplier_contact.csv_imported',
    metadata: { imported, conflicts, missingActors, totalRows: rows.length },
  })
  revalidateRouteReadiness()
}

export async function bulkRouteReadinessByStatusAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const readinessStatus = value(formData, 'readinessStatus')
  const bulkAction = value(formData, 'bulkAction')
  if (!readinessStatus || !bulkAction) throw new Error('Välj status och bulkåtgärd.')

  const rowsResult = await supabaseService
    .from('gridex_route_readiness_v')
    .select('actor_id,route_id,actor_role,message_family,readiness_status')
    .eq('readiness_status', readinessStatus)
    .limit(500)
  if (rowsResult.error) throw rowsResult.error

  const rows = (rowsResult.data ?? []) as Array<{
    actor_id: string
    route_id: string | null
    actor_role: string | null
    message_family: string | null
    readiness_status: string
  }>

  let affected = 0
  for (const row of rows) {
    if (bulkAction === 'verify_manual_send' && row.route_id) {
      const actorUpdate = await supabaseService
        .from('platform_market_actors')
        .update({ status: 'active', match_status: 'verified', visible_to_tenants: true, verified_at: new Date().toISOString(), verified_by: context.userId, updated_at: new Date().toISOString() })
        .eq('id', row.actor_id)
      if (actorUpdate.error) throw actorUpdate.error

      const routeUpdate = await supabaseService
        .from('platform_actor_routes')
        .update({ status: 'active', is_verified: true, auto_send_allowed: false, updated_at: new Date().toISOString() })
        .eq('id', row.route_id)
        .eq('actor_id', row.actor_id)
      if (routeUpdate.error) throw routeUpdate.error
      affected += 1
    }

    if (bulkAction === 'create_review') {
      await supabaseService.from('platform_actor_import_issues').insert({
        actor_id: row.actor_id,
        issue_type: 'manual_route_review',
        severity: ['critical_missing_route', 'not_sendable'].includes(row.readiness_status) ? 'blocking' : 'warning',
        status: 'open',
        message: 'Route behöver manuell granskning före launch.',
        metadata: { message_family: row.message_family, actor_role: row.actor_role, created_from: 'route_readiness_bulk', created_by: context.userId },
      }).then((result) => { if (result.error) throw result.error })
      affected += 1
    }

    if (bulkAction === 'mark_not_relevant') {
      await supabaseService.from('platform_actor_import_issues').insert({
        actor_id: row.actor_id,
        issue_type: 'route_not_required',
        severity: 'info',
        status: 'ignored',
        message: 'Route markerad som ej relevant via bulkåtgärd.',
        metadata: { message_family: row.message_family, actor_role: row.actor_role, decided_by: context.userId, decided_at: new Date().toISOString() },
        resolved_at: new Date().toISOString(),
      }).then((result) => { if (result.error) throw result.error })
      affected += 1
    }

    if (bulkAction === 'contact_only_supplier' && ['electricity_supplier', 'supplier'].includes(String(row.actor_role))) {
      const existing = await supabaseService.from('platform_market_actors').select('metadata').eq('id', row.actor_id).maybeSingle()
      if (existing.error) throw existing.error
      await supabaseService.from('platform_market_actors').update({
        metadata: {
          ...((existing.data?.metadata ?? {}) as Record<string, unknown>),
          contact_only_supplier: true,
          contact_only_marked_at: new Date().toISOString(),
          contact_only_marked_by: context.userId,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', row.actor_id).then((result) => { if (result.error) throw result.error })
      affected += 1
    }
  }

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.bulk_action',
    metadata: { readinessStatus, bulkAction, affected, scanned: rows.length, auto_send_allowed: false },
  })
  revalidateRouteReadiness()
}
