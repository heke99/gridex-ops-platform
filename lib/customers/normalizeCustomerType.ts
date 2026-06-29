// Canonical customer-type normalization, shared across the website API, public
// contract filtering, admin import and external intake so the alias contract
// lives in exactly one place.
//
// Customer IDENTITY normalizes to the canonical values:
//   - `private`  (a natural person / consumer)
//   - `business` (a company / organisation)
//   - `association` (förening) — an admin/identity-only value, never accepted on
//     the public website API which is private|business only.
//
// Public contract AVAILABILITY (`public_contract_offers.customer_type`) may
// additionally be `both`; that lives on the offer, not on customer identity.

const PRIVATE_ALIASES = new Set([
  'private', 'privat', 'consumer', 'person', 'privatperson', 'individual',
])

const BUSINESS_ALIASES = new Set([
  'business', 'company', 'foretag', 'företag', 'corporate', 'organization',
  'organisation', 'enterprise', 'b2b', 'juridisk_person', 'juridisk person',
])

const ASSOCIATION_ALIASES = new Set([
  'association', 'förening', 'forening', 'brf', 'bostadsrättsförening',
  'bostadsrattsforening', 'samfällighet', 'samfallighet', 'ideell förening',
  'ideell_förening',
])

// Normalizes the many customer-type aliases used by tenant websites and
// external systems into the canonical 'private' | 'business' the platform uses.
// Returns null for empty input (caller applies the default) and the original
// lowercased token for unknown values so strict validation can reject it with a
// precise error code rather than silently defaulting.
export function normalizeCustomerType(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return null
  if (PRIVATE_ALIASES.has(raw)) return 'private'
  if (BUSINESS_ALIASES.has(raw)) return 'business'
  return raw
}

// Normalizes to the three-value customer IDENTITY enum used by the admin/import
// layer. Unknown values fall back to 'private' (matching the historical default
// and the DB default), but documented business/association aliases now map
// correctly instead of silently becoming 'private'.
export function normalizeCustomerIdentityType(
  value: unknown,
): 'private' | 'business' | 'association' {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return 'private'
  if (ASSOCIATION_ALIASES.has(raw)) return 'association'
  const base = normalizeCustomerType(raw)
  if (base === 'business') return 'business'
  if (base === 'private') return 'private'
  return 'private'
}

// True when the value (after normalization) is a recognised business customer.
export function isBusinessCustomerType(value: unknown): boolean {
  return normalizeCustomerType(value) === 'business'
}
