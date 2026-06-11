'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeTransportSecurityMode } from '@/lib/ediel/partyRegistry'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

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

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function xmlText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return match?.[1] ? decodeXml(match[1].trim()) : null
}

function xmlAttr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null
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

function parseCompaniesXml(textContent: string): ActorImportRecord[] {
  return [...textContent.matchAll(/<Company>([\s\S]*?)<\/Company>/g)]
    .map((match) => {
      const block = match[1]
      const name = xmlText(block, 'Name')
      const identifiers = [...block.matchAll(/<Key\s+Type="([^"]+)">([\s\S]*?)<\/Key>/g)].map((identifier) => ({
        type: decodeXml(identifier[1].trim()),
        value: decodeXml(identifier[2].trim()),
      }))
      const byType = Object.fromEntries(identifiers.map((identifier) => [identifier.type, identifier.value])) as Record<string, string | undefined>
      const roles = [...block.matchAll(/<Role>([\s\S]*?)<\/Role>/g)]
        .map((role) => normalizeActorRole(decodeXml(role[1].trim())))
        .filter(Boolean)
      const routes = [...block.matchAll(/<EDIFACTDetails\s+Type="([^"]+)">([\s\S]*?)<\/EDIFACTDetails>/g)].map((routeMatch) => {
        const detail = routeMatch[2]
        const communicationTag = detail.match(/<CommunicationAddress\b[^>]*>[\s\S]*?<\/CommunicationAddress>/)?.[0] ?? ''
        const interchangeTag = detail.match(/<InterchangePartyId\b[^>]*>[\s\S]*?<\/InterchangePartyId>/)?.[0] ?? ''
        const partyTag = detail.match(/<PartyId\b[^>]*>[\s\S]*?<\/PartyId>/)?.[0] ?? ''
        return {
          messageFamily: decodeXml(routeMatch[1].trim()).toUpperCase(),
          subaddress: xmlText(detail, 'SubAddress'),
          communicationType: xmlAttr(communicationTag, 'Type'),
          communicationAddress: xmlText(detail, 'CommunicationAddress'),
          ediCharset: xmlText(detail, 'EDICharset'),
          ediSyntax: xmlText(detail, 'EDISyntax'),
          partyId: xmlText(detail, 'PartyId'),
          partyIdQualifier: xmlAttr(partyTag, 'IdCodeQualifier'),
          partyIdResponsible: xmlAttr(partyTag, 'IdCodeResponsible'),
          interchangePartyId: xmlText(detail, 'InterchangePartyId'),
          interchangeIdQualifier: xmlAttr(interchangeTag, 'IdCodeQualifier'),
        }
      })
      return name ? {
        name,
        orgNumber: byType.OrgNo ?? null,
        edielId: byType.EdielId ?? null,
        svkId: byType.SvKId ?? null,
        eic: byType.EIC ?? null,
        roles: roles.length ? Array.from(new Set(roles)) : ['other'],
        routes,
      } : null
    })
    .filter((record): record is ActorImportRecord => Boolean(record?.name))
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

function normalizeActorName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function actorIsTenantVisible(roles: string[]): boolean {
  return roles.some((role) => ['grid_owner', 'electricity_supplier'].includes(role))
}

