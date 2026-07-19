import { supabaseService } from '@/lib/supabase/service'

function missingNumberSchema(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') ||
        /gridex_next_customer_number|gridex_next_contract_number|gridex_next_application_number|does not exist|schema cache|function .* not found/i.test(maybe.message ?? ''))
  )
}

export async function reserveCustomerNumber(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.rpc('gridex_next_customer_number', {
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
  return customerNumber
}

/**
 * Best-effort canonical customer-number assignment for intake paths that must
 * keep working against databases where the canonical number schema has not
 * been migrated yet (admin intake, /teckna-avtal external intake, Ediel
 * inbound approval). On migrated databases the BEFORE INSERT trigger already
 * assigns numbers, so this only fills matched existing customers that predate
 * the backfill. Returns null when the generator is missing instead of
 * failing the whole intake; every other error is thrown.
 */
export async function ensureCustomerNumberIfSupported(input: {
  companyId: string
  customerId: string
  existingCustomerNumber?: string | null
}): Promise<string | null> {
  if (input.existingCustomerNumber?.trim()) return input.existingCustomerNumber.trim()
  try {
    return await ensureCustomerNumber(input)
  } catch (error) {
    if (
      missingNumberSchema(error) ||
      /Kundnummer-funktionen saknas/.test((error as { message?: string } | null)?.message ?? '')
    ) {
      console.warn(
        '[customer-numbers] gridex_next_customer_number saknas – kundnummer kan inte reserveras förrän migrationen 20260719120000 har körts.',
      )
      return null
    }
    throw error
  }
}

export async function reserveContractNumber(input: {
  companyId: string
  customerNumber?: string | null
}): Promise<string> {
  const { data, error } = await supabaseService.rpc('gridex_next_contract_number', {
    p_company_id: input.companyId,
    p_customer_number: input.customerNumber ?? null,
  })

  if (error) {
    if (missingNumberSchema(error)) {
      const suffix = Date.now().toString().slice(-8)
      const base = input.customerNumber?.trim() || 'KUND'
      return `AVT-${base}-${suffix}`
    }
    throw error
  }

  const contractNumber = typeof data === 'string' ? data.trim() : ''
  if (!contractNumber) throw new Error('Avtalsnummer kunde inte reserveras.')
  return contractNumber
}

export async function reserveApplicationNumber(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.rpc('gridex_next_application_number', {
    p_company_id: companyId,
  })

  if (error) {
    if (missingNumberSchema(error)) {
      return `APP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString().slice(-6)}`
    }
    throw error
  }

  const applicationNumber = typeof data === 'string' ? data.trim() : ''
  if (!applicationNumber) throw new Error('Ansökningsnummer kunde inte reserveras.')
  return applicationNumber
}
