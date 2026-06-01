'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? '').trim()
  return value.length > 0 ? value : null
}

function intValue(formData: FormData, key: string): number | null {
  const raw = text(formData, key)
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeAckMode(value: string | null): string {
  return value === 'none' || value === 'contrl_only' || value === 'contrl_and_aperak' ? value : 'default'
}

function normalizeSubAddress(value: string | null): string | null {
  const clean = value?.trim()
  return clean ? clean.toUpperCase() : null
}

async function assertPlatformCompanyExists(companyId: string): Promise<void> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bolaget hittades inte eller är inte åtkomligt.')
}

async function getProductionActorSetting(companyId: string): Promise<{ edielId: string; senderSubAddress: string | null; actorSettingId: string }> {
  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('id,ediel_id,actor_ediel_id,sender_subaddress,sender_sub_address,is_active')
    .eq('company_id', companyId)
    .eq('environment', 'production')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  const row = data as Record<string, unknown> | null
  const edielId = String(row?.ediel_id ?? row?.actor_ediel_id ?? '').trim().toUpperCase()
  if (!row || !edielId) {
    throw new Error('Bolaget saknar aktivt production Ediel-ID i ediel_actor_settings. Lägg in Ediel-ID i Company → Ediel & Go-live innan route skapas.')
  }

  return {
    edielId,
    senderSubAddress: normalizeSubAddress(String(row.sender_subaddress ?? row.sender_sub_address ?? '').trim() || null),
    actorSettingId: String(row.id),
  }
}

function validateProductionRoute(input: {
  senderEdielId: string | null
  receiverEdielId: string | null
  targetEmail: string | null
  applicationReference: string | null
}) {
  const blockers: string[] = []
  if (!input.senderEdielId) blockers.push('Produktions Ediel-id saknas.')
  if (!input.receiverEdielId) blockers.push('Produktionsmotpartens Ediel-id saknas.')
  if (input.receiverEdielId === '91100') blockers.push('91100 är Edielportal/testsystem och får inte användas i production route.')
  if (input.receiverEdielId === '91109') blockers.push('91109 är test-BRP/testmotpart och får inte användas i production route.')
  if (!input.targetEmail) blockers.push('Produktionsmailbox/mottagaradress saknas.')
  if (!input.applicationReference) blockers.push('Production Application Reference saknas.')
  if (String(input.applicationReference ?? '').toUpperCase().startsWith('23-DDQ')) blockers.push('Application Reference 23-DDQ är test/portal-referens och får inte användas i production route.')
  if (String(input.targetEmail ?? '').toLowerCase().endsWith('@ediel.se')) blockers.push('Mottagaradressen ser ut som Edielportal/testmiljö. Ange riktig produktionsmailbox.')
  return blockers
}

export async function createProductionRouteFromWizardAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData, 'company_id')
  if (!companyId) throw new Error('Bolag saknas.')
  await assertPlatformCompanyExists(companyId)

  const actorSetting = await getProductionActorSetting(companyId)
  const frontendSenderEdielId = text(formData, 'sender_ediel_id')?.toUpperCase() ?? null
  if (frontendSenderEdielId && frontendSenderEdielId !== actorSetting.edielId) {
    throw new Error('Sender Ediel-ID får inte override:as i route-wizard. Ändra bolagets Ediel-ID i Company → Ediel & Go-live först.')
  }

  const senderEdielId = actorSetting.edielId
  const senderSubAddress = normalizeSubAddress(text(formData, 'sender_sub_address')) ?? actorSetting.senderSubAddress
  const receiverEdielId = text(formData, 'receiver_ediel_id')
  const targetEmail = text(formData, 'target_email')
  const applicationReference = text(formData, 'application_reference')
  const blockers = validateProductionRoute({ senderEdielId, receiverEdielId, targetEmail, applicationReference })
  const wizardPayload = {
    senderEdielId,
    actorSettingId: actorSetting.actorSettingId,
    receiverEdielId,
    targetEmail,
    applicationReference,
    senderSubAddress,
    receiverSubAddress: normalizeSubAddress(text(formData, 'receiver_sub_address')),
    receiverName: text(formData, 'receiver_name'),
    mailbox: text(formData, 'mailbox'),
    smtpHost: text(formData, 'smtp_host'),
    smtpPort: intValue(formData, 'smtp_port'),
    defaultMessageVersion: text(formData, 'default_message_version'),
    ackMode: normalizeAckMode(text(formData, 'ack_mode')),
  }

  if (blockers.length > 0) {
    try {
      const { error: wizardRunError } = await supabaseService.from('production_route_wizard_runs').insert({
        company_id: companyId,
        status: 'blocked',
        blocker_summary: blockers,
        payload: wizardPayload,
        created_by: admin.userId,
      })

      if (wizardRunError) {
        console.warn('Production route wizard blocked run could not be logged', wizardRunError)
      }
    } catch (error) {
      console.warn('Production route wizard blocked run could not be logged', error)
    }

    const params = new URLSearchParams({ status: 'blocked', message: blockers.join(' ') })
    redirect(`/admin/platform/go-live/${companyId}/route-wizard?${params.toString()}`)
  }

  const now = new Date().toISOString()
  const { data: route, error: routeError } = await supabaseService
    .from('communication_routes')
    .insert({
      company_id: companyId,
      route_name: text(formData, 'route_name') ?? 'Production Ediel route',
      is_active: true,
      route_scope: 'supplier_switch',
      route_type: 'ediel_partner',
      grid_owner_id: null,
      target_system: 'production_ediel',
      endpoint: null,
      target_email: targetEmail,
      auth_config: {},
      supported_payload_version: text(formData, 'default_message_version'),
      notes: text(formData, 'notes') ?? 'Skapad via production route-wizard. Separat från AGT/TGT/testroutes.',
      created_by: admin.userId,
      updated_by: admin.userId,
    })
    .select('id')
    .single()

  if (routeError) throw routeError

  const { data: profile, error: profileError } = await supabaseService
    .from('ediel_route_profiles')
    .insert({
      company_id: companyId,
      communication_route_id: route.id,
      actor_setting_id: actorSetting.actorSettingId,
      is_enabled: true,
      sender_ediel_id: senderEdielId,
      sender_name: text(formData, 'sender_name'),
      sender_sub_address: senderSubAddress,
      receiver_ediel_id: receiverEdielId,
      receiver_name: text(formData, 'receiver_name'),
      receiver_sub_address: normalizeSubAddress(text(formData, 'receiver_sub_address')),
      application_reference: applicationReference,
      default_message_version: text(formData, 'default_message_version'),
      default_test_flag: 0,
      default_timezone: 1,
      environment: 'production',
      message_standard: 'edifact',
      ack_mode: normalizeAckMode(text(formData, 'ack_mode')),
      smtp_host: text(formData, 'smtp_host'),
      smtp_port: intValue(formData, 'smtp_port'),
      imap_host: text(formData, 'imap_host'),
      imap_port: intValue(formData, 'imap_port'),
      mailbox: text(formData, 'mailbox'),
      encryption_mode: text(formData, 'encryption_mode') ?? 'none',
      payload_format: 'edifact',
      notes: text(formData, 'notes') ?? 'Production route profile skapad via wizard.',
      created_by: admin.userId,
      updated_by: admin.userId,
    })
    .select('id')
    .single()

  if (profileError) throw profileError

  const { error: companyUpdateError } = await supabaseService
    .from('companies')
    .update({
      production_ediel_id: senderEdielId,
      production_sender_sub_address: senderSubAddress,
      production_mailbox: targetEmail,
      production_application_reference: applicationReference,
      production_counterparty_ediel_id: receiverEdielId,
      live_blocked_reason: null,
      updated_at: now,
    })
    .eq('id', companyId)

  if (companyUpdateError) throw companyUpdateError

  try {
    const { error: wizardRunError } = await supabaseService.from('production_route_wizard_runs').insert({
      company_id: companyId,
      status: 'created',
      communication_route_id: route.id,
      ediel_route_profile_id: profile.id,
      blocker_summary: [],
      payload: wizardPayload,
      created_by: admin.userId,
    })

    if (wizardRunError) {
      console.warn('Production route wizard created run could not be logged', wizardRunError)
    }
  } catch (error) {
    console.warn('Production route wizard created run could not be logged', error)
  }

  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath(`/admin/platform/go-live/${companyId}/route-wizard`)
  revalidatePath(`/admin/platform/actor-testing/${companyId}`)

  const params = new URLSearchParams({ status: 'created', message: 'Production route skapades och kopplades till bolaget.' })
  redirect(`/admin/platform/go-live/${companyId}/route-wizard?${params.toString()}`)
}
