import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'

/**
 * Invoice providers a tenant can send approved invoices through. The database catalog
 * (invoice_provider_catalog) decides which are selectable; this registry decides which have a
 * dispatch implementation in this build. A provider must be both to be used.
 */
export const DISPATCH_IMPLEMENTED_PROVIDERS = ['capway_aptic', 'file_export', 'nordfin'] as const
export type DispatchProvider = (typeof DISPATCH_IMPLEMENTED_PROVIDERS)[number]

/** Providers that receive approved invoices as a file instead of per-invoice API sends. */
export const FILE_PROVIDERS = ['file_export', 'nordfin'] as const
export type FileProvider = (typeof FILE_PROVIDERS)[number]

export function isFileProvider(provider: unknown): provider is FileProvider {
  return typeof provider === 'string' && (FILE_PROVIDERS as readonly string[]).includes(provider)
}
export type InvoiceProviderEnvironment = 'test' | 'production'

export type InvoiceProviderCatalogEntry = {
  provider: string
  label: string
  selectable: boolean
  unavailable_reason: string | null
}

export class InvoiceProviderConfigError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'InvoiceProviderConfigError'
  }
}

export function isDispatchImplemented(provider: unknown): provider is DispatchProvider {
  return typeof provider === 'string' && (DISPATCH_IMPLEMENTED_PROVIDERS as readonly string[]).includes(provider)
}

/**
 * Validates the tenant's stored selection. Throws when no provider is chosen, when the chosen
 * provider has no integration yet, or when the environment is missing — never falls back to a
 * default provider or environment.
 */
export function requireTenantInvoiceProvider(company: {
  invoice_export_target_system?: unknown
  billing_provider_environment?: unknown
}): { provider: DispatchProvider; environment: InvoiceProviderEnvironment } {
  const provider = company.invoice_export_target_system
  if (provider === null || provider === undefined || provider === '') {
    throw new InvoiceProviderConfigError('invoice_provider_not_selected', 'Ingen fakturaleverantör är vald för bolaget. Välj leverantör under Fakturering → Integrationer.')
  }
  if (!isDispatchImplemented(provider)) {
    throw new InvoiceProviderConfigError('invoice_provider_not_available', `Fakturaleverantören ${String(provider)} går inte att skicka via ännu.`)
  }
  const environment = company.billing_provider_environment
  if (environment !== 'test' && environment !== 'production') {
    throw new InvoiceProviderConfigError('invoice_provider_environment_missing', 'Fakturaleverantörens miljö (test/produktion) är inte vald för bolaget.')
  }
  return { provider, environment }
}

export type TenantInvoiceProviderSelection = {
  invoice_export_target_system: string | null
  billing_provider_environment: string | null
  invoice_export_enabled: boolean | null
}

/** The tenant's own selection (companies row, keyed by its id). */
export async function loadTenantInvoiceProviderSelection(companyId: string): Promise<TenantInvoiceProviderSelection | null> {
  const { data, error } = await tenantDb(companyId)
    .unscoped()
    .from('companies')
    .select('invoice_export_target_system,billing_provider_environment,invoice_export_enabled')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as TenantInvoiceProviderSelection | null
}

/** Platform-wide provider list (platform_shared table, no tenant data), shown to the given tenant. */
export async function listInvoiceProviderCatalog(companyId: string): Promise<InvoiceProviderCatalogEntry[]> {
  const { data, error } = await tenantDb(companyId)
    .unscoped()
    .from('invoice_provider_catalog')
    .select('provider,label,selectable,unavailable_reason')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as InvoiceProviderCatalogEntry[]).map((row) => ({
    ...row,
    // Selectable in the catalog but without code in this build is still not usable.
    selectable: row.selectable && isDispatchImplemented(row.provider),
    unavailable_reason: row.selectable && !isDispatchImplemented(row.provider)
      ? 'Integrationen finns inte i den här versionen.'
      : row.unavailable_reason,
  }))
}

