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

/** Where the tenant's own admin chooses its invoice provider (selectInvoiceProviderAction). */
export const INVOICE_PROVIDER_SETTINGS_PATH = '/admin/billing/integrations'
/** Stable go-live readiness code for a tenant the monthly billing cron would refuse (FINDINGS F115). */
export const INVOICE_PROVIDER_MISSING_CODE = 'invoice_provider_missing'

export type TenantInvoiceProviderReadiness =
  | { ready: true; provider: DispatchProvider; environment: InvoiceProviderEnvironment }
  | {
      ready: false
      code: typeof INVOICE_PROVIDER_MISSING_CODE
      /** The billing code the cron raises: invoice_provider_not_selected / _not_available / _environment_missing. */
      reason: string
      message: string
      actionLabel: string
      actionHref: string
    }

/**
 * "A provider is selected", by the same definition the monthly billing cron uses
 * (requireTenantInvoiceProvider): ready exactly when the cron would accept the tenant.
 * Never throws for a configuration gap; it reports it with an action for the tenant's admin.
 */
export function evaluateTenantInvoiceProviderReadiness(company: {
  invoice_export_target_system?: unknown
  billing_provider_environment?: unknown
}): TenantInvoiceProviderReadiness {
  try {
    return { ready: true, ...requireTenantInvoiceProvider(company) }
  } catch (error) {
    if (!(error instanceof InvoiceProviderConfigError)) throw error
    const action = error.message.includes('Fakturering → Integrationer')
      ? ''
      : ' Bolagets administratör åtgärdar det under Fakturering → Integrationer.'
    return {
      ready: false,
      code: INVOICE_PROVIDER_MISSING_CODE,
      reason: error.code,
      message: `${error.message}${action} Go-live kräver en vald fakturaleverantör, annars nekar månadsdebiteringen bolaget efter första leveransmånaden.`,
      actionLabel: 'Välj fakturaleverantör',
      actionHref: INVOICE_PROVIDER_SETTINGS_PATH,
    }
  }
}

/** Stable go-live readiness code: billing automation is off, so no invoices are prepared at all (FINDINGS F117). */
export const BILLING_AUTOMATION_DISABLED_CODE = 'billing_automation_disabled'
/** Stable go-live readiness code: invoices are prepared for review, but dispatch to the provider is not enabled (F117). */
export const INVOICE_DISPATCH_NOT_ENABLED_CODE = 'invoice_dispatch_not_enabled'

export type TenantInvoiceStepReadiness =
  | { ready: true }
  | { ready: false; code: string; message: string; actionLabel: string; actionHref: string }

/**
 * Preparation step (owner decision 24, FINDINGS F117): the monthly billing cron prepares underlays, pricing and
 * draft invoices for review when a provider is selected (evaluateTenantInvoiceProviderReadiness) and billing
 * automation is on. Dispatch is a separate step (evaluateTenantInvoiceDispatchReadiness) and is not required here.
 */
export function evaluateTenantBillingAutomationReadiness(company: { billing_automation_enabled?: unknown }): TenantInvoiceStepReadiness {
  if (company.billing_automation_enabled === true) return { ready: true }
  return {
    ready: false,
    code: BILLING_AUTOMATION_DISABLED_CODE,
    message: 'Faktureringsautomationen är avstängd för bolaget, så inga fakturor förbereds för granskning. Bolagets administratör aktiverar den under Fakturering → Integrationer.',
    actionLabel: 'Aktivera faktureringsautomation',
    actionHref: INVOICE_PROVIDER_SETTINGS_PATH,
  }
}

/**
 * Dispatch step (F117): approved invoices reach the provider only when dispatch is enabled, which the database
 * allows only for a tested (ready/active) provider connection (gridex_set_invoice_dispatch_enabled_v1). Invoices
 * can be prepared and reviewed before that.
 */
export function evaluateTenantInvoiceDispatchReadiness(company: { invoice_export_enabled?: unknown }): TenantInvoiceStepReadiness {
  if (company.invoice_export_enabled === true) return { ready: true }
  return {
    ready: false,
    code: INVOICE_DISPATCH_NOT_ENABLED_CODE,
    message: 'Utskick till fakturaleverantören är inte aktiverat. Fakturor förbereds och kan granskas, men skickas inte förrän kopplingen är testad och utskick aktiverat under Fakturering → Integrationer.',
    actionLabel: 'Testa kopplingen och aktivera utskick',
    actionHref: INVOICE_PROVIDER_SETTINGS_PATH,
  }
}

export type TenantInvoiceProviderSelection = {
  invoice_export_target_system: string | null
  billing_provider_environment: string | null
  invoice_export_enabled: boolean | null
  billing_automation_enabled?: boolean | null
}

/** The tenant's own selection (companies row, keyed by its id). */
export async function loadTenantInvoiceProviderSelection(companyId: string): Promise<TenantInvoiceProviderSelection | null> {
  const { data, error } = await tenantDb(companyId)
    .unscoped()
    .from('companies')
    .select('invoice_export_target_system,billing_provider_environment,invoice_export_enabled,billing_automation_enabled')
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

/**
 * Turns the tenant's monthly invoice preparation on or off (FINDINGS F117). Turning it on requires a selected
 * provider (the cron's own definition, requireTenantInvoiceProvider); it never enables dispatch, which keeps its
 * own gate (tested connection + setTenantInvoiceDispatchEnabled). Compare-and-set on the tenant's own row and a
 * fail-closed audit row; a failed audit write reverts the change.
 */
export async function setTenantBillingAutomationEnabled(input: { companyId: string; enabled: boolean; actorUserId: string }) {
  const current = await supabaseService
    .from('companies')
    .select('id,billing_automation_enabled,invoice_export_target_system,billing_provider_environment')
    .eq('id', input.companyId)
    .maybeSingle()
  if (current.error) throw current.error
  if (!current.data) throw new InvoiceProviderConfigError('company_not_found', 'Bolaget saknas.')
  const row = current.data as { billing_automation_enabled: boolean | null; invoice_export_target_system: string | null; billing_provider_environment: string | null }
  const selected = input.enabled ? requireTenantInvoiceProvider(row) : null
  const previous = row.billing_automation_enabled === true
  if (previous === input.enabled) return { enabled: input.enabled, changed: false }
  const updated = await supabaseService
    .from('companies')
    .update({ billing_automation_enabled: input.enabled })
    .eq('id', input.companyId)
    .eq('billing_automation_enabled', previous)
    .select('id')
    .maybeSingle()
  if (updated.error) throw updated.error
  if (!updated.data) throw new InvoiceProviderConfigError('billing_automation_changed_concurrently', 'Inställningen ändrades samtidigt av någon annan. Ladda om och försök igen.')
  const audit = await supabaseService.from('audit_logs').insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    entity_type: 'company',
    entity_id: input.companyId,
    action: input.enabled ? 'billing_automation_enabled' : 'billing_automation_disabled',
    old_values: { billing_automation_enabled: previous },
    new_values: { billing_automation_enabled: input.enabled },
    metadata: { source: 'billing_integrations', provider: selected?.provider ?? row.invoice_export_target_system, environment: selected?.environment ?? row.billing_provider_environment },
  })
  if (audit.error) {
    await supabaseService.from('companies').update({ billing_automation_enabled: previous }).eq('id', input.companyId).eq('billing_automation_enabled', input.enabled)
    throw audit.error
  }
  return { enabled: input.enabled, changed: true }
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
