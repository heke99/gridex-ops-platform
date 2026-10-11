import { createHash } from 'node:crypto'
import type { ActorRegistryRole, ParsedActorRegistryActor } from '@/lib/actor-registry/types'
import { cleanString, normalizeEdielId, normalizeEmail, normalizeOrgNumber } from '@/lib/actor-registry/normalizeActor'

/**
 * Reconciles the OPS `grid_owners` masterdata with an official ediel.se
 * actor list. The atomic registry RPC only writes platform_market_actors and
 * its routes; without this step the grid owners used by customer flows never
 * receive new Ediel IDs, communication addresses or subaddresses.
 *
 * Matching is fail-closed:
 *  1. an existing grid_owners.ediel_id is matched only to the EL company that
 *     declares the Netowner role for that id (other roles are flagged);
 *  2. owners without an Ediel ID are linked by organisation number, then by
 *     exact normalised name, and only when exactly one EL Netowner matches and
 *     that id is not already held by another grid owner;
 *  3. an EL Netowner is created only when its Ediel ID, org number and name
 *     are absent from every grid_owners row (any tenant).
 * Verification flags, manual contact channels, certificates and readiness
 * are never written. A TXT source (no roles/OrgNo) never creates, never links
 * by name and never touches org numbers; it may update an owner only when the
 * Netowner role is already known from the platform registry.
 */

export type GridOwnerRow = {
  id: string
  name: string
  company_id?: string | null
  ediel_id: string | null
  org_number: string | null
  communication_email: string | null
  default_prodat_subaddress: string | null
  default_utilts_subaddress: string | null
  is_active?: boolean | null
  verified_for_customer_flow?: boolean | null
}

export type GridOwnerPatch = Partial<Pick<GridOwnerRow, 'name' | 'ediel_id' | 'org_number' | 'communication_email' | 'default_prodat_subaddress' | 'default_utilts_subaddress'>>

export type GridOwnerInsert = {
  name: string
  ediel_id: string
  owner_code: string
  org_number: string | null
  organization_number: string | null
  communication_email: string | null
  default_prodat_subaddress: string | null
  default_utilts_subaddress: string | null
  is_active: true
  lifecycle_status: 'active'
  country: 'SE'
  environment: 'production'
  source: 'ediel_registry_import'
  verified_for_customer_flow: false
  manual_review_required: true
  manual_review_reason: string
}

export type GridOwnerFlagCode =
  | 'ediel_id_role_mismatch'
  | 'ediel_id_not_in_registry'
  | 'ediel_id_gas_market_only'
  | 'duplicate_grid_owner_ediel_id'
  | 'role_unconfirmed_txt_source'
  | 'org_number_conflict'
  | 'name_match_ambiguous'
  | 'name_matches_non_grid_owner'
  | 'name_match_ediel_id_taken'
  | 'no_registry_match'
  | 'registry_without_prodat_route'
  | 'registry_prodat_route_ambiguous'
  | 'registry_utilts_route_ambiguous'
  | 'verified_owner_contact_changed'
  | 'registry_name_changed'
  | 'new_netowner_collides_with_existing'

export type GridOwnerFlag = { code: GridOwnerFlagCode; gridOwnerId: string | null; name: string; edielId: string | null; detail?: Record<string, unknown> }
export type GridOwnerUpdate = { gridOwnerId: string; name: string; edielId: string; matchedBy: 'ediel_id' | 'org_number' | 'name_and_role'; before: GridOwnerPatch; patch: GridOwnerPatch }
export type GridOwnerCreate = { edielId: string; name: string; row: GridOwnerInsert }

export type GridOwnerReconciliationPlan = {
  sourceKind: 'companies_xml' | 'companies_txt' | 'csv'
  counts: { gridOwnersSeen: number; registryNetowners: number; matched: number; updated: number; unchanged: number; linked: number; created: number; flagged: number }
  updates: GridOwnerUpdate[]
  creates: GridOwnerCreate[]
  unchanged: Array<{ gridOwnerId: string; name: string; edielId: string }>
  flags: GridOwnerFlag[]
  planSha256: string
}

type Candidate = { actor: ParsedActorRegistryActor; edielId: string; name: string; roles: ActorRegistryRole[] | null }

const LEGAL_FORM_TOKENS = new Set(['ab', 'ek', 'för', 'ekonomisk', 'förening', 'upa'])
/** Legal-form and punctuation-insensitive company key ("Boo Energi ek. för" = "Boo Energi ek för",
 * "Borlänge Energi Elnät, AB" = "Borlänge Energi Elnät AB"). Used only together with the Netowner role. */
