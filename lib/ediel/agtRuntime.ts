import type { EdielActorSettingsRow, EdielRouteProfileRow } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'
import {
  EDIEL_AGT_PORTAL_EDIEL_ID,
  EDIEL_AGT_PORTAL_SMTP,
  EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID,
  getEdielAgtRouteName,
} from '@/lib/ediel/agtRegistry'

type CommunicationRouteLite = {
  id: string
  route_name: string
  is_active: boolean
  route_scope: string
  route_type: string
  target_system: string | null
  target_email: string | null
  endpoint: string | null
  supported_payload_version: string | null
  notes: string | null
  updated_at: string | null
}

export type EdielAgtReadinessIssue = {
  severity: 'error' | 'warning' | 'info'
  code: string
  title: string
  description: string
}

export type EdielAgtRouteRuntime = {
  family: 'PRODAT' | 'UTILTS'
  route: CommunicationRouteLite | null
  profile: EdielRouteProfileRow | null
}

export type EdielAgtSupplierRuntime = {
  actor: EdielActorSettingsRow | null
  prodat: EdielAgtRouteRuntime
  utilts: EdielAgtRouteRuntime
  issues: EdielAgtReadinessIssue[]
  isReady: boolean
}

function blank(value?: string | null): boolean {
  return !value || value.trim().length === 0
}

function normalized(value?: string | null): string {
  return value?.trim().toUpperCase() ?? ''
}

function parseAgtActorNotes(notes?: string | null): { balanceResponsibleEdielId: string | null } {
  const text = notes?.trim()
  if (!text) return { balanceResponsibleEdielId: null }
  try {
    const parsed = JSON.parse(text) as { balanceResponsibleEdielId?: unknown }
    return {
      balanceResponsibleEdielId:
        typeof parsed.balanceResponsibleEdielId === 'string' && parsed.balanceResponsibleEdielId.trim().length > 0
          ? parsed.balanceResponsibleEdielId.trim().toUpperCase()
          : null,
    }
  } catch {
    const match = text.match(/balanceResponsibleEdielId\s*[:=]\s*([A-Za-z0-9_-]+)/i)
    return { balanceResponsibleEdielId: match?.[1]?.toUpperCase() ?? null }
  }
}

async function getActiveTestSupplierActor(): Promise<EdielActorSettingsRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', 'test')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielActorSettingsRow | null) ?? null
}

async function getRouteByName(routeName: string): Promise<CommunicationRouteLite | null> {
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('id,route_name,is_active,route_scope,route_type,target_system,target_email,endpoint,supported_payload_version,notes,updated_at')
    .eq('route_name', routeName)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as CommunicationRouteLite | null) ?? null
}

async function getRouteProfile(routeId: string | null): Promise<EdielRouteProfileRow | null> {
  if (!routeId) return null

  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('communication_route_id', routeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielRouteProfileRow | null) ?? null
}

function validateActor(actor: EdielActorSettingsRow | null): EdielAgtReadinessIssue[] {
  const issues: EdielAgtReadinessIssue[] = []

  if (!actor) {
    issues.push({
      severity: 'error',
      code: 'agt_actor_missing',
      title: 'Aktiv test-aktör saknas',
      description: 'Skapa och aktivera ett aktörskort för testmiljö innan AGT startas.',
    })
    return issues
  }

  if (blank(actor.actor_ediel_id)) {
    issues.push({
      severity: 'error',
      code: 'agt_actor_ediel_id_missing',
      title: 'Aktörens Ediel-id saknas',
      description: 'Fyll i leverantörens riktiga Ediel-id på aktörskortet.',
    })
  }

  if (normalized(actor.actor_ediel_id) === EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID) {
    issues.push({
      severity: 'error',
      code: 'agt_actor_is_tgt_system_supplier',
      title: 'Gridcore/TGT-id används som aktör',
      description: `Ediel-id ${EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID} är systemleverantörens TGT-identitet och får inte användas som avsändare i leverantörens AGT.`,
    })
  }

  if (actor.actor_role !== 'supplier') {
    issues.push({
      severity: 'warning',
      code: 'agt_actor_role_not_supplier',
      title: 'Aktörsrollen är inte leverantör',
      description: 'För leverantörs-AGT ska aktörskortet ha rollen supplier.',
    })
  }

  if (actor.environment !== 'test') {
    issues.push({
      severity: 'error',
      code: 'agt_actor_environment_not_test',
      title: 'AGT ska köras i testmiljön i systemet',
      description: 'Edielportalens AGT går mot produktionsadresser, men i systemet ska körningen hållas i testmiljön så att 91100 inte blandas med riktig drift.',
    })
  }

  const agtNotes = parseAgtActorNotes(actor.notes)
  if (blank(agtNotes.balanceResponsibleEdielId)) {
    issues.push({
      severity: 'error',
      code: 'agt_balance_responsible_missing',
      title: 'Balansansvarig Ediel-id saknas',
      description: 'L1/L7 PRODAT kräver NAD+Z02. Fyll i balansansvarig Ediel-id i AGT-runtime och spara igen.',
    })
  }

  return issues
}

