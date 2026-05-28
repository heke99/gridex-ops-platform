// lib/ediel/rulebook/codeRules.ts

import { PRODAT_SUBTYPE_TO_TRANSACTION_TYPE } from '@/lib/ediel/rulebook/rulebook'

export const RULEBOOK_ALLOWED_CODES = {
  prodatMessageCodes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'],
  supplierSwitchTransactionTypes: ['Z22', 'Z23', 'Z24', 'Z25', 'Z26', 'Z27', 'Z34', 'Z70', 'E32', 'E58', 'E64'],
  meteringAccessTransactionTypes: ['S17', 'S18', 'Z96', 'Z24'],
  permissionStatuses: ['Z23', 'Z24', 'Z25', 'Z28', 'Z75', 'Z76', 'Z77'],
  permissionEndReasons: ['B79', 'B80', 'E37', 'Z79'],
  installationDirections: ['E17', 'E18', 'E19'],
  permissionPurposes: ['B71', 'B72'],
  aiListFileExtensionsFrom20251001: ['csv'],
  aiListVersionMark: ['Ver20140401'],
} as const

export function mapProdatSubtypeToTransactionType(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!normalized) return null
  if (Object.values(PRODAT_SUBTYPE_TO_TRANSACTION_TYPE).includes(normalized)) return normalized
  return PRODAT_SUBTYPE_TO_TRANSACTION_TYPE[normalized] ?? null
}

export function isAllowedProdatBgmCode(value?: string | null): boolean {
  const normalized = String(value ?? '').trim().toUpperCase()
  return RULEBOOK_ALLOWED_CODES.prodatMessageCodes.includes(normalized as never)
}

export function isAllowedMeteringAccessTransactionType(value?: string | null): boolean {
  const normalized = String(value ?? '').trim().toUpperCase()
  return RULEBOOK_ALLOWED_CODES.meteringAccessTransactionTypes.includes(normalized as never)
}

export function isAllowedSupplierSwitchTransactionType(value?: string | null): boolean {
  const normalized = String(value ?? '').trim().toUpperCase()
  return RULEBOOK_ALLOWED_CODES.supplierSwitchTransactionTypes.includes(normalized as never)
}
