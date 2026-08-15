import type { EdielActorSettingsRow, EdielRouteProfileRow } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'
import {
  EDIEL_AGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID,
  getEdielAgtRouteName,
} from '@/lib/ediel/testing/agtRegistry'
import { getEdielSystemTestSettings, type EdielSystemTestSettings } from '@/lib/ediel/systemTestSettings'

type CommunicationRouteLite = {
  id: string
  company_id: string | null
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
  systemTestSettings: EdielSystemTestSettings | null
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

function parseAgtActorNotes(actor?: Pick<EdielActorSettingsRow, 'notes' | 'brp_ediel_id'> | null): { balanceResponsibleEdielId: string | null } {
  const directBrp = actor?.brp_ediel_id?.trim().toUpperCase() ?? null
  if (directBrp) return { balanceResponsibleEdielId: directBrp }

  const text = actor?.notes?.trim()
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

async function getActiveTestSupplierActor(companyId?: string | null): Promise<EdielActorSettingsRow | null> {
  if (!companyId) return null
  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('company_id', companyId)
    .eq('environment', 'test')
    .eq('is_active', true)
    .in('actor_role', ['supplier', 'electricity_supplier'])
    .limit(2)

  if (error) throw error
  const rows = (data ?? []) as EdielActorSettingsRow[]
  if (rows.length > 1) throw new Error('agt_active_test_actor_ambiguous')
  return rows[0] ?? null
}

async function getRouteByName(routeName: string, companyId?: string | null): Promise<CommunicationRouteLite | null> {
  if (!companyId) return null
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('id,company_id,route_name,is_active,route_scope,route_type,target_system,target_email,endpoint,supported_payload_version,notes,updated_at')
    .eq('company_id', companyId)
    .eq('route_name', routeName)
    .limit(2)

  if (error) throw error
  const rows = (data ?? []) as CommunicationRouteLite[]
  if (rows.length > 1) throw new Error(`agt_route_ambiguous:${routeName}`)
  return rows[0] ?? null
}

async function getRouteProfile(routeId: string | null, companyId?: string | null): Promise<EdielRouteProfileRow | null> {
  if (!routeId || !companyId) return null

  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('company_id', companyId)
    .eq('communication_route_id', routeId)
    .limit(2)

  if (error) throw error
  const rows = (data ?? []) as EdielRouteProfileRow[]
  if (rows.length > 1) throw new Error(`agt_route_profile_ambiguous:${routeId}`)
  return rows[0] ?? null
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
      description: 'Edielportalens AGT kan gå mot särskilda testmotparter, men i systemet ska körningen hållas i testmiljön så att test-ID:n inte blandas med riktig drift.',
    })
  }

  const agtNotes = parseAgtActorNotes(actor)
  if (blank(agtNotes.balanceResponsibleEdielId)) {
    issues.push({
      severity: 'warning',
      code: 'agt_balance_responsible_missing',
      title: 'Balansansvarig Ediel-id saknas',
      description: 'L1/L7 PRODAT behöver NAD+Z02 i AGT-mallen. Fyll i balansansvarig Ediel-id innan du skickar outbound mot Edielportalen. L2-L5 får inte blockeras av detta eftersom de är Portal → Aktör.',
    })
  }

  return issues
}

