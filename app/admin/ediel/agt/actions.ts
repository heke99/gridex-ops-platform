'use server'

import { revalidatePath } from 'next/cache'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { saveCommunicationRoute } from '@/lib/cis/db'
import { createEdielTestRun } from '@/lib/ediel/db'
import type { EdielRouteProfileAckMode } from '@/lib/ediel/types'
import {
  EDIEL_AGT_APPROVAL_VERSION_2026A,
  EDIEL_AGT_PORTAL_EDIEL_ID,
  EDIEL_AGT_PORTAL_SMTP,
  EDIEL_AGT_PRODAT_SUB_ADDRESS,
  EDIEL_AGT_SUPPLIER_2026A_CASES,
  EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID,
  getEdielAgtRouteName,
  getEdielAgtSupplier2026ACase,
} from '@/lib/ediel/agtRegistry'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(formData: FormData, key: string): string | null {
  return value(formData, key)?.toUpperCase() ?? null
}


function nullableUpper(value: string | null): string | null {
  return value ? value.toUpperCase() : null
}

function emptyToNull(input: string | null): string | null {
  return input && input.trim().length > 0 ? input.trim() : null
}

function revalidateAgt() {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/agt')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/settings')
}

async function getCurrentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')
  return user.id
}

async function saveActiveSupplierActor(input: {
  actorUserId: string
  actorName: string
  actorEdielId: string
  senderName: string | null
  smtpFromEmail: string | null
  smtpReplyToEmail: string | null
  mailbox: string | null
  notes: string | null
}) {
  if (!input.actorName || !input.actorEdielId) {
    throw new Error('Bolagsnamn och Ediel-id måste fyllas i.')
  }

  if (input.actorEdielId === EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID) {
    throw new Error(
      `Ediel-id ${EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID} är Gridcore/TGT-id och får inte användas som leverantörens aktörs-id i AGT.`
    )
  }

  const deactivate = await supabaseService
    .from('ediel_actor_settings')
    .update({
      is_active: false,
      updated_by: input.actorUserId,
    })
    .eq('environment', 'test')

  if (deactivate.error) throw deactivate.error

  const existing = await supabaseService
    .from('ediel_actor_settings')
    .select('id')
    .eq('environment', 'test')
    .eq('actor_ediel_id', input.actorEdielId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const payload = {
    actor_name: input.actorName,
    actor_ediel_id: input.actorEdielId,
    actor_role: 'supplier',
    environment: 'test',
    is_active: true,
    sender_name: input.senderName,
    sender_sub_address: null,
    default_application_reference: null,
    default_timezone: 1,
    default_charset: 'UNOC',
    default_test_flag: 1,
    smtp_from_email: input.smtpFromEmail,
    smtp_reply_to_email: input.smtpReplyToEmail,
    mailbox: input.mailbox,
    notes: input.notes,
    updated_by: input.actorUserId,
  }

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from('ediel_actor_settings')
      .update(payload)
      .eq('id', existing.data.id)

    if (error) throw error
    return
  }

  const { error } = await supabaseService.from('ediel_actor_settings').insert({
    ...payload,
    created_by: input.actorUserId,
  })

  if (error) throw error
}