export function gridOwnerNameKey(value: unknown): string | null {
  const clean = cleanString(value)?.normalize('NFC').toLowerCase()
  if (!clean) return null
  const tokens = clean.replace(/\bu\.?\s?p\.?\s?a\.?/g, ' upa ').replace(/&/g, ' och ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean)
  const kept = tokens.filter(token => !LEGAL_FORM_TOKENS.has(token))
  return (kept.length ? kept : tokens).join(' ') || null
}
const nameKey = gridOwnerNameKey
const sameText = (a: string | null | undefined, b: string | null | undefined) => (cleanString(a) ?? null) === (cleanString(b) ?? null)
export function formatSwedishOrgNumber(value: unknown): string | null {
  const digits = normalizeOrgNumber(value)
  if (!digits) return null
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits
}

function elRoute(actor: ParsedActorRegistryActor, family: 'PRODAT' | 'UTILTS') {
  const routes = actor.routes.filter(route => route.messageFamily.toUpperCase() === family && route.environment === 'production' && route.communicationAddress)
  const distinct = new Map(routes.map(route => [`${normalizeEmail(route.communicationAddress)}|${cleanString(route.subaddress) ?? ''}`, route]))
  if (distinct.size === 0) return { route: null, ambiguous: false }
  if (distinct.size > 1) return { route: null, ambiguous: true }
  return { route: [...distinct.values()][0], ambiguous: false }
}

export function planGridOwnerReconciliation(input: {
  actors: ParsedActorRegistryActor[]
  sourceKind: GridOwnerReconciliationPlan['sourceKind']
  gridOwners: GridOwnerRow[]
  /** Roles already held by the platform registry, keyed by Ediel ID (used for TXT, which has no roles). */
  knownRoles?: ReadonlyMap<string, readonly string[]>
}): GridOwnerReconciliationPlan {
  const txt = input.sourceKind !== 'companies_xml'
  const el = new Map<string, Candidate>()
  const gasIds = new Set<string>()
  for (const actor of input.actors) {
    const edielId = normalizeEdielId(actor.edielId)
    if (!edielId) continue
    if (actor.market === 'GAS') { gasIds.add(edielId); continue }
    if (actor.market !== 'EL') continue
    const declared = actor.roles.filter(role => role !== 'other')
    const known = input.knownRoles?.get(edielId)
    const roles: ActorRegistryRole[] | null = !txt ? actor.roles : declared.length ? declared : known ? known as ActorRegistryRole[] : null
    el.set(edielId, { actor, edielId, name: cleanString(actor.name) ?? edielId, roles })
  }
  const isNetowner = (c: Candidate) => c.roles?.includes('grid_owner') === true
  const netowners = [...el.values()].filter(isNetowner)
  const byOrg = new Map<string, Candidate[]>()
  const byName = new Map<string, Candidate[]>()
  for (const c of el.values()) {
    const org = normalizeOrgNumber(c.actor.orgNumber)
    if (org) byOrg.set(org, [...(byOrg.get(org) ?? []), c])
    const key = nameKey(c.name)
    if (key) byName.set(key, [...(byName.get(key) ?? []), c])
  }

  const owners = input.gridOwners
  const heldIds = new Map<string, GridOwnerRow[]>()
  for (const g of owners) { const id = normalizeEdielId(g.ediel_id); if (id) heldIds.set(id, [...(heldIds.get(id) ?? []), g]) }
  const heldOrgs = new Set(owners.map(g => normalizeOrgNumber(g.org_number)).filter((v): v is string => Boolean(v)))
  const heldNames = new Map<string, GridOwnerRow[]>()
  for (const g of owners) { const key = nameKey(g.name); if (key) heldNames.set(key, [...(heldNames.get(key) ?? []), g]) }

  const updates: GridOwnerUpdate[] = [], creates: GridOwnerCreate[] = [], flags: GridOwnerFlag[] = []
  const unchanged: GridOwnerReconciliationPlan['unchanged'] = []
  const linkedIds = new Set<string>()
  const flag = (code: GridOwnerFlagCode, g: GridOwnerRow | null, name: string, edielId: string | null, detail?: Record<string, unknown>) => flags.push({ code, gridOwnerId: g?.id ?? null, name, edielId, ...(detail ? { detail } : {}) })

  function diff(g: GridOwnerRow, c: Candidate, matchedBy: GridOwnerUpdate['matchedBy']) {
    const patch: GridOwnerPatch = {}, before: GridOwnerPatch = {}
    const set = <K extends keyof GridOwnerPatch>(key: K, next: GridOwnerPatch[K]) => { patch[key] = next; before[key] = g[key] as GridOwnerPatch[K] }
    if (matchedBy !== 'ediel_id') set('ediel_id', c.edielId)
    if (g.name !== c.name) {
      set('name', c.name)
      if (nameKey(g.name) !== nameKey(c.name)) flag('registry_name_changed', g, cleanString(g.name) ?? g.name, c.edielId, { registryName: c.name })
    }
    const org = formatSwedishOrgNumber(c.actor.orgNumber)
    if (!txt && org) {
      const current = normalizeOrgNumber(g.org_number)
      if (!current) set('org_number', org)
      else if (current !== normalizeOrgNumber(org)) flag('org_number_conflict', g, c.name, c.edielId, { gridOwnerOrg: g.org_number, registryOrg: org })
    }
    const prodat = elRoute(c.actor, 'PRODAT'), utilts = elRoute(c.actor, 'UTILTS')
    if (prodat.ambiguous) flag('registry_prodat_route_ambiguous', g, c.name, c.edielId)
    else if (!prodat.route) flag('registry_without_prodat_route', g, c.name, c.edielId, { gridOwnerEmail: g.communication_email })
    else {
      const email = normalizeEmail(prodat.route.communicationAddress)
      if (normalizeEmail(g.communication_email) !== email) set('communication_email', email)
      const sub = cleanString(prodat.route.subaddress)
      if (!sameText(g.default_prodat_subaddress, sub)) set('default_prodat_subaddress', sub)
    }
    if (utilts.ambiguous) flag('registry_utilts_route_ambiguous', g, c.name, c.edielId)
    else if (utilts.route) {
      const sub = cleanString(utilts.route.subaddress)
      if (!sameText(g.default_utilts_subaddress, sub)) set('default_utilts_subaddress', sub)
    }
    const contactChanged = ['communication_email', 'default_prodat_subaddress', 'default_utilts_subaddress'].some(key => key in patch)
    if (contactChanged && g.verified_for_customer_flow) flag('verified_owner_contact_changed', g, c.name, c.edielId, { note: 'verified_for_customer_flow retained; route/contact change requires re-verification' })
    if (Object.keys(patch).length) updates.push({ gridOwnerId: g.id, name: c.name, edielId: c.edielId, matchedBy, before, patch })
    else unchanged.push({ gridOwnerId: g.id, name: c.name, edielId: c.edielId })
    linkedIds.add(c.edielId)
  }

  for (const g of owners) {
    // Tenant-private owners are respected for duplicate prevention only.
    if (g.company_id) continue
    const ownName = cleanString(g.name) ?? g.name
    const id = normalizeEdielId(g.ediel_id)
    if (id) {
      if ((heldIds.get(id)?.filter(row => !row.company_id).length ?? 0) > 1) { flag('duplicate_grid_owner_ediel_id', g, ownName, id); continue }
      const c = el.get(id)
      if (!c) { flag(gasIds.has(id) ? 'ediel_id_gas_market_only' : 'ediel_id_not_in_registry', g, ownName, id); linkedIds.add(id); continue }
      if (c.roles === null) { flag('role_unconfirmed_txt_source', g, ownName, id); linkedIds.add(id); continue }
      if (!isNetowner(c)) { flag('ediel_id_role_mismatch', g, ownName, id, { registryName: c.name, registryRoles: c.roles, registryRawRoles: (c.actor.raw as Record<string, unknown>).originalRoles ?? null }); linkedIds.add(id); continue }
      diff(g, c, 'ediel_id')
      continue
    }
    if (txt) { flag('no_registry_match', g, ownName, null, { reason: 'txt_source_never_links_without_roles_and_org_number' }); continue }
    const org = normalizeOrgNumber(g.org_number)
    const orgMatches = org ? (byOrg.get(org) ?? []).filter(isNetowner) : []
    const nameMatches = byName.get(nameKey(g.name) ?? '') ?? []
    const netNameMatches = nameMatches.filter(isNetowner)
    const pick = orgMatches.length === 1 ? { c: orgMatches[0], by: 'org_number' as const } : orgMatches.length === 0 && netNameMatches.length === 1 ? { c: netNameMatches[0], by: 'name_and_role' as const } : null
    if (orgMatches.length > 1 || (!pick && netNameMatches.length > 1)) { flag('name_match_ambiguous', g, ownName, null, { candidates: [...orgMatches, ...netNameMatches].map(c => c.edielId) }); continue }
    if (!pick) {
      if (nameMatches.length) flag('name_matches_non_grid_owner', g, ownName, null, { candidates: nameMatches.map(c => ({ edielId: c.edielId, roles: c.roles })) })
      else flag('no_registry_match', g, ownName, null)
      continue
    }
    if (heldIds.has(pick.c.edielId) || linkedIds.has(pick.c.edielId)) { flag('name_match_ediel_id_taken', g, ownName, pick.c.edielId); continue }
    // A second owner row with the same normalised name would make the link ambiguous.
    if ((heldNames.get(nameKey(g.name) ?? '')?.length ?? 0) > 1 && pick.by === 'name_and_role') { flag('name_match_ambiguous', g, ownName, pick.c.edielId, { reason: 'duplicate_grid_owner_name' }); continue }
    diff(g, pick.c, pick.by)
  }

  if (!txt) for (const c of netowners) {
    if (linkedIds.has(c.edielId) || heldIds.has(c.edielId)) continue
    const org = normalizeOrgNumber(c.actor.orgNumber)
    const collides = (org && heldOrgs.has(org)) || heldNames.has(nameKey(c.name) ?? '')
    if (collides) { flag('new_netowner_collides_with_existing', null, c.name, c.edielId, { orgNumber: org }); continue }
    const prodat = elRoute(c.actor, 'PRODAT'), utilts = elRoute(c.actor, 'UTILTS')
    const orgNumber = formatSwedishOrgNumber(c.actor.orgNumber)
    creates.push({ edielId: c.edielId, name: c.name, row: {
      name: c.name, ediel_id: c.edielId, owner_code: c.edielId, org_number: orgNumber, organization_number: orgNumber,
      communication_email: prodat.route ? normalizeEmail(prodat.route.communicationAddress) : null,
      default_prodat_subaddress: prodat.route ? cleanString(prodat.route.subaddress) : null,
      default_utilts_subaddress: utilts.route ? cleanString(utilts.route.subaddress) : null,
      is_active: true, lifecycle_status: 'active', country: 'SE', environment: 'production', source: 'ediel_registry_import',
      verified_for_customer_flow: false, manual_review_required: true,
      manual_review_reason: 'Skapad från ediel.se-aktörslistan (Netowner). Route, kontakt och certifikat kräver verifiering innan kundflöde.',
    } })
  }

  const body = { sourceKind: input.sourceKind, updates, creates, flags: flags.map(f => [f.code, f.gridOwnerId, f.edielId]) }
  return {
    sourceKind: input.sourceKind,
    counts: {
      gridOwnersSeen: owners.length, registryNetowners: netowners.length,
      matched: updates.length + unchanged.length, updated: updates.length, unchanged: unchanged.length,
      linked: updates.filter(u => u.matchedBy !== 'ediel_id').length, created: creates.length,
      flagged: new Set(flags.map(f => f.gridOwnerId ?? `new:${f.edielId}`)).size,
    },
    updates, creates, unchanged, flags,
    planSha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  }
}

export type GridOwnerPort = {
  listGridOwners(): Promise<GridOwnerRow[]>
  /** Compare-and-set: applies `patch` only while every `expected` column still holds its previous value. */
  updateGridOwner(id: string, expected: GridOwnerPatch, patch: GridOwnerPatch): Promise<boolean>
  insertGridOwner(row: GridOwnerInsert): Promise<{ id: string }>
}

export type GridOwnerApplyResult = { planSha256: string; updated: number; created: number; staleSkipped: string[]; createdIds: string[]; counts: GridOwnerReconciliationPlan['counts'] }

/** Re-plans against the current rows and applies only that plan. Re-running is a no-op. */
export async function applyGridOwnerReconciliation(input: {
  actors: ParsedActorRegistryActor[]; sourceKind: GridOwnerReconciliationPlan['sourceKind']; port: GridOwnerPort; knownRoles?: ReadonlyMap<string, readonly string[]>; expectedPlanSha256?: string | null
}): Promise<GridOwnerApplyResult> {
  const plan = planGridOwnerReconciliation({ actors: input.actors, sourceKind: input.sourceKind, gridOwners: await input.port.listGridOwners(), knownRoles: input.knownRoles })
  if (input.expectedPlanSha256 && input.expectedPlanSha256 !== plan.planSha256) throw new Error('grid_owner_reconciliation_plan_changed_since_preview')
  const staleSkipped: string[] = [], createdIds: string[] = []
  let updated = 0
  for (const update of plan.updates) {
    if (await input.port.updateGridOwner(update.gridOwnerId, update.before, update.patch)) updated += 1
    else staleSkipped.push(update.gridOwnerId)
  }
  for (const create of plan.creates) createdIds.push((await input.port.insertGridOwner(create.row)).id)
  return { planSha256: plan.planSha256, updated, created: createdIds.length, staleSkipped, createdIds, counts: plan.counts }
}