function validateRoute(runtime: EdielAgtRouteRuntime, actor: EdielActorSettingsRow | null): EdielAgtReadinessIssue[] {
  const issues: EdielAgtReadinessIssue[] = []
  const family = runtime.family
  const expectedRouteName = getEdielAgtRouteName(family)

  if (!runtime.route) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_route_missing`,
      title: `${family}-route saknas`,
      description: `Skapa runtime-routen ${expectedRouteName} mot Edielportalen ${EDIEL_AGT_PORTAL_EDIEL_ID}.`,
    })
    return issues
  }

  if (!runtime.route.is_active) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_route_inactive`,
      title: `${family}-route är inaktiv`,
      description: 'Aktivera communication route innan AGT startas.',
    })
  }

  if (runtime.route.target_email !== EDIEL_AGT_PORTAL_SMTP) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_target_email_wrong`,
      title: `${family}-route har fel SMTP-mottagare`,
      description: `AGT-routen ska använda ${EDIEL_AGT_PORTAL_SMTP}.`,
    })
  }

  if (!runtime.profile) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_profile_missing`,
      title: `${family}-runtimeprofil saknas`,
      description: 'Communication route finns men saknar ediel_route_profiles-rad.',
    })
    return issues
  }

  if (!runtime.profile.is_enabled) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_profile_disabled`,
      title: `${family}-runtimeprofil är avstängd`,
      description: 'Aktivera runtimeprofilen innan AGT startas.',
    })
  }

  if (normalized(runtime.profile.receiver_ediel_id) !== EDIEL_AGT_PORTAL_EDIEL_ID) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_receiver_wrong`,
      title: `${family}-profil har fel mottagande Ediel-id`,
      description: `Motparten i Edielportalens AGT ska vara Ediel-id ${EDIEL_AGT_PORTAL_EDIEL_ID}.`,
    })
  }

  const senderFromProfile = normalized(runtime.profile.sender_ediel_id)
  const actorEdielId = normalized(actor?.actor_ediel_id)
  if (senderFromProfile && actorEdielId && senderFromProfile !== actorEdielId) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_sender_mismatch`,
      title: `${family}-profilens avsändare matchar inte aktiv aktör`,
      description: `Profilen använder ${runtime.profile.sender_ediel_id}, men aktiv aktör är ${actor?.actor_ediel_id}.`,
    })
  }

  if (normalized(runtime.profile.sender_ediel_id) === EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_sender_is_tgt_system_supplier`,
      title: `${family}-profil använder Gridcore/TGT-id`,
      description: `Byt sender_ediel_id från ${EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID} till leverantörens egna Ediel-id.`,
    })
  }

  if (family === 'PRODAT') {
    if (!blank(runtime.profile.sender_sub_address)) {
      issues.push({
        severity: 'error',
        code: 'agt_prodat_sender_subaddress_must_be_blank',
        title: 'PRODAT sender subaddress ska vara tom',
        description: 'Edielportalen för leverantörs-AGT förväntar sig tom UNB sender subaddress. Spara om AGT-runtime så sender_sub_address blir tom.',
      })
    }

    if (normalized(runtime.profile.receiver_sub_address) !== EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS) {
      issues.push({
        severity: 'error',
        code: 'agt_prodat_receiver_subaddress_wrong',
        title: 'PRODAT receiver subaddress saknas/fel',
        description: `PRODAT AGT ska skicka till 91100 med mottagarsubadress ${EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS}.`,
      })
    }
  }

  if (family === 'UTILTS') {
    if (!blank(runtime.profile.sender_sub_address) || !blank(runtime.profile.receiver_sub_address)) {
      issues.push({
        severity: 'error',
        code: 'agt_utilts_subaddress_should_be_blank',
        title: 'UTILTS ska inte använda subadress',
        description: 'För UTILTS AGT ska sender_sub_address och receiver_sub_address lämnas tomma.',
      })
    }
  }

  return issues
}

export async function getEdielAgtSupplierRuntime(): Promise<EdielAgtSupplierRuntime> {
  const actor = await getActiveTestSupplierActor()
  const [prodatRoute, utiltsRoute] = await Promise.all([
    getRouteByName(getEdielAgtRouteName('PRODAT')),
    getRouteByName(getEdielAgtRouteName('UTILTS')),
  ])
  const [prodatProfile, utiltsProfile] = await Promise.all([
    getRouteProfile(prodatRoute?.id ?? null),
    getRouteProfile(utiltsRoute?.id ?? null),
  ])

  const prodat = { family: 'PRODAT' as const, route: prodatRoute, profile: prodatProfile }
  const utilts = { family: 'UTILTS' as const, route: utiltsRoute, profile: utiltsProfile }
  const issues = [
    ...validateActor(actor),
    ...validateRoute(prodat, actor),
    ...validateRoute(utilts, actor),
  ]

  return {
    actor,
    prodat,
    utilts,
    issues,
    isReady: !issues.some((issue) => issue.severity === 'error'),
  }
}