async function upsertRouteProfile(input: {
  actorUserId: string
  routeId: string
  family: 'PRODAT' | 'UTILTS'
  senderEdielId: string
  senderName: string | null
  receiverName: string
  applicationReference: string | null
  defaultMessageVersion: string | null
  ackMode: EdielRouteProfileAckMode
  mailbox: string | null
}) {
  const existing = await supabaseService
    .from('ediel_route_profiles')
    .select('id')
    .eq('communication_route_id', input.routeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const isProdat = input.family === 'PRODAT'
  const payload = {
    communication_route_id: input.routeId,
    is_enabled: true,
    sender_ediel_id: input.senderEdielId,
    sender_name: input.senderName,
    sender_sub_address: isProdat ? EDIEL_AGT_PRODAT_SUB_ADDRESS : null,
    receiver_ediel_id: EDIEL_AGT_PORTAL_EDIEL_ID,
    receiver_name: input.receiverName,
    receiver_sub_address: isProdat ? EDIEL_AGT_PRODAT_SUB_ADDRESS : null,
    application_reference: input.applicationReference,
    default_message_version: input.defaultMessageVersion,
    default_test_flag: 1,
    default_timezone: 1,
    environment: 'test',
    message_standard: 'edifact',
    ack_mode: input.ackMode,
    smtp_host: null,
    smtp_port: null,
    imap_host: null,
    imap_port: null,
    mailbox: input.mailbox,
    encryption_mode: 'none',
    payload_format: 'edifact',
    notes: `${input.family} AGT 2026A route profile. Sender-id kommer från aktörens AGT-form, inte från Gridcore/TGT-konstant.`,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from('ediel_route_profiles')
      .update(payload)
      .eq('id', existing.data.id)

    if (error) throw error
    return
  }

  const { error } = await supabaseService.from('ediel_route_profiles').insert({
    ...payload,
    created_by: input.actorUserId,
  })

  if (error) throw error
}

async function upsertAgtRoute(input: {
  actorUserId: string
  family: 'PRODAT' | 'UTILTS'
  actorEdielId: string
  senderName: string | null
  receiverName: string
  targetEmail: string
  applicationReference: string | null
  defaultMessageVersion: string | null
  mailbox: string | null
}) {
  const routeName = getEdielAgtRouteName(input.family)
  const existing = await supabaseService
    .from('communication_routes')
    .select('id')
    .eq('route_name', routeName)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const route = await saveCommunicationRoute({
    actorUserId: input.actorUserId,
    id: existing.data?.id ?? undefined,
    routeName,
    isActive: true,
    routeScope: input.family === 'PRODAT' ? 'supplier_switch' : 'meter_values',
    routeType: 'ediel_partner',
    gridOwnerId: null,
    targetSystem: 'ediel',
    endpoint: null,
    targetEmail: input.targetEmail,
    supportedPayloadVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    notes: `${input.family} AGT 2026A mot Edielportalen ${EDIEL_AGT_PORTAL_EDIEL_ID}.`,
  })

  await upsertRouteProfile({
    actorUserId: input.actorUserId,
    routeId: route.id,
    family: input.family,
    senderEdielId: input.actorEdielId,
    senderName: input.senderName,
    receiverName: input.receiverName,
    applicationReference: input.applicationReference,
    defaultMessageVersion: input.defaultMessageVersion,
    ackMode: input.family === 'PRODAT' ? 'contrl_and_aperak' : 'default',
    mailbox: input.mailbox,
  })
}

export async function saveAgtSupplierRuntimeAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()

  const actorName = value(formData, 'actor_name') ?? ''
  const actorEdielId = upper(formData, 'actor_ediel_id') ?? ''
  const senderName = value(formData, 'sender_name')
  const smtpFromEmail = value(formData, 'smtp_from_email')
  const smtpReplyToEmail = value(formData, 'smtp_reply_to_email')
  const mailbox = value(formData, 'mailbox')
  const targetEmail = value(formData, 'target_email') ?? EDIEL_AGT_PORTAL_SMTP
  const receiverName = value(formData, 'receiver_name') ?? 'Edielportalen'
  const prodatApplicationReference = nullableUpper(value(formData, 'prodat_application_reference'))
  const prodatDefaultVersion = value(formData, 'prodat_default_message_version')
  const utiltsDefaultVersion = value(formData, 'utilts_default_message_version')

  if (targetEmail !== EDIEL_AGT_PORTAL_SMTP) {
    throw new Error(`AGT mot Edielportalen ska skickas till ${EDIEL_AGT_PORTAL_SMTP}.`)
  }

  await saveActiveSupplierActor({
    actorUserId,
    actorName,
    actorEdielId,
    senderName,
    smtpFromEmail,
    smtpReplyToEmail,
    mailbox,
    notes: emptyToNull(
      `AGT 2026A supplier actor. Konfigurerad från AGT-sidan ${new Date().toISOString()}.`
    ),
  })

  await upsertAgtRoute({
    actorUserId,
    family: 'PRODAT',
    actorEdielId,
    senderName,
    receiverName,
    targetEmail,
    applicationReference: prodatApplicationReference,
    defaultMessageVersion: prodatDefaultVersion,
    mailbox,
  })

  await upsertAgtRoute({
    actorUserId,
    family: 'UTILTS',
    actorEdielId,
    senderName,
    receiverName,
    targetEmail,
    applicationReference: null,
    defaultMessageVersion: utiltsDefaultVersion,
    mailbox,
  })

  revalidateAgt()
}

export async function createAgtSupplierTestRunAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCaseCode = upper(formData, 'test_case_code') ?? ''
  const testCase = getEdielAgtSupplier2026ACase(testCaseCode)

  if (!testCase) {
    throw new Error(`Okänt AGT 2026A leverantörstest: ${testCaseCode}`)
  }

  await createEdielTestRun({
    actorUserId,
    testSuite: testCase.suite,
    roleCode: testCase.roleCode,
    testCaseCode: testCase.testCaseCode,
    title: testCase.title,
    approvalVersion: testCase.approvalVersion,
    notes: `${testCase.notes} Skapad från AGT 2026A-sidan.`,
    status: 'draft',
  })

  revalidateAgt()
}

export async function createAllAgtSupplierTestRunsAction(_formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()

  for (const testCase of EDIEL_AGT_SUPPLIER_2026A_CASES) {
    await createEdielTestRun({
      actorUserId,
      testSuite: testCase.suite,
      roleCode: testCase.roleCode,
      testCaseCode: testCase.testCaseCode,
      title: testCase.title,
      approvalVersion: testCase.approvalVersion,
      notes: `${testCase.notes} Skapad från AGT 2026A-sidan.`,
      status: 'draft',
    })
  }

  revalidateAgt()
}
