/**
 * API client profiles define a set of preconfigured scopes for common use
 * cases. Admins can choose a profile when creating a new API client instead
 * of assigning individual scopes. Profiles are not persisted in the database
 * but are referenced in migrations and readiness checks. Keep the names in
 * sync with integration_api_client_profiles if that table is used.
 */

export type ApiClientProfileKey =
  | 'website_read_only'
  | 'website_signup'
  | 'tenant_website'
  | 'customer_portal'
  | 'events_webhooks'
  | 'internal_system_integration'

export type ApiClientProfile = {
  key: ApiClientProfileKey
  label: string
  defaultScopes: string[]
  requireAllowedOrigins: boolean
}

/**
 * A registry of available API client profiles. Only these keys are allowed.
 */
export const API_CLIENT_PROFILES: Record<ApiClientProfileKey, ApiClientProfile> = {
  website_read_only: {
    key: 'website_read_only',
    label: 'Hemsida (endast läsning)',
    defaultScopes: ['website_contracts.read', 'website_legal.read'],
    requireAllowedOrigins: true,
  },
  website_signup: {
    key: 'website_signup',
    label: 'Hemsida (canonical teckning)',
    defaultScopes: [
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_market_prices.read',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read',
      'website_events.write',
      'events.read',
    ],
    requireAllowedOrigins: true,
  },
  tenant_website: {
    key: 'tenant_website',
    label: 'Tenanthemsida + Mina sidor (en API-nyckel)',
    defaultScopes: [
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_market_prices.read',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read',
      'website_events.write',
      'events.read',
      'customer_profile.read',
      'customer_sites.read',
      'customer_contracts.read',
      'customer_invoices.read',
      'customer_metering.read',
      'customer_legal.read',
      'customer_events.read',
      'customer_documents.read',
      'customer_documents.write',
      'customer_notifications.read',
      'customer_notifications.write',
      'customer_power_of_attorney.read',
      'customer_contact.write',
      'customer_facility_data.write',
      'customer_power_of_attorney.write',
      'customer_sync.write',
    ],
    requireAllowedOrigins: true,
  },
  customer_portal: {
    key: 'customer_portal',
    label: 'Kundportal',
    defaultScopes: [
      'customer_profile.read',
      'customer_sites.read',
      'customer_contracts.read',
      'customer_invoices.read',
      'customer_metering.read',
      'customer_legal.read',
      'customer_events.read',
      'customer_documents.read',
      'customer_notifications.read',
      'customer_power_of_attorney.read',
      'customer_notifications.write',
      'customer_contact.write',
      'customer_facility_data.write',
      'customer_power_of_attorney.write',
      'customer_sync.write',
    ],
    requireAllowedOrigins: true,
  },
  events_webhooks: {
    key: 'events_webhooks',
    label: 'Webhooks',
    defaultScopes: ['events.read', 'website_events.write'],
    requireAllowedOrigins: false,
  },
  internal_system_integration: {
    key: 'internal_system_integration',
    label: 'Intern systemintegration',
    defaultScopes: ['*'],
    requireAllowedOrigins: false,
  },
}

/**
 * Resolve a profile by key. Returns undefined if the key is not known.
 */
export function getApiClientProfile(key: ApiClientProfileKey | string | null | undefined): ApiClientProfile | undefined {
  if (!key) return undefined
  return API_CLIENT_PROFILES[key as ApiClientProfileKey]
}
