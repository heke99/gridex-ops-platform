'use server'

import { revalidatePath } from 'next/cache'
import {diffRegistryRecord,readRegistryPreviewSnapshot} from '@/lib/actor-registry/registrySnapshotDiff'
import {parseActorRegistryTxt} from '@/lib/actor-registry/parseActorRegistryTxt'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { applyActorRegistryRecords, decodeRegistryUpload } from '@/lib/actor-registry/importActorRegistry'
import type { ParsedActorRegistryActor } from '@/lib/actor-registry/types'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeTransportSecurityMode } from '@/lib/ediel/partyRegistry'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'
import { logAdminActionAndUsage, logUsageEvent } from '@/lib/audit/actionLogger'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function boolValue(formData: FormData, key: string): boolean {
  const raw = formData.get(key)
  return raw === 'true' || raw === 'on' || raw === '1'
}

function normalizeRolesForParty(formData: FormData): string[] {
  const selected = new Set(values(formData, 'roles'))
  const partyType = value(formData, 'partyType')
  if (partyType) selected.add(partyType)
  if (partyType === 'electricity_supplier') selected.add('supplier')
  if (partyType === 'balance_responsible_party') selected.add('brp')
  return Array.from(selected)
}

function primaryPartyType(roles: string[]): string {
  if (roles.includes('grid_owner')) return 'grid_owner'
  if (roles.includes('electricity_supplier') || roles.includes('supplier')) return 'electricity_supplier'
  if (roles.includes('energy_service_company')) return 'energy_service_company'
  if (roles.includes('balance_responsible_party') || roles.includes('brp')) return 'balance_responsible_party'
  if (roles.includes('ediel_portal')) return 'ediel_portal'
  if (roles.includes('test_counterparty')) return 'test_counterparty'
  return roles[0] ?? 'other'
}

function customerFlowVisibilityAllowed(roles: string[], status: string): boolean {
  if (status !== 'verified') return false
  if (roles.includes('ediel_portal') || roles.includes('test_counterparty')) return false
  return roles.includes('grid_owner') || roles.includes('electricity_supplier') || roles.includes('supplier')
}

