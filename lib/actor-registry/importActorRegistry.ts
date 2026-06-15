import { createHash, X509Certificate } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { ActorRegistryImportSummary, ParsedActorRegistryActor, ActorRegistryCertificate, ActorRegistryRoute } from '@/lib/actor-registry/types'
import { cleanString, normalizeEdielId, normalizeEic, normalizeName, normalizeOrgNumber } from '@/lib/actor-registry/normalizeActor'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { refreshCertificatesForActor } from '@/lib/ediel/certificates/actorCertificateRefresh'

type MatchResult = {
  status: 'matched' | 'no_match' | 'conflict'
  actorId: string | null
  reason: string
}

type SupabaseErrorLike = { code?: string; message?: string }

function isMissingSchema(error: unknown): boolean {
  const record = (error ?? {}) as SupabaseErrorLike
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(record.code ?? '') || /schema cache|does not exist|column .* does not exist/i.test(record.message ?? '')
}

function hashXml(xml: string): string {
  return createHash('sha256').update(xml).digest('hex')
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function createConflict(input: {
  companyId?: string | null
  importRunId?: string | null
  importItemId?: string | null
  actorId?: string | null
  gridOwnerId?: string | null
  supplierId?: string | null
  type: string
  severity?: 'info' | 'warning' | 'blocking'
  title: string
  message: string
  currentData?: Record<string, unknown>
  incomingData?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.rpc('gridex_create_actor_registry_conflict', {
    p_company_id: input.companyId ?? null,
    p_import_run_id: input.importRunId ?? null,
    p_import_item_id: input.importItemId ?? null,
    p_actor_id: input.actorId ?? null,
    p_grid_owner_id: input.gridOwnerId ?? null,
    p_supplier_id: input.supplierId ?? null,
    p_conflict_type: input.type,
    p_severity: input.severity ?? 'blocking',
    p_title: input.title,
    p_message: input.message,
    p_current_data: input.currentData ?? {},
    p_incoming_data: input.incomingData ?? {},
    p_metadata: input.metadata ?? {},
  })
  if (error && !isMissingSchema(error)) throw error
}

async function upsertIdentifier(actorId: string, type: string, value: string | null, verified: boolean, source = 'xml_import') {
  if (!value) return
  const existing = await supabaseService
    .from('platform_actor_identifiers')
    .select('id, actor_id')
    .eq('identifier_type', type)
    .eq('identifier_value', value)
    .maybeSingle()
  if (existing.error && !isMissingSchema(existing.error)) throw existing.error

  if (existing.data?.id) {
    if (existing.data.actor_id !== actorId) {
      await createConflict({
        actorId,
        type: `duplicate_${type.toLowerCase()}`,
        title: 'Identifierare finns på annan aktör',
        message: `${type} ${value} finns redan kopplad till en annan aktör. Importen gissar inte merge.`,
        currentData: existing.data as Record<string, unknown>,
        incomingData: { actorId, type, value },
      })
      return
    }
    const { error } = await supabaseService
      .from('platform_actor_identifiers')
      .update({ is_verified: verified, source, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id)
    if (error && !isMissingSchema(error)) throw error
    return
  }

  const { error } = await supabaseService.from('platform_actor_identifiers').insert({
    actor_id: actorId,
    identifier_type: type,
    identifier_value: value,
    source,
    is_verified: verified,
    metadata: { source },
  })
  if (error && !isMissingSchema(error)) throw error
}

async function matchActor(actor: ParsedActorRegistryActor, importItemId?: string | null, importRunId?: string | null): Promise<MatchResult> {
  const edielId = normalizeEdielId(actor.edielId)
  const orgNumber = normalizeOrgNumber(actor.orgNumber)
  const eic = normalizeEic(actor.eic)
  const name = normalizeName(actor.name)

  const attempts: Array<{ reason: string; run: () => Promise<string[]> }> = [
    {
      reason: 'ediel_id',
      run: async () => {
        if (!edielId) return []
        const { data, error } = await supabaseService.from('platform_actor_identifiers').select('actor_id').in('identifier_type', ['EdielId', 'ediel_id', 'edielid']).eq('identifier_value', edielId)
        if (error && !isMissingSchema(error)) throw error
        return Array.from(new Set((data ?? []).map((row) => String((row as { actor_id: string }).actor_id))))
      },
    },
    {
      reason: 'org_number',
      run: async () => {
        if (!orgNumber) return []
        const { data, error } = await supabaseService.from('platform_market_actors').select('id').eq('org_number', orgNumber)
        if (error && !isMissingSchema(error)) throw error
        return Array.from(new Set((data ?? []).map((row) => String((row as { id: string }).id))))
      },
    },
    {
      reason: 'eic',
      run: async () => {
        if (!eic) return []
        const { data, error } = await supabaseService.from('platform_actor_identifiers').select('actor_id').in('identifier_type', ['EIC', 'eic']).eq('identifier_value', eic)
        if (error && !isMissingSchema(error)) throw error
        return Array.from(new Set((data ?? []).map((row) => String((row as { actor_id: string }).actor_id))))
      },
    },
    {
      reason: 'name_exact',
      run: async () => {
        if (!name) return []
        const { data, error } = await supabaseService.from('platform_market_actors').select('id').eq('normalized_name', name)
        if (error && !isMissingSchema(error)) throw error
        return Array.from(new Set((data ?? []).map((row) => String((row as { id: string }).id))))
      },
    },
  ]

  for (const attempt of attempts) {
    const matches = await attempt.run()
    if (matches.length === 1) return { status: 'matched', actorId: matches[0] ?? null, reason: attempt.reason }
    if (matches.length > 1) {
      await createConflict({
        importRunId,
        importItemId,
        type: `duplicate_${attempt.reason}`,
        title: 'Dubblett i aktörsregistret',
        message: 'Flera aktörer matchar samma identifierare. Importen stoppas för den här posten.',
        currentData: { matchingActorIds: matches, reason: attempt.reason },
        incomingData: { edielId, orgNumber, eic, name: actor.name },
      })
      return { status: 'conflict', actorId: null, reason: attempt.reason }
    }
  }

  return { status: 'no_match', actorId: null, reason: 'no_match' }
}

async function createActor(actor: ParsedActorRegistryActor, sourceReference: string): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('platform_market_actors')
    .insert({
      name: actor.name,
      legal_name: actor.legalName ?? actor.name,
      org_number: normalizeOrgNumber(actor.orgNumber),
      country_code: actor.countryCode ?? 'SE',
      status: 'active',
      match_status: actor.edielId || actor.orgNumber ? 'verified' : 'needs_review',
      source: 'xml_import',
      source_reference: sourceReference,
      visible_to_tenants: true,
      verified_at: actor.edielId || actor.orgNumber ? now : null,
      imported_at: now,
      not_seen_in_latest_import: false,
      last_seen_in_import_at: now,
      registry_import_status: 'created',
      metadata: { source: 'actor_registry_xml_import', roles: actor.roles },
    })
    .select('id')
    .single()
  if (error) throw error
  return String((data as { id: string }).id)
}

async function updateActor(actorId: string, actor: ParsedActorRegistryActor, sourceReference: string): Promise<boolean> {
  const { data: current, error: currentError } = await supabaseService
    .from('platform_market_actors')
    .select('id,name,legal_name,org_number,metadata')
    .eq('id', actorId)
    .maybeSingle()
  if (currentError && !isMissingSchema(currentError)) throw currentError

  const currentRow = jsonRecord(current)
  const normalizedOrg = normalizeOrgNumber(actor.orgNumber)
  if (currentRow.org_number && normalizedOrg && currentRow.org_number !== normalizedOrg) {
    await createConflict({
      actorId,
      type: 'conflicting_org_no',
      title: 'Motstridigt organisationsnummer',
      message: 'Importen innehåller ett annat organisationsnummer än aktören redan har. Detta kräver granskning.',
      currentData: { org_number: currentRow.org_number },
      incomingData: { org_number: normalizedOrg },
    })
    return false
  }

  const payload: Record<string, unknown> = {
    not_seen_in_latest_import: false,
    last_seen_in_import_at: new Date().toISOString(),
    registry_import_status: 'updated',
    source_reference: sourceReference,
    updated_at: new Date().toISOString(),
    metadata: { ...(jsonRecord(currentRow.metadata)), lastXmlImportSource: sourceReference, roles: actor.roles },
  }
  if (actor.name && currentRow.name !== actor.name) payload.name = actor.name
  if ((actor.legalName ?? actor.name) && currentRow.legal_name !== (actor.legalName ?? actor.name)) payload.legal_name = actor.legalName ?? actor.name
  if (!currentRow.org_number && normalizedOrg) payload.org_number = normalizedOrg

  const changed = Object.keys(payload).some((key) => !['updated_at', 'metadata', 'not_seen_in_latest_import', 'last_seen_in_import_at', 'registry_import_status', 'source_reference'].includes(key))
  const { error } = await supabaseService.from('platform_market_actors').update(payload).eq('id', actorId)
  if (error && !isMissingSchema(error)) throw error
  return changed
}

async function upsertRole(actorId: string, role: string) {
  const { data, error } = await supabaseService
    .from('platform_actor_roles')
    .select('id')
    .eq('actor_id', actorId)
    .eq('actor_role', role)
    .maybeSingle()
  if (error && !isMissingSchema(error)) throw error
  if (data?.id) {
    const update = await supabaseService.from('platform_actor_roles').update({ is_active: true, role_source: 'xml_import', updated_at: new Date().toISOString() }).eq('id', data.id)
    if (update.error && !isMissingSchema(update.error)) throw update.error
    return
  }
  const insert = await supabaseService.from('platform_actor_roles').insert({ actor_id: actorId, actor_role: role, role_source: 'xml_import', is_active: true, metadata: { source: 'xml_import' } })
  if (insert.error && !isMissingSchema(insert.error)) throw insert.error
}

async function upsertRoute(actorId: string, route: ActorRegistryRoute, edielId: string | null) {
  const subaddress = cleanString(route.subaddress)
  const communicationAddress = cleanString(route.communicationAddress)
  const family = cleanString(route.messageFamily)?.toUpperCase() ?? 'PRODAT'
  const environment = route.environment === 'test' ? 'test' : 'production'
  let existingQuery = supabaseService
    .from('platform_actor_routes')
    .select('id, actor_id')
    .eq('actor_id', actorId)
    .eq('message_family', family)
    .eq('environment', environment)

  existingQuery = subaddress ? existingQuery.eq('subaddress', subaddress) : existingQuery.is('subaddress', null)
  existingQuery = communicationAddress ? existingQuery.eq('communication_address', communicationAddress) : existingQuery.is('communication_address', null)

  const existing = await existingQuery.maybeSingle()

  const payload = {
    actor_id: actorId,
    message_family: family,
    application_reference: route.applicationReference ?? family,
    environment,
    subaddress,
    communication_type: route.communicationType ?? (communicationAddress ? 'smtp' : null),
    communication_address: communicationAddress,
    party_id: route.partyId ?? edielId,
    interchange_party_id: route.interchangePartyId ?? route.partyId ?? edielId,
    is_verified: Boolean(route.isVerified && (route.partyId ?? edielId)),
    status: route.status ?? 'active',
    source: 'xml_import',
    metadata: {
      ...(route.metadata ?? {}),
      source: 'xml_import',
      subaddress_status: subaddress ? 'verified' : 'missing',
      blank_subaddress_requires_review: !subaddress,
    },
    updated_at: new Date().toISOString(),
  }

  if (!existing.error && existing.data?.id) {
    const update = await supabaseService.from('platform_actor_routes').update(payload).eq('id', existing.data.id)
    if (update.error && !isMissingSchema(update.error)) throw update.error
    return
  }
  if (existing.error && !isMissingSchema(existing.error) && existing.error.code !== 'PGRST116') throw existing.error

  const insert = await supabaseService.from('platform_actor_routes').insert(payload)
  if (insert.error && !isMissingSchema(insert.error)) throw insert.error
}

function parsePemCertificate(input: ActorRegistryCertificate): { fingerprint: string; validFrom: string | null; validTo: string | null; subject: string | null; issuer: string | null; serialNumber: string | null; status: 'valid' | 'expired' | 'invalid' | 'unknown' } | null {
  const pem = cleanString(input.pem)
  if (!pem) return null
  try {
    const cert = new X509Certificate(pem)
    const fingerprint = createHash('sha256').update(cert.raw).digest('hex').toUpperCase()
    const validToMs = Date.parse(cert.validTo)
    const validFromMs = Date.parse(cert.validFrom)
    const now = Date.now()
    const status = Number.isFinite(validToMs) && validToMs <= now ? 'expired' : Number.isFinite(validFromMs) && validFromMs > now ? 'invalid' : 'valid'
    return {
      fingerprint,
      validFrom: Number.isFinite(validFromMs) ? new Date(validFromMs).toISOString() : null,
      validTo: Number.isFinite(validToMs) ? new Date(validToMs).toISOString() : null,
      subject: cert.subject,
      issuer: cert.issuer,
      serialNumber: cert.serialNumber,
      status,
    }
  } catch {
    return null
  }
}

async function upsertCertificate(actorId: string, actor: ParsedActorRegistryActor, certificate: ActorRegistryCertificate) {
  const parsed = parsePemCertificate(certificate)
  const fingerprint = cleanString(certificate.fingerprintSha256)?.toUpperCase() ?? parsed?.fingerprint
  if (!fingerprint) return
  const status = parsed?.status ?? 'unknown'
  const pem = cleanString(certificate.pem)
  const environment = certificate.environment === 'test' ? 'test' : 'production'
  const purpose = certificate.purpose === 'signing' ? 'signing' : 'encryption'

  const existing = await supabaseService
    .from('platform_actor_certificates')
    .select('id')
    .eq('actor_id', actorId)
    .eq('environment', environment)
    .eq('purpose', purpose)
    .eq('fingerprint_sha256', fingerprint)
    .maybeSingle()
  if (existing.error && !isMissingSchema(existing.error)) throw existing.error

  const payload = {
    actor_id: actorId,
    ediel_id: normalizeEdielId(actor.edielId),
    environment,
    purpose,
    certificate_type: 'smime',
    subject: certificate.subject ?? parsed?.subject ?? null,
    issuer: certificate.issuer ?? parsed?.issuer ?? null,
    serial_number: certificate.serialNumber ?? parsed?.serialNumber ?? null,
    fingerprint_sha256: fingerprint,
    valid_from: certificate.validFrom ?? parsed?.validFrom ?? null,
    valid_to: certificate.validTo ?? parsed?.validTo ?? null,
    status,
    source: 'xml_import',
    raw_certificate_pem: pem,
    metadata: { ...(certificate.metadata ?? {}), source: 'xml_import' },
    last_checked_at: new Date().toISOString(),
    next_check_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }

  const query = existing.data?.id
    ? supabaseService.from('platform_actor_certificates').update(payload).eq('id', existing.data.id)
    : supabaseService.from('platform_actor_certificates').insert(payload)
  const { error } = await query
  if (error && !isMissingSchema(error)) throw error
}

async function ensureGridOwner(actorId: string, actor: ParsedActorRegistryActor) {
  if (!actor.roles.includes('grid_owner')) return
  const edielId = normalizeEdielId(actor.edielId)
  const existing = await supabaseService
    .from('grid_owners')
    .select('id')
    .eq('platform_market_actor_id', actorId)
    .limit(1)
    .maybeSingle()
  if (existing.error && !isMissingSchema(existing.error)) throw existing.error

  const payload = {
    name: actor.name,
    owner_code: edielId ?? actor.name,
    ediel_id: edielId,
    org_number: normalizeOrgNumber(actor.orgNumber),
    country: actor.countryCode ?? 'SE',
    is_active: true,
    platform_market_actor_id: actorId,
    actor_registry_status: 'under_review',
    not_seen_in_latest_import: false,
    last_seen_in_import_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    const update = await supabaseService.from('grid_owners').update(payload).eq('id', existing.data.id)
    if (update.error && !isMissingSchema(update.error)) throw update.error
    return
  }

  const insert = await supabaseService.from('grid_owners').insert(payload)
  if (insert.error && !isMissingSchema(insert.error)) throw insert.error
}

async function ensurePlatformGridOwner(actorId: string, actor: ParsedActorRegistryActor) {
  if (!actor.roles.includes('grid_owner')) return
  const edielId = normalizeEdielId(actor.edielId)
  const existing = edielId
    ? await supabaseService.from('platform_grid_owners').select('id').eq('ediel_id', edielId).limit(1).maybeSingle()
    : await supabaseService.from('platform_grid_owners').select('id').eq('name', actor.name).limit(1).maybeSingle()
  if (existing.error && !isMissingSchema(existing.error)) return

  const payload = {
    name: actor.name,
    org_number: normalizeOrgNumber(actor.orgNumber),
    ediel_id: edielId,
    is_active: true,
    source: 'xml_import',
    metadata: { source: 'actor_registry_xml_import', platform_market_actor_id: actorId },
    updated_at: new Date().toISOString(),
  }
  if (existing.data?.id) {
    const update = await supabaseService.from('platform_grid_owners').update(payload).eq('id', existing.data.id)
    if (update.error && !isMissingSchema(update.error)) throw update.error
    return
  }
  const insert = await supabaseService.from('platform_grid_owners').insert(payload)
  if (insert.error && !isMissingSchema(insert.error)) throw insert.error
}

async function ensureSupplier(actorId: string, actor: ParsedActorRegistryActor) {
  if (!actor.roles.includes('electricity_supplier')) return
  const existing = await supabaseService
    .from('electricity_suppliers')
    .select('id')
    .eq('platform_market_actor_id', actorId)
    .limit(1)
    .maybeSingle()
  if (existing.error) {
    if (isMissingSchema(existing.error)) return
    throw existing.error
  }
  const payload = {
    name: actor.name,
    org_number: normalizeOrgNumber(actor.orgNumber),
    ediel_id: normalizeEdielId(actor.edielId),
    is_active: true,
    platform_market_actor_id: actorId,
    actor_registry_status: 'under_review',
    not_seen_in_latest_import: false,
    last_seen_in_import_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const result = existing.data?.id
    ? await supabaseService.from('electricity_suppliers').update(payload).eq('id', existing.data.id)
    : await supabaseService.from('electricity_suppliers').insert(payload)
  if (result.error && !isMissingSchema(result.error)) throw result.error
}

async function applyActor(actor: ParsedActorRegistryActor, match: MatchResult, sourceReference: string): Promise<{ actorId: string; created: boolean; updated: boolean }> {
  const actorId = match.actorId ?? await createActor(actor, sourceReference)
  const updated = match.actorId ? await updateActor(actorId, actor, sourceReference) : false

  await upsertIdentifier(actorId, 'EdielId', normalizeEdielId(actor.edielId), true)
  await upsertIdentifier(actorId, 'OrgNo', normalizeOrgNumber(actor.orgNumber), true)
  await upsertIdentifier(actorId, 'EIC', normalizeEic(actor.eic), true)
  for (const role of actor.roles) await upsertRole(actorId, role)
  for (const route of actor.routes) await upsertRoute(actorId, route, normalizeEdielId(actor.edielId))
  for (const certificate of actor.certificates) await upsertCertificate(actorId, actor, certificate)
  await ensureGridOwner(actorId, actor)
  await ensurePlatformGridOwner(actorId, actor)
  await ensureSupplier(actorId, actor)

  const { error } = await supabaseService.rpc('gridex_recalculate_actor_readiness', { p_platform_market_actor_id: actorId })
  if (error && !isMissingSchema(error)) throw error

  if (actor.routes.some((route) => route.communicationAddress) && actor.certificates.length === 0) {
    await refreshCertificatesForActor({ actorId, triggeredBy: 'xml_import' }).catch(() => null)
  }

  return { actorId, created: match.status === 'no_match', updated }
}

async function insertImportItem(importRunId: string, actor: ParsedActorRegistryActor): Promise<string | null> {
  const normalizedPayload = {
    name: actor.name,
    legalName: actor.legalName,
    edielId: normalizeEdielId(actor.edielId),
    orgNumber: normalizeOrgNumber(actor.orgNumber),
    eic: normalizeEic(actor.eic),
    roles: actor.roles,
    routes: actor.routes,
    certificates: actor.certificates.map((cert) => ({ ...cert, pem: cert.pem ? '[redacted-pem]' : null })),
  }
  const { data, error } = await supabaseService
    .from('actor_registry_import_items')
    .insert({
      import_run_id: importRunId,
      raw_payload: actor.raw,
      normalized_payload: normalizedPayload,
      normalized_name: normalizeName(actor.name),
      normalized_org_no: normalizeOrgNumber(actor.orgNumber),
      normalized_ediel_id: normalizeEdielId(actor.edielId),
      normalized_eic: normalizeEic(actor.eic),
      roles: actor.roles,
      routes: actor.routes,
      certificates: normalizedPayload.certificates,
    })
    .select('id')
    .maybeSingle()
  if (error && !isMissingSchema(error)) throw error
  return data?.id ? String(data.id) : null
}

export async function importActorRegistryXml(input: {
  xml: string
  sourceFilename?: string | null
  uploadedBy?: string | null
  forceReprocess?: boolean
}): Promise<ActorRegistryImportSummary> {
  const sourceHash = hashXml(input.xml)
  const existingRun = await supabaseService
    .from('actor_registry_import_runs')
    .select('id,total_records,created_count,updated_count,unchanged_count,conflict_count,error_count,status')
    .eq('source_hash', sourceHash)
    .maybeSingle()
  if (existingRun.error && !isMissingSchema(existingRun.error)) throw existingRun.error

  if (existingRun.data?.id && !input.forceReprocess) {
    return {
      importRunId: String(existingRun.data.id),
      reusedExistingRun: true,
      totalRecords: Number(existingRun.data.total_records ?? 0),
      created: Number(existingRun.data.created_count ?? 0),
      updated: Number(existingRun.data.updated_count ?? 0),
      unchanged: Number(existingRun.data.unchanged_count ?? 0),
      conflicts: Number(existingRun.data.conflict_count ?? 0),
      errors: Number(existingRun.data.error_count ?? 0),
    }
  }

  const actors = parseActorRegistryXml(input.xml)
  const { data: run, error: runError } = await supabaseService
    .from('actor_registry_import_runs')
    .insert({
      source: 'xml_upload',
      source_filename: input.sourceFilename ?? null,
      source_hash: input.forceReprocess ? `${sourceHash}:${Date.now()}` : sourceHash,
      status: 'running',
      uploaded_by: input.uploadedBy ?? null,
      total_records: actors.length,
      metadata: { parser: 'parseActorRegistryXml' },
    })
    .select('id')
    .single()
  if (runError) throw runError
  const importRunId = String(run.id)

  let created = 0
  let updated = 0
  let unchanged = 0
  let conflicts = 0
  let errors = 0

  for (const actor of actors) {
    const importItemId = await insertImportItem(importRunId, actor)
    try {
      const match = await matchActor(actor, importItemId, importRunId)
      if (match.status === 'conflict') {
        conflicts += 1
        if (importItemId) {
          await supabaseService.from('actor_registry_import_items').update({ match_status: 'conflict', review_required: true, review_reason: match.reason, updated_at: new Date().toISOString() }).eq('id', importItemId)
        }
        continue
      }
      const applied = await applyActor(actor, match, importRunId)
      if (applied.created) created += 1
      else if (applied.updated) updated += 1
      else unchanged += 1
      if (importItemId) {
        await supabaseService.from('actor_registry_import_items').update({
          match_status: applied.created ? 'created' : applied.updated ? 'updated' : 'unchanged',
          matched_actor_id: applied.actorId,
          match_reason: match.reason,
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', importItemId)
      }
    } catch (error) {
      errors += 1
      const message = error instanceof Error ? error.message : String(error)
      if (importItemId) {
        await supabaseService.from('actor_registry_import_items').update({ match_status: 'error', error_message: message, updated_at: new Date().toISOString() }).eq('id', importItemId)
      }
    }
  }

  const finalStatus = errors > 0 || conflicts > 0 ? 'completed_with_warnings' : 'completed'
  await supabaseService.from('actor_registry_import_runs').update({
    status: finalStatus,
    finished_at: new Date().toISOString(),
    total_records: actors.length,
    created_count: created,
    updated_count: updated,
    unchanged_count: unchanged,
    conflict_count: conflicts,
    error_count: errors,
    updated_at: new Date().toISOString(),
  }).eq('id', importRunId)

  return { importRunId, reusedExistingRun: false, totalRecords: actors.length, created, updated, unchanged, conflicts, errors }
}
