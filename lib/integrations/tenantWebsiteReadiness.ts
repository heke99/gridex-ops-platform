import { supabaseService } from '@/lib/supabase/service'
import {
  missingIntegrationApiScopes,
  type IntegrationApiClient,
} from '@/lib/integrations/apiAuth'
import {
  CUSTOMER_PORTAL_REQUIRED_SCOPES,
  TENANT_WEBSITE_RECOMMENDED_SCOPES,
  WEBSITE_CHECKOUT_REQUIRED_SCOPES,
} from '@/lib/integrations/websiteIntegrationContract'
import {
  evaluateCustomerApplicationAutomationReadiness,
  type CustomerApplicationAutomationReadiness,
} from '@/lib/website/customerApplicationAutomationReadiness'
import {
  getTenantOperationDecision,
  type TenantOperation,
  type TenantOperationDecision,
} from '@/lib/tenant/operationPolicy'

type JsonRecord = Record<string, unknown>

type ReadinessViewRow = {
  company_id?: string | null
  has_api_client?: boolean | null
  has_allowed_origin?: boolean | null
  has_public_contracts?: boolean | null
  has_terms?: boolean | null
  has_privacy_policy?: boolean | null
  has_withdrawal?: boolean | null
  has_power_of_attorney_text?: boolean | null
  has_price_terms?: boolean | null
  has_verified_sender?: boolean | null
  has_mail_templates?: boolean | null
  missing_items?: unknown
}

type CompanyReadinessRow = {
  id: string
  status: string | null
  external_tenant_reference: string | null
  customer_portal_url?: string | null
  website?: string | null
  branding?: JsonRecord | null
  portal_url_schema_ready: boolean
}

export type TenantWebsiteReadinessBlocker = {
  code: string
  component: 'tenant' | 'api' | 'contracts' | 'legal' | 'email' | 'automation' | 'portal' | 'facility' | 'webhook' | 'database'
  message: string
}

export type TenantWebsiteFlowReadiness = {
  ready: boolean
  website_checkout_ready: boolean
  customer_portal_ready: boolean
  complete_tenant_website_ready: boolean
  portal_identity_required: true
  portal_url: string | null
  status_delivery_modes: Array<'polling' | 'webhook'>
  webhook_delivery_ready: boolean
  checks: Record<string, boolean>
  operations: Partial<Record<TenantOperation, TenantOperationDecision>>
  blockers: TenantWebsiteReadinessBlocker[]
  warnings: TenantWebsiteReadinessBlocker[]
  missing_website_scopes: string[]
  missing_customer_portal_scopes: string[]
  missing_recommended_scopes: string[]
  automation: CustomerApplicationAutomationReadiness | null
}

const REQUIRED_OPERATIONS: TenantOperation[] = [
  'api_client.execute',
  'contract_channel.sell',
  'customer_automation.execute',
  'facility_lookup.execute',
  'email.send',
]

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function schemaMissing(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') ||
    /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
  )
}

function normalizePortalUrl(value: unknown): string | null {
  const text = clean(value)
  if (!text) return null
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password || parsed.hash) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function push(
  target: TenantWebsiteReadinessBlocker[],
  code: string,
  component: TenantWebsiteReadinessBlocker['component'],
  message: string,
) {
  if (!target.some((item) => item.code === code)) {
    target.push({ code, component, message })
  }
}

