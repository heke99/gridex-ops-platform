'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { AccountCompletionError, completeNativePortalAccount } from '@/lib/customer-portal/accountCompletion'

type CustomerCandidate = {
  id: string
  company_id: string | null
  customer_type: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  personal_number: string | null
  customer_number: string | null
  profile_revision: number | string
  contact_revision: number | string
}

type CustomerContactCandidate = {
  id: string
  company_id: string
  customer_id: string
  name: string | null
  email: string | null
  is_primary: boolean | null
}

type CustomerSiteCandidate = {
  id: string
  company_id: string
  customer_id: string
  facility_id: string | null
  site_name: string | null
  street: string | null
  postal_code: string | null
  city: string | null
  site_revision: number | string
  address_revision: number | string
}

type MeteringPointCandidate = {
  id: string
  site_id: string | null
  meter_point_id: string | null
  metering_point_id: string | null
  customer_site_id: string | null
  company_id: string | null
  customer_id: string | null
  updated_at: string
}

export type PortalClaimActionState = {
  ok: boolean
  message: string
}

const DEFAULT_ERROR = 'Kundkopplingen kunde inte verifieras. Kontrollera uppgifterna eller kontakta kundansvarig.'

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function normalizeLoose(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö]/gi, '')
}

function normalizeName(value: string | null | undefined): string {
  return normalizeLoose(value)
}

function personalNumberVariants(input: string): string[] {
  const digits = normalizeDigits(input)
  const variants = new Set<string>()

  if (input.trim()) variants.add(input.trim())
  if (digits) variants.add(digits)

  if (digits.length === 12) {
    variants.add(`${digits.slice(0, 8)}-${digits.slice(8)}`)
    variants.add(`${digits.slice(2, 8)}-${digits.slice(8)}`)
    variants.add(digits.slice(2))
  }

  if (digits.length === 10) {
    variants.add(`${digits.slice(0, 6)}-${digits.slice(6)}`)
    variants.add(`19${digits}`)
    variants.add(`20${digits}`)
  }

  return Array.from(variants).filter(Boolean)
}

function installationVariants(input: string): string[] {
  const raw = input.trim()
  const digits = normalizeDigits(raw)
  const normalized = raw.replace(/\s/g, '')
  return Array.from(new Set([raw, normalized, digits].filter(Boolean)))
}

function buildCustomerNames(customer: CustomerCandidate, contacts: CustomerContactCandidate[]): string[] {
  const names = new Set<string>()

  const firstLast = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
  if (firstLast) names.add(firstLast)
  if (customer.full_name?.trim()) names.add(customer.full_name.trim())
  if (customer.company_name?.trim()) names.add(customer.company_name.trim())

  for (const contact of contacts) {
    if (contact.name?.trim()) names.add(contact.name.trim())
  }

  return Array.from(names)
}

function namesMatch(params: {
  inputFirstName: string
  inputLastName: string
  inputFullName: string
  customer: CustomerCandidate
  contacts: CustomerContactCandidate[]
}): boolean {
  const inputFull = params.inputFullName || [params.inputFirstName, params.inputLastName].filter(Boolean).join(' ')
  const normalizedInput = normalizeName(inputFull)

  if (!normalizedInput || normalizedInput.length < 4) return false

  const candidateNames = buildCustomerNames(params.customer, params.contacts).map(normalizeName)

  if (candidateNames.some((candidate) => candidate === normalizedInput)) return true

  const first = normalizeName(params.inputFirstName)
  const last = normalizeName(params.inputLastName)

  if (first && last) {
    return candidateNames.some((candidate) => candidate.includes(first) && candidate.includes(last))
  }

  return false
}

function emailsMatch(params: {
  authEmail: string
  inputEmail: string
  customer: CustomerCandidate
  contacts: CustomerContactCandidate[]
}): boolean {
  const allowedEmails = new Set<string>()
  const customerEmail = normalizeEmail(params.customer.email)
  if (customerEmail) allowedEmails.add(customerEmail)

  for (const contact of params.contacts) {
    const email = normalizeEmail(contact.email)
    if (email) allowedEmails.add(email)
  }

  const authEmail = normalizeEmail(params.authEmail)
  const inputEmail = normalizeEmail(params.inputEmail)

  if (!authEmail || !allowedEmails.has(authEmail)) return false
  if (inputEmail && inputEmail !== authEmail) return false

  return true
}

function personalNumbersMatch(input: string, customer: CustomerCandidate): boolean {
  const inputDigits = normalizeDigits(input)
  const customerDigits = normalizeDigits(customer.personal_number)

  if (!inputDigits || !customerDigits) return false

  if (inputDigits === customerDigits) return true
  if (inputDigits.length === 12 && customerDigits.length === 10) return inputDigits.slice(2) === customerDigits
  if (inputDigits.length === 10 && customerDigits.length === 12) return inputDigits === customerDigits.slice(2)

  return false
}

