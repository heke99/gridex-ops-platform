import { supabaseService } from '@/lib/supabase/service'

function missingNumberSchema(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') ||
        /canonical_next_customer_number|canonical_next_contract_number|canonical_next_application_number|does not exist|schema cache|function .* not found/i.test(maybe.message ?? ''))
  )
}

export async function reserveCustomerNumber(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.rpc('canonical_next_customer_number', {
    p_company_id: companyId,
  })

  if (error) {
    if (missingNumberSchema(error)) {
      throw new Error('Kundnummer-funktionen saknas. Kör Batch 7A-migrationen innan website onboarding används.')
    }
    throw error
  }

  const customerNumber = typeof data === 'string' ? data.trim() : ''
  if (!customerNumber) throw new Error('Kundnummer kunde inte reserveras.')
  return customerNumber
}

export async function ensureCustomerNumber(input: {
  companyId: string
  customerId: string
  existingCustomerNumber?: string | null
}): Promise<string> {
  if (input.existingCustomerNumber?.trim()) return input.existingCustomerNumber.trim()

  const customerNumber = await reserveCustomerNumber(input.companyId)
  const { data, error } = await supabaseService
    .from('customers')
    .update({ customer_number: customerNumber, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .is('customer_number', null)
    .select('customer_number')
    .maybeSingle()

  if (error) throw error
  if (data?.customer_number) return String(data.customer_number)

  // The conditional update matched no row: another writer (or the DB insert
  // trigger) already assigned a number. The persisted value is the truth —
  // never return the unused reservation.
  const current = await supabaseService
    .from('customers')
    .select('customer_number')
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (current.error) throw current.error
  const persisted = typeof current.data?.customer_number === 'string' ? current.data.customer_number.trim() : ''
  if (persisted) return persisted
  throw new Error('Kundnummer reserverades men sparades inte på kunden. Registreringen måste rullas tillbaka.')
}

/**
 * Compatibility name retained for older call sites. Customer numbers are now
 * mandatory and fail closed: a missing migration or unpersisted number must
 * abort the intake instead of committing a customer without a permanent id.
 */
export async function ensureCustomerNumberIfSupported(input: {
  companyId: string
  customerId: string
  existingCustomerNumber?: string | null
}): Promise<string> {
  return ensureCustomerNumber(input)
}

export async function reserveContractNumber(input: {
  companyId: string
  customerNumber?: string | null
}): Promise<string> {
  const { data, error } = await supabaseService.rpc('canonical_next_contract_number', {
    p_company_id: input.companyId,
    p_customer_number: input.customerNumber ?? null,
  })

  if (error) {
    if (missingNumberSchema(error)) {
      throw new Error('Avtalsnummer-funktionen saknas. Kör canonical multi-tenant-migrationen innan avtal skapas.')
    }
    throw error
  }

  const contractNumber = typeof data === 'string' ? data.trim() : ''
  if (!contractNumber) throw new Error('Avtalsnummer kunde inte reserveras.')
  return contractNumber
}

export async function reserveApplicationNumber(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.rpc('canonical_next_application_number', {
    p_company_id: companyId,
  })

  if (error) {
    if (missingNumberSchema(error)) {
      throw new Error('Ansökningsnummer-funktionen saknas. Kör canonical multi-tenant-migrationen innan ansökningar tas emot.')
    }
    throw error
  }

  const applicationNumber = typeof data === 'string' ? data.trim() : ''
  if (!applicationNumber) throw new Error('Ansökningsnummer kunde inte reserveras.')
  return applicationNumber
}