function values(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

type ActorImportRecord = {
  market?: 'EL' | 'GAS' | null
  countryCode?:string|null
  sourceRecord?:Record<string,unknown>
  name: string
  orgNumber: string | null
  edielId: string | null
  svkId: string | null
  eic: string | null
  roles: string[]
  routes: Array<{
    messageFamily: string
    subaddress: string | null
    communicationType: string | null
    communicationAddress: string | null
    ediCharset: string | null
    ediSyntax: string | null
    partyId: string | null
    partyIdQualifier: string | null
    partyIdResponsible: string | null
    interchangePartyId: string | null
    interchangeIdQualifier: string | null
    applicationReference?: string | null
  }>
}

function normalizeActorRole(role: string | null | undefined): string {
  const raw = String(role ?? '').trim()
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (['netowner', 'gridowner', 'networkowner', 'nätägare', 'natagare'].includes(key)) return 'grid_owner'
  if (['powersupplier', 'supplier', 'electricitysupplier', 'elleverantor', 'elleverantör'].includes(key)) return 'electricity_supplier'
  if (['balanceresponsibleparty', 'brp', 'balance_responsible_party'].includes(key)) return 'balance_responsible_party'
  if (['systemsupplier', 'system_supplier'].includes(key)) return 'system_supplier'
  if (['esco', 'energyservicecompany', 'energy_service_company'].includes(key)) return 'energy_service_company'
  return raw || 'other'
}

function parseCompaniesXml(xml: string): ActorImportRecord[] {
  return parseActorRegistryXml(xml).map(actor => ({
    market: actor.market,
    countryCode:actor.countryCode,
    sourceRecord:actor.raw,
    name: actor.name,
    orgNumber: actor.orgNumber ?? null,
    edielId: actor.edielId ?? null,
    svkId: actor.svkId ?? null,
    eic: actor.eic ?? null,
    roles: actor.roles,
    routes: actor.routes.map(route => ({
      messageFamily: route.messageFamily,
      subaddress: route.subaddress ?? null,
      communicationType: route.communicationType ?? null,
      communicationAddress: route.communicationAddress ?? null,
      ediCharset: route.ediCharset ?? null,
      ediSyntax: route.ediSyntax ?? null,
      partyId: route.partyId ?? null,
      partyIdQualifier: route.partyIdQualifier ?? null,
      partyIdResponsible: route.partyIdResponsible ?? null,
      interchangePartyId: route.interchangePartyId ?? null,
      interchangeIdQualifier: route.interchangeIdQualifier ?? null,
      applicationReference: route.applicationReference,
    })),
  }))
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function parseActorCsv(textContent: string): ActorImportRecord[] {
  const lines = textContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const delimiter = lines[0].includes(';') ? ';' : ','
  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const read = (row: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header))
    return index >= 0 ? row[index]?.trim() || null : null
  }
  return lines.slice(1).map((line) => {
    const row = splitDelimitedLine(line, delimiter)
    const rawMarket=read(row,['market','marknad'])?.toUpperCase()
    const market:ActorImportRecord['market']=rawMarket==='EL'||rawMarket==='GAS'?rawMarket:null
    const role = normalizeActorRole(read(row, ['actorrole', 'role', 'roll']) ?? 'other')
    const messageFamily = (read(row, ['messagefamily', 'meddelandefamilj']) ?? '').toUpperCase()
    const route = messageFamily ? [{
      messageFamily,
      subaddress: read(row, ['subaddress', 'subadress']),
      communicationType: read(row, ['communicationtype', 'channel', 'kanal', 'contacttype']),
      communicationAddress: read(row, ['communicationaddress', 'contactemail', 'email', 'smtp', 'kontaktmail']),
      ediCharset: read(row, ['edicharset']),
      ediSyntax: read(row, ['edisyntax']),
      partyId: read(row, ['partyid']),
      partyIdQualifier: read(row, ['idcodequalifier']),
      partyIdResponsible: read(row, ['idcoderesponsible']),
      interchangePartyId: read(row, ['interchangepartyid']),
      interchangeIdQualifier: read(row, ['interchangeidqualifier']),
      applicationReference: read(row, ['applicationreference']),
    }] : []
    return {
      market,
      countryCode: read(row, ['countrycode', 'country', 'land']),
      name: read(row, ['actorname', 'name', 'namn']) ?? '',
      orgNumber: read(row, ['orgnumber', 'orgno', 'organisationsnummer']),
      edielId: read(row, ['edielid']),
      svkId: read(row, ['svkid']),
      eic: read(row, ['eic']),
      roles: [role],
      routes: route,
    }
  }).filter((record) => record.name)
}

type ActorImportPreviewIssue = {
  recordName: string
  issueType: string
  severity: 'info' | 'warning' | 'blocking'
  message: string
  metadata?: Record<string, unknown>
}

type ActorImportPreviewSummary = {
  recordsSeen: number
  newActors: number
  existingActors: number
  changedActors: number
  unchangedActors:number
  snapshotHash:string
  changes:Array<{edielId:string;actorId:string;fields:string[]}>
  gridOwners: number
  electricitySuppliers: number
  routesSeen: number
  prodatRoutes: number
  utiltsRoutes: number
  missingEdielId: number
  missingRoutes: number
  conflicts: number
  safeAutoUpdateFields: string[]
  protectedManualFields: string[]
  issues: ActorImportPreviewIssue[]
}