type InstallationMatch = {
  ok: boolean
  site: CustomerSiteCandidate | null
  meteringPoint: MeteringPointCandidate | null
}

async function findMatchingInstallations(params: {
  customers: CustomerCandidate[]
  installationId: string
}): Promise<Map<string, InstallationMatch>> {
  const variants = installationVariants(params.installationId)
  const customerIds = params.customers.map((customer) => customer.id)
  const companyIds = params.customers
    .map((customer) => customer.company_id)
    .filter((companyId): companyId is string => Boolean(companyId))
  const empty = new Map(
    customerIds.map((customerId) => [
      customerId,
      { ok: false, site: null, meteringPoint: null } satisfies InstallationMatch,
    ]),
  )
  if (variants.length === 0 || customerIds.length === 0 || companyIds.length === 0) return empty

  const { data: sites, error: siteError } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,facility_id,site_name,street,postal_code,city,site_revision,address_revision')
    .in('customer_id', customerIds)
    .in('company_id', companyIds)

  if (siteError) throw siteError
  const siteRows = (sites ?? []) as CustomerSiteCandidate[]
  const siteIds = siteRows.map((row) => row.id)
  if (siteIds.length === 0) return empty

  const { data: points, error: pointError } = await supabaseService
    .from('metering_points')
    .select('id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,updated_at')
    .in('site_id', siteIds)
    .in('meter_point_id', variants)
    .limit(1)

  if (pointError) throw pointError
  const pointsBySiteId = new Map(
    ((points ?? []) as MeteringPointCandidate[])
      .filter((point) => point.site_id)
      .map((point) => [String(point.site_id), point]),
  )
  const matches = new Map<string, InstallationMatch>()
  for (const customer of params.customers) {
    const customerSites = siteRows.filter(
      (site) => site.customer_id === customer.id && site.company_id === customer.company_id,
    )
    const facilitySite = customerSites.find((site) =>
      variants.includes(String(site.facility_id ?? '').trim()),
    )
    if (facilitySite) {
      matches.set(customer.id, { ok: true, site: facilitySite, meteringPoint: null })
      continue
    }
    const meteringPoint = customerSites
      .map((site) => pointsBySiteId.get(site.id))
      .find((point): point is MeteringPointCandidate => Boolean(point)) ?? null
    const owningSite = meteringPoint
      ? customerSites.find((site) => site.id === meteringPoint.site_id) ?? null
      : null
    matches.set(customer.id, {
      ok: Boolean(meteringPoint && owningSite),
      site: owningSite,
      meteringPoint,
    })
  }
  return matches
}

async function insertClaim(params: {
  userId: string
  userEmail: string | null
  companyId?: string | null
  customerId?: string | null
  status: 'approved' | 'rejected'
  personalNumber: string
  inputSnapshot: Record<string, unknown>
  matchSnapshot: Record<string, unknown>
  flags: {
    emailMatched: boolean
    nameMatched: boolean
    personalNumberMatched: boolean
    installationMatched: boolean
  }
  matchedSiteId?: string | null
  matchedMeteringPointId?: string | null
  failureReason?: string | null
}) {
  const personalDigits = normalizeDigits(params.personalNumber)

  const { error } = await supabaseService.from('customer_portal_claims').insert({
    user_id: params.userId,
    company_id: params.companyId ?? null,
    user_email: params.userEmail,
    customer_id: params.customerId ?? null,
    status: params.status,
    match_method: 'self_claim_strict_identity',
    personal_number_last4: personalDigits ? personalDigits.slice(-4) : null,
    email_matched: params.flags.emailMatched,
    name_matched: params.flags.nameMatched,
    personal_number_matched: params.flags.personalNumberMatched,
    installation_matched: params.flags.installationMatched,
    matched_site_id: params.matchedSiteId ?? null,
    matched_metering_point_id: params.matchedMeteringPointId ?? null,
    failure_reason: params.failureReason ?? null,
    input_snapshot: params.inputSnapshot,
    match_snapshot: params.matchSnapshot,
    reviewed_at: params.status === 'approved' ? new Date().toISOString() : null,
  })

  if (error) throw error
}

