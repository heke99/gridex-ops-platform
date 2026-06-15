import type { ActorRegistryRole } from '@/lib/actor-registry/types'

export function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeName(value: unknown): string | null {
  const clean = cleanString(value)
  return clean ? clean.toLowerCase() : null
}

export function normalizeOrgNumber(value: unknown): string | null {
  const clean = cleanString(value)
  if (!clean) return null
  const digits = clean.replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

export function normalizeEdielId(value: unknown): string | null {
  const clean = cleanString(value)
  if (!clean) return null
  return clean.toUpperCase()
}

export function normalizeEic(value: unknown): string | null {
  const clean = cleanString(value)
  if (!clean) return null
  return clean.toUpperCase()
}

export function normalizeEmail(value: unknown): string | null {
  const clean = cleanString(value)
  return clean ? clean.toLowerCase() : null
}

export function normalizeSubaddress(value: unknown): string | null {
  const clean = cleanString(value)
  return clean ? clean.toUpperCase() : null
}

export function normalizeRole(value: unknown): ActorRegistryRole {
  const normalized = cleanString(value)?.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[\s-]+/g, '_')
  if (!normalized) return 'other'
  if (['grid_owner', 'network_owner', 'netowner', 'dso', 'distribution_system_operator', 'natagare', 'elnatsforetag'].includes(normalized)) return 'grid_owner'
  if (['electricity_supplier', 'power_supplier', 'supplier', 'elhandelsbolag', 'elleverantor'].includes(normalized)) return 'electricity_supplier'
  if (['balance_responsible', 'balansansvarig', 'brp'].includes(normalized)) return 'balance_responsible'
  if (['energy_service_company', 'esco', 'energitjansteforetag'].includes(normalized)) return 'energy_service_company'
  if (['system_supplier', 'systemleverantor'].includes(normalized)) return 'system_supplier'
  if (['edi_operator', 'edi_operatör', 'edi_operatoren', 'ombud'].includes(normalized)) return 'edi_operator'
  return 'other'
}

export function uniqueStrings<T extends string>(values: Array<T | null | undefined>): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const value of values) {
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