async function buildActorImportPreview(records: ActorImportRecord[],actorUserId:string): Promise<ActorImportPreviewSummary> {
  const snapshot=await readRegistryPreviewSnapshot(actorUserId,records.flatMap(r=>r.edielId?[r.edielId]:[]))
  const summary: ActorImportPreviewSummary = {
    recordsSeen: records.length,
    newActors: 0,
    existingActors: 0,
    changedActors: 0,
    unchangedActors:0,snapshotHash:snapshot.snapshotHash,changes:[],
    gridOwners: 0,
    electricitySuppliers: 0,
    routesSeen: 0,
    prodatRoutes: 0,
    utiltsRoutes: 0,
    missingEdielId: 0,
    missingRoutes: 0,
    conflicts: 0,
    safeAutoUpdateFields: ['namn', 'org.nr', 'identifierare', 'importkälla', 'nya ej verifierade routes'],
    protectedManualFields: ['verifieringsstatus', 'auto_send_allowed', 'manuellt verifierade routes', 'mottagarcertifikat', 'kundflödes-synlighet'],
    issues: [],
  }

  for (const record of records) {
    const roles = new Set(record.roles)
    if (roles.has('grid_owner')) summary.gridOwners += 1
    if (roles.has('electricity_supplier')) summary.electricitySuppliers += 1
    summary.routesSeen += record.routes.length
    summary.prodatRoutes += record.routes.filter((route) => route.messageFamily === 'PRODAT').length
    summary.utiltsRoutes += record.routes.filter((route) => route.messageFamily === 'UTILTS').length

    const matches=snapshot.actors.filter(actor=>actor.edielId===record.edielId)
    const matchedIds=Array.from(new Set(matches.map(actor=>actor.actorId)))
    if(matchedIds.length>1){summary.conflicts+=1;summary.issues.push({recordName:record.name,issueType:'identifier_conflict',severity:'blocking',message:'Ediel-ID matchar flera juridiska aktörer. Hela tillämpningen hålls för granskning.',metadata:{edielId:record.edielId,actorIds:matchedIds}})}
    if(matchedIds.length===1){
      summary.existingActors+=1
      const fields=diffRegistryRecord(record,matches[0])
      if(fields.length){summary.changedActors+=1;summary.changes.push({edielId:record.edielId!,actorId:matchedIds[0],fields})}
      else summary.unchangedActors+=1
    }else if(matchedIds.length===0)summary.newActors+=1

    if (!record.edielId) {
      summary.missingEdielId += 1
      summary.issues.push({
        recordName: record.name,
        issueType: 'missing_identifier',
        severity: 'blocking',
        message: 'Aktören saknar Ediel-ID och får inte bli sändningsklar.',
      })
    }

    if (record.routes.length === 0) {
      summary.missingRoutes += 1
      summary.issues.push({
        recordName: record.name,
        issueType: 'missing_route',
        severity: roles.has('grid_owner') ? 'blocking' : 'warning',
        message: roles.has('grid_owner')
          ? 'Nätägaren saknar route. Kundintag kan visa aktören, men automatisk PRODAT/UTILTS måste blockeras tills route finns.'
          : 'Aktören saknar route och behöver kompletteras innan sändning.',
        metadata: { roles: record.roles, edielId: record.edielId },
      })
    }

    const missingContactRoute = record.routes.find((route) => !route.communicationAddress)
    if (missingContactRoute) {
      summary.issues.push({
        recordName: record.name,
        issueType: 'missing_contact',
        severity: 'warning',
        message: `${missingContactRoute.messageFamily} saknar SMTP/kontaktadress. Läggs i granskning innan sändning.`,
        metadata: { messageFamily: missingContactRoute.messageFamily, edielId: record.edielId },
      })
    }
  }

  return summary
}

