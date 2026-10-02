import { tenantSelect } from '@/lib/supabase/tenantQuery'

export type BillingProfileRevision = {
  revision: number
  invoice_email: string | null
  billing_street: string | null
  billing_postal_code: string | null
  billing_city: string | null
  billing_country: string | null
  changed_fields: string[]
  recorded_at: string
}

const FIELD_LABELS: Record<string, string> = {
  created: 'Skapad',
  backfill: 'Utgångsläge',
  invoice_email: 'Faktura-e-post',
  billing_street: 'Gatuadress',
  billing_postal_code: 'Postnummer',
  billing_city: 'Ort',
  billing_country: 'Land',
}

export function billingFieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field
}

/** P3 revision history, newest first, read in the customer's own company. */
export async function listBillingProfileRevisions(companyId: string, customerId: string, limit = 25) {
  const { data, error } = await tenantSelect(
    companyId,
    'customer_billing_profile_revisions',
    'revision,invoice_email,billing_street,billing_postal_code,billing_city,billing_country,changed_fields,recorded_at',
  )
    .eq('customer_id', customerId)
    .order('revision', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as BillingProfileRevision[]
}
