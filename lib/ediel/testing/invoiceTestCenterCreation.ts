import { supabaseService } from '@/lib/supabase/service'
import { INVOICE_TEST_CUSTOMER_SOURCE } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type Row = Record<string, unknown>

const INVOICE_TEST_SITE_GENERATION_PREFIX = 'Fakturatest-anläggning · generation '

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function operationGeneration(row: Row): number | null {
  const command = objectValue(row.command_snapshot)
  const site = objectValue(command.site)
  const siteName = text(site.site_name)
  if (!siteName?.startsWith(INVOICE_TEST_SITE_GENERATION_PREFIX)) return null
  const parsed = Number(siteName.slice(INVOICE_TEST_SITE_GENERATION_PREFIX.length))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function getInvoiceTestOnboardingGeneration(companyId: string): Promise<number> {
  const [archivedResult, operationsResult] = await Promise.all([
    supabaseService
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('source', INVOICE_TEST_CUSTOMER_SOURCE)
      .eq('is_test_data', true)
      .not('archived_at', 'is', null),
    supabaseService
      .from('customer_onboarding_operations')
      .select('command_snapshot,result_snapshot,status,created_at')
      .eq('company_id', companyId)
      .eq('channel', 'admin')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  if (archivedResult.error) throw archivedResult.error
  if (operationsResult.error) throw operationsResult.error

  const archivedCount = archivedResult.count ?? 0
  const invoiceTestOperations = ((operationsResult.data ?? []) as Row[])
    .map((row) => ({ row, generation: operationGeneration(row) }))
    .filter((entry): entry is { row: Row; generation: number } => entry.generation !== null)
    .sort((a, b) => b.generation - a.generation)

  const latest = invoiceTestOperations[0]
  if (!latest) return archivedCount

  const latestResult = objectValue(latest.row.result_snapshot)
  const latestCustomerId = text(latestResult.customer_id)
  if (!latestCustomerId) return Math.max(archivedCount, latest.generation)

  const customerResult = await supabaseService
    .from('customers')
    .select('id,archived_at')
    .eq('company_id', companyId)
    .eq('id', latestCustomerId)
    .maybeSingle()
  if (customerResult.error) throw customerResult.error

  // A live graph means a retry should reuse the same generation/idempotency key.
  // A missing or archived graph means the previous completed operation is only
  // historical evidence and must never be replayed into a .single() hydration.
  if (customerResult.data && !text((customerResult.data as Row).archived_at)) {
    return Math.max(archivedCount, latest.generation - 1)
  }
  return Math.max(archivedCount, latest.generation)
}

export async function resolveSingleInvoiceTestContractId(input: {
  companyId: string
  customerId: string
}): Promise<string> {
  const result = await supabaseService
    .from('customer_contracts')
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(2)
  if (result.error) throw result.error
  const rows = result.data ?? []
  if (rows.length !== 1 || !rows[0]?.id) {
    throw new Error('Fakturatest blockerad: den nya testkunden måste ha exakt ett canonical avtal.')
  }
  if (!['draft', 'pending_signature', 'signed', 'active'].includes(String(rows[0].status))) {
    throw new Error('Fakturatest blockerad: testkundens canonical avtal har en ogiltig skapandestatus.')
  }
  return String(rows[0].id)
}