async function createActorImportPreviewRun(input: {
  fileName: string
  source: string
  importType: string
  parsed: ActorImportRecord[]
  userId: string
}) {
  const preview = await buildActorImportPreview(input.parsed,input.userId)
  const run = await supabaseService
    .from('platform_actor_import_runs')
    .insert({
      source: input.fileName,
      import_type: input.importType,
      status: preview.conflicts > 0 ? 'completed_with_warnings' : 'completed',
      records_seen: preview.recordsSeen,
      records_upserted: 0,
      records_failed: preview.issues.filter((issue) => issue.severity === 'blocking').length,
      safe: preview.conflicts === 0,
      completed_at: new Date().toISOString(),
      created_by: input.userId,
      metadata: {
        mode: 'preview',
        source: input.source,
        fileName: input.fileName,
        preview,
        nextStep: 'Granska diffen. Kör därefter importen igen med bekräftelsetext IMPORTERA för att uppdatera masterdata.',
      },
      error_log: preview.issues,
    })
    .select('id')
    .single()
  if (run.error) throw run.error

  for (const issue of preview.issues.slice(0, 200)) {
    const result = await supabaseService.from('platform_actor_import_issues').insert({
      import_run_id: run.data.id,
      actor_id: null,
      issue_type: issue.issueType,
      severity: issue.severity,
      status: 'open',
      message: issue.message,
      metadata: { ...(issue.metadata ?? {}), recordName: issue.recordName, previewOnly: true },
    })
    if (result.error) throw result.error
  }

  await logAdminActionAndUsage({
    companyId: null,
    actorUserId: input.userId,
    entityType: 'platform_actor_import_run',
    entityId: String(run.data.id),
    action: 'actor_import.previewed',
    label: 'Aktörsimport förhandsgranskad',
    billable: false,
    billingUnit: 'actor_import_preview',
    metadata: { source: input.source, fileName: input.fileName, preview },
  })

  return run.data.id
}

export async function importPlatformActorsAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('actorImportFile')
  const source = value(formData, 'source') ?? 'ui_import'
  const format = value(formData, 'format') ?? 'auto'
  const mode = value(formData, 'importMode') ?? 'preview'
  const confirmApply = value(formData, 'confirmApply')
  if (!(file instanceof File) || file.size <= 0) throw new Error('Välj companies.xml eller CSV-fil att importera.')

  const fileName = file.name || 'actor-import'
  const importType = format==='txt'||fileName.toLowerCase().endsWith('.txt')?'companies_txt':format === 'csv' || fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'companies_xml'
  const sourceBytes=Buffer.from(await file.arrayBuffer())
  const textContent=decodeRegistryUpload(sourceBytes,importType)
  const txtActors=importType==='companies_txt'?parseActorRegistryTxt(textContent):null
  const parsed:ActorImportRecord[] = txtActors ? txtActors.map(actor=>({name:actor.name,market:actor.market,countryCode:actor.countryCode,sourceRecord:actor.raw,orgNumber:actor.orgNumber??null,edielId:actor.edielId??null,svkId:actor.svkId??null,eic:actor.eic??null,roles:actor.roles,routes:actor.routes.map(route=>({...route,subaddress:route.subaddress??null,communicationType:route.communicationType??null,communicationAddress:route.communicationAddress??null,ediCharset:route.ediCharset??null,ediSyntax:route.ediSyntax??null,partyId:route.partyId??null,partyIdQualifier:route.partyIdQualifier??null,partyIdResponsible:route.partyIdResponsible??null,interchangePartyId:route.interchangePartyId??null,interchangeIdQualifier:route.interchangeIdQualifier??null}))}))
    : importType==='csv'?parseActorCsv(textContent):parseCompaniesXml(textContent)
  if (parsed.length === 0) throw new Error('Importfilen innehöll inga aktörer som kunde läsas.')

  if (mode !== 'apply') {
    await createActorImportPreviewRun({
      fileName,
      source,
      importType,
      parsed,
      userId: context.userId,
    })
    revalidatePath('/admin/ediel/actors')
    revalidatePath('/admin/customers/intake')
    return
  }

  if (confirmApply !== 'IMPORTERA') {
    throw new Error('Skriv IMPORTERA för att godkänna att säkra fält uppdateras och osäkra ändringar läggs i granskning.')
  }

  const preview = await buildActorImportPreview(parsed,context.userId)
  if (preview.conflicts > 0) {
    await createActorImportPreviewRun({ fileName, source, importType, parsed, userId: context.userId })
    throw new Error('Importen stoppades eftersom förhandsgranskningen hittade konflikt i Ediel-ID/aktörsmatchning. Lös granskningspunkterna innan importen godkänns.')
  }

  const applied = await applyActorRegistryRecords({ sourceBytes, sourceKind: importType as 'companies_xml' | 'companies_txt' | 'csv', sourceFilename: fileName, actorUserId: context.userId,
    actors: txtActors??(importType === 'companies_xml' ? parseActorRegistryXml(textContent) : parsed.map(record => ({ name: record.name, legalName: record.name, market: record.market, countryCode: record.countryCode, orgNumber: record.orgNumber, edielId: record.edielId, svkId: record.svkId, eic: record.eic,
      roles: record.roles as ParsedActorRegistryActor['roles'], routes: record.routes.map(route => ({ ...route, market: record.market, environment: 'production' as const })), certificates: [], raw: record.sourceRecord ?? { ...record, sourceKind: 'csv' } }))) })
  await logAdminActionAndUsage({ companyId: null, actorUserId: context.userId, entityType: 'platform_actor_import_run', entityId: applied.uiRunId,
    action: 'actor_import.completed', label: 'Aktörsimport atomärt tillämpad', billable: !applied.reusedExistingRun, billingUnit: 'actor_import',
    metadata: { source, fileName, atomicApplyVersion: 1, result: applied, activation: applied.activation } })

  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/auto-readiness')
  revalidatePath('/admin/customers/intake')
}