function validateRoute(runtime: EdielAgtRouteRuntime, actor: EdielActorSettingsRow | null, systemTestSettings: EdielSystemTestSettings | null, companyId?: string | null): EdielAgtReadinessIssue[] {
  const issues: EdielAgtReadinessIssue[] = []
  const family = runtime.family
  const expectedRouteName = getEdielAgtRouteName(family)

  if (!runtime.route) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_route_missing`,
      title: `${family}-route saknas`,
      description: `Skapa runtime-routen ${expectedRouteName} mot DB-konfigurerad AGT/systemtestportal.`,
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

  if (companyId && runtime.route.company_id !== companyId) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_route_not_tenant_scoped`,
      title: `${family}-route är inte tenant-specifik`,
      description: 'AGT får inte falla tillbaka på en global route. Skapa en aktiv test-route som ägs av bolaget/tenantens company_id.',
    })
  }

  const configuredPortalEmail = systemTestSettings?.testPortalEmail ?? null
  if (!configuredPortalEmail) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_systemtest_email_missing`,
      title: 'Systemtestportalens SMTP saknas',
      description: 'Spara AGT/systemtest-inställningar i databasen innan AGT-route används.',
    })
  } else if (runtime.route.target_email !== configuredPortalEmail) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_target_email_wrong`,
      title: `${family}-route har fel SMTP-mottagare`,
      description: `AGT-routen ska använda den DB-konfigurerade testportaladressen ${configuredPortalEmail}.`,
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

  if (companyId && runtime.profile.company_id !== companyId) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_profile_not_tenant_scoped`,
      title: `${family}-runtimeprofil är inte tenant-specifik`,
      description: 'AGT får inte falla tillbaka på en global runtimeprofil. Profilen ska ägas av samma company_id som bolaget.',
    })
  }

  if (runtime.profile.environment !== 'test') {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_profile_environment_not_test`,
      title: `${family}-runtimeprofil är inte testmiljö`,
      description: 'AGT ska köras mot Edielportalen i testläge i systemet. Produktionsprofil får inte användas.',
    })
  }

  if (runtime.profile.default_test_flag !== 1) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_profile_test_flag_wrong`,
      title: `${family}-runtimeprofil saknar testflagga`,
      description: 'AGT-profilen ska ha default_test_flag = 1 så testtrafik aldrig blandas med produktion.',
    })
  }

  const configuredPortalEdielId = normalized(systemTestSettings?.testPortalEdielId)
  if (!configuredPortalEdielId) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_systemtest_receiver_missing`,
      title: 'Systemtestportalens Ediel-ID saknas',
      description: 'Spara testportalens Ediel-ID i systemtest-inställningar innan AGT används.',
    })
  } else if (normalized(runtime.profile.receiver_ediel_id) !== configuredPortalEdielId) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_receiver_wrong`,
      title: `${family}-profil har fel mottagande Ediel-id`,
      description: `Motparten ska vara DB-konfigurerad testportal ${configuredPortalEdielId}.`,
    })
  }

  const senderFromProfile = normalized(runtime.profile.sender_ediel_id)
  const actorEdielId = normalized(actor?.actor_ediel_id)
  if (blank(runtime.profile.sender_ediel_id)) {
    issues.push({
      severity: 'error',
      code: `agt_${family.toLowerCase()}_sender_missing`,
      title: `${family}-profil saknar avsändande Ediel-id`,
      description: 'AGT-profilens sender_ediel_id ska vara tenantens egna Ediel-id. Testmotorn får inte använda fallback-värden.',
    })
  }

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
    // Sender subaddress is tenant specific; leave it blank only when Edielregistret has no subaddress for that actor.
    if (normalized(runtime.profile.application_reference) !== EDIEL_AGT_PRODAT_APPLICATION_REFERENCE) {
      issues.push({
        severity: 'error',
        code: 'agt_prodat_application_reference_wrong',
        title: 'PRODAT Application Reference saknas/fel',
        description: `Leverantörs-AGT PRODAT ska använda Application Reference ${EDIEL_AGT_PRODAT_APPLICATION_REFERENCE}.`,
      })
    }

    if (blank(runtime.profile.mailbox) && blank(actor?.mailbox)) {
      issues.push({
        severity: 'error',
        code: 'agt_prodat_mailbox_missing',
        title: 'PRODAT test-mailbox saknas',
        description: 'Fyll i mailbox på PRODAT runtimeprofilen eller aktörskortet innan L1/L7 skickas.',
      })
    }

    const configuredReceiverSubaddress = normalized(systemTestSettings?.defaultReceiverSubaddress)
    if (!configuredReceiverSubaddress) {
      issues.push({
        severity: 'warning',
        code: 'agt_prodat_receiver_subaddress_not_configured',
        title: 'PRODAT receiver subaddress saknas i systemtestinställningar',
        description: 'Fyll i receiver subaddress för AGT PRODAT om portalen kräver subadress.',
      })
    } else if (normalized(runtime.profile.receiver_sub_address) !== configuredReceiverSubaddress) {
      issues.push({
        severity: 'error',
        code: 'agt_prodat_receiver_subaddress_wrong',
        title: 'PRODAT receiver subaddress saknas/fel',
        description: `PRODAT AGT ska använda DB-konfigurerad mottagarsubadress ${configuredReceiverSubaddress}.`,
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

export async function getEdielAgtSupplierRuntime(companyId?: string | null): Promise<EdielAgtSupplierRuntime> {
  const actor = await getActiveTestSupplierActor(companyId)
  const systemTestSettings = await getEdielSystemTestSettings({ companyId, testSuite: 'AGT' })
  const [prodatRoute, utiltsRoute] = await Promise.all([
    getRouteByName(getEdielAgtRouteName('PRODAT'), companyId),
    getRouteByName(getEdielAgtRouteName('UTILTS'), companyId),
  ])
  const [prodatProfile, utiltsProfile] = await Promise.all([
    getRouteProfile(prodatRoute?.id ?? null, companyId),
    getRouteProfile(utiltsRoute?.id ?? null, companyId),
  ])

  const prodat = { family: 'PRODAT' as const, route: prodatRoute, profile: prodatProfile }
  const utilts = { family: 'UTILTS' as const, route: utiltsRoute, profile: utiltsProfile }
  const issues = [
    ...validateActor(actor),
    ...validateRoute(prodat, actor, systemTestSettings, companyId),
    ...validateRoute(utilts, actor, systemTestSettings, companyId),
  ]

  return {
    actor,
    systemTestSettings,
    prodat,
    utilts,
    issues,
    isReady: !issues.some((issue) => issue.severity === 'error'),
  }
}