function operationBlocker(operation: TenantOperation, decision: TenantOperationDecision) {
  const labels: Record<TenantOperation, string> = {
    'api_client.execute': 'API-klienten får inte exekvera för tenantens nuvarande status.',
    'contract_channel.sell': 'Tenantens webbkanal är inte godkänd för avtalsförsäljning.',
    'customer_automation.execute': 'Tenantens kundautomation är inte redo.',
    'facility_lookup.execute': 'Tenantens anläggningsuppslag är inte redo.',
    'email.send': 'Tenantens e-postutskick är inte redo.',
    'webhook.deliver': 'Tenantens webhookleverans är inte redo.',
    'ediel.production.send': 'Tenantens Ediel-produktion får inte skicka.',
    'ediel.test.process': 'Tenantens Ediel-test får inte köras.',
    'invitation.accept': 'Tenantens inbjudningar får inte accepteras.',
    'company_user.manage': 'Tenantens användare får inte administreras.',
    'production.prepare': 'Tenantens produktion får inte förberedas.',
    'production.activate': 'Tenantens produktion får inte aktiveras.',
    'production.pause': 'Tenantens produktion får inte pausas.',
    'production.resume': 'Tenantens produktion får inte återupptas.',
  }
  return `${labels[operation]} (${decision.reason_code})`
}

async function loadReadinessView(companyId: string): Promise<ReadinessViewRow | null> {
  const { data, error } = await supabaseService
    .from('tenant_website_readiness_v')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) {
    if (schemaMissing(error)) return null
    throw error
  }
  return (data ?? null) as ReadinessViewRow | null
}

async function loadCompany(companyId: string): Promise<CompanyReadinessRow | null> {
  const primary = await supabaseService
    .from('companies')
    .select('id,status,external_tenant_reference,customer_portal_url,website,branding')
    .eq('id', companyId)
    .maybeSingle()
  if (!primary.error) {
    return primary.data
      ? { ...(primary.data as Omit<CompanyReadinessRow, 'portal_url_schema_ready'>), portal_url_schema_ready: true }
      : null
  }
  if (!schemaMissing(primary.error)) throw primary.error

  const fallback = await supabaseService
    .from('companies')
    .select('id,status,external_tenant_reference,website,branding')
    .eq('id', companyId)
    .maybeSingle()
  if (fallback.error) throw fallback.error
  return fallback.data
    ? { ...(fallback.data as Omit<CompanyReadinessRow, 'portal_url_schema_ready'>), portal_url_schema_ready: false }
    : null
}