async function syncVerifiedActorToCustomerMasterdata(actorId: string, userId: string) {
  const actorResult = await supabaseService
    .from('platform_market_actors')
    .select('id,name,org_number,metadata')
    .eq('id', actorId)
    .single()
  if (actorResult.error) throw actorResult.error
  const actor = actorResult.data as { id: string; name: string; org_number?: string | null; metadata?: Record<string, unknown> | null }

  const rolesResult = await supabaseService
    .from('platform_actor_roles')
    .select('actor_role')
    .eq('actor_id', actorId)
    .eq('is_active', true)
  if (rolesResult.error) throw rolesResult.error
  const roles = new Set((rolesResult.data ?? []).map((row) => String(row.actor_role)))

  const edielResult = await supabaseService
    .from('platform_actor_identifiers')
    .select('identifier_value')
    .eq('actor_id', actorId)
    .eq('identifier_type', 'EdielId')
    .maybeSingle()
  if (edielResult.error && edielResult.error.code !== 'PGRST116') throw edielResult.error
  const edielId = edielResult.data?.identifier_value ? String(edielResult.data.identifier_value) : null

  const routeResult = await supabaseService
    .from('platform_actor_routes')
    .select('communication_address')
    .eq('actor_id', actorId)
    .not('communication_address', 'is', null)
    .limit(1)
    .maybeSingle()
  if (routeResult.error && routeResult.error.code !== 'PGRST116') throw routeResult.error
  const email = routeResult.data?.communication_address ? String(routeResult.data.communication_address) : null

  if (roles.has('grid_owner')) {
    const existing = await supabaseService.from('grid_owners').select('id').eq('ediel_id', edielId ?? '').maybeSingle()
    if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
    const payload = {
      name: actor.name,
      owner_code: edielId ?? actor.name.slice(0, 24),
      ediel_id: edielId,
      org_number: actor.org_number ?? null,
      email,
      country: 'SE',
      is_active: true,
      lifecycle_status: 'active',
      verified_for_customer_flow: true,
      actor_registry_status: 'verified',
      notes: 'Verifierad via platform actor registry. Tenant-admin får endast välja denna aktör, inte skapa ny masterdata från kundintaget.',
      updated_by: userId,
    }
    const result = existing.data?.id
      ? await supabaseService.from('grid_owners').update(payload).eq('id', existing.data.id)
      : await supabaseService.from('grid_owners').insert({ ...payload, created_by: userId })
    if (result.error) throw result.error
  }

  if (roles.has('electricity_supplier')) {
    const existing = await supabaseService.from('electricity_suppliers').select('id').eq('ediel_id', edielId ?? '').maybeSingle()
    if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
    const payload = {
      name: actor.name,
      org_number: actor.org_number ?? null,
      ediel_id: edielId,
      email,
      is_active: true,
      is_own_supplier: false,
      lifecycle_status: 'active',
      verified_for_customer_flow: true,
      actor_registry_status: 'verified',
      notes: 'Verifierad via platform actor registry. Får väljas i kundintag men routes kontrolleras separat av Ediel guard.',
      updated_by: userId,
    }
    const result = existing.data?.id
      ? await supabaseService.from('electricity_suppliers').update(payload).eq('id', existing.data.id)
      : await supabaseService.from('electricity_suppliers').insert({ ...payload, created_by: userId })
    if (result.error) throw result.error
  }
}

export async function verifyPlatformActorForCustomerFlowAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  if (!actorId) throw new Error('actorId saknas.')
  const registryActor = await supabaseService.from('platform_market_actors').select('metadata').eq('id', actorId).single()
  if (registryActor.error) throw registryActor.error
  if ((registryActor.data?.metadata as Record<string, unknown> | null)?.market === 'GAS') throw new Error('gas_actor_not_enabled_for_el_market')

  const actorUpdate = await supabaseService
    .from('platform_market_actors')
    .update({ match_status: 'verified', visible_to_tenants: true, verified_at: new Date().toISOString(), verified_by: context.userId, status: 'active', updated_at: new Date().toISOString() })
    .eq('id', actorId)
  if (actorUpdate.error) throw actorUpdate.error

  const routeUpdate = await supabaseService
    .from('platform_actor_routes')
    .update({ status: 'active', is_verified: true, auto_send_allowed: false, updated_at: new Date().toISOString() })
    .eq('actor_id', actorId)
    .eq('status', 'needs_review')
  if (routeUpdate.error) throw routeUpdate.error

  await syncVerifiedActorToCustomerMasterdata(actorId, context.userId)

  const verifiedRolesResult = await supabaseService
    .from('platform_actor_roles')
    .select('actor_role')
    .eq('actor_id', actorId)
    .eq('is_active', true)
  if (verifiedRolesResult.error) throw verifiedRolesResult.error
  const verifiedRoles = (verifiedRolesResult.data ?? []).map((row) => String(row.actor_role))

  await logAdminActionAndUsage({
    companyId: null,
    actorUserId: context.userId,
    entityType: 'platform_market_actor',
    entityId: actorId,
    action: 'actor_verified',
    label: 'Aktör verifierad för kundflöde',
    billable: true,
    billingUnit: 'actor_verification',
    metadata: { actorId, roles: verifiedRoles, autoSendAllowed: false },
  })
  if (verifiedRoles.includes('grid_owner')) {
    await logUsageEvent({
      companyId: null,
      actorUserId: context.userId,
      entityType: 'platform_market_actor',
      entityId: actorId,
      eventKey: 'grid_owner_verified',
      actionLabel: 'Nätägare verifierad',
      source: 'actor_registry',
      billable: true,
      billingUnit: 'actor_verification',
      metadata: { actorId, roles: verifiedRoles },
    })
  }

  await supabaseService
    .from('platform_actor_import_issues')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('actor_id', actorId)
    .in('issue_type', ['ambiguous_match', 'missing_route', 'route_conflict'])
    .then((result) => { if (result.error) throw result.error })

  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/customers/intake')
}

export async function resolvePlatformActorImportIssueAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const issueId = value(formData, 'issueId')
  const status = value(formData, 'status') ?? 'resolved'
  if (!issueId) throw new Error('issueId saknas.')
  const result = await supabaseService
    .from('platform_actor_import_issues')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', issueId)
  if (result.error) throw result.error
  revalidatePath('/admin/ediel/actors')
}

export async function saveEdielPartyRegistryEntryAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const name = value(formData, 'name')
  const edielId = value(formData, 'edielId')
  if (!name || !edielId) throw new Error('Namn och Ediel-ID krävs.')

  const now = new Date().toISOString()
  const roles = normalizeRolesForParty(formData)
  const status = value(formData, 'status') ?? 'needs_verification'
  const source = value(formData, 'source') ?? 'manual'
  const addressSource = source === 'import' ? 'manual' : source
  const partyType = primaryPartyType(roles)
  const requestedVisibleToCustomerFlow = boolValue(formData, 'visibleToCustomerFlow')
  const visibleToCustomerFlow = requestedVisibleToCustomerFlow && customerFlowVisibilityAllowed(roles, status)

  const partyPayload = {
    name,
    organization_number: value(formData, 'organizationNumber'),
    ediel_id: edielId,
    roles,
    status,
    visible_to_customer_flow: visibleToCustomerFlow,
    source,
    notes: value(formData, 'notes'),
    updated_by: context.userId,
    updated_at: now,
  }

  const existing = await supabaseService
    .from('ediel_parties')
    .select('id')
    .eq('ediel_id', edielId)
    .maybeSingle()
  if (existing.error) throw existing.error

  const partyResult = existing.data?.id
    ? await supabaseService
        .from('ediel_parties')
        .update(partyPayload)
        .eq('id', existing.data.id)
        .select('id')
        .single()
    : await supabaseService
        .from('ediel_parties')
        .insert({ ...partyPayload, created_by: context.userId })
        .select('id')
        .single()

  if (partyResult.error) throw partyResult.error

  const messageFamily = (value(formData, 'messageFamily') ?? 'PRODAT').toUpperCase()
  const businessCode = value(formData, 'businessCode')?.toUpperCase() ?? null
  const environment = value(formData, 'environment') ?? 'test'
  const subaddress = value(formData, 'subaddress')?.toUpperCase() ?? null
  const smtpAddress = value(formData, 'smtpAddress')
  const transportSecurityMode = normalizeTransportSecurityMode(
    value(formData, 'transportSecurityMode') ??
      (roles.includes('grid_owner') && messageFamily === 'PRODAT' ? 'required_encrypted' : 'needs_verification'),
  )

  if (smtpAddress) {
    let receiverCertificateId = value(formData, 'receiverCertificateId')
    let certificateLookupSummary: Record<string, unknown> | null = null
    const shouldLookupCertificate = boolValue(formData, 'lookupCertificateOnSave') || boolValue(formData, 'fetchCertificateOnSave')
    if (!receiverCertificateId && shouldLookupCertificate && messageFamily === 'PRODAT') {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail: smtpAddress,
        edielId,
        subaddress,
        partyId: partyResult.data.id,
        forceRefresh: true,
      })
      const firstValid = lookup.certificates.find((certificate) => certificate.status === 'valid' && certificate.certificateId)
      receiverCertificateId = firstValid?.certificateId ?? lookup.certificates.find((certificate) => certificate.certificateId)?.certificateId ?? null
      certificateLookupSummary = {
        lookupEmail: lookup.lookupEmail,
        certificatesFound: lookup.certificatesFound,
        validCount: lookup.certificates.filter((certificate) => certificate.status === 'valid').length,
        selectedCertificateId: receiverCertificateId,
        ldapUrl: lookup.ldapUrl,
      }
    }

    const effectiveTransportSecurityMode = messageFamily === 'PRODAT' && receiverCertificateId
      ? normalizeTransportSecurityMode('required_encrypted')
      : transportSecurityMode

    const addressPayload = {
      party_id: partyResult.data.id,
      ediel_id: edielId,
      qualifier: value(formData, 'qualifier') ?? 'ZZ',
      subaddress,
      message_family: messageFamily,
      message_type: messageFamily,
      business_code: businessCode,
      environment,
      smtp_address: smtpAddress,
      transport_security_mode: effectiveTransportSecurityMode,
      requires_subaddress: boolValue(formData, 'requiresSubaddress') || Boolean(subaddress),
      certificate_required: boolValue(formData, 'certificateRequired') || effectiveTransportSecurityMode === 'required_encrypted',
      receiver_certificate_id: receiverCertificateId,
      status: value(formData, 'addressStatus') ?? (effectiveTransportSecurityMode === 'needs_verification' ? 'needs_verification' : 'active'),
      source: addressSource,
      last_verified_at: value(formData, 'lastVerifiedAt') ?? (source === 'manual_verified' || source === 'grid_owner_confirmation' ? now : null),
      valid_from: value(formData, 'validFrom'),
      valid_to: value(formData, 'validTo'),
      metadata: {
        createdFrom: 'admin_ediel_party_registry',
        partyType,
        requestedVisibleToCustomerFlow,
        visibilityWasAccepted: visibleToCustomerFlow,
        certificateLookup: certificateLookupSummary,
      },
      updated_by: context.userId,
      updated_at: now,
    }

    let existingAddressQuery = supabaseService
      .from('ediel_party_addresses')
      .select('id')
      .eq('party_id', partyResult.data.id)
      .eq('environment', environment)
      .eq('message_family', messageFamily)
    existingAddressQuery = businessCode
      ? existingAddressQuery.eq('business_code', businessCode)
      : existingAddressQuery.is('business_code', null)
    const existingAddress = await existingAddressQuery
      .maybeSingle()

    if (existingAddress.error && existingAddress.error.code !== 'PGRST116') throw existingAddress.error

    const addressResult = existingAddress.data?.id
      ? await supabaseService
          .from('ediel_party_addresses')
          .update(addressPayload)
          .eq('id', existingAddress.data.id)
      : await supabaseService
          .from('ediel_party_addresses')
          .insert({ ...addressPayload, created_by: context.userId })

    if (addressResult.error) throw addressResult.error
  }

  await logAdminActionAndUsage({
    companyId: null,
    actorUserId: context.userId,
    entityType: 'ediel_party',
    entityId: String(partyResult.data.id),
    action: roles.includes('grid_owner') ? 'grid_owner_verified' : 'actor_verified',
    label: roles.includes('grid_owner') ? 'Nätägare verifierad eller uppdaterad' : 'Ediel-aktör verifierad eller uppdaterad',
    billable: status === 'verified',
    billingUnit: 'actor_verification',
    metadata: { edielId, roles, partyType, visibleToCustomerFlow, source, messageFamily, environment, subaddress },
  })

  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/routes')
}

export async function refreshExpisoftReceiverCertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const smtpEmail = value(formData, 'smtpEmail')
  if (!smtpEmail) throw new Error('SMTP address krävs för Expisoft lookup.')
  const lookup = await fetchReceiverCertificatesFromExpisoft({
    smtpEmail,
    edielId: value(formData, 'edielId'),
    subaddress: value(formData, 'subaddress'),
    partyId: value(formData, 'partyId'),
    forceRefresh: boolValue(formData, 'forceRefresh'),
  })
  await logAdminActionAndUsage({
    companyId: null,
    actorUserId: context.userId,
    entityType: 'ediel_party_address',
    entityId: value(formData, 'partyId') ?? smtpEmail,
    action: 'actor_certificate_checked',
    label: 'Mottagarcertifikat kontrollerat',
    billable: false,
    metadata: { smtpEmail, edielId: value(formData, 'edielId'), subaddress: value(formData, 'subaddress'), certificatesFound: lookup.certificatesFound },
  })
  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/certificates')
}
