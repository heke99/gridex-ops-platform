import type { ManualSenderVerification } from '@/lib/inbound-mail/manualSenderVerification'
import { supabaseService } from '@/lib/supabase/service'
import { findCustomersByIdentifierValues } from '@/lib/customers/matchingService'
import { extractManualCustomerIdentityHints, manualCustomerIdentityMatches } from '@/lib/inbound-mail/manualCustomerIdentity'
import { findCurrentSupplierManualContact, isManualSupplierInformationRequest } from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { findRequestByCaseReference, findRequestByOutboundReferences, findSitesByFacility, resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'
import { MANUAL_MAIL_DOCUMENT_LIMITS } from '@/lib/inbound-mail/manualMailDocumentParser'

type Row = Record<string, unknown>
export type ManualDocumentRoutingUnit = { attachmentId: string; sha256: string; origin: string; locator: string; text: string }
export type ManualDocumentRoutingInput = {
  email: { fromEmail?: string | null; mailboxCompanyId?: string | null; inReplyTo?: string | null; references?: string[] | null; threadId?: string | null }
  caseReference: string | null
  authoredText: string
  units: ManualDocumentRoutingUnit[]
}
export type ManualDocumentRoutingResult = {
  resolutionStatus: 'matched' | 'ambiguous' | 'unmatched' | 'ignored'
  companyId: string | null; customerId: string | null; requestId: string | null; request: Row | null
  sites: Array<{ customerSiteId: string | null; facilityId: string | null; units: ManualDocumentRoutingUnit[]; bodyText?: string }>
  reasons: string[]; evidence: Row; senderCredible: boolean
}

const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const emailAddress = (value: unknown): string | null => clean(value)?.toLowerCase() ?? null
const unique = <T>(values: T[]): T[] => [...new Set(values)]
const escapeLike = (value: string): string => value.replace(/([\\%_])/g, '\\$1')
const OPEN_STATUSES = ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review', 'ready_to_send_manual_email']
const LIMIT = 100
const CUSTOMER_SELECT = 'id,company_id,personal_number,org_number,normalized_personal_number,normalized_org_number,customer_number,status'
const customerKey = (row: Row): string => `${String(row.company_id)}:${String(row.customer_id ?? row.id)}`
const active = (row: Row): boolean => row.is_active !== false && !['deleted', 'archived', 'anonymized', 'inactive', 'cancelled'].includes(String(row.status ?? ''))

function dateValid(value: unknown, lower: boolean, today: string): boolean {
  if (value == null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && (lower ? value <= today : value >= today)
}

type SenderRegistry = { gridContacts: Row[]; actorContacts: Row[]; gridOwners: Row[]; actors: Row[]; roles: Row[] }

/** Registry eligibility permits bounded reading only. It never selects a tenant. */
async function senderRegistry(from: string | null): Promise<SenderRegistry> {
  const empty: SenderRegistry = { gridContacts: [], actorContacts: [], gridOwners: [], actors: [], roles: [] }
  if (!from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) return empty
  const [gridResult, contactResult] = await Promise.all([
    supabaseService.from('grid_owner_contact_channels').select('*').eq('is_enabled', true).eq('is_verified', true).ilike('email', escapeLike(from)).limit(LIMIT + 1),
    supabaseService.from('platform_actor_contacts').select('*').eq('channel', 'email').eq('is_verified', true).ilike('email', escapeLike(from)).limit(LIMIT + 1),
  ])
  if (gridResult.error) throw gridResult.error
  if (contactResult.error) throw contactResult.error
  if ((gridResult.data?.length ?? 0) > LIMIT || (contactResult.data?.length ?? 0) > LIMIT) return empty
  const verified = (row: Row) => emailAddress(row.email) === from && row.is_verified === true && Boolean(clean(row.verified_at)) && Number.isFinite(Date.parse(String(row.verified_at)))
  const gridContacts = ((gridResult.data ?? []) as Row[]).filter(row => verified(row) && row.is_enabled === true)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const actorContacts = ((contactResult.data ?? []) as Row[]).filter(row => verified(row) && row.channel === 'email'
    && ['poa', 'customer_service', 'switching', 'general'].includes(String(row.contact_type))
    && dateValid(row.valid_from, true, today) && dateValid(row.valid_to, false, today))
  const ownerIds = unique(gridContacts.map(row => clean(row.grid_owner_id)).filter((id): id is string => Boolean(id)))
  const ownerResult = ownerIds.length ? await supabaseService.from('grid_owners').select('id,company_id,is_active,platform_market_actor_id').in('id', ownerIds).eq('is_active', true).limit(LIMIT + 1) : { data: [], error: null }
  if (ownerResult.error) throw ownerResult.error
  const gridOwners = (ownerResult.data ?? []) as Row[]
  const actorIds = unique([...gridOwners.map(row => clean(row.platform_market_actor_id)), ...actorContacts.map(row => clean(row.actor_id))].filter((id): id is string => Boolean(id)))
  if (!actorIds.length) return empty
  const [actorsResult, rolesResult] = await Promise.all([
    supabaseService.from('platform_market_actors').select('id,status,match_status,org_number').in('id', actorIds).eq('status', 'active').eq('match_status', 'verified').limit(LIMIT + 1),
    supabaseService.from('platform_actor_roles').select('actor_id,actor_role,is_active').in('actor_id', actorIds).eq('is_active', true).in('actor_role', ['grid_owner', 'electricity_supplier', 'supplier']).limit(LIMIT * 3 + 1),
  ])
  if (actorsResult.error) throw actorsResult.error
  if (rolesResult.error) throw rolesResult.error
  const actors = (actorsResult.data ?? []) as Row[], roles = (rolesResult.data ?? []) as Row[]
  const actorHasRole = (id: unknown, allowed: string[]) => actors.some(actor => actor.id === id)
    && roles.some(role => role.actor_id === id && role.is_active === true && allowed.includes(String(role.actor_role)))
  const eligibleOwners = gridOwners.filter(owner => actorHasRole(owner.platform_market_actor_id, ['grid_owner']))
  return { gridContacts: gridContacts.filter(contact => eligibleOwners.some(owner => owner.id === contact.grid_owner_id)),
    actorContacts: actorContacts.filter(contact => actorHasRole(contact.actor_id, ['grid_owner', 'electricity_supplier', 'supplier'])),
    gridOwners: eligibleOwners, actors, roles }
}

export async function isVerifiedManualDocumentSender(input: { fromEmail: string | null | undefined; senderVerification?: ManualSenderVerification | null }): Promise<boolean> {
  const from = emailAddress(input.fromEmail), proof = input.senderVerification
  if (!from || proof?.version !== 1 || proof.status !== 'verified' || proof.method !== 'dkim'
    || emailAddress(proof.from_email) !== from || proof.signing_domain !== from.slice(from.lastIndexOf('@') + 1)
    || !/^[a-f0-9]{64}$/.test(proof.raw_sha256) || !Array.isArray(proof.signed_headers) || !proof.signed_headers.includes('from')) return false
  const registry = await senderRegistry(from)
  return registry.gridContacts.length > 0 || registry.actorContacts.length > 0
}

type Identifier = { kind: 'personal_number' | 'org_number' | 'customer_identity_number' | 'customer_number' | 'facility_id' | 'metering_point_id' | 'case_reference'; value: string }
type Source = { unit: ManualDocumentRoutingUnit | null; text: string; identifiers: Identifier[]; senderOrganizations: string[] }
const SIGN_OFF = /^\s*(?:med v[aä]nliga h[aä]lsningar|v[aä]nliga h[aä]lsningar|mvh|best regards)[,.!]?\s*$/i
const SPREADSHEET_HEADER = /^(?:kund(?:nummer|namn)?|personnummer|organisationsnummer|anläggnings[- ]?(?:id|nummer)|mätpunkts?[- ]?(?:id|nummer)|avtalsslut|tidigaste start|brytavgift|uppsägningstid|bindningstid|villkor|förbehåll|kommentar|årsenergi|nätområde|elområde|nuvarande elhandelsföretag|mätmetod|rapporteringsfrekvens)\s*:?$/i

function senderOrganizations(registry: SenderRegistry): Set<string> {
  const actorIds = new Set([...registry.gridOwners.map(owner => owner.platform_market_actor_id), ...registry.actorContacts.map(contact => contact.actor_id)])
  return new Set(registry.actors.filter(actor => actorIds.has(actor.id)).map(actor => clean(actor.org_number)?.replace(/[ \t-]/g, ''))
    .filter((value): value is string => Boolean(value && /^\d{10}$/.test(value))))
}

function personalNumberShape(value: string): boolean {
  if (!/^(?:\d{10}|(?:18|19|20)\d{10})$/.test(value)) return false
  const date = value.slice(0, -4), month = Number(date.slice(-4, -2))
  let day = Number(date.slice(-2))
  if (day > 60) day -= 60
  const years = date.length === 8 ? [Number(date.slice(0, 4))] : [1800, 1900, 2000].map(century => century + Number(date.slice(0, 2)))
  return years.some(year => {
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  })
}

function identifiers(text: string, senderOrgs: Set<string>): { values: Identifier[]; reasons: string[]; senderOrganizations: string[]; phoneLikeIdentities: string[] } {
  const values: Identifier[] = [], reasons: string[] = [], organizations: string[] = [], phoneLikeIdentities: string[] = []
  let inSignature = false
  for (const reference of text.matchAll(/\bGX-FIR-[A-F0-9]{8,32}\b/gi)) values.push({ kind: 'case_reference', value: reference[0].toUpperCase() })
  // Preserve each occurrence; distinct identifier roles can identify the same
  // canonical customer. Never infer identity from arbitrary numbers or names.
  for (const line of text.split(/\r?\n/)) {
    let unscoped = line.replace(/\bGX-FIR-[A-F0-9]{8,32}\b/gi, value => ' '.repeat(value.length))
    const cover = (start: number, length: number) => { unscoped = unscoped.slice(0, start) + ' '.repeat(length) + unscoped.slice(start + length) }
    if (SIGN_OFF.test(line)) inSignature = true
    const identityLabels = [...line.matchAll(/(?:^|[\s;])((?:kundens\s+)?(?:person\s*-?\s*(?:\/|eller)\s*organisationsnummer|person(?:nummer|nr\.?)|organisationsnummer|org\.?\s*(?:nr|nummer)\.?))\s*(?::|#|är\b)\s*/gi)]
    for (let index = 0; index < identityLabels.length; index++) {
      const label = identityLabels[index]
      const valueText = line.slice(label.index! + label[0].length, identityLabels[index + 1]?.index ?? line.length)
      const found = extractManualCustomerIdentityHints(`${label[1]}: ${valueText}`)
      reasons.push(...found.reasons)
      if (Object.values(found.hints).some(Boolean)) {
        const raw = /^[\d][\d \t+\-]*\d/.exec(valueText)
        if (raw) cover(label.index! + label[0].length, raw[0].length)
      }
      for (const [kind, value] of Object.entries(found.hints)) if (value) {
        // A verified sender's own organisation in an explicit sign-off is a
        // sender identifier. Keep the complete source for semantic checks.
        if (inSignature && kind === 'org_number' && !/^kundens\b/i.test(label[1]) && senderOrgs.has(value)) organizations.push(value)
        else values.push({ kind: kind as Identifier['kind'], value })
      }
    }
    const number = /^\s*(?:kundnummer\s+hos\s+(?:oss|gridex)|gridex(?:s)?\s+kundnummer|v[åa]rt\s+kundnummer)\s*[:#-]\s*([A-Z0-9-]{4,32})\b/i.exec(line)
    if (number) {
      values.push({ kind: 'customer_number', value: number[1].toUpperCase() })
      cover(number.index + number[0].length - number[1].length, number[1].length)
    }
    // An explicitly provider-owned account number is not our customer key.
    // Cover only that value, so another unscoped K-number on the same line
    // still requires review and all business conditions remain in the source.
    for (const providerNumber of line.matchAll(/\b(?:(?:kundnummer|kundnr)\s+hos\s+(?:nätägaren|elnätsföretaget|(?:nuvarande\s+)?(?:elhandelsföretag(?:et)?|leverantör(?:en)?))|(?:nätägarens|elnätsföretagets|elhandelsföretagets|leverantörens)\s+(?:kundnummer|kundnr))\s*[:#-]\s*([A-Z0-9-]{4,32})\b/gi)) {
      cover(providerNumber.index! + providerNumber[0].length - providerNumber[1].length, providerNumber[1].length)
    }
    const labels: Array<[Identifier['kind'], RegExp]> = [
      ['facility_id', /(?:anl[aä]ggnings[- ]?(?:id|nummer|numret)|facility[- _]?(?:id|number)|gsrn)\s*[:#-]?\s*([\d][\d \t-]*\d)/gi],
      ['metering_point_id', /(?:m[aä]tpunkts?[- ]?(?:id|nummer|numret)|metering[- _]?point[- _]?(?:id|number))\s*[:#-]?\s*([\d][\d \t-]*\d)/gi],
    ]
    for (const [kind, pattern] of labels) for (const match of line.matchAll(pattern)) {
      const value = match[1].replace(/\D/g, '')
      if (!/^\d{18}$/.test(value)) reasons.push(`${kind}_invalid`)
      else {
        values.push({ kind, value })
        cover(match.index! + match[0].length - match[1].length, match[1].length)
      }
    }
    // A phone label supplies a non-customer role. Do not let a greedy phone
    // match hide a second number: an oversized numeric run stays unscoped.
    for (const phone of line.matchAll(/\b(?:tel(?:efon)?\.?|phone|mobil(?:telefon)?|mobile)\s*:?\s*(\+?\d[\d \t()-]*\d)/gi)) {
      const value = phone[1].replace(/[^\d+]/g, '')
      if (/^(?:0\d{6,12}|\+[1-9]\d{6,14})$/.test(value)) cover(phone.index! + phone[0].length - phone[1].length, phone[1].length)
    }
    for (const token of unscoped.matchAll(/\d(?:[\d \t+\-]*\d)?/g)) {
      const value = token[0].replace(/\D/g, '')
      if (value.length >= 18 || /^\d{10}$/.test(value) && /^[1-9]\d[2-9]\d{7}$/.test(value)) reasons.push('document_identifier_role_unresolved')
      else if (personalNumberShape(value)) {
        if (/^0\d{9}$/.test(value) && !/^\s*(?:pnr|kund|kundens\s+(?:personnummer|identitet))\s*[:#]/i.test(line)) phoneLikeIdentities.push(value)
        else reasons.push('document_identifier_role_unresolved')
      }
    }
    if (/\bK\d{4,32}\b/i.test(unscoped)) reasons.push('document_identifier_role_unresolved')
  }
  return { values: [...new Map(values.map(value => [`${value.kind}:${value.value}`, value])).values()], reasons: unique(reasons), senderOrganizations: unique(organizations), phoneLikeIdentities: unique(phoneLikeIdentities) }
}

function customerWideContext(source: Source): boolean {
  const text = source.text.trim()
  if (!text) return true
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.every(line => /^(?:hej[,!.]?|tack(?: på förhand)?[,!.]?|se (?:bilagan|bilagorna|bifoga(?:t|de?)(?:\s+(?:svar|uppgifter|dokument))?)[!.]?)$/i.test(line))) return true
  // Only an actual first spreadsheet row containing labels alone is shared.
  // Retain it in every site's source catalogue; values remain in their own rows.
  const headerCells = text.split(/[\t\n]/).map(cell => cell.trim()).filter(Boolean)
  if (source.unit?.origin === 'spreadsheet' && /^.+![A-Z]{1,3}1:[A-Z]{1,3}1(?::paragraph:0)?$/.test(source.unit.locator)
    && headerCells.length >= 2 && headerCells.every(cell => SPREADSHEET_HEADER.test(cell))) return true
  if (!source.identifiers.length && source.senderOrganizations.length && SIGN_OFF.test(lines[0])
    && !/bindning|uppsägning|avtal|start|avgift|villkor|förbehåll|endast|förutsatt|preliminär|undantag|bekräft|gäller|anläggning|mätpunkt|årsenergi|nätområde|elområde|contract|terminat|cancell|provisional|conditional|penalty|earliest|subject to|unless|only if|\b(?:om|måste|först|inte|ej|kan|fee|supplier|facility|meter)\b/i.test(text)
    && lines.slice(1).every(line => {
      const org = /^(?:organisationsnummer|org\.?\s*(?:nr|nummer)\.?)\s*:\s*([\d \t-]+)$/.exec(line.toLowerCase())
      if (org) return source.senderOrganizations.includes(org[1].replace(/[ \t-]/g, ''))
      return /^(?:kundservice|kundsupport|support)(?:[ \t]+[\p{L}\p{N} &'.,/-]+)?$/iu.test(line)
        || /^[\p{L}\p{N} &'.,/-]+\s(?:AB|AS|A\/S)$/u.test(line)
        || /^(?:(?:e-?post|email)\s*:\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i.test(line)
        || /^(?:(?:tel(?:efon)?|phone)\s*:\s*)?[+()\d][+()\d \t-]{5,30}$/i.test(line)
        || /^(?:https?:\/\/|www\.)[^\s]+$/i.test(line)
    })) return true
  const identityOnly = source.identifiers.some(value => ['personal_number', 'org_number', 'customer_identity_number', 'customer_number'].includes(value.kind))
    && lines.every(line => /^(?:(?:kundens\s+)?(?:person\s*-?\s*(?:\/|eller)\s*organisationsnummer|person(?:nummer|nr\.?)|organisationsnummer|org\.?\s*(?:nr|nummer)\.?)\s*[:#]\s*[\d \t+.-]+|(?:kundnummer\s+hos\s+(?:oss|gridex)|gridex(?:s)?\s+kundnummer|v[åa]rt\s+kundnummer)\s*[:#]\s*[A-Z0-9-]+|(?:kund|kundnamn|namn|adress|postnummer|ort)\s*:\s*[^;]+)$/i.test(line)
      && !/bindning|uppsägning|avtals|start|avgift|villkor|endast|förutsatt|\b(?:om|måste|först|inte|ej)\b/i.test(line))
  if (identityOnly) return true
  return /\b(?:samtliga|alla)\s+(?:kundens\s+)?anläggningar\b/i.test(text)
    && !/\b(?:om|inte|ej|endast|förutsatt|villkor|måste|först)\b/i.test(text)
}

function identityVariants(identifier: Identifier): string[] {
  const value = identifier.value
  return identifier.kind !== 'org_number' && identifier.kind !== 'customer_number' && value.length === 10
    ? [value, `18${value}`, `19${value}`, `20${value}`] : [value]
}

async function findIdentifierCustomers(identifier: Identifier): Promise<Row[] | null> {
  const columns = identifier.kind === 'personal_number' ? ['normalized_personal_number', 'personal_number']
    : identifier.kind === 'org_number' ? ['normalized_org_number', 'org_number']
      : identifier.kind === 'customer_number' ? ['customer_number'] : ['normalized_personal_number', 'personal_number', 'normalized_org_number', 'org_number']
  const rows = await findCustomersByIdentifierValues({ values: identityVariants(identifier), columns, select: CUSTOMER_SELECT, limit: LIMIT + 1 })
  if (rows.length > LIMIT) return null
  return rows.filter(row => active(row) && Boolean(clean(row.company_id)) && (identifier.kind === 'customer_number'
    ? clean(row.customer_number)?.toUpperCase() === identifier.value
    : manualCustomerIdentityMatches({ [identifier.kind]: identifier.value }, row)))
}

async function readSite(companyId: string, siteId: string): Promise<Row | null> {
  const result = await supabaseService.from('customer_sites').select('*').eq('company_id', companyId).eq('id', siteId).maybeSingle()
  if (result.error) throw result.error
  return result.data as Row | null
}

async function credibleParty(request: Row, site: Row, registry: SenderRegistry, from: string | null): Promise<boolean> {
  if (!from || request.company_id !== site.company_id || request.customer_id !== site.customer_id
    || !active(site) || site.protected_identity === true) return false
  if (isManualSupplierInformationRequest(request)) {
    const metadata = request.metadata as Row | null
    if (!metadata || !clean(metadata.supplier_id) || !clean(metadata.supplier_actor_id) || !clean(metadata.supplier_contact_id)) return false
    const contact = await findCurrentSupplierManualContact({ companyId: String(site.company_id), customerId: String(site.customer_id), siteId: String(site.id),
      expectedSupplierId: String(metadata.supplier_id), expectedActorId: String(metadata.supplier_actor_id), expectedContactId: String(metadata.supplier_contact_id) })
    return Boolean(contact && emailAddress(contact.email) === from && emailAddress(request.recipient_email) === from)
  }
  return Boolean(request.grid_owner_id && request.grid_owner_id === site.grid_owner_id && registry.gridContacts.some(contact =>
    contact.grid_owner_id === request.grid_owner_id && (contact.company_id == null || contact.company_id === request.company_id)
    && registry.gridOwners.some(owner => owner.id === contact.grid_owner_id && (owner.company_id == null || owner.company_id === request.company_id))))
}

async function credibleRequest(request: Row, site: Row, registry: SenderRegistry, from: string | null): Promise<boolean> {
  return request.customer_site_id === site.id && await credibleParty(request, site, registry, from)
}

function noMatch(reasons: string[], evidence: Row, ambiguous = false): ManualDocumentRoutingResult {
  return { resolutionStatus: ambiguous ? 'ambiguous' : 'unmatched', companyId: null, customerId: null, requestId: null, request: null,
    sites: [], reasons: unique(reasons), evidence, senderCredible: false }
}

/** Discovery only: all canonical ownership comes from server queries. Neither
 * OCR/AI identifiers nor headers are accepted as tenant/customer authority. */
export async function resolveManualDocumentRouting(input: ManualDocumentRoutingInput): Promise<ManualDocumentRoutingResult> {
  const evidence: Row = { routing_version: 1 }
  if (input.units.length > MANUAL_MAIL_DOCUMENT_LIMITS.units || input.authoredText.length > MANUAL_MAIL_DOCUMENT_LIMITS.characters
    || input.units.some(unit => !clean(unit.attachmentId) || !/^[a-f0-9]{64}$/.test(unit.sha256) || !clean(unit.origin) || !clean(unit.locator) || typeof unit.text !== 'string' || unit.text.length > MANUAL_MAIL_DOCUMENT_LIMITS.unitCharacters)
    || input.units.reduce((size, unit) => size + unit.text.length, input.authoredText.length) > MANUAL_MAIL_DOCUMENT_LIMITS.characters) return noMatch(['document_routing_input_invalid_or_excessive'], evidence)
  const [registry, caseMatch, replyMatch] = await Promise.all([
    senderRegistry(emailAddress(input.email.fromEmail)),
    input.caseReference ? findRequestByCaseReference(input.caseReference) : Promise.resolve({ request: null, ambiguous: false }),
    findRequestByOutboundReferences(unique([input.email.inReplyTo, input.email.threadId, ...(input.email.references ?? [])].filter((value): value is string => Boolean(clean(value))).flatMap(value => [value, value.replace(/^<|>$/g, '').toLowerCase()])).slice(0, 40)),
  ])
  const senderOrgs = senderOrganizations(registry)
  const sourceTexts = [...input.authoredText.split(/\r?\n[ \t]*\r?\n+/).filter(text => text.trim()).map(text => ({ unit: null, text })), ...input.units.map(unit => ({ unit, text: unit.text }))]
  const sources: Source[] = [], reasons: string[] = [], signatureOrganizations: string[] = [], phoneLikeIdentities: string[] = []
  for (const source of sourceTexts) {
    const parsed = identifiers(source.text, senderOrgs)
    reasons.push(...parsed.reasons)
    signatureOrganizations.push(...parsed.senderOrganizations)
    phoneLikeIdentities.push(...parsed.phoneLikeIdentities)
    sources.push({ unit: source.unit, text: source.text, identifiers: parsed.values, senderOrganizations: parsed.senderOrganizations })
  }
  evidence.sender_organization_numbers = unique(signatureOrganizations)
  evidence.body_identifiers = sources.filter(source => !source.unit).flatMap(source => source.identifiers)
  evidence.document_identifiers = sources.filter(source => source.unit).map(source => ({ attachmentId: source.unit!.attachmentId, sha256: source.unit!.sha256,
    origin: source.unit!.origin, locator: source.unit!.locator, identifiers: source.identifiers }))
  if (reasons.length) return noMatch(reasons, evidence, true)
  const phoneCandidates = unique(phoneLikeIdentities)
  if (phoneCandidates.length > 10) return noMatch(['document_identifier_limit'], evidence, true)
  if (phoneCandidates.length) {
    // A bare Swedish phone can share the shape of a short PNR. Its presence
    // alone does not require review, but canonical identity collisions do.
    // This inventory can only quarantine; it never establishes an owner.
    const values = phoneCandidates.flatMap(value => [value, `18${value}`, `19${value}`, `20${value}`])
    const result = await supabaseService.from('customers').select('id,company_id').or(values.flatMap(value =>
      ['normalized_personal_number', 'personal_number'].map(column => `${column}.eq.${value}`)).join(',')).limit(1)
    if (result.error) throw result.error
    if (result.data?.length) return noMatch(['document_identifier_role_unresolved'], evidence, true)
  }
  const allIdentifiers = [...new Map(sources.flatMap(source => source.identifiers).map(identifier => [`${identifier.kind}:${identifier.value}`, identifier])).values()]
  if (allIdentifiers.length > LIMIT) return noMatch(['document_identifier_limit'], evidence, true)
  const headerRequests = [...new Map([caseMatch.request, replyMatch.request].filter((row): row is Row => Boolean(row)).map(row => [String(row.id), row])).values()]
  evidence.header_request_ids = headerRequests.map(row => row.id)
  if (!allIdentifiers.length) {
    if (sources.some(source => /\b(?:kundnummer|kundnr|customer\s*(?:number|no))[^\n:]{0,30}[:#]\s*[A-Z0-9+-]{4,32}/i.test(source.text))) return noMatch(['document_customer_number_unscoped'], evidence)
    const correlation = await resolveManualInboundCorrelation({ email: input.email, caseReference: input.caseReference, normalizedText: input.authoredText, extracted: {} })
    if (correlation.resolutionStatus !== 'matched' || !correlation.request || !correlation.companyId || !correlation.customerId || !correlation.customerSiteId) return noMatch(['document_customer_unresolved'], evidence, correlation.resolutionStatus === 'ambiguous')
    const site = await readSite(correlation.companyId, correlation.customerSiteId)
    if (!site || !await credibleRequest(correlation.request, site, registry, emailAddress(input.email.fromEmail))) return noMatch(['document_sender_not_credible'], evidence)
    return { resolutionStatus: 'matched', companyId: correlation.companyId, customerId: correlation.customerId, requestId: correlation.requestId, request: correlation.request,
      sites: [{ customerSiteId: correlation.customerSiteId, facilityId: clean(site.facility_id), units: input.units, bodyText: input.authoredText }], reasons: [], evidence, senderCredible: true }
  }
  const customers = new Map<string, Row>(), sitesByIdentifier = new Map<string, Row[]>(), customerSets: Set<string>[] = []
  const bodyRequests: Row[] = []
  let canonicalSiteIdentityFound = false
  let headerResolvedSite: Row | null = null
  for (const identifier of allIdentifiers) {
    const identifierKey = `${identifier.kind}:${identifier.value}`
    if (identifier.kind === 'case_reference') {
      const match = await findRequestByCaseReference(identifier.value)
      if (match.ambiguous) return noMatch(['document_case_ambiguous'], evidence, true)
      if (!match.request?.company_id || !match.request.customer_id || !match.request.customer_site_id) return noMatch(['document_case_unresolved'], evidence)
      const site = await readSite(String(match.request.company_id), String(match.request.customer_site_id))
      if (!site || site.customer_id !== match.request.customer_id || !active(site)) return noMatch(['document_case_ownership_conflict'], evidence, true)
      bodyRequests.push(match.request)
      sitesByIdentifier.set(identifierKey, [site])
      customerSets.push(new Set([customerKey(site)]))
    } else if (identifier.kind === 'facility_id' || identifier.kind === 'metering_point_id') {
      let sites: Row[]
      if (identifier.kind === 'facility_id') sites = await findSitesByFacility(identifier.value, LIMIT + 1)
      else {
        const pointResult = await supabaseService.from('metering_points').select('*')
          .or(['meter_point_id', 'metering_point_id', 'ediel_reference', 'ediel_metering_point_id'].map(column => `${column}.eq.${identifier.value}`).join(',')).limit(LIMIT + 1)
        if (pointResult.error) throw pointResult.error
        const points = (pointResult.data ?? []) as Row[]
        canonicalSiteIdentityFound ||= points.length > 0
        if (points.length > LIMIT) return noMatch(['document_site_candidate_limit'], evidence, true)
        const activePoints = points.filter(active)
        if (activePoints.some(point => point.site_id && point.customer_site_id && point.site_id !== point.customer_site_id)) return noMatch(['document_metering_ownership_conflict'], evidence, true)
        const loaded = await Promise.all(activePoints.map(point => point.company_id && (point.customer_site_id ?? point.site_id)
          ? readSite(String(point.company_id), String(point.customer_site_id ?? point.site_id)) : null))
        sites = loaded.filter((site): site is Row => Boolean(site))
        if (activePoints.some((point, index) => !loaded[index] || loaded[index]!.customer_id !== point.customer_id || loaded[index]!.company_id !== point.company_id)) return noMatch(['document_metering_ownership_conflict'], evidence, true)
      }
      if (sites.length > LIMIT) return noMatch(['document_site_candidate_limit'], evidence, true)
      canonicalSiteIdentityFound ||= sites.length > 0
      sites = sites.filter(site => active(site) && Boolean(clean(site.company_id)) && Boolean(clean(site.customer_id)))
      sitesByIdentifier.set(identifierKey, sites)
      if (sites.length) customerSets.push(new Set(sites.map(customerKey)))
    } else {
      const matches = await findIdentifierCustomers(identifier)
      if (!matches) return noMatch(['document_customer_candidate_limit'], evidence, true)
      if (!matches.length) return noMatch(['document_customer_identity_unresolved'], evidence)
      matches.forEach(row => customers.set(customerKey(row), row))
      customerSets.push(new Set(matches.map(customerKey)))
    }
  }
  if (!customerSets.length) {
    // A normal first lookup reply supplies the previously unknown facility,
    // without repeating the customer's identity. Only its unique current,
    // registry-verified request may establish the canonical customer here.
    // Any already resolved typed ownership above keeps precedence over headers.
    if (canonicalSiteIdentityFound || caseMatch.ambiguous || replyMatch.ambiguous) return noMatch(['document_customer_unresolved'], evidence, caseMatch.ambiguous || replyMatch.ambiguous)
    const verifiedHeaders: Array<{ request: Row; site: Row; customer: Row }> = []
    for (const request of headerRequests) {
      const companyId = clean(request.company_id), customerId = clean(request.customer_id), siteId = clean(request.customer_site_id)
      if (!companyId || !customerId || !siteId || !OPEN_STATUSES.includes(String(request.status))
        || input.email.mailboxCompanyId && input.email.mailboxCompanyId !== companyId) continue
      const site = await readSite(companyId, siteId)
      if (!site || !await credibleRequest(request, site, registry, emailAddress(input.email.fromEmail))) continue
      const customerResult = await supabaseService.from('customers').select(CUSTOMER_SELECT).eq('company_id', companyId).eq('id', customerId).maybeSingle()
      if (customerResult.error) throw customerResult.error
      const customer = customerResult.data as Row | null
      if (customer && active(customer)) verifiedHeaders.push({ request, site, customer })
    }
    if (verifiedHeaders.length !== 1) return noMatch(['document_customer_unresolved'], evidence, verifiedHeaders.length > 1)
    const header = verifiedHeaders[0]
    headerResolvedSite = header.site
    const key = customerKey(header.customer)
    customers.set(key, header.customer)
    customerSets.push(new Set([key]))
    evidence.customer_resolution_method = 'unique_verified_header_request'
    evidence.customer_request_id = header.request.id
  }
  const candidates = [...customerSets[0]].filter(key => customerSets.every(set => set.has(key)))
  evidence.customer_candidate_keys = candidates
  if (candidates.length !== 1) return noMatch([candidates.length ? 'document_customer_ambiguous' : 'document_customer_conflict'], evidence, true)
  const [companyId, customerId] = candidates[0].split(':')
  if (input.email.mailboxCompanyId && input.email.mailboxCompanyId !== companyId) return noMatch(['document_mailbox_tenant_conflict'], evidence, true)
  if (!customers.has(candidates[0])) {
    const customerResult = await supabaseService.from('customers').select(CUSTOMER_SELECT).eq('company_id', companyId).eq('id', customerId).maybeSingle()
    if (customerResult.error) throw customerResult.error
    if (!customerResult.data || !active(customerResult.data as Row)) return noMatch(['document_customer_unavailable'], evidence)
    customers.set(candidates[0], customerResult.data as Row)
  }
  const requestResult = await supabaseService.from('grid_owner_information_requests').select('*').eq('company_id', companyId).eq('customer_id', customerId).in('status', OPEN_STATUSES).limit(LIMIT + 1)
  if (requestResult.error) throw requestResult.error
  if ((requestResult.data?.length ?? 0) > LIMIT) return noMatch(['document_request_candidate_limit'], evidence, true)
  const requests = (requestResult.data ?? []) as Row[]
  for (const header of headerRequests) if (header.company_id === companyId && header.customer_id === customerId && !requests.some(row => row.id === header.id)) requests.push(header)
  const targetSites = new Map<string, Row>()
  for (const rows of sitesByIdentifier.values()) for (const site of rows) if (customerKey(site) === candidates[0]) targetSites.set(String(site.id), site)
  if (!targetSites.size && headerResolvedSite) targetSites.set(String(headerResolvedSite.id), headerResolvedSite)
  if (!targetSites.size) for (const row of requests) {
    if (!clean(row.customer_site_id)) continue
    const site = await readSite(companyId, String(row.customer_site_id))
    if (site && site.customer_id === customerId && active(site)) targetSites.set(String(site.id), site)
  }
  const verifiedParents: Row[] = []
  const parentCandidates = bodyRequests.length ? bodyRequests : headerRequests
  for (const row of parentCandidates) {
    if (row.company_id !== companyId || row.customer_id !== customerId || !OPEN_STATUSES.includes(String(row.status)) || !clean(row.customer_site_id)) continue
    const site = await readSite(companyId, String(row.customer_site_id))
    if (site && await credibleRequest(row, site, registry, emailAddress(input.email.fromEmail))) verifiedParents.push(row)
  }
  const parentRequest = verifiedParents.length === 1 ? verifiedParents[0] : null
  const scoped: Array<{ site: Row; request: Row | null }> = []
  let usesParent = false
  for (const site of targetSites.values()) {
    const establishedFacilities = unique([clean(site.facility_id), clean(site.normalized_facility_id)].filter((id): id is string => Boolean(id)))
    if (establishedFacilities.length > 1) return noMatch(['document_canonical_facility_conflict'], evidence, true)
    const eligible: Row[] = []
    const explicit = bodyRequests.filter(row => row.customer_site_id === site.id)
    const siteRequests = explicit.length ? explicit : requests.filter(row => row.customer_site_id === site.id)
    for (const row of siteRequests) if (await credibleRequest(row, site, registry, emailAddress(input.email.fromEmail))) eligible.push(row)
    if (eligible.length > 1) return noMatch(['document_request_ambiguous'], evidence, true)
    if (eligible.length === 1) scoped.push({ site, request: eligible[0] })
    else if (!siteRequests.length && parentRequest && await credibleParty(parentRequest, site, registry, emailAddress(input.email.fromEmail))) {
      // Routing establishes canonical ownership and the current source party
      // only. The atomic batch command must validate this site's own POA and
      // documents before creating a received-only request or applying facts.
      scoped.push({ site, request: null })
      usesParent = true
    }
  }
  if (!scoped.length || scoped.length !== targetSites.size) return noMatch(['document_request_or_sender_unresolved'], evidence)
  if (usesParent && scoped.some(value => value.request && isManualSupplierInformationRequest(value.request) !== isManualSupplierInformationRequest(parentRequest!))) return noMatch(['document_parent_request_kind_conflict'], evidence, true)
  const hasSiteIdentifier = allIdentifiers.some(identifier => ['facility_id', 'metering_point_id', 'case_reference'].includes(identifier.kind))
  if (!hasSiteIdentifier && scoped.length > 1) return noMatch(['document_site_ambiguous'], evidence, true)
  const groups: ManualDocumentRoutingResult['sites'] = scoped.map(({ site }) => ({ customerSiteId: String(site.id), facilityId: clean(site.facility_id) ?? clean(site.normalized_facility_id), units: [] }))
  for (const source of sources) {
    const siteIds = new Set(source.identifiers.filter(identifier => ['facility_id', 'metering_point_id', 'case_reference'].includes(identifier.kind))
      .flatMap(identifier => (sitesByIdentifier.get(`${identifier.kind}:${identifier.value}`) ?? []).filter(site => customerKey(site) === candidates[0]).map(site => String(site.id))))
    const unknownFacilities = source.identifiers.filter(identifier => identifier.kind === 'facility_id' && !sitesByIdentifier.get(`facility_id:${identifier.value}`)?.length)
    if (unknownFacilities.length) {
      if (groups.length !== 1 || unknownFacilities.length !== 1 || groups[0].facilityId && groups[0].facilityId !== unknownFacilities[0].value) return noMatch(['document_facility_conflict'], evidence, true)
      groups[0].facilityId = unknownFacilities[0].value
      siteIds.add(groups[0].customerSiteId!)
    }
    const unknownMeters = source.identifiers.filter(identifier => identifier.kind === 'metering_point_id' && !sitesByIdentifier.get(`metering_point_id:${identifier.value}`)?.length)
    if (unknownMeters.length) {
      if (groups.length !== 1 || unknownMeters.length !== 1) return noMatch(['document_metering_scope_ambiguous'], evidence, true)
      const pointResult = await supabaseService.from('metering_points').select('*').eq('company_id', companyId).eq('customer_id', customerId)
        .or(`site_id.eq.${groups[0].customerSiteId},customer_site_id.eq.${groups[0].customerSiteId}`).limit(LIMIT + 1)
      if (pointResult.error) throw pointResult.error
      const points = ((pointResult.data ?? []) as Row[]).filter(active)
      const known = unique(points.flatMap(point => ['meter_point_id', 'metering_point_id', 'ediel_reference', 'ediel_metering_point_id'].map(column => clean(point[column]))).filter((id): id is string => Boolean(id)))
      if (points.length > LIMIT || known.length && !known.includes(unknownMeters[0].value)) return noMatch(['document_metering_conflict'], evidence, true)
      siteIds.add(groups[0].customerSiteId!)
    }
    if (siteIds.size > 1) return noMatch(['document_site_scope_ambiguous'], evidence, true)
    if (!siteIds.size && groups.length !== 1 && !customerWideContext(source)) return noMatch(['document_unit_site_unresolved'], evidence, true)
    const sourceGroups = groups.filter(value => !siteIds.size || siteIds.has(value.customerSiteId!))
    if (!sourceGroups.length) return noMatch(['document_unit_site_unresolved'], evidence, true)
    for (const group of sourceGroups) {
      if (source.unit) group.units.push(source.unit)
      else group.bodyText = [group.bodyText, source.text].filter(Boolean).join('\n\n')
    }
  }
  evidence.site_requests = scoped.map(({ site, request }) => ({ customerSiteId: site.id, requestId: request?.id ?? null,
    ...(!request && parentRequest ? { parentRequestId: parentRequest.id } : {}) }))
  if (usesParent) evidence.parent_request_id = parentRequest!.id
  evidence.site_body_text = Object.fromEntries(groups.map(group => [group.customerSiteId!, group.bodyText ?? '']))
  evidence.stale_request_ids = headerRequests.filter(row => row.company_id !== companyId || row.customer_id !== customerId || !(usesParent && parentRequest?.id === row.id) && !scoped.some(value => value.request?.id === row.id)).map(row => row.id)
  const oneRequest = usesParent ? parentRequest : scoped.length === 1 ? scoped[0].request : null
  return { resolutionStatus: 'matched', companyId, customerId, requestId: oneRequest ? String(oneRequest.id) : null, request: oneRequest,
    sites: groups, reasons: [], evidence, senderCredible: true }
}