async function activeWebhookCount(companyId: string, clientId: string): Promise<number> {
  const { count, error } = await supabaseService
    .from('webhook_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('api_client_id', clientId)
    .eq('status', 'active')
  if (error) {
    if (schemaMissing(error)) return 0
    throw error
  }
  return Number(count ?? 0)
}

async function loadOperationDecisions(companyId: string) {
  const entries = await Promise.all(
    [...REQUIRED_OPERATIONS, 'webhook.deliver' as const].map(async (operation) => {
      try {
        return [operation, await getTenantOperationDecision(companyId, operation)] as const
      } catch (error) {
        if (!schemaMissing(error)) throw error
        return [
          operation,
          {
            allowed: false,
            reason_code: 'tenant_operation_schema_not_ready',
            company_status: null,
            capability_status: 'missing',
            production_status: null,
            state_version: 0,
          } satisfies TenantOperationDecision,
        ] as const
      }
    }),
  )
  return Object.fromEntries(entries) as Partial<Record<TenantOperation, TenantOperationDecision>>
}

/**
 * One canonical runtime truth for a tenant website, checkout, customer portal,
 * email continuation and status delivery. Every caller receives the same
 * blockers; scopes alone are never considered launch readiness.
 */
export async function loadTenantWebsiteFlowReadiness(input: {
  companyId: string
  client: IntegrationApiClient
}): Promise<TenantWebsiteFlowReadiness> {
  const scopes = input.client.scopes ?? []
  const missingWebsiteScopes = missingIntegrationApiScopes(scopes, WEBSITE_CHECKOUT_REQUIRED_SCOPES)
  const missingPortalScopes = missingIntegrationApiScopes(scopes, CUSTOMER_PORTAL_REQUIRED_SCOPES)
  const missingRecommendedScopes = missingIntegrationApiScopes(scopes, TENANT_WEBSITE_RECOMMENDED_SCOPES)

  const [company, readinessView, automation, webhookCount, operations] = await Promise.all([
    loadCompany(input.companyId),
    loadReadinessView(input.companyId),
    evaluateCustomerApplicationAutomationReadiness(input.companyId).catch((error) => {
      if (schemaMissing(error)) return null
      throw error
    }),
    activeWebhookCount(input.companyId, input.client.id),
    loadOperationDecisions(input.companyId),
  ])

  const blockers: TenantWebsiteReadinessBlocker[] = []
  const warnings: TenantWebsiteReadinessBlocker[] = []
  const branding = jsonRecord(company?.branding)
  const canonicalPortalUrl = normalizePortalUrl(company?.customer_portal_url)
  const portalUrl = canonicalPortalUrl ?? normalizePortalUrl(branding.customer_portal_url)

  const checks = {
    tenant_exists: Boolean(company),
    tenant_active: company?.status === 'active',
    external_tenant_reference_present: Boolean(clean(company?.external_tenant_reference)),
    api_client_active: input.client.status === 'active',
    allowed_origin_present: Boolean(input.client.allowed_origins?.length),
    website_scopes_present: missingWebsiteScopes.length === 0,
    portal_scopes_present: missingPortalScopes.length === 0,
    recommended_scopes_present: missingRecommendedScopes.length === 0,
    public_contracts_present: readinessView?.has_public_contracts === true,
    terms_present: readinessView?.has_terms === true,
    privacy_policy_present: readinessView?.has_privacy_policy === true,
    withdrawal_present: readinessView?.has_withdrawal === true,
    power_of_attorney_text_present: readinessView?.has_power_of_attorney_text === true,
    price_terms_present: readinessView?.has_price_terms === true,
    verified_sender_present:
      readinessView?.has_verified_sender === true &&
      automation?.checks.verified_customer_email_sender === true,
    required_email_templates_present:
      readinessView?.has_mail_templates === true &&
      automation?.checks.required_email_templates_active === true,
    required_email_rules_present: automation?.checks.required_email_rules_active === true,
    automation_user_ready:
      automation?.checks.automation_user_configured === true &&
      automation?.checks.automation_user_verified === true,
    automation_cron_ready: automation?.checks.cron_secret_configured === true,
    facility_operations_mailbox_ready:
      automation?.checks.manual_operations_mailbox_ready === true,
    portal_url_schema_ready: company?.portal_url_schema_ready === true,
    portal_url_present: Boolean(canonicalPortalUrl),
    webhook_subscription_present: webhookCount > 0,
    operation_api_client_allowed: operations['api_client.execute']?.allowed === true,
    operation_contract_channel_allowed: operations['contract_channel.sell']?.allowed === true,
    operation_customer_automation_allowed:
      operations['customer_automation.execute']?.allowed === true,
    operation_facility_lookup_allowed: operations['facility_lookup.execute']?.allowed === true,
    operation_email_allowed: operations['email.send']?.allowed === true,
    operation_webhook_allowed: operations['webhook.deliver']?.allowed === true,
    readiness_view_present: Boolean(readinessView),
  }

  if (!checks.tenant_exists) push(blockers, 'tenant_not_found', 'tenant', 'Tenantbolaget kunde inte hittas.')
  if (checks.tenant_exists && !checks.tenant_active) push(blockers, 'tenant_not_active', 'tenant', 'Tenantbolaget måste vara aktivt innan webbansökningar får tas emot.')
  if (!checks.external_tenant_reference_present) push(blockers, 'external_tenant_reference_missing', 'tenant', 'Tenantens externa referens saknas.')
  if (!checks.api_client_active) push(blockers, 'api_client_not_active', 'api', 'API-klienten är inte aktiv.')
  if (!checks.allowed_origin_present) push(blockers, 'allowed_origin_missing', 'api', 'Minst en tillåten HTTPS-origin saknas.')
  if (!checks.website_scopes_present) push(blockers, 'website_scopes_missing', 'api', `Webbscopes saknas: ${missingWebsiteScopes.join(', ')}`)
  if (!checks.portal_scopes_present) push(blockers, 'customer_portal_scopes_missing', 'portal', `Mina sidor-scopes saknas: ${missingPortalScopes.join(', ')}`)
  if (!checks.public_contracts_present) push(blockers, 'public_contracts_missing', 'contracts', 'Minst ett publicerat och teckningsbart avtal saknas.')
  if (!checks.terms_present) push(blockers, 'legal_terms_missing', 'legal', 'Publicerade allmänna villkor saknas.')
  if (!checks.privacy_policy_present) push(blockers, 'privacy_policy_missing', 'legal', 'Publicerad integritetspolicy saknas.')
  if (!checks.withdrawal_present) push(blockers, 'withdrawal_text_missing', 'legal', 'Publicerad ångerrättstext saknas.')
  if (!checks.power_of_attorney_text_present) push(blockers, 'power_of_attorney_text_missing', 'legal', 'Publicerad fullmaktstext saknas.')
  if (!checks.price_terms_present) push(blockers, 'price_terms_missing', 'legal', 'Publicerade prisvillkor saknas.')
  if (!checks.verified_sender_present) push(blockers, 'verified_email_sender_missing', 'email', 'Verifierad tenantavsändare för kundmail saknas.')
  if (!checks.required_email_templates_present) push(blockers, 'required_email_templates_missing', 'email', 'Obligatoriska kundmailmallar saknas eller är inaktiva.')
  if (!checks.required_email_rules_present) push(blockers, 'required_email_rules_missing', 'email', 'Obligatoriska kundmailregler saknas eller är inaktiva.')
  if (!checks.automation_user_ready) push(blockers, 'automation_user_not_ready', 'automation', 'Kundautomationens verifierade systemanvändare är inte redo.')
  if (!checks.automation_cron_ready) push(blockers, 'automation_cron_not_ready', 'automation', 'Kundautomationens cron-secret är inte konfigurerad.')
  if (!checks.facility_operations_mailbox_ready) push(blockers, 'facility_mailbox_not_ready', 'facility', 'Verifierad production-mailbox för anläggningsuppslag saknas.')
  if (!checks.portal_url_schema_ready) push(blockers, 'customer_portal_url_schema_missing', 'database', 'Databasen saknar canonical customer_portal_url-kolumn.')
  if (!checks.portal_url_present) push(blockers, 'customer_portal_url_missing', 'portal', 'Tenantens HTTPS-adress till Mina sidor saknas.')
  if (!checks.readiness_view_present) push(blockers, 'tenant_website_readiness_schema_missing', 'database', 'Databasens tenant-readiness-vy saknas.')

  for (const operation of REQUIRED_OPERATIONS) {
    const decision = operations[operation]
    if (!decision?.allowed) {
      push(
        blockers,
        `tenant_operation_blocked_${operation.replaceAll('.', '_')}`,
        operation === 'email.send'
          ? 'email'
          : operation === 'facility_lookup.execute'
            ? 'facility'
            : operation === 'customer_automation.execute'
              ? 'automation'
              : operation === 'contract_channel.sell'
                ? 'contracts'
                : 'api',
        operationBlocker(operation, decision ?? {
          allowed: false,
          reason_code: 'decision_missing',
          company_status: null,
          capability_status: null,
          production_status: null,
          state_version: 0,
        }),
      )
    }
  }

  if (!checks.webhook_subscription_present) {
    push(
      warnings,
      'webhook_subscription_missing',
      'webhook',
      'Ingen aktiv webhook finns. Tenant måste polla ansökningsstatus tills webhook är konfigurerad.',
    )
  } else if (!checks.operation_webhook_allowed) {
    const decision = operations['webhook.deliver']
    push(
      warnings,
      'tenant_operation_blocked_webhook_deliver',
      'webhook',
      operationBlocker('webhook.deliver', decision ?? {
        allowed: false,
        reason_code: 'decision_missing',
        company_status: null,
        capability_status: null,
        production_status: null,
        state_version: 0,
      }),
    )
  }
  for (const warning of automation?.warnings ?? []) {
    push(warnings, `automation_warning_${warnings.length + 1}`, 'automation', warning)
  }

  const websiteCheckoutReady = [
    checks.tenant_active,
    checks.external_tenant_reference_present,
    checks.api_client_active,
    checks.allowed_origin_present,
    checks.website_scopes_present,
    checks.public_contracts_present,
    checks.terms_present,
    checks.privacy_policy_present,
    checks.withdrawal_present,
    checks.power_of_attorney_text_present,
    checks.price_terms_present,
    checks.verified_sender_present,
    checks.required_email_templates_present,
    checks.required_email_rules_present,
    checks.automation_user_ready,
    checks.automation_cron_ready,
    checks.facility_operations_mailbox_ready,
    checks.operation_api_client_allowed,
    checks.operation_contract_channel_allowed,
    checks.operation_customer_automation_allowed,
    checks.operation_facility_lookup_allowed,
    checks.operation_email_allowed,
    checks.readiness_view_present,
  ].every(Boolean)
  const customerPortalReady = [
    checks.tenant_active,
    checks.api_client_active,
    checks.portal_scopes_present,
    checks.portal_url_schema_ready,
    checks.portal_url_present,
    checks.operation_api_client_allowed,
  ].every(Boolean)
  const completeReady = websiteCheckoutReady && customerPortalReady

  return {
    ready: completeReady,
    website_checkout_ready: websiteCheckoutReady,
    customer_portal_ready: customerPortalReady,
    complete_tenant_website_ready: completeReady,
    portal_identity_required: true,
    portal_url: portalUrl,
    status_delivery_modes: webhookCount > 0 ? ['polling', 'webhook'] : ['polling'],
    webhook_delivery_ready:
      webhookCount > 0 && operations['webhook.deliver']?.allowed === true,
    checks,
    operations,
    blockers,
    warnings,
    missing_website_scopes: missingWebsiteScopes,
    missing_customer_portal_scopes: missingPortalScopes,
    missing_recommended_scopes: missingRecommendedScopes,
    automation,
  }
}

function prerequisiteBlockerCodes(
  readiness: TenantWebsiteFlowReadiness,
  components: TenantWebsiteReadinessBlocker['component'][],
): string[] {
  return readiness.blockers
    .filter(
      (blocker) =>
        components.includes(blocker.component) &&
        !blocker.code.startsWith('tenant_operation_blocked_'),
    )
    .map((blocker) => blocker.code)
}

const CAPABILITY_ALIASES: Array<{
  code: string
  check: (readiness: TenantWebsiteFlowReadiness) => boolean
  blockers: (readiness: TenantWebsiteFlowReadiness) => string[]
}> = [
  {
    code: 'api_sales',
    check: (r) => r.checks.api_client_active && r.checks.allowed_origin_present && r.checks.website_scopes_present,
    blockers: (r) => prerequisiteBlockerCodes(r, ['api', 'tenant', 'database']),
  },
  {
    code: 'website_sales',
    check: (r) => r.checks.public_contracts_present && r.checks.terms_present && r.checks.privacy_policy_present && r.checks.withdrawal_present && r.checks.power_of_attorney_text_present && r.checks.price_terms_present,
    blockers: (r) => prerequisiteBlockerCodes(r, ['contracts', 'legal']),
  },
  {
    code: 'email_outbound',
    check: (r) => r.checks.verified_sender_present && r.checks.required_email_templates_present && r.checks.required_email_rules_present,
    blockers: (r) => prerequisiteBlockerCodes(r, ['email']),
  },
  {
    code: 'customer_automation',
    check: (r) => r.checks.automation_user_ready && r.checks.automation_cron_ready,
    blockers: (r) => prerequisiteBlockerCodes(r, ['automation']),
  },
  {
    code: 'facility_lookup',
    check: (r) => r.checks.facility_operations_mailbox_ready,
    blockers: (r) => prerequisiteBlockerCodes(r, ['facility']),
  },
  {
    code: 'webhooks',
    check: (r) => r.checks.webhook_subscription_present,
    blockers: (r) => r.warnings.filter((b) => b.component === 'webhook').map((b) => b.code),
  },
  {
    code: 'website_intake_enabled',
    check: (r) => r.website_checkout_ready,
    blockers: (r) => r.blockers.map((b) => b.code),
  },
  {
    code: 'customer_portal_enabled',
    check: (r) => r.customer_portal_ready,
    blockers: (r) => r.blockers.filter((b) => ['portal', 'api', 'tenant'].includes(b.component)).map((b) => b.code),
  },
  {
    code: 'facility_lookup_enabled',
    check: (r) => r.checks.facility_operations_mailbox_ready,
    blockers: (r) => r.blockers.filter((b) => b.component === 'facility').map((b) => b.code),
  },
  {
    code: 'supplier_switch_enabled',
    check: (r) => r.checks.automation_user_ready && r.checks.automation_cron_ready && r.checks.facility_operations_mailbox_ready,
    blockers: (r) => r.blockers.filter((b) => ['automation', 'facility'].includes(b.component)).map((b) => b.code),
  },
  {
    code: 'webhook_delivery_enabled',
    check: (r) => r.checks.webhook_subscription_present,
    blockers: (r) => r.warnings.filter((b) => b.component === 'webhook').map((b) => b.code),
  },
]

/**
 * Reconciles both historical capability vocabularies in company_capabilities.
 * The database operation policy and the newer tenant feature flags therefore
 * converge from the same verified runtime prerequisites.
 */
export async function reconcileTenantWebsiteCapabilities(input: {
  companyId: string
  actorUserId: string
  client: IntegrationApiClient
}): Promise<TenantWebsiteFlowReadiness> {
  const preliminary = await loadTenantWebsiteFlowReadiness({
    companyId: input.companyId,
    client: input.client,
  })
  const now = new Date().toISOString()
  const rows = CAPABILITY_ALIASES.map((capability) => {
    const ready = capability.check(preliminary)
    const blockers = Array.from(new Set(capability.blockers(preliminary)))
    return {
      company_id: input.companyId,
      capability_code: capability.code,
      enabled: ready,
      readiness_status: ready ? 'ready' : 'blocked',
      blockers,
      configuration: {
        source: 'tenant_website_flow_readiness_v1',
        api_client_id: input.client.id,
        portal_identity_required: true,
        status_delivery_modes: preliminary.status_delivery_modes,
      },
      last_verified_at: now,
      last_verified_by: input.actorUserId,
      updated_by: input.actorUserId,
      updated_at: now,
    }
  })

  const { error } = await supabaseService
    .from('company_capabilities')
    .upsert(rows, { onConflict: 'company_id,capability_code' })
  if (error) throw error

  const finalReadiness = await loadTenantWebsiteFlowReadiness({
    companyId: input.companyId,
    client: input.client,
  })
  const aliasRows = CAPABILITY_ALIASES
    .filter((capability) => capability.code.endsWith('_enabled'))
    .map((capability) => {
      const ready = capability.check(finalReadiness)
      return {
        company_id: input.companyId,
        capability_code: capability.code,
        enabled: ready,
        readiness_status: ready ? 'ready' : 'blocked',
        blockers: Array.from(new Set(capability.blockers(finalReadiness))),
        configuration: {
          source: 'tenant_website_flow_readiness_v1',
          api_client_id: input.client.id,
          portal_identity_required: true,
          status_delivery_modes: finalReadiness.status_delivery_modes,
        },
        last_verified_at: now,
        last_verified_by: input.actorUserId,
        updated_by: input.actorUserId,
        updated_at: now,
      }
    })
  if (aliasRows.length > 0) {
    const aliasResult = await supabaseService
      .from('company_capabilities')
      .upsert(aliasRows, { onConflict: 'company_id,capability_code' })
    if (aliasResult.error) throw aliasResult.error
  }

  return finalReadiness
}