async function upsertImportedActor(record: ActorImportRecord, importRunId: string, source: string, userId: string) {
  const normalizedName = normalizeActorName(record.name)
  const existing = await supabaseService
    .from('platform_market_actors')
    .select('id,match_status')
    .eq('normalized_name', normalizedName)
    .maybeSingle()
  if (existing.error && existing.error.code !== 'PGRST116') throw existing.error

  const metadata = {
    importedBy: userId,
    source,
    edielId: record.edielId,
    svkId: record.svkId,
    eic: record.eic,
    roles: record.roles,
  }
  const payload = {
    name: record.name,
    org_number: record.orgNumber,
    legal_name: record.name,
    status: 'active',
    match_status: existing.data?.match_status === 'verified' ? 'verified' : (record.edielId || record.orgNumber ? 'strong_suggestion' : 'needs_review'),
    source,
    visible_to_tenants: actorIsTenantVisible(record.roles),
    metadata,
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const actorResult = existing.data?.id
    ? await supabaseService.from('platform_market_actors').update(payload).eq('id', existing.data.id).select('id').single()
    : await supabaseService.from('platform_market_actors').insert(payload).select('id').single()
  if (actorResult.error) throw actorResult.error
  const actorId = String(actorResult.data.id)

  const identifiers = [
    ['EdielId', record.edielId],
    ['OrgNo', record.orgNumber],
    ['SvKId', record.svkId],
    ['EIC', record.eic],
  ] as Array<[string, string | null]>
  for (const [type, identifierValue] of identifiers) {
    if (!identifierValue) continue
    const existingIdentifier = await supabaseService
      .from('platform_actor_identifiers')
      .select('id')
      .eq('identifier_type', type)
      .eq('identifier_value', identifierValue)
      .maybeSingle()
    if (existingIdentifier.error && existingIdentifier.error.code !== 'PGRST116') throw existingIdentifier.error
    const identifierPayload = {
      actor_id: actorId,
      identifier_type: type,
      identifier_value: identifierValue,
      source,
      is_verified: true,
      metadata: { importRunId },
      updated_at: new Date().toISOString(),
    }
    const result = existingIdentifier.data?.id
      ? await supabaseService.from('platform_actor_identifiers').update(identifierPayload).eq('id', existingIdentifier.data.id)
      : await supabaseService.from('platform_actor_identifiers').insert(identifierPayload)
    if (result.error) throw result.error
  }

  for (const role of record.roles) {
    const roleResult = await supabaseService
      .from('platform_actor_roles')
      .upsert({ actor_id: actorId, actor_role: role, role_source: source, is_active: true, metadata: { importRunId }, updated_at: new Date().toISOString() }, { onConflict: 'actor_id,actor_role' })
    if (roleResult.error) throw roleResult.error
  }

  await supabaseService
    .from('platform_actor_aliases')
    .upsert({ actor_id: actorId, alias: record.name, alias_source: source, confidence: 1, is_verified: true, metadata: { importRunId } }, { onConflict: 'actor_id,normalized_alias' })
    .then((result) => { if (result.error) throw result.error })

  for (const route of record.routes) {
    const existingRoute = await supabaseService
      .from('platform_actor_routes')
      .select('id')
      .eq('actor_id', actorId)
      .eq('message_family', route.messageFamily)
      .eq('environment', 'production')
      .eq('subaddress', route.subaddress ?? '')
      .eq('communication_address', route.communicationAddress ?? '')
      .maybeSingle()
    const routePayload = {
      actor_id: actorId,
      message_family: route.messageFamily,
      application_reference: route.applicationReference ?? null,
      environment: 'production',
      subaddress: route.subaddress,
      communication_type: route.communicationType,
      communication_address: route.communicationAddress,
      edi_charset: route.ediCharset,
      edi_syntax: route.ediSyntax,
      party_id: route.partyId,
      party_id_qualifier: route.partyIdQualifier,
      party_id_responsible: route.partyIdResponsible,
      interchange_party_id: route.interchangePartyId,
      interchange_id_qualifier: route.interchangeIdQualifier,
      requires_poa: true,
      is_verified: false,
      auto_send_allowed: false,
      status: 'needs_review',
      source,
      metadata: { importRunId, importedFromUi: true },
      updated_at: new Date().toISOString(),
    }
    const result = existingRoute.data?.id
      ? await supabaseService.from('platform_actor_routes').update(routePayload).eq('id', existingRoute.data.id)
      : await supabaseService.from('platform_actor_routes').insert(routePayload)
    if (result.error) throw result.error
  }

  if (!record.edielId) {
    await supabaseService.from('platform_actor_import_issues').insert({
      import_run_id: importRunId,
      actor_id: actorId,
      issue_type: 'missing_identifier',
      severity: 'blocking',
      status: 'open',
      message: 'Aktören saknar EdielId och får inte användas för autosändning.',
      metadata: { name: record.name },
    })
  }
  if (record.routes.length === 0) {
    await supabaseService.from('platform_actor_import_issues').insert({
      import_run_id: importRunId,
      actor_id: actorId,
      issue_type: 'missing_route',
      severity: 'warning',
      status: 'open',
      message: 'Aktören saknar EDIFACT-route och behöver kompletteras innan den kan bli send-ready.',
      metadata: { name: record.name, edielId: record.edielId },
    })
  }

  return actorId
}

export async function importPlatformActorsAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('actorImportFile')
  const source = value(formData, 'source') ?? 'ui_import'
  const format = value(formData, 'format') ?? 'auto'
  if (!(file instanceof File) || file.size <= 0) throw new Error('Välj companies.xml eller CSV-fil att importera.')

  const textContent = await file.text()
  const fileName = file.name || 'actor-import'
  const parsed = format === 'csv' || fileName.toLowerCase().endsWith('.csv')
    ? parseActorCsv(textContent)
    : parseCompaniesXml(textContent)
  if (parsed.length === 0) throw new Error('Importfilen innehöll inga aktörer som kunde läsas.')

  const run = await supabaseService
    .from('platform_actor_import_runs')
    .insert({
      source: fileName,
      import_type: fileName.toLowerCase().endsWith('.xml') ? 'companies_xml' : 'csv',
      status: 'running',
      records_seen: parsed.length,
      records_upserted: 0,
      safe: true,
      created_by: context.userId,
      metadata: { source, importedFromUi: true },
    })
    .select('id')
    .single()
  if (run.error) throw run.error

  let upserted = 0
  const errors: Array<Record<string, unknown>> = []
  for (const record of parsed) {
    try {
      await upsertImportedActor(record, String(run.data.id), source, context.userId)
      upserted += 1
    } catch (error) {
      errors.push({ name: record.name, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const status = errors.length > 0 ? 'completed_with_warnings' : 'completed_with_warnings'
  const update = await supabaseService
    .from('platform_actor_import_runs')
    .update({
      status,
      records_upserted: upserted,
      records_failed: errors.length,
      completed_at: new Date().toISOString(),
      error_log: errors,
      metadata: { source, importedFromUi: true, fileName, parsed: parsed.length },
    })
    .eq('id', run.data.id)
  if (update.error) throw update.error

  revalidatePath('/admin/ediel/actors')
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

  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/routes')
}

export async function refreshExpisoftReceiverCertificateAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const smtpEmail = value(formData, 'smtpEmail')
  if (!smtpEmail) throw new Error('SMTP address krävs för Expisoft lookup.')
  await fetchReceiverCertificatesFromExpisoft({
    smtpEmail,
    edielId: value(formData, 'edielId'),
    subaddress: value(formData, 'subaddress'),
    partyId: value(formData, 'partyId'),
    forceRefresh: boolValue(formData, 'forceRefresh'),
  })
  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/certificates')
}