export async function claimPortalCustomerAction(
  _prevState: PortalClaimActionState,
  formData: FormData
): Promise<PortalClaimActionState> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect('/login')

  const authEmail = normalizeEmail(user.email)
  const inputEmail = normalizeEmail(text(formData.get('email')))
  const personalNumber = text(formData.get('personal_number'))
  const firstName = text(formData.get('first_name'))
  const lastName = text(formData.get('last_name'))
  const fullName = text(formData.get('full_name'))
  const installationId = text(formData.get('installation_id'))
  const companySlug = text(formData.get('company_slug')).toLowerCase()

  const inputSnapshot = {
    email: inputEmail || authEmail,
    firstName,
    lastName,
    fullName,
    personalNumberLast4: normalizeDigits(personalNumber).slice(-4) || null,
    installationId,
    companySlug: companySlug || null,
  }

  if (!authEmail || !personalNumber || !installationId || (!fullName && (!firstName || !lastName))) {
    return {
      ok: false,
      message: 'Fyll i personnummer, namn och anläggnings-ID. Du måste också vara inloggad med kundens e-postadress.',
    }
  }

  // Tenant scoping: when the customer arrives via a tenant-specific link
  // (?bolag=<slug>) the candidate lookup is restricted to that company so a
  // personnummer can never match another tenant's customer register.
  let scopedCompanyId: string | null = null
  if (companySlug) {
    const { data: company, error: companyError } = await supabaseService
      .from('companies')
      .select('id')
      .eq('slug', companySlug)
      .maybeSingle()

    if (companyError) throw companyError
    if (!company) return { ok: false, message: DEFAULT_ERROR }
    scopedCompanyId = String((company as { id: string }).id)
  }

  const pnVariants = personalNumberVariants(personalNumber)

  let candidateQuery = supabaseService
    .from('customers')
    .select('id,company_id,customer_type,first_name,last_name,full_name,company_name,email,personal_number,customer_number,profile_revision,contact_revision')
    .in('personal_number', pnVariants)
    .limit(10)

  if (scopedCompanyId) candidateQuery = candidateQuery.eq('company_id', scopedCompanyId)

  const { data: candidates, error: candidateError } = await candidateQuery

  if (candidateError) throw candidateError

  const rows = (candidates ?? []) as CustomerCandidate[]

  if (rows.length === 0) {
    await insertClaim({
      userId: user.id,
      userEmail: authEmail,
      status: 'rejected',
      personalNumber,
      inputSnapshot,
      matchSnapshot: { reason: 'no_customer_with_personal_number' },
      flags: {
        emailMatched: false,
        nameMatched: false,
        personalNumberMatched: false,
        installationMatched: false,
      },
      failureReason: 'Inget kundkort matchade angivet personnummer.',
    })

    return { ok: false, message: DEFAULT_ERROR }
  }

  type CandidateEvaluation = {
    customer: CustomerCandidate
    emailMatched: boolean
    nameMatched: boolean
    personalNumberMatched: boolean
    installationMatch: InstallationMatch
    matchSnapshot: Record<string, unknown>
  }

  // Evaluate every candidate before linking so that a personnummer that exists
  // in several tenants (or duplicated within one tenant) can never be linked to
  // an arbitrary first row. Linking requires exactly one full match.
  const evaluations: CandidateEvaluation[] = []

  const candidateIds = rows.map((customer) => customer.id)
  const candidateCompanyIds = rows
    .map((customer) => customer.company_id)
    .filter((companyId): companyId is string => Boolean(companyId))
  const { data: contactsData, error: contactsError } = await supabaseService
    .from('customer_contacts')
    .select('id,company_id,customer_id,name,email,is_primary')
    .in('customer_id', candidateIds)
    .in('company_id', candidateCompanyIds)
  if (contactsError) throw contactsError
  const contactsByCustomerId = new Map<string, CustomerContactCandidate[]>()
  for (const contact of (contactsData ?? []) as CustomerContactCandidate[]) {
    const contacts = contactsByCustomerId.get(contact.customer_id) ?? []
    contacts.push(contact)
    contactsByCustomerId.set(contact.customer_id, contacts)
  }
  const installationMatches = await findMatchingInstallations({
    customers: rows,
    installationId,
  })

  for (const customer of rows) {
    const contacts = (contactsByCustomerId.get(customer.id) ?? []).filter(
      (contact) => contact.company_id === customer.company_id,
    )

    const emailMatched = emailsMatch({
      authEmail,
      inputEmail,
      customer,
      contacts,
    })
    const nameMatched = namesMatch({
      inputFirstName: firstName,
      inputLastName: lastName,
      inputFullName: fullName,
      customer,
      contacts,
    })
    const personalNumberMatched = personalNumbersMatch(personalNumber, customer)
    const installationMatch = installationMatches.get(customer.id) ?? {
      ok: false,
      site: null,
      meteringPoint: null,
    }

    evaluations.push({
      customer,
      emailMatched,
      nameMatched,
      personalNumberMatched,
      installationMatch,
      matchSnapshot: {
        customerId: customer.id,
        customerNumber: customer.customer_number,
        emailMatched,
        nameMatched,
        personalNumberMatched,
        installationMatched: installationMatch.ok,
        matchedSiteId: installationMatch.site?.id ?? null,
        matchedMeteringPointId: installationMatch.meteringPoint?.id ?? null,
      },
    })
  }

  const fullMatches = evaluations.filter(
    (evaluation) =>
      evaluation.emailMatched &&
      evaluation.nameMatched &&
      evaluation.personalNumberMatched &&
      evaluation.installationMatch.ok
  )

  if (fullMatches.length > 1) {
    for (const evaluation of fullMatches) {
      await insertClaim({
        userId: user.id,
        userEmail: authEmail,
        companyId: evaluation.customer.company_id,
        customerId: evaluation.customer.id,
        status: 'rejected',
        personalNumber,
        inputSnapshot,
        matchSnapshot: evaluation.matchSnapshot,
        flags: {
          emailMatched: evaluation.emailMatched,
          nameMatched: evaluation.nameMatched,
          personalNumberMatched: evaluation.personalNumberMatched,
          installationMatched: evaluation.installationMatch.ok,
        },
        matchedSiteId: evaluation.installationMatch.site?.id ?? null,
        matchedMeteringPointId: evaluation.installationMatch.meteringPoint?.id ?? null,
        failureReason: 'Flera kundkort matchade alla säkerhetsvillkor. Kopplingen kräver manuell hantering.',
      })
    }

    return { ok: false, message: DEFAULT_ERROR }
  }

  if (fullMatches.length === 1) {
    const { customer, installationMatch } = fullMatches[0]
    const site = installationMatch.site, point = installationMatch.meteringPoint
    if (!customer.company_id || !site) return { ok: false, message: DEFAULT_ERROR }
    const contacts = (contactsByCustomerId.get(customer.id) ?? []).filter(contact => contact.company_id === customer.company_id)
    try {
      await completeNativePortalAccount({
        companyId: customer.company_id, customerId: customer.id, expectedUserId: user.id, authEmail,
        input: { email: inputEmail, personalNumber, firstName, lastName, fullName, installationId, companySlug },
        source: {
          customer: { id: customer.id, companyId: customer.company_id, customerType: customer.customer_type,
            firstName: customer.first_name, lastName: customer.last_name, fullName: customer.full_name,
            companyName: customer.company_name, email: customer.email, personalNumber: customer.personal_number,
            customerNumber: customer.customer_number, profileRevision: String(customer.profile_revision), contactRevision: String(customer.contact_revision) },
          contacts: contacts.map(contact => ({ id: contact.id, companyId: contact.company_id, customerId: contact.customer_id,
            name: contact.name, email: contact.email })).sort((a, b) => a.id.localeCompare(b.id)),
          site: { id: site.id, companyId: site.company_id, customerId: site.customer_id, facilityId: site.facility_id,
            siteRevision: String(site.site_revision), addressRevision: String(site.address_revision) },
          point: point ? { id: point.id, companyId: point.company_id, customerId: point.customer_id, siteId: point.site_id,
            customerSiteId: point.customer_site_id, meterPointId: point.meter_point_id, meteringPointId: point.metering_point_id, updatedAt: point.updated_at } : null,
        },
      })
    } catch (error) {
      unstable_rethrow(error)
      if (!(error instanceof AccountCompletionError)) throw error
      return { ok: false, message: DEFAULT_ERROR }
    }
    // A refresh failure cannot erase a confirmed saved/current relationship.
    // Preserve actual Next control-flow errors and the mounted redirect.
    for (const path of ['/portal', '/portal/fakturor', '/portal/forbrukning', '/portal/anlaggningar']) {
      try { revalidatePath(path) } catch (error) { unstable_rethrow(error) }
    }
    redirect('/portal?kopplad=1')
  }

  for (const evaluation of evaluations) {
    await insertClaim({
      userId: user.id,
      userEmail: authEmail,
      companyId: evaluation.customer.company_id,
      customerId: evaluation.customer.id,
      status: 'rejected',
      personalNumber,
      inputSnapshot,
      matchSnapshot: evaluation.matchSnapshot,
      flags: {
        emailMatched: evaluation.emailMatched,
        nameMatched: evaluation.nameMatched,
        personalNumberMatched: evaluation.personalNumberMatched,
        installationMatched: evaluation.installationMatch.ok,
      },
      matchedSiteId: evaluation.installationMatch.site?.id ?? null,
      matchedMeteringPointId: evaluation.installationMatch.meteringPoint?.id ?? null,
      failureReason: 'Ett eller flera säkerhetsvillkor matchade inte.',
    })
  }

  return { ok: false, message: DEFAULT_ERROR }
}
