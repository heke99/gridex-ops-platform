'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'

type CustomerCandidate = {
  id: string
  customer_type: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  personal_number: string | null
  customer_number: string | null
}

type CustomerContactCandidate = {
  id: string
  customer_id: string
  name: string | null
  email: string | null
  is_primary: boolean | null
}

type CustomerSiteCandidate = {
  id: string
  customer_id: string
  facility_id: string | null
  site_name: string | null
  street: string | null
  postal_code: string | null
  city: string | null
}

type MeteringPointCandidate = {
  id: string
  site_id: string | null
  meter_point_id: string | null
}

export type PortalClaimActionState = {
  ok: boolean
  message: string
}

const DEFAULT_ERROR = 'Kundkopplingen kunde inte verifieras. Kontrollera uppgifterna eller kontakta kundservice.'

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

async function findMatchingInstallation(params: {
  customerId: string
  installationId: string
}): Promise<{
  ok: boolean
  site: CustomerSiteCandidate | null
  meteringPoint: MeteringPointCandidate | null
}> {
  const variants = installationVariants(params.installationId)
  if (variants.length === 0) return { ok: false, site: null, meteringPoint: null }

  const { data: sites, error: siteError } = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,facility_id,site_name,street,postal_code,city')
    .eq('customer_id', params.customerId)
    .in('facility_id', variants)
    .limit(1)

  if (siteError) throw siteError

  const site = ((sites ?? []) as CustomerSiteCandidate[])[0] ?? null
  if (site) return { ok: true, site, meteringPoint: null }

  const { data: allSites, error: allSitesError } = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,facility_id,site_name,street,postal_code,city')
    .eq('customer_id', params.customerId)

  if (allSitesError) throw allSitesError

  const siteRows = (allSites ?? []) as CustomerSiteCandidate[]
  const siteIds = siteRows.map((row) => row.id)
  if (siteIds.length === 0) return { ok: false, site: null, meteringPoint: null }

  const { data: points, error: pointError } = await supabaseService
    .from('metering_points')
    .select('id,site_id,meter_point_id')
    .in('site_id', siteIds)
    .in('meter_point_id', variants)
    .limit(1)

  if (pointError) throw pointError

  const meteringPoint = ((points ?? []) as MeteringPointCandidate[])[0] ?? null
  if (!meteringPoint) return { ok: false, site: null, meteringPoint: null }

  const owningSite = siteRows.find((row) => row.id === meteringPoint.site_id) ?? null
  return { ok: true, site: owningSite, meteringPoint }
}

async function insertClaim(params: {
  userId: string
  userEmail: string | null
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

async function insertPortalEvent(params: {
  customerId: string
  userId: string
  userEmail: string | null
  eventType: string
  message: string
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('customer_portal_events').insert({
    customer_id: params.customerId,
    user_id: params.userId,
    event_type: params.eventType,
    message: params.message,
    metadata: params.metadata ?? {},
  })

  // Do not block account linking if an older environment lacks event columns/table shape.
  if (error && error.code !== '42P01' && error.code !== '42703') throw error
}

export async function claimPortalCustomerAction(
  _prevState: PortalClaimActionState,
  formData: FormData
): Promise<PortalClaimActionState> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const authEmail = normalizeEmail(user.email)
  const inputEmail = normalizeEmail(text(formData.get('email')))
  const personalNumber = text(formData.get('personal_number'))
  const firstName = text(formData.get('first_name'))
  const lastName = text(formData.get('last_name'))
  const fullName = text(formData.get('full_name'))
  const installationId = text(formData.get('installation_id'))

  const inputSnapshot = {
    email: inputEmail || authEmail,
    firstName,
    lastName,
    fullName,
    personalNumberLast4: normalizeDigits(personalNumber).slice(-4) || null,
    installationId,
  }

  if (!authEmail || !personalNumber || !installationId || (!fullName && (!firstName || !lastName))) {
    return {
      ok: false,
      message: 'Fyll i personnummer, namn och anläggnings-ID. Du måste också vara inloggad med kundens e-postadress.',
    }
  }

  const pnVariants = personalNumberVariants(personalNumber)

  const { data: candidates, error: candidateError } = await supabaseService
    .from('customers')
    .select('id,customer_type,first_name,last_name,full_name,company_name,email,personal_number,customer_number')
    .in('personal_number', pnVariants)
    .limit(5)

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

  for (const customer of rows) {
    const { data: contactsData, error: contactsError } = await supabaseService
      .from('customer_contacts')
      .select('id,customer_id,name,email,is_primary')
      .eq('customer_id', customer.id)

    if (contactsError) throw contactsError

    const contacts = (contactsData ?? []) as CustomerContactCandidate[]

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
    const installationMatch = await findMatchingInstallation({
      customerId: customer.id,
      installationId,
    })

    const matchSnapshot = {
      customerId: customer.id,
      customerNumber: customer.customer_number,
      emailMatched,
      nameMatched,
      personalNumberMatched,
      installationMatched: installationMatch.ok,
      matchedSiteId: installationMatch.site?.id ?? null,
      matchedMeteringPointId: installationMatch.meteringPoint?.id ?? null,
    }

    if (emailMatched && nameMatched && personalNumberMatched && installationMatch.ok) {
      const now = new Date().toISOString()

      const { error: accountError } = await supabaseService
        .from('customer_portal_accounts')
        .upsert(
          {
            user_id: user.id,
            user_email: authEmail,
            customer_id: customer.id,
            role: 'owner',
            is_active: true,
            activated_at: now,
            verified_at: now,
            match_method: 'self_claim_strict_identity',
            verified_identity_snapshot: {
              ...matchSnapshot,
              userEmail: authEmail,
              personalNumberLast4: normalizeDigits(personalNumber).slice(-4),
              inputName: fullName || [firstName, lastName].filter(Boolean).join(' '),
              inputInstallationId: installationId,
            },
            updated_at: now,
          },
          { onConflict: 'user_id,customer_id' }
        )

      if (accountError) throw accountError

      await insertClaim({
        userId: user.id,
        userEmail: authEmail,
        customerId: customer.id,
        status: 'approved',
        personalNumber,
        inputSnapshot,
        matchSnapshot,
        flags: {
          emailMatched,
          nameMatched,
          personalNumberMatched,
          installationMatched: installationMatch.ok,
        },
        matchedSiteId: installationMatch.site?.id ?? null,
        matchedMeteringPointId: installationMatch.meteringPoint?.id ?? null,
      })

      await insertPortalEvent({
        customerId: customer.id,
        userId: user.id,
        userEmail: authEmail,
        eventType: 'portal_account_verified',
        message: 'Kundportal kopplades automatiskt via personnummer, e-post, namn och anläggnings-ID.',
        metadata: matchSnapshot,
      })

      revalidatePath('/portal')
      revalidatePath('/portal/fakturor')
      revalidatePath('/portal/forbrukning')
      revalidatePath('/portal/anlaggningar')
      redirect('/portal?kopplad=1')
    }

    await insertClaim({
      userId: user.id,
      userEmail: authEmail,
      customerId: customer.id,
      status: 'rejected',
      personalNumber,
      inputSnapshot,
      matchSnapshot,
      flags: {
        emailMatched,
        nameMatched,
        personalNumberMatched,
        installationMatched: installationMatch.ok,
      },
      matchedSiteId: installationMatch.site?.id ?? null,
      matchedMeteringPointId: installationMatch.meteringPoint?.id ?? null,
      failureReason: 'Ett eller flera säkerhetsvillkor matchade inte.',
    })
  }

  return { ok: false, message: DEFAULT_ERROR }
}