const RPC_ERRORS: Record<string, string> = {
  invoice_provider_not_available: 'Leverantören går inte att välja ännu.',
  invoice_provider_unknown: 'Okänd fakturaleverantör.',
  invoice_provider_environment_invalid: 'Ogiltig miljö.',
  invoice_provider_switch_blocked_open_exports: 'Det finns pågående fakturaexporter. Byt leverantör när de är klara.',
  invoice_provider_not_selected: 'Välj en fakturaleverantör först.',
  invoice_file_provider_not_active: 'Filexport är inte vald och aktiverad för bolaget.',
  invoice_file_items_changed: 'Någon faktura ändrades medan filen skapades. Ladda om och försök igen.',
  invoice_file_empty: 'Det finns inga godkända fakturor att lägga i en fil.',
  nordfin_client_id_missing: 'Nordfins ClientId saknas för bolaget.',
  invoice_provider_connection_not_ready: 'Kopplingen till leverantören måste testas och godkännas innan utskick aktiveras.',
}

export function rpcError(error: { message?: string } | null) {
  const code = Object.keys(RPC_ERRORS).find((key) => error?.message?.includes(key))
  return code ? new InvoiceProviderConfigError(code, RPC_ERRORS[code]) : new Error(error?.message ?? 'Okänt fel')
}

export async function selectTenantInvoiceProvider(input: {
  companyId: string
  provider: string
  environment: InvoiceProviderEnvironment
  actorUserId: string
}) {
  if (!isDispatchImplemented(input.provider)) {
    throw new InvoiceProviderConfigError('invoice_provider_not_available', RPC_ERRORS.invoice_provider_not_available)
  }
  const { data, error } = await supabaseService.rpc('gridex_select_invoice_provider_v1', {
    p_company_id: input.companyId,
    p_provider: input.provider,
    p_environment: input.environment,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw rpcError(error)
  return data as { provider: string; environment: string; connection_created: boolean }
}

export async function setTenantInvoiceDispatchEnabled(input: { companyId: string; enabled: boolean; actorUserId: string }) {
  const { data, error } = await supabaseService.rpc('gridex_set_invoice_dispatch_enabled_v1', {
    p_company_id: input.companyId,
    p_enabled: input.enabled,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw rpcError(error)
  return data as { enabled: boolean; provider: string | null; environment: string | null }
}

/** Nordfin client id for the company and environment (kept on the provider connection). */
export async function loadNordfinClientId(companyId: string, environment: InvoiceProviderEnvironment): Promise<string | null> {
  const { data, error } = await tenantDb(companyId)
    .unscoped()
    .from('billing_provider_connections')
    .select('settings')
    .eq('company_id', companyId)
    .eq('provider', 'nordfin')
    .eq('environment', environment)
    .maybeSingle()
  if (error) throw error
  const value = (data?.settings as Record<string, unknown> | null | undefined)?.client_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeNordfinClientId(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{1,40}$/.test(text) ? text : null
}

export async function saveNordfinClientId(input: { companyId: string; environment: InvoiceProviderEnvironment; clientId: string; actorUserId: string }) {
  const clientId = normalizeNordfinClientId(input.clientId)
  if (!clientId) throw new InvoiceProviderConfigError('nordfin_client_id_invalid', 'ClientId får bara innehålla bokstäver, siffror, - och _ (högst 40 tecken).')
  const db = tenantDb(input.companyId).unscoped()
  const current = await db
    .from('billing_provider_connections')
    .select('id,settings')
    .eq('company_id', input.companyId)
    .eq('provider', 'nordfin')
    .eq('environment', input.environment)
    .maybeSingle()
  if (current.error) throw current.error
  if (!current.data) throw new InvoiceProviderConfigError('invoice_provider_not_selected', 'Välj Nordfin som fakturaleverantör först.')
  const settings = { ...((current.data.settings as Record<string, unknown> | null) ?? {}), client_id: clientId }
  const { error } = await db
    .from('billing_provider_connections')
    .update({ settings, updated_by: input.actorUserId, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', current.data.id)
  if (error) throw error
  return { clientId }
}
