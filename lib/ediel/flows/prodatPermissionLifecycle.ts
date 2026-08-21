import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent, linkEdielMessage } from '@/lib/ediel/db'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { extractProdatSubtype } from '@/lib/ediel/stateMachines/prodatLifecycle'
import type { EdielMessageRow } from '@/lib/ediel/types'

type JsonRecord = Record<string, unknown>

export type ProdatPermissionPersistenceResult = {
  applied: boolean
  permissionId: string | null
  status: 'active' | 'ended' | 'manual_review'
  reason: string | null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function dateOnly(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function permissionReferences(message: EdielMessageRow): string[] {
  const parsed = parseProdatMessage(message)
  const payload = record(message.parsed_payload)
  return unique([
    message.external_reference,
    message.transaction_reference,
    message.correlation_reference,
    text(payload.permissionId),
    text(payload.permission_id),
    text(payload.permissionReference),
    text(payload.rffLiReference),
    ...parsed.lineItems.flatMap((line) => [
      line.permissionId,
      line.lineItemReference,
      line.agreementReference,
    ]),
  ])
}

async function findSinglePermission(message: EdielMessageRow): Promise<JsonRecord | null> {
  const companyId = message.company_id
  if (!companyId) return null
  const references = permissionReferences(message)

  let query = supabaseService
    .from('metering_permissions')
    .select('*')
    .eq('company_id', companyId)
    .in('status', [
      'active',
      'approved',
      'z14_received',
      'partially_approved',
      'ended',
      'cancelled',
    ])
    .order('created_at', { ascending: false })
    .limit(100)

  if (message.customer_id) query = query.eq('customer_id', message.customer_id)
  if (message.metering_point_id) query = query.eq('metering_point_id', message.metering_point_id)

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]

  const matched = rows.filter((row) => {
    const rowRefs = unique([
      text(row.permission_reference),
      text(row.case_reference),
      text(row.rff_li_reference),
      text(row.permission_id),
    ])
    return references.some((reference) => rowRefs.includes(reference))
  })

  if (matched.length === 1) return matched[0] ?? null
  if (matched.length > 1) return null

  // A unique tenant/customer/metering-point candidate may be used only when
  // references are absent. Never guess between multiple permissions.
  if (references.length === 0 && rows.length === 1) return rows[0] ?? null
  return null
}

export async function applyInboundZ15PermissionState(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ProdatPermissionPersistenceResult> {
  const code = String(params.message.message_code ?? '').toUpperCase().slice(0, 3)
  if (code !== 'Z15' || params.message.direction !== 'inbound') {
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'not_inbound_z15' }
  }

  const subtype = extractProdatSubtype(params.message)
  if (!['V', 'VH', 'C'].includes(subtype ?? '')) {
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'unsupported_z15_subtype' }
  }

  const permission = await findSinglePermission(params.message)
  const permissionRowId = text(permission?.id)
  if (!permission || !permissionRowId || !params.message.company_id) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'PRODAT Z15 kunde inte kopplas entydigt till ett mätvärdestillstånd. Ingen permission-state ändrades.',
      payload: {
        subtype,
        references: permissionReferences(params.message),
        semanticGuard: 'fail_closed_permission_correlation',
      },
    })
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'no_unique_metering_permission' }
  }

  const parsed = parseProdatMessage(params.message)
  const firstLine = parsed.lineItems[0]
  const now = new Date().toISOString()
  const currentMetadata = record(permission.metadata)
  const nextStatus = subtype === 'C' ? 'active' : 'ended'

  const patch: JsonRecord = {
    status: nextStatus,
    inbound_z15_message_id: params.message.id,
    last_blocker: null,
    metadata: {
      ...currentMetadata,
      z15: {
        edielMessageId: params.message.id,
        subtype,
        permissionId: firstLine?.permissionId ?? null,
        permissionEndReason: firstLine?.permissionEndReason ?? null,
        contractEndDate: firstLine?.contractEndDate ?? null,
        reportingContinues: subtype === 'C',
        appliedAt: now,
      },
    },
    updated_at: now,
  }

  // For V/VH preserve the market end date when supplied. Z15C is a reversal:
  // do not invent/clear contractual dates because the existing approved period
  // may have an independent end date.
  if (subtype !== 'C') {
    const endDate = dateOnly(firstLine?.contractEndDate ?? firstLine?.reportEndDate ?? null)
    if (endDate) patch.approved_end_date = endDate
  }

  const { data, error } = await supabaseService
    .from('metering_permissions')
    .update(patch)
    .eq('company_id', params.message.company_id)
    .eq('id', permissionRowId)
    .select('id')

  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) throw new Error('z15_permission_update_missed')

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    customerId: text(permission.customer_id) ?? params.message.customer_id,
    siteId: text(permission.site_id) ?? params.message.site_id,
    meteringPointId: text(permission.metering_point_id) ?? params.message.metering_point_id,
    gridOwnerId: text(permission.grid_owner_id) ?? params.message.grid_owner_id,
    relatedMessageId: params.message.related_message_id,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: subtype === 'C'
      ? 'PRODAT Z15C kopplades till tillståndet. Mätvärdesrapporteringen fortsätter.'
      : `PRODAT Z15${subtype} kopplades till tillståndet. Mätvärdesrapporteringen avslutades.`,
    payload: {
      meteringPermissionId: permissionRowId,
      subtype,
      nextStatus,
      semanticVersion: 'PRODAT-26A',
    },
  })

  return {
    applied: true,
    permissionId: permissionRowId,
    status: nextStatus,
    reason: null,
  }
}
